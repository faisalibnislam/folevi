// Dialogs as Folevi for Mac shows them (globals.css `:root[data-desktop="mac"] dialog.ui-pop`): over the whole
// window with a clear backdrop, attached at the top (56 pt down, or where the dialog's own margin puts it, as
// ⌘K's 12vh), centred across the window, in frosted glass (82% surface over a 24 pt blur) with the Mac sheet
// shadow. A click on the backdrop, Escape or ⌘. closes it; the window behind takes no clicks meanwhile.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import CoreImage
import SwiftUI
import FoleviDesign

@MainActor
public enum FrameSheets {
    private final class Shown {
        let host: NSView
        let monitor: Any?
        let onClose: (() -> Void)?
        /// (The iPad's hosting controller, kept while its view shows.)
        var keep: AnyObject?
        init(host: NSView, monitor: Any?, onClose: (() -> Void)?) {
            self.host = host
            self.monitor = monitor
            self.onClose = onClose
        }
    }

    private struct WeakWindow { weak var window: NSWindow? }
    private static var windows: [ObjectIdentifier: WeakWindow] = [:]
    private static var shown: [ObjectIdentifier: Shown] = [:]

    /// The window a frame draws in (its sidebar registers it).
    static func attach(_ model: FrameModel, window: NSWindow?) {
        windows[ObjectIdentifier(model)] = WeakWindow(window: window)
    }

    static func window(for model: FrameModel) -> NSWindow? {
        windows[ObjectIdentifier(model)]?.window ?? NSApp.keyWindow ?? NSApp.mainWindow
    }

    /// Whether a dialog is on screen in this frame's window (tests, the eval hook).
    public static func isShowing(_ model: FrameModel) -> Bool { shown[ObjectIdentifier(model)] != nil }

