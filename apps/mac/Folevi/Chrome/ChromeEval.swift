// Debug builds only: the Mac chrome from scripts (scripts/mac.mjs cmd <name> [json]), so menus, windows, Quick Add,
// Settings and the title bar can be checked and photographed without clicks.
//
//   menu        { action: "list" } every menu as the app would show it now (titles, shortcuts, on/off, checked)
//               { action: "run", item } runs an item as a click would ("item": "id" is the request's own)
//               { action: "open", item, x?, y?, seconds? } opens a menu ("file", "status", "dock", ...) at a point
//               for `seconds` (a screenshot can be taken meanwhile), then closes it
//   quickAdd    { action: "show" | "hide" | "toggle" | "state" | "text" | "insert" | "command" | "pageEditor" }
//   settings    { action: "show" | "close" | "state", section? }
//   evalIn      { target: "settings" | "quickAdd", script }   like eval, in that window's page
//   titleBar    { window? }   the window buttons' frames, the page's spot and drag areas, the window's title
//   hitTest     { window?, x, y }   what a click at (x, y) from the window's top left would reach
//   chrome      the Dock badge, recent notes, save state, the front page's menu state, the settings
//   restore     { action: "save" | "read" }   windows.json now
//   notifyAction { action, kind, notification, path?, place?, text?, thread? }   a notification's click or action
#if DEBUG
import AppKit
import WebKit
import FoleviMac

@MainActor
enum ChromeEval {
    static func install() {
        MacEval.commands["menu"] = menu
        MacEval.commands["quickAdd"] = quickAdd
        // The Quick Add panel as drawn (`cmd quickAddShot {"out"}`): its content at 2x, the web page's own snapshot
        // in the web frame; the screens diff compares the two frames' panels.
        MacEval.commands["quickAddShot"] = { req, done in
            let q = QuickAddPanel.shared
            guard let content = q.panel?.contentView, let view = q.view, let path = req["out"] as? String else { return done(["error": "no panel or no out"]) }
            MacEval.windowShot(content: content, page: view, path: path, done: done)
        }
        MacEval.commands["settings"] = settings
        MacEval.commands["evalIn"] = evalIn
        MacEval.commands["titleBar"] = titleBar
        MacEval.commands["hitTest"] = hitTest
        MacEval.commands["chrome"] = { _, done in
            let front = WindowManager.shared.frontMain?.view
            let s = front.flatMap { Chrome.states[ObjectIdentifier($0)] }
            done(["value": [
                "badge": NSApp.dockTile.badgeLabel ?? "",
                "recent": Chrome.recent.map { ["id": $0.id, "title": $0.title, "place": $0.place ?? NSNull()] as [String: Any] },
                "status": Chrome.status,
                "settings": DesktopSettings.current.page,
                "shortcut": HotKey.shared.registered ?? NSNull(),
                "shortcutError": Chrome.shortcutError ?? NSNull(),
                "statusItem": StatusItem.shared.item != nil,
                "menuState": s.map { ["disabled": Array($0.disabled).sorted(), "checked": Array($0.checked).sorted(), "ai": $0.ai ?? NSNull(), "sidebar": $0.sidebar ?? NSNull(), "route": $0.route ?? NSNull(), "reported": $0.reported] as [String: Any] } ?? NSNull(),
                "zoom": Zoom.level,
                "active": NSApp.isActive,
            ] as [String: Any]])
        }
        // A notification's action as if it had been clicked (no notification is shown: that would ask the owner).
        MacEval.commands["notifyAction"] = { req, done in
            Notifications.shared.respond(action: req["action"] as? String ?? "open", kind: req["kind"] as? String ?? "comment", id: req["notification"] as? String ?? "",
                                         path: req["path"] as? String, place: req["place"] as? String, text: req["text"] as? String ?? "", commentThread: req["thread"] as? String ?? "")
            done(["value": true])
        }
        MacEval.commands["restore"] = { req, done in
            if req["action"] as? String == "save" { WindowRestore.save() }
            let text = (try? String(contentsOf: WindowRestore.file, encoding: .utf8)) ?? ""
            done(["value": ["file": WindowRestore.file.path, "json": text]])
        }
    }

    // MARK: menus

