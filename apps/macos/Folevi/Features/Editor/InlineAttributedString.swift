import AppKit

extension NSAttributedString.Key {
    static let foleviBold = NSAttributedString.Key("folevi.bold")
    static let foleviItalic = NSAttributedString.Key("folevi.italic")
    static let foleviUnderline = NSAttributedString.Key("folevi.underline")
    static let foleviStrike = NSAttributedString.Key("folevi.strike")
    static let foleviCode = NSAttributedString.Key("folevi.code")
    static let foleviLink = NSAttributedString.Key("folevi.link")
    static let foleviColor = NSAttributedString.Key("folevi.color")
    static let foleviHighlight = NSAttributedString.Key("folevi.highlight")
    /// JSON of a non-text inline node (mention, date, pageLink) rendered as its label.
    static let foleviInline = NSAttributedString.Key("folevi.inline")
    /// An underline drawn at a set thickness and offset (`FoleviLayoutManager`), as editor.css's
    /// `text-decoration-thickness` / `text-underline-offset`. A visual attribute, derived like the colours.
    static let foleviUnderlineOffset = NSAttributedString.Key("folevi.underlineOffset")
}

/// Visual style of a text-bearing block.
struct TextRenderStyle: Equatable {
    var font: NSFont
    var color: NSColor
    var lineSpacing: CGFloat = 2
    var paragraphSpacing: CGFloat = 0
    var placeholder: String = ""
    var strikethrough = false
    /// Letter spacing in points (`FoleviTracking` × size).
    var kern: CGFloat = 0
    /// A block's own alignment (Format → align).
    var alignment: NSTextAlignment = .natural
    /// The note style's palette (text colour and highlight marks, links, underlines, inline code).
    var notePalette: NotePaletteLook?

    static func == (a: TextRenderStyle, b: TextRenderStyle) -> Bool {
        a.font == b.font && a.color == b.color && a.lineSpacing == b.lineSpacing && a.placeholder == b.placeholder
            && a.strikethrough == b.strikethrough && a.kern == b.kern && a.alignment == b.alignment && a.notePalette == b.notePalette
    }
}

