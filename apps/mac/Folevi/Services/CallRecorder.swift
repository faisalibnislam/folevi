// Recording a call (the "/Audio recording" panel's Call choice, apps/web/src/lib/callCapture.ts): the microphone and
// everything this Mac plays, mixed here into one recording that the page then keeps like any other. Electron
// answered getDisplayMedia with the screen and its "loopback" sound and the page mixed it with the microphone;
// WebKit has no system sound in getDisplayMedia, so this does the whole thing natively:
// - this Mac's sound from ScreenCaptureKit (audio only, Folevi's own sound left out; the picture is never kept),
//   which needs Screen & System Audio Recording permission (macOS asks the first time);
// - the microphone from AVAudioEngine (the Microphone permission);
// - both turned into one mono stream at 48 kHz (AudioMix), written as AAC to an .m4a file in the temporary folder,
//   handed to the page once on stop (through app://folevi/_bridge/<id>), then deleted.
// One recording at a time, owned by the page that started it; a page that loads again stops its recording first.
import AVFoundation
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

/// Two sources (0: the microphone, 1: this Mac's sound) of mono samples at one rate, mixed into one. Samples from
/// both are added together as they line up; a source that runs more than `maxLag` samples ahead of a quiet one
/// (no microphone, or nothing playing) goes out on its own, so neither holds the other up for long. Sums are kept
/// within -1 to 1.
final class AudioMix {
    enum Source: Int { case microphone = 0, system = 1 }

    let maxLag: Int
    private var queues: [[Float]] = [[], []]

    init(maxLag: Int) {
        self.maxLag = max(0, maxLag)
    }

    /// Samples waiting from each source.
    var waiting: (microphone: Int, system: Int) { (queues[0].count, queues[1].count) }

    /// Adds samples from one source; returns what's ready to write (possibly nothing).
    func push(_ samples: [Float], from source: Source) -> [Float] {
        queues[source.rawValue].append(contentsOf: samples)
        return drain(flush: false)
    }

    /// What's ready; with `flush`, everything (the end of a recording).
    func drain(flush: Bool) -> [Float] {
        let both = min(queues[0].count, queues[1].count)
        var out = [Float](repeating: 0, count: both)
        for i in 0..<both { out[i] = Self.clamp(queues[0][i] + queues[1][i]) }
        if both > 0 {
            queues[0].removeFirst(both)
            queues[1].removeFirst(both)
        }
        for s in 0..<2 {
            let alone = flush ? queues[s].count : queues[s].count - maxLag
            guard alone > 0 else { continue }
            out.append(contentsOf: queues[s].prefix(alone).map(Self.clamp))
            queues[s].removeFirst(alone)
        }
        return out
    }

    /// Drops what's waiting (a pause: nothing from before it goes out after it).
    func reset() {
        queues = [[], []]
    }

    static func clamp(_ v: Float) -> Float { min(1, max(-1, v)) }
}

/// Mono Float32 samples at the recording's rate from any PCM buffer (a microphone's, ScreenCaptureKit's).
final class MonoConverter {
    let output: AVAudioFormat
    private var converter: AVAudioConverter?
    private var input: AVAudioFormat?

    init(rate: Double) {
        output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)!
    }

    func samples(_ buffer: AVAudioPCMBuffer) -> [Float] {
        let format = buffer.format
        guard buffer.frameLength > 0 else { return [] }
        // Already right: copied as it is.
        if format.commonFormat == .pcmFormatFloat32, format.sampleRate == output.sampleRate, format.channelCount == 1, let data = buffer.floatChannelData {
            return Array(UnsafeBufferPointer(start: data[0], count: Int(buffer.frameLength)))
        }
        if input != format || converter == nil {
            input = format
            converter = AVAudioConverter(from: format, to: output)
            converter?.downmix = true
        }
        guard let converter else { return [] }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * output.sampleRate / format.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else { return [] }
        var given = false
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, inputStatus in
            if given {
                inputStatus.pointee = .noDataNow
                return nil
            }
            given = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, let data = out.floatChannelData else { return [] }
        return Array(UnsafeBufferPointer(start: data[0], count: Int(out.frameLength)))
    }
}

