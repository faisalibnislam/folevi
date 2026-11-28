import AppKit
import ImageIO
import SwiftData
import UniformTypeIdentifiers

/// Image attachment helpers: downsampled thumbnails for the text view (full-size images are only
/// decoded for Quick Look / copy / save), and a file cache Quick Look can read.
///
/// Thumbnails are produced off the main thread: a note opens immediately with correctly sized
/// placeholders and each image appears when its thumbnail is ready (measured: opening a dot with
/// 20 display-sized screenshots blocked the main thread for ~400 ms when this was synchronous).
@MainActor
final class AttachmentStore {
    private let store: NoteStore
    private let thumbnails = NSCache<NSUUID, NSImage>()
    private var pixelSizes: [UUID: CGSize] = [:]
    private let loader: ThumbnailLoader
    private var inFlight = Set<UUID>()
    /// Called on the main actor when a thumbnail becomes available.
    var onThumbnail: (UUID, NSImage, CGSize) -> Void = { _, _, _ in }

    /// Where Quick Look and Save find a file copy of an image (the build's own folder, not a shared Caches one).
    private let cacheFolder: URL

    init(store: NoteStore, container: ModelContainer, cacheFolder: URL?) {
        self.store = store
        self.cacheFolder = cacheFolder ?? FileManager.default.temporaryDirectory.appendingPathComponent("FoleviQuickNotesPreviews", isDirectory: true)
        loader = ThumbnailLoader(modelContainer: container)
        thumbnails.countLimit = 60
    }

    /// Thumbnails still being produced (benchmarks).
    var pendingThumbnailCount: Int { inFlight.count }

    /// Drops regeneratable thumbnails (memory pressure).
    func purgeThumbnails() {
        thumbnails.removeAllObjects()
    }

    var cacheDirectory: URL {
        try? FileManager.default.createDirectory(at: cacheFolder, withIntermediateDirectories: true)
        return cacheFolder
    }

    func data(for id: UUID) -> Data? { store.attachment(id: id)?.cloudAssetData }

    /// Returns the attachment immediately: with its thumbnail when cached, otherwise a placeholder
    /// that is swapped for the real image once the background load finishes.
    func textAttachment(for id: UUID) -> NSTextAttachment? {
        if let cached = thumbnails.object(forKey: id as NSUUID) {
            return ImageAttachment(id: id, thumbnail: cached, pixelSize: pixelSizes[id] ?? cached.size)
        }
        loadThumbnail(id)
        return ImageAttachment(id: id, thumbnail: nil, pixelSize: pixelSizes[id] ?? .zero)
    }

    /// Decodes run at most `maxConcurrentDecodes` at a time: unbounded parallel decoding of large
    /// screenshots finished sooner but more than doubled peak memory (measured 60 → 150 MB for 20).
    private static let maxConcurrentDecodes = 2
    private var queued: [UUID] = []
    private var activeDecodes = 0

    private func loadThumbnail(_ id: UUID) {
        guard inFlight.insert(id).inserted else { return }
        queued.append(id)
        startQueuedDecodes()
    }

    private func startQueuedDecodes() {
        while activeDecodes < Self.maxConcurrentDecodes, !queued.isEmpty {
            let id = queued.removeFirst()
            activeDecodes += 1
            Task { [loader] in
                let data = await loader.data(id: id)
                // Decoding runs outside the actor; only the store read is serialized.
                let result = await Task.detached(priority: .userInitiated) {
                    data.flatMap { Self.downsample($0, maxPointWidth: ImageAttachment.maxDisplayWidth) }
                }.value
                self.activeDecodes -= 1
                self.inFlight.remove(id)
                if let result {
                    let image = NSImage(cgImage: result.image, size: result.pointSize)
                    self.thumbnails.setObject(image, forKey: id as NSUUID)
                    self.pixelSizes[id] = result.pixelSize
                    self.onThumbnail(id, image, result.pixelSize)
                }
                self.startQueuedDecodes()
            }
        }
    }

    func register(thumbnail: NSImage, pixelSize: CGSize, for id: UUID) {
        thumbnails.setObject(thumbnail, forKey: id as NSUUID)
        pixelSizes[id] = pixelSize
    }

    /// A file URL for Quick Look / drag-out / sharing (written lazily to Caches).
    /// A file Quick Look / Save can read. One folder per attachment: names aren't unique (every
    /// paste is "Pasted Image"), and a shared folder handed back an earlier image with the same name.
    func fileURL(for id: UUID) -> URL? {
        guard let attachment = store.attachment(id: id) else { return nil }
        let ext = UTType(attachment.utType)?.preferredFilenameExtension ?? "png"
        let base = attachment.filename.isEmpty ? id.uuidString : (attachment.filename as NSString).deletingPathExtension
        let folder = cacheDirectory.appendingPathComponent(id.uuidString, isDirectory: true)
        let url = folder.appendingPathComponent("\(base).\(ext)")
        if !FileManager.default.fileExists(atPath: url.path) {
            guard let data = attachment.cloudAssetData else { return nil }
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            guard (try? data.write(to: url, options: .atomic)) != nil else { return nil }
        }
        return url
    }

    /// Downsampled thumbnail at 2× the display width via ImageIO (never decodes the full image).
    nonisolated static func thumbnail(from data: Data, maxPointWidth: CGFloat) -> (NSImage?, CGSize) {
        guard let result = downsample(data, maxPointWidth: maxPointWidth) else { return (nil, .zero) }
        return (NSImage(cgImage: result.image, size: result.pointSize), result.pixelSize)
    }

    struct Thumbnail: @unchecked Sendable {
        // CGImage is immutable; it is created on the loader and only read afterwards.
        let image: CGImage
        let pointSize: CGSize
        let pixelSize: CGSize
    }

    nonisolated static func downsample(_ data: Data, maxPointWidth: CGFloat) -> Thumbnail? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else {
            return nil
        }
        var pixels = CGSize.zero
        if let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let w = props[kCGImagePropertyPixelWidth] as? CGFloat, let h = props[kCGImagePropertyPixelHeight] as? CGFloat {
            pixels = CGSize(width: w, height: h)
        }
        let maxPixel = maxPointWidth * 2
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        // Points: assume Retina (2×) source pixels, capped to the thumbnail size.
        let pointSize = CGSize(width: CGFloat(cg.width) / 2, height: CGFloat(cg.height) / 2)
        return Thumbnail(image: cg, pointSize: pointSize, pixelSize: pixels)
    }
}

/// Reads attachment data with its own background `ModelContext`, so the external-storage file
/// read never touches the main thread.
@ModelActor
actor ThumbnailLoader {
    func data(id: UUID) -> Data? {
        var descriptor = FetchDescriptor<Attachment>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return (try? modelContext.fetch(descriptor))?.first?.cloudAssetData
    }
}
