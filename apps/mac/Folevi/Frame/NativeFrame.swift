// The native frame in the Mac app (docs/NATIVE_APP_PLAN.md section 4.5, work package N8). Each main window's page
// is its Page View: marked for native chrome mode before its first paint (the web draws only the note page and
// runs the engine, lib/engine), bridged by an EngineClient, and hosted by FoleviMac's frame (sidebar, tab strip,
// top bar, native screens). This file wires that into the app: the transport (with the `/_bridge` route for big
// batches), the frame's host actions (places, Settings, sign-in, windows), the page's lifecycle, the app's
// commands (menus, links, notifications) turned into frame actions, and the Debug hooks scripts drive it with.
//
// Switches: on by default on this branch. FOLEVI_WEB_FRAME=1 (or the `folevi.webFrame` setting) brings back the
// web frame; FOLEVI_FRAME_DEMO=1 (Debug only) runs the frame against the scripted demo engine, no web needed;
// FOLEVI_WEB_GATES=1 shows every gate as the page's own screen instead of FoleviScreens' GateScreen.
import AppKit
import UserNotifications
import WebKit
import FoleviEngine
import FoleviDesign
import FoleviMac

@MainActor
enum NativeFrame {
    private static let env = ProcessInfo.processInfo.environment

    /// Main windows get the native frame.
    static var enabled: Bool {
        if env["FOLEVI_WEB_FRAME"] == "1" { return false }
        if Paths.defaults.bool(forKey: "folevi.webFrame") { return false }
        return !Paths.testing || env["FOLEVI_FRAME_TEST"] == "1"
    }

    /// Debug builds only: the frame on the scripted demo engine (screenshots, UI checks without a web export).
    static var demo: Bool {
        #if DEBUG
        return env["FOLEVI_FRAME_DEMO"] == "1"
        #else
        return false
        #endif
    }

    private static var installed = false

    static func install() {
        guard !installed else { return }
        installed = true
        _ = FoleviFonts.register()
        WebSidebarController.defaults = Paths.defaults
        // FOLEVI_WEB_GATES=1: every gate is the page's own screen, full window (the fallback).
        FrameRootViewController.nativeGates = env["FOLEVI_WEB_GATES"] != "1"
        #if DEBUG
        installEval()
        #endif
    }

    /// The window controllers that have a frame, by their page (Events, menus and Navigation find them here).
    static func controller(for view: FoleviWebView?) -> FrameController? {
        guard let view else { return nil }
        return WindowManager.shared.mains.first { $0.view === view }?.frame
    }

    /// The page started loading again or its process ended: the client resubscribes once it's back.
    static func pageEvent(_ view: FoleviWebView, _ event: PageLifecycle) {
        controller(for: view)?.transport?.pageEvent(event)
    }

    /// An app command for a page (Events.command): the frame does it when the page is a Page View. True when
    /// handled (the page never sees it).
    static func handle(_ command: [String: Any], to view: FoleviWebView) -> Bool {
        guard let frame = controller(for: view) else { return false }
        return frame.handle(command)
    }
}

/// The Mac's engine transport: WebViewTransport plus the big-batch route (a batch over 256 KB is POSTed to
/// `/_bridge/<id>`, AppScheme keeps it, and the message names it; native takes it from BridgeBodies directly).
@MainActor
final class MacEngineTransport: EngineTransport {
    let inner: WebViewTransport
    var onBatch: (@MainActor (Data) -> Void)?
    var onLifecycle: (@MainActor (PageLifecycle) -> Void)?

    init(view: WKWebView) {
        inner = WebViewTransport(webView: view, allowed: [.mac])
        inner.onBatch = { [weak self] data in self?.receive(data) }
        inner.onLifecycle = { [weak self] e in self?.onLifecycle?(e) }
    }

    func call(_ message: String) async throws -> Data { try await inner.call(message) }

    func pageEvent(_ event: PageLifecycle) {
        switch event {
        case .reloading: inner.pageWillReload()
        case .terminated: inner.contentProcessDidTerminate()
        }
    }

    func detach() { inner.detach() }

