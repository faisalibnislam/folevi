// Folevi's own menus on the Mac, drawn as the web's (ui/Menu.tsx; owner decision 2026-10-27: Folevi menus,
// drawn natively, the top menu bar stays the system's): a WebMenuPanel in a borderless panel above the window,
// opened from a button or by a right click, with the keyboard (arrows, Return, Escape, type to select) and the
// pointer (hover highlights, a click picks, a click outside closes).
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign

/// Which button's menu is open, so that button keeps its open look while the pointer is in the menu (the web keeps
/// a menu's trigger in its active fill, MAC-43). Set by the Mac's WebMenuWindow; observed by WebMenuButton and
/// RowMoreButton.
@MainActor @Observable
final class WebMenuTrigger {
    static let shared = WebMenuTrigger()
    var open: ObjectIdentifier?
}

/// What a menu row does when picked.
public struct WebMenuEntry: Identifiable {
    public var item: WebMenuItem
    public var action: @MainActor () -> Void
    public var disabled: Bool
    public var id: String { item.id }

    public init(_ item: WebMenuItem, disabled: Bool = false, action: @escaping @MainActor () -> Void = {}) {
        self.item = item
        self.disabled = disabled
        self.action = action
    }

    public static func separator(_ n: Int = 0) -> WebMenuEntry { WebMenuEntry(.separator(n)) }
    public static func heading(_ t: String) -> WebMenuEntry { WebMenuEntry(.heading(t)) }
}

@MainActor
@Observable
final class WebMenuState {
    var highlighted: String?
    /// What's behind the panel, blurred and saturated (the web's backdrop-filter on Mac menus), once placed.
    var backdrop: NSImage?
    let entries: [WebMenuEntry]
    init(_ entries: [WebMenuEntry]) { self.entries = entries }

    var selectable: [WebMenuEntry] { entries.filter { $0.item.kind == .item && !$0.disabled } }

    /// The rows as the panel draws them: a disabled entry's row is drawn disabled (faded, no hover, no click: MAC-01).
    var panelItems: [WebMenuItem] { entries.map { $0.item.disabled($0.disabled || $0.item.disabled) } }

    func move(_ step: Int) {
        let list = selectable
        guard !list.isEmpty else { return }
        let i = list.firstIndex { $0.id == highlighted }.map { ($0 + step + list.count) % list.count } ?? (step > 0 ? 0 : list.count - 1)
        highlighted = list[i].id
    }
}

struct WebMenuContent: View {
    @Bindable var state: WebMenuState
    let width: CGFloat
    var select = false
    let pick: (WebMenuEntry) -> Void

    var body: some View {
        WebMenuPanel(state.panelItems, width: width, highlighted: state.highlighted, select: select, onSelect: { item in
            if let e = state.entries.first(where: { $0.id == item.id }), !e.disabled { pick(e) }
        }, onHover: { state.highlighted = $0 })
        .background {
            if let image = state.backdrop {
                Image(platformImage: image).resizable().clipShape(RoundedRectangle(cornerRadius: WebStyles.named("menu.panel").light.radius, style: .circular))
            }
        }
        .onContinuousHover { phase in
            if case .ended = phase { state.highlighted = nil }
        }
    }
}

#if os(macOS)
/// A borderless panel holding one menu. One at a time.
@MainActor
public final class WebMenuWindow: NSPanel {
    private static weak var current: WebMenuWindow?
    private var monitors: [Any] = []
    private let state: WebMenuState
    /// The button it opened from (nil: a right click), and its frame in the parent window: a click on it closes the
    /// menu and stops there, rather than opening it again (MAC-08).
    private weak var trigger: NSView?
    private var triggerRect: NSRect = .zero
    /// Room around the panel for its shadow (the web's --shadow-pop reaches ~30 pt).
    static let margin: CGFloat = 32

