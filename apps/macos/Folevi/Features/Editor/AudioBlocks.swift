import AVFoundation
import SwiftUI

// MARK: - Recorder

/// Records from the microphone into an AAC file (MP4 audio, one of the formats the server accepts), with
/// pause, resume, a level meter and the one-hour cap.
@MainActor
@Observable
final class AudioRecorderModel {
    enum Phase: Equatable { case asking, recording, paused, saving, error(String) }

    var phase: Phase = .asking
    var elapsed: Double = 0
    /// Recent input levels, 0…1, oldest first.
    var levels: [Double] = Array(repeating: 0, count: 32)

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private let url = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-recording-\(UUID().uuidString).m4a")

    var isLive: Bool { phase == .recording || phase == .paused }

    func start() async {
        let granted: Bool
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: granted = true
        case .notDetermined: granted = await AVCaptureDevice.requestAccess(for: .audio)
        default: granted = false
        }
        guard granted else {
            phase = .error(String(localized: "Folevi can't use the microphone. Allow it in System Settings › Privacy & Security › Microphone."))
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
            phase = .error(String(localized: "Recording couldn't start. Check that a microphone is connected."))
        }
    }

    private func tick() {
        guard let r = recorder else { return }
        if phase == .recording, !r.isRecording {
            // Reached the hour: stop as if Save was pressed.
            phase = .paused
            return
        }
        elapsed = r.currentTime > 0 ? r.currentTime : elapsed
        guard phase == .recording else { return }
        r.updateMeters()
        let db = Double(r.averagePower(forChannel: 0))
        let level = max(0, min(1, (db + 50) / 50))
        levels.removeFirst()
        levels.append(level)
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

/// The recorder sheet ("/record"): live state, elapsed of one hour, a level meter, Pause or Resume, Save
/// and Cancel. Escape only closes before anything is recorded, so a stray key can't throw a recording away.
struct AudioRecorderSheet: View {
    @Bindable var model: EditorModel
    @State private var recorder = AudioRecorderModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(recorder.phase == .recording ? Color.red : FoleviColor.inkMuted)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(recorder.phase == .recording ? Color.red.opacity(0.14) : FoleviColor.surfaceSunken))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.heading)
                    if recorder.isLive || recorder.phase == .saving {
                        (Text(AudioProps.format(recorder.elapsed)) + Text(" / \(AudioProps.format(AudioProps.maxSeconds))").foregroundColor(FoleviColor.inkFaint))
                            .font(.ui(12).monospacedDigit()).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
                Spacer()
                IconButton(systemImage: "xmark", label: recorder.isLive ? "Cancel and discard the recording" : "Close", size: 28) { cancel() }
            }
            if case .error(let message) = recorder.phase {
                Text(message).font(.ui(12.5)).foregroundStyle(FoleviColor.destructive)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(FoleviColor.destructive.opacity(0.08)))
            } else {
                HStack(alignment: .center, spacing: 3) {
                    ForEach(recorder.levels.indices, id: \.self) { i in
                        Capsule()
                            .fill(recorder.phase == .recording ? Color.red : FoleviColor.line)
                            .frame(maxWidth: .infinity)
                            .frame(height: max(3, 30 * recorder.levels[i]))
                    }
                }
                .frame(height: 40)
                .padding(.horizontal, 10)
                .background(RoundedRectangle(cornerRadius: 8).fill(FoleviColor.surfaceSunken))
                .accessibilityHidden(true)
            }
            if recorder.isLive || recorder.phase == .saving {
                HStack(spacing: 8) {
                    if recorder.phase == .paused {
                        Button { recorder.resume() } label: { Label("Resume", systemImage: "play.fill") }.buttonStyle(.folevi(.secondary, .medium))
                    } else {
                        Button { recorder.pause() } label: { Label("Pause", systemImage: "pause.fill") }.buttonStyle(.folevi(.secondary, .medium))
                            .disabled(recorder.phase != .recording)
                    }
                    Spacer()
                    Button("Save recording") { save() }.buttonStyle(.folevi(.primary, .medium)).keyboardShortcut(.defaultAction)
                        .disabled(recorder.phase == .saving)
                }
            }
        }
        .padding(18)
        .frame(width: 380)
        .task { await recorder.start() }
        .onExitCommand { if !recorder.isLive { cancel() } }
        .interactiveDismissDisabled(recorder.isLive)
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
        guard let target = model.recordingTarget else { return dismiss() }
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

