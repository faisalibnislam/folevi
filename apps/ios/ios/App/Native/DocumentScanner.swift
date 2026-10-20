// Scan document (the editor's Insert menu and slash menu, in the app only): the camera's document scanner
// (VisionKit, on devices that have one) or pages picked from Photos (always, and the way to try it in the
// Simulator, which has no scanner). Each page comes back as a JPEG of a reasonable size, and the text read
// from all of them (Vision), for the page to insert as images and a closed "Text from the scan" toggle.
import PhotosUI
import UIKit
import Vision
import VisionKit

@MainActor
final class DocumentScanner: NSObject {
    struct Page {
        let name: String
        let jpeg: Data
    }

    struct Result {
        let pages: [Page]
        let text: String
    }

    /// The longest side of a page as kept, and its JPEG quality: sharp enough to read, small enough to upload.
    nonisolated static let maxSide: CGFloat = 2200
    nonisolated static let quality: CGFloat = 0.72
    nonisolated static let maxPages = 10

    static var cameraAvailable: Bool { VNDocumentCameraViewController.isSupported }

    private var continuation: CheckedContinuation<[UIImage]?, Never>?
    private static var running: DocumentScanner?

    /// Presents the scanner (or the photo picker) over `presenter`; nil when cancelled.
    static func scan(source: String, from presenter: UIViewController) async -> Result? {
        guard running == nil else { return nil }
        let scanner = DocumentScanner()
        running = scanner
        defer { running = nil }
        let images: [UIImage]? = await withCheckedContinuation { done in
            scanner.continuation = done
            if source == "camera", cameraAvailable {
                let camera = VNDocumentCameraViewController()
                camera.delegate = scanner
                presenter.present(camera, animated: true)
            } else {
                var config = PHPickerConfiguration()
                config.filter = .images
                config.selectionLimit = maxPages
                config.selection = .ordered
                let picker = PHPickerViewController(configuration: config)
                picker.delegate = scanner
                presenter.present(picker, animated: true)
            }
        }
        guard let images, !images.isEmpty else { return nil }
        return await Task.detached(priority: .userInitiated) { process(images) }.value
    }

    private func finish(_ images: [UIImage]?) {
        continuation?.resume(returning: images)
        continuation = nil
    }

    /// Pages as JPEGs, and their text in order (a blank line between pages).
    nonisolated static func process(_ images: [UIImage]) -> Result {
        var pages: [Page] = []
        var texts: [String] = []
        for (i, image) in images.prefix(maxPages).enumerated() {
            let page = resized(image)
            guard let jpeg = page.jpegData(compressionQuality: quality) else { continue }
            pages.append(Page(name: "Scan \(i + 1).jpg", jpeg: jpeg))
            let text = recognizeText(page)
            if !text.isEmpty { texts.append(text) }
        }
        return Result(pages: pages, text: texts.joined(separator: "\n\n"))
    }

    nonisolated static func resized(_ image: UIImage, maxSide: CGFloat = DocumentScanner.maxSide) -> UIImage {
        let size = image.size
        let scale = min(1, maxSide / max(size.width, size.height, 1))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
    }

    /// The page's text, line by line (Vision's accurate recogniser, with language correction).
    nonisolated static func recognizeText(_ image: UIImage) -> String {
        guard let cg = image.cgImage else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.automaticallyDetectsLanguage = true
        let handler = VNImageRequestHandler(cgImage: cg, orientation: .up)
        guard (try? handler.perform([request])) != nil, let lines = request.results else { return "" }
        return lines.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }
}

extension DocumentScanner: VNDocumentCameraViewControllerDelegate {
    nonisolated func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let images = (0 ..< min(scan.pageCount, Self.maxPages)).map { scan.imageOfPage(at: $0) }
        Task { @MainActor in
            controller.dismiss(animated: true)
            self.finish(images)
        }
    }

    nonisolated func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        Task { @MainActor in
            controller.dismiss(animated: true)
            self.finish(nil)
        }
    }

    nonisolated func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        Task { @MainActor in
            controller.dismiss(animated: true)
            self.finish(nil)
        }
    }
}

extension DocumentScanner: PHPickerViewControllerDelegate {
    nonisolated func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        Task { @MainActor in
            picker.dismiss(animated: true)
            var images: [UIImage] = []
            for result in results where result.itemProvider.canLoadObject(ofClass: UIImage.self) {
                let image: UIImage? = await withCheckedContinuation { done in
                    result.itemProvider.loadObject(ofClass: UIImage.self) { object, _ in done.resume(returning: object as? UIImage) }
                }
                if let image { images.append(image) }
            }
            self.finish(images.isEmpty ? nil : images)
        }
    }
}