    private init(entries: [WebMenuEntry], width: CGFloat, select: Bool = false) {
        state = WebMenuState(entries)
        // A select opens on its chosen option (ui/Select.tsx sets it active).
        if select { state.highlighted = entries.first { $0.item.checked }?.id }
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .popUpMenu
        isReleasedWhenClosed = false
        let host = ClickThroughHostingView(rootView: WebMenuContent(state: state, width: width, select: select) { [weak self] e in self?.pick(e) }.padding(Self.margin).macClickThrough())
        host.safeAreaRegions = []
        contentView = host
        setContentSize(host.fittingSize)
    }

    override public var canBecomeKey: Bool { true }

    /// Which edge of its button a menu lines up with (MenuButton's `align`; the web's default is the end).
    public enum Align { case start, end }
    /// Which side of its button a menu opens on when there's room (MenuButton's `side`).
    public enum Side { case top, bottom }

    /// Opens the menu at `point` (window coordinates of `window`, bottom-left origin), as the web places a right-click
    /// menu: just below and after the pointer, above it when there's more room there, inside the window.
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 200, at point: NSPoint, in window: NSWindow) -> WebMenuWindow {
        show(entries, width: width, anchor: NSRect(origin: point, size: .zero), align: .start, in: window)
    }

    /// Opens the menu under a view, lined up with its end (or start) edge, 8 pt away; above it when there's more
    /// room there (ui/Menu.tsx's placement).
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 200, below view: NSView, align: Align = .end, side: Side = .bottom) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let menu = show(entries, width: width, anchor: view.convert(view.bounds, to: nil), align: align, side: side, in: window)
        menu.openedFrom(view)
        return menu
    }

    /// Remembers the button it opened from (MAC-08, MAC-43).
    private func openedFrom(_ view: NSView) {
        trigger = view
        triggerRect = view.convert(view.bounds, to: nil)
        WebMenuTrigger.shared.open = ObjectIdentifier(view)
    }

    /// Whether `view` opened the menu on screen (its trigger keeps its open look meanwhile).
    static func isOpen(from view: NSView?) -> Bool {
        guard let view, let m = shown, !m.closing else { return false }
        return m.trigger === view
    }

    /// What a mouse down outside the panel does (MAC-06, MAC-08): it always closes the menu; on the menu's own button
    /// it stops there (the button would open it again); anywhere else it goes on to what's under it, its window made
    /// key first so the one click acts.
    enum OutsideClick: Equatable { case closeAndPass, closeAndSwallow }

    nonisolated static func outsideClick(at point: NSPoint, inParent: Bool, left: Bool, trigger: NSRect) -> OutsideClick {
        inParent && left && trigger.width > 0 && trigger.height > 0 && trigger.contains(point) ? .closeAndSwallow : .closeAndPass
    }

    /// A select's list (ui/Select.tsx) under its trigger: at least as wide as it (180 at least), 6 below it, lined up
    /// with its start, the chosen option highlighted.
    @discardableResult
    public static func showSelect(_ entries: [WebMenuEntry], below view: NSView) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let a = view.convert(view.bounds, to: nil)
        let menu = show(entries, width: max(a.width, 180), anchor: a, align: .start, in: window, select: true, gap: 6)
        menu.openedFrom(view)
        return menu
    }

    /// ui/Menu.tsx `place()`: the gap is 8 from a button and 2 from a point, the menu stays 8 inside the window, and
    /// one taller than the window starts at its top.
    @discardableResult
    static func show(_ entries: [WebMenuEntry], width: CGFloat, anchor a: NSRect, align: Align, side: Side = .bottom, in window: NSWindow, select: Bool = false, gap fixedGap: CGFloat? = nil) -> WebMenuWindow {
        current?.close()
        let menu = WebMenuWindow(entries: entries, width: width, select: select)
        let w = menu.frame.width - margin * 2
        let h = menu.frame.height - margin * 2
        let bounds = window.contentView?.bounds ?? NSRect(origin: .zero, size: window.frame.size)
        let gap: CGFloat = fixedGap ?? (a.width > 0 || a.height > 0 ? 8 : 2)
        let edge: CGFloat = 8
        let below = a.minY - gap - edge - bounds.minY
        let above = bounds.maxY - a.maxY - gap - edge
        let up = side == .top ? !(above < h && below > above) : below < h && above > below
        var left = align == .end ? a.maxX - w : a.minX
        left = min(max(bounds.minX + edge, left), bounds.maxX - w - edge)
        var top = up ? a.maxY + gap + h : a.minY - gap
        top = min(bounds.maxY - edge, max(top, bounds.minY + edge + min(h, bounds.height - edge * 2)))
        let origin = window.convertPoint(toScreen: NSPoint(x: left, y: top - h))
        menu.setFrameOrigin(NSPoint(x: origin.x - margin, y: origin.y - margin))
        if let content = window.contentView {
            let r = content.convert(NSRect(x: left, y: top - h, width: w, height: h), from: nil)
            menu.state.backdrop = FrameSheets.blurred(content, rect: r)
        }
        // (A child window follows the app, not its parent: the parent's pinned appearance, Settings > Appearance.)
        menu.appearance = window.appearance
        window.addChildWindow(menu, ordered: .above)
        menu.makeKeyAndOrderFront(nil)
        menu.watch()
        current = menu
        return menu
    }

    /// The menu on screen, if any (tests, the eval hook).
    public static var shown: WebMenuWindow? { current?.isVisible == true ? current : nil }

    /// Its rows as text (the eval hook, menus.mjs): "—" for a separator, "# title" for a heading, an item's title
    /// with "[shortcut]", " ✓" when checked, " (off)" when disabled and " (danger)".
    public var rows: [String] {
        state.entries.map { e in
            switch e.item.kind {
            case .separator: return "—"
            case .heading: return "# \(e.item.title)"
            case .item:
                var t = e.item.title
                if let k = e.item.shortcut { t += " [\(k)]" }
                if e.item.checked { t += " ✓" }
                if e.disabled { t += " (off)" }
                if e.item.danger { t += " (danger)" }
                return t
            }
        }
    }

    /// The panel drawn as it is on screen, 2x, without its shadow's room (the eval hook, menus.mjs).
    public func snapshot() -> NSBitmapImageRep? {
        guard let view = contentView else { return nil }
        let inner = view.bounds.insetBy(dx: Self.margin, dy: Self.margin)
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: rep)
        let scale = CGFloat(rep.pixelsWide) / view.bounds.width
        let crop = CGRect(x: inner.minX * scale, y: (view.bounds.height - inner.maxY) * scale, width: inner.width * scale, height: inner.height * scale)
        guard let cg = rep.cgImage?.cropping(to: crop) else { return nil }
        return NSBitmapImageRep(cgImage: cg)
    }

    private func watch() {
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
            guard let self, event.window !== self else { return event }
            let decision = Self.outsideClick(at: event.locationInWindow, inParent: event.window != nil && event.window === self.parent, left: event.type == .leftMouseDown, trigger: self.triggerRect)
            self.close()
            if decision == .closeAndSwallow { return nil }
            OutsideClicks.prepare(event)
            return event
        } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.isVisible else { return event }
            switch event.keyCode {
            case 53: self.close()
            case 125: self.state.move(1)
            case 126: self.state.move(-1)
            case 36, 76:
                if let id = self.state.highlighted, let e = self.state.selectable.first(where: { $0.id == id }) { self.pick(e) }
            default:
                // Type to select: the next row starting with the letter.
                if let c = event.charactersIgnoringModifiers?.lowercased().first, c.isLetter {
                    let list = self.state.selectable
                    let start = list.firstIndex { $0.id == self.state.highlighted }.map { $0 + 1 } ?? 0
                    let order = Array(list[start...] + list[..<start])
                    if let hit = order.first(where: { $0.item.title.lowercased().first == c }) { self.state.highlighted = hit.id }
                }
            }
            return nil
        } as Any)
    }

    private func pick(_ e: WebMenuEntry) {
        close()
        DispatchQueue.main.async { MainActor.assumeIsolated { e.action() } }
    }

    private var closing = false

    /// Goes: a short fade (macOS's menus fade as they close), then closed.
    override public func close() {
        guard !closing else { return }
        closing = true
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
        if let t = trigger, WebMenuTrigger.shared.open == ObjectIdentifier(t) { WebMenuTrigger.shared.open = nil }
        // The window under it takes the keys again at once, not after the fade: a click there during the fade acts
        // the first time (MAC-06).
        handKeyBack()
        fadeAway { [weak self] in
            guard let self else { return }
            self.parent?.removeChildWindow(self)
            self.closeNow()
        }
    }

    private func closeNow() { super.close() }
}