    /// Shows `content` as the frame's dialog (replacing one already shown). `top` is where it attaches.
    static func present<Content: View>(_ model: FrameModel, top: CGFloat = 56, leading: CGFloat? = nil, onClose: (() -> Void)? = nil, @ViewBuilder content: (_ close: @escaping @MainActor () -> Void) -> Content) {
        dismiss(model, notify: false)
        #if os(macOS)
        guard let window = window(for: model), let root = window.contentView else { return }
        #else
        guard let window = window(for: model) else { return }
        let root: UIView = window
        #endif
        let key = ObjectIdentifier(model)
        let close: @MainActor () -> Void = { [weak model] in if let model { FrameSheets.dismiss(model) } }
        let layer = SheetLayer(top: top, leading: leading, close: close, content: content(close))
            .environment(\.sheetBackdrop, SheetBackdropImage(image: blurredSnapshot(of: root)))
        #if os(macOS)
        let host = SheetHostingView(rootView: AnyView(layer))
        host.safeAreaRegions = []
        host.frame = root.bounds
        host.autoresizingMask = [.width, .height]
        root.addSubview(host, positioned: .above, relativeTo: nil)
        // The dialog takes the keys (its field gets the focus, as `autoFocus` gives it).
        window.makeFirstResponder(host)
        let keep: AnyObject? = nil
        #else
        let controller = UIHostingController(rootView: AnyView(layer))
        controller.safeAreaRegions = []
        controller.view.backgroundColor = .clear
        let host: UIView = controller.view
        host.frame = root.bounds
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.addSubview(host)
        let keep: AnyObject? = controller
        #endif
        // Escape and ⌘. close it, wherever the focus is inside it (AppKit's field editor keeps Escape otherwise).
        let monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            guard e.window === window else { return e }
            let cmdDot = e.modifierFlags.contains(.command) && e.charactersIgnoringModifiers == "."
            if e.keyCode == 53 || cmdDot {
                close()
                return nil
            }
            return e
        }
        let entry = Shown(host: host, monitor: monitor, onClose: onClose)
        entry.keep = keep
        shown[key] = entry
    }

    /// Closes every frame's dialog (the eval hook between screens).
    public static func dismissAll() {
        for (key, s) in shown {
            shown[key] = nil
            if let m = s.monitor { NSEvent.removeMonitor(m) }
            s.host.removeFromSuperview()
        }
    }

    /// The window as it is, blurred as `backdrop-filter: blur(24px) saturate(1.8)` treats what's behind a dialog (a
    /// Gaussian with a 24 pt standard deviation, edges extended). Drawn under the dialog's fill, aligned to the window.
    static func blurredSnapshot(of view: NSView) -> NSImage? {
        blurred(view, rect: view.bounds)
    }

    /// One Core Image context for every backdrop (making one costs more than the blur itself).
    private static let ciContext = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, .cacheIntermediates: false])

    /// `rect` of `view` (its own coordinates) as `backdrop-filter: blur(24px) saturate(1.8)` shows it: drawn with
    /// 72 pt round it (three standard deviations, so the edges blur as the page's do), blurred, cut back to `rect`.
    static func blurred(_ view: NSView, rect: NSRect) -> NSImage? {
        let reach = rect == view.bounds ? 0 : 72
        let area = rect.insetBy(dx: -CGFloat(reach), dy: -CGFloat(reach)).intersection(view.bounds)
        #if os(macOS)
        guard !area.isEmpty, let rep = view.bitmapImageRepForCachingDisplay(in: area) else { return nil }
        view.cacheDisplay(in: area, to: rep)
        guard let cg = rep.cgImage else { return nil }
        let scale = CGFloat(rep.pixelsWide) / max(1, area.width)
        let flipped = view.isFlipped
        #else
        guard !area.isEmpty else { return nil }
        let picture = UIGraphicsImageRenderer(bounds: area).image { _ in _ = view.drawHierarchy(in: view.bounds, afterScreenUpdates: false) }
        guard let cg = picture.cgImage else { return nil }
        let scale = picture.scale
        // (UIKit's views are top-down, as a flipped AppKit view is.)
        let flipped = true
        #endif
        let input = CIImage(cgImage: cg)
        let saturate = CIFilter(name: "CIColorControls")
        saturate?.setValue(input, forKey: kCIInputImageKey)
        saturate?.setValue(1.8, forKey: kCIInputSaturationKey)
        guard let saturated = saturate?.outputImage, let blur = CIFilter(name: "CIGaussianBlur") else { return nil }
        blur.setValue(saturated.clampedToExtent(), forKey: kCIInputImageKey)
        blur.setValue(24 * scale, forKey: kCIInputRadiusKey)
        // The part wanted, in the picture's pixels (Core Image's origin is at the bottom left; a flipped view's isn't).
        let dx = (rect.minX - area.minX) * scale
        let dy = (flipped ? area.maxY - rect.maxY : rect.minY - area.minY) * scale
        let crop = CGRect(x: dx, y: dy, width: rect.width * scale, height: rect.height * scale).intersection(input.extent)
        guard let out = blur.outputImage?.cropped(to: crop),
              let image = ciContext.createCGImage(out, from: crop, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)) else { return nil }
        #if os(macOS)
        return NSImage(cgImage: image, size: NSSize(width: crop.width / scale, height: crop.height / scale))
        #else
        return UIImage(cgImage: image, scale: scale, orientation: .up)
        #endif
    }

    static func dismiss(_ model: FrameModel, notify: Bool = true) {
        let key = ObjectIdentifier(model)
        guard let s = shown.removeValue(forKey: key) else { return }
        if let m = s.monitor { NSEvent.removeMonitor(m) }
        fadeAway(s.host)
        if notify { s.onClose?() }
    }

    /// Takes a dialog away as macOS does: a short fade, then gone (at once with Reduce Motion).
    private static func fadeAway(_ host: NSView) {
        #if os(macOS)
        guard !WebMotion.reduced, host.window != nil else { return host.removeFromSuperview() }
        // (It takes no clicks while it fades: the next dialog, or the page, has them.)
        (host as? SheetHostingView)?.fading = true
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = WebMotion.fadeOut
            host.animator().alphaValue = 0
        }, completionHandler: { MainActor.assumeIsolated { host.removeFromSuperview() } })
        #else
        guard !WebMotion.reduced else { return host.removeFromSuperview() }
        UIView.animate(withDuration: WebMotion.fadeOut, animations: { host.alpha = 0 }, completion: { _ in host.removeFromSuperview() })
        #endif
    }
}

#if os(macOS)
/// Takes every click over the window while a dialog shows (the page behind is inert, as under a modal <dialog>).
final class SheetHostingView: NSHostingView<AnyView> {
    /// Going away: no longer takes clicks.
    var fading = false
    override func hitTest(_ point: NSPoint) -> NSView? { fading ? nil : (super.hitTest(point) ?? self) }
    override var acceptsFirstResponder: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }
}
#endif

private struct SheetLayer<Content: View>: View {
    let top: CGFloat
    /// A popover's left edge (nil: centred, as a dialog).
    let leading: CGFloat?
    let close: @MainActor () -> Void
    let content: Content

    var body: some View {
        ZStack(alignment: leading == nil ? .top : .topLeading) {
            Color.black.opacity(0.0001)
                .contentShape(Rectangle())
                .onTapGesture { close() }
            // A dialog drops in from above (`mac-sheet-in`), a popover rises (`mac-pop-in`).
            Group {
                if leading == nil { content.webSheetIn() } else { content.webPopIn() }
            }
            .padding(.top, top).padding(.leading, leading ?? 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: leading == nil ? .top : .topLeading)
    }
}

struct SheetBackdropImage: @unchecked Sendable { let image: NSImage? }

private struct SheetBackdropKey: EnvironmentKey {
    static let defaultValue = SheetBackdropImage(image: nil)
}

extension EnvironmentValues {
    /// The blurred window behind the dialog on screen.
    var sheetBackdrop: SheetBackdropImage {
        get { self[SheetBackdropKey.self] }
        set { self[SheetBackdropKey.self] = newValue }
    }
}

/// The frosted surface under a dialog (`backdrop-filter: blur(24px)` under its 82% fill): the blurred window,
/// placed where the dialog sits in it.
struct WebBackdrop: View {
    @Environment(\.sheetBackdrop) private var backdrop

