// "Float this note" (Chrome/FloatWindows.swift): one panel per note, on top of other apps until unpinned, its pin
// remembered, its size and place kept by name, and the bridge's calls. The panels are made but never put on the
// screen (showsWindows off): nothing appears on the desktop while the tests run.
import AppKit
import WebKit
import XCTest
@testable import Folevi

@MainActor
final class FloatTests: XCTestCase {
    private var made: [String] = []

    override func setUp() async throws {
        FloatWindows.shared.showsWindows = false
        // A web view that loads nothing (no scheme handler, no bridge).
        FloatWindows.shared.makeView = { place, frame, _ in FoleviWebView(frame: frame, configuration: WKWebViewConfiguration(), place: place, role: .float) }
    }

    override func tearDown() async throws {
        for id in made {
            FloatWindows.shared.open[id]?.window?.close()
            UserDefaults.standard.removeObject(forKey: FloatWindows.onTopKey(id))
            UserDefaults.standard.removeObject(forKey: "NSWindow Frame \(FloatWindowController.frameName(id))")
        }
        made = []
    }

    private func note() -> String {
        let id = "TEST" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(20)
        made.append(id)
        return id
    }

    func testNoteIds() {
        XCTAssertTrue(FloatWindows.isNoteId("01JABCDEFGHJKMNPQRSTVWXYZ0"))
        XCTAssertFalse(FloatWindows.isNoteId(""))
        XCTAssertFalse(FloatWindows.isNoteId("../settings"))
        XCTAssertFalse(FloatWindows.isNoteId("a b"))
        XCTAssertFalse(FloatWindows.isNoteId(String(repeating: "A", count: 65)))
        XCTAssertFalse(FloatWindows.isNoteId("é"))
    }

    func testOnePanelPerNoteOnTopOfOtherApps() throws {
        let id = note()
        let first = try XCTUnwrap(FloatWindows.shared.float(noteId: id, title: "Groceries", place: "library"))
        let again = FloatWindows.shared.float(noteId: id, title: "Groceries", place: "library")
        XCTAssertTrue(first === again, "floating it again brings the same panel forward")
        XCTAssertEqual(FloatWindows.shared.open.keys.filter { $0 == id }.count, 1)

        let panel = try XCTUnwrap(first.window as? FloatPanel)
        XCTAssertEqual(panel.level, .floating)
        XCTAssertTrue(panel.collectionBehavior.contains(.canJoinAllSpaces))
        XCTAssertTrue(panel.collectionBehavior.contains(.fullScreenAuxiliary))
        XCTAssertFalse(panel.hidesOnDeactivate, "it stays when another app is in front")
        XCTAssertTrue(panel.canBecomeKey, "the note is edited in it")
        XCTAssertTrue(panel.styleMask.contains(.resizable))
        XCTAssertEqual(panel.minSize, FloatWindowController.minSize)
        XCTAssertEqual(panel.frameAutosaveName, "FoleviFloat-\(id)")
        XCTAssertEqual(panel.title, "Groceries")
        for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            XCTAssertEqual(panel.standardWindowButton(b)?.isHidden ?? true, true, "the page's bar has Close")
        }
        XCTAssertEqual(first.view.role, .float)
        XCTAssertEqual(first.view.place, "library")
        XCTAssertTrue(first.view.superview === panel.contentView)
    }

    func testSeveralNotesFloatAtOnce() throws {
        let a = note(), b = note()
        let pa = try XCTUnwrap(FloatWindows.shared.float(noteId: a, title: "A", place: nil))
        let pb = try XCTUnwrap(FloatWindows.shared.float(noteId: b, title: "B", place: nil))
        XCTAssertFalse(pa === pb)
        XCTAssertFalse(pa.window === pb.window)
    }

    func testThePinTurnsOffAndIsRemembered() throws {
        let id = note()
        XCTAssertTrue(FloatWindows.onTop(id), "on until turned off")
        let c = try XCTUnwrap(FloatWindows.shared.float(noteId: id, title: "", place: nil))
        XCTAssertEqual(FloatWindows.shared.onTop(of: c.view, set: nil), true)
        XCTAssertEqual(FloatWindows.shared.onTop(of: c.view, set: false), false)
        XCTAssertEqual(c.window?.level, .normal)
        XCTAssertTrue(c.window?.collectionBehavior.contains(.managed) == true)
        XCTAssertFalse(FloatWindows.onTop(id))
        c.window?.close()
        XCTAssertNil(FloatWindows.shared.open[id], "a closed panel is let go")
        let reopened = try XCTUnwrap(FloatWindows.shared.float(noteId: id, title: "", place: nil))
        XCTAssertEqual(reopened.window?.level, .normal, "it opens as it was left")
        XCTAssertEqual(FloatWindows.shared.onTop(of: reopened.view, set: true), true)
        XCTAssertTrue(FloatWindows.onTop(id))
    }

    func testThePinAnswersOnlyInsideAPanel() {
        let other = FoleviWebView(frame: .zero, configuration: WKWebViewConfiguration(), place: nil, role: .main)
        XCTAssertNil(FloatWindows.shared.onTop(of: other, set: true))
        XCTAssertNil(FloatWindows.shared.onTop(of: nil, set: nil))
    }

    func testRefusesWhatIsntANote() {
        XCTAssertNil(FloatWindows.shared.float(noteId: "../../etc", title: "", place: nil))
        XCTAssertNil(FloatWindows.shared.float(noteId: "", title: "", place: nil))
    }

    func testTheBridgeOffersTheCalls() async throws {
        FloatWindows.install()
        XCTAssertTrue(DesktopRouter.features.isSuperset(of: ["floatNote", "floatOnTop"]))
        let id = note()
        let router = DesktopRouter(context: BridgeContext(place: { "acct:u1" }, window: { nil }, events: ViewEvents()))
        _ = try await router.handle("floatNote", ["id": id, "title": "From the page"])
        let c = try XCTUnwrap(FloatWindows.shared.open[id])
        XCTAssertEqual(c.view.place, "acct:u1", "in the place of the window that asked")
        _ = try await router.handle("floatNote", ["id": "not an id", "title": ""])
        XCTAssertNil(FloatWindows.shared.open["not an id"])
        // From a view that isn't a panel's, the pin has no answer.
        let answer = try await router.handle("floatOnTop", ["on": false])
        XCTAssertTrue(answer["value"] is NSNull)
    }

    func testTheBridgeScriptHasTheMembers() throws {
        let url = try XCTUnwrap(Bundle(for: FloatPanel.self).url(forResource: "mac-bridge", withExtension: "js"))
        let js = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(js.contains("desktop.floatNote = function"))
        XCTAssertTrue(js.contains("desktop.floatOnTop = function"))
    }
}
