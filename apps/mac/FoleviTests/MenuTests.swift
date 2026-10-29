// The menu bar (Chrome/MenuModel.swift, MainMenu.swift; docs/MAC_POLISH_PLAN.md §3.1): every item does something,
// no shortcut is used twice, the page's own shortcuts are where the page has them, and the built NSMenus carry it
// all. That the page knows every command is the web's test (apps/web/test/macMenuCommands.test.ts reads this model).
import AppKit
import WebKit
import XCTest
@testable import Folevi

final class MenuTests: XCTestCase {
    private let items = MenuModel.allItems(debug: true)

    func testEveryItemHasAnIdATitleAndSomethingToDo() {
        var ids = Set<String>()
        for item in items {
            XCTAssertFalse(item.id.isEmpty)
            XCTAssertTrue(ids.insert(item.id).inserted, "\(item.id) twice")
            if !item.alternate { XCTAssertFalse(item.title.isEmpty, item.id) }
            switch item.action {
            case .page(let c), .app(let c): XCTAssertFalse(c.isEmpty, item.id)
            case .system(let name):
                let sel = NSSelectorFromString(name)
                let answered = [NSApplication.self, AppDelegate.self, NSWindow.self, WKWebView.self, NSTextView.self, NSResponder.self].contains { $0.instancesRespond(to: sel) }
                XCTAssertTrue(answered, "\(item.id): nothing answers \(name)")
            }
            // A hidden second shortcut always stands for a visible item.
            if item.alternate { XCTAssertTrue(ids.contains(String(item.id.dropLast(4))) || items.contains { $0.id == String(item.id.dropLast(4)) }, item.id) }
        }
    }

    func testNoShortcutTwice() {
        var seen: [MenuKey: String] = [:]
        for item in items {
            guard let key = item.key else { continue }
            XCTAssertNil(seen[key], "\(key.label) is both \(seen[key] ?? "") and \(item.id)")
            seen[key] = item.id
            XCTAssertFalse(key.mods.isEmpty && key.key.count == 1 && key.key.rangeOfCharacter(from: .alphanumerics) != nil, "\(item.id): a bare letter would take typing")
        }
    }

    /// The polish plan's shortcuts, and the page's own where it has them (Shell.tsx, the editor's keymaps).
    func testTheShortcutsThePlanAndThePageUse() {
        let expected: [String: String] = [
            "app.settings": "⌘,", "app.quit": "⌘Q", "app.hide": "⌘H", "app.hide-others": "⌥⌘H",
            "file.new-note": "⌘N", "file.new-from-template": "⌥⇧⌘N", "file.new-folder": "⌃⌘N", "file.quick-add-task": "⇧⌘A",
            "file.new-tab": "⌘T", "file.new-window": "⇧⌘N", "file.open-quickly": "⌘K", "file.close-tab": "⌘W", "file.close-window": "⇧⌘W",
            "file.reopen-closed-tab": "⇧⌘T", "file.export": "⇧⌘E", "file.print": "⌘P",
            "edit.undo": "⌘Z", "edit.redo": "⇧⌘Z", "edit.paste-plain": "⌥⇧⌘V", "edit.find": "⌘F", "edit.find-next": "⌘G", "edit.find-previous": "⇧⌘G", "edit.search-all": "⇧⌘F",
            "format.bold": "⌘B", "format.italic": "⌘I", "format.underline": "⌘U", "format.strikethrough": "⇧⌘X", "format.code": "⌘E", "format.highlight": "⇧⌘H",
            "format.link": "⌥⌘K", "format.heading-1": "⌥⌘1", "format.heading-2": "⌥⌘2", "format.heading-3": "⌥⌘3", "format.body": "⌥⌘0",
            "format.bulleted-list": "⇧⌘8", "format.numbered-list": "⇧⌘7", "format.checklist": "⇧⌘9", "format.move-up": "⌥⇧↑", "format.move-down": "⌥⇧↓", "format.duplicate": "⌘D",
            "note.move": "⇧⌘M", "note.copy-link": "⌃⌘C", "note.trash": "⌘⌫",
            "view.sidebar": "⌘\\", "view.sidebar.alt": "⌃⌘S", "view.inspector": "⌥⌘I", "view.focus": "⇧⌘\\", "view.actual-size": "⌘0", "view.zoom-in": "⌘+", "view.zoom-out": "⌘-", "view.full-screen": "⌃⌘F",
            "go.back": "⌘[", "go.forward": "⌘]", "go.today": "⌥⌘T", "go.calendar": "⌥⌘C", "go.ask-ai": "⌘J",
            "go.next-tab": "⌃⇥", "go.next-tab.alt": "⇧⌘]", "go.previous-tab": "⌃⇧⇥", "go.previous-tab.alt": "⇧⌘[", "go.tab-1": "⌘1", "go.tab-9": "⌘9",
            "window.minimize": "⌘M", "help.shortcuts": "⌘/",
        ]
        let byId = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
        for (id, label) in expected {
            XCTAssertEqual(byId[id]?.key?.label, label, id)
        }
        // Settled conflicts: ⌘E stays inline code, so Use Selection for Find has none; ⇧⌘H stays Highlight, so
        // Home has none; ⌘S does nothing (Folevi saves itself).
        XCTAssertNil(byId["edit.find-selection"]?.key)
        XCTAssertNil(byId["go.home"]?.key)
        XCTAssertFalse(items.contains { $0.key == MenuKey(key: "s", mods: .cmd) })
        // Tab and ⇧Tab stay the editor's and the fields'.
        XCTAssertFalse(items.contains { $0.key?.key == MenuKey.tab && !$0.key!.mods.contains(.ctrl) })
    }

