// Debug builds only: scripts drive and read the native frame through MacEval (scripts/mac.mjs cmd ...).
//
//   cmd frame {"window":0}                         the frame's state: route, tabs, sidebar rows, gate, popover
//   cmd frame {"do":"open","path":"/folders/x"}     open a route (its tab)
//   cmd frame {"do":"select","tab":"<id>"}          select a tab; {"do":"number","n":3} ⌘3
//   cmd frame {"do":"close","tab":"<id>"}           close a tab (the one on screen without "tab")
//   cmd frame {"do":"next"} / {"do":"previous"}     ⌃Tab / ⌃⇧Tab
//   cmd frame {"do":"back"} / {"do":"forward"}
//   cmd frame {"do":"newNote"} / {"do":"sidebar"}   ⌘N / ⌘\
//   cmd frame {"do":"popover","which":"sync"|"notifications"|"account"|"none"}
//   cmd frame {"do":"menu","item":"go.next-tab"}    a menu bar item as if chosen
//   cmd frame {"do":"resize","w":1280,"h":820}      the window's content size; {"do":"front"} brings it forward;
//                                                  {"do":"float","on":true} keeps it over other apps' windows
//   cmd frameShot {"out":"/path.png","window":0}    the window as drawn (AppKit's own rendering of its views)
#if DEBUG
import AppKit
import FoleviMac

extension NativeFrame {
    static func installEval() {
        MacEval.commands["frame"] = { req, done in
            let mains = WindowManager.shared.mains
            let i = req["window"] as? Int ?? 0
            guard mains.indices.contains(i), let frame = mains[i].frame else { return done(["error": "no framed window"]) }
            let m = frame.model
            switch req["do"] as? String {
            case "open": m.open(FrameRoute(path: req["path"] as? String ?? "/"))
            case "select": if let t = req["tab"] as? String { m.selectTab(t) }
            case "number": m.selectTab(number: req["n"] as? Int ?? 1)
            case "close": m.closeTab(req["tab"] as? String)
            case "next": m.nextTab(1)
            case "previous": m.nextTab(-1)
            case "back": m.goBack()
            case "forward": m.goForward()
            case "newNote": m.newNote()
            case "sidebar": frame.root.split.toggleSidebar(nil)
            case "popover":
                switch req["which"] as? String {
                case "sync": frame.sidebar.openSyncPopover()
                case "notifications": frame.sidebar.openNotificationsPopover()
                default: frame.sidebar.shownPopover?.close()
                }
            case "menu": if let id = req["item"] as? String { MainMenu.shared.run(id) }
            case "resize":
                if let w = mains[i].window {
                    let size = NSSize(width: req["w"] as? Double ?? 1280, height: req["h"] as? Double ?? 820)
                    w.setContentSize(size)
                    w.center()
                }
            case "front":
                mains[i].window?.makeKeyAndOrderFront(nil)
                NSApp.activate()
            case "float":
                // Over every app's windows (a script's screenshots when Folevi can't become the active app).
                mains[i].window?.level = (req["on"] as? Bool ?? true) ? .floating : .normal
                mains[i].window?.orderFrontRegardless()
            default: break
            }
            // Answer after the frame has drawn the change.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { done(["value": state(frame, window: mains[i].window)]) }
        }
        MacEval.commands["frameShot"] = { req, done in
            let mains = WindowManager.shared.mains
            let i = req["window"] as? Int ?? 0
            guard mains.indices.contains(i), let window = mains[i].window, let path = req["out"] as? String else { return done(["error": "no window or no out"]) }
            guard let view = window.contentView?.superview ?? window.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return done(["error": "no image"]) }
            view.cacheDisplay(in: view.bounds, to: rep)
            guard let png = rep.representation(using: .png, properties: [:]) else { return done(["error": "no png"]) }
            do {
                try png.write(to: URL(fileURLWithPath: path))
                done(["value": ["path": path, "width": rep.pixelsWide, "height": rep.pixelsHigh, "windowNumber": window.windowNumber]])
            } catch {
                done(["error": error.localizedDescription])
            }
        }
    }

    private static func state(_ frame: FrameController, window: NSWindow?) -> [String: Any] {
        let m = frame.model
        func rows(_ nodes: [SidebarNode], depth: Int = 0) -> [[String: Any]] {
            nodes.flatMap { n -> [[String: Any]] in
                [["id": n.id, "title": n.title, "depth": depth, "count": n.count ?? NSNull()]] + rows(n.children, depth: depth + 1)
            }
        }
        return [
            "route": m.route.path,
            "tabs": m.tabs.tabs.map { ["id": $0.id, "title": $0.title, "active": $0.id == m.tabs.activeID] as [String: Any] },
            "sidebar": rows(m.sidebar),
            "sidebarCollapsed": m.sidebarCollapsed,
            "gate": frame.root.showsGate,
            "engine": String(describing: m.client.state),
            "nativeScreen": frame.root.split.content.showsNativeScreen,
            "toasts": m.toasts.map(\.message),
            "popover": frame.sidebar.shownPopover != nil,
            "windowTitle": window?.title ?? "",
            "windowVisible": window?.occlusionState.contains(.visible) ?? false,
            "appActive": NSApp.isActive,
            "canGoBack": m.history.canGoBack,
            "shownNote": m.shownNote ?? NSNull(),
            "demo": NativeFrame.demo,
            "demoEditorLog": frame.demoEngine?.editorLog ?? [],
            "demoCommandLog": frame.demoEngine?.commandLog ?? [],
        ]
    }
}
#endif
