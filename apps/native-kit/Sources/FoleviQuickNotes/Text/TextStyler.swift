import AppKit

/// Derives display attributes (fonts, paragraph styles, dimming) from the semantic attributes
/// the editor stores. Called for whole documents on load / font changes, and for single
/// paragraphs after structural edits.
enum TextStyler {
    static func level(of paragraphStyle: NSParagraphStyle?) -> Int {
        guard let ps = paragraphStyle else { return 0 }
        return min(SmartBullets.maxLevel, max(0, Int((ps.firstLineHeadIndent / Typography.indentStep).rounded())))
    }

    static func paragraphStyle(level: Int, markerWidth: CGFloat, heading: Int, style: TextStyle,
                               centered: Bool = false) -> NSParagraphStyle {
        let ps = NSMutableParagraphStyle()
        ps.lineHeightMultiple = style.lineHeightMultiple
        ps.firstLineHeadIndent = CGFloat(level) * Typography.indentStep
        ps.headIndent = CGFloat(level) * Typography.indentStep + markerWidth
        ps.paragraphSpacingBefore = heading > 0 ? (style.fontSize * 0.35).rounded() : 0
        ps.defaultTabInterval = Typography.indentStep
        ps.tabStops = []
        if centered { ps.alignment = .center }
        return ps
    }

    /// Full rich-text restyle of `range` (expanded to whole paragraphs).
    static func restyle(_ text: NSMutableAttributedString, range: NSRange? = nil, style: TextStyle) {
        let ns = text.string as NSString
        let target = ns.paragraphRange(for: range ?? NSRange(location: 0, length: ns.length))
        guard target.length > 0 || ns.length == 0 else { return }
        let base = style.baseFont
        text.beginEditing()
        defer { text.endEditing() }

        // Paragraph-level semantics never live on the newline itself (so Return after a heading
        // starts a body paragraph).
        ns.enumerateSubstrings(in: target, options: [.byParagraphs, .substringNotRequired]) { _, pRange, enclosing, _ in
            let terminator = NSRange(location: NSMaxRange(pRange), length: NSMaxRange(enclosing) - NSMaxRange(pRange))
            if terminator.length > 0 {
                text.removeAttribute(.quickNoteHeading, range: terminator)
                text.removeAttribute(.quickNoteCode, range: terminator)
            }
        }

        // Fonts from semantics.
        text.enumerateAttributes(in: target, options: []) { attrs, runRange, _ in
            let font = attrs[.font] as? NSFont ?? base
            let (bold, italic) = Typography.traits(of: font)
            let heading = attrs[.quickNoteHeading] as? Int ?? 0
            let code = (attrs[.quickNoteCode] as? Bool) ?? false
            let newFont = Typography.font(base: base, bold: bold && heading == 0, italic: italic, heading: heading, code: code)
            if newFont != font { text.addAttribute(.font, value: newFont, range: runRange) }
            if code {
                text.addAttribute(.backgroundColor, value: Typography.codeBackground, range: runRange)
            } else if attrs[.backgroundColor] != nil {
                text.removeAttribute(.backgroundColor, range: runRange)
            }
        }

        // Paragraph styles, list hanging indents, checked-item dimming.
        ns.enumerateSubstrings(in: target, options: [.byParagraphs, .substringNotRequired]) { _, pRange, enclosing, _ in
            let fullRange = enclosing
            let existing = fullRange.length > 0 ? text.attribute(.paragraphStyle, at: fullRange.location, effectiveRange: nil) as? NSParagraphStyle : nil
            let level = Self.level(of: existing)
            let paragraph = ns.substring(with: pRange)
            let checkbox: Bool? = pRange.length > 0 ? text.attribute(.quickNoteCheckbox, at: pRange.location, effectiveRange: nil) as? Bool : nil
            let prefix = SmartBullets.detect(paragraph: paragraph, checkbox: checkbox)
            var markerWidth: CGFloat = 0
            if let prefix {
                let markerRange = NSRange(location: pRange.location, length: min(prefix.length, pRange.length))
                markerWidth = text.attributedSubstring(from: markerRange).size().width.rounded(.up)
                if prefix.marker.isCheckbox {
                    let font = text.attribute(.font, at: pRange.location, effectiveRange: nil) as? NSFont ?? base
                    markerWidth = CheckboxAttachment.side(for: font) + 1 + (" " as NSString).size(withAttributes: [.font: font]).width
                    markerWidth = markerWidth.rounded(.up)
                }
            }
            let heading = pRange.length > 0 ? (text.attribute(.quickNoteHeading, at: pRange.location, effectiveRange: nil) as? Int ?? 0) : 0
            let isDivider = pRange.length == 1 && (text.attribute(.attachment, at: pRange.location, effectiveRange: nil) is DividerAttachment)
            let ps = paragraphStyle(level: isDivider ? 0 : level, markerWidth: markerWidth, heading: heading, style: style)
            if fullRange.length > 0 { text.addAttribute(.paragraphStyle, value: ps, range: fullRange) }

            // Always an explicit, appearance-aware color: text without one renders black in
            // Dark Mode. Checked items are dimmed.
            if fullRange.length > 0 {
                let color: NSColor = if case .checkbox(true)? = prefix?.marker { .secondaryLabelColor } else { .textColor }
                text.addAttribute(.foregroundColor, value: color, range: fullRange)
            }
        }
    }

    /// Plain (Markdown source) mode: one font, no traits, same line height.
    static func applyPlain(_ text: NSMutableAttributedString, style: TextStyle) {
        let full = NSRange(location: 0, length: text.length)
        text.beginEditing()
        text.setAttributes(plainAttributes(style: style), range: full)
        text.endEditing()
    }

    static func plainAttributes(style: TextStyle) -> [NSAttributedString.Key: Any] {
        [.font: style.baseFont,
         .foregroundColor: NSColor.textColor,
         .paragraphStyle: paragraphStyle(level: 0, markerWidth: 0, heading: 0, style: style)]
    }

    static func typingAttributes(style: TextStyle) -> [NSAttributedString.Key: Any] {
        plainAttributes(style: style)
    }
}