    private func receive(_ data: Data) {
        // An array is a batch; an object names a big one.
        if data.first == UInt8(ascii: "{"), let pointer = try? JSONDecoder().decode(BigBatchPointer.self, from: data) {
            if let body = BridgeBodies.shared.takeCall(pointer.bodyId) { onBatch?(body) }
            return
        }
        onBatch?(data)
    }
}

/// One main window's frame: its engine client, frame model and views, and the app actions it asks for.
@MainActor
final class FrameController: FrameHost {
    let model: FrameModel
    let root: FrameRootViewController
    let transport: MacEngineTransport?
    private(set) var demoEngine: DemoEngine?
    weak var window: NSWindow?
    let place: String?

    /// `demo`: a scripted engine instead of the page's (tests; FOLEVI_FRAME_DEMO=1 in Debug runs).
    init(window: NSWindow, view: FoleviWebView, place: String?, start: String?, tabs: TabsModel.Saved?, demo forced: DemoEngine? = nil) {
        self.window = window
        self.place = place
        let client: EngineClient
        if forced != nil || NativeFrame.demo {
            let demo = forced ?? DemoEngine()
            demoEngine = demo
            client = demo.client()
            transport = nil
        } else {
            let t = MacEngineTransport(view: view)
            transport = t
            client = EngineClient(transport: t, place: place ?? "", app: AppInfo(platform: .macos, version: Paths.version, build: Paths.build, protocol: EngineContract.protocolVersion, schemaHash: EngineContract.schemaHash))
        }
        model = FrameModel(client: client)
        root = FrameRootViewController(model: model, pageView: view)
        model.host = self
        if let tabs { model.restore(tabs) }
        if let start, start != "/", start != "/native" { model.open(FrameRoute(path: start)) }
    }

