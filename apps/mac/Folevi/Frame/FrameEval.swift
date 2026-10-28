// Debug builds only: scripts drive and read the native frame through MacEval (scripts/mac.mjs cmd ...).
//
//   cmd frame {"window":0}                         the frame's state: route, tabs, sidebar rows, gate, popover
//   cmd frame {"do":"open","path":"/folders/x"}     open a route (its tab)
//   cmd frame {"do":"select","tab":"<id>"}          select a tab; {"do":"number","n":3} ⌘3
//   cmd frame {"do":"close","tab":"<id>"}           close a tab (the one on screen without "tab")
//   cmd frame {"do":"next"} / {"do":"previous"}     ⌃Tab / ⌃⇧Tab
//   cmd frame {"do":"back"} / {"do":"forward"}
//   cmd frame {"do":"newNote"} / {"do":"sidebar"}   ⌘N / ⌘\ ; {"do":"moveOrCopy"} the Move or copy sheet
//   cmd frame {"do":"popover","which":"sync"|"notifications"|"account"|"none"}
//   cmd frame {"do":"menu","item":"go.next-tab"}    a menu bar item as if chosen
//   cmd frame {"do":"post","name":"n","value":"v"}  posts a notification (a screen's own test hook)
//   cmd frame {"do":"resize","w":1280,"h":820}      the window's content size; {"do":"front"} brings it forward;
//   cmd frameShot {"out":"/path.png","window":0}    the window as drawn (AppKit's own rendering of its views);
//                                                   {"menu":true} the open account menu instead
//   cmd frame {"do":"demoVault","vault":"encryptionLocked","e2ee":"locked","approval":"compare","code":"482 913"}
//                                                   the demo place's Vault and encryption (FOLEVI_FRAME_DEMO=1 only)
//   cmd frame {"do":"demoPictures","avatar":url,"logo":url,"space":"ws_airly"}   the demo place's picture, logo
//                                                   and space (FOLEVI_FRAME_DEMO=1 only)
#if DEBUG
import AppKit
import FoleviEngine
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
            case "moveOrCopy": frame.frameMoveOrCopy()
            case "sidebar": frame.root.split.toggleSidebar(nil)
            case "popover":
                switch req["which"] as? String {
                case "sync": frame.sidebar.openSyncPopover()
                case "account": frame.sidebar.openAccountMenu()
                case "notifications": frame.sidebar.openNotificationsPopover()
                default: frame.sidebar.shownPopover?.close()
                }
            case "menu": if let id = req["item"] as? String { MainMenu.shared.run(id) }
            case "post":
                // A notification a screen listens for (screens.mjs: the calendar's layout).
                if let name = req["name"] as? String { NotificationCenter.default.post(name: .init(name), object: req["value"]) }
            case "resize":
                if let w = mains[i].window {
                    let size = NSSize(width: req["w"] as? Double ?? 1280, height: req["h"] as? Double ?? 820)
                    w.setContentSize(size)
                    w.center()
                }
            case "demoPictures":
                // The demo place's picture, logo and space (screens.mjs --avatars): a new photo arrives as the
                // engine's next session and places, as a real one does.
                if let demo = frame.demoEngine {
                    demo.avatarUrl = req["avatar"] as? String
                    demo.logoUrl = req["logo"] as? String
                    if let space = req["space"] as? String { demo.space = space }
                    demo.refreshAll()
                }
            case "demoVault":
                // The demo place's Vault and this Mac's encryption (screens.mjs --vault-unlock): a state to start from,
                // or another device's approval reaching the code to compare.
                if let demo = frame.demoEngine {
                    if let v = req["vault"] as? String, let state = VaultState(rawValue: v) { demo.vaultState = state }
                    if let l = req["e2ee"] as? String, let lock = E2eeLockState(rawValue: l) { demo.e2eeLock = lock }
                    if let a = req["approval"] as? String, let approval = E2eeApprovalState(rawValue: a) { demo.approval = approval }
                    if req["code"] != nil { demo.approvalCode = req["code"] as? String }
                    demo.refreshAll()
                }
            case "front":
                mains[i].window?.makeKeyAndOrderFront(nil)
                NSApp.activate()
            default: break
            }
            // Answer after the frame has drawn the change.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { done(["value": state(frame, window: mains[i].window)]) }
        }
        MacEval.commands["frameShot"] = { req, done in
            let mains = WindowManager.shared.mains
            let i = req["window"] as? Int ?? 0
            guard mains.indices.contains(i), let path = req["out"] as? String,
                  let window = req["menu"] as? Bool == true ? AccountMenuWindow.shown : mains[i].window else { return done(["error": "no window (or no account menu open) or no out"]) }
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
            "tabs": m.tabs.tabs.map { t in
                var d: [String: Any] = ["id": t.id, "title": t.title, "active": t.id == m.tabs.activeID]
                if let f = m.debugTabFrames[t.id] { d["frame"] = [f.minX, f.minY, f.width, f.height] }
                return d
            },
            "strip": m.debugStrip.mapValues { Double($0) },
            "sidebar": rows(m.sidebar),
            "sidebarCollapsed": m.sidebarCollapsed,
            "gate": frame.root.showsGate,
            "nativeGate": frame.root.showsNativeGate,
            "gateKind": m.gateEvent?.gate ?? NSNull(),
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
