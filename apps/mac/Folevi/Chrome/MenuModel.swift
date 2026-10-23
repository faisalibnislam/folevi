// The menu bar as data (docs/MAC_POLISH_PLAN.md §3.1): every menu, item, shortcut and what it does. MainMenu.swift
// turns it into NSMenus; MenuTests checks it (every item does something, no shortcut twice, the page's own
// shortcuts where the page has them). Kept free of AppKit state so the tests read it as it is.
//
// Three kinds of action:
//   .page(id)    a command for the page: foleviDesktop.onCommand gets { type: "menu", id } (DesktopBridge.tsx).
//                When the item has the page's own shortcut, the page usually takes the key itself (WKWebView
//                hands key equivalents to the page first) and the menu only runs on a click.
//   .app(id)     done by the app (a new window, Settings, Quick Add's panel, zoom, print).
//   .system(sel) AppKit's standard action for the first responder (cut:, undo:, toggleFullScreen:, ...).
import Foundation

struct MenuMods: OptionSet, Hashable {
    let rawValue: Int
    static let cmd = MenuMods(rawValue: 1)
    static let shift = MenuMods(rawValue: 2)
    static let opt = MenuMods(rawValue: 4)
    static let ctrl = MenuMods(rawValue: 8)
}

/// A shortcut: the key as NSMenuItem spells it (lowercase letters, "\u{8}" for ⌫, the arrow function keys) and
/// its modifiers.
struct MenuKey: Hashable {
    var key: String
    var mods: MenuMods

    static let backspace = "\u{8}"
    static let tab = "\t"
    static let up = String(UnicodeScalar(0xF700)!)
    static let down = String(UnicodeScalar(0xF701)!)

    /// As the Mac writes it (⌥⇧⌘N): for tests and the eval hook's listing.
    var label: String {
        var s = ""
        if mods.contains(.ctrl) { s += "⌃" }
        if mods.contains(.opt) { s += "⌥" }
        if mods.contains(.shift) { s += "⇧" }
        if mods.contains(.cmd) { s += "⌘" }
        switch key {
        case Self.backspace: s += "⌫"
        case Self.tab: s += "⇥"
        case Self.up: s += "↑"
        case Self.down: s += "↓"
        case " ": s += "Space"
        default: s += key.uppercased()
        }
        return s
    }
}

enum MenuAction: Equatable {
    case page(String)
    case app(String)
    case system(String)
}

struct MenuItemSpec {
    var id: String
    var title: String
    var key: MenuKey?
    var action: MenuAction
    /// A second shortcut for another item (⌃⌘S beside ⌘\): hidden, its key still works.
    var alternate = false
    /// Needs a main window in front (formatting, the note's commands); without one it's off. Commands that
    /// make sense anywhere (New Note, Go) bring a main window forward instead.
    var needsWindow = false
}

indirect enum MenuNode {
    case item(MenuItemSpec)
    case separator
    case submenu(id: String, title: String, nodes: [MenuNode])
    /// AppKit's Services submenu.
    case services
    /// File > Share: filled when it opens (Mac capabilities, WM5, add the services; hidden until then).
    case share
}

struct MenuSpec {
    var id: String
    var title: String
    var nodes: [MenuNode]
}

enum MenuModel {
    // MARK: builders

    private static func k(_ key: String, _ mods: MenuMods = .cmd) -> MenuKey { MenuKey(key: key, mods: mods) }

    private static func page(_ id: String, _ title: String, _ key: MenuKey? = nil, window: Bool = false) -> MenuNode {
        .item(MenuItemSpec(id: id, title: title, key: key, action: .page(id), needsWindow: window))
    }

    private static func app(_ id: String, _ title: String, _ key: MenuKey? = nil) -> MenuNode {
        .item(MenuItemSpec(id: id, title: title, key: key, action: .app(id)))
    }

    private static func sys(_ id: String, _ title: String, _ selector: String, _ key: MenuKey? = nil) -> MenuNode {
        .item(MenuItemSpec(id: id, title: title, key: key, action: .system(selector)))
    }

