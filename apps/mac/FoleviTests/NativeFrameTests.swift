// The native frame in the app (Frame/NativeFrame.swift, N8): menu commands become frame actions, app commands
// (links, New Note, notifications) reach the frame instead of the page, big batches come through /_bridge,
// window restoration keeps the tabs, and every page command the frame answers is one the menu bar has.
import AppKit
import WebKit
import XCTest
import FoleviEngine
import FoleviMac
@testable import Folevi

@MainActor
final class NativeFrameTests: XCTestCase {
    private func makeFrame() -> (FrameController, DemoEngine, NSWindow) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .resizable, .fullSizeContentView], backing: .buffered, defer: true)
        let view = FoleviWebView(frame: .zero, configuration: WKWebViewConfiguration(), place: "acct:demo", role: .main, nativeFrame: true)
        let demo = DemoEngine()
        let frame = FrameController(window: window, view: view, place: "acct:demo", start: nil, tabs: nil, demo: demo)
        window.contentViewController = frame.root
        return (frame, demo, window)
    }

    private func wait(_ what: String, _ condition: @escaping () -> Bool) {
        let end = Date().addingTimeInterval(3)
        while !condition() && Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        XCTAssertTrue(condition(), what)
    }

    func testMenuCommandsDriveTheFrame() {
        let (frame, demo, _) = makeFrame()
        wait("engine ready") { frame.model.isEngineReady && frame.model.home.value != nil }
        XCTAssertFalse(frame.root.showsGate)
        XCTAssertTrue(FrameCommands.run("file.new-note", frame: frame))
        wait("new note tab") { frame.model.route.noteId?.hasPrefix("doc_new") == true }
        XCTAssertTrue(FrameCommands.run("format.bold", frame: frame))
        wait("bold sent") { demo.editorLog.contains("format") }
        XCTAssertTrue(FrameCommands.run("go.tab-1", frame: frame))
        XCTAssertEqual(frame.model.route, .home)
        XCTAssertEqual(FrameCommands.isEnabled("format.bold", frame: frame), false, "formatting needs a note on screen")
        XCTAssertTrue(FrameCommands.run("go.next-tab", frame: frame))
        XCTAssertTrue(frame.model.route.isNote)
        XCTAssertTrue(FrameCommands.run("file.close-tab", frame: frame))
        XCTAssertEqual(frame.model.route, .home)
        XCTAssertTrue(FrameCommands.run("file.reopen-closed-tab", frame: frame))
        XCTAssertTrue(frame.model.route.isNote)
        XCTAssertTrue(FrameCommands.run("go.back", frame: frame))
        XCTAssertFalse(FrameCommands.run("help.whats-new", frame: frame), "unknown to the frame: the page's")
        // Revision 8's editor menu commands.
        XCTAssertTrue(FrameCommands.run("go.tab-9", frame: frame))
        for id in ["format.move-up", "format.duplicate", "view.focus", "note.lock"] { XCTAssertTrue(FrameCommands.run(id, frame: frame), id) }
        wait("editor commands") { ["block.move", "block.duplicate", "focus.toggle", "note.lock"].allSatisfy(demo.editorLog.contains) }
        XCTAssertTrue(FrameCommands.run("view.appearance-dark", frame: frame))
        wait("appearance") { demo.commandLog.contains("settings.update") }
        frame.stop()
    }

    func testAppCommandsReachTheFrame() {
        let (frame, demo, _) = makeFrame()
        wait("ready") { frame.model.isEngineReady }
        XCTAssertTrue(frame.handle(["type": "navigate", "path": "/folders/fld_trips"]))
        XCTAssertEqual(frame.model.route, .folder("fld_trips"))
        XCTAssertTrue(frame.handle(["type": "notification", "action": "open", "path": "/d/doc_kyoto"]))
        XCTAssertEqual(frame.model.route, .note("doc_kyoto"))
        // Services and Shortcuts: a note from text (revision 8), opened in its tab.
        XCTAssertTrue(frame.handle(["type": "new-note-with-text", "text": "Groceries\nMilk"]))
        wait("note from text") { demo.notes.contains { $0.title == "Groceries" } && frame.model.route.noteId?.hasPrefix("doc_new") == true }
        XCTAssertTrue(frame.handle(["type": "add-task", "text": "Call Lina"]))
        wait("task") { demo.commandLog.contains("task.create") }
        // A banner's action goes to the engine; "open" stays native.
        XCTAssertTrue(frame.handle(["type": "notification", "action": "snooze-hour", "id": "n4", "kind": "local-reminder"]))
        wait("notification.act") { demo.commandLog.contains("notification.act") }
        XCTAssertFalse(frame.handle(["type": "print"]), "unknown to the frame: the page's")
        frame.stop()
    }

    func testEveryFrameCommandIsOnTheMenuBar() {
        let page = Set(MenuModel.pageCommands(debug: true))
        let handled = ["file.new-note", "file.new-folder", "file.new-tab", "file.open-quickly", "file.close-tab", "file.reopen-closed-tab", "file.tab-overview", "file.export", "note.star", "note.archive", "note.move", "note.duplicate", "note.history", "note.trash", "note.copy-link", "format.bold", "format.italic", "format.heading-1", "format.checklist", "format.style", "edit.find", "view.sidebar", "view.inspector", "go.back", "go.forward", "go.home", "go.today", "go.calendar", "go.ask-ai", "go.next-tab", "go.previous-tab", "go.tab-9", "help.help"]
        for id in handled { XCTAssertTrue(page.contains(id), id) }
    }

    func testBigBatchesComeThroughTheBridgeRoute() {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        let t = MacEngineTransport(view: view)
        var got: [Data] = []
        t.onBatch = { got.append($0) }
        let body = Data(#"[{"kind":"event","name":"engine.ready","data":{"place":null,"protocol":1,"revision":1}}]"#.utf8)
        XCTAssertTrue(BridgeBodies.shared.putCall("bigbatch123", body))
        // As the page posts it (WebViewTransport hands the string on as data).
        t.inner.onBatch?(Data(#"{"bodyId":"bigbatch123"}"#.utf8))
        XCTAssertEqual(got, [body])
        t.inner.onBatch?(Data("[]".utf8))
        XCTAssertEqual(got.last, Data("[]".utf8))
        t.detach()
    }

    func testRestorationKeepsTabsAndReadsOldFiles() throws {
        let old = #"{"v":1,"windows":[{"frame":[0,0,900,700],"path":"/d/a"}]}"#
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("windows-\(UUID().uuidString).json")
        try Data(old.utf8).write(to: url)
        XCTAssertEqual(WindowRestore.load(from: url).first?.tabs, nil)
        let tabs = TabsModel.Saved(tabs: [FrameTab(route: .note("a")), FrameTab(route: .folder("f"))], active: "a")
        let saves = WindowRestore.Saves(windows: [WindowRestore.Saved(frame: [0, 0, 900, 700], path: "/d/a", tabs: tabs)])
        try JSONEncoder().encode(saves).write(to: url)
        XCTAssertEqual(WindowRestore.load(from: url).first?.tabs, tabs)
        try? FileManager.default.removeItem(at: url)
    }
}