/// Writes mono samples to an AAC .m4a file and keeps the loudest sample since it was last asked (the level meter).
final class RecordingFile {
    static let bitRate = 64_000
    let url: URL
    let format: AVAudioFormat
    private var file: AVAudioFile?
    private(set) var frames: Int64 = 0
    private var peak: Float = 0

    init(url: URL, rate: Double) throws {
        self.url = url
        format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)!
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: rate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: Self.bitRate,
        ]
        file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func write(_ samples: [Float]) throws {
        guard let file, !samples.isEmpty, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)), let data = buffer.floatChannelData else { return }
        samples.withUnsafeBufferPointer { src in data[0].update(from: src.baseAddress!, count: samples.count) }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        try file.write(from: buffer)
        frames += Int64(samples.count)
        for s in samples { peak = max(peak, abs(s)) }
    }

    /// The loudest sample since the last time, 0 to 1.
    func takePeak() -> Float {
        defer { peak = 0 }
        return peak
    }

    var seconds: Double { Double(frames) / format.sampleRate }

    /// Finishes the file (AVAudioFile writes its last packets and header when it goes).
    func close() {
        file = nil
    }
}

/// One recording: the stream of this Mac's sound, the microphone, the mix and the file. Everything after start
/// runs on `queue`.
final class CallSession: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    static let rate: Double = 48_000

    let queue = DispatchQueue(label: "com.folevi.mac.call-recording", qos: .userInitiated)
    let file: RecordingFile
    private let mix = AudioMix(maxLag: Int(CallSession.rate / 4))
    private let micConverter = MonoConverter(rate: CallSession.rate)
    private let systemConverter = MonoConverter(rate: CallSession.rate)
    private let engine = AVAudioEngine()
    private var stream: SCStream?
    private var paused = false
    private var ended = false
    private var sinceLevel = 0
    /// Called on the main thread: the level (0 to 1) about 12 times a second, and once if the recording ends on
    /// its own (sharing stopped, the microphone went away).
    var onLevel: (@MainActor (Double) -> Void)?
    var onEnded: (@MainActor (String) -> Void)?

    init(url: URL) throws {
        file = try RecordingFile(url: url, rate: Self.rate)
    }

    /// Starts both sources: the microphone (if it can't start, nothing does) and this Mac's sound.
    func start(display: SCDisplay) async throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw BridgeError(code: "microphone", message: "No microphone was found. Connect one and try again.") }
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self, let copy = Self.copy(buffer) else { return }
            self.queue.async { self.take(copy, from: .microphone) }
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw BridgeError(code: "microphone", message: "Another app is using your microphone. Close it and try again.")
        }

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = Int(Self.rate)
        config.channelCount = 1
        // The picture is never used: as small and as rare as ScreenCaptureKit allows.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.showsCursor = false
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            try await stream.startCapture()
        } catch {
            engine.stop()
            input.removeTap(onBus: 0)
            throw BridgeError(code: "permission", message: "Folevi needs Screen & System Audio Recording permission to hear the call.")
        }
        self.stream = stream
    }

    func setPaused(_ value: Bool) {
        queue.async {
            self.paused = value
            self.mix.reset()
        }
    }

    /// Stops both sources and finishes the file.
    func finish() async {
        if let stream { try? await stream.stopCapture() }
        stream = nil
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        queue.sync {
            self.ended = true
            if !self.paused { try? self.file.write(self.mix.drain(flush: true)) }
            self.file.close()
        }
    }

    // MARK: samples (on `queue`)

    private func take(_ buffer: AVAudioPCMBuffer, from source: AudioMix.Source) {
        guard !paused, !ended else { return }
        let samples = (source == .microphone ? micConverter : systemConverter).samples(buffer)
        let ready = mix.push(samples, from: source)
        guard !ready.isEmpty else { return }
        do {
            try file.write(ready)
        } catch {
            end("write")
            return
        }
        sinceLevel += ready.count
        if sinceLevel >= Int(Self.rate) / 12 {
            sinceLevel = 0
            let level = Double(min(1, file.takePeak() * 1.8))
            let cb = onLevel
            DispatchQueue.main.async { MainActor.assumeIsolated { cb?(level) } }
        }
    }

    private func end(_ reason: String) {
        guard !ended else { return }
        ended = true
        let cb = onEnded
        DispatchQueue.main.async { MainActor.assumeIsolated { cb?(reason) } }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid, let buffer = Self.pcm(sampleBuffer) else { return }
        take(buffer, from: .system)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async { self.end("sharing") }
    }

    // MARK: buffers

    /// The tap's buffer is reused by the engine: a copy goes to the queue.
    static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let out = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
        out.frameLength = buffer.frameLength
        let src = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffer.audioBufferList))
        let dst = UnsafeMutableAudioBufferListPointer(out.mutableAudioBufferList)
        for (s, d) in zip(src, dst) {
            guard let from = s.mData, let to = d.mData else { continue }
            memcpy(to, from, Int(min(s.mDataByteSize, d.mDataByteSize)))
        }
        return out
    }

    /// ScreenCaptureKit's audio as a PCM buffer (copied out of the sample buffer).
    static func pcm(_ sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let description = sampleBuffer.formatDescription, let asbd = description.audioStreamBasicDescription else { return nil }
        var stream = asbd
        guard let format = AVAudioFormat(streamDescription: &stream) else { return nil }
        let frames = AVAudioFrameCount(sampleBuffer.numSamples)
        guard frames > 0, let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        out.frameLength = frames
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(sampleBuffer, at: 0, frameCount: Int32(frames), into: out.mutableAudioBufferList)
        return status == noErr ? out : nil
    }
}

