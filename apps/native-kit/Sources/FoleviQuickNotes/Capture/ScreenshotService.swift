import AppKit
import AudioToolbox
import CoreImage
import ScreenCaptureKit

/// Screenshot capture with no Screen Recording permission.
///
/// Verified on macOS 26/27 (see ARCHITECTURE.md): `SCContentSharingPicker` is system-mediated, so
/// a stream built from the filter it returns captures without a TCC prompt. We grab exactly one
/// frame and stop. `/usr/sbin/screencapture -i` is *not* used: launched from a sandboxed app it
/// triggers the Screen Recording prompt. Region capture = pick a display, then select a region
/// on our own overlay drawn over the frozen frame.
@MainActor
final class ScreenshotService: NSObject, SCContentSharingPickerObserver {
    enum Mode: String, CaseIterable, Sendable { case region, window, display }

    private var continuation: CheckedContinuation<FilterBox?, Never>?
    private var grabber: FrameGrabber?
    private var regionWindow: RegionSelectionWindow?
    private var isCapturing = false

    func capture(_ mode: Mode) async -> CGImage? {
        // One capture at a time: a second request would replace the pending picker continuation
        // and leave the first caller suspended forever.
        guard !isCapturing else { return nil }
        isCapturing = true
        defer { isCapturing = false }
        let picker = SCContentSharingPicker.shared
        var config = SCContentSharingPickerConfiguration()
        config.allowedPickerModes = mode == .window ? [.singleWindow] : [.singleDisplay]
        if let id = Bundle.main.bundleIdentifier { config.excludedBundleIDs = [id] }
        picker.defaultConfiguration = config
        picker.add(self)
        picker.isActive = true
        let box: FilterBox? = await withCheckedContinuation { cont in
            continuation = cont
            picker.present(using: mode == .window ? .window : .display)
        }
        picker.remove(self)
        picker.isActive = false
        guard let box else { return nil }
        let contentSize = box.filter.contentRect.size
        guard let frame = await grabFrame(box) else { return nil }
        if mode == .region {
            return await selectRegion(in: frame, contentSize: contentSize)
        }
        return frame
    }

    private func grabFrame(_ box: FilterBox) async -> CGImage? {
        let filter = box.filter
        let config = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        config.width = max(1, Int(filter.contentRect.width * scale))
        config.height = max(1, Int(filter.contentRect.height * scale))
        config.showsCursor = false
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.queueDepth = 3
        let grabber = FrameGrabber()
        self.grabber = grabber
        defer { self.grabber = nil }
        return try? await grabber.grab(box, config: ConfigBox(config: config))
    }

    private func selectRegion(in image: CGImage, contentSize: CGSize) async -> CGImage? {
        let screen = NSScreen.screens.first { $0.frame.size == contentSize && $0.frame.contains(NSEvent.mouseLocation) }
            ?? NSScreen.screens.first { $0.frame.size == contentSize } ?? NSScreen.main
        guard let screen else { return image }
        return await withCheckedContinuation { cont in
            let window = RegionSelectionWindow(screen: screen, image: image) { [weak self] cropped in
                self?.regionWindow?.orderOut(nil)
                self?.regionWindow = nil
                cont.resume(returning: cropped)
            }
            regionWindow = window
            NSApp.activate()
            window.makeKeyAndOrderFront(nil)
        }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        let box = FilterBox(filter: filter)
        Task { @MainActor in
            self.continuation?.resume(returning: box)
            self.continuation = nil
        }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        Task { @MainActor in
            self.continuation?.resume(returning: nil)
            self.continuation = nil
        }
    }

    nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
        Task { @MainActor in
            self.continuation?.resume(returning: nil)
            self.continuation = nil
        }
    }

    /// The system screenshot sound. `AudioServicesPlaySystemSound` honors System Settings ▸
    /// Sound ▸ "Play user interface sound effects".
    nonisolated static func playShutter() {
        let url = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Screen Capture.aif")
        var id: SystemSoundID = 0
        guard AudioServicesCreateSystemSoundID(url as CFURL, &id) == noErr else { return }
        // The completion runs on an AudioToolbox queue, so it must not be main-actor isolated.
        AudioServicesPlaySystemSoundWithCompletion(id, disposeSound(id))
    }

    private nonisolated static func disposeSound(_ id: SystemSoundID) -> @Sendable () -> Void {
        { AudioServicesDisposeSystemSoundID(id) }
    }
}

struct FilterBox: @unchecked Sendable { let filter: SCContentFilter }
struct ConfigBox: @unchecked Sendable { let config: SCStreamConfiguration }

/// Captures a single frame from a stream, then stops it.
final class FrameGrabber: NSObject, SCStreamOutput, @unchecked Sendable {
    private var continuation: CheckedContinuation<CGImage, any Error>?
    private var stream: SCStream?
    private let lock = NSLock()
    private let context = CIContext(options: [.cacheIntermediates: false])

    enum GrabError: Error { case noFrame }

    /// A display that never produces a complete frame must not leave a capture stream running.
    private static let timeout: DispatchTimeInterval = .seconds(5)

    func grab(_ box: FilterBox, config: ConfigBox) async throws -> CGImage {
        let stream = SCStream(filter: box.filter, configuration: config.config, delegate: nil)
        self.stream = stream
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .global(qos: .userInitiated))
        return try await withCheckedThrowingContinuation { cont in
            lock.withLock { continuation = cont }
            stream.startCapture { [weak self] error in
                guard let self, let error else { return }
                self.finish(.failure(error))
            }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + Self.timeout) { [weak self] in
                self?.finish(.failure(GrabError.noFrame))
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let pixels = sampleBuffer.imageBuffer else { return }
        // Skip frames the compositor marks as idle/blank.
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let raw = attachments.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw), status != .complete {
            return
        }
        let image = CIImage(cvPixelBuffer: pixels)
        guard let cg = context.createCGImage(image, from: image.extent) else { return }
        finish(.success(cg))
    }

    private func finish(_ result: Result<CGImage, any Error>) {
        let cont: CheckedContinuation<CGImage, any Error>? = lock.withLock {
            let c = continuation
            continuation = nil
            return c
        }
        guard let cont else { return }
        stream?.stopCapture { _ in }
        cont.resume(with: result)
    }
}

/// Full-screen overlay for choosing a region on a frozen frame: dimmed backdrop, crosshair,
/// live size label, Esc to cancel, Return for the whole display.
final class RegionSelectionWindow: NSWindow {
    private let completion: (CGImage?) -> Void
    private var done = false

    init(screen: NSScreen, image: CGImage, completion: @escaping (CGImage?) -> Void) {
        self.completion = completion
        super.init(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        level = .screenSaver
        isOpaque = true
        backgroundColor = .black
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        ignoresMouseEvents = false
        isReleasedWhenClosed = false
        let view = RegionSelectionView(frame: NSRect(origin: .zero, size: screen.frame.size), image: image)
        view.onDone = { [weak self] in self?.finish($0) }
        contentView = view
        setFrame(screen.frame, display: true)
        makeFirstResponder(view)
    }

    override var canBecomeKey: Bool { true }

    private func finish(_ image: CGImage?) {
        guard !done else { return }
        done = true
        completion(image)
    }
}

final class RegionSelectionView: NSView {
    let image: CGImage
    var onDone: ((CGImage?) -> Void)?
    private var start: NSPoint?
    private var current: NSPoint?

    init(frame: NSRect, image: CGImage) {
        self.image = image
        super.init(frame: frame)
        setAccessibilityLabel(String(localized: "Drag to select a region. Press Escape to cancel, Return for the whole display."))
        setAccessibilityRole(.group)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var acceptsFirstResponder: Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }

    private var selection: NSRect? {
        guard let start, let current else { return nil }
        return NSRect(x: min(start.x, current.x), y: min(start.y, current.y),
                      width: abs(current.x - start.x), height: abs(current.y - start.y)).integral
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.draw(image, in: bounds)
        NSColor.black.withAlphaComponent(0.42).setFill()
        let dim = NSBezierPath(rect: bounds)
        if let sel = selection, sel.width > 0, sel.height > 0 {
            dim.append(NSBezierPath(roundedRect: sel, xRadius: 2, yRadius: 2).reversed)
        }
        dim.fill()
        if let sel = selection, sel.width > 1 {
            NSColor.white.withAlphaComponent(0.9).setStroke()
            let border = NSBezierPath(roundedRect: sel.insetBy(dx: -0.5, dy: -0.5), xRadius: 2, yRadius: 2)
            border.lineWidth = 1
            border.stroke()
            let scale = CGFloat(image.width) / bounds.width
            let label = "\(Int(sel.width * scale)) × \(Int(sel.height * scale))" as NSString
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
                                                        .foregroundColor: NSColor.white]
            let size = label.size(withAttributes: attrs)
            var origin = NSPoint(x: sel.maxX - size.width - 12, y: sel.minY - size.height - 14)
            if origin.y < 8 { origin.y = sel.minY + 8 }
            let pill = NSRect(x: origin.x - 8, y: origin.y - 4, width: size.width + 16, height: size.height + 8)
            NSColor.black.withAlphaComponent(0.6).setFill()
            NSBezierPath(roundedRect: pill, xRadius: pill.height / 2, yRadius: pill.height / 2).fill()
            label.draw(at: origin, withAttributes: attrs)
        } else {
            let hint = String(localized: "Drag to select · Return for whole display · Esc to cancel") as NSString
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor.white]
            let size = hint.size(withAttributes: attrs)
            let pill = NSRect(x: bounds.midX - size.width / 2 - 14, y: bounds.maxY - 90, width: size.width + 28, height: size.height + 14)
            NSColor.black.withAlphaComponent(0.55).setFill()
            NSBezierPath(roundedRect: pill, xRadius: pill.height / 2, yRadius: pill.height / 2).fill()
            hint.draw(at: NSPoint(x: pill.minX + 14, y: pill.minY + 7), withAttributes: attrs)
        }
    }

    override func mouseDown(with event: NSEvent) {
        start = convert(event.locationInWindow, from: nil)
        current = start
        needsDisplay = true   // the hint pill disappears
    }

    override func mouseDragged(with event: NSEvent) {
        let before = selection
        current = convert(event.locationInWindow, from: nil)
        invalidateSelectionChange(from: before, to: selection)
    }

    /// Redraws only around the old and new selection (plus its size label) instead of the whole
    /// display-sized frozen frame on every drag event.
    func invalidateSelectionChange(from old: NSRect?, to new: NSRect?) {
        for rect in [old, new].compactMap({ $0 }) {
            // The size label sits below the selection's trailing edge and can be wider than it.
            setNeedsDisplay(rect.insetBy(dx: -4, dy: -4).union(NSRect(x: rect.maxX - 240, y: rect.minY - 56, width: 244, height: 60)))
        }
    }

    override func mouseUp(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        guard let sel = selection, sel.width >= 4, sel.height >= 4 else {
            start = nil; current = nil; needsDisplay = true
            return
        }
        let scale = CGFloat(image.width) / bounds.width
        // CGImage origin is top-left; view origin is bottom-left.
        let crop = CGRect(x: sel.minX * scale, y: (bounds.height - sel.maxY) * scale, width: sel.width * scale, height: sel.height * scale)
        onDone?(image.cropping(to: crop.integral))
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: onDone?(nil)          // Esc
        case 36, 76: onDone?(image)    // Return / Enter
        default: super.keyDown(with: event)
        }
    }
}
