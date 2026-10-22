// The Mac's own capabilities on foleviDesktop (docs/MAC_WEBKIT_PLAN.md §5.2 and §10 WM5, MAC_POLISH_PLAN.md §3.13):
// text recognition (Vision), call recording (ScreenCaptureKit and the microphone, mixed here), drag and drop out
// to Finder and other apps (file promises), printing, the Share picker, the "New Folevi Note with Selection"
// service, Spotlight, Shortcuts (App Intents), the clipboard for the app's own menus and Quick Look.
//
// Registered once at launch (`Capabilities.install()`, from AppDelegate) through WM0's extension points: the
// methods in `DesktopRouter.extraHandlers`, the names the page sees in `DesktopRouter.features`, the page side in
// capabilities.js (`WebViewFactory.extraScripts`). Every argument is checked here; the router only ever answers
// the app's own page (MessageRouter), and the sender view is the one the call came from.
import AppKit
import WebKit

@MainActor
enum Capabilities {
    private static var installed = false

    /// The commands the page answers with commandDone (Intents waiting for "added", the services' new note).
    private static var waiting: [String: CheckedContinuation<[String: Any], Never>] = [:]

    static func install() {
        guard !installed else { return }
        installed = true
        DesktopRouter.features.formUnion([
            "recognizeText", "callCapture", "screenAccess", "openSystemSettings", "recordCall", "dragFile", "dragNotes",
            "print", "share", "setShareTarget", "indexSpotlight", "clipboard", "quickLook", "commandDone",
        ])
        WebViewFactory.extraScripts.append("capabilities")
        let handlers: [String: @MainActor (DesktopRouter, [String: Any]) async throws -> [String: Any]] = [
            "recognizeText": recognizeText,
            "screenAccess": { _, _ in ["value": CallRecorder.screenAccess()] },
            "openSystemSettings": openSystemSettings,
            "callStart": { router, _ in try await CallRecorder.shared.start(for: try view(router)); return [:] },
            "callPause": { router, _ in CallRecorder.shared.pause(for: try view(router)); return [:] },
            "callResume": { router, _ in CallRecorder.shared.resume(for: try view(router)); return [:] },
            "callStop": { router, _ in try await CallRecorder.shared.stop(for: try view(router)) },
            "callCancel": { router, _ in await CallRecorder.shared.cancel(for: try view(router)); return [:] },
            "dragFile": dragFile,
            "dragNotes": dragNotes,
            "dragNoteReply": { _, o in DragOut.shared.reply(o); return [:] },
            "print": { router, _ in Printing.printPage(try view(router)); return [:] },
            "share": share,
            "setShareTarget": setShareTarget,
            "indexSpotlight": indexSpotlight,
            "clipboardRead": { _, _ in Clipboard.read() },
            "clipboardWrite": { _, o in try Clipboard.write(o); return [:] },
            "quickLook": quickLook,
            "commandDone": { _, o in commandDone(o); return [:] },
        ]
        DesktopRouter.extraHandlers.merge(handlers) { _, new in new }
        DragOut.shared.install()
        ServicesProvider.install()
        Spotlight.shared.install()
        Printing.install()
        ChromeHooks.install()
        AppDelegate.beforeFirstWindow.append {
            Sharing.installMenu()
            return true
        }
        #if DEBUG
        installEval()
        #endif
    }

    /// The web view a call came from (a runner has no window, but is a view all the same).
    static func view(_ router: DesktopRouter) throws -> FoleviWebView {
        guard let view = (router.context.events as? ViewEvents)?.view as? FoleviWebView else { throw BridgeError(code: "unavailable", message: "That page is gone.") }
        return view
    }

    // MARK: commands the page answers

    /// Sends `command` to a main window's page and waits up to `timeout` for its commandDone (nil without one).
    /// The page answers commands that carry an "id" with foleviDesktop.commandDone(id, value).
    static func ask(_ command: [String: Any], timeout: TimeInterval = 30, open: Bool = true) async -> [String: Any]? {
        guard let view = await Capabilities.mainPage(open: open) else { return nil }
        return await ask(command, to: view, timeout: timeout)
    }

