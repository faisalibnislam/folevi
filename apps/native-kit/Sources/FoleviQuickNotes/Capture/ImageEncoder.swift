import AppKit
import ImageIO
import UniformTypeIdentifiers

/// Encodes images for storage: PNG, or JPEG when the PNG would exceed 2 MB (every browser shows both, unlike HEIC), never above 8 MB.
enum ImageEncoder {
    static let heicThreshold = 2 * 1024 * 1024
    static let maxBytes = 8 * 1024 * 1024

    struct Encoded: Sendable {
        var data: Data
        var type: UTType
        var pixelSize: CGSize
    }

    static func encode(_ image: CGImage, format: QuickNotesSettings.ScreenshotFormat = .automatic) -> Encoded? {
        var current = image
        for _ in 0..<6 {
            let size = CGSize(width: current.width, height: current.height)
            switch format {
            case .png:
                if let png = data(current, type: .png), png.count <= maxBytes { return Encoded(data: png, type: .png, pixelSize: size) }
            case .jpeg:
                if let heic = data(current, type: .jpeg, quality: 0.85), heic.count <= maxBytes { return Encoded(data: heic, type: .jpeg, pixelSize: size) }
            case .automatic:
                if let png = data(current, type: .png) {
                    if png.count <= heicThreshold { return Encoded(data: png, type: .png, pixelSize: size) }
                    if let heic = data(current, type: .jpeg, quality: 0.85), heic.count <= maxBytes {
                        return Encoded(data: heic, type: .jpeg, pixelSize: size)
                    }
                    if png.count <= maxBytes { return Encoded(data: png, type: .png, pixelSize: size) }
                }
            }
            guard let smaller = scaled(current, by: 0.75) else { return nil }
            current = smaller
        }
        return nil
    }

    /// Normalizes pasted/dropped image data: keeps PNG/JPEG/HEIC under the size cap as-is,
    /// re-encodes anything else (TIFF, huge files).
    static func normalize(_ data: Data) -> Encoded? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let typeID = CGImageSourceGetType(source) as String?, let type = UTType(typeID) else { return nil }
        if [UTType.png, .jpeg, .gif].contains(type), data.count <= maxBytes,
           let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let w = props[kCGImagePropertyPixelWidth] as? CGFloat, let h = props[kCGImagePropertyPixelHeight] as? CGFloat {
            return Encoded(data: data, type: type, pixelSize: CGSize(width: w, height: h))
        }
        guard let cg = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
        return encode(cg)
    }

    static func data(_ image: CGImage, type: UTType, quality: CGFloat = 1) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }

    static func scaled(_ image: CGImage, by factor: CGFloat) -> CGImage? {
        scaled(image, to: CGSize(width: CGFloat(image.width) * factor, height: CGFloat(image.height) * factor))
    }

    static func scaled(_ image: CGImage, to size: CGSize) -> CGImage? {
        let w = max(1, Int(size.width)), h = max(1, Int(size.height))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()
    }
}
