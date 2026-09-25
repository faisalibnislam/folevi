import AppKit
import SwiftUI

/// The 20 abstract cover artworks (`cover.kind == .art`, value "art-01"…"art-20"), bundled as PNGs in
/// `Resources/Covers` with a `covers.json` manifest — rendered from the same SVGs the web uses.
@MainActor
enum CoverArt {
    struct Entry: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
    }

    static let all: [Entry] = {
        guard let url = Bundle.main.url(forResource: "covers", withExtension: "json", subdirectory: "Covers"),
              let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return entries
    }()

    private static var cache: [String: NSImage] = [:]

    static func image(_ id: String?) -> NSImage? {
        guard let id else { return nil }
        if let hit = cache[id] { return hit }
        guard all.contains(where: { $0.id == id }),
              let url = Bundle.main.url(forResource: id, withExtension: "png", subdirectory: "Covers"),
              let image = NSImage(contentsOf: url) else { return nil }
        cache[id] = image
        return image
    }

    static func name(_ id: String) -> String {
        all.first { $0.id == id }?.name ?? id
    }
}

/// An art cover: aspect-fill, centred, clipped by the caller; dimmed 18% in dark appearance so it sits
/// in the espresso theme.
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