    /// The same, to one page.
    static func ask(_ command: [String: Any], to view: FoleviWebView, timeout: TimeInterval = 30) async -> [String: Any]? {
        let id = UUID().uuidString.lowercased()
        var command = command
        command["id"] = id
        return await withCheckedContinuation { (cont: CheckedContinuation<[String: Any], Never>) in
            waiting[id] = cont
            Events.command(command, to: view)
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(timeout))
                waiting.removeValue(forKey: id)?.resume(returning: ["ok": false, "message": "Folevi didn't answer in time."])
            }
        }
    }

    private static func commandDone(_ o: [String: Any]) {
        guard let id = o["id"] as? String, let cont = waiting.removeValue(forKey: id) else { return }
        cont.resume(returning: (o["value"] as? [String: Any]) ?? ["ok": o["ok"] as? Bool ?? true])
    }

    /// The front main window's page once it has loaded, opening one when none is open (and `open` allows).
    static func mainPage(open: Bool = true) async -> FoleviWebView? {
        if WindowManager.shared.frontMain == nil {
            guard open else { return nil }
            WindowManager.shared.showMain()
        }
        guard let view = WindowManager.shared.frontMain?.view else { return nil }
        // A page that's still loading: up to 30 seconds for it.
        for _ in 0..<300 where !view.loaded { try? await Task.sleep(for: .milliseconds(100)) }
        return view.loaded ? view : nil
    }

    // MARK: handlers

    /// A finite number from the page (JSON numbers arrive as NSNumber; a Bool is not one).
    static func number(_ v: Any?) -> Double? {
        guard let n = v as? NSNumber, !(v is Bool) else { return nil }
        return n.doubleValue.isFinite ? n.doubleValue : nil
    }

    private static func recognizeText(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        guard let b64 = o["data"] as? String, let data = Data(base64Encoded: b64), !data.isEmpty, data.count <= TextRecognition.maxBytes else {
            throw BridgeError.invalid("That image couldn't be read.")
        }
        guard let text = await TextRecognition.shared.recognize(data, handwriting: o["handwriting"] as? Bool == true) else {
            throw BridgeError(code: "io", message: "Folevi couldn't read the text in that image.")
        }
        return ["text": text]
    }

    /// The System Settings panes a page may open (Electron's systemSettingsUrl): Screen & System Audio Recording.
    static func settingsURL(_ pane: String) -> URL? {
        pane == "screen-recording" ? URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") : nil
    }

    private static func openSystemSettings(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        guard let url = settingsURL(o["pane"] as? String ?? "") else { throw BridgeError.invalid("Folevi can't open that.") }
        NSWorkspace.shared.open(url)
        return [:]
    }

    private static func dragFile(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        guard let text = o["text"] as? String, text.utf8.count <= 5_000_000 else { throw BridgeError.invalid("That note is too big to drag.") }
        DragOut.shared.dragText(name: o["name"] as? String ?? "", text: text, from: try view(router))
        return [:]
    }

    private static func dragNotes(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        let notes = (o["notes"] as? [[String: Any]] ?? []).prefix(50).compactMap { n -> DragOut.NoteRef? in
            guard let id = n["id"] as? String, id.count <= 64, id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { return nil }
            return DragOut.NoteRef(id: id, title: String((n["title"] as? String ?? "").prefix(200)))
        }
        DragOut.shared.expect(Array(notes), token: o["token"] as? String ?? "", from: try view(router))
        return [:]
    }

    private static func share(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        let item = Sharing.Item(
            title: String((o["title"] as? String ?? "").prefix(300)),
            text: (o["text"] as? String).map { String($0.prefix(1_000_000)) },
            url: (o["url"] as? String).flatMap { URL(string: $0) }.flatMap { ["http", "https"].contains($0.scheme ?? "") ? $0 : nil },
            fileName: (o["fileName"] as? String).map { String($0.prefix(200)) }
        )
        guard item.text?.isEmpty == false || item.url != nil else { throw BridgeError.invalid("There's nothing to share.") }
        // Next to a rectangle of the page ({ rect: { x, y, width, height } }) or a point of it ({ x, y }: the text
        // menu's), else at the pointer.
        let num = Capabilities.number
        let rect = (o["rect"] as? [String: Any]).flatMap { r -> NSRect? in
            guard let x = num(r["x"]), let y = num(r["y"]), let w = num(r["width"]), let h = num(r["height"]) else { return nil }
            return NSRect(x: x, y: y, width: max(1, w), height: max(1, h))
        } ?? num(o["x"]).flatMap { x in num(o["y"]).map { NSRect(x: x, y: $0, width: 1, height: 1) } }
        let shared = await Sharing.show(item, in: try view(router), at: rect)
        return ["shared": shared]
    }

    private static func setShareTarget(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        let view = try view(router)
        guard view.role == .main, let t = o["target"] as? [String: Any] else {
            Sharing.setTarget(nil, for: view)
            return [:]
        }
        let url = (t["url"] as? String).flatMap(URL.init(string:)).flatMap { ["http", "https"].contains($0.scheme ?? "") ? $0 : nil }
        Sharing.setTarget(Sharing.Target(title: String((t["title"] as? String ?? "").prefix(300)), url: url), for: view)
        return [:]
    }

    private static func indexSpotlight(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        let place = router.context.place() ?? "default"
        let items = (o["items"] as? [[String: Any]] ?? []).prefix(200).compactMap(Spotlight.Note.init)
        await Spotlight.shared.replace(place: place, with: Array(items))
        return [:]
    }

    private static func quickLook(_ router: DesktopRouter, _ o: [String: Any]) async throws -> [String: Any] {
        let files = (o["files"] as? [[String: Any]] ?? []).prefix(20).compactMap { f -> QuickLook.File? in
            guard let name = f["name"] as? String, let b64 = f["data"] as? String, let data = Data(base64Encoded: b64), data.count <= 200 * 1024 * 1024 else { return nil }
            return QuickLook.File(name: name, data: data)
        }
        guard !files.isEmpty else { throw BridgeError.invalid("There's nothing to show.") }
        try QuickLook.shared.show(Array(files), from: try view(router))
        return [:]
    }

    #if DEBUG
    /// mac.mjs cmd ... for scripts: capabilities without clicks (a print saved as a PDF, a service as another
    /// app would ask for it, the call recorder's state).
    private static func installEval() {
        MacEval.commands["printToFile"] = { req, done in
            guard let out = req["out"] as? String else { return done(["error": "out?"]) }
            Printing.nextToFile = URL(fileURLWithPath: out)
            done(["ok": true])
        }
        MacEval.commands["dragLog"] = { _, done in done(["log": DragOut.shared.log]) }
        // File > Print and File > Share as the menu runs them, on the front window.
        MacEval.commands["printNote"] = { _, done in
            guard let view = WindowManager.shared.frontMain?.view else { return done(["error": "no window"]) }
            Task { @MainActor in
                await Sharing.printNote(view)
                done(["ok": true])
            }
        }
        MacEval.commands["shareAnswer"] = { _, done in
            guard let view = WindowManager.shared.frontMain?.view else { return done(["error": "no window"]) }
            Task { @MainActor in
                let item = await Sharing.note(from: view)
                let target = Sharing.targets[ObjectIdentifier(view)]
                done([
                    "title": item?.title ?? NSNull(), "text": item?.text ?? NSNull(), "url": item?.url?.absoluteString ?? NSNull(),
                    "target": target.map { ["title": $0.title, "url": $0.url?.absoluteString ?? NSNull()] as [String: Any] } ?? NSNull(),
                    "services": Sharing.menuItems(for: view).map(\.title),
                ])
            }
        }
        // A mouse press at (x, y) of the front window's page (top-left points) and a move of 40 points, as real
        // events through the app's queue: what the page and WebKit do with a drag that starts there.
        MacEval.commands["dragProbe"] = { req, done in
            guard let view = WindowManager.shared.frontMain?.view, let window = view.window,
                  let x = Capabilities.number(req["x"]), let y = Capabilities.number(req["y"]) else { return done(["error": "no window"]) }
            let start = view.convert(NSPoint(x: x, y: y), to: nil)
            let post = { (type: NSEvent.EventType, p: NSPoint) in
                if let e = NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1) {
                    NSApp.postEvent(e, atStart: false)
                }
            }
            post(.leftMouseDown, start)
            for i in 1...8 { post(.leftMouseDragged, NSPoint(x: start.x + CGFloat(i * 5), y: start.y - CGFloat(i * 2))) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { done(["log": DragOut.shared.log]) }
        }
        MacEval.commands["downloadTo"] = { req, done in
            guard let out = req["out"] as? String else { return done(["error": "out?"]) }
            Downloads.nextTo = URL(fileURLWithPath: out)
            done(["ok": true])
        }
        MacEval.commands["service"] = { req, done in
            let board = NSPasteboard(name: NSPasteboard.Name("com.folevi.mac.dev.eval-service"))
            board.clearContents()
            board.setString(req["text"] as? String ?? "", forType: .string)
            var error: NSString?
            ServicesProvider.shared.newNoteWithSelection(board, userData: "", error: &error)
            done(["ok": error == nil, "error": error.map { $0 as String } ?? NSNull()])
        }
        MacEval.commands["intent"] = { req, done in
            Task { @MainActor in done(await Intents.run(req["name"] as? String ?? "", req)) }
        }
        MacEval.commands["spotlight"] = { _, done in
            done(["items": Spotlight.shared.indexedForTests()])
        }
        MacEval.commands["openSpotlight"] = { req, done in
            done(["opened": Spotlight.shared.open(identifier: req["identifier"] as? String ?? "")])
        }
    }
    #endif
}
