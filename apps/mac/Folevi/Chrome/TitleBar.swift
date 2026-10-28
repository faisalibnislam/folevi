// The main windows' title bar (docs/MAC_WEBKIT_PLAN.md §6.3 and §6.4, docs/MAC_POLISH_PLAN.md §3.3):
// - the window buttons sit where the page keeps room for them (foleviDesktop.placeWindowButtons), centred on its
//   top bar, and stay there through resizing, full screen and appearance changes (AppKit puts them back);
// - the page's drag areas (.ui-drag, reported by chrome-page.js) move the window, and a double-click there does what
//   System Settings says (zoom, minimise or nothing), since WebKit has no -webkit-app-region;
// - the page knows when the window is in full screen (data-fullscreen) and when it isn't the key window
//   (data-window-active="false"), and whether full keyboard access is on (data-keyboard-navigation);
// - the window's title is the page's own (the note's title, without "· Folevi"), for the Window menu, Mission
//   Control and VoiceOver;
// - the system's translucent sidebar (decision M3): an NSVisualEffectView behind the page, which draws its
//   sidebar clear under <html data-vibrancy="sidebar"> (the page's CSS, WM4).
// A window with the native frame (N8) draws its own chrome: its buttons sit on the frame's 52 pt top bar (the
// same spot rule, at zoom 1), the page's reports are ignored, and the frame names the window.
import AppKit
import FoleviDesign
import WebKit

/// Where the page wants the window buttons (CSS px from the window's top left).
struct ButtonSpot: Equatable {
    var x: Double
    var y: Double
    var height: Double
}

@MainActor
enum TitleBar {
    /// The page's drag areas per view, in CSS px.
    static var regions: [ObjectIdentifier: (drag: [CGRect], noDrag: [CGRect])] = [:]
    /// The page's spot for the window buttons, per window.
    static var spots: [ObjectIdentifier: ButtonSpot] = [:]
    /// Windows with the native frame (their spot is the frame's, never the page's).
    static var nativeWindows = Set<ObjectIdentifier>()
    /// The frame's spot: the first button at x 20, centred on the 52 pt top bar (polish 2.1).
    /// The native frame's spot: where the web's sidebar keeps its .ui-traffic-space (the sidebar's top bar, after
    /// its padding), from the web's computed styles.
    static var nativeSpot: ButtonSpot {
        let bar = WebStyles.named("frame.sidebar.topbar").light
        return ButtonSpot(x: Double(bar.x + bar.padding.left), y: Double(bar.y), height: Double(bar.height))
    }
    private static var observations: [ObjectIdentifier: [NSKeyValueObservation]] = [:]
    private static var installed = false

    // MARK: views and windows

    /// A view was made (WindowManager.viewMade): drag areas, the title, zoom, a clear background where the window
    /// draws a material behind the page.
    static func adopt(_ view: FoleviWebView) {
        guard view.role != .runner else { return }
        view.mouseDownHook = { view, event in TitleBar.mouseDown(view, event) }
        if view.role == .main || view.role == .quickAdd { view.setValue(false, forKey: "drawsBackground") }
        Zoom.apply(to: view)
        let id = ObjectIdentifier(view)
        var list: [NSKeyValueObservation] = []
        list.append(view.observe(\.title, options: [.initial, .new]) { view, _ in
            MainActor.assumeIsolated { TitleBar.titleChanged(view) }
        })
        list.append(view.observe(\.isLoading, options: [.new]) { view, _ in
            MainActor.assumeIsolated {
                guard !view.isLoading else { return }
                DispatchQueue.main.async { [weak view] in
                    guard let v = view else { return }
                    TitleBar.mark(v)
                    if v.loaded { Chrome.viewLoaded(v) }
                }
            }
        })
        observations[id] = list
        // Installed in its window right after it's made (WindowManager.openMain, MainWindowController.rebuild).
        DispatchQueue.main.async { [weak view] in
            guard let view, let window = view.window else { return }
            if view.role == .main, !view.nativeFrame, WindowManager.shared.mains.contains(where: { $0.window === window }) { attachMaterial(window) }
            relayout(window)
        }
    }

