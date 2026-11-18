// The frame's dialogs. On the Mac they are the system's (owner decision 2026-11-18, docs/MAC_NATIVE_LOOK.md): a
// dialog or the command palette is a sheet on the frame's window, a panel anchored to a control (the bell's
// notifications) is an NSPopover; Escape or ⌘. closes either, Return presses a dialog's default button, and the
// keyboard goes back to what had it. The dialog pieces (WebSheetDialog, WebSheetButton, WebSheetFooter) are drawn in
// the system font and colours there, with the system's buttons.
// On the iPad they are still the web's (globals.css `dialog.ui-pop`): over the whole window with a clear backdrop,
// in frosted glass (82% surface over a 24 pt blur); a tap on the backdrop closes it.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import CoreImage
import SwiftUI
import FoleviDesign
import FoleviScreens

@MainActor
public enum FrameSheets {
    private final class Shown {
        let host: NSView
        let monitor: Any?
        /// The Mac's Escape monitor (set once the sheet or popover is up).
        var monitorBox: Any?
        let onClose: (() -> Void)?
        /// (The iPad's hosting controller, kept while its view shows.)
        var keep: AnyObject?
        /// The window's resize notifications (the backdrop drawn again).
        var observers: [Any] = []
        #if os(macOS)
        /// What had the window's keyboard before the dialog took it (the note's page, a field of the frame), and
        /// the route on screen then: the keyboard goes back there when the dialog closes.
        weak var returnTo: NSResponder?
        var route: FrameRoute?
        /// The frame's window, the dialog's sheet on it, or the panel's popover.
        weak var parent: NSWindow?
        var sheet: NSWindow?
        var popover: NSPopover?
        #endif
        init(host: NSView, monitor: Any?, onClose: (() -> Void)?) {
            self.host = host
            self.monitor = monitor
            self.onClose = onClose
        }
    }

    private struct WeakWindow { weak var window: NSWindow? }
    private static var windows: [ObjectIdentifier: WeakWindow] = [:]
    private static var shown: [ObjectIdentifier: Shown] = [:]
    #if os(macOS)
    private struct WeakView { weak var view: NSView? }
    private static var pages: [ObjectIdentifier: WeakView] = [:]

    /// The frame's Page View (its content registers it): a dialog closed over a note gives it the keyboard back.
    static func attach(_ model: FrameModel, page: NSView) {
        pages[ObjectIdentifier(model)] = WeakView(view: page)
    }

    /// What has the window's keyboard, as something that can take it again (a text field for its field editor);
    /// nil when nothing has.
    private static func keyboardOwner(_ window: NSWindow) -> NSResponder? {
        let responder = window.firstResponder
        if let editor = responder as? NSTextView, editor.isFieldEditor, let field = editor.delegate as? NSView { return field }
        return responder === window ? nil : responder
    }

    /// A dialog is closing: the keyboard goes back to what had it before (⌘K over a note, then Escape, and typing
    /// goes on in the note), unless something took it meanwhile. On another route by now (the palette opened a note),
    /// the note's page takes it when a note is on screen.
    private static func returnKeyboard(from s: Shown, model: FrameModel) {
        guard let window = s.parent else { return }
        if s.route != model.route {
            if model.route.isNote, let page = pages[ObjectIdentifier(model)]?.view, page.window === window { window.makeFirstResponder(page) }
            return
        }
        let now = window.firstResponder
        guard now == nil || now === window else { return }
        if let view = s.returnTo as? NSView, view.window === window, !view.isHiddenOrHasHiddenAncestor { window.makeFirstResponder(view) }
    }

    /// The bell (or another control) a popover panel opens from: the frame registers it before it opens one.
    private static var anchors: [ObjectIdentifier: WeakView] = [:]
    public static func attach(_ model: FrameModel, popoverAnchor view: NSView?) {
        anchors[ObjectIdentifier(model)] = WeakView(view: view)
    }

    /// The sheet a dialog shows in (tests, the palette's early keys).
    static func sheetWindow(for model: FrameModel) -> NSWindow? { shown[ObjectIdentifier(model)]?.sheet }

    /// The popover a panel shows in (tests).
    static func popover(for model: FrameModel) -> NSPopover? { shown[ObjectIdentifier(model)]?.popover }

    /// Closes the panel's entry when the popover goes by itself (a click outside it).
    private final class PopoverWatcher: NSObject, NSPopoverDelegate {
        weak var model: FrameModel?
        init(model: FrameModel) { self.model = model }
        func popoverDidClose(_ notification: Notification) {
            MainActor.assumeIsolated {
                guard let model, let s = FrameSheets.shown[ObjectIdentifier(model)], s.popover === notification.object as? NSPopover else { return }
                FrameSheets.dismiss(model)
            }
        }
    }

