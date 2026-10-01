import AppKit

/// The block text's layout manager. It draws underlines carrying `.foleviUnderlineOffset` the way
/// editor.css sets them (`text-decoration-thickness` and `text-underline-offset`, measured from the
/// baseline): links, and underlined text on a note style palette. Other underlines are AppKit's own.
final class FoleviLayoutManager: NSLayoutManager {
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