/// Plays a recording: play or pause, a seek bar, the time, the size, 1×/1.5×/2× and Save As. Works offline
/// once the file is on this Mac (just recorded, or downloaded before).
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

    private static let speeds: [Float] = [1, 1.5, 2]

    var body: some View {
        HStack(spacing: 12) {
            Button { Task { await toggle() } } label: {
                Group {
                    if loading { ProgressView().controlSize(.small).tint(FoleviColor.canvas) }
                    else { Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: 13)).offset(x: playing ? 0 : 1) }
                }
                .foregroundStyle(FoleviColor.canvas)
                .frame(width: 36, height: 36)
                .background(Circle().fill(FoleviColor.heading))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(playing ? "Pause" : "Play"))
            VStack(alignment: .leading, spacing: 5) {
                Text(props.name).font(.ui(13, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                HStack(spacing: 10) {
                    SeekBar(progress: length > 0 ? min(1, time / length) : 0) { seek(to: $0 * length) }
                        .frame(height: 14)
                        .accessibilityElement()
                        .accessibilityLabel(Text("Position"))
                        .accessibilityValue(Text("\(AudioProps.format(time)) of \(AudioProps.format(length))"))
                        .accessibilityAdjustableAction { d in seek(to: time + (d == .increment ? 5 : -5)) }
                    Text("\(AudioProps.format(time)) / \(AudioProps.format(length))").font(.ui(11.5).monospacedDigit()).foregroundStyle(FoleviColor.inkMuted)
                }
                Text(status).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
            }
            Button {
                let next = Self.speeds[((Self.speeds.firstIndex(of: speed) ?? 0) + 1) % Self.speeds.count]
                speed = next
                if playing { player?.rate = next }
            } label: {
                Text(speed == 1.5 ? "1.5×" : "\(Int(speed))×").font(.ui(12, .semibold).monospacedDigit()).foregroundStyle(FoleviColor.inkMuted)
                    .frame(minWidth: 40, minHeight: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(Text("Playback speed"))
            .accessibilityLabel(Text("Playback speed \(speed == 1.5 ? "1.5" : "\(Int(speed))") times"))
            IconButton(systemImage: "square.and.arrow.down", label: "Save As…") { Task { await saveAs() } }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(FoleviColor.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(FoleviColor.line))
        .contentShape(Rectangle())
        .onTapGesture { model.select(block.id, extend: false) }
        .onDisappear { stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Audio recording \(props.name)"))
    }

    private var length: Double {
        if let d = player?.currentItem?.duration.seconds, d.isFinite, d > 0 { return d }
        return props.duration
    }

    private var status: String {
        if props.fileId.isEmpty { return String(localized: "Waiting to upload") }
        if unavailable { return String(localized: "This recording isn't on this Mac yet. Connect to play it.") }
        return props.size > 0 ? ByteCountFormatter.string(fromByteCount: Int64(props.size), countStyle: .file) : ""
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
                if let item = p.currentItem, item.duration.isNumeric, t >= item.duration {
                    playing = false
                    p.seek(to: .zero)
                    time = 0
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
            p.playImmediately(atRate: speed)
            playing = true
        }
    }

    private func seek(to seconds: Double) {
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

    private func saveAs() async {
        guard let url = await AttachmentLoader.shared.localURL(block: block, app: app) else {
            app.showToast(String(localized: "This recording isn't on this Mac yet. Connect to download it."))
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

/// A thin track with a filled part and a knob on hover; click or drag to seek.
private struct SeekBar: View {
    var progress: Double
    var onSeek: (Double) -> Void
    @State private var hover = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(FoleviColor.line).frame(height: 4)
                Capsule().fill(FoleviColor.heading).frame(width: geo.size.width * progress, height: 4)
                Circle().fill(FoleviColor.heading).frame(width: 12, height: 12)
                    .offset(x: geo.size.width * progress - 6)
                    .opacity(hover ? 1 : 0)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                onSeek(max(0, min(1, v.location.x / max(1, geo.size.width))))
            })
            .onHover { hover = $0 }
        }
    }
}