/// Clicks outside Folevi's floating panels (menus, popovers): MAC-06.
@MainActor
enum OutsideClicks {
    /// A mouse down that closed a menu or popover goes on to the window under it. That window is made key here, before
    /// AppKit hands it the click: while the panel had the keys the window wasn't key, and a click on a window that isn't
    /// key only makes it key. Now the one click both closes the panel and acts.
    static func prepare(_ event: NSEvent) {
        guard let w = event.window, w.isVisible, !w.isKeyWindow, w.canBecomeKey, !(w is WebMenuWindow) else { return }
        w.makeKey()
    }
}

extension NSWindow {
    /// A floating panel closing gives the keys back to the window it floats over, if it had them.
    func handKeyBack() {
        guard isKeyWindow, let p = parent, p.isVisible, p.canBecomeKey else { return }
        p.makeKey()
    }
}

// MARK: right-click menus

/// Right-click (or Control-click) menus drawn by Folevi: views register their area, one event monitor picks the
/// smallest area under the pointer and opens its menu.
@MainActor
final class WebContextMenus {
    static let shared = WebContextMenus()
    private var catchers: [ObjectIdentifier: WeakCatcher] = [:]
    private var monitor: Any?

    struct WeakCatcher {
        weak var view: ContextCatcherView?
    }

