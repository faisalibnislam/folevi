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
//   cmd frame {"do":"scroll","y":160}              scrolls the content (the native screen's list, or the page) to y;
//                                                   "flash":true shows the scroll bars (sidebar's too) as a scroll does
//   cmd scrollers                                  each scroll view's style (0 legacy, 1 overlay) and the preferred one
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
import FoleviScreens

extension NativeFrame {
    /// The page's biggest scrolling area scrolled to `y` (the web frame's main, or a note's).
    static func scrollPage(_ y: Double) -> String {
        "(() => { const els = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)); const el = els.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? document.scrollingElement; el.scrollTop = \(y); return el.scrollTop; })()"
    }

    static func allViews(_ view: NSView) -> [NSView] { view.subviews + view.subviews.flatMap { allViews($0) } }

    static func scrollViews(in view: NSView) -> [NSScrollView] {
        ((view as? NSScrollView).map { [$0] } ?? []) + view.subviews.flatMap { scrollViews(in: $0) }
    }

    static func installEval() {
        // cmd scrollBench {"distance":3000,"seconds":3}   the native screen scrolled down and back, a step on every
        // display frame (as a trackpad's momentum does): the frames the main thread missed meanwhile.
        MacEval.commands["scrollBench"] = { req, done in
            let mains = WindowManager.shared.mains
            guard let frame = mains.first?.frame,
                  let scroll = Self.scrollViews(in: frame.root.split.content.view).max(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height })
            else { return done(["error": "no native screen scrolling"]) }
            ScrollBench(scroll: scroll, distance: req["distance"] as? Double ?? 3000, seconds: req["seconds"] as? Double ?? 3, done: done).start()
        }
        // cmd menus {"do":"rightClick"|"click","x":…,"y":…}  a right click or a click at a point of the front
        // window's content (points, from its top left), then the menu it opened: its rows and where it is.
        // {"do":"shot","out":path} draws the open menu's panel; {"do":"close"} closes it.
        MacEval.commands["menus"] = { req, done in
            let menuState: () -> [String: Any] = {
                guard let m = WebMenuWindow.shown else { return ["open": false] }
                return ["open": true, "rows": m.rows, "frame": [m.frame.minX, m.frame.minY, m.frame.width, m.frame.height]]
            }
            switch req["do"] as? String {
            case "rightClick", "click":
                guard let window = WindowManager.shared.frontMain?.window, let cv = window.contentView else { return done(["error": "no window"]) }
                let p = NSPoint(x: req["x"] as? Double ?? 0, y: cv.bounds.height - (req["y"] as? Double ?? 0))
                let right = req["do"] as? String == "rightClick"
                let types: [NSEvent.EventType] = right ? [.rightMouseDown, .rightMouseUp] : [.mouseMoved, .leftMouseDown, .leftMouseUp]
                for t in types {
                    if let e = NSEvent.mouseEvent(with: t, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: t == .mouseMoved ? 0 : 1, pressure: t == .mouseMoved ? 0 : 1) {
                        NSApp.postEvent(e, atStart: false)
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { done(["value": menuState()]) }
            case "shot":
                guard let m = WebMenuWindow.shown, let path = req["out"] as? String, let png = m.snapshot()?.representation(using: .png, properties: [:]) else { return done(["error": "no menu"]) }
                do { try png.write(to: URL(fileURLWithPath: path)); done(["value": menuState()]) } catch { done(["error": error.localizedDescription]) }
            case "close":
                WebMenuWindow.shown?.close()
                done(["value": true])
            default:
                done(["value": menuState()])
            }
        }
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
            case "scroll":
                // The content's own scroller (screens.mjs --glass: cards behind the glass bar).
                let y = req["y"] as? Double ?? 0
                if m.route.isNote {
                    mains[i].view.evaluateJavaScript(Self.scrollPage(y))
                } else if let scroll = Self.scrollViews(in: frame.root.split.content.view).max(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }) {
                    // From the content's top, as the page's scrollTop (the bar's room is the scroller's inset).
                    scroll.contentView.scroll(to: NSPoint(x: 0, y: y - scroll.contentInsets.top))
                    scroll.reflectScrolledClipView(scroll.contentView)
                    if req["flash"] as? Bool == true {
                        scroll.flashScrollers()
                        Self.scrollViews(in: frame.root.split.sidebar.view).forEach { $0.flashScrollers() }
                    }
                }
            // Pinned tabs, joined notes, the Tab Overview and a tab's picture (screens of the tab features).
            case "pin": if let t = req["tab"] as? String { m.setTabPinned(t, req["on"] as? Bool ?? true) }
            case "join": if let t = req["tab"] as? String, let n = req["note"] as? String { m.joinNote(n, to: t) }
            case "unjoin": if let t = req["tab"] as? String { m.unjoinTab(t, gap: req["gap"] as? Int) }
            case "overview": m.overviewShown = req["on"] as? Bool ?? !m.overviewShown
            case "preview":
                // (Shown after the 300 ms rest: the answer comes 350 ms after.) The strip's frames are the window's
                // (top-left points); the hover reports them in the bar's own space.
                if let t = req["tab"] as? String, let f = m.debugTabFrames[t], let cv = frame.root.split.content.topBar.window?.contentView {
                    let bar = frame.root.split.content.topBar
                    let r = bar.convert(bar.bounds, to: cv)
                    let top = cv.isFlipped ? r.minY : cv.bounds.height - r.maxY
                    m.preview.hide()
                    m.preview.enter(t, frame: f.offsetBy(dx: -r.minX, dy: -top), active: false)
                }
            case "front":
                mains[i].window?.makeKeyAndOrderFront(nil)
                NSApp.activate()
            default: break
            }
            // Answer after the frame has drawn the change.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { done(["value": state(frame, window: mains[i].window)]) }
        }
        MacEval.commands["ax"] = { req, done in
            // The window's accessibility elements with a label (what a screen shows, as VoiceOver reads it), with their
            // frames: checks overlays the window shot can't draw.
            guard let w = WindowManager.shared.mains.first?.window, let root = w.contentView else { return done(["error": "no window"]) }
            var out: [[String: Any]] = []
            func walk(_ e: Any, _ depth: Int) {
                guard depth < 60, out.count < 600 else { return }
                var label: String?, f = CGRect.zero, kids: [Any] = []
                if let v = e as? NSView {
                    label = v.accessibilityLabel(); f = v.accessibilityFrame(); kids = v.accessibilityChildren() ?? []
                    if kids.isEmpty { kids = v.subviews }
                } else if let a = e as? NSAccessibilityElement {
                    label = a.accessibilityLabel(); f = a.accessibilityFrame(); kids = a.accessibilityChildren() ?? []
                } else if let o = e as? NSObject {
                    if o.responds(to: #selector(NSAccessibilityElement.accessibilityLabel)) { label = o.perform(#selector(NSAccessibilityElement.accessibilityLabel))?.takeUnretainedValue() as? String }
                    if o.responds(to: #selector(NSAccessibilityElement.accessibilityChildren)) { kids = (o.perform(#selector(NSAccessibilityElement.accessibilityChildren))?.takeUnretainedValue() as? [Any]) ?? [] }
                }
                let filter = req["match"] as? String ?? ""
                if let label, !label.isEmpty, filter.isEmpty || label.localizedCaseInsensitiveContains(filter) {
                    out.append(["label": label, "frame": [f.minX, f.minY, f.width, f.height]])
                }
                for k in kids { walk(k, depth + 1) }
            }
            walk(root, 0)
            done(["value": out])
        }
        MacEval.commands["viewShot"] = { req, done in
            // One view, by its type's name, drawn as AppKit caches it (overlays the window shot can't place).
            guard let content = WindowManager.shared.mains.first?.window?.contentView, let name = req["view"] as? String, let path = req["out"] as? String,
                  let v = Self.allViews(content).first(where: { String(describing: type(of: $0)).contains(name) }),
                  let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else { return done(["error": "no view"]) }
            v.cacheDisplay(in: v.bounds, to: rep)
            try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
            done(["value": ["hidden": v.isHidden, "frame": [v.frame.minX, v.frame.minY, v.frame.width, v.frame.height], "subviews": v.subviews.count, "type": String(describing: type(of: v))]])
        }
        MacEval.commands["scrollers"] = { _, done in
            // Every scroll view's style in the frame (screens.mjs --scrollers): 0 legacy (wide, takes room), 1 overlay.
            let mains = WindowManager.shared.mains
            guard let content = mains.first?.window?.contentView else { return done(["error": "no window"]) }
            let views = Self.scrollViews(in: content)
            done(["value": ["preferred": NSScroller.preferredScrollerStyle.rawValue, "views": views.map { ["style": $0.scrollerStyle.rawValue, "width": $0.bounds.width, "height": $0.bounds.height, "vertical": $0.hasVerticalScroller] }]])
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
/// Scrolls a scroll view along a smooth path in step with the display and counts the frames it missed.
@MainActor
final class ScrollBench: NSObject {
    private let scroll: NSScrollView
    private let distance: Double
    private let seconds: Double
    private let done: ([String: Any]) -> Void
    private var link: CADisplayLink?
    private var began: CFTimeInterval = 0
    private var last: CFTimeInterval = 0
    private var gaps: [Double] = []
    private var period: Double = 1.0 / 60

    init(scroll: NSScrollView, distance: Double, seconds: Double, done: @escaping ([String: Any]) -> Void) {
        self.scroll = scroll
        self.distance = distance
        self.seconds = seconds
        self.done = done
    }

    func start() {
        let link = scroll.displayLink(target: self, selector: #selector(step(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
        objc_setAssociatedObject(scroll, "scrollBench", self, .OBJC_ASSOCIATION_RETAIN)
    }

    @objc private func step(_ link: CADisplayLink) {
        let now = link.timestamp
        period = link.targetTimestamp - link.timestamp > 0 ? link.targetTimestamp - link.timestamp : period
        if began == 0 { began = now; last = now }
        else { gaps.append(now - last); last = now }
        // Down and back up again along a sine: slow at the turns, fastest in between.
        let p = min(1, (now - began) / seconds)
        let max = Swift.max(0, (scroll.documentView?.bounds.height ?? 0) - scroll.contentView.bounds.height)
        let y = min(max, distance) * (1 - cos(2 * .pi * p)) / 2 - scroll.contentInsets.top
        scroll.contentView.scroll(to: NSPoint(x: 0, y: y))
        scroll.reflectScrolledClipView(scroll.contentView)
        guard p >= 1 else { return }
        link.invalidate()
        self.link = nil
        objc_setAssociatedObject(scroll, "scrollBench", nil, .OBJC_ASSOCIATION_RETAIN)
        let missed = gaps.reduce(0) { $0 + Swift.max(0, Int(($1 / period).rounded()) - 1) }
        let sorted = gaps.sorted()
        done(["value": [
            "refreshHz": (1 / period).rounded(),
            "frames": gaps.count,
            "missedFrames": missed,
            "late": gaps.filter { $0 > period * 1.5 }.count,
            "worstMs": ((sorted.last ?? 0) * 1000).rounded(),
            "p95Ms": ((sorted.isEmpty ? 0 : sorted[Swift.min(sorted.count - 1, Int(Double(sorted.count) * 0.95))]) * 1000 * 10).rounded() / 10,
            "scrolled": Swift.min(max, distance),
        ]])
    }
}

#endif
