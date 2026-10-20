// folevi-text: the words in an image, read on this Mac with Apple's Vision, for search in files
// (docs/ARCHITECTURE.md, "Search in files"; src/textRecognition.ts). The image's bytes come on stdin; the
// answer goes to stdout as JSON, {"text": "..."} or {"error": "..."}. It reads nothing else, writes nothing
// else and talks to no one: the app runs it for one image at a time and stops it if it takes too long.
import CoreGraphics
import Foundation
import ImageIO
import Vision

/// The most bytes an image may have (the app checks too).
let maxBytes = 25 * 1024 * 1024
/// Images are read at most this large on their longest side (sharp enough for Vision, light on memory).
let maxSide = 3000

func answer(_ object: [String: String]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{\"error\":\"output\"}".utf8)
    FileHandle.standardOutput.write(data)
    exit(object["error"] == nil ? 0 : 1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard !input.isEmpty, input.count <= maxBytes else { answer(["error": "size"]) }
guard let source = CGImageSourceCreateWithData(input as CFData, nil) else { answer(["error": "image"]) }
// A thumbnail at most maxSide wide or tall, turned the way the image says it's shown.
let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: maxSide,
]
guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { answer(["error": "image"]) }

let handwriting = CommandLine.arguments.contains("--handwriting")
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
// Handwriting has fewer dictionary words to lean on: correction helps printed text more than notes.
request.usesLanguageCorrection = !handwriting
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
do {
    try handler.perform([request])
} catch {
    answer(["error": "vision"])
}
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
answer(["text": lines.joined(separator: "\n")])
