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
}

/// Visual style of a text-bearing block.
struct BlockTextStyle: Equatable {
    var font: NSFont
    var color: NSColor
    var lineSpacing: CGFloat = 2
    var paragraphSpacing: CGFloat = 0
    var placeholder: String = ""
    var strikethrough = false

    static func == (a: BlockTextStyle, b: BlockTextStyle) -> Bool {
        a.font == b.font && a.color == b.color && a.lineSpacing == b.lineSpacing && a.placeholder == b.placeholder && a.strikethrough == b.strikethrough
    }
}

/// Converts between the canonical inline model and the attributed text shown in NSTextView.
/// Marks are stored as custom attributes (the source of truth); fonts/colors are derived from them.
enum InlineAttributedString {
    static func make(_ nodes: [InlineNode], style: BlockTextStyle) -> NSAttributedString {
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
                let label: String
                switch node {
                case .mention(_, let l): label = "@" + l
                case .date(let d): label = d
                case .pageLink(_, let l): label = l
                default: label = ""
                }
                let json = (try? JSONValue(encoding: node).canonicalString) ?? ""
                out.append(NSAttributedString(string: label, attributes: [.foleviInline: json]))
            }
        }
        applyStyle(to: out, range: NSRange(location: 0, length: out.length), style: style)
        return out
    }

    /// Derives visual attributes (font, color, underline…) from the Folevi mark attributes.
    static func applyStyle(to text: NSMutableAttributedString, range: NSRange, style: BlockTextStyle) {
        guard range.length > 0, NSMaxRange(range) <= text.length else { return }
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = style.lineSpacing
        paragraph.paragraphSpacing = style.paragraphSpacing
        text.beginEditing()
        text.enumerateAttributes(in: range, options: []) { attrs, r, _ in
            var visual: [NSAttributedString.Key: Any] = [.paragraphStyle: paragraph]
            var font = style.font
            let manager = NSFontManager.shared
            if attrs[.foleviCode] != nil {
                font = NSFont.monospacedSystemFont(ofSize: style.font.pointSize * 0.9, weight: .regular)
                visual[.backgroundColor] = NSColor.foleviCodeBg
            }
            if attrs[.foleviBold] != nil { font = manager.convert(font, toHaveTrait: .boldFontMask) }
            if attrs[.foleviItalic] != nil { font = manager.convert(font, toHaveTrait: .italicFontMask) }
            visual[.font] = font
            var color = style.color
            if let c = attrs[.foleviColor] as? String, let tc = TextColor(rawValue: c) { color = NSColor.folevi(text: tc) }
            if let h = attrs[.foleviHighlight] as? String, let hc = HighlightColor(rawValue: h) { visual[.backgroundColor] = NSColor.folevi(highlight: hc) }
            if attrs[.foleviUnderline] != nil { visual[.underlineStyle] = NSUnderlineStyle.single.rawValue }
            if attrs[.foleviStrike] != nil || style.strikethrough { visual[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if let href = attrs[.foleviLink] as? String {
                color = NSColor.foleviAccent
                visual[.underlineStyle] = NSUnderlineStyle.single.rawValue
                visual[.toolTip] = href
            }
            if attrs[.foleviInline] != nil {
                color = NSColor.foleviAccent
                visual[.backgroundColor] = NSColor.foleviSelection.withAlphaComponent(0.35)
            }
            visual[.foregroundColor] = color
            // Remove stale visual attributes, keep Folevi marks.
            for key in [NSAttributedString.Key.font, .foregroundColor, .backgroundColor, .underlineStyle, .strikethroughStyle, .toolTip, .paragraphStyle] {
                text.removeAttribute(key, range: r)
            }
            text.addAttributes(visual, range: r)
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
                let label: String
                switch node {
                case .mention(_, let l): label = "@" + l
                case .date(let d): label = d
                case .pageLink(_, let l): label = l
                case .text(let t, _): label = t
                }
                if s == label {
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

    static func length(_ nodes: [InlineNode]) -> Int {
        make(nodes, style: BlockTextStyle(font: .systemFont(ofSize: 13), color: .textColor)).length
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