    func register(_ v: ContextCatcherView) {
        catchers[ObjectIdentifier(v)] = WeakCatcher(view: v)
        if monitor == nil {
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.rightMouseDown, .leftMouseDown]) { [weak self] event in
                guard let self else { return event }
                let right = event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
                guard right, let window = event.window else { return event }
                let hits = self.catchers.values.compactMap(\.view).filter { $0.window === window && !$0.isHiddenOrHasHiddenAncestor }.filter { v in
                    v.convert(v.bounds, to: nil).contains(event.locationInWindow)
                }
                if let best = hits.min(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }), let entries = best.entries?(), !entries.isEmpty {
                    WebMenuWindow.show(entries, at: event.locationInWindow, in: window)
                    return nil
                }
                // Nothing here has its own menu: a text field's, or the window's (AppContextMenu.swift).
                guard let entries = AppContextMenu.entries(for: event, in: window), !entries.isEmpty else { return event }
                WebMenuWindow.show(entries, at: event.locationInWindow, in: window)
                return nil
            }
        }
    }

    func unregister(_ v: ContextCatcherView) { catchers[ObjectIdentifier(v)] = nil }
}

final class ContextCatcherView: NSView {
    var entries: (@MainActor () -> [WebMenuEntry])?
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        MainActor.assumeIsolated {
            if window != nil { WebContextMenus.shared.register(self) } else { WebContextMenus.shared.unregister(self) }
        }
    }
}

struct ContextCatcher: NSViewRepresentable {
    let entries: @MainActor () -> [WebMenuEntry]
    func makeNSView(context: Context) -> ContextCatcherView {
        let v = ContextCatcherView()
        v.entries = entries
        return v
    }

    func updateNSView(_ v: ContextCatcherView, context: Context) { v.entries = entries }
}

/// An anchor for a menu opened from a SwiftUI button: the button's own NSView.
final class MenuAnchorView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

struct MenuAnchor: NSViewRepresentable {
    let hold: (NSView) -> Void
    func makeNSView(context: Context) -> MenuAnchorView {
        let v = MenuAnchorView()
        DispatchQueue.main.async { hold(v) }
        return v
    }

    func updateNSView(_ v: MenuAnchorView, context: Context) {}
}

