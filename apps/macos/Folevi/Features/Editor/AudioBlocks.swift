import AVFoundation
import SwiftUI

// MARK: - Shared formatting

/// "4:05", or "1:02:09" past an hour, rounded to the nearest second (the web's `formatDuration`).
private func formatDuration(_ seconds: Double) -> String {
    let s = max(0, Int(seconds.isFinite ? seconds.rounded() : 0))
    let h = s / 3600, m = (s % 3600) / 60, r = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%d:%02d", m, r)
}

/// "512 B", "48 KB", "3.4 MB", "1.25 GB" (the web's `formatBytes`).
private func formatBytes(_ n: Double) -> String {
    if n < 1024 { return "\(Int(n)) B" }
    if n < 1024 * 1024 { return String(format: "%.0f KB", n / 1024) }
    if n < 1024 * 1024 * 1024 { return String(format: "%.1f MB", n / 1024 / 1024) }
    return String(format: "%.2f GB", n / 1024 / 1024 / 1024)
}

/// The recording red (`#e5484d`), for the live mic badge and the level meter.
private let recordingRed = Color(red: 0xe5 / 255, green: 0x48 / 255, blue: 0x4d / 255)

/// A 32pt square icon button with 6pt corners: muted, glass hover (the web's `size-8 rounded-[6px]`).
private struct AudioSquareButtonStyle: ButtonStyle {
    var minWidth: CGFloat = 32
    func makeBody(configuration: Configuration) -> some View {
        AudioSquareButtonBody(configuration: configuration, minWidth: minWidth)
    }
}

private struct AudioSquareButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let minWidth: CGFloat
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .foregroundStyle(hovering && isEnabled ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, minWidth > 32 ? 6 : 0)
            .frame(minWidth: minWidth, minHeight: 32)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(hovering && isEnabled || configuration.isPressed ? FoleviGlass.hover : .clear))
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .opacity(isEnabled ? 1 : 0.4)
            .onHover { hovering = $0 }
    }
}

// MARK: - Recorder

/// Records from the microphone into an AAC file (MP4 audio, one of the formats the server accepts), with
/// pause, resume, a level meter and the one-hour cap (AudioRecorder.tsx).
@MainActor
@Observable
final class AudioRecorderModel {
    enum Phase: Equatable { case asking, recording, paused, saving, error(String) }

    /// Bars in the level meter.
    static let bars = 36

    var phase: Phase = .asking
    var elapsed: Double = 0
    /// Recent input levels, 0…1, oldest first.
    var levels: [Double] = Array(repeating: 0, count: AudioRecorderModel.bars)
    /// Called when the recording reaches the hour, which stops and saves it like Stop and save.
    var onLimit: (() -> Void)?

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private let url = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-recording-\(UUID().uuidString).m4a")

    var isLive: Bool { phase == .recording || phase == .paused }

    /// Asks for the microphone and starts at once: choosing "Audio recording" was the record click.
    func start() async {
        let granted: Bool
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: granted = true
        case .notDetermined: granted = await AVCaptureDevice.requestAccess(for: .audio)
        default: granted = false
        }
        guard granted else {
            phase = .error(String(localized: "Folevi can’t use your microphone. Allow it in System Settings › Privacy & Security › Microphone, then try again."))
            return
        }
        guard AVCaptureDevice.default(for: .audio) != nil else {
            phase = .error(String(localized: "No microphone was found. Connect one and try again."))
            return
        }
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
        ]
        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            r.isMeteringEnabled = true
            guard r.record(forDuration: AudioProps.maxSeconds) else { throw CocoaError(.fileWriteUnknown) }
            recorder = r
            phase = .recording
            timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            }
        } catch {
            phase = .error(String(localized: "The recording couldn’t start. Try again."))
        }
    }

    private func tick() {
        guard let r = recorder else { return }
        if phase == .recording, !r.isRecording {
            // Reached the hour: stop and save, as the web does.
            elapsed = AudioProps.maxSeconds
            onLimit?()
            return
        }
        if r.currentTime > 0 { elapsed = r.currentTime }
        guard phase == .recording else { return }
        r.updateMeters()
        // The peak amplitude (0…1), boosted so speech fills the meter (the web's `peak * 1.8`).
        let peak = pow(10, Double(r.peakPower(forChannel: 0)) / 20)
        levels.removeFirst()
        levels.append(min(1, max(0, peak * 1.8)))
    }

    func pause() {
        guard phase == .recording else { return }
        recorder?.pause()
        phase = .paused
    }

    func resume() {
        guard phase == .paused, let r = recorder, r.currentTime < AudioProps.maxSeconds else { return }
        r.record()
        phase = .recording
    }

    /// Stops and returns the finished file and its length, or nil when nothing was recorded.
    func finish() -> (url: URL, duration: Double)? {
        guard let r = recorder else { return nil }
        phase = .saving
        let duration = max(elapsed, r.currentTime)
        r.stop()
        timer?.invalidate()
        recorder = nil
        guard duration > 0.3 else { discard(); return nil }
        return (url, duration)
    }

    func discard() {
        recorder?.stop()
        recorder?.deleteRecording()
        recorder = nil
        timer?.invalidate()
        try? FileManager.default.removeItem(at: url)
    }
}

