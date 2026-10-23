// Search in files (docs/ARCHITECTURE.md, "Search in files"): the words in an image, read on this Mac with Apple's
// Vision, for the page to keep as the image's searchable text (lib/fileText/recognizer.ts). Electron ran the
// folevi-text helper (the Electron Mac app's native/recognize-text.swift) for this; here the same request runs in process,
// with the same rules: one image at a time, at most 25 MB, read at most 3000 pixels on its longest side, given up
// after 30 seconds, at most 100,000 characters kept. Nothing leaves the Mac.
import CoreGraphics
import Foundation
import ImageIO
import Vision

actor TextRecognition {
    static let shared = TextRecognition()

    static let maxBytes = 25 * 1024 * 1024
    static let maxSide = 3000
    static let maxText = 100_000
    static let timeout: Duration = .seconds(30)

    /// The image before this one (each waits for the one before, as Electron's oneAtATime).
    private var last: Task<String?, Never>?

    /// The text in the image (lines joined by newlines, possibly empty), or nil when it couldn't be read.
    func recognize(_ data: Data, handwriting: Bool, timeout: Duration = TextRecognition.timeout) async -> String? {
        let before = last
        let task = Task<String?, Never> {
            _ = await before?.value
            return await Self.withTimeout(timeout) { box in Self.read(data, handwriting: handwriting, cancel: box) }
        }
        last = task
        return await task.value
    }

    /// The image as Vision reads it: a thumbnail at most maxSide on its longest side, turned upright.
    static func image(_ data: Data) -> CGImage? {
        guard !data.isEmpty, data.count <= maxBytes, let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxSide,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// One image, synchronously (Vision's own work): what folevi-text did.
    static func read(_ data: Data, handwriting: Bool, cancel: RequestBox? = nil) -> String? {
        guard let image = image(data) else { return nil }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        // Handwriting has fewer dictionary words to lean on: correction helps printed text more than notes.
        request.usesLanguageCorrection = !handwriting
        request.automaticallyDetectsLanguage = true
        cancel?.request = request
        do {
            try VNImageRequestHandler(cgImage: image, orientation: .up).perform([request])
        } catch {
            return nil
        }
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        return String(text.prefix(maxText))
    }

    /// The running request, so a timeout can stop it.
    final class RequestBox: @unchecked Sendable {
        private let lock = NSLock()
        private var _request: VNRequest?
        private var cancelled = false
        var request: VNRequest? {
            get { lock.withLock { _request } }
            set {
                lock.withLock { _request = newValue }
                if lock.withLock({ cancelled }) { newValue?.cancel() }
            }
        }
        func cancel() {
            lock.withLock { cancelled = true }
            request?.cancel()
        }
    }

    /// `work` on a thread of its own, or nil when it takes longer than `limit` (the request is cancelled then,
    /// and whatever it finds afterwards is dropped).
    static func withTimeout(_ limit: Duration, _ work: @escaping @Sendable (RequestBox) -> String?) async -> String? {
        let box = RequestBox()
        let once = Once()
        return await withCheckedContinuation { (cont: CheckedContinuation<String?, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let text = work(box)
                if once.take() { cont.resume(returning: text) }
            }
            Task {
                try? await Task.sleep(for: limit)
                if once.take() {
                    box.cancel()
                    cont.resume(returning: nil)
                }
            }
        }
    }

    /// True the first time only.
    final class Once: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false
        func take() -> Bool { lock.withLock { if done { return false }; done = true; return true } }
    }
}
