import AppKit

/// The block text's layout manager. It draws underlines carrying `.foleviUnderlineOffset` the way
/// editor.css sets them (`text-decoration-thickness` and `text-underline-offset`, measured from the
/// baseline): links, and underlined text on a note style palette. Other underlines are AppKit's own.
final class FoleviLayoutManager: NSLayoutManager {
    /// Inline code as on the web: a radius-6 pill padded 6pt at the sides (the room comes from kerning) and
    /// 0.12em above and below the code font, with a faint inner ring.
    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage else { return }
        let chars = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(.foleviCodeBox, in: chars, options: []) { value, range, _ in
            guard let fill = value as? NSColor else { return }
            let font = storage.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont ?? .systemFont(ofSize: 13)
            let ring = storage.attribute(.foleviCodeRing, at: range.location, effectiveRange: nil) as? NSColor
            let glyphs = self.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let pad = InlineCode.sidePadding, vpad = font.pointSize * 0.12
            self.enumerateLineFragments(forGlyphRange: glyphs) { lineRect, _, container, lineGlyphs, _ in
                let part = NSIntersectionRange(glyphs, lineGlyphs)
                guard part.length > 0 else { return }
                let b = self.boundingRect(forGlyphRange: part, in: container)
                let baseline = lineRect.minY + self.location(forGlyphAt: part.location).y
                let rect = NSRect(x: b.minX - pad + origin.x, y: baseline - font.ascender - vpad + origin.y,
                                  width: b.width + pad, height: font.ascender - font.descender + 2 * vpad)
                let path = NSBezierPath(roundedRect: rect, xRadius: 6, yRadius: 6)
                fill.setFill()
                path.fill()
                if let ring {
                    let inner = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: 5.5, yRadius: 5.5)
                    inner.lineWidth = 1
                    ring.setStroke()
                    inner.stroke()
                }
            }
        }
    }

    /// editor.css's 1.5px thick underline, 3px below the baseline (width = thickness, height = offset).
    static var cssUnderline: NSValue { NSValue(size: NSSize(width: 1.5, height: 3)) }

    override func drawUnderline(forGlyphRange glyphRange: NSRange, underlineType: NSUnderlineStyle, baselineOffset: CGFloat,
                                lineFragmentRect lineRect: NSRect, lineFragmentGlyphRange lineGlyphRange: NSRange, containerOrigin: NSPoint) {
        let chars = characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
        guard let storage = textStorage, chars.length > 0, NSMaxRange(chars) <= storage.length,
              let geometry = (storage.attribute(.foleviUnderlineOffset, at: chars.location, effectiveRange: nil) as? NSValue)?.sizeValue,
              let container = textContainer(forGlyphAt: glyphRange.location, effectiveRange: nil) else {
            super.drawUnderline(forGlyphRange: glyphRange, underlineType: underlineType, baselineOffset: baselineOffset,
                                lineFragmentRect: lineRect, lineFragmentGlyphRange: lineGlyphRange, containerOrigin: containerOrigin)
            return
        }
        let color = storage.attribute(.underlineColor, at: chars.location, effectiveRange: nil) as? NSColor
            ?? storage.attribute(.foregroundColor, at: chars.location, effectiveRange: nil) as? NSColor
            ?? .textColor
        let bounds = boundingRect(forGlyphRange: glyphRange, in: container)
        // `location(forGlyphAt:)` is relative to the line fragment; its y is the baseline.
        let baseline = lineRect.minY + location(forGlyphAt: glyphRange.location).y
        let rect = NSRect(x: bounds.minX + containerOrigin.x, y: baseline + geometry.height + containerOrigin.y,
                          width: bounds.width, height: geometry.width)
        color.setFill()
        rect.fill(using: .sourceOver)
    }
}