#else
/// The layer an iPad menu sits in, over the whole window. A touch (or a click, a scroll) anywhere outside the panel
/// closes the menu and goes on to what's under it, as iPadOS's own menus do: the button under the finger answers the
/// same tap, a scroll scrolls. The window changing size (a rotation, Split View, Stage Manager) closes it too.
final class WebMenuLayerView: UIView {
    /// The panel's frame in the layer (its shadow's room left out).
    var panel: () -> CGRect = { .zero }
    var outside: () -> Void = {}
    private var placedSize: CGSize?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if panel().contains(point) { return super.hitTest(point, with: event) }
        // (A pointer only hovering asks too: that leaves the menu up.)
        if let type = event?.type, type == .touches || type == .scroll || type == .transform { outside() }
        return nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != .zero else { return }
        if let placed = placedSize, placed != bounds.size { outside() }
        placedSize = bounds.size
    }
}

/// The iPad's menu: the same panel in a layer over the window (a touch outside closes it and goes through), one at
/// a time.
@MainActor
public final class WebMenuWindow {
    private static var current: WebMenuWindow?
    private let state: WebMenuState
    private let layer = WebMenuLayerView()
    private let host: UIHostingController<AnyView>
    static let margin: CGFloat = 32

    private init(entries: [WebMenuEntry], width: CGFloat) {
        state = WebMenuState(entries)
        host = UIHostingController(rootView: AnyView(EmptyView()))
        host.rootView = AnyView(WebMenuContent(state: state, width: width) { [weak self] e in self?.pick(e) }.padding(Self.margin))
        host.view.backgroundColor = .clear
        host.safeAreaRegions = []
        layer.backgroundColor = .clear
        layer.panel = { [weak self] in
            guard let self else { return .zero }
            return self.host.view.frame.insetBy(dx: Self.margin, dy: Self.margin)
        }
        layer.outside = { [weak self] in
            MainActor.assumeIsolated { self?.close() }
        }
    }