    private static func describe(_ menu: NSMenu) -> [[String: Any]] {
        menu.update()
        return menu.items.map { item in
            if item.isSeparatorItem { return ["separator": true] }
            if let target = item.target as? NSMenuItemValidation, let action = item.action, target.responds(to: action) {
                item.isEnabled = target.validateMenuItem(item)
            }
            var d: [String: Any] = ["title": item.title, "enabled": item.isEnabled, "hidden": item.isHidden, "checked": item.state == .on]
            if let id = item.representedObject as? String { d["id"] = id }
            if !item.keyEquivalent.isEmpty { d["key"] = keyLabel(item) }
            if let sub = item.submenu { d["items"] = describe(sub) }
            return d
        }
    }

    private static func keyLabel(_ item: NSMenuItem) -> String {
        var mods: MenuMods = []
        let m = item.keyEquivalentModifierMask
        if m.contains(.command) { mods.insert(.cmd) }
        if m.contains(.shift) { mods.insert(.shift) }
        if m.contains(.option) { mods.insert(.opt) }
        if m.contains(.control) { mods.insert(.ctrl) }
        return MenuKey(key: item.keyEquivalent, mods: mods).label
    }

    private static func namedMenu(_ id: String) -> NSMenu? {
        switch id {
        case "status":
            let m = NSMenu(title: "Folevi")
            StatusItem.shared.build(into: m)
            return m
        case "dock": return DockMenu.build()
        default: return MainMenu.shared.menusById[id]
        }
    }

    private static func menu(_ req: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        switch req["action"] as? String ?? "list" {
        case "run":
            guard let id = req["item"] as? String else { return done(["error": "item?"]) }
            MainMenu.shared.run(id)
            done(["value": true])
        case "open":
            guard let id = req["item"] as? String, let menu = namedMenu(id) else { return done(["error": "no such menu"]) }
            let seconds = req["seconds"] as? Double ?? 3
            let screen = NSScreen.main?.frame ?? .zero
            let p = NSPoint(x: req["x"] as? Double ?? Double(screen.minX + 120), y: req["y"] as? Double ?? Double(screen.maxY - 40))
            done(["value": ["opened": id, "seconds": seconds]])
            // Closed by a timer that runs while the menu tracks the mouse (the common modes).
            let timer = Timer(timeInterval: seconds, repeats: false) { [menu] _ in MainActor.assumeIsolated { menu.cancelTracking() } }
            RunLoop.main.add(timer, forMode: .common)
            DispatchQueue.main.async { menu.popUp(positioning: nil, at: p, in: nil) }
        default:
            let menus: [[String: Any]] = (NSApp.mainMenu?.items ?? []).map { ["title": $0.title, "items": $0.submenu.map(describe) ?? []] }
            done(["value": ["menus": menus, "status": namedMenu("status").map(describe) ?? [], "dock": describe(DockMenu.build())]])
        }
    }

    // MARK: Quick Add and Settings

    private static func frame(_ w: NSWindow?) -> [Double] {
        guard let f = w?.frame else { return [] }
        return [f.origin.x, f.origin.y, f.width, f.height]
    }

    private static func quickAdd(_ req: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        let q = QuickAddPanel.shared
        switch req["action"] as? String ?? "state" {
        case "show": q.show()
        case "hide": q.hide()
        case "toggle": q.toggle()
        case "text": _ = q.debugSetText(req["text"] as? String ?? "")
        case "insert":
            // Typing as the field editor takes it (the native field's own change path).
            (q.panel?.firstResponder as? NSTextView)?.insertText(req["text"] as? String ?? "", replacementRange: NSRange(location: NSNotFound, length: 0))
        case "command":
            // A key's command in the field editor ("insertNewline:", "cancelOperation:"), through the field's delegate.
            (q.panel?.firstResponder as? NSTextView)?.doCommand(by: NSSelectorFromString(req["selector"] as? String ?? ""))
        case "pageEditor": NotificationCenter.default.post(name: WebQuickAddPanel.debugPageEditor, object: nil)
        default: break
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            done(["value": [
                "visible": q.panel?.isVisible ?? false, "key": q.panel?.isKeyWindow ?? false, "frame": frame(q.panel),
                "appActive": NSApp.isActive, "frontApp": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "",
                "place": q.view?.place ?? NSNull(), "url": q.view?.url?.absoluteString ?? "", "loaded": q.view?.loaded ?? false,
                "windowNumber": q.panel?.windowNumber ?? 0, "onActiveSpace": q.panel?.isOnActiveSpace ?? false,
                "firstResponder": q.panel?.firstResponder.map { String(describing: type(of: $0)) } ?? "",
            ] as [String: Any]])
        }
    }