/// The "Audio recording" panel, as on the web (AudioRecorder.tsx in a 320pt popover): live state, the
/// time of one hour, a level meter, Pause or Resume, Stop and save, and Cancel. Nothing is kept until
/// Stop and save. Escape only closes before anything is recorded, so a stray key can't throw a
/// recording away.
struct AudioRecorderSheet: View {
    @Bindable var model: EditorModel
    @State private var recorder = AudioRecorderModel()
    @State private var saved = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if case .error(let message) = recorder.phase {
                Text(message)
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(FoleviColor.destructiveSoft))
                    .accessibilityAddTraits(.isStaticText)
            } else {
                meter
            }
            if recorder.isLive || recorder.phase == .saving {
                HStack(spacing: 8) {
                    if recorder.phase == .paused {
                        Button { recorder.resume() } label: { iconTitle("play", "Resume", iconSize: 12) }
                            .buttonStyle(.folevi(.secondary, .medium))
                    } else {
                        Button { recorder.pause() } label: { iconTitle("pause", "Pause", iconSize: 12) }
                            .buttonStyle(.folevi(.secondary, .medium))
                            .disabled(recorder.phase != .recording)
                    }
                    Spacer(minLength: 0)
                    Button { save() } label: { iconTitle("stop.fill", "Stop and save", iconSize: 10) }
                        .buttonStyle(.folevi(.primary, .medium))
                        .disabled(recorder.phase == .saving)
                }
            }
            if recorder.isLive {
                Text("The recording is added to this note when you save. It counts towards your storage.")
                    .font(.ui(12))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.ui(14))
        .padding(16)
        .frame(width: 320)
        .background(FoleviColor.surface)
        .task {
            recorder.onLimit = { save() }
            await recorder.start()
        }
        .onExitCommand {
            if !recorder.isLive && recorder.phase != .saving { cancel() }
        }
        .onDisappear {
            // Closing without Stop and save discards the recording.
            if !saved { recorder.discard() }
        }
        .interactiveDismissDisabled(recorder.isLive)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Audio recording"))
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "mic")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(recorder.phase == .recording ? recordingRed : FoleviColor.inkMuted)
                .frame(width: 32, height: 32)
                .background(Circle().fill(recorder.phase == .recording ? recordingRed.opacity(0.16) : FoleviColor.surfaceSunken))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.ui(14, .medium)).foregroundStyle(FoleviColor.heading)
                if recorder.isLive || recorder.phase == .saving {
                    (Text(formatDuration(recorder.elapsed))
                        + Text(" / \(formatDuration(AudioProps.maxSeconds))").foregroundColor(FoleviColor.inkFaint))
                        .font(.ui(12).monospacedDigit())
                        .foregroundStyle(FoleviColor.inkMuted)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button { cancel() } label: {
                Image(systemName: "xmark").font(.system(size: 13, weight: .medium))
            }
            .buttonStyle(AudioSquareButtonStyle())
            .help(Text(recorder.isLive ? "Cancel" : "Close"))
            .accessibilityLabel(Text(recorder.isLive ? "Cancel and discard the recording" : "Close"))
        }
    }

    /// The level meter: 36 bars, red while recording, filling the 40pt well from 8%.
    private var meter: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(recorder.levels.indices, id: \.self) { i in
                Capsule()
                    .fill(recorder.phase == .recording ? recordingRed : FoleviColor.lineStrong)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40 * max(0.08, recorder.levels[i]))
            }
        }
        .animation(.linear(duration: 0.075), value: recorder.levels)
        .frame(height: 40)
        .padding(.horizontal, 10)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(FoleviColor.surfaceSunken))
        .accessibilityHidden(true)
    }

    private func iconTitle(_ icon: String, _ title: LocalizedStringKey, iconSize: CGFloat) -> some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: iconSize, weight: .semibold)).accessibilityHidden(true)
            Text(title).font(.ui(13, .semibold))
        }
    }

    private var title: LocalizedStringKey {
        switch recorder.phase {
        case .asking: return "Waiting for the microphone…"
        case .paused: return "Paused"
        case .saving: return "Saving…"
        case .error: return "Can’t record"
        case .recording: return "Recording"
        }
    }

    private func save() {
        guard !saved else { return }
        guard let target = model.recordingTarget else { return dismiss() }
        saved = true
        if let (url, duration) = recorder.finish() {
            model.insertAudio(url, duration: duration, after: target.blockId, replacing: target.replace)
        }
        model.recordingTarget = nil
        dismiss()
    }

    private func cancel() {
        recorder.discard()
        model.recordingTarget = nil
        dismiss()
    }
}