    /// Opens the menu with its top-left corner at `point` (in `window`'s coordinates), kept on screen.
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 224, at point: CGPoint, in window: UIWindow, growFrom: CGPoint? = nil) -> WebMenuWindow {
        current?.close()
        let menu = WebMenuWindow(entries: entries, width: width)
        menu.layer.frame = window.bounds
        menu.layer.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let size = menu.host.sizeThatFits(in: CGSize(width: width + margin * 2, height: window.bounds.height))
        let safe = window.bounds.inset(by: window.safeAreaInsets)
        var origin = CGPoint(x: point.x - margin, y: point.y - margin)
        origin.x = min(max(origin.x, safe.minX - margin + 8), safe.maxX - size.width + margin - 8)
        if origin.y + size.height - margin > safe.maxY { origin.y = max(safe.minY - margin, point.y - size.height + margin - 28) }
        menu.host.view.frame = CGRect(origin: origin, size: size)
        menu.host.overrideUserInterfaceStyle = window.overrideUserInterfaceStyle
        menu.layer.addSubview(menu.host.view)
        window.addSubview(menu.layer)
        current = menu
        // (After any placing under or over a view: it grows out of the point it was opened from.)
        DispatchQueue.main.async { MainActor.assumeIsolated { menu.growIn(from: growFrom ?? point) } }
        return menu
    }

    /// Grows out of `point` (the window's coordinates) on a spring with a little overshoot (FoleviSpring.pop's feel);
    /// under Reduce Motion it only fades in.
    private func growIn(from point: CGPoint) {
        guard let v = host.view else { return }
        v.alpha = 0
        if UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.12) { v.alpha = 1 }
            return
        }
        let p = v.convert(point, from: layer)
        let scale: CGFloat = 0.8
        v.transform = CGAffineTransform(translationX: (p.x - v.bounds.midX) * (1 - scale), y: (p.y - v.bounds.midY) * (1 - scale)).scaledBy(x: scale, y: scale)
        UIView.animate(withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.66, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
            v.transform = .identity
            v.alpha = 1
        }
    }

    public enum Align { case start, end }
    public enum Side { case top, bottom }

    /// Opens the menu under (or over) a view, 4 pt off it: its left edge at the view's (`start`) or its right edge at
    /// the view's (`end`).
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 200, below view: UIView, align: Align = .start, side: Side = .bottom) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let r = view.convert(view.bounds, to: window)
        let menu = show(entries, width: width, at: CGPoint(x: r.minX, y: r.maxY + 4), in: window)
        // (Placed from the menu's own size: its end under the view's end, or above the view.)
        let f = menu.host.view.frame
        var x = f.minX, y = f.minY
        if align == .end { x = r.maxX - (f.width - margin) }
        if side == .top { y = r.minY - 4 - (f.height - margin) }
        let safe = window.bounds.inset(by: window.safeAreaInsets)
        x = min(max(x, safe.minX - margin + 8), safe.maxX - f.width + margin - 8)
        menu.host.view.frame.origin = CGPoint(x: x, y: y)
        return menu
    }

    /// A select's list (ui/Select.tsx) under its trigger, as wide as the trigger at least.
    @discardableResult
    public static func showSelect(_ entries: [WebMenuEntry], below view: UIView) -> WebMenuWindow? {
        show(entries, width: max(view.bounds.width, 160), below: view)
    }

    /// Opens the menu beside a finger held on the screen (`point`, the window's coordinates): below the finger's
    /// 44-point spot, its left edge at the finger, or above the spot when there's more room there, so neither the
    /// finger nor the menu hides the other.
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 224, besideFinger point: CGPoint, in window: UIWindow) -> WebMenuWindow {
        let spot = CGRect(x: point.x - 22, y: point.y - 22, width: 44, height: 44)
        let menu = show(entries, width: width, at: CGPoint(x: point.x, y: spot.maxY), in: window, growFrom: point)
        let f = menu.host.view.frame
        let h = f.height - margin * 2
        let safe = window.bounds.inset(by: window.safeAreaInsets)
        let below = safe.maxY - spot.maxY - 8
        let above = spot.minY - safe.minY - 8
        var y = below >= h || below >= above ? spot.maxY : spot.minY - h
        y = min(max(y, safe.minY + 8), safe.maxY - h - 8)
        menu.host.view.frame.origin.y = y - margin
        return menu
    }

    /// The menu on screen, if any.
    public static var shown: WebMenuWindow? { current }

    private func pick(_ e: WebMenuEntry) {
        close()
        DispatchQueue.main.async { MainActor.assumeIsolated { e.action() } }
    }

    public func close() {
        if Self.current === self { Self.current = nil }
        // Fades as it goes, shrinking a touch (taps go through to the window meanwhile).
        let layer = layer
        layer.isUserInteractionEnabled = false
        UIView.animate(withDuration: 0.14, delay: 0, options: [.beginFromCurrentState]) { [host] in
            host.view.alpha = 0
            if !UIAccessibility.isReduceMotionEnabled { host.view.transform = CGAffineTransform(scaleX: 0.96, y: 0.96) }
        } completion: { _ in layer.removeFromSuperview() }
    }
}

/// An anchor for a menu opened from a SwiftUI button: a view of the button's size.
struct MenuAnchor: UIViewRepresentable {
    let hold: (UIView) -> Void
    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.isUserInteractionEnabled = false
        DispatchQueue.main.async { hold(v) }
        return v
    }

    func updateUIView(_ v: UIView, context: Context) {}
}

/// The iPad's right click: a Folevi menu from a finger held still on the view (0.45 s), or from a pointer's
/// secondary click (a two-finger click on a trackpad, a mouse's right button) at the pointer.
///
/// Both are UIKit recognizers that run beside everything else on the view (its Button's tap, a scroll, the drag
/// `.draggable` adds), so the hold is never lost to the drag's lift (IPAD-01, IPAD-09): the menu opens first, and a
/// finger that then moves on carries the item away as a drag, closing the menu (iPadOS's own context menus do the
/// same). A finger that moves before the hold has begun is a scroll and opens nothing.
struct ContextCatcher: ViewModifier {
    let entries: @MainActor () -> [WebMenuEntry]

    func body(content: Content) -> some View {
        content
            .gesture(MenuHold { point, window in
                let list = entries()
                guard !list.isEmpty else { return false }
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                WebMenuWindow.show(list, besideFinger: point, in: window)
                return true
            })
            .gesture(SecondaryClick { point, window in
                let list = entries()
                guard !list.isEmpty else { return }
                WebMenuWindow.show(list, at: point, in: window)
            })
    }
}

