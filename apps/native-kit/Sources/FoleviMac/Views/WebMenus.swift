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
        WebMenuPanel(state.entries.map(\.item), width: width, highlighted: state.highlighted, select: select) { item in
            if let e = state.entries.first(where: { $0.id == item.id }), !e.disabled { pick(e) }
        }
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
        let host = NSHostingView(rootView: WebMenuContent(state: state, width: width, select: select) { [weak self] e in self?.pick(e) }.padding(Self.margin))
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
        return show(entries, width: width, anchor: view.convert(view.bounds, to: nil), align: align, side: side, in: window)
    }

    /// A select's list (ui/Select.tsx) under its trigger: at least as wide as it (180 at least), 6 below it, lined up
    /// with its start, the chosen option highlighted.
    @discardableResult
    public static func showSelect(_ entries: [WebMenuEntry], below view: NSView) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let a = view.convert(view.bounds, to: nil)
        return show(entries, width: max(a.width, 180), anchor: a, align: .start, in: window, select: true, gap: 6)
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
            guard let self else { return event }
            if event.window !== self { self.close() }
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

    override public func close() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
        parent?.removeChildWindow(self)
        super.close()
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
/// The iPad's menu: the same panel in a layer over the window (a tap outside closes it), one at a time.
@MainActor
public final class WebMenuWindow {
    private static var current: WebMenuWindow?
    private let state: WebMenuState
    private let layer = UIView()
    private let host: UIHostingController<AnyView>
    static let margin: CGFloat = 32

    private init(entries: [WebMenuEntry], width: CGFloat) {
        state = WebMenuState(entries)
        host = UIHostingController(rootView: AnyView(EmptyView()))
        host.rootView = AnyView(WebMenuContent(state: state, width: width) { [weak self] e in self?.pick(e) }.padding(Self.margin))
        host.view.backgroundColor = .clear
        host.safeAreaRegions = []
        layer.backgroundColor = .clear
        layer.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    @objc private func tapped(_ g: UITapGestureRecognizer) {
        if !host.view.frame.insetBy(dx: Self.margin, dy: Self.margin).contains(g.location(in: layer)) { close() }
    }

    /// Opens the menu with its top-left corner at `point` (in `window`'s coordinates), kept on screen.
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 224, at point: CGPoint, in window: UIWindow) -> WebMenuWindow {
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
        return menu
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

    /// The menu on screen, if any.
    public static var shown: WebMenuWindow? { current }

    private func pick(_ e: WebMenuEntry) {
        close()
        DispatchQueue.main.async { MainActor.assumeIsolated { e.action() } }
    }

    public func close() {
        layer.removeFromSuperview()
        if Self.current === self { Self.current = nil }
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

/// A long press opens a Folevi menu where the view is (the iPad's right click; a pointer's secondary click too).
struct ContextCatcher: ViewModifier {
    let entries: @MainActor () -> [WebMenuEntry]
    @State private var anchor: UIView?

    func body(content: Content) -> some View {
        content
            .background(MenuAnchor { anchor = $0 })
            .onLongPressGesture(minimumDuration: 0.45) {
                guard let anchor, let window = anchor.window else { return }
                let list = entries()
                guard !list.isEmpty else { return }
                let r = anchor.convert(anchor.bounds, to: window)
                WebMenuWindow.show(list, at: CGPoint(x: r.midX, y: r.midY), in: window)
            }
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
        let ink = WebStyles.vars[hover ? "color-heading" : "color-ink-muted"]?.resolve(scheme).color ?? .secondary
        let soft = WebStyles.vars["color-accent-soft"]?.resolve(scheme).color ?? .clear
        WebMenuButton(entries: entries) {
            WebIconView(.ellipsis, size: iconSize)
                .foregroundStyle(ink)
                .frame(width: size, height: size)
                .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(hover ? soft : .clear))
                .contentShape(Rectangle())
        }
        .onHover { hover = $0 }
        .opacity(shown || hover ? 1 : 0)
        .accessibilityLabel(label)
    }
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
        Button {
            if let anchor {
                if select { WebMenuWindow.showSelect(entries(), below: anchor) } else { WebMenuWindow.show(entries(), width: width, below: anchor, align: align, side: side) }
            }
        } label: {
            label.background(MenuAnchor { anchor = $0 })
        }
        .buttonStyle(.plain)
    }
}
#endif