// MARK: - Player

/// The player for an audio recording, as on the web (AudioPlayer.tsx): play or pause, a seek bar with the
/// time, the size and upload state, 1×/1.5×/2× and Download. Works offline once the file is on this Mac
/// (just recorded, or downloaded before).
struct AudioBlockView: View {
    let block: Block
    let props: AudioProps
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var player: AVPlayer?
    @State private var observer: Any?
    @State private var playing = false
    @State private var time: Double = 0
    @State private var speed: Float = 1
    @State private var loading = false
    @State private var unavailable = false
    @State private var problem = false
    @State private var mediaLength: Double?

    private static let speeds: [Float] = [1, 1.5, 2]

    var body: some View {
        HStack(spacing: 12) {
            playButton
            VStack(alignment: .leading, spacing: 0) {
                Text(props.name.isEmpty ? String(localized: "Audio recording") : props.name)
                    .font(.ui(14, .medium))
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                HStack(spacing: 10) {
                    AudioSeekBar(progress: length > 0 ? min(1, time / length) : 0, enabled: !unavailable) { fraction in
                        seek(to: fraction * length)
                    } onStep: { step in
                        seek(to: time + step)
                    } onEdge: { end in
                        seek(to: end ? length : 0)
                    }
                    .frame(height: 16)
                    .accessibilityElement()
                    .accessibilityLabel(Text("Position"))
                    .accessibilityValue(Text("\(formatDuration(time)) of \(formatDuration(length))"))
                    .accessibilityAdjustableAction { d in seek(to: time + (d == .increment ? 5 : -5)) }
                    Text("\(formatDuration(time)) / \(formatDuration(length))")
                        .font(.ui(12).monospacedDigit())
                        .foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize()
                }
                .padding(.top, 6)
                if !statusLine.isEmpty {
                    Text(statusLine)
                        .font(.ui(12))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .lineLimit(1)
                        .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                let next = Self.speeds[((Self.speeds.firstIndex(of: speed) ?? 0) + 1) % Self.speeds.count]
                speed = next
                if playing { player?.rate = next }
            } label: {
                Text("\(speedText)×").font(.ui(12, .semibold).monospacedDigit())
            }
            .buttonStyle(AudioSquareButtonStyle(minWidth: 44))
            .help(Text("Playback speed"))
            .accessibilityLabel(Text("Playback speed \(speedText) times"))
            if !props.fileId.isEmpty {
                Button { Task { await download() } } label: {
                    Image(systemName: "tray.and.arrow.down").font(.system(size: 14, weight: .medium))
                }
                .buttonStyle(AudioSquareButtonStyle())
                .help(Text("Download"))
                .accessibilityLabel(Text("Download"))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .foleviSurface(.color(model.sheetPalette?.surface ?? FoleviColor.surface), shape: .rounded(10), shadow: FoleviShadow.card)
        .contentShape(Rectangle())
        .onTapGesture { model.select(block.id, extend: false) }
        .richAtomOutline(model.selectedBlockIds.contains(block.id), accent: model.documentAccent)
        .padding(.vertical, 6)
        .onDisappear { stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Audio recording \(props.name)"))
    }

    private var playButton: some View {
        Button { Task { await toggle() } } label: {
            Group {
                if loading {
                    ProgressView().controlSize(.small).tint(FoleviColor.canvas)
                } else {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .offset(x: playing ? 0 : 1)
                }
            }
            .foregroundStyle(FoleviColor.canvas)
            .frame(width: 36, height: 36)
            .background(Circle().fill(FoleviColor.heading))
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(unavailable)
        .opacity(unavailable ? 0.4 : 1)
        .accessibilityLabel(Text(playing ? "Pause" : "Play"))
    }

    private var speedText: String { speed == 1.5 ? "1.5" : "\(Int(speed))" }

    /// The length measured while recording wins (recordings often report an unknown length), then the file's.
    private var length: Double {
        if props.duration > 0 { return props.duration }
        return mediaLength ?? 0
    }

    /// "48 KB · Uploading…", or the size and why the recording can't play.
    private var statusLine: String {
        let size = props.size > 0 ? formatBytes(props.size) : ""
        let status: String?
        if props.fileId.isEmpty {
            status = app.sync.isOnline ? String(localized: "Uploading…") : String(localized: "Waiting to upload (offline)")
        } else if unavailable {
            status = String(localized: "This recording isn’t on this Mac yet. Connect to play it.")
        } else if problem {
            status = String(localized: "This recording can’t play on this Mac. Download it instead.")
        } else {
            status = nil
        }
        guard let status else { return size }
        return size.isEmpty ? " · \(status)" : "\(size) · \(status)"
    }

    private func prepare() async -> AVPlayer? {
        if let player { return player }
        loading = true
        defer { loading = false }
        guard let url = await AttachmentLoader.shared.localURL(block: block, app: app) else {
            unavailable = true
            return nil
        }
        unavailable = false
        let p = AVPlayer(url: url)
        observer = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.2, preferredTimescale: 600), queue: .main) { t in
            MainActor.assumeIsolated {
                time = t.seconds.isFinite ? t.seconds : 0
                guard let item = p.currentItem else { return }
                if item.status == .failed { problem = true }
                if item.duration.isNumeric, item.duration.seconds.isFinite, item.duration.seconds > 0 {
                    mediaLength = item.duration.seconds
                    // Ended: stop, leaving the position at the end (playing again starts over).
                    if t >= item.duration { playing = false }
                }
            }
        }
        player = p
        return p
    }

    private func toggle() async {
        guard let p = await prepare() else { return }
        if playing {
            p.pause()
            playing = false
        } else {
            if let item = p.currentItem, item.duration.isNumeric, p.currentTime() >= item.duration {
                await p.seek(to: .zero)
            }
            p.playImmediately(atRate: speed)
            playing = true
        }
    }

    private func seek(to seconds: Double) {
        guard length > 0 else { return }
        let s = max(0, min(length, seconds))
        time = s
        Task {
            guard let p = await prepare() else { return }
            await p.seek(to: CMTime(seconds: s, preferredTimescale: 600))
        }
    }

    private func stop() {
        player?.pause()
        if let observer { player?.removeTimeObserver(observer) }
        observer = nil
        player = nil
        playing = false
    }

    /// Download: saves the recording where the person chooses (the web's download link).
    private func download() async {
        guard let url = await AttachmentLoader.shared.localURL(block: block, app: app) else {
            app.showToast(String(localized: "This recording isn’t on this Mac yet. Connect to download it."))
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = props.name
        panel.begin { response in
            guard response == .OK, let dest = panel.url else { return }
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.copyItem(at: url, to: dest)
        }
    }
}

/// The seek bar: a 4pt line-strong track with the played part in heading colour and a 12pt knob (ringed
/// in the surface colour) on hover or focus. Click or drag to seek; with focus, the arrow keys move 5
/// seconds and Home / End jump to the ends.
private struct AudioSeekBar: View {
    var progress: Double
    var enabled: Bool
    var onSeek: (Double) -> Void
    var onStep: (Double) -> Void
    var onEdge: (Bool) -> Void
    @State private var hover = false
    @FocusState private var focused: Bool

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(FoleviColor.lineStrong).frame(height: 4)
                Capsule().fill(FoleviColor.heading).frame(width: geo.size.width * progress, height: 4)
                Circle().fill(FoleviColor.heading)
                    .frame(width: 12, height: 12)
                    .background(Circle().fill(FoleviColor.surface).padding(-2))
                    .offset(x: geo.size.width * progress - 6)
                    .opacity(hover || focused ? 1 : 0)
                    .animation(.easeOut(duration: 0.15), value: hover || focused)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                guard enabled else { return }
                onSeek(max(0, min(1, v.location.x / max(1, geo.size.width))))
            })
            .onHover { hover = $0 }
        }
        .overlay {
            if focused { Capsule().strokeBorder(FoleviColor.focus, lineWidth: 2) }
        }
        .focusable(enabled)
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .home, .end]) { press in
            switch press.key {
            case .rightArrow, .upArrow: onStep(5)
            case .leftArrow, .downArrow: onStep(-5)
            case .home: onEdge(false)
            default: onEdge(true)
            }
            return .handled
        }
    }
}
