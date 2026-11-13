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
import FoleviScreens

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
        installSearchShortcut()
        #if DEBUG
        installEval()
        installMoreEval()
        #endif
    }

    /// Open Quickly (⌘K) while the page has the keys runs at once. A web view hands a shortcut to its page first and
    /// only then, a moment later, to the menu: what was typed meanwhile went into the note, and the palette's field
    /// missed it (QA audit F04). From here the palette's EarlyKeys holds the typing until its field has the focus.
    private static func installSearchShortcut() {
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            guard let window = e.window,
                  let main = WindowManager.shared.mains.first(where: { $0.window === window }),
                  let frame = main.frame,
                  let responder = window.firstResponder as? NSView,
                  responder === main.view || responder.isDescendant(of: main.view),
                  let item = MainMenu.shared.itemsById["file.open-quickly"], item.isEnabled,
                  EarlyKeys.matches(characters: e.charactersIgnoringModifiers, modifiers: e.modifierFlags, key: item.keyEquivalent, mask: item.keyEquivalentModifierMask)
            else { return e }
            frame.sidebar.focusSearch()
            return nil
        }
    }

    /// The window controllers that have a frame, by their page (Events, menus and Navigation find them here).
    static func controller(for view: FoleviWebView?) -> FrameController? {
        guard let view else { return nil }
        return WindowManager.shared.mains.first { $0.view === view }?.frame
    }

    /// Whether a note is what the window shows. With the native frame the page keeps a note mounted for a while
    /// after a native screen comes in front, so File > Share and Print ask the frame, not the page. True for a
    /// window without the frame (the page knows).
    static func showsNote(_ view: FoleviWebView) -> Bool {
        guard let frame = controller(for: view) else { return true }
        return frame.model.route.isNote
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
    /// The window's Page View (the note page and the engine).
    private(set) weak var page: FoleviWebView?
    let place: String?

    /// `demo`: a scripted engine instead of the page's (tests; FOLEVI_FRAME_DEMO=1 in Debug runs).
    init(window: NSWindow, view: FoleviWebView, place: String?, start: String?, tabs: TabsModel.Saved?, demo forced: DemoEngine? = nil) {
        self.window = window
        self.page = view
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
        // Touch ID before this Mac opens its encryption keys: the Vault offers it right after unlocking them there.
        if demoEngine == nil {
            model.touchId = TouchIdHook(
                status: { let k = E2eeKeys.shared.settings(); return (k.touchId, k.available) },
                turnOn: { try await E2eeKeys.shared.setFaceId(true).touchId }
            )
        } else {
            // The demo's stand-in (screens.mjs --vault-unlock): available and off, so the offer shows.
            model.touchId = TouchIdHook(status: { (false, true) }, turnOn: { true })
        }
        root = FrameRootViewController(model: model, pageView: view)
        model.host = self
        model.floatingNotes = FloatingNotes.ids(place: place)
        if let tabs { model.restore(tabs) }
        if let start, start != "/", start != "/native" { model.open(FrameRoute(path: start)) }
        // The place's Settings > Appearance, as the page itself follows it: Light or Dark pins the window (its
        // native views, materials and the page's prefers-color-scheme alike); System leaves it to the Mac. Without
        // this the native frame followed only the Mac, so a Light library on a dark Mac drew the dark bar's glass
        // over the light page under it (2026-10-28).
        appearanceWatch = Observer { [weak self] in
            guard let self else { return }
            let pinned = Self.appearance(self.model.session.value?.appearance)
            if self.window?.appearance?.name != pinned?.name { self.window?.appearance = pinned }
        }
    }

    private var appearanceWatch: Observer?

    static func appearance(_ setting: SessionValue.Appearance?) -> NSAppearance? {
        switch setting {
        case .light?: NSAppearance(named: .aqua)
        case .dark?: NSAppearance(named: .darkAqua)
        default: nil
        }
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
        model.open(.web("/help"))
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

    var frameCanFloatNotes: Bool { true }

    func frameFloatNote(_ id: String) { FloatingNotes.float(id, place: place) }

    /// The window's sidebar (menus: ⌘K focuses its search, View > Hide Sidebar).
    var sidebar: WebSidebarController { root.split.sidebar }
}

/// The menu bar's page commands (MenuModel `.page`) in a window with the native frame. Unknown ids fall back to
/// the page (false), which in native chrome mode ignores most of them.
@MainActor
enum FrameCommands {
    /// Runs a command. A Format item means the note's own text, where its caret or selection is. Pressed as its key
    /// (⌘B, ⌥⇧↑, ⌘D) it runs only while that text has the keyboard: with the keyboard in a field of the window
    /// (Find, the palette, a dialog), in a list, or in another field of the page (the title, a caption, a cell,
    /// a canvas) the key does nothing to the note. Chosen from the menu it runs unless another field of the page
    /// has the keyboard: with a flowchart or a table cell being worked in, the note's selection is wherever it
    /// was left, and bolding that would change text nobody is looking at.
    static func run(_ id: String, frame: FrameController) -> Bool {
        guard id.hasPrefix("format.") else { return perform(id, frame: frame) }
        let key = pressedAsKey
        guard let page = keyboardPage(frame) else { return key ? true : perform(id, frame: frame) }
        pageKeyboard(page) { place in
            if place == .body || (!key && place == .none) { _ = perform(id, frame: frame) }
        }
        return true
    }

    /// The command came from its key, not from a click on its menu item. (Return on an item of an open menu
    /// carries none of ⌘, ⌥ and ⌃, so it counts as the click it stands for.)
    static var pressedAsKey: Bool {
        guard let event = NSApp.currentEvent, event.type == .keyDown else { return false }
        return !event.modifierFlags.intersection([.command, .option, .control]).isEmpty
    }

    /// The window's page, when it is what has the window's keyboard (nil with the keyboard in a native field,
    /// a list or a dialog).
    static func keyboardPage(_ frame: FrameController) -> FoleviWebView? {
        guard let page = frame.page, let view = frame.window?.firstResponder as? NSView, view === page || view.isDescendant(of: page) else { return nil }
        return page
    }

    /// What has the keyboard inside a page: the note's own text, another field of the page (the title, a
    /// caption, a table cell, a canvas or a note inside the note), or nothing.
    enum PageKeyboard: String {
        case body, field, none
    }

    /// Asks a page what has its keyboard now. (`editor.state`'s `focused` is true for the title and for any field
    /// of the page as well, so it can't say.) The note's body is the element with the class `fb-editor`; a field
    /// or an editor inside one of the note's blocks sits in a `data-node-view-wrapper`.
    static func pageKeyboard(_ page: WKWebView, then: @escaping @MainActor (PageKeyboard) -> Void) {
        let script = """
        const a = document.activeElement;
        if (!a || a === document.body || a === document.documentElement) return "none";
        return a.classList.contains("fb-editor") && !a.closest("[data-node-view-wrapper]") ? "body" : "field";
        """
        page.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            var place = PageKeyboard.none
            if case .success(let value) = result, let name = value as? String, let known = PageKeyboard(rawValue: name) { place = known }
            then(place)
        }
    }

    /// A menu command the note page answers itself (lib/engine/editorCommands.ts hears it as the menu bar's
    /// `{ type: "menu", id }`): straight to the page, past the frame.
    private static func sendToPage(_ id: String, frame: FrameController) {
        frame.page?.events.emit("FoleviDesktop", "command", ["type": "menu", "id": id])
    }

    private static func perform(_ id: String, frame: FrameController) -> Bool {
        let m = frame.model
        let noteOpen = m.route.isNote
        func block(_ b: EditorBlock) { m.editor(.format(block: b)) }
        switch id {
        case "file.new-note": m.newNote()
        // The Templates page: its built-in gallery and the person's own, each a click from a new note.
        case "file.new-from-template": m.open(.notes(.templates))
        case "file.new-folder": m.newFolder()
        // The Tasks page's Quick add dialog, over this window.
        case "file.quick-add-task": m.showQuickAdd(in: frame.window)
        case "file.new-tab":
            m.open(.home)
            frame.sidebar.focusSearch()
        case "file.open-quickly", "edit.search-all", "go.search": frame.sidebar.focusSearch()
        case "file.close-tab":
            if m.tabs.activeID == FrameTab.homeID { frame.window?.performClose(nil) } else { m.closeTab() }
        case "file.reopen-closed-tab": m.reopenClosedTab()
        case "file.tab-overview": m.overviewShown.toggle()
        case "file.export": if noteOpen { m.noteMenu(.export) }
        // Import (QA F18): Settings' Import & Export for the space open in this window, brought to the front; its
        // card says where the files go ("Import into Personal", or the workspace's name). From a note, a folder
        // or anywhere else alike.
        case "file.import": SettingsWindow.shared.show(section: SettingsWindow.importSection(session: m.session.value))
        case "note.star": if let id = m.route.noteId { m.star([id], !(m.noteMeta[id]?.starred ?? false)) }
        case "note.archive": if let id = m.route.noteId { m.archive([id], !(m.noteMeta[id]?.archived ?? false)) }
        case "note.move": if noteOpen { m.noteMenu(.move) }
        case "note.duplicate": if noteOpen { m.noteMenu(.duplicate) }
        case "note.history": if noteOpen { m.noteMenu(.history) }
        case "note.trash": if let id = m.route.noteId { trash(id, frame: frame) }
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
        // The selection's link field (the page's own ⇧⌘K), opened by the page.
        case "format.link": if noteOpen { sendToPage(id, frame: frame) }
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
        case "edit.find", "edit.find-selection":
            if noteOpen { m.noteMenu(.find) } else { frame.sidebar.focusSearch() }
        // The next or the previous match: of the sidebar's Find tab while it has a search going, else of the
        // page's own find bar (which opens when there's no search yet).
        case "edit.find-next", "edit.find-previous":
            guard noteOpen else { return true }
            if m.stepSidebarFind?(id == "edit.find-next" ? 1 : -1) != true { sendToPage(id, frame: frame) }
        case "view.sidebar": frame.root.split.toggleSidebar(nil)
        case "view.inspector":
            if noteOpen { if m.editorPanel == .info { m.editor(.panelClose) } else { m.editor(.panelOpen(panel: .info)) } }
        case "go.back": m.goBack()
        case "go.forward": m.goForward()
        case "go.home": m.open(.home)
        case "go.today": m.open(.tasks(.today))
        case "go.inbox": m.open(.tasks(.inbox))
        case "go.calendar": m.open(.calendar(nil))
        case "go.dna": m.open(.web("/graph"))
        case "go.ask-ai":
            m.askAI()
        case "go.next-tab": m.nextTab(1)
        case "go.previous-tab": m.nextTab(-1)
        case "help.help": frame.frameOpenHelp()
        case "help.shortcuts": m.openHelpShortcuts()
        // As the web's menu bar opened them: the changelog in the browser, a message to support in Mail.
        case "help.whats-new": if let url = URL(string: "https://folevi.com/changelog") { frame.frameOpenExternal(url) }
        case "help.feedback": if let url = URL(string: "mailto:support@folevi.com?subject=Folevi%20for%20Mac") { frame.frameOpenExternal(url) }
        default:
            if id.hasPrefix("go.tab-"), let n = Int(id.dropFirst("go.tab-".count)) {
                m.selectTab(number: n)
                return true
            }
            return false
        }
        return true
    }

    /// Move to Trash for the open note. Chosen from the menu it always runs. Pressed as ⌘⌫ it means the note
    /// only when nothing is being edited: with the keyboard in a field of the window (Find, the palette, a
    /// dialog) or in something inside the page (a sticky, a canvas, a cell) the key is that thing's, and the
    /// note stays where it is.
    private static func trash(_ id: String, frame: FrameController) {
        let m = frame.model
        guard NSApp.currentEvent?.type == .keyDown else { return m.trash([id]) }
        if frame.window?.firstResponder is NSText { return }
        guard let page = keyboardPage(frame) else { return m.trash([id]) }
        pageKeyboard(page) { place in
            if place == .none, m.route.noteId == id { m.trash([id]) }
        }
    }

    /// Whether a page command can run now in a framed window (note commands need a note on screen).
    static func isEnabled(_ id: String, frame: FrameController) -> Bool? {
        let noteOpen = frame.model.route.isNote
        if id == "note.lock" { return noteOpen && frame.model.canLockNote }
        // A key that isn't the note's now is off while it is pressed, so it goes on to what has the keyboard
        // instead of being taken here: ⌘B, ⌘E, ⌥⇧↑ and the rest of Format with the keyboard in a native field or
        // a list, and ⌘⌫ in a native field (where it deletes to the start of the line).
        if pressedAsKey {
            if id.hasPrefix("format."), keyboardPage(frame) == nil { return false }
            if id == "note.trash", frame.window?.firstResponder is NSText { return false }
        }
        // Find Next, Find Previous and Use Selection for Find are the note's (Find… alone searches all notes elsewhere).
        if ["edit.find-next", "edit.find-previous", "edit.find-selection"].contains(id) { return noteOpen }
        if id.hasPrefix("format.") || id.hasPrefix("note.") || id == "file.export" || id == "view.inspector" || id == "view.focus" { return noteOpen }
        if id == "view.cards" || id == "view.list" { return frame.root.split.content.listShowsCards != nil }
        switch id {
        case "go.back": return frame.model.history.canGoBack
        case "go.forward": return frame.model.history.canGoForward
        case "file.reopen-closed-tab": return !frame.model.tabs.closed.isEmpty
        case "go.ask-ai": return frame.model.session.value?.capabilities.ai != false
        case "go.dna": return frame.model.session.value?.capabilities.graph != false
        default: return nil
        }
    }
}
