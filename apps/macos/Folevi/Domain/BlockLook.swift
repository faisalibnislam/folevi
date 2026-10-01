import Foundation

/// A text block's own styling (Inspector → Format on the web; editor.css "Block styling"): text style,
/// decoration, colour, alignment, font and card group. Every field is optional; nil means the default.
public struct BlockLook: Equatable, Sendable {
    public var textStyle: BlockTextStyle?
    public var decoration: BlockDecoration?
    public var color: BlockColor?
    public var align: BlockAlign?
    public var font: BlockFont?
    public var group: BlockGroup?

    public init(textStyle: BlockTextStyle? = nil, decoration: BlockDecoration? = nil, color: BlockColor? = nil,
                align: BlockAlign? = nil, font: BlockFont? = nil, group: BlockGroup? = nil) {
        self.textStyle = textStyle
        self.decoration = decoration
        self.color = color
        self.align = align
        self.font = font
        self.group = group
    }

    public var isPlain: Bool { self == BlockLook() }

    /// The look a block's props carry (only text blocks have one).
    public init(_ content: BlockContent) {
        switch content {
        case .paragraph(let p): self.init(textStyle: p.textStyle, decoration: p.decoration, color: p.color, align: p.align, font: p.font, group: p.group)
        case .heading(let p): self.init(decoration: p.decoration, color: p.color, align: p.align, font: p.font, group: p.group)
        case .bulleted(let p): self.init(decoration: p.decoration, color: p.color, align: p.align, font: p.font, group: p.group)
        case .numbered(let p): self.init(decoration: p.decoration, color: p.color, align: p.align, font: p.font, group: p.group)
        case .todo(let p): self.init(decoration: p.decoration, color: p.color, align: p.align, font: p.font, group: p.group)
        case .toggle(let p): self.init(decoration: p.decoration, color: p.color, align: p.align, font: p.font, group: p.group)
        case .quote(let p): self.init(decoration: p.decoration, color: p.color, align: p.align, font: p.font, group: p.group)
        default: self.init()
        }
    }

    /// The block colours (editor.css `[data-color]`), light page / dark page. nil: the page accent.
    public static func colorHex(_ color: BlockColor, darkPage: Bool) -> String? {
        switch color {
        case .black: return nil
        case .slate: return "#5b6878"
        case .gray: return "#8b8e95"
        case .navy: return darkPage ? "#7b8cff" : "#1d33d6"
        case .blue: return "#2d6cf0"
        case .sky: return "#2f9fd4"
        case .green: return "#2f9e62"
        case .purple: return "#9b36d6"
        case .red: return "#d63a3a"
        case .orange: return "#d9801f"
        case .brown: return darkPage ? "#c89565" : "#7a4f24"
        }
    }

    /// Where a block sits in a run of card-grouped blocks: whether it opens and/or closes the card.
    public static func cardEdges(ids: [String], grouped: Set<String>) -> [String: (first: Bool, last: Bool)] {
        var out: [String: (first: Bool, last: Bool)] = [:]
        for (i, id) in ids.enumerated() where grouped.contains(id) {
            let prev = i > 0 && grouped.contains(ids[i - 1])
            let next = i + 1 < ids.count && grouped.contains(ids[i + 1])
            out[id] = (!prev, !next)
        }
        return out
    }
}
