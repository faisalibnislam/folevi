import Foundation

/// What sits behind a note's page (the web's lib/cover.ts `pageBackdrop`): it follows the note style's
/// artwork (or the cover's colour) unless the page picked its own backdrop, or none ("color:none").
public enum PageBackdrop: Equatable, Sendable {
    /// A note style artwork (`art-NN`).
    case art(String)
    /// One of the painterly colour backdrops (`style.backdrop = "color:<id>"`).
    case colors(id: String, stops: [(hex: String, at: Double)])
    /// A colour or gradient cover in this accent.
    case cover(CoverKind, accent: DocumentAccent)
    /// The person's own image (cover.kind "image").
    case image(fileId: String)

    public static func == (a: PageBackdrop, b: PageBackdrop) -> Bool {
        switch (a, b) {
        case (.art(let x), .art(let y)): return x == y
        case (.colors(let x, _), .colors(let y, _)): return x == y
        case (.cover(let k1, let a1), .cover(let k2, let a2)): return k1 == k2 && a1 == a2
        case (.image(let x), .image(let y)): return x == y
        default: return false
        }
    }

    /// "color:none": the page opted out of a backdrop.
    public static let none = "color:none"

    /// Colour backdrops (BACKDROP_COLORS): soft vertical gradients.
    public static let colorBackdrops: [(id: String, name: String, stops: [(hex: String, at: Double)])] = [
        ("sky", "Sky", [("#7fa9ee", 0), ("#bcd3f5", 0.42), ("#efe1d7", 1)]),
        ("dawn", "Dawn", [("#f3b9a3", 0), ("#f4dcd0", 0.5), ("#e5e1f3", 1)]),
        ("sand", "Sand", [("#e2cfae", 0), ("#f2e9d9", 1)]),
        ("sage", "Sage", [("#afc6aa", 0), ("#e2ebdf", 1)]),
        ("rose", "Rose", [("#eeb2bf", 0), ("#f8e3e8", 1)]),
        ("lavender", "Lavender", [("#c2b8ea", 0), ("#ece8f8", 1)]),
        ("stone", "Stone", [("#cdcdd2", 0), ("#ededef", 1)]),
        ("slate", "Slate", [("#4f5968", 0), ("#8993a2", 1)]),
        ("forest", "Forest", [("#1d3a2d", 0), ("#3d6a51", 1)]),
        ("midnight", "Midnight", [("#0e1119", 0), ("#262f49", 1)]),
    ]

    /// The backdrop for a page, or nil for none. `artExists` says whether an artwork id is known.
    public static func resolve(style: DocumentStyle, cover: DocumentCover, artExists: (String) -> Bool = { _ in true }) -> PageBackdrop? {
        if style.backdrop == none { return nil }
        if let b = style.backdrop {
            let parts = b.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { return nil }
            if parts[0] == "art" { return artExists(parts[1]) ? .art(parts[1]) : nil }
            if parts[0] == "color", let c = colorBackdrops.first(where: { $0.id == parts[1] }) { return .colors(id: c.id, stops: c.stops) }
            return nil
        }
        switch cover.kind {
        case .none: return nil
        case .image: return cover.value.map { .image(fileId: $0) }
        case .art:
            if let id = cover.value, artExists(id) { return .art(id) }
            return .cover(.gradient, accent: style.accent)
        case .color, .gradient:
            let accent = cover.value.flatMap(DocumentAccent.init(rawValue:)) ?? style.accent
            return .cover(cover.kind, accent: accent)
        }
    }

    /// The note style's name (Style panel): its artwork's, "Your image", or "Plain".
    public static func styleName(cover: DocumentCover, artName: (String) -> String?) -> String {
        if cover.kind == .art, let id = cover.value, let name = artName(id) { return name }
        if cover.kind == .image, cover.value != nil { return "Your image" }
        return "Plain"
    }
}