    /// A window got the native frame: the buttons go on its top bar.
    static func adoptNative(_ window: NSWindow) {
        let id = ObjectIdentifier(window)
        nativeWindows.insert(id)
        spots[id] = nativeSpot
        // A material a web frame left behind (a rebuild) would sit under the frame's own sidebar.
        window.contentView?.subviews.filter { $0 is SidebarMaterial }.forEach { $0.removeFromSuperview() }
        DispatchQueue.main.async { [weak window] in if let window { relayout(window) } }
    }

    /// The page's title as the window's ("Meeting notes · Folevi" → "Meeting notes"; the start page is "Folevi").
    nonisolated static func cleanTitle(_ raw: String?) -> String {
        let t = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        for suffix in ["· Folevi", "- Folevi", "| Folevi"] where t.hasSuffix(suffix) {
            let s = String(t.dropLast(suffix.count)).trimmingCharacters(in: .whitespaces)
            return s.isEmpty ? "Folevi" : s
        }
        return t.isEmpty ? "Folevi" : t
    }

    private static func titleChanged(_ view: FoleviWebView) {
        // The native frame names its window from the tab on screen.
        guard !view.nativeFrame else { return WindowRestore.changed() }
        guard view.role == .main, let window = view.window, WindowManager.shared.mains.contains(where: { $0.window === window }) else { return }
        var title = cleanTitle(view.title)
        // With several places, the Window menu says which place each window shows (polish §3.16).
        if Chrome.places.count > 1, let label = Chrome.placeLabel(view.place) { title += " (\(label))" }
        if window.title != title { window.title = title }
        WindowRestore.changed()
    }

    /// The October 2026 translucent sidebar (the system's material behind a clear page) is off: the owner chose a
    /// solid sidebar like the website on 2026-10-27 (docs/MAC_REBUILD_PLAN.md section 0). FOLEVI_VIBRANCY=1 brings
    /// it back (comparisons with the old app).
    static let vibrancy = ProcessInfo.processInfo.environment["FOLEVI_VIBRANCY"] == "1"

    /// The system's sidebar material behind the page, once per main window (only with `vibrancy`).
    static func attachMaterial(_ window: NSWindow) {
        guard vibrancy else { return }
        guard let content = window.contentView, !content.subviews.contains(where: { $0 is SidebarMaterial }) else { return }
        let material = SidebarMaterial(frame: content.bounds)
        material.autoresizingMask = [.width, .height]
        material.material = .sidebar
        material.blendingMode = .behindWindow
        material.state = .followsWindowActiveState
        content.addSubview(material, positioned: .below, relativeTo: content.subviews.first)
    }

    /// The page's Settings > Appearance for what's drawn around it: Light or Dark pins the materials behind it, and
    /// the Settings window and windows without the native frame (their native parts: title bar, sections, sheets);
    /// Match System (`system`) pins nothing, so the page's prefers-color-scheme keeps following the Mac (a pin
    /// to the theme it had would hold it there when the Mac switches). A native-frame window follows its place's
    /// setting itself (FrameController).
    static func pageTheme(_ theme: String, system: Bool, view: FoleviWebView) {
        let appearance = system ? nil : NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
        if view.role == .quickAdd {
            QuickAddPanel.shared.setMaterialAppearance(appearance)
        } else if let window = view.window, let content = window.contentView {
            for case let m as SidebarMaterial in content.subviews { m.appearance = appearance }
            if view === SettingsWindow.shared.view || (view.role == .main && !view.nativeFrame), window.appearance?.name != appearance?.name {
                window.appearance = appearance
            }
        }
    }

    final class SidebarMaterial: NSVisualEffectView {
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }

    // MARK: the page's attributes

    /// Tells a page about its window: full screen, key or not, keyboard navigation, the material behind it.
    static func mark(_ view: FoleviWebView) {
        let window = view.window
        let attrs: [String: Any] = [
            "fullscreen": window?.styleMask.contains(.fullScreen) == true,
            "active": window?.isKeyWindow == true || view.role == .quickAdd,
            "keyboard": NSApp.isFullKeyboardAccessEnabled,
            "vibrancy": view.role == .main && !view.nativeFrame && vibrancy ? "sidebar" : view.role == .quickAdd ? "hud" : "",
            "panel": view.role == .quickAdd ? "quick-add" : (window === SettingsWindow.shared.window ? "settings" : ""),
        ]
        view.callAsyncJavaScript("window.__foleviChrome && window.__foleviChrome(attrs)", arguments: ["attrs": attrs], in: nil, in: .page, completionHandler: nil)
    }