/// A held finger (0.45 s, within 10 pt), recognized alongside the view's other gestures. `began` gets the finger's
/// place in the window and says whether it opened a menu; that menu closes again if the finger then travels on (a
/// drag of the item, or a scroll that started late).
struct MenuHold: UIGestureRecognizerRepresentable {
    let began: @MainActor (CGPoint, UIWindow) -> Bool

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var start: CGPoint = .zero
        weak var menu: WebMenuWindow?
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
        // (Only fingers: a pointer's click and hold is a drag or a selection there.)
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool { touch.type == .direct }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let hold = UILongPressGestureRecognizer()
        hold.minimumPressDuration = 0.45
        hold.allowableMovement = 10
        hold.cancelsTouchesInView = false
        hold.delaysTouchesEnded = false
        hold.delegate = context.coordinator
        return hold
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        guard let window = recognizer.view?.window else { return }
        let at = recognizer.location(in: window)
        switch recognizer.state {
        case .began:
            context.coordinator.start = at
            if began(at, window) { context.coordinator.menu = WebMenuWindow.shown }
        case .changed:
            // The finger travels on with the menu up: it's carrying the item (or scrolling) now.
            if let menu = context.coordinator.menu, hypot(at.x - context.coordinator.start.x, at.y - context.coordinator.start.y) > 16 {
                menu.close()
                context.coordinator.menu = nil
            }
        default:
            context.coordinator.menu = nil
        }
    }
}

/// A pointer's secondary click (a two-finger click on a trackpad, a mouse's right button, Control-click), with the
/// pointer's place in the window.
struct SecondaryClick: UIGestureRecognizerRepresentable {
    let clicked: @MainActor (CGPoint, UIWindow) -> Void

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
        // (Only a pointer's click: a finger's tap must never count as one, whatever button mask it reports.)
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool { touch.type == .indirectPointer }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UITapGestureRecognizer {
        let click = UITapGestureRecognizer()
        click.buttonMaskRequired = .secondary
        click.cancelsTouchesInView = false
        click.delegate = context.coordinator
        return click
    }

    func handleUIGestureRecognizerAction(_ recognizer: UITapGestureRecognizer, context: Context) {
        guard recognizer.state == .ended, let window = recognizer.view?.window else { return }
        clicked(recognizer.location(in: window), window)
    }
}

#endif

public extension View {
    /// A Folevi menu on right click (instead of the system's context menu).
    func webContextMenu(_ entries: @escaping @MainActor () -> [WebMenuEntry]) -> some View {
        #if os(macOS)
        background(ContextCatcher(entries: entries))
        #else
        modifier(ContextCatcher(entries: entries))
        #endif
    }
}

/// A row's "…" button (MenuButton's own trigger: 32 pt, the chip radius, muted, the soft accent on hover), shown
/// while its row is hovered (the web's `opacity-0 group-hover:opacity-100`), always taking its room.
public struct RowMoreButton: View {
    let label: String
    let shown: Bool
    var size: CGFloat = 32
    var iconSize: CGFloat = 14
    let entries: @MainActor () -> [WebMenuEntry]
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme

    /// `size` and `iconSize`: the trigger's own where the web gives it one (a notification's: h-7 w-7, 15).
    public init(label: String, shown: Bool, size: CGFloat = 32, iconSize: CGFloat = 14, entries: @escaping @MainActor () -> [WebMenuEntry]) {
        self.label = label
        self.shown = shown
        self.size = size
        self.iconSize = iconSize
        self.entries = entries
    }

    public var body: some View {
        WebMenuButton(entries: entries) {
            RowMoreFace(hover: hover, shown: shown, size: size, iconSize: iconSize)
        }
        .onHover { hover = $0 }
        #if os(iOS)
        // (A finger can't hover: on the iPad it's always shown. A "…" hidden but still taking taps opened an unseen
        // menu from the right of the row instead of the row.)
        .allowsHitTesting(shown || hover || TouchReveal.always)
        #endif
        .accessibilityLabel(label)
    }
}

