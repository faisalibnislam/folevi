// The web's icons as images, for the places that take only an image or a symbol's name: system menus (a SwiftUI
// `Label` in a context menu, a UIAction, an NSMenuItem), swipe actions, the Mac sidebar and tab strip. Drawn as
// templates from the same paths as WebIconView, so the menu or row tints them as it does an SF Symbol.
//
// `FoleviGlyph` names them where an API carries a symbol's name as a string: "web:<icon>" (FoleviGlyph.name(.x))
// is one of the web's icons, anything else an SF Symbol. a bookmark is drawn this way.
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public enum FoleviGlyph {
    static let prefix = "web:"

    /// The name that stands for `icon` where a symbol's name is expected.
    public static func name(_ icon: WebIcon) -> String { prefix + icon.rawValue }

    /// The web icon `name` stands for, or nil for an SF Symbol's name.
    public static func webIcon(_ name: String) -> WebIcon? {
        guard name.hasPrefix(prefix) else { return nil }
        return WebIcon(rawValue: String(name.dropFirst(prefix.count)))
    }

    /// `name` as a SwiftUI image: the web icon at `size` points, or the SF Symbol (sized by the font, as before).
    public static func image(_ name: String, size: CGFloat = 17) -> Image {
        if let icon = webIcon(name) { return icon.image(size: size) }
        return Image(systemName: name)
    }

    #if canImport(UIKit)
    /// `name` as a UIImage: the web icon at `size` points, or the SF Symbol.
    public static func uiImage(_ name: String, size: CGFloat = 17) -> UIImage? {
        if let icon = webIcon(name) { return icon.uiImage(size: size) }
        return UIImage(systemName: name)
    }
    #endif

    #if canImport(AppKit) && !targetEnvironment(macCatalyst)
    /// `name` as an NSImage: the web icon at `size` points, or the SF Symbol.
    public static func nsImage(_ name: String, size: CGFloat = 15, label: String? = nil) -> NSImage? {
        if let icon = webIcon(name) { return icon.nsImage(size: size, label: label) }
        return NSImage(systemSymbolName: name, accessibilityDescription: label)
    }
    #endif
}

public extension WebIcon {
    /// Strokes the icon into `rect` of a y-down context, `strokeWidth` on lucide's 24 pt grid (2, as the web).
    func draw(in ctx: CGContext, rect: CGRect, strokeWidth: CGFloat = 2, color: CGColor) {
        let scale = min(rect.width, rect.height) / 24
        ctx.saveGState()
        ctx.translateBy(x: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
        ctx.scaleBy(x: scale, y: scale)
        ctx.addPath(cgPath)
        ctx.setLineWidth(strokeWidth)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        ctx.setStrokeColor(color)
        ctx.strokePath()
        ctx.restoreGState()
    }

    /// The icon as a template SwiftUI `Image` at `size` points: for menus and labels that take only an image.
    func image(size: CGFloat = 17, strokeWidth: CGFloat = 2) -> Image {
        #if canImport(UIKit)
        Image(uiImage: uiImage(size: size, strokeWidth: strokeWidth)).renderingMode(.template)
        #else
        Image(nsImage: nsImage(size: size, strokeWidth: strokeWidth)).renderingMode(.template)
        #endif
    }

    #if canImport(UIKit)
    /// The icon at `size` points as a template UIImage (tinted by the menu, button or view that shows it).
    func uiImage(size: CGFloat = 17, strokeWidth: CGFloat = 2) -> UIImage {
        let image = UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { r in
            draw(in: r.cgContext, rect: CGRect(x: 0, y: 0, width: size, height: size), strokeWidth: strokeWidth, color: UIColor.black.cgColor)
        }
        return image.withRenderingMode(.alwaysTemplate)
    }
    #endif

    #if canImport(AppKit) && !targetEnvironment(macCatalyst)
    /// The icon at `size` points as a template NSImage (tinted by the menu, sidebar or tab that shows it).
    func nsImage(size: CGFloat = 15, strokeWidth: CGFloat = 2, label: String? = nil) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: true) { rect in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            draw(in: ctx, rect: rect, strokeWidth: strokeWidth, color: NSColor.black.cgColor)
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = label
        return image
    }
    #endif
}