    func testMenusInOrder() {
        XCTAssertEqual(MenuModel.menus(debug: false).map(\.title), ["Folevi", "File", "Edit", "Format", "Note", "View", "Go", "Window", "Help"])
        // Developer items exist only in Debug builds.
        XCTAssertEqual(MenuModel.menus(debug: true).last?.title, "Debug")
        XCTAssertFalse(MenuModel.allItems(debug: false).contains { $0.id.hasPrefix("debug.") })
    }

    @MainActor
    func testBuiltMenus() {
        let main = MainMenu.shared.build()
        XCTAssertEqual(main.items.map(\.title), MenuModel.menus(debug: Paths.isDebug).map(\.title))
        let new = MainMenu.shared.itemsById["file.new-note"]
        XCTAssertEqual(new?.keyEquivalent, "n")
        XCTAssertEqual(new?.keyEquivalentModifierMask, [.command])
        XCTAssertTrue(new?.target === MainMenu.shared)
        // AppKit's own actions go to the first responder.
        XCTAssertNil(MainMenu.shared.itemsById["edit.copy"]?.target)
        XCTAssertEqual(MainMenu.shared.itemsById["edit.copy"]?.action, #selector(NSText.copy(_:)))
        // The hidden second shortcuts still work.
        let alt = MainMenu.shared.itemsById["view.sidebar.alt"]
        XCTAssertEqual(alt?.isHidden, true)
        XCTAssertEqual(alt?.allowsKeyEquivalentWhenHidden, true)
        XCTAssertTrue(NSApp.windowsMenu === MainMenu.shared.menusById["window"])
        XCTAssertTrue(NSApp.helpMenu === MainMenu.shared.menusById["help"])
        XCTAssertNotNil(NSApp.servicesMenu)
    }

    /// About Folevi says "Version 1.0.00" and no build number (AppKit adds "(<CFBundleVersion>)" unless told not to).
    func testAboutShowsTheVersionAlone() {
        guard case .system(let name)? = items.first(where: { $0.id == "app.about" })?.action else { return XCTFail("no About Folevi") }
        XCTAssertEqual(name, "showAboutPanel:")
        let options = AppDelegate.aboutPanelOptions
        XCTAssertEqual(options[.version] as? String, "")
        XCTAssertEqual(options[.applicationVersion] as? String, Paths.version)
        // The owner's format, MAJOR.UPDATE.PATCH as #.#.## (version.json, scripts/version.mjs), which Apple takes as
        // three whole numbers; the build is a whole number on its own.
        XCTAssertNotNil(Paths.version.range(of: #"^\d{1,3}\.\d\.\d{2}$"#, options: .regularExpression), Paths.version)
        XCTAssertNotNil(Paths.build.range(of: #"^\d+$"#, options: .regularExpression), Paths.build)
    }

    func testGlobalShortcutAsAMenuKey() {
        XCTAssertEqual(MainMenu.menuKey("Alt+Space")?.0, " ")
        XCTAssertEqual(MainMenu.menuKey("Alt+Space")?.1, [.option])
        XCTAssertEqual(MainMenu.menuKey("Command+Shift+K")?.0, "k")
        XCTAssertEqual(MainMenu.menuKey("Command+Shift+K")?.1, [.command, .shift])
        XCTAssertEqual(MainMenu.menuKey("Control+F5")?.0, String(UnicodeScalar(0xF708)!))
        XCTAssertNil(MainMenu.menuKey(""))
        XCTAssertNil(MainMenu.menuKey("Hyper+K"))
    }
}