    var body: some View {
        GeometryReader { g in
            if let image = backdrop.image {
                let f = g.frame(in: .global)
                Image(platformImage: image)
                    .resizable()
                    .frame(width: image.size.width, height: image.size.height)
                    .offset(x: -f.minX, y: -f.minY)
            }
        }
    }
}

/// A dialog's panel: its glass and shadows from a computed style (more.dialog.sm, more.palette).
struct WebSheetPanel: ViewModifier {
    let style: WebStylePair
    var width: CGFloat? = nil
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let s = style.resolve(scheme)
        let shape = RoundedRectangle(cornerRadius: s.radius, style: .circular)
        content
            .frame(width: width ?? s.width)
            .clipShape(shape)
            .webBox(style)
            .background(WebBackdrop().clipShape(shape))
            .overlay(shape.strokeBorder(moreVar("mac-pop-edge", scheme), lineWidth: 0.5))
    }
}

/// `<Dialog>` (components/ui/Dialog.tsx) as the Mac draws it: a Spectral title with an optional description and
/// a Close button, the body, and an optional footer.
struct WebSheetDialog<Body: View, Footer: View>: View {
    let title: String
    var description: String? = nil
    /// `size="md"` dialogs are 480 pt on the Mac (`dialog.ui-pop.max-w-lg`); nil: the small one's 384.
    var width: CGFloat? = nil
    let close: @MainActor () -> Void
    @ViewBuilder let content: () -> Body
    @ViewBuilder let footer: () -> Footer
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let header = moreStyle("more.dialog.header", scheme)
        let t = moreStyle("more.dialog.title", scheme)
        let b = moreStyle("more.dialog.body", scheme)
        let x = WebStyles.named("more.dialog.close")
        let xs = x.resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: header.gap) {
                VStack(alignment: .leading, spacing: 4) {
                    // (One line: a Spectral line box is taller than its leading in SwiftUI's multi-line layout.)
                    Text(verbatim: title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    if let description {
                        WebPrettyText(description, style: .role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button(action: close) {
                    WebIconView(.x, size: 16).foregroundStyle(xs.color.color).frame(width: xs.width, height: xs.height).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foleviTooltip("Close")
                .accessibilityLabel("Close")
            }
            .padding(header.padding.edgeInsets)
            content()
                .padding(b.padding.edgeInsets)
                .frame(maxWidth: .infinity, alignment: .leading)
            footer()
        }
        .modifier(WebSheetPanel(style: WebStyles.named("more.dialog.sm"), width: width))
    }
}

extension WebSheetDialog where Footer == EmptyView {
    init(title: String, description: String? = nil, width: CGFloat? = nil, close: @escaping @MainActor () -> Void, @ViewBuilder content: @escaping () -> Body) {
        self.title = title
        self.description = description
        self.width = width
        self.close = close
        self.content = content
        self.footer = { EmptyView() }
    }
}

/// `.ui-input:focus` (globals.css): the input's box with the focus shadows, a soft drop and a 1.5 pt ring of the
/// heading colour at 16.5%.
@MainActor
func webFocused(_ pair: WebStylePair) -> WebStylePair {
    func focus(_ s: WebComputedStyle, _ scheme: ColorScheme) -> WebComputedStyle {
        var f = s
        let ring = (WebStyles.vars["color-heading"] ?? FoleviTokens.Chrome.surfaceSunken).resolve(scheme).opacity(0.165)
        f.shadows = [ShadowLayer(x: 0, y: 1, blur: 3, spread: 0, color: RGBA(0, 0, 0, 0.08)), ShadowLayer(x: 0, y: 0, blur: 0, spread: 1.5, color: ring)]
        return f
    }
    return WebStylePair(light: focus(pair.light, .light), dark: focus(pair.dark, .dark))
}

/// A dialog's button: `ui-btn` secondary or primary at the Mac's 28 pt (more.prompt.cancel / submit).
struct WebSheetButton: View {
    let title: String
    var primary = false
    var danger = false
    var enabled = true
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let style = danger ? WebStyles.named("button.danger.md") : WebStyles.named(primary ? "more.prompt.submit" : "more.prompt.cancel")
        let s = style.resolve(scheme)
        Button { if enabled { action() } } label: {
            Text(verbatim: title).webText(s.text).lineLimit(1).fixedSize()
                .padding(s.padding.edgeInsets)
                .frame(height: WebStyles.named("more.prompt.cancel").light.height)
                .foregroundStyle(s.color.color)
                .webBox(style)
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.4)
    }
}
#endif
