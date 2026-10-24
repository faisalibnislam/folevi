// What a note looks like on a card: its cover (a built-in theme, the person's own image, a colour or none)
// and the page and text colours that come with it. Built-in theme images load from the app bundle by key
// (plan 3.10: the shell export carries covers/), through a provider the host can replace.
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public enum NoteCover: Hashable, Sendable {
    /// No artwork ("Plain").
    case plain
    /// A built-in theme, "art-01" ...
    case theme(String)
    /// An accent colour (or a gradient between two).
    case color(RGBA, RGBA? = nil)
    /// The person's own image (already downloaded; custom covers come through the attachment store).
    case image(ImageBox)

    public var theme: NoteTheme? {
        if case .theme(let id) = self { return NoteTheme.named(id) }
        return nil
    }
}

/// An image as a hashable, sendable value for `NoteCover.image`.
public struct ImageBox: Hashable, @unchecked Sendable {
    public let id: String
    public let image: Image
    public init(id: String, image: Image) {
        self.id = id
        self.image = image
    }
    public static func == (a: ImageBox, b: ImageBox) -> Bool { a.id == b.id }
    public func hash(into h: inout Hasher) { h.combine(id) }
}

/// A note's font type (the editor's Style > Font), drawn on cards with each type's standard face.
public enum NoteFontType: String, Sendable, CaseIterable {
    case system, modern, serif, mono, soft

    var family: FoleviFonts.Family {
        switch self {
        case .system: .ui
        case .modern: .modern
        case .serif: .display
        case .mono: .mono
        case .soft: .rounded
        }
    }
}

/// Loads a built-in theme's thumbnail (640 px WebP) by key. Replace with `.environment(\.coverArt, ...)`.
public struct CoverArtProvider: Sendable {
    public let load: @Sendable (String) -> Image?
    public init(load: @escaping @Sendable (String) -> Image?) { self.load = load }

    /// Looks for `<key>-thumb.webp` in the app bundle's shell export (web/covers, covers) and caches it.
    public static let bundle = CoverArtProvider { key in
        if let cached = CoverArtCache.shared.image(key) { return cached }
        let name = "\(key)-thumb"
        let dirs = ["web/covers", "covers", "public/covers", "Resources/web/covers"]
        for dir in dirs {
            guard let url = Bundle.main.url(forResource: name, withExtension: "webp", subdirectory: dir) else { continue }
            #if canImport(UIKit)
            guard let ui = UIImage(contentsOfFile: url.path) else { continue }
            let image = Image(uiImage: ui)
            #else
            guard let ns = NSImage(contentsOf: url) else { continue }
            let image = Image(nsImage: ns)
            #endif
            CoverArtCache.shared.set(key, image)
            return image
        }
        return nil
    }

    public static let none = CoverArtProvider { _ in nil }
}

final class CoverArtCache: @unchecked Sendable {
    static let shared = CoverArtCache()
    private let lock = NSLock()
    private var images: [String: Image] = [:]
    func image(_ key: String) -> Image? { lock.withLock { images[key] } }
    func set(_ key: String, _ image: Image) { lock.withLock { images[key] = image } }
    /// Memory warnings and the app lock call this.
    func clear() { lock.withLock { images.removeAll() } }
}

public extension EnvironmentValues {
    @Entry var coverArt: CoverArtProvider = .bundle
}

/// Draws a cover fill: the theme's image (or, without it, a soft gradient in the theme's colours), the image,
/// the colour, or the plain light grey strip.
public struct CoverFill: View {
    @Environment(\.coverArt) private var provider
    @Environment(\.colorScheme) private var scheme
    let cover: NoteCover

    public init(_ cover: NoteCover) { self.cover = cover }

    public var body: some View {
        switch cover {
        case .plain:
            FoleviTokens.Chrome.heading.resolve(scheme).mix(FoleviTokens.Chrome.canvas.resolve(scheme), 0.07).color
        case .theme(let id):
            if let image = provider.load(id) {
                image.resizable().scaledToFill()
            } else if let theme = NoteTheme.named(id) {
                LinearGradient(colors: [theme.accent(scheme).mix(theme.paper(scheme), 0.55).color, theme.accent(scheme).color], startPoint: .topLeading, endPoint: .bottomTrailing)
            } else {
                Folevi.color.surfaceSunken
            }
        case .color(let a, let b):
            if let b {
                LinearGradient(colors: [a.color, b.color], startPoint: .topLeading, endPoint: .bottomTrailing)
            } else {
                a.color
            }
        case .image(let box):
            box.image.resizable().scaledToFill()
        }
    }
}