    private static func settings(_ req: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        let s = SettingsWindow.shared
        switch req["action"] as? String ?? "state" {
        case "show": s.show(section: req["section"] as? String)
        case "close": s.window?.performClose(nil)
        default: break
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            let toolbar = s.window?.toolbar
            done(["value": [
                "visible": s.window?.isVisible ?? false, "title": s.window?.title ?? "", "frame": frame(s.window),
                "items": toolbar?.items.map { $0.label } ?? [], "selected": toolbar?.selectedItemIdentifier?.rawValue ?? NSNull(),
                "url": s.view?.url?.absoluteString ?? "", "windowNumber": s.window?.windowNumber ?? 0,
            ] as [String: Any]])
        }
    }

    private static func evalIn(_ req: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        let view: FoleviWebView? = req["target"] as? String == "quickAdd" ? QuickAddPanel.shared.view : SettingsWindow.shared.view
        guard let view, let script = req["script"] as? String else { return done(["error": "no such window or no script"]) }
        view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): done(["value": JSONSerialization.isValidJSONObject(["v": value]) ? value : String(describing: value)])
            case .failure(let error): done(["error": (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription])
            }
        }
    }

    // MARK: the title bar

    private static func window(_ req: [String: Any]) -> MainWindowController? {
        let mains = WindowManager.shared.mains
        if let i = req["window"] as? Int, mains.indices.contains(i) { return mains[i] }
        return WindowManager.shared.frontMain
    }

    private static func titleBar(_ req: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        guard let c = window(req), let w = c.window else { return done(["error": "no window"]) }
        let buttons: [[String: Any]] = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap { type in
            guard let b = w.standardWindowButton(type), let sup = b.superview else { return nil }
            // In the window's terms, from its top left (as the page measures).
            let r = sup.convert(b.frame, to: nil)
            return ["x": r.minX, "y": w.frame.height - r.maxY, "width": r.width, "height": r.height, "midY": w.frame.height - r.midY, "hidden": b.isHidden]
        }
        let spot = TitleBar.spots[ObjectIdentifier(w)]
        let regions = TitleBar.regions[ObjectIdentifier(c.view)]
        done(["value": [
            "title": w.title, "buttons": buttons,
            "spot": spot.map { ["x": $0.x, "y": $0.y, "height": $0.height] } ?? NSNull(),
            "drag": regions?.drag.map { [$0.minX, $0.minY, $0.width, $0.height] } ?? [],
            "noDragCount": regions?.noDrag.count ?? 0,
            "fullScreen": w.styleMask.contains(.fullScreen), "key": w.isKeyWindow,
            "material": w.contentView?.subviews.contains { $0 is TitleBar.SidebarMaterial } ?? false,
        ] as [String: Any]])
    }

    private static func hitTest(_ req: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        guard let c = window(req), let w = c.window, let x = req["x"] as? Double, let y = req["y"] as? Double, let frame = w.contentView?.superview else { return done(["error": "no window or point"]) }
        let p = NSPoint(x: x, y: w.frame.height - y)
        let hit = frame.hitTest(frame.convert(p, from: nil))
        var chain: [String] = []
        var v: NSView? = hit
        while let view = v, chain.count < 8 {
            chain.append(String(describing: type(of: view)))
            v = view.superview
        }
        let local = c.view.convert(p, from: nil)
        let yy = c.view.isFlipped ? local.y : c.view.bounds.height - local.y
        let css = CGPoint(x: local.x / c.view.pageZoom, y: yy / c.view.pageZoom)
        let r = TitleBar.regions[ObjectIdentifier(c.view)]
        done(["value": [
            "hit": chain, "reachesWebView": hit?.isDescendant(of: c.view) == true || hit === c.view,
            "drag": r.map { TitleBar.isDrag(css, drag: $0.drag, noDrag: $0.noDrag) } ?? false,
        ] as [String: Any]])
    }
}
#endif
