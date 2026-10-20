// Search in files (docs/ARCHITECTURE.md, "Search in files"): FoleviNative.recognizeText reads the words in an
// image on the device with Vision, for the page to save as the image's searchable text (lib/fileText). The
// page sends images from the note (photos, screenshots) and whiteboards drawn as images (handwriting). Nothing
// leaves the device. Like every FoleviNative call, it checks the page is Folevi's own first.
import Capacitor
import UIKit
import Vision

enum TextRecognition {
    /// The most bytes an image may have (base64 decoded): a camera photo is a few MB.
    static let maxBytes = 25 * 1024 * 1024
    /// Images are read at most this large on their longest side (sharp enough for Vision, light on memory).
    static let maxSide: CGFloat = 3000

    /// The image's words, line by line in reading order (Vision's accurate recogniser, with language correction).
    static func read(_ image: UIImage, handwriting: Bool) -> String {
        let size = image.size
        let scale = min(1, maxSide / max(size.width, size.height, 1))
        let page = scale < 1 ? DocumentScanner.resized(image, maxSide: maxSide) : image
        guard let cg = page.cgImage else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        // Handwriting has fewer dictionary words to lean on: correction helps printed text more than notes.
        request.usesLanguageCorrection = !handwriting
        request.automaticallyDetectsLanguage = true
        let handler = VNImageRequestHandler(cgImage: cg, orientation: .up)
        guard (try? handler.perform([request])) != nil, let lines = request.results else { return "" }
        return lines.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }
}

extension FoleviNativePlugin {
    /// { data (base64 bytes), type, handwriting? } -> { text }: the words in an image, read on the device.
    @objc func recognizeText(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            guard let base64 = call.getString("data"), base64.count <= TextRecognition.maxBytes / 3 * 4 + 4,
                  let data = Data(base64Encoded: base64), data.count <= TextRecognition.maxBytes
            else { return call.reject("That image can't be read") }
            let handwriting = call.getBool("handwriting") ?? false
            let text = await Task.detached(priority: .utility) { () -> String? in
                guard let image = UIImage(data: data) else { return nil }
                return TextRecognition.read(image, handwriting: handwriting)
            }.value
            guard let text else { return call.reject("That image can't be read") }
            call.resolve(["text": text])
        }
    }
}