/// The "…" itself: muted, in the heading colour on the accent's soft fill under the pointer and while its menu is
/// open (it stays shown then, though the pointer has left its row for the menu: MAC-43).
private struct RowMoreFace: View {
    let hover: Bool
    let shown: Bool
    let size: CGFloat
    let iconSize: CGFloat
    @Environment(\.webMenuOpen) private var open
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let hot = hover || open
        let ink = WebStyles.vars[hot ? "color-heading" : "color-ink-muted"]?.resolve(scheme).color ?? .secondary
        let soft = WebStyles.vars["color-accent-soft"]?.resolve(scheme).color ?? .clear
        WebIconView(.ellipsis, size: iconSize)
            .foregroundStyle(ink)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(hot ? soft : .clear))
            .contentShape(Rectangle())
            .opacity(shown || hot || TouchReveal.always ? 1 : 0)
    }
}

extension View {
    /// On the iPad, a control drawn smaller than a finger (a 24 to 40 pt icon button) takes taps 44 points across,
    /// its drawn size and its place unchanged (IPAD-06, IPAD-07, IPAD-12). Nothing on the Mac.
    func fingerTarget(width: CGFloat, height: CGFloat) -> some View {
        #if os(iOS)
        contentShape(Rectangle().inset(by: -max(0, (44 - min(width, height)) / 2)))
        #else
        self
        #endif
    }
}

/// Controls the Mac shows only while the pointer is over their row or card (a "…"): on the iPad always shown, as the
/// web shows them to a finger (`pointer-coarse:opacity-100`), since a finger can't hover.
enum TouchReveal {
    #if os(iOS)
    static let always = true
    #else
    static let always = false
    #endif
}

/// Hands its content whether the pointer is over it (a row that shows its "…" on hover).
public struct HoverReveal<Content: View>: View {
    let content: (Bool) -> Content
    @State private var hover = false

    public init(@ViewBuilder content: @escaping (Bool) -> Content) { self.content = content }

    public var body: some View {
        content(hover).onHover { hover = $0 }
    }
}

/// A button that opens a Folevi menu under itself.
public struct WebMenuButton<Label: View>: View {
    let entries: @MainActor () -> [WebMenuEntry]
    let width: CGFloat
    let align: WebMenuWindow.Align
    /// A select's trigger (ui/Select.tsx): its list instead of a menu (WebMenuWindow.showSelect).
    let select: Bool
    let side: WebMenuWindow.Side
    let label: Label
    @State private var anchor: NSView?

    public init(width: CGFloat = 200, align: WebMenuWindow.Align = .end, side: WebMenuWindow.Side = .bottom, select: Bool = false, entries: @escaping @MainActor () -> [WebMenuEntry], @ViewBuilder label: () -> Label) {
        self.entries = entries
        self.width = width
        self.align = align
        self.side = side
        self.select = select
        self.label = label()
    }

    public var body: some View {
        // While its menu is open the button keeps an open look: the glass hover fill behind it (a select's well
        // covers it with its own box) and `webMenuOpen` for a label that draws its own (MAC-43).
        let open = anchor.map { WebMenuTrigger.shared.open == ObjectIdentifier($0) } ?? false
        Button {
            if let anchor {
                if select { WebMenuWindow.showSelect(entries(), below: anchor) } else { WebMenuWindow.show(entries(), width: width, below: anchor, align: align, side: side) }
            }
        } label: {
            label
                .environment(\.webMenuOpen, open)
                .background(MenuAnchor { anchor = $0 })
                .background {
                    if open, !select { WebMenuOpenFill() }
                }
        }
        #if os(macOS)
        .buttonStyle(.webPlain)
        #else
        .buttonStyle(.plain)
        #endif
    }
}

/// A menu button's fill while its menu is open: the glass hover at the chip radius.
struct WebMenuOpenFill: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular)
            .fill(WebStyles.vars["glass-hover"]?.resolve(scheme).color ?? .clear)
    }
}

extension EnvironmentValues {
    /// The menu this label's button opens is on screen (MAC-43).
    @Entry var webMenuOpen = false
}
#endif
