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
    let pick: (WebMenuEntry) -> Void

    var body: some View {
        WebMenuPanel(state.entries.map(\.item), width: width, highlighted: state.highlighted) { item in
            if let e = state.entries.first(where: { $0.id == item.id }), !e.disabled { pick(e) }
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

    private init(entries: [WebMenuEntry], width: CGFloat) {
        state = WebMenuState(entries)
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .popUpMenu
        isReleasedWhenClosed = false
        let host = NSHostingView(rootView: WebMenuContent(state: state, width: width) { [weak self] e in self?.pick(e) }.padding(Self.margin))
        host.safeAreaRegions = []
        contentView = host
        setContentSize(host.fittingSize)
    }

    override public var canBecomeKey: Bool { true }

    /// Opens the menu with its top-left corner at `point` (window coordinates of `window`, bottom-left origin),
    /// kept on screen.
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 224, at point: NSPoint, in window: NSWindow) -> WebMenuWindow {
        current?.close()
        let menu = WebMenuWindow(entries: entries, width: width)
        let screenPoint = window.convertPoint(toScreen: point)
        var frame = menu.frame
        frame.origin = NSPoint(x: screenPoint.x - margin, y: screenPoint.y - frame.height + margin)
        if let visible = (window.screen ?? NSScreen.main)?.visibleFrame {
            frame.origin.x = min(max(frame.origin.x, visible.minX - margin), visible.maxX - frame.width + margin)
            if frame.minY + margin < visible.minY { frame.origin.y = screenPoint.y - margin + 24 }
        }
        menu.setFrame(frame, display: false)
        // (A child window follows the app, not its parent: the parent's pinned appearance, Settings > Appearance.)
        menu.appearance = window.appearance
        window.addChildWindow(menu, ordered: .above)
        menu.makeKeyAndOrderFront(nil)
        menu.watch()
        current = menu
        return menu
    }

    /// Opens the menu under a view (its bottom-left corner, 4 pt below).
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 224, below view: NSView) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let r = view.convert(view.bounds, to: nil)
        return show(entries, width: width, at: NSPoint(x: r.minX, y: r.minY - 4), in: window)
    }

    /// The menu on screen, if any (tests, the eval hook).
    public static var shown: WebMenuWindow? { current?.isVisible == true ? current : nil }

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
                guard let best = hits.min(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }), let entries = best.entries?(), !entries.isEmpty else { return event }
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

    /// Opens the menu under a view (its bottom-left corner, 4 pt below).
    @discardableResult
    public static func show(_ entries: [WebMenuEntry], width: CGFloat = 224, below view: UIView) -> WebMenuWindow? {
        guard let window = view.window else { return nil }
        let r = view.convert(view.bounds, to: window)
        return show(entries, width: width, at: CGPoint(x: r.minX, y: r.maxY + 4), in: window)
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

/// A button that opens a Folevi menu under itself.
public struct WebMenuButton<Label: View>: View {
    let entries: @MainActor () -> [WebMenuEntry]
    let width: CGFloat
    let label: Label
    @State private var anchor: NSView?

    public init(width: CGFloat = 224, entries: @escaping @MainActor () -> [WebMenuEntry], @ViewBuilder label: () -> Label) {
        self.entries = entries
        self.width = width
        self.label = label()
    }

    public var body: some View {
        Button {
            if let anchor { WebMenuWindow.show(entries(), width: width, below: anchor) }
        } label: {
            label.background(MenuAnchor { anchor = $0 })
        }
        .buttonStyle(.plain)
    }
}
#endif
