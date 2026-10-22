// The Mac chrome's rules (Chrome/*.swift): the settings and Quick Add's shortcut, the window buttons' place, drag
// areas and double-clicks, window titles and restoration, notifications' actions, the save state's dot, the
// Settings window's sections and the text menu's words.
import AppKit
import Carbon.HIToolbox
import XCTest
@testable import Folevi

final class ChromeTests: XCTestCase {
    func testShortcutsSettingsAccept() {
        for ok in ["", "Alt+Space", "Command+Shift+K", "Control+Alt+F5", "CommandOrControl+Plus", "Alt+/"] {
            XCTAssertTrue(DesktopSettings.isValidShortcut(ok), ok)
        }
        // A bare key, or Shift with a key, would swallow typing everywhere; nonsense isn't a shortcut.
        for bad in ["K", "Shift+K", "Alt+Alt+K", "Alt+", "Hyper+K", "Alt+Spacebar", "Command+Shift"] {
            XCTAssertFalse(DesktopSettings.isValidShortcut(bad), bad)
        }
    }

    func testSettingsKeepOnlyWhatTheyKnow() {
        let base = DesktopSettings()
        let next = DesktopSettings.clean(["quickAddShortcut": "Shift+K", "openAtLogin": false, "menuBarIcon": "no", "notifications": false, "mode": "local"], base: base)
        XCTAssertEqual(next.quickAddShortcut, "Alt+Space", "an invalid shortcut keeps the one before")
        XCTAssertFalse(next.openAtLogin)
        XCTAssertTrue(next.menuBarIcon, "a value of the wrong type is ignored")
        XCTAssertFalse(next.notifications)
        XCTAssertEqual(Set(next.page.keys), ["quickAddShortcut", "openAtLogin", "menuBarIcon", "notifications"])
    }

    func testHotKeyFromAnAccelerator() {
        let space = HotKey.parse("Alt+Space")
        XCTAssertEqual(space?.keyCode, UInt32(kVK_Space))
        XCTAssertEqual(space?.modifiers, UInt32(optionKey))
        let k = HotKey.parse("Command+Shift+K")
        XCTAssertEqual(k?.keyCode, UInt32(kVK_ANSI_K))
        XCTAssertEqual(k?.modifiers, UInt32(cmdKey | shiftKey))
        XCTAssertEqual(HotKey.parse("Control+F12")?.keyCode, UInt32(kVK_F12))
        XCTAssertNil(HotKey.parse(""))
        XCTAssertNil(HotKey.parse("Shift+A"))
    }

    func testWindowButtonsOnThePagesSpot() {
        // The page's 60 × 52 traffic space at the window's top left: the buttons 2 pt in, 20 apart, centred on 26.
        let l = TitleBar.layout(spot: ButtonSpot(x: 0, y: 0, height: 52), zoom: 1, buttonSize: CGSize(width: 14, height: 14), spacing: 20, windowHeight: 820)
        XCTAssertEqual(l.container.height, 52)
        XCTAssertEqual(l.container.minY, 820 - 52)
        XCTAssertEqual(l.buttons.map(\.x), [2, 22, 42])
        XCTAssertEqual(l.buttons.map(\.y), [19, 19, 19])
        // At 120 % zoom the bar is taller and the spot further in.
        let z = TitleBar.layout(spot: ButtonSpot(x: 8, y: 8, height: 52), zoom: 1.2, buttonSize: CGSize(width: 14, height: 14), spacing: 20, windowHeight: 820)
        XCTAssertEqual(z.container.height, ((8 + 26) * 1.2 * 2).rounded())
        XCTAssertEqual(z.buttons.first?.x, (8 * 1.2 + 2).rounded())
    }

    func testDragAreas() {
        let bar = CGRect(x: 0, y: 0, width: 800, height: 52)
        let button = CGRect(x: 700, y: 10, width: 32, height: 32)
        XCTAssertTrue(TitleBar.isDrag(CGPoint(x: 400, y: 26), drag: [bar], noDrag: [button]))
        XCTAssertFalse(TitleBar.isDrag(CGPoint(x: 710, y: 26), drag: [bar], noDrag: [button]), "a button in the bar stays a button")
        XCTAssertFalse(TitleBar.isDrag(CGPoint(x: 400, y: 80), drag: [bar], noDrag: []), "below the bar")
        XCTAssertFalse(TitleBar.isDrag(CGPoint(x: 400, y: 26), drag: [], noDrag: []))
    }

    func testDoubleClickFollowsSystemSettings() {
        XCTAssertEqual(TitleBar.doubleClickAction(nil, legacyMinimize: nil), "zoom")
        XCTAssertEqual(TitleBar.doubleClickAction("Maximize", legacyMinimize: nil), "zoom")
        XCTAssertEqual(TitleBar.doubleClickAction("Fill", legacyMinimize: nil), "zoom")
        XCTAssertEqual(TitleBar.doubleClickAction("Minimize", legacyMinimize: nil), "minimize")
        XCTAssertEqual(TitleBar.doubleClickAction("None", legacyMinimize: true), "none")
        XCTAssertEqual(TitleBar.doubleClickAction(nil, legacyMinimize: true), "minimize")
    }

