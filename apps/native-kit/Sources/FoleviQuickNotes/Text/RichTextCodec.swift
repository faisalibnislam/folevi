import AppKit

/// Notlet's storage format: RTF written with stable proxy fonts (Helvetica / Menlo) so the
/// semantics survive any font the user picks later, with attachments and dividers encoded as
/// `notlet-attachment:` / `notlet-divider:` links on U+FFFC and checkboxes as ☐/☑. The file is
/// valid RTF (TextEdit opens it), and decoding rebuilds the editor's live attributes.
enum RichTextCodec {
    static let marker = "folevi-quicknote-rtf-v1"
    static let canonicalSize: CGFloat = 12
    static let canonicalIndent: CGFloat = 24
    static let dividerPlaceholder = "───"
    static let imagePlaceholder = "[image]"

    static func encode(_ text: NSAttributedString) -> Data {
        let canonical = canonicalAttributedString(text)
        let range = NSRange(location: 0, length: canonical.length)
        let data = try? canonical.data(from: range, documentAttributes: [
            .documentType: NSAttributedString.DocumentType.rtf,
            .comment: marker,
        ])
        return data ?? Data()
    }

    static func decode(_ data: Data, style: TextStyle,
                       imageProvider: AttributedMarkdown.ImageProvider = { _ in nil }) -> NSMutableAttributedString {
        guard !data.isEmpty else { return NSMutableAttributedString() }
        var docAttrs: NSDictionary?
        guard let rtf = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf],
                                                documentAttributes: &docAttrs) else {
            return NSMutableAttributedString()
        }
        let isCanonical = (docAttrs?[NSAttributedString.DocumentAttributeKey.comment] as? String) == marker
        let blocks = AttributedMarkdown.blocks(from: rtf, source: isCanonical ? .canonical : .foreign)
        return AttributedMarkdown.attributedString(from: blocks, style: style, imageProvider: imageProvider)
    }

    /// Cleans rich text from other apps (paste, import) down to Notlet's formatting subset.
    static func sanitizeForeign(_ text: NSAttributedString, style: TextStyle,
                                imageProvider: AttributedMarkdown.ImageProvider = { _ in nil }) -> NSMutableAttributedString {
        let blocks = AttributedMarkdown.blocks(from: text, source: .foreign)
        return AttributedMarkdown.attributedString(from: blocks, style: style, imageProvider: imageProvider)
    }

    static func canonicalAttributedString(_ text: NSAttributedString) -> NSAttributedString {
        let blocks = AttributedMarkdown.blocks(from: text, source: .live)
        let out = NSMutableAttributedString()
        for (index, block) in blocks.enumerated() {
            let ps = NSMutableParagraphStyle()
            let indent = CGFloat(block.level) * canonicalIndent
            ps.firstLineHeadIndent = indent
            ps.headIndent = indent
            let baseAttrs: [NSAttributedString.Key: Any] = [.font: proxyFont(bold: false, italic: false, heading: 0, code: false), .paragraphStyle: ps]
            var heading = 0
            switch block.kind {
            case .divider(let style):
                var attrs = baseAttrs
                attrs[.link] = "\(QuickNoteLink.divider):\(style.rawValue)"
                // RTF drops U+FFFC, so placeholders are real text carrying the link.
                out.append(NSAttributedString(string: dividerPlaceholder, attributes: attrs))
            case .heading(let level):
                heading = level
            case .list(let marker):
                let text: String = switch marker {
                case .bullet(let g): "\(g) "
                case .number(let n, let d): "\(n)\(d) "
                case .checkbox(let checked): checked ? "☑ " : "☐ "
                }
                out.append(NSAttributedString(string: text, attributes: baseAttrs))
            case .paragraph:
                break
            }
            for span in block.spans {
                var attrs = baseAttrs
                attrs[.font] = proxyFont(bold: span.style.contains(.bold), italic: span.style.contains(.italic),
                                         heading: heading, code: span.style.contains(.code))
                if span.style.contains(.underline) { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
                if span.style.contains(.strike) { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
                if let link = span.link { attrs[.link] = link }
                switch span.content {
                case .text(let t):
                    out.append(NSAttributedString(string: t, attributes: attrs))
                case .image(let id, _):
                    attrs[.link] = QuickNoteLink.attachmentURL(id)
                    out.append(NSAttributedString(string: imagePlaceholder, attributes: attrs))
                }
            }
            if index < blocks.count - 1 {
                out.append(NSAttributedString(string: "\n", attributes: baseAttrs))
            }
        }
        return out
    }

    private static func proxyFont(bold: Bool, italic: Bool, heading: Int, code: Bool) -> NSFont {
        let size = canonicalSize * Typography.headingScale(heading)
        let name: String
        if code {
            name = bold ? (italic ? "Menlo-BoldItalic" : "Menlo-Bold") : (italic ? "Menlo-Italic" : "Menlo-Regular")
        } else {
            let b = bold || heading > 0
            name = b ? (italic ? "Helvetica-BoldOblique" : "Helvetica-Bold") : (italic ? "Helvetica-Oblique" : "Helvetica")
        }
        return NSFont(name: name, size: size) ?? .systemFont(ofSize: size)
    }

    /// RTF for export / the pasteboard: the user's display fonts, images omitted.
    static func displayRTF(_ text: NSAttributedString) -> Data {
        let copy = NSMutableAttributedString(attributedString: text)
        let full = NSRange(location: 0, length: copy.length)
        var replacements: [(NSRange, String)] = []
        copy.enumerateAttribute(.attachment, in: full, options: .reverse) { value, range, _ in
            switch value {
            case let c as CheckboxAttachment: replacements.append((range, c.isChecked ? "☑" : "☐"))
            case is DividerAttachment: replacements.append((range, "───"))
            case is ImageAttachment: replacements.append((range, ""))
            default: break
            }
        }
        for (range, s) in replacements {
            copy.removeAttribute(.attachment, range: range)
            copy.replaceCharacters(in: range, with: s)
        }
        copy.removeAttribute(.backgroundColor, range: NSRange(location: 0, length: copy.length))
        return (try? copy.data(from: NSRange(location: 0, length: copy.length),
                               documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])) ?? Data()
    }
}
