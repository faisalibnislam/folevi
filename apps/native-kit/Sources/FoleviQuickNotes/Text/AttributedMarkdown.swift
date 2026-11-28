import AppKit

/// Bridges `NSAttributedString` (the editor's live text, canonical RTF, or foreign rich text)
/// and the semantic `MDBlock` model. Everything else (Markdown, RTF storage, paste, import,
/// Apple Notes HTML) goes through these two functions, so formatting has one definition.
enum AttributedMarkdown {
    enum Source {
        /// Text produced by Notlet's editor: semantic attributes and Notlet attachment classes.
        case live
        /// Notlet's canonical storage RTF (`RichTextCodec`): proxy fonts, links for attachments.
        case canonical
        /// Rich text from elsewhere (paste, `.rtf` import): infer what we can, drop the rest.
        case foreign
    }

    typealias ImageProvider = (UUID) -> NSTextAttachment?

    // MARK: Blocks → attributed

    static func attributedString(from blocks: [MDBlock], style: TextStyle,
                                 imageProvider: ImageProvider = { _ in nil }) -> NSMutableAttributedString {
        let base = style.baseFont
        let out = NSMutableAttributedString()
        out.beginEditing()
        for (index, block) in blocks.enumerated() {
            let paragraphStyle = TextStyler.paragraphStyle(level: block.level, markerWidth: 0, heading: 0, style: style)
            var baseAttrs: [NSAttributedString.Key: Any] = [.font: base, .paragraphStyle: paragraphStyle]
            var heading = 0
            switch block.kind {
            case .divider(let dividerStyle):
                var attrs = baseAttrs
                attrs[.attachment] = DividerAttachment(style: dividerStyle)
                out.append(NSAttributedString(string: AttachmentChar.string, attributes: attrs))
            case .heading(let level):
                heading = level
                baseAttrs[.quickNoteHeading] = level
            case .list(let marker):
                if case .checkbox(let checked) = marker {
                    var attrs = baseAttrs
                    attrs[.attachment] = CheckboxAttachment(checked: checked)
                    attrs[.quickNoteCheckbox] = checked
                    out.append(NSAttributedString(string: AttachmentChar.string, attributes: attrs))
                    out.append(NSAttributedString(string: " ", attributes: baseAttrs))
                } else {
                    out.append(NSAttributedString(string: SmartBullets.markerText(marker, glyph: style.bulletGlyph), attributes: baseAttrs))
                }
            case .paragraph:
                break
            }
            if case .divider = block.kind {} else {
                for span in block.spans {
                    var attrs = baseAttrs
                    let code = span.style.contains(.code)
                    attrs[.font] = Typography.font(base: base, bold: span.style.contains(.bold), italic: span.style.contains(.italic),
                                                   heading: heading, code: code)
                    if code { attrs[.quickNoteCode] = true }
                    if span.style.contains(.underline) { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
                    if span.style.contains(.strike) { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
                    if let link = span.link { attrs[.link] = URL(string: link) ?? link }
                    switch span.content {
                    case .text(let t):
                        out.append(NSAttributedString(string: t, attributes: attrs))
                    case .image(let id, _):
                        attrs[.attachment] = imageProvider(id) ?? ImageAttachment(id: id, thumbnail: nil, pixelSize: .zero)
                        attrs.removeValue(forKey: .link)
                        out.append(NSAttributedString(string: AttachmentChar.string, attributes: attrs))
                    }
                }
            }
            if index < blocks.count - 1 {
                var nl = baseAttrs
                nl.removeValue(forKey: .quickNoteHeading)
                out.append(NSAttributedString(string: "\n", attributes: nl))
            }
        }
        out.endEditing()
        TextStyler.restyle(out, style: style)
        return out
    }

    static func attributedString(fromMarkdown markdown: String, style: TextStyle,
                                 imageProvider: ImageProvider = { _ in nil }) -> NSMutableAttributedString {
        attributedString(from: MarkdownParser.parse(markdown), style: style, imageProvider: imageProvider)
    }

    // MARK: Attributed → blocks

    static func markdown(from text: NSAttributedString, source: Source = .live) -> String {
        MarkdownSerializer.serialize(blocks(from: text, source: source))
    }

    static func blocks(from text: NSAttributedString, source: Source) -> [MDBlock] {
        let ns = text.string as NSString
        let length = ns.length
        var blocks: [MDBlock] = []
        let referenceSize: CGFloat = switch source {
        case .live: 0
        case .canonical: RichTextCodec.canonicalSize
        case .foreign: dominantFontSize(text)
        }
        var lineStart = 0
        while lineStart <= length {
            var lineEnd = lineStart
            while lineEnd < length {
                let c = ns.character(at: lineEnd)
                if c == 0x0A || c == 0x0D || c == 0x2029 || c == 0x2028 { break }
                lineEnd += 1
            }
            let range = NSRange(location: lineStart, length: lineEnd - lineStart)
            blocks.append(block(for: text, range: range, source: source, referenceSize: referenceSize))
            if lineEnd >= length { break }
            // Treat CRLF as one separator.
            if ns.character(at: lineEnd) == 0x0D, lineEnd + 1 < length, ns.character(at: lineEnd + 1) == 0x0A { lineStart = lineEnd + 2 }
            else { lineStart = lineEnd + 1 }
            if lineStart == length { blocks.append(MDBlock(kind: .paragraph)); break }
        }
        return blocks
    }

    private static func block(for text: NSAttributedString, range: NSRange, source: Source, referenceSize: CGFloat) -> MDBlock {
        let ns = text.string as NSString
        guard range.length > 0 else {
            let ps = range.location < text.length ? text.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle : nil
            return MDBlock(kind: .paragraph, level: level(for: ps, source: source))
        }
        var paragraph = ns.substring(with: range)
        var contentRange = range
        let ps = text.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle
        var level = level(for: ps, source: source)

        // Divider.
        if range.length == 1, ns.character(at: range.location) == 0xFFFC,
           let divider = text.attribute(.attachment, at: range.location, effectiveRange: nil) as? DividerAttachment {
            return MDBlock(kind: .divider(divider.style))
        }
        if source != .live, let link = linkString(text.attribute(.link, at: range.location, effectiveRange: nil)),
           link.hasPrefix(QuickNoteLink.divider + ":") {
            return MDBlock(kind: .divider(DividerStyle(rawValue: String(link.dropFirst(QuickNoteLink.divider.count + 1))) ?? .thin))
        }

        var marker: ListMarker?
        // Foreign lists (TextEdit, Notes): "\t•\t" prefixes with NSTextList.
        if source == .foreign, let lists = ps?.textLists, let list = lists.last {
            level = min(SmartBullets.maxLevel, lists.count - 1)
            if paragraph.hasPrefix("\t"), let second = paragraph.dropFirst().firstIndex(of: "\t"),
               paragraph.distance(from: paragraph.startIndex, to: second) <= 12 {
                let markerText = paragraph[paragraph.index(after: paragraph.startIndex)..<second]
                let consumed = (String(paragraph[paragraph.startIndex...second]) as NSString).length
                contentRange = NSRange(location: range.location + consumed, length: range.length - consumed)
                paragraph = ns.substring(with: contentRange)
                if list.markerFormat == .decimal || markerText.first?.isNumber == true,
                   let n = Int(markerText.filter(\.isNumber)) {
                    marker = .number(n, delimiter: ".")
                } else {
                    marker = .bullet("•")
                }
            }
        }
        if marker == nil {
            var checkbox: Bool?
            if source == .live {
                checkbox = text.attribute(.quickNoteCheckbox, at: range.location, effectiveRange: nil) as? Bool
            }
            if let prefix = SmartBullets.detect(paragraph: paragraph, checkbox: checkbox) {
                marker = prefix.marker
                contentRange = NSRange(location: range.location + prefix.length, length: max(0, range.length - prefix.length))
            } else if source != .live, let first = paragraph.first, first == "☐" || first == "☑" || first == "☒",
                      paragraph.dropFirst().first == " " {
                marker = .checkbox(checked: first != "☐")
                contentRange = NSRange(location: range.location + 2, length: range.length - 2)
            }
        }

        // Heading.
        var heading = 0
        if marker == nil, contentRange.length > 0 {
            switch source {
            case .live:
                heading = text.attribute(.quickNoteHeading, at: contentRange.location, effectiveRange: nil) as? Int ?? 0
            case .canonical, .foreign:
                if let font = text.attribute(.font, at: contentRange.location, effectiveRange: nil) as? NSFont, referenceSize > 0 {
                    let ratio = font.pointSize / referenceSize
                    let bold = Typography.traits(of: font).bold
                    if ratio >= 1.4 { heading = 1 } else if ratio >= 1.22 { heading = 2 } else if ratio >= 1.1 && (bold || source == .canonical) { heading = 3 }
                }
            }
        }

        var spans: [MDSpan] = []
        if contentRange.length > 0 {
            text.enumerateAttributes(in: contentRange, options: []) { attrs, runRange, _ in
                var style: InlineStyle = []
                let font = attrs[.font] as? NSFont
                let isCode: Bool = switch source {
                case .live: (attrs[.quickNoteCode] as? Bool) ?? false
                case .canonical, .foreign: font.map(Typography.isMonospaced) ?? false
                }
                if isCode { style.insert(.code) }
                if let font {
                    let traits = Typography.traits(of: font)
                    if traits.bold && heading == 0 { style.insert(.bold) }
                    if traits.italic { style.insert(.italic) }
                }
                if let u = attrs[.underlineStyle] as? Int, u != 0 { style.insert(.underline) }
                if let s = attrs[.strikethroughStyle] as? Int, s != 0 { style.insert(.strike) }
                let link = linkString(attrs[.link])
                let runText = ns.substring(with: runRange)
                if source != .live, let link, let id = QuickNoteLink.attachmentID(from: link) {
                    // Canonical storage writes images as linked placeholder text.
                    spans.append(MDSpan(content: .image(id: id, alt: ""), style: []))
                } else if runText.contains("\u{FFFC}") {
                    // Attachments: split so each one becomes its own span.
                    var buffer = ""
                    for ch in runText {
                        guard ch == "\u{FFFC}" else { buffer.append(ch); continue }
                        if !buffer.isEmpty { spans.append(.text(buffer, style, link: link)); buffer = "" }
                        if let image = attrs[.attachment] as? ImageAttachment {
                            spans.append(MDSpan(content: .image(id: image.attachmentID, alt: ""), style: []))
                        } else if let link, let id = QuickNoteLink.attachmentID(from: link) {
                            spans.append(MDSpan(content: .image(id: id, alt: ""), style: []))
                        }
                    }
                    if !buffer.isEmpty { spans.append(.text(buffer, style, link: link)) }
                } else {
                    spans.append(.text(runText, style, link: link))
                }
            }
        }
        spans = MDBlock.normalized(spans)
        if let marker { return MDBlock(kind: .list(marker), level: level, spans: spans) }
        if heading > 0 { return MDBlock(kind: .heading(heading), spans: spans) }
        return MDBlock(kind: .paragraph, level: level, spans: spans)
    }

    private static func level(for ps: NSParagraphStyle?, source: Source) -> Int {
        guard let ps else { return 0 }
        switch source {
        case .live: return TextStyler.level(of: ps)
        case .canonical: return min(SmartBullets.maxLevel, max(0, Int((ps.firstLineHeadIndent / RichTextCodec.canonicalIndent).rounded())))
        case .foreign: return min(SmartBullets.maxLevel, max(0, Int((ps.firstLineHeadIndent / 28).rounded())))
        }
    }

    static func linkString(_ value: Any?) -> String? {
        switch value {
        case let url as URL: url.absoluteString
        case let s as String: s
        default: nil
        }
    }

    private static func dominantFontSize(_ text: NSAttributedString) -> CGFloat {
        var weights: [CGFloat: Int] = [:]
        text.enumerateAttribute(.font, in: NSRange(location: 0, length: text.length)) { value, range, _ in
            if let f = value as? NSFont { weights[f.pointSize.rounded(), default: 0] += range.length }
        }
        return weights.max(by: { $0.value < $1.value })?.key ?? 12
    }

    // MARK: Readable plain text

    /// Plain text for people (Shortcuts, widgets, sharing): checkboxes as ☐/☑, dividers as a
    /// line, images as "[Image]".
    static func readableText(from text: NSAttributedString) -> String {
        var out = ""
        let ns = text.string as NSString
        text.enumerateAttribute(.attachment, in: NSRange(location: 0, length: ns.length)) { value, range, _ in
            switch value {
            case let c as CheckboxAttachment: out += String(repeating: c.isChecked ? "☑" : "☐", count: range.length)
            case is DividerAttachment: out += "───"
            case is ImageAttachment: out += String(localized: "[Image]")
            default: out += ns.substring(with: range)
            }
        }
        return out
    }
}