    /// The marker script for a Page View (protocol.ts `NativeChromeMarker`), at document start.
    static func markerScript(place: String?) -> WKUserScript {
        let source = WebViewTransport.markerScript(NativeChromeMarker(platform: .macos, protocol: EngineContract.protocolVersion, place: place))
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func stop() {
        model.stop()
        transport?.detach()
    }

    // MARK: app commands (Events.command)

    func handle(_ command: [String: Any]) -> Bool {
        switch command["type"] as? String {
        case "navigate":
            guard let path = command["path"] as? String else { return true }
            model.open(FrameRoute(path: path))
            return true
        case "new-note":
            model.newNote()
            return true
        case "menu":
            guard let id = command["id"] as? String else { return true }
            return FrameCommands.run(id, frame: self)
        case "notification":
            // A banner's action (revision 8, notification.act): reply, read, done, snooze; "open" shows its page.
            let action = command["action"] as? String ?? "open"
            if action == "open" || action == UNNotificationDefaultActionIdentifier {
                if let path = command["path"] as? String { model.open(FrameRoute(path: path)) }
            } else if let id = command["id"] as? String {
                let text = (command["text"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                model.notificationAction(id: id, action: action, text: text, thread: command["thread"] as? String)
            }
            return true
        case "new-note-with-text":
            // Services, Shortcuts (revision 8: note.create { text }); answered as the page answered.
            let ask = command["id"] as? String
            let text = command["text"] as? String ?? ""
            Task { @MainActor in
                do {
                    let id = try await model.newNote(text: text)
                    if let ask { Capabilities.answer(ask, ["ok": true, "id": id]) }
                } catch {
                    if let ask { Capabilities.answer(ask, ["ok": false, "message": (error as? EngineFailure)?.message ?? "Folevi couldn't make the note."]) }
                }
            }
            return true
        case "add-task":
            let ask = command["id"] as? String
            let text = command["text"] as? String ?? ""
            Task { @MainActor in
                do {
                    let r = try await model.addTask(text: text, dueDate: command["dueDate"] as? String)
                    if let ask { Capabilities.answer(ask, ["ok": true, "message": "Added to \(r.where)."]) }
                } catch {
                    if let ask { Capabilities.answer(ask, ["ok": false, "message": (error as? EngineFailure)?.message ?? "Folevi couldn't add the task."]) }
                }
            }
            return true
        default:
            return false
        }
    }

    // MARK: FrameHost

    func frameOpenSettings(section: String?) { SettingsWindow.shared.show(section: section) }

    func frameSwitchPlace(_ place: String, space: String?) {
        guard ShellPlaces.has(place) else { return }
        Places.shared.switchTo(place, path: "/documents", later: true)
    }

    func frameSignInAnotherAccount() {
        Task { @MainActor in
            guard let u = await ShellAuth.shared.signInAccount(window: window, provider: nil), let a = Places.shared.addAccount(u) else { return }
            Places.shared.switchTo(a.id, later: true)
        }
    }

    func frameSignOut(place: String) {
        guard let window else { return }
        let alert = NSAlert()
        let name = model.accountName.isEmpty ? "this account" : model.accountName
        alert.messageText = "Sign out of \(name)?"
        let pending = model.sync.value?.pending ?? 0
        alert.informativeText = pending > 0
            ? "\(pending) \(pending == 1 ? "change hasn't" : "changes haven't") reached Folevi yet. If you sign out now, \(pending == 1 ? "it" : "they") will be lost on this Mac."
            : "Your other accounts stay signed in on this Mac."
        alert.addButton(withTitle: pending > 0 ? "Sign Out Anyway" : "Sign Out")
        alert.addButton(withTitle: "Cancel")
        if pending > 0 { alert.alertStyle = .critical }
        alert.beginSheetModal(for: window) { response in
            guard response == .alertFirstButtonReturn else { return }
            Task { @MainActor in await Places.shared.signOut(place, next: nil) }
        }
    }

    func frameSignOutConfirmed(place: String) {
        Task { @MainActor in await Places.shared.signOut(place, next: nil) }
    }

    func frameDownloadFile(_ id: String) {
        // A notification's file needs its signed link from the engine (requested, R8.11).
        model.toast("Open Folevi on the web to download this file for now.")
    }

    func frameMoveOrCopy() {
        // Revision 8: places.move.preview and places.move, in a sheet over the window.
        PlaceMove.present(from: root, model: model)
    }

    func frameOpenHelp() {
        if let url = URL(string: "https://folevi.com/help") { NSWorkspace.shared.open(url) }
    }

    func frameOpenExternal(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return }
        switch Links.target(url) {
        case .app(let path): model.open(FrameRoute(path: path))
        case .browser: Navigation.shared.openExternally(url)
        case .ignore: break
        }
    }

    func frameOpenInNewWindow(_ route: FrameRoute) {
        WindowManager.shared.openMain(path: route.path)
        NSApp.activate()
    }

    func frameStateChanged() { WindowRestore.changed() }

    /// The window's sidebar (menus: ⌘K focuses its search, View > Hide Sidebar).
    var sidebar: WebSidebarController { root.split.sidebar }
}

/// The menu bar's page commands (MenuModel `.page`) in a window with the native frame. Unknown ids fall back to
/// the page (false), which in native chrome mode ignores most of them.
@MainActor
enum FrameCommands {
    static func run(_ id: String, frame: FrameController) -> Bool {
        let m = frame.model
        let noteOpen = m.route.isNote
        func block(_ b: EditorBlock) { m.editor(.format(block: b)) }
        switch id {
        case "file.new-note": m.newNote()
        case "file.new-folder": m.newFolder()
        case "file.new-tab":
            m.open(.home)
            frame.sidebar.focusSearch()
        case "file.open-quickly", "edit.search-all", "go.search": frame.sidebar.focusSearch()
        case "file.close-tab":
            if m.tabs.activeID == FrameTab.homeID { frame.window?.performClose(nil) } else { m.closeTab() }
        case "file.reopen-closed-tab": m.reopenClosedTab()
        case "file.export": if noteOpen { m.noteMenu(.export) }
        case "note.star": if let id = m.route.noteId { m.star([id], !(m.noteMeta[id]?.starred ?? false)) }
        case "note.archive": if let id = m.route.noteId { m.archive([id], !(m.noteMeta[id]?.archived ?? false)) }
        case "note.move": if noteOpen { m.noteMenu(.move) }
        case "note.duplicate": if noteOpen { m.noteMenu(.duplicate) }
        case "note.history": if noteOpen { m.noteMenu(.history) }
        case "note.trash": if let id = m.route.noteId { m.trash([id]) }
        case "note.copy-link":
            if let id = m.route.noteId {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString("https://app.folevi.com/d/\(id)", forType: .string)
                m.toast("Link copied")
            }
        case "format.bold": m.editor(.format(mark: .bold))
        case "format.italic": m.editor(.format(mark: .italic))
        case "format.underline": m.editor(.format(mark: .underline))
        case "format.strikethrough": m.editor(.format(mark: .strike))
        case "format.code": m.editor(.format(mark: .code))
        case "format.highlight": m.editor(.format(mark: .highlight))
        case "format.heading-1": block(.heading1)
        case "format.heading-2": block(.heading2)
        case "format.heading-3": block(.heading3)
        case "format.body": block(.paragraph)
        case "format.bulleted-list": block(.bulleted)
        case "format.numbered-list": block(.numbered)
        case "format.checklist": block(.todo)
        case "format.indent": m.editor(.indent)
        case "format.outdent": m.editor(.outdent)
        case "format.style": m.editor(.panelOpen(panel: .style))
        case "format.move-up": m.editor(.blockMove(dir: .up))
        case "format.move-down": m.editor(.blockMove(dir: .down))
        case "format.duplicate": m.editor(.blockDuplicate)
        case "view.focus": m.editor(.focusToggle)
        case "note.lock": m.editor(.noteLock)
        case "view.appearance-light": m.setAppearance(.light)
        case "view.appearance-dark": m.setAppearance(.dark)
        case "view.appearance-system": m.setAppearance(.system)
        case "view.cards", "view.list":
            guard frame.root.split.content.listShowsCards != nil else { return true }
            frame.root.split.content.setListCards(id == "view.cards")
        case "edit.find", "edit.find-next", "edit.find-previous", "edit.find-selection":
            if noteOpen { m.noteMenu(.find) } else { frame.sidebar.focusSearch() }
        case "view.sidebar": frame.root.split.toggleSidebar(nil)
        case "view.inspector":
            if noteOpen { if m.editorPanel == .info { m.editor(.panelClose) } else { m.editor(.panelOpen(panel: .info)) } }
        case "go.back": m.goBack()
        case "go.forward": m.goForward()
        case "go.home": m.open(.home)
        case "go.today": m.open(.tasks(.today))
        case "go.inbox": m.open(.tasks(.inbox))
        case "go.calendar": m.open(.calendar(nil))
        case "go.ask-ai":
            if noteOpen { m.toggleNoteAI() } else { m.toast("The Foli AI chat comes to the Mac with the next update.") }
        case "go.next-tab": m.nextTab(1)
        case "go.previous-tab": m.nextTab(-1)
        case "help.help": frame.frameOpenHelp()
        default:
            if id.hasPrefix("go.tab-"), let n = Int(id.dropFirst("go.tab-".count)) {
                m.selectTab(number: n)
                return true
            }
            return false
        }
        return true
    }

    /// Whether a page command can run now in a framed window (note commands need a note on screen).
    static func isEnabled(_ id: String, frame: FrameController) -> Bool? {
        let noteOpen = frame.model.route.isNote
        if id == "note.lock" { return noteOpen && frame.model.canLockNote }
        if id.hasPrefix("format.") || id.hasPrefix("note.") || id == "file.export" || id == "view.inspector" || id == "view.focus" { return noteOpen }
        if id == "view.cards" || id == "view.list" { return frame.root.split.content.listShowsCards != nil }
        switch id {
        case "go.back": return frame.model.history.canGoBack
        case "go.forward": return frame.model.history.canGoForward
        case "file.reopen-closed-tab": return !frame.model.tabs.closed.isEmpty
        case "go.ask-ai": return frame.model.session.value?.capabilities.ai != false
        default: return nil
        }
    }
}