@MainActor
final class CallRecorder {
    static let shared = CallRecorder()

    private var session: CallSession?
    private weak var owner: FoleviWebView?

    var recording: Bool { session != nil }

    /// Whether macOS lets Folevi record the screen and its sound ("granted" once allowed and Folevi restarted).
    static func screenAccess() -> String {
        CGPreflightScreenCaptureAccess() ? "granted" : "denied"
    }

    static let folder: URL = {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Folevi recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    func start(for view: FoleviWebView) async throws {
        if session != nil {
            if let owner, owner !== view { throw BridgeError(code: "busy", message: "Folevi is already recording a call in another window.") }
            await cancel(for: view)
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .audio) else { throw Self.micRefused }
        default: throw Self.micRefused
        }
        // Asking what can be shared is what makes macOS ask for Screen & System Audio Recording the first time.
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            throw BridgeError(code: "permission", message: "Folevi needs Screen & System Audio Recording permission to hear the call.")
        }
        guard let display = content.displays.first else { throw BridgeError(code: "failed", message: "The call's sound couldn't be recorded.") }
        let url = Self.folder.appendingPathComponent("\(UUID().uuidString).m4a")
        let session: CallSession
        do {
            session = try CallSession(url: url)
        } catch {
            throw BridgeError(code: "failed", message: "The call's sound couldn't be recorded.")
        }
        session.onLevel = { [weak view] level in view?.events.emit("FoleviDesktop", "callLevel", ["level": level]) }
        session.onEnded = { [weak view] reason in view?.events.emit("FoleviDesktop", "callEnded", ["reason": reason]) }
        try await session.start(display: display)
        self.session = session
        owner = view
    }

    func pause(for view: FoleviWebView) {
        guard owner === view else { return }
        session?.setPaused(true)
    }

    func resume(for view: FoleviWebView) {
        guard owner === view else { return }
        session?.setPaused(false)
    }

    /// Stops and hands the recording to the page: { file: <bridge id>, mime, seconds, size }.
    func stop(for view: FoleviWebView) async throws -> [String: Any] {
        guard let session, owner === view else { throw BridgeError(code: "not_found", message: "Nothing is being recorded.") }
        self.session = nil
        owner = nil
        await session.finish()
        let url = session.file.url
        defer { try? FileManager.default.removeItem(at: url) }
        guard let data = try? Data(contentsOf: url), !data.isEmpty else { throw BridgeError(code: "io", message: "The recording couldn't be read.") }
        let id = BridgeBodies.shared.putReply(data)
        return ["file": id, "mime": "audio/mp4", "seconds": session.file.seconds, "size": data.count]
    }

    /// Stops and throws the recording away.
    func cancel(for view: FoleviWebView) async {
        guard let session, owner == nil || owner === view else { return }
        self.session = nil
        owner = nil
        await session.finish()
        try? FileManager.default.removeItem(at: session.file.url)
    }

    private static let micRefused = BridgeError(code: "microphone", message: "Folevi can't use your microphone. Allow it in System Settings > Privacy & Security > Microphone, then try again.")
}