    /// The Mac's presentation: a sheet on the window (a dialog, the palette), or a popover from a control (a panel
    /// at `leading`).
    private static func presentMac(_ model: FrameModel, leading: CGFloat?, top: CGFloat?, onClose: (() -> Void)?, content: AnyView) {
        let key = ObjectIdentifier(model)
        let replaced = shown[key]
        dismiss(model, notify: false, returnKeyboard: false)
        guard let window = window(for: model), let root = window.contentView else { return }
        let returnTo = replaced != nil ? replaced?.returnTo : keyboardOwner(window)
        let route = replaced?.route ?? model.route
        let close: @MainActor () -> Void = { [weak model] in if let model { FrameSheets.dismiss(model) } }
        let entry: Shown
        if leading != nil {
            let controller = NSHostingController(rootView: content)
            controller.sizingOptions = .preferredContentSize
            let popover = NSPopover()
            popover.behavior = .transient
            popover.animates = !WebMotion.reduced
            popover.contentViewController = controller
            let watcher = PopoverWatcher(model: model)
            popover.delegate = watcher
            entry = Shown(host: controller.view, monitor: nil, onClose: onClose)
            entry.keep = watcher
            entry.popover = popover
            entry.parent = window
            shown[key] = entry
            if let anchor = anchors[key]?.view, anchor.window === window {
                popover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: anchor.isFlipped ? .maxY : .minY)
            } else if window.isVisible {
                // (No control registered: where the panel used to drop from, under the sidebar's top bar.)
                let y = root.isFlipped ? (top ?? 0) : root.bounds.height - (top ?? 0)
                popover.show(relativeTo: NSRect(x: (leading ?? 0) + 8, y: y, width: 24, height: 1), of: root, preferredEdge: root.isFlipped ? .maxY : .minY)
            }
        } else {
            let host = SheetHostingView(rootView: content)
            host.sizingOptions = [.minSize, .maxSize]
            let size = host.fittingSize
            let sheet = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
            sheet.titleVisibility = .hidden
            sheet.titlebarAppearsTransparent = true
            sheet.isReleasedWhenClosed = false
            sheet.contentView = host
            sheet.initialFirstResponder = host
            entry = Shown(host: host, monitor: nil, onClose: onClose)
            entry.sheet = sheet
            entry.parent = window
            shown[key] = entry
            // (A window that isn't on screen, as in unit tests, gets no sheet: the dialog is still the frame's.)
            if window.isVisible { window.beginSheet(sheet) }
        }
        // Escape and ⌘. close it, wherever the focus is inside it (AppKit's field editor keeps Escape otherwise).
        let target: NSWindow? = entry.sheet ?? entry.popover?.contentViewController?.view.window
        entry.monitorBox = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak sheet = entry.sheet, weak popover = entry.popover] e in
            let mine = (sheet != nil && e.window === sheet) || (popover != nil && e.window === popover?.contentViewController?.view.window) || (target == nil && e.window === window)
            guard mine else { return e }
            let cmdDot = e.modifierFlags.contains(.command) && e.charactersIgnoringModifiers == "."
            if e.keyCode == 53 || cmdDot {
                close()
                return nil
            }
            return e
        }
        entry.returnTo = returnTo
        entry.route = route
    }
    #endif

    /// The window a frame draws in (its sidebar registers it).
    public static func attach(_ model: FrameModel, window: NSWindow?) {
        windows[ObjectIdentifier(model)] = WeakWindow(window: window)
    }

    static func window(for model: FrameModel) -> NSWindow? {
        windows[ObjectIdentifier(model)]?.window ?? NSApp.keyWindow ?? NSApp.mainWindow
    }

    /// Whether a dialog is on screen in this frame's window (tests, the eval hook).
    public static func isShowing(_ model: FrameModel) -> Bool { shown[ObjectIdentifier(model)] != nil }

    /// Shows `content` as the frame's dialog (replacing one already shown): in the middle of the window (the owner,
    /// 5 November 2026), or attached at `top` (the command palette, a popover at `leading`).
    /// `scrim`: the window behind dims (the command palette: it stands apart from the sidebar's labels, MAC-45).
    static func present<Content: View>(_ model: FrameModel, top: CGFloat? = nil, leading: CGFloat? = nil, scrim: Bool = false, onClose: (() -> Void)? = nil, @ViewBuilder content: (_ close: @escaping @MainActor () -> Void) -> Content) {
        #if os(macOS)
        let close: @MainActor () -> Void = { [weak model] in if let model { FrameSheets.dismiss(model) } }
        presentMac(model, leading: leading, top: top, onClose: onClose, content: AnyView(content(close)))
        #else
        presentDrawn(model, top: top, leading: leading, scrim: scrim, onClose: onClose, content: content)
        #endif
    }

    #if os(iOS)
    /// The iPad's dialog: drawn over the window as the web's.
    private static func presentDrawn<Content: View>(_ model: FrameModel, top: CGFloat? = nil, leading: CGFloat? = nil, scrim: Bool = false, onClose: (() -> Void)? = nil, @ViewBuilder content: (_ close: @escaping @MainActor () -> Void) -> Content) {
        dismiss(model, notify: false)
        guard let window = window(for: model) else { return }
        let root: UIView = window
        let key = ObjectIdentifier(model)
        let close: @MainActor () -> Void = { [weak model] in if let model { FrameSheets.dismiss(model) } }
        let backdrop = SheetBackdropImage(image: blurredSnapshot(of: root))
        let layer = SheetLayer(top: top, leading: leading, scrim: scrim, close: close, content: content(close))
            .environment(\.sheetBackdrop, backdrop)
        let observers: [Any] = []
        let controller = UIHostingController(rootView: AnyView(layer))
        controller.safeAreaRegions = []
        controller.view.backgroundColor = .clear
        let host: UIView = controller.view
        host.frame = root.bounds
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.addSubview(host)
        let keep: AnyObject? = controller
        // Escape and ⌘. close it (a hardware keyboard).
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
        entry.observers = observers
        shown[key] = entry
    }
    #endif

    /// Closes every frame's dialog (the eval hook between screens).
    public static func dismissAll() {
        for (key, s) in shown {
            shown[key] = nil
            if let m = s.monitor { NSEvent.removeMonitor(m) }
            if let m = s.monitorBox { NSEvent.removeMonitor(m) }
            s.observers.forEach(NotificationCenter.default.removeObserver)
            #if os(macOS)
            if s.sheet != nil || s.popover != nil { takeAway(s); continue }
            #endif
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

    /// `returnKeyboard`: false when another dialog is about to take this one's place.
    static func dismiss(_ model: FrameModel, notify: Bool = true, returnKeyboard: Bool = true) {
        let key = ObjectIdentifier(model)
        guard let s = shown.removeValue(forKey: key) else { return }
        s.observers.forEach(NotificationCenter.default.removeObserver)
        if let m = s.monitor { NSEvent.removeMonitor(m) }
        if let m = s.monitorBox { NSEvent.removeMonitor(m) }
        #if os(macOS)
        if s.sheet != nil || s.popover != nil {
            takeAway(s)
        } else {
            fadeAway(s.host)
        }
        if returnKeyboard { Self.returnKeyboard(from: s, model: model) }
        #else
        fadeAway(s.host)
        #endif
        if notify { s.onClose?() }
    }

    #if os(macOS)
    /// The sheet ends (the system's animation) or the popover closes.
    private static func takeAway(_ s: Shown) {
        if let sheet = s.sheet {
            if let parent = sheet.sheetParent { parent.endSheet(sheet) } else { sheet.orderOut(nil) }
        }
        if let popover = s.popover, popover.isShown { popover.performClose(nil) }
    }
    #endif

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
final class SheetHostingView: ClickThroughHostingView<AnyView> {
    /// Going away: no longer takes clicks.
    var fading = false
    override func hitTest(_ point: NSPoint) -> NSView? { fading ? nil : (super.hitTest(point) ?? self) }
    override var acceptsFirstResponder: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }
}
#endif

private struct SheetLayer<Content: View>: View {
    /// Where it attaches from the top; nil: in the middle of the window, both ways.
    let top: CGFloat?
    /// A popover's left edge (nil: centred, as a dialog).
    let leading: CGFloat?
    /// A dimmed backdrop (MAC-45); clear otherwise, as the web's Mac dialogs are.
    var scrim = false
    let close: @MainActor () -> Void
    let content: Content
    @Environment(\.colorScheme) private var scheme
    @State private var dimmed = false

    /// The palette's scrim: the window behind a step back, stronger in the dark (the sidebar's light labels).
    static func scrimOpacity(_ scheme: ColorScheme) -> Double { scheme == .dark ? 0.32 : 0.1 }

    var body: some View {
        let alignment: Alignment = leading != nil ? .topLeading : top == nil ? .center : .top
        ZStack(alignment: alignment) {
            Color.black.opacity(scrim && dimmed ? Self.scrimOpacity(scheme) : 0.0001)
                .contentShape(Rectangle())
                .onTapGesture { close() } // (no hover: the scrim)
                .onAppear { withAnimation(.easeOut(duration: WebMotion.sheetIn)) { dimmed = true } }
            // A dialog drops in from above (`mac-sheet-in`), a popover rises (`mac-pop-in`).
            Group {
                if leading == nil { content.webSheetIn() } else { content.webPopIn() }
            }
            .padding(.top, top ?? 0).padding(.leading, leading ?? 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
    }
}

/// The blurred window behind a dialog. It's redrawn when the window changes size under the dialog, so the frost
/// still lines up with and covers the window (MAC-44).
struct SheetBackdropImage: @unchecked Sendable {
    @Observable final class Box: @unchecked Sendable {
        var image: NSImage?
        init(_ image: NSImage?) { self.image = image }
    }

    let box: Box
    init(image: NSImage?) { box = Box(image) }
    var image: NSImage? { box.image }
}

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
        #if os(macOS)
        // The sheet or popover is the surface (the system's material, corners and shadow): only the width here.
        content.frame(width: width ?? s.width)
        #else
        let shape = RoundedRectangle(cornerRadius: s.radius, style: .circular)
        content
            .frame(width: width ?? s.width)
            .clipShape(shape)
            .webBox(style)
            .background(WebBackdrop().clipShape(shape))
            .overlay(shape.strokeBorder(moreVar("mac-pop-edge", scheme), lineWidth: 0.5))
        #endif
    }
}

/// `<Dialog>` (components/ui/Dialog.tsx): a title with an optional description and a Close button, the body, and an
/// optional footer. The Mac draws it in the system's type inside a sheet; the iPad as the web (a Spectral title).
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
        #if os(macOS)
        // A sheet's content in the system's type: the title (13 pt bold), what will happen in the secondary label
        // colour, the body, the buttons at the end.
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: MacLook.Space.m) {
                VStack(alignment: .leading, spacing: MacLook.Space.xs) {
                    // (One line, cut in the middle: a long name loses its middle and the question keeps its "?", MAC-11.)
                    Text(verbatim: title).font(MacLook.Text.headline).lineLimit(1).truncationMode(.middle)
                        .foregroundStyle(MacLook.Colors.label)
                        .accessibilityAddTraits(.isHeader)
                    if let description {
                        Text(verbatim: description).font(MacLook.Text.body).foregroundStyle(MacLook.Colors.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebSheetCloseButton(action: close)
            }
            .padding(.horizontal, MacLook.Space.l + 4).padding(.top, MacLook.Space.l + 4).padding(.bottom, MacLook.Space.m)
            content()
                .padding(.horizontal, MacLook.Space.l + 4).padding(.bottom, MacLook.Space.l)
                .frame(maxWidth: .infinity, alignment: .leading)
            footer()
        }
        .modifier(WebSheetPanel(style: WebStyles.named("more.dialog.sm"), width: width))
        #else
        let header = moreStyle("more.dialog.header", scheme)
        let t = moreStyle("more.dialog.title", scheme)
        let b = moreStyle("more.dialog.body", scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: header.gap) {
                VStack(alignment: .leading, spacing: 4) {
                    // (One line: a Spectral line box is taller than its leading in SwiftUI's multi-line layout. Cut in
                    // the middle, so a long name inside it loses its middle and the question keeps its end, its "?"
                    // included: MAC-11.)
                    Text(verbatim: title).webText(t.text).lineLimit(1).truncationMode(.middle).foregroundStyle(t.color.color)
                    if let description {
                        WebPrettyText(description, style: .role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebSheetCloseButton(action: close)
            }
            .padding(header.padding.edgeInsets)
            content()
                .padding(b.padding.edgeInsets)
                // (On an iPad the body follows the title closely: the header's own padding is room enough there.)
                .padding(.top, WebStyles.isPad ? min(0, 4 - b.padding.top) : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
            footer()
        }
        .modifier(WebSheetPanel(style: WebStyles.named("more.dialog.sm"), width: width))
        #endif
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

/// A dialog's button: the system's push button on the Mac (the default one in Folevi's accent), `ui-btn` secondary
/// or primary at 28 pt on the iPad (more.prompt.cancel / submit).
/// Keys (MAC-09): Return presses a primary button and Escape the secondary (Cancel); a destructive button never
/// answers Return (it takes a click, as the web's and the Settings confirmations: MAC-03).
struct WebSheetButton: View {
    let title: String
    var primary = false
    var danger = false
    var enabled = true
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    enum Key: Equatable { case defaultAction, cancelAction, none }

    /// Which key presses a dialog button.
    nonisolated static func key(primary: Bool, danger: Bool) -> Key {
        danger ? .none : primary ? .defaultAction : .cancelAction
    }

    var body: some View {
        #if os(macOS)
        // The system's push buttons: the default one in Folevi's accent, a destructive one red, the others plain.
        Group {
            if primary, !danger {
                Button { if enabled { action() } } label: {
                    Text(verbatim: title).lineLimit(1).fixedSize().frame(minWidth: 56)
                }
                .buttonStyle(MacProminentButtonStyle())
            } else {
                Button(role: danger ? .destructive : nil) { if enabled { action() } } label: {
                    Text(verbatim: title).lineLimit(1).fixedSize().frame(minWidth: 56)
                }
                .buttonStyle(.bordered)
                .foregroundStyle(danger ? MacLook.Colors.red : MacLook.Colors.label)
            }
        }
        .font(MacLook.Text.body)
        .controlSize(.large)
        .modifier(DialogKey(key: Self.key(primary: primary, danger: danger)))
        .disabled(!enabled)
        #else
        let style = danger ? WebStyles.named("button.danger.md") : WebStyles.named(primary ? "more.prompt.submit" : "more.prompt.cancel")
        let s = style.resolve(scheme)
        Button { if enabled { action() } } label: {
            Text(verbatim: title).webText(s.text).lineLimit(1).fixedSize()
                .padding(s.padding.edgeInsets)
                .frame(height: WebStyles.named("more.prompt.cancel").light.height)
                .foregroundStyle(s.color.color)
                .webBox(style)
        }
        .buttonStyle(.webHover(radius: s.radius, selected: !enabled || primary || danger))
        .webBrightHover(active: enabled && (primary || danger))
        .modifier(DialogKey(key: Self.key(primary: primary, danger: danger)))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        #endif
    }

    private struct DialogKey: ViewModifier {
        let key: Key
        func body(content: Content) -> some View {
            switch key {
            case .defaultAction: content.keyboardShortcut(.defaultAction)
            case .cancelAction: content.keyboardShortcut(.cancelAction)
            case .none: content
            }
        }
    }
}

#if os(macOS)
/// The one prominent action of a sheet: a capsule as tall as the system's large push buttons, in Folevi's accent
/// with its ink while the window is active, the quaternary fill and the label colour while it isn't (as the system
/// greys its default button), dimmed while disabled.
struct MacProminentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Face(configuration: configuration) }

    private struct Face: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.controlActiveState) private var active
        @Environment(\.isEnabled) private var enabled
        var body: some View {
            let on = active != .inactive && enabled
            configuration.label
                .foregroundStyle(on ? MacLook.Colors.onAccent : MacLook.Colors.label)
                .padding(.horizontal, 14)
                .frame(minHeight: 28)
                .background(Capsule().fill(on ? MacLook.Colors.accent : MacLook.Colors.hover))
                .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
                .contentShape(Capsule())
        }
    }
}
#endif

/// A dialog's Close (ui/Dialog.tsx's IconButton): the muted ×, the glass hover and heading ink under the pointer,
/// the Mac's press fill. One for the frame's dialogs and the planner's (MAC-10).
struct WebSheetCloseButton: View {
    let action: @MainActor () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        #if os(macOS)
        // The system's: a small xmark in the secondary label colour, the quaternary hover fill, a tooltip.
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(over ? MacLook.Colors.label : MacLook.Colors.secondary)
                .frame(width: 22, height: 22)
                .background(Circle().fill(over ? MacLook.Colors.hover : .clear))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { over = $0 }
        .foleviTooltip("Close")
        .accessibilityLabel("Close")
        #else
        let xs = WebStyles.named("more.dialog.close").resolve(scheme)
        Button(action: action) {
            WebIconView(.x, size: 16)
                .foregroundStyle(over ? moreVar("color-heading", scheme) : xs.color.color)
                .frame(width: xs.width, height: xs.height)
                .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: xs.radius, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: false))
        .onHover { over = $0 }
        .foleviTooltip("Close")
        .accessibilityLabel("Close")
        #endif
    }
}
#endif