    static func markAll(in window: NSWindow?) {
        for view in WindowManager.shared.allViews where window == nil || view.window === window { mark(view) }
    }

    // MARK: notifications from every window

    static func install() {
        guard !installed else { return }
        installed = true
        let nc = NotificationCenter.default
        let relayoutNames: [Notification.Name] = [NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification, NSWindow.didExitFullScreenNotification, NSWindow.didChangeBackingPropertiesNotification]
        for name in relayoutNames {
            nc.addObserver(forName: name, object: nil, queue: .main) { n in
                MainActor.assumeIsolated { if let w = n.object as? NSWindow { TitleBar.relayout(w) } }
            }
        }
        let markNames: [Notification.Name] = [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification, NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification, NSWindow.willEnterFullScreenNotification]
        for name in markNames {
            nc.addObserver(forName: name, object: nil, queue: .main) { n in
                MainActor.assumeIsolated {
                    guard let w = n.object as? NSWindow else { return }
                    TitleBar.markAll(in: w)
                    if n.name == NSWindow.didBecomeKeyNotification { TitleBar.relayout(w) }
                }
            }
        }
        // Appearance changes put the buttons back where AppKit keeps them.
        appearance = NSApp.observe(\.effectiveAppearance, options: [.new]) { _, _ in
            DispatchQueue.main.async { MainActor.assumeIsolated { TitleBar.relayoutAll() } }
        }
        // Keyboard navigation (System Settings > Keyboard) changes while Folevi runs.
        DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name("com.apple.KeyboardUIModeDidChange"), object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { TitleBar.markAll(in: nil) }
        }
    }

    private static var appearance: NSKeyValueObservation?

    // MARK: the window buttons

    /// The page reported its spot for the buttons in `window`.
    static func place(_ spot: ButtonSpot, in window: NSWindow) {
        guard !nativeWindows.contains(ObjectIdentifier(window)) else { return }
        spots[ObjectIdentifier(window)] = spot
        relayout(window)
    }

    static func relayoutAll() {
        for main in WindowManager.shared.mains { if let w = main.window { relayout(w) } }
    }

    /// Puts the three buttons on the page's spot (Electron's WindowButtonsProxy: the title bar's container grows to
    /// hold them, centred on the page's top bar). In full screen the system shows them on its own bar.
    static func relayout(_ window: NSWindow) {
        guard WindowManager.shared.mains.contains(where: { $0.window === window }), !window.styleMask.contains(.fullScreen) else { return }
        guard let spot = spots[ObjectIdentifier(window)], let close = window.standardWindowButton(.closeButton),
              let mini = window.standardWindowButton(.miniaturizeButton), let zoomButton = window.standardWindowButton(.zoomButton),
              let titlebar = close.superview, let container = titlebar.superview else { return }
        let zoom = nativeWindows.contains(ObjectIdentifier(window)) ? 1 : (WindowManager.shared.mains.first { $0.window === window }?.view.pageZoom ?? 1)
        let frames = layout(spot: spot, zoom: zoom, buttonSize: close.frame.size, spacing: mini.frame.minX - close.frame.minX, windowHeight: window.frame.height)
        guard !laying else { return }
        laying = true
        defer { laying = false }
        var frame = frames.container
        frame.origin.x = container.frame.origin.x
        frame.size.width = container.frame.width
        if container.frame != frame { container.frame = frame }
        for (button, origin) in zip([close, mini, zoomButton], frames.buttons) where button.frame.origin != origin {
            button.setFrameOrigin(origin)
        }
        watch(window, views: [container, close])
    }

    private static var laying = false
    private static var watched = Set<ObjectIdentifier>()

    /// AppKit lays the title bar out again on its own (showing the window, becoming key, its toolbar): when the
    /// container or a button moves, they go back on the page's spot.
    private static func watch(_ window: NSWindow, views: [NSView]) {
        for v in views where !watched.contains(ObjectIdentifier(v)) {
            watched.insert(ObjectIdentifier(v))
            v.postsFrameChangedNotifications = true
            NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: v, queue: .main) { [weak window] _ in
                MainActor.assumeIsolated {
                    guard let window else { return }
                    DispatchQueue.main.async { TitleBar.relayout(window) }
                }
            }
        }
    }

    /// The container's frame (window coordinates, from the bottom) and each button's origin in it: the first
    /// button 2 pt into the page's spot, all centred on the spot's middle line. A pure function (ChromeTests).
    nonisolated static func layout(spot: ButtonSpot, zoom: Double, buttonSize: CGSize, spacing: CGFloat, windowHeight: CGFloat) -> (container: CGRect, buttons: [CGPoint]) {
        let x = CGFloat(spot.x * zoom) + 2
        let middle = CGFloat((spot.y + spot.height / 2) * zoom)
        let margin = max(0, middle - buttonSize.height / 2)
        let height = (buttonSize.height + 2 * margin).rounded()
        let container = CGRect(x: 0, y: windowHeight - height, width: 0, height: height)
        let y = ((height - buttonSize.height) / 2).rounded()
        let gap = spacing > 0 ? spacing : 20
        let buttons = (0..<3).map { i in CGPoint(x: (x + CGFloat(i) * gap).rounded(), y: y) }
        return (container, buttons)
    }

    // MARK: dragging by the page's top bar

    /// Whether a point (CSS px) is in a drag area and in none of the areas that must stay clickable. Pure.
    nonisolated static func isDrag(_ p: CGPoint, drag: [CGRect], noDrag: [CGRect]) -> Bool {
        drag.contains { $0.contains(p) } && !noDrag.contains { $0.contains(p) }
    }

    /// A mouse down in a view: in a drag area it moves the window (or zooms or minimises it on a double-click).
    static func mouseDown(_ view: FoleviWebView, _ event: NSEvent) -> Bool {
        guard !view.nativeFrame || !(view.window.map { nativeWindows.contains(ObjectIdentifier($0)) } ?? false) || isGateShown(view) else { return false }
        guard let window = view.window, let r = regions[ObjectIdentifier(view)], !r.drag.isEmpty else { return false }
        let local = view.convert(event.locationInWindow, from: nil)
        let y = view.isFlipped ? local.y : view.bounds.height - local.y
        let zoom = max(0.1, view.pageZoom)
        let css = CGPoint(x: local.x / zoom, y: y / zoom)
        guard isDrag(css, drag: r.drag, noDrag: r.noDrag) else { return false }
        if event.clickCount == 2 {
            doubleClick(window)
        } else {
            window.performDrag(with: event)
        }
        return true
    }

    /// System Settings > Desktop & Dock > "Double-click a window's title bar to": zoom (the default), minimise, or nothing.
    static func doubleClick(_ window: NSWindow) {
        let global = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain) ?? [:]
        switch doubleClickAction(global["AppleActionOnDoubleClick"] as? String, legacyMinimize: global["AppleMiniaturizeOnDoubleClick"] as? Bool) {
        case "minimize": window.performMiniaturize(nil)
        case "none": break
        default: window.performZoom(nil)
        }
    }

    nonisolated static func doubleClickAction(_ value: String?, legacyMinimize: Bool?) -> String {
        switch value {
        case "Minimize": return "minimize"
        case "None": return "none"
        case "Maximize", "Fill": return "zoom"
        default: return legacyMinimize == true ? "minimize" : "zoom"
        }
    }

    /// The page's areas, as chrome-page.js reports them ([x, y, width, height] in CSS px).
    static func setRegions(_ view: FoleviWebView, drag: [[Double]], noDrag: [[Double]]) {
        let rect = { (a: [Double]) -> CGRect? in
            guard a.count == 4, a.allSatisfy(\.isFinite), a[2] >= 0, a[3] >= 0 else { return nil }
            return CGRect(x: a[0], y: a[1], width: a[2], height: a[3])
        }
        regions[ObjectIdentifier(view)] = (Array(drag.prefix(200).compactMap(rect)), Array(noDrag.prefix(2000).compactMap(rect)))
    }

    /// A framed window's page showing its web gate full window (sign-in, onboarding): its drag areas count.
    private static func isGateShown(_ view: FoleviWebView) -> Bool {
        NativeFrame.controller(for: view)?.root.showsGate ?? false
    }

    static func forget(_ view: FoleviWebView) {
        regions.removeValue(forKey: ObjectIdentifier(view))
        observations.removeValue(forKey: ObjectIdentifier(view))
    }
}