/// Converts between the canonical inline model and the attributed text shown in NSTextView.
/// Marks are stored as custom attributes (the source of truth); fonts/colors are derived from them.
enum InlineAttributedString {
    static func make(_ nodes: [InlineNode], style: TextRenderStyle) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for node in nodes {
            switch node {
            case .text(let text, let marks):
                var attrs: [NSAttributedString.Key: Any] = [:]
                for m in marks ?? [] {
                    switch m {
                    case .bold: attrs[.foleviBold] = true
                    case .italic: attrs[.foleviItalic] = true
                    case .underline: attrs[.foleviUnderline] = true
                    case .strike: attrs[.foleviStrike] = true
                    case .code: attrs[.foleviCode] = true
                    case .link(let href): attrs[.foleviLink] = href
                    case .color(let v): attrs[.foleviColor] = v.rawValue
                    case .highlight(let v): attrs[.foleviHighlight] = v.rawValue
                    }
                }
                out.append(NSAttributedString(string: text, attributes: attrs))
            case .mention, .date, .pageLink:
                let label = displayLabel(node)
                let json = (try? JSONValue(encoding: node).canonicalString) ?? ""
                out.append(NSAttributedString(string: label, attributes: [.foleviInline: json]))
            }
        }
        applyStyle(to: out, range: NSRange(location: 0, length: out.length), style: style)
        return out
    }

    /// Derives visual attributes (font, color, underline…) from the Folevi mark attributes.
    static func applyStyle(to text: NSMutableAttributedString, range: NSRange, style: TextRenderStyle) {
        guard range.length > 0, NSMaxRange(range) <= text.length else { return }
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = style.lineSpacing
        paragraph.paragraphSpacing = style.paragraphSpacing
        paragraph.alignment = style.alignment
        text.beginEditing()
        text.enumerateAttributes(in: range, options: []) { attrs, r, _ in
            var visual: [NSAttributedString.Key: Any] = [.paragraphStyle: paragraph]
            var font = style.font
            let pal = style.notePalette
            if attrs[.foleviCode] != nil {
                // editor.css `.fb-inline-code`: 0.86em mono on the code background, in ember ink (on a note
                // style palette: the style's accent, on the accent 6% into the page).
                font = FoleviFont.nsFont(.mono, size: style.font.pointSize * 0.86)
                visual[.backgroundColor] = pal.map { NSColor($0.codeBackground) } ?? NSColor.foleviCodeBg
                visual[.foregroundColor] = pal.map { NSColor($0.accent) } ?? NSColor(FoleviColor.emberInk)
            }
            let bold = attrs[.foleviBold] != nil, italic = attrs[.foleviItalic] != nil
            if bold || italic { font = FoleviFont.applying(bold: bold, italic: italic, to: font) }
            visual[.font] = font
            if style.kern != 0, attrs[.foleviCode] == nil { visual[.kern] = style.kern }
            var color = style.color
            if let c = attrs[.foleviColor] as? String, let tc = TextColor(rawValue: c) {
                // `.fb-color-accent` is the ember ink; the others their own ink. A note style palette fills
                // the slots with its own colours (muted stays muted).
                if let slot = pal?.text(tc) {
                    color = NSColor(slot)
                } else {
                    color = tc == .accent ? NSColor(FoleviColor.emberInk) : NSColor.folevi(text: tc)
                }
            }
            if let h = attrs[.foleviHighlight] as? String, let hc = HighlightColor(rawValue: h) {
                visual[.backgroundColor] = pal.map { NSColor($0.highlight(hc)) } ?? NSColor.folevi(highlight: hc)
            }
            if attrs[.foleviUnderline] != nil {
                visual[.underlineStyle] = NSUnderlineStyle.single.rawValue
                if let pal {
                    // `.fb-sheet[data-palette] u`: the accent at 70%, 1.5pt thick, 3pt below the baseline.
                    visual[.underlineColor] = NSColor(pal.underline)
                    visual[.foleviUnderlineOffset] = FoleviLayoutManager.cssUnderline
                }
            }
            if attrs[.foleviStrike] != nil || style.strikethrough {
                visual[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
                visual[.strikethroughColor] = NSColor.foleviInkMuted.withAlphaComponent(0.6)
            }
            if let href = attrs[.foleviLink] as? String {
                // `.fb-link`: `--color-accent` (the style's accent on a palette), its underline at 35%, 1.5pt
                // thick, 3pt below the baseline.
                color = pal.map { NSColor($0.accent) } ?? NSColor.foleviAccent
                visual[.underlineStyle] = NSUnderlineStyle.single.rawValue
                visual[.underlineColor] = pal.map { NSColor($0.linkUnderline) } ?? NSColor.foleviAccent.withAlphaComponent(0.35)
                visual[.foleviUnderlineOffset] = FoleviLayoutManager.cssUnderline
                visual[.toolTip] = href
            }
            if let json = attrs[.foleviInline] as? String {
                // editor.css: mentions in ember, dates in marigold (soft fill, 0.92em, weight 550); page
                // links in the ink at weight 500 with an accent underline and an ember arrow.
                if json.contains("\"pageLink\"") {
                    color = style.color
                    font = Self.weighted(font, .medium)
                    visual[.underlineStyle] = NSUnderlineStyle.thick.rawValue
                    visual[.underlineColor] = pal.map { NSColor($0.pageLinkUnderline) } ?? NSColor(FoleviColor.ember).withAlphaComponent(0.55)
                } else {
                    let isDate = json.contains("\"date\"")
                    font = Self.weighted(FoleviFont.nsFont(FoleviFont.describe(style.font)?.family ?? .sans, size: style.font.pointSize * 0.92), .semibold)
                    color = NSColor(isDate ? FoleviColor.marigoldInk : FoleviColor.emberInk)
                    visual[.backgroundColor] = NSColor(isDate ? FoleviColor.marigoldSoft : FoleviColor.emberSoft)
                }
                visual[.font] = font
            }
            if visual[.foregroundColor] == nil { visual[.foregroundColor] = color }
            if visual[.font] == nil { visual[.font] = font }
            // Remove stale visual attributes, keep Folevi marks.
            for key in [NSAttributedString.Key.font, .foregroundColor, .backgroundColor, .underlineStyle, .underlineColor, .foleviUnderlineOffset, .strikethroughStyle, .strikethroughColor, .toolTip, .paragraphStyle, .kern] {
                text.removeAttribute(key, range: r)
            }
            text.addAttributes(visual, range: r)
        }
        // The page link's arrow: ember ink at 0.85em.
        text.enumerateAttribute(.foleviInline, in: range, options: []) { v, r, _ in
            guard let json = v as? String, json.contains("\"pageLink\""), r.length >= 2 else { return }
            let arrow = NSRange(location: r.location, length: 1)
            text.addAttribute(.foregroundColor, value: NSColor(FoleviColor.emberInk), range: arrow)
            if let f = text.attribute(.font, at: r.location, effectiveRange: nil) as? NSFont {
                text.addAttribute(.font, value: f.withSize(f.pointSize * 0.85), range: arrow)
            }
        }
        text.endEditing()
    }

    static func inline(from text: NSAttributedString) -> [InlineNode] {
        var nodes: [InlineNode] = []
        let full = NSRange(location: 0, length: text.length)
        let string = text.string as NSString
        text.enumerateAttributes(in: full, options: []) { attrs, range, _ in
            let s = string.substring(with: range)
            if let json = attrs[.foleviInline] as? String,
               let node = try? JSONValue(jsonString: json).decode(InlineNode.self) {
                if s == displayLabel(node) {
                    nodes.append(node)
                    return
                }
            }
            var marks: [Mark] = []
            if attrs[.foleviBold] != nil { marks.append(.bold) }
            if attrs[.foleviItalic] != nil { marks.append(.italic) }
            if attrs[.foleviUnderline] != nil { marks.append(.underline) }
            if attrs[.foleviStrike] != nil { marks.append(.strike) }
            if attrs[.foleviCode] != nil { marks.append(.code) }
            if let href = attrs[.foleviLink] as? String { marks.append(.link(href: href)) }
            if let c = attrs[.foleviColor] as? String, let tc = TextColor(rawValue: c) { marks.append(.color(value: tc)) }
            if let h = attrs[.foleviHighlight] as? String, let hc = HighlightColor(rawValue: h) { marks.append(.highlight(value: hc)) }
            nodes.append(.text(text: s, marks: marks.isEmpty ? nil : marks))
        }
        // Adjacent identical inline nodes rendered from separate runs are kept distinct by JSON; merge text runs.
        return RichText.normalizeInline(nodes)
    }

    /// Splits inline content at a UTF-16 offset (used for Return / split block).
    static func split(_ text: NSAttributedString, at location: Int) -> ([InlineNode], [InlineNode]) {
        let loc = max(0, min(location, text.length))
        let left = text.attributedSubstring(from: NSRange(location: 0, length: loc))
        let right = text.attributedSubstring(from: NSRange(location: loc, length: text.length - loc))
        return (inline(from: left), inline(from: right))
    }

    /// How an inline object reads in the text: "@Name", a date as "Thu, Oct 1", "↗ Page title".
    static func displayLabel(_ node: InlineNode) -> String {
        switch node {
        case .mention(_, let l): return "@" + l
        case .date(let d): return MentionChoice.dateLabel(d)
        case .pageLink(_, let l): return "\u{2197} " + (l.isEmpty ? String(localized: "Untitled") : l)
        case .text(let t, _): return t
        }
    }

    /// The same face at another weight.
    static func weighted(_ font: NSFont, _ face: FoleviFont.Face) -> NSFont {
        let d = FoleviFont.describe(font)
        return FoleviFont.nsFont(d?.family ?? .sans, size: font.pointSize, weight: face, italic: d?.italic ?? false)
    }

    static func length(_ nodes: [InlineNode]) -> Int {
        make(nodes, style: TextRenderStyle(font: FoleviFont.nsFont(.sans, size: 13), color: .textColor)).length
    }

    /// Mark keys that toggle.
    static func key(for mark: Mark) -> NSAttributedString.Key {
        switch mark {
        case .bold: return .foleviBold
        case .italic: return .foleviItalic
        case .underline: return .foleviUnderline
        case .strike: return .foleviStrike
        case .code: return .foleviCode
        case .link: return .foleviLink
        case .color: return .foleviColor
        case .highlight: return .foleviHighlight
        }
    }

    static let markKeys: [NSAttributedString.Key] = [.foleviBold, .foleviItalic, .foleviUnderline, .foleviStrike, .foleviCode, .foleviLink, .foleviColor, .foleviHighlight]
}
