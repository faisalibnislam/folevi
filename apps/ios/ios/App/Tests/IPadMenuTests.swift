// The iPad's menu bar (Native/Rebuild/RebuildMenuBar.swift) against the Mac's: the AppKit Mac app's MenuModel.swift,
// kept as MacMenuModel.reference.txt beside this test since that app was retired (2026-11-23, tag archive/mac-appkit): the same ids, titles and shortcuts where the iPad has the item, no shortcut twice, and
// every Mac item the iPad leaves out named here with why.
import GameController
import UIKit
import XCTest
@testable import App

@MainActor
final class IPadMenuTests: XCTestCase {
    /// The Mac's items the iPad doesn't have, and why.
    private let macOnly: [String: String] = [
        "app.about": "iPadOS's own app menu",
        "app.check-for-updates": "the App Store updates the app",
        "app.hide": "macOS only", "app.hide-others": "macOS only", "app.show-all": "macOS only", "app.quit": "macOS only",
        "file.quick-add-anywhere": "a global hotkey, macOS only",
        "file.new-window": "one window on iPad (docs/IOS.md)",
        "file.close-window": "one window on iPad (docs/IOS.md)",
        "edit.undo": "iPadOS's own Edit items", "edit.redo": "iPadOS's own Edit items", "edit.cut": "iPadOS's own Edit items",
        "edit.copy": "iPadOS's own Edit items", "edit.paste": "iPadOS's own Edit items",
        "edit.paste-plain": "iPadOS's own Edit items", "edit.delete": "iPadOS's own Edit items",
        "edit.select-all": "iPadOS's own Edit items",
        "edit.spelling.show": "AppKit panel", "edit.spelling.check": "AppKit panel",
        "edit.spelling.while-typing": "AppKit", "edit.spelling.grammar": "AppKit", "edit.spelling.correct": "AppKit",
        "edit.substitutions.show": "AppKit panel", "edit.substitutions.smart-copy": "AppKit",
        "edit.substitutions.quotes": "AppKit", "edit.substitutions.dashes": "AppKit", "edit.substitutions.links": "AppKit",
        "edit.substitutions.text": "AppKit",
        "edit.transformations.upper": "AppKit", "edit.transformations.lower": "AppKit", "edit.transformations.capitalize": "AppKit",
        "edit.speech.start": "AppKit", "edit.speech.stop": "AppKit",
        "view.cards": "the Mac's list controller", "view.list": "the Mac's list controller",
        "view.full-screen": "macOS only",
        "window.minimize": "macOS only", "window.zoom": "macOS only", "window.float-note": "macOS only",
        "window.front": "macOS only",
        "debug.reload": "Mac Debug menu", "debug.reload-all": "Mac Debug menu", "debug.support-folder": "Mac Debug menu",
    ]

    private struct MacItem {
        var id: String
        var title: String
        var key: String?
    }