    private static func alt(_ of: String, _ key: MenuKey, _ action: MenuAction, window: Bool = false) -> MenuNode {
        .item(MenuItemSpec(id: "\(of).alt", title: "", key: key, action: action, alternate: true, needsWindow: window))
    }

    // MARK: the menus

    static func menus(debug: Bool) -> [MenuSpec] {
        var all: [MenuSpec] = [
            MenuSpec(id: "app", title: "Folevi", nodes: [
                sys("app.about", "About Folevi", "showAboutPanel:"),
                app("app.check-for-updates", "Check for Updates…"),
                .separator,
                app("app.settings", "Settings…", k(",")),
                .separator,
                .services,
                .separator,
                sys("app.hide", "Hide Folevi", "hide:", k("h")),
                sys("app.hide-others", "Hide Others", "hideOtherApplications:", k("h", [.cmd, .opt])),
                sys("app.show-all", "Show All", "unhideAllApplications:"),
                .separator,
                sys("app.quit", "Quit Folevi", "terminate:", k("q")),
            ]),
            MenuSpec(id: "file", title: "File", nodes: [
                page("file.new-note", "New Note", k("n")),
                page("file.new-from-template", "New Note from Template…", k("n", [.cmd, .opt, .shift])),
                page("file.new-folder", "New Folder", k("n", [.cmd, .ctrl])),
                page("file.quick-add-task", "Quick Add Task…", k("a", [.cmd, .shift])),
                // Its key is the global shortcut from Settings (MainMenu fills it in); the panel opens over any app.
                app("file.quick-add-anywhere", "Quick Add from Any App"),
                .separator,
                page("file.new-tab", "New Tab", k("t")),
                app("file.new-window", "New Window", k("n", [.cmd, .shift])),
                page("file.open-quickly", "Open Quickly…", k("k")),
                .separator,
                page("file.close-tab", "Close Tab", k("w")),
                sys("file.close-window", "Close Window", "performClose:", k("w", [.cmd, .shift])),
                page("file.reopen-closed-tab", "Reopen Closed Tab", k("t", [.cmd, .shift])),
                .separator,
                page("file.import", "Import…"),
                page("file.export", "Export…", k("e", [.cmd, .shift]), window: true),
                .separator,
                .share,
                app("file.print", "Print…", k("p")),
            ]),
            MenuSpec(id: "edit", title: "Edit", nodes: [
                sys("edit.undo", "Undo", "undo:", k("z")),
                sys("edit.redo", "Redo", "redo:", k("z", [.cmd, .shift])),
                .separator,
                sys("edit.cut", "Cut", "cut:", k("x")),
                sys("edit.copy", "Copy", "copy:", k("c")),
                sys("edit.paste", "Paste", "paste:", k("v")),
                sys("edit.paste-plain", "Paste and Match Style", "pasteAsPlainText:", k("v", [.cmd, .opt, .shift])),
                sys("edit.delete", "Delete", "delete:"),
                sys("edit.select-all", "Select All", "selectAll:", k("a")),
                .separator,
                .submenu(id: "edit.find", title: "Find", nodes: [
                    page("edit.find", "Find…", k("f"), window: true),
                    page("edit.find-next", "Find Next", k("g"), window: true),
                    page("edit.find-previous", "Find Previous", k("g", [.cmd, .shift]), window: true),
                    // No shortcut: ⌘E is inline code.
                    page("edit.find-selection", "Use Selection for Find", window: true),
                ]),
                page("edit.search-all", "Search All Notes", k("f", [.cmd, .shift])),
                .separator,
                .submenu(id: "edit.spelling", title: "Spelling and Grammar", nodes: [
                    sys("edit.spelling.show", "Show Spelling and Grammar", "showGuessPanel:", k(":")),
                    sys("edit.spelling.check", "Check Document Now", "checkSpelling:", k(";")),
                    .separator,
                    sys("edit.spelling.while-typing", "Check Spelling While Typing", "toggleContinuousSpellChecking:"),
                    sys("edit.spelling.grammar", "Check Grammar With Spelling", "toggleGrammarChecking:"),
                    sys("edit.spelling.correct", "Correct Spelling Automatically", "toggleAutomaticSpellingCorrection:"),
                ]),
                .submenu(id: "edit.substitutions", title: "Substitutions", nodes: [
                    sys("edit.substitutions.show", "Show Substitutions", "orderFrontSubstitutionsPanel:"),
                    .separator,
                    sys("edit.substitutions.smart-copy", "Smart Copy/Paste", "toggleSmartInsertDelete:"),
                    sys("edit.substitutions.quotes", "Smart Quotes", "toggleAutomaticQuoteSubstitution:"),
                    sys("edit.substitutions.dashes", "Smart Dashes", "toggleAutomaticDashSubstitution:"),
                    sys("edit.substitutions.links", "Smart Links", "toggleAutomaticLinkDetection:"),
                    sys("edit.substitutions.text", "Text Replacement", "toggleAutomaticTextReplacement:"),
                ]),
                .submenu(id: "edit.transformations", title: "Transformations", nodes: [
                    sys("edit.transformations.upper", "Make Upper Case", "uppercaseWord:"),
                    sys("edit.transformations.lower", "Make Lower Case", "lowercaseWord:"),
                    sys("edit.transformations.capitalize", "Capitalize", "capitalizeWord:"),
                ]),
                .submenu(id: "edit.speech", title: "Speech", nodes: [
                    sys("edit.speech.start", "Start Speaking", "startSpeaking:"),
                    sys("edit.speech.stop", "Stop Speaking", "stopSpeaking:"),
                ]),
            ]),
            MenuSpec(id: "format", title: "Format", nodes: [
                page("format.bold", "Bold", k("b"), window: true),
                page("format.italic", "Italic", k("i"), window: true),
                page("format.underline", "Underline", k("u"), window: true),
                page("format.strikethrough", "Strikethrough", k("x", [.cmd, .shift]), window: true),
                page("format.code", "Inline Code", k("e"), window: true),
                page("format.highlight", "Highlight", k("h", [.cmd, .shift]), window: true),
                page("format.link", "Link…", k("k", [.cmd, .opt]), window: true),
                .separator,
                page("format.heading-1", "Heading 1", k("1", [.cmd, .opt]), window: true),
                page("format.heading-2", "Heading 2", k("2", [.cmd, .opt]), window: true),
                page("format.heading-3", "Heading 3", k("3", [.cmd, .opt]), window: true),
                page("format.body", "Body Text", k("0", [.cmd, .opt]), window: true),
                page("format.bulleted-list", "Bulleted List", k("8", [.cmd, .shift]), window: true),
                page("format.numbered-list", "Numbered List", k("7", [.cmd, .shift]), window: true),
                page("format.checklist", "Checklist", k("9", [.cmd, .shift]), window: true),
                .separator,
                // Tab and ⇧Tab stay the editor's and the fields' own (a menu key would take them everywhere).
                page("format.indent", "Indent", window: true),
                page("format.outdent", "Outdent", window: true),
                page("format.move-up", "Move Block Up", k(MenuKey.up, [.opt, .shift]), window: true),
                page("format.move-down", "Move Block Down", k(MenuKey.down, [.opt, .shift]), window: true),
                page("format.duplicate", "Duplicate Block", k("d"), window: true),
                .separator,
                page("format.style", "Style…", window: true),
            ]),
            MenuSpec(id: "note", title: "Note", nodes: [
                page("note.star", "Star", window: true),
                page("note.archive", "Archive", window: true),
                page("note.move", "Move to…", k("m", [.cmd, .shift]), window: true),
                page("note.duplicate", "Duplicate", window: true),
                page("note.copy-link", "Copy Link", k("c", [.cmd, .ctrl]), window: true),
                page("note.history", "Version History…", window: true),
                page("note.lock", "Lock", window: true),
                .separator,
                page("note.trash", "Move to Trash", k(MenuKey.backspace), window: true),
            ]),
            MenuSpec(id: "view", title: "View", nodes: [
                page("view.sidebar", "Hide Sidebar", k("\\"), window: true),
                alt("view.sidebar", k("s", [.cmd, .ctrl]), .page("view.sidebar"), window: true),
                page("view.inspector", "Show Inspector", k("i", [.cmd, .opt]), window: true),
                page("view.focus", "Focus Mode", k("\\", [.cmd, .shift]), window: true),
                .separator,
                // ⌘1 and ⌘2 are the tabs'; in a note list the page takes them for the view first.
                page("view.cards", "As Cards", window: true),
                page("view.list", "As List", window: true),
                .separator,
                // The page's theme (Settings > Appearance), checked as the page says.
                .submenu(id: "view.appearance", title: "Appearance", nodes: [
                    page("view.appearance-light", "Light"),
                    page("view.appearance-dark", "Dark"),
                    page("view.appearance-system", "Match System"),
                ]),
                .separator,
                app("view.actual-size", "Actual Size", k("0")),
                app("view.zoom-in", "Zoom In", k("+")),
                alt("view.zoom-in", k("="), .app("view.zoom-in")),
                app("view.zoom-out", "Zoom Out", k("-")),
                .separator,
                sys("view.full-screen", "Enter Full Screen", "toggleFullScreen:", k("f", [.cmd, .ctrl])),
            ]),
            MenuSpec(id: "go", title: "Go", nodes: [
                page("go.back", "Back", k("[")),
                page("go.forward", "Forward", k("]")),
                .separator,
                // No shortcut: ⇧⌘H is Highlight.
                page("go.home", "Home"),
                page("go.today", "Today’s Tasks", k("t", [.cmd, .opt])),
                page("go.calendar", "Calendar", k("c", [.cmd, .opt])),
                page("go.inbox", "Inbox"),
                // ⌘K is Open Quickly (the same palette).
                page("go.search", "Search…"),
                page("go.ask-ai", "Ask Foli AI", k("j")),
                .separator,
                page("go.next-tab", "Next Tab", k(MenuKey.tab, .ctrl), window: true),
                alt("go.next-tab", k("]", [.cmd, .shift]), .page("go.next-tab"), window: true),
                page("go.previous-tab", "Previous Tab", k(MenuKey.tab, [.ctrl, .shift]), window: true),
                alt("go.previous-tab", k("[", [.cmd, .shift]), .page("go.previous-tab"), window: true),
                .submenu(id: "go.tab", title: "Go to Tab", nodes: (1...9).map { n in page("go.tab-\(n)", "Tab \(n)", k("\(n)"), window: true) }),
            ]),
            MenuSpec(id: "window", title: "Window", nodes: [
                sys("window.minimize", "Minimize", "performMiniaturize:", k("m")),
                sys("window.zoom", "Zoom", "performZoom:"),
                .separator,
                sys("window.front", "Bring All to Front", "arrangeInFront:"),
            ]),
            MenuSpec(id: "help", title: "Help", nodes: [
                page("help.help", "Folevi Help"),
                page("help.shortcuts", "Keyboard Shortcuts", k("/")),
                page("help.whats-new", "What’s New"),
                page("help.feedback", "Send Feedback…"),
            ]),
        ]
        if debug {
            all.append(MenuSpec(id: "debug", title: "Debug", nodes: [
                app("debug.reload", "Reload Page", k("r", [.cmd, .opt])),
                app("debug.reload-all", "Reload All Windows", k("r", [.cmd, .opt, .shift])),
                .separator,
                app("debug.support-folder", "Show Support Folder in Finder"),
            ]))
        }
        return all
    }

    /// Every item in a list of nodes, submenus included.
    static func items(_ nodes: [MenuNode]) -> [MenuItemSpec] {
        nodes.flatMap { node -> [MenuItemSpec] in
            switch node {
            case .item(let i): return [i]
            case .submenu(_, _, let inner): return items(inner)
            default: return []
            }
        }
    }

    static func allItems(debug: Bool) -> [MenuItemSpec] { menus(debug: debug).flatMap { items($0.nodes) } }

    /// The page commands (what DesktopBridge.tsx must know).
    static func pageCommands(debug: Bool = false) -> [String] {
        allItems(debug: debug).compactMap { if case .page(let id) = $0.action, !$0.alternate { return id } else { return nil } }
    }
}
