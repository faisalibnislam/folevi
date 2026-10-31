// What a note looks like on a card: its cover (a built-in theme, the person's own image, a colour or none)
// and the page and text colours that come with it. Built-in theme images load from the app bundle by key
// (plan 3.10: the shell export carries covers/), through a provider the host can replace.
import SwiftUI
import Observation
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
    /// The person's own style image by its file id (the engine's cover kind "image"), drawn once `CoverFiles`
    /// has fetched it.
    case file(String)

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
        case .file(let id):
            if let image = CoverFiles.shared.image(id) {
                image.resizable().scaledToFill()
            } else {
                FoleviTokens.Chrome.heading.resolve(scheme).mix(FoleviTokens.Chrome.canvas.resolve(scheme), 0.07).color
            }
        }
    }
}

/// The person's own style images (a note card's cover kind "image"): the image and the page and text colours
/// picked from it, as the web's `useCoverImage` gives them. A card asks by file id; the first time it gets nil
/// (and draws plain), the ids asked for in the same moment go out in one request (the engine's `files.urls`), each
/// image is downloaded, and the answer redraws the cards. Kept for the run. The app sets `loader`.
@MainActor
@Observable
public final class CoverFiles {
    public static let shared = CoverFiles()

    /// A file's signed link and the colours picked from it (revision 26), as the engine answers.
    public struct Link: Sendable {
        public var url: URL?
        public var paper: ColorPair?
        public var ink: ColorPair?
        public init(url: URL?, paper: ColorPair?, ink: ColorPair?) {
            self.url = url
            self.paper = paper
            self.ink = ink
        }
    }

    public typealias Loader = @MainActor ([String]) async throws -> [String: Link]

    /// What asks the engine (set by the app).
    @ObservationIgnored public var loader: Loader?
    private var images: [String: Image] = [:]
    private var colors: [String: (paper: ColorPair, ink: ColorPair)] = [:]
    @ObservationIgnored private var asked: Set<String> = []
    @ObservationIgnored private var queue: [String] = []
    @ObservationIgnored private var flushing = false

    public init() {}

    /// The style image, or nil until it has come (asked for now if not yet).
    public func image(_ id: String) -> Image? {
        if let image = images[id] { return image }
        ask(id)
        return nil
    }

    /// The page and text colours picked from the image, or nil (not yet, or never picked).
    public func colors(_ id: String) -> (paper: ColorPair, ink: ColorPair)? {
        if let c = colors[id] { return c }
        ask(id)
        return nil
    }

    private func ask(_ id: String) {
        guard loader != nil, !asked.contains(id) else { return }
        asked.insert(id)
        queue.append(id)
        if !flushing {
            flushing = true
            DispatchQueue.main.async { [weak self] in self?.flush() }
        }
    }

    private func flush() {
        flushing = false
        let ids = queue
        queue = []
        guard let loader, !ids.isEmpty else { return }
        for chunk in stride(from: 0, to: ids.count, by: 100).map({ Array(ids[$0..<min($0 + 100, ids.count)]) }) {
            Task { @MainActor in
                guard let links = try? await loader(chunk) else {
                    // (Asked again the next time a card wants it.)
                    for id in chunk { asked.remove(id) }
                    return
                }
                for (id, link) in links {
                    if let paper = link.paper, let ink = link.ink { colors[id] = (paper, ink) }
                    guard let url = link.url else { continue }
                    Task { @MainActor in
                        guard let (data, _) = try? await URLSession.shared.data(from: url), let image = Self.decode(data) else { return }
                        images[id] = image
                    }
                }
            }
        }
    }

    private nonisolated static func decode(_ data: Data) -> Image? {
        #if canImport(UIKit)
        guard let ui = UIImage(data: data) else { return nil }
        return Image(uiImage: ui)
        #else
        guard let ns = NSImage(data: data) else { return nil }
        return Image(nsImage: ns)
        #endif
    }
}