    func testWindowTitlesAreThePagesOwn() {
        XCTAssertEqual(TitleBar.cleanTitle("Meeting notes · Folevi"), "Meeting notes")
        XCTAssertEqual(TitleBar.cleanTitle("Folevi"), "Folevi")
        XCTAssertEqual(TitleBar.cleanTitle(""), "Folevi")
        XCTAssertEqual(TitleBar.cleanTitle(nil), "Folevi")
        XCTAssertEqual(TitleBar.cleanTitle(" · Folevi"), "Folevi")
    }

    func testRestorablePaths() {
        XCTAssertEqual(WindowRestore.restorablePath(URL(string: "app://folevi/d/01HZX3?x=1#block-abc")), "/d/01HZX3?x=1#block-abc")
        XCTAssertEqual(WindowRestore.restorablePath(URL(string: "app://folevi/quick-add?place=library")), "/")
        XCTAssertEqual(WindowRestore.restorablePath(URL(string: "app://folevi/place-sync?place=acct:x")), "/")
        XCTAssertEqual(WindowRestore.restorablePath(URL(string: "app://folevi/_offline?url=x")), "/")
        XCTAssertEqual(WindowRestore.restorablePath(URL(string: "https://evil.example/d/1")), "/")
        XCTAssertEqual(WindowRestore.restorablePath(nil), "/")
    }

    func testFramesComeBackOnAScreen() {
        let screen = NSRect(x: 0, y: 0, width: 1512, height: 944)
        let on = NSRect(x: 100, y: 100, width: 1280, height: 820)
        XCTAssertEqual(WindowRestore.fit(on, screens: [screen]), on)
        // A screen that's gone: centred on the one that's left, no bigger than it.
        let off = NSRect(x: 3000, y: 200, width: 1600, height: 1000)
        let fitted = WindowRestore.fit(off, screens: [screen])
        XCTAssertEqual(fitted.size, NSSize(width: 1512, height: 944))
        XCTAssertEqual(fitted.midX, screen.midX)
    }

    @MainActor
    func testWindowsFileRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-restore-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("windows.json")
        let saves = WindowRestore.Saves(windows: [
            .init(frame: [10, 20, 1280, 820], path: "/d/01ABC", hidden: nil),
            .init(frame: [40, 50, 900, 700], path: "/tasks/today", hidden: nil),
            .init(frame: [0, 0, 50, 50], path: "/", hidden: nil),
        ])
        try JSONEncoder().encode(saves).write(to: file)
        let back = WindowRestore.load(from: file)
        XCTAssertEqual(back.map(\.path), ["/d/01ABC", "/tasks/today"], "a frame too small to be a window is dropped")
        try Data("{\"v\":2,\"windows\":[]}".utf8).write(to: file)
        XCTAssertEqual(WindowRestore.load(from: file), [], "a newer format isn't guessed at")
    }

    func testNotificationActionsByKind() {
        XCTAssertEqual(Notifications.category(for: "mention", hasThread: true), .comment)
        XCTAssertEqual(Notifications.category(for: "comment", hasThread: true), .comment)
        XCTAssertEqual(Notifications.category(for: "reply", hasThread: false), .plain, "no thread to reply to")
        XCTAssertEqual(Notifications.category(for: "task_assigned", hasThread: false), .task)
        XCTAssertEqual(Notifications.category(for: "reminder", hasThread: false), .reminder)
        XCTAssertEqual(Notifications.category(for: "share", hasThread: false), .plain)
    }

    func testSaveStateDot() {
        XCTAssertEqual(StatusItem.statusKind("All changes saved"), "saved")
        XCTAssertEqual(StatusItem.statusKind("Saving…"), "working")
        XCTAssertEqual(StatusItem.statusKind("Syncing…"), "working")
        XCTAssertEqual(StatusItem.statusKind("Offline: changes are kept on this Mac"), "offline")
        XCTAssertEqual(StatusItem.statusKind("A change needs your review"), "attention")
        XCTAssertEqual(StatusItem.statusKind("Some changes couldn't be saved"), "error")
    }

    func testSettingsSections() {
        let local = SettingsWindow.sections(mode: "local", ai: true).map(\.title)
        XCTAssertEqual(local, ["General", "Appearance", "Library", "Foli AI", "Import & Export"])
        let account = SettingsWindow.sections(mode: "account", ai: false).map(\.id)
        XCTAssertEqual(account.first, "desktop")
        XCTAssertTrue(account.contains("account"))
        XCTAssertFalse(account.contains("ai"), "Foli AI is hidden while AI is off")
        XCTAssertFalse(account.contains("billing"), "billing is on the website")
        XCTAssertEqual(SettingsWindow.path("appearance"), "/settings/appearance?window=1")
    }

    func testTextMenuWords() {
        XCTAssertEqual(TextMenu.word(" teh, "), "teh")
        XCTAssertEqual(TextMenu.word("don’t"), "don’t")
        XCTAssertNil(TextMenu.word("two words"))
        XCTAssertNil(TextMenu.word("  "))
    }
}