    /// The Mac's MenuModel, read as text: each item's id, title and shortcut (as MenuKey.label writes it).
    private func macItems() throws -> [String: MacItem] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("MacMenuModel.reference.txt").standardized
        let text = try String(contentsOf: url, encoding: .utf8)
        var found: [String: MacItem] = [:]
        let patterns = [
            #"(?:page|app)\("([^"]+)", "([^"]+)"(?:, k\((.*?)\))?(?:, window: true)?\)"#,
            #"sys\("([^"]+)", "([^"]+)", "[^"]+"(?:, k\((.*?)\))?\)"#,
        ]
        for pattern in patterns {
            let re = try NSRegularExpression(pattern: pattern)
            for m in re.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                let id = String(text[Range(m.range(at: 1), in: text)!])
                guard !id.contains("\\(") else { continue }
                let title = String(text[Range(m.range(at: 2), in: text)!])
                let key = Range(m.range(at: 3), in: text).map { macLabel(String(text[$0])) }
                found[id] = MacItem(id: id, title: title, key: key)
            }
        }
        let alt = try NSRegularExpression(pattern: #"alt\("([^"]+)", k\((.*?)\), "#)
        for m in alt.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            let id = String(text[Range(m.range(at: 1), in: text)!]) + ".alt"
            found[id] = MacItem(id: id, title: "", key: macLabel(String(text[Range(m.range(at: 2), in: text)!])))
        }
        for n in 1...9 { found["go.tab-\(n)"] = MacItem(id: "go.tab-\(n)", title: "Tab \(n)", key: "⌘\(n)") }
        return found
    }

    /// `"n", [.cmd, .opt]` or `MenuKey.backspace` as MenuKey.label writes it.
    private func macLabel(_ args: String) -> String {
        // The key: a string literal (which may be ",") or MenuKey.name; then the modifiers, if any.
        var first = args
        var rest = ""
        if args.hasPrefix("\"") {
            var i = args.index(after: args.startIndex)
            while i < args.endIndex, args[i] != "\"" { i = args[i] == "\\" ? args.index(i, offsetBy: 2) : args.index(after: i) }
            first = String(args[...i])
            rest = String(args[args.index(after: i)...])
        } else if let comma = args.firstIndex(of: ",") {
            first = String(args[..<comma])
            rest = String(args[comma...])
        }
        let parts = [first.trimmingCharacters(in: .whitespaces)]
        let mods = rest.contains(".") ? rest : ".cmd"
        var s = ""
        if mods.contains(".ctrl") { s += "⌃" }
        if mods.contains(".opt") { s += "⌥" }
        if mods.contains(".shift") { s += "⇧" }
        if mods.contains(".cmd") { s += "⌘" }
        switch parts[0] {
        case "MenuKey.backspace": s += "⌫"
        case "MenuKey.tab": s += "⇥"
        case "MenuKey.up": s += "↑"
        case "MenuKey.down": s += "↓"
        default:
            let literal = parts[0].dropFirst().dropLast().replacingOccurrences(of: "\\\\", with: "\\")
            s += literal.uppercased()
        }
        return s
    }

    func testTheMacsReaderFindsItsMenus() throws {
        let mac = try macItems()
        XCTAssertGreaterThan(mac.count, 100)
        XCTAssertEqual(mac["file.new-from-template"]?.key, "⌥⇧⌘N")
        XCTAssertEqual(mac["note.trash"]?.key, "⌘⌫")
        XCTAssertEqual(mac["view.sidebar.alt"]?.key, "⌃⌘S")
        XCTAssertEqual(mac["view.sidebar"]?.key, "⌘\\")
    }

    func testEveryItemIsTheMacsWithItsTitleAndShortcut() throws {
        let mac = try macItems()
        for item in IPadMenuModel.allItems {
            let theirs = try XCTUnwrap(mac[item.id], "\(item.id) isn't one of the Mac's items")
            if !item.alternate { XCTAssertEqual(item.title, theirs.title, item.id) }
            XCTAssertEqual(item.key?.label, theirs.key, item.id)
        }
    }

    func testEveryMacItemIsOnTheIPadOrLeftOutForAReason() throws {
        let ours = Set(IPadMenuModel.allItems.map(\.id))
        for id in try macItems().keys where !ours.contains(id) {
            XCTAssertNotNil(macOnly[id], "The Mac's \(id) is neither in the iPad's menu bar nor left out on purpose")
        }
        for id in macOnly.keys { XCTAssertFalse(ours.contains(id), "\(id) is left out but in the menu bar") }
    }

    func testTheShortcutsAskedForAreThere() {
        let byLabel = Dictionary(IPadMenuModel.allItems.compactMap { i in i.key.map { ($0.label, i.id) } }, uniquingKeysWith: { a, _ in a })
        let wanted = [
            "⌃⌘N": "file.new-folder", "⌘T": "file.new-tab", "⌥⇧⌘N": "file.new-from-template", "⇧⌘E": "file.export",
            "⇧⌘M": "note.move", "⌃⌘C": "note.copy-link", "⌘⌫": "note.trash", "⌥⌘I": "view.inspector",
            "⌥⌘\\": "view.focus", "⌥⌘C": "go.calendar", "⌘F": "edit.find", "⌘G": "edit.find-next", "⌘/": "help.shortcuts",
            "⌘P": "file.print", "⌘0": "view.actual-size", "⌘+": "view.zoom-in", "⌘-": "view.zoom-out", "⌘,": "app.settings",
            // The ones the iPad had before the menu bar keep their keys.
            "⌘N": "file.new-note", "⌘K": "file.open-quickly", "⇧⌘A": "file.quick-add-task", "⌘J": "go.ask-ai",
            "⌥⌘T": "go.today", "⌘[": "go.back", "⌘]": "go.forward", "⌘W": "file.close-tab", "⇧⌘T": "file.reopen-closed-tab",
            "⇧⌘F": "edit.search-all", "⇧⌘\\": "file.tab-overview", "⌃⇥": "go.next-tab", "⌃⇧⇥": "go.previous-tab", "⌘1": "go.tab-1",
        ]
        for (label, id) in wanted { XCTAssertEqual(byLabel[label], id, label) }
        XCTAssertEqual(IPadMenuModel.allItems.first { $0.id == "view.sidebar" }?.key?.label, "⌘\\")
    }

    func testNoShortcutTwice() {
        var seen: [String: String] = [:]
        for item in IPadMenuModel.allItems {
            guard let label = item.key?.label else { continue }
            XCTAssertNil(seen[label], "\(label) is both \(seen[label] ?? "") and \(item.id)")
            seen[label] = item.id
        }
    }

    func testTheMenusAreTheMacs() {
        XCTAssertEqual(IPadMenuModel.menus.map(\.title), ["File", "Edit", "Format", "Note", "View", "Go", "Help"])
        XCTAssertEqual(IPadMenuModel.settings.key?.label, "⌘,")
    }

    func testThePagesKeysAreKnownToTheKeyboard() throws {
        for id in IPadMenuModel.pageKeys {
            let item = try XCTUnwrap(IPadMenuModel.allItems.first { $0.id == id }, id)
            let key = try XCTUnwrap(item.key, id)
            XCTAssertNotNil(IPadMenuBar.keyCode(key.input), "\(id): no key code for \(key.label)")
        }
        XCTAssertEqual(IPadMenuBar.keyCode(UIKeyCommand.inputDelete), .deleteOrBackspace)
        XCTAssertEqual(IPadMenuBar.keyCode("B"), .keyB)
    }

    func testNarrowWindowItemsAreItems() {
        let ids = Set(IPadMenuModel.allItems.map(\.id))
        XCTAssertTrue(IPadMenuBar.narrowItems.isSubset(of: ids), "\(IPadMenuBar.narrowItems.subtracting(ids))")
    }

    func testItemsCarryTheirIdsAndAlternatesTheirItems() {
        let command = UIKeyCommand(title: "", action: #selector(AppDelegate.foleviMenu(_:)), input: "s", modifierFlags: [.command, .control], propertyList: "view.sidebar.alt")
        XCTAssertEqual(IPadMenuBar.id(of: command), "view.sidebar")
        XCTAssertEqual(IPadMenuBar.id(of: UICommand(title: "Home", action: #selector(AppDelegate.foleviMenu(_:)), propertyList: "go.home")), "go.home")
        XCTAssertNil(IPadMenuBar.id(of: nil))
    }

    func testNothingRunsBeforeTheEngineIsUp() {
        // (No frame in the test host's window yet, or not past the screens before the app.)
        if RebuildFrameController.current?.model.client.state != .ready {
            XCTAssertFalse(IPadMenuBar.isEnabled("file.new-note", sender: nil))
        }
    }

    /// View > Zoom steps through the page's own text sizes (lib/editorZoom.ts) until the engine names them.
    func testZoomStepsThroughThePagesTextSizes() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../web/src/lib/editorZoom.ts").standardized
        let text = try String(contentsOf: url, encoding: .utf8)
        let line = try XCTUnwrap(text.split(separator: "\n").first { $0.hasPrefix("export const EDITOR_ZOOMS = [") })
        let inner = line.drop { $0 != "[" }.dropFirst().prefix { $0 != "]" }
        let page = inner.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        XCTAssertEqual(PageZoom.fallbackLevels, page)
    }
}
