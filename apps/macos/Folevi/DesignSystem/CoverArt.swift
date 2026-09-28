import AppKit
import SwiftUI

/// The note styles (`cover.kind == .art`, value "art-01"…"art-57"): the same artwork and palettes as the
/// web (packages/design-tokens/covers). Bundled in `Resources/Covers` as the web's 1600 px pages
/// (`<id>-1x.webp`) and 640 px thumbnails (`<id>-thumb.webp`), with the full `covers.json` manifest.
@MainActor
enum CoverArt {
    struct Entry: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        /// Page colours that sit with the artwork (light and dark appearance).
        var paper: String?
        var ink: String?
        var paperDark: String?
        var inkDark: String?
        /// Whether the artwork itself is light or dark.
        var tone: String?
        var accent: String?
        var accentDark: String?
    }

    static let all: [Entry] = {
        guard let url = Bundle.main.url(forResource: "covers", withExtension: "json", subdirectory: "Covers"),
              let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return entries
    }()

    private static var cache: [String: NSImage] = [:]

    /// The full-size artwork (document pages).
    static func image(_ id: String?) -> NSImage? { load(id, variant: "1x") }

    /// The small artwork (cards, pickers).
    static func thumbnail(_ id: String?) -> NSImage? { load(id, variant: "thumb") }

    private static func load(_ id: String?, variant: String) -> NSImage? {
        guard let id else { return nil }
        let key = "\(id)-\(variant)"
        if let hit = cache[key] { return hit }
        guard all.contains(where: { $0.id == id }),
              let url = Bundle.main.url(forResource: key, withExtension: "webp", subdirectory: "Covers"),
              let image = NSImage(contentsOf: url) else { return nil }
        cache[key] = image
        return image
    }

    static func entry(_ id: String?) -> Entry? { all.first { $0.id == id } }

    static func name(_ id: String) -> String {
        entry(id)?.name ?? id
    }
}

/// An art cover: aspect-fill, centred, clipped by the caller; dimmed 18% in dark appearance (the web's
/// --cover-art-tint).
struct ArtCoverImage: View {
    var image: NSImage
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        GeometryReader { geo in
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fill)
                .frame(width: geo.size.width, height: geo.size.height)
                .clipped()
                .overlay(Color.black.opacity(colorScheme == .dark ? 0.18 : 0))
        }
        .accessibilityHidden(true)
    }
}
