// The iPad's menu bar (iPadOS 26, and the ⌘ overlay before it): the Mac's menus (the AppKit Mac app's MenuModel.swift (tag archive/mac-appkit))
// with the same ids, titles and shortcuts, for what the iPad has. Mac-only items are left out: Quick Add from Any
// App, New Window and Close Window (one window, see docs/IOS.md), Services, Share, Hide and Quit, Check for Updates,
// Float Note, Minimize and Zoom, Enter Full Screen, As Cards and As List, the Debug menu. Edit keeps iPadOS's own
// Undo, Redo, Cut, Copy, Paste and Select All, which go to what has the keyboard (the note page's web view too).
//
// Every item is a command with one action (AppDelegate.foleviMenu(_:)) and its id as the property list, so it's
// found at the end of the responder chain whatever has the keyboard. What it does is the Mac's FrameCommands, on the
// desk (the iPad's wide layout) or, for the few that the phone's layout has, on the phone's frame.
//
// The note page answers many of the same keys itself (⌘B, ⌥⌘1, ⇧⌘8, ⌘D, ⌥⇧↑, ⌘F, ⌘⌫ in its text). Pressed while the
// page has the keyboard, such a key is the page's: the item says it can't run then (pressed as its key only), so
// iPadOS hands the key on to the web view and the page does what it does for it there (in the note's text, its
// title, a table cell, a caption) exactly as before the menu bar. Chosen from the menu bar it runs here.
import GameController
import UIKit
import FoleviEngine
import FoleviMac
import FoleviScreens

// MARK: the menus as data

/// A shortcut, spelled as the Mac's MenuKey spells it ("\u{8}" for ⌫, the arrow function keys).
struct IPadMenuKey: Equatable {
    var key: String
    var mods: UIKeyModifierFlags

    static let backspace = "\u{8}"
    static let tab = "\t"
    static let up = String(UnicodeScalar(0xF700)!)
    static let down = String(UnicodeScalar(0xF701)!)

    /// As the Mac writes it (⌥⇧⌘N), for the tests.
    var label: String {
        var s = ""
        if mods.contains(.control) { s += "⌃" }
        if mods.contains(.alternate) { s += "⌥" }
        if mods.contains(.shift) { s += "⇧" }
        if mods.contains(.command) { s += "⌘" }
        switch key {
        case Self.backspace: s += "⌫"
        case Self.tab: s += "⇥"
        case Self.up: s += "↑"
        case Self.down: s += "↓"
        default: s += key.uppercased()
        }
        return s
    }

    /// UIKeyCommand's input for it.
    var input: String {
        switch key {
        case Self.backspace: return UIKeyCommand.inputDelete
        case Self.up: return UIKeyCommand.inputUpArrow
        case Self.down: return UIKeyCommand.inputDownArrow
        default: return key
        }
    }
}

struct IPadMenuItem {
    var id: String
    var title: String
    var key: IPadMenuKey?
    /// A second shortcut for another item (⌃⌘S beside ⌘\): hidden, its key still works.
    var alternate = false
}

indirect enum IPadMenuNode {
    case item(IPadMenuItem)
    /// Items shown together between separators.
    case group([IPadMenuNode])
    case submenu(id: String, title: String, nodes: [IPadMenuNode])
}

struct IPadMenuSpec {
    var id: String
    var title: String
    var nodes: [IPadMenuNode]
}

enum IPadMenuModel {
    private static func k(_ key: String, _ mods: UIKeyModifierFlags = .command) -> IPadMenuKey { IPadMenuKey(key: key, mods: mods) }
    private static func i(_ id: String, _ title: String, _ key: IPadMenuKey? = nil) -> IPadMenuNode { .item(IPadMenuItem(id: id, title: title, key: key)) }
    private static func alt(_ of: String, _ key: IPadMenuKey) -> IPadMenuNode { .item(IPadMenuItem(id: "\(of).alt", title: "", key: key, alternate: true)) }

    /// The application menu's Settings item (iPadOS puts it in the app's menu, as the Mac does).
    static let settings = IPadMenuItem(id: "app.settings", title: "Settings…", key: k(","))

    /// File, Edit (Find and Search All Notes, beside iPadOS's own items), Format, Note, View, Go and Help.
    static let menus: [IPadMenuSpec] = [
        IPadMenuSpec(id: "file", title: "File", nodes: [
            .group([
                i("file.new-note", "New Note", k("n")),
                i("file.new-from-template", "New Note from Template…", k("n", [.command, .alternate, .shift])),
                i("file.new-folder", "New Folder", k("n", [.command, .control])),
                i("file.quick-add-task", "Quick Add Task…", k("a", [.command, .shift])),
            ]),
            .group([
                i("file.new-tab", "New Tab", k("t")),
                i("file.open-quickly", "Open Quickly…", k("k")),
            ]),
            .group([
                i("file.close-tab", "Close Tab", k("w")),
                i("file.reopen-closed-tab", "Reopen Closed Tab", k("t", [.command, .shift])),
                i("file.tab-overview", "Show All Tabs", k("\\", [.command, .shift])),
            ]),
            .group([
                i("file.import", "Import…"),
                i("file.export", "Export…", k("e", [.command, .shift])),
            ]),
            .group([
                i("file.print", "Print…", k("p")),
            ]),
        ]),
        IPadMenuSpec(id: "edit", title: "Edit", nodes: [
            .group([
                .submenu(id: "edit.find", title: "Find", nodes: [
                    i("edit.find", "Find…", k("f")),
                    i("edit.find-next", "Find Next", k("g")),
                    i("edit.find-previous", "Find Previous", k("g", [.command, .shift])),
                    // No shortcut: ⌘E is inline code.
                    i("edit.find-selection", "Use Selection for Find"),
                ]),
                i("edit.search-all", "Search All Notes", k("f", [.command, .shift])),
            ]),
        ]),
        IPadMenuSpec(id: "format", title: "Format", nodes: [
            .group([
                i("format.bold", "Bold", k("b")),
                i("format.italic", "Italic", k("i")),
                i("format.underline", "Underline", k("u")),
                i("format.strikethrough", "Strikethrough", k("x", [.command, .shift])),
                i("format.code", "Inline Code", k("e")),
                i("format.highlight", "Highlight", k("h", [.command, .shift])),
                i("format.link", "Link…", k("k", [.command, .alternate])),
            ]),
            .group([
                i("format.heading-1", "Heading 1", k("1", [.command, .alternate])),
                i("format.heading-2", "Heading 2", k("2", [.command, .alternate])),
                i("format.heading-3", "Heading 3", k("3", [.command, .alternate])),
                i("format.body", "Body Text", k("0", [.command, .alternate])),
                i("format.bulleted-list", "Bulleted List", k("8", [.command, .shift])),
                i("format.numbered-list", "Numbered List", k("7", [.command, .shift])),
                i("format.checklist", "Checklist", k("9", [.command, .shift])),
            ]),
            .group([
                // Tab and ⇧Tab stay the editor's and the fields' own (a menu key would take them everywhere).
                i("format.indent", "Indent"),
                i("format.outdent", "Outdent"),
                i("format.move-up", "Move Block Up", k(IPadMenuKey.up, [.alternate, .shift])),
                i("format.move-down", "Move Block Down", k(IPadMenuKey.down, [.alternate, .shift])),
                i("format.duplicate", "Duplicate Block", k("d")),
            ]),
            .group([
                i("format.style", "Style…"),
            ]),
        ]),
        IPadMenuSpec(id: "note", title: "Note", nodes: [
            .group([
                i("note.star", "Bookmark"),
                i("note.archive", "Archive"),
                i("note.move", "Move to…", k("m", [.command, .shift])),
                i("note.duplicate", "Duplicate"),
                i("note.copy-link", "Copy Link", k("c", [.command, .control])),
                i("note.history", "Version History…"),
                i("note.lock", "Lock"),
            ]),
            .group([
                i("note.trash", "Move to Trash", k(IPadMenuKey.backspace)),
            ]),
        ]),
        IPadMenuSpec(id: "view", title: "View", nodes: [
            .group([
                i("view.sidebar", "Hide Sidebar", k("\\")),
                alt("view.sidebar", k("s", [.command, .control])),
                i("view.inspector", "Show Inspector", k("i", [.command, .alternate])),
                // ⇧⌘\ is Show All Tabs (the web's and Safari's), so Focus Mode is ⌥⌘\.
                i("view.focus", "Focus Mode", k("\\", [.command, .alternate])),
            ]),
            .group([
                .submenu(id: "view.appearance", title: "Appearance", nodes: [
                    i("view.appearance-light", "Light"),
                    i("view.appearance-dark", "Dark"),
                    i("view.appearance-system", "Match System"),
                ]),
            ]),
            .group([
                i("view.actual-size", "Actual Size", k("0")),
                i("view.zoom-in", "Zoom In", k("+")),
                alt("view.zoom-in", k("=")),
                i("view.zoom-out", "Zoom Out", k("-")),
            ]),
        ]),
        IPadMenuSpec(id: "go", title: "Go", nodes: [
            .group([
                i("go.back", "Back", k("[")),
                i("go.forward", "Forward", k("]")),
            ]),
            .group([
                // No shortcut: ⇧⌘H is Highlight.
                i("go.home", "Home"),
                i("go.today", "Today’s Tasks", k("t", [.command, .alternate])),
                i("go.calendar", "Calendar", k("c", [.command, .alternate])),
                i("go.inbox", "Inbox"),
                i("go.dna", "Foli DNA"),
                // ⌘K is Open Quickly (the same palette).
                i("go.search", "Search…"),
                i("go.ask-ai", "Ask Foli AI", k("j")),
            ]),
            .group([
                i("go.next-tab", "Next Tab", k(IPadMenuKey.tab, .control)),
                alt("go.next-tab", k("]", [.command, .shift])),
                i("go.previous-tab", "Previous Tab", k(IPadMenuKey.tab, [.control, .shift])),
                alt("go.previous-tab", k("[", [.command, .shift])),
                .submenu(id: "go.tab", title: "Go to Tab", nodes: (1...9).map { n in i("go.tab-\(n)", "Tab \(n)", k("\(n)")) }),
            ]),
        ]),
        IPadMenuSpec(id: "help", title: "Help", nodes: [
            .group([
                i("help.help", "Folevi Help"),
                i("help.shortcuts", "Keyboard Shortcuts", k("/")),
                i("help.whats-new", "What’s New"),
                i("help.feedback", "Send Feedback…"),
            ]),
        ]),
    ]

    /// Every item in some nodes, submenus included.
    static func items(_ nodes: [IPadMenuNode]) -> [IPadMenuItem] {
        nodes.flatMap { node -> [IPadMenuItem] in
            switch node {
            case .item(let i): return [i]
            case .group(let inner): return items(inner)
            case .submenu(_, _, let inner): return items(inner)
            }
        }
    }

    /// Every item of the menu bar, Settings first.
    static var allItems: [IPadMenuItem] { [settings] + menus.flatMap { items($0.nodes) } }

    /// The commands whose key the note page answers itself while it has the keyboard (its editor's keymap, its
    /// ⌘F, and ⌘⌫ in its text): pressed then, the key goes on to the page.
    static let pageKeys: Set<String> = [
        "format.bold", "format.italic", "format.underline", "format.strikethrough", "format.code", "format.highlight",
        "format.heading-1", "format.heading-2", "format.heading-3", "format.body",
        "format.bulleted-list", "format.numbered-list", "format.checklist",
        "format.move-up", "format.move-down", "format.duplicate",
        "edit.find", "note.trash",
    ]
}

// MARK: the menu bar

@MainActor
enum IPadMenuBar {
    /// The menus' own identifiers (Format, Note and Go are Folevi's; the rest are iPadOS's).
    static let formatMenu = UIMenu.Identifier("com.folevi.menu.format")
    static let noteMenu = UIMenu.Identifier("com.folevi.menu.note")
    static let goMenu = UIMenu.Identifier("com.folevi.menu.go")
    static let findMenu = UIMenu.Identifier("com.folevi.menu.edit.find")

    /// Only the iPad (and only the new frame, whose desk the items run on): the iPhone keeps its key commands.
    static var installed: Bool { UIDevice.current.userInterfaceIdiom == .pad && RebuildFrame.enabled }

    /// iPadOS 26: the main menu built from Folevi's menus, without iPadOS's items Folevi replaces (its Find, text
    /// formatting, sidebar and inspector items, New Window, printing and documents).
    static func configure() {
        guard installed else { return }
        if #available(iOS 26.0, *) {
            var config = UIMainMenuSystem.Configuration()
            config.newScenePreference = .removed
            config.documentPreference = .removed
            config.printingPreference = .removed
            config.findingPreference = .removed
            config.toolbarPreference = .removed
            config.sidebarPreference = .removed
            config.inspectorPreference = .removed
            config.textFormattingPreference = .removed
            UIMainMenuSystem.shared.setBuildConfiguration(config) { builder in
                MainActor.assumeIsolated { build(builder) }
            }
        }
    }

    /// Puts Folevi's menus into iPadOS's main menu.
    static func build(_ builder: UIMenuBuilder) {
        guard installed else { return }
        // Before iPadOS 26 the system's own Find and Format items are there: they go first.
        for id: UIMenu.Identifier in [.find, .format, .font, .textStyle] where builder.menu(for: id) != nil {
            builder.remove(menu: id)
        }
        if builder.menu(for: .preferences) != nil {
            builder.replaceChildren(ofMenu: .preferences) { _ in [command(IPadMenuModel.settings)] }
        } else if builder.menu(for: .application) != nil {
            builder.insertChild(UIMenu(options: .displayInline, children: [command(IPadMenuModel.settings)]), atStartOfMenu: .application)
        }
        for spec in IPadMenuModel.menus {
            let children = spec.nodes.map(element)
            switch spec.id {
            case "file": builder.replaceChildren(ofMenu: .file) { _ in children }
            case "edit":
                let ours = UIMenu(options: .displayInline, children: children)
                if builder.menu(for: .standardEdit) != nil {
                    builder.insertSibling(ours, afterMenu: .standardEdit)
                } else {
                    builder.insertChild(ours, atEndOfMenu: .edit)
                }
            case "view": builder.replaceChildren(ofMenu: .view) { _ in children }
            case "help": builder.replaceChildren(ofMenu: .help) { _ in children }
            default:
                let id: UIMenu.Identifier = spec.id == "format" ? formatMenu : spec.id == "note" ? noteMenu : goMenu
                let after: UIMenu.Identifier = spec.id == "format" ? .edit : spec.id == "note" ? formatMenu : .view
                builder.insertSibling(UIMenu(title: spec.title, identifier: id, children: children), afterMenu: after)
            }
        }
    }

    private static func element(_ node: IPadMenuNode) -> UIMenuElement {
        switch node {
        case .item(let item): return command(item)
        case .group(let nodes): return UIMenu(options: .displayInline, children: nodes.map(element))
        case .submenu(let id, let title, let nodes):
            return UIMenu(title: title, identifier: id == "edit.find" ? findMenu : UIMenu.Identifier("com.folevi.menu.\(id)"), children: nodes.map(element))
        }
    }

    private static func command(_ item: IPadMenuItem) -> UIMenuElement {
        let action = #selector(AppDelegate.foleviMenu(_:))
        guard let key = item.key else {
            return UICommand(title: item.title, action: action, propertyList: item.id)
        }
        let command = UIKeyCommand(title: item.title, action: action, input: key.input, modifierFlags: key.mods, propertyList: item.id)
        if item.alternate { command.attributes = .hidden }
        command.discoverabilityTitle = item.alternate ? nil : item.title
        // The app's own commands come before what the keyboard would do in a field; the page's keys (and ⌫ and the
        // arrows) leave the text's own behaviour first.
        command.wantsPriorityOverSystemBehavior = !IPadMenuModel.pageKeys.contains(item.id) && key.key != IPadMenuKey.up && key.key != IPadMenuKey.down
        return command
    }

    /// The id an item of the menu bar carries (an alternate's is its item's).
    static func id(of sender: Any?) -> String? {
        guard let id = (sender as? UICommand)?.propertyList as? String else { return nil }
        return id.hasSuffix(".alt") ? String(id.dropLast(4)) : id
    }

    // MARK: running them

    /// The window's frame, with the engine up and past the screens before the app.
    private static var readyFrame: RebuildFrameController? {
        guard let f = RebuildFrameController.current, f.model.client.state == .ready else { return nil }
        if let g = f.model.gate?.gate, g != "loading" { return nil }
        return f
    }

    /// Items the phone's layout (a window under 700 pt) runs too; the rest need the desk.
    static let narrowItems: Set<String> = [
        "app.settings", "file.new-note", "file.quick-add-task", "file.open-quickly", "edit.search-all", "go.search",
        "go.back", "go.home", "go.today", "go.calendar", "go.inbox", "go.ask-ai",
        "help.help", "help.shortcuts", "help.whats-new", "help.feedback",
    ]

    static func isEnabled(_ id: String, sender: Any?) -> Bool {
        guard let f = readyFrame else { return false }
        if !f.wide { return narrowItems.contains(id) }
        let m = f.desk
        let noteOpen = m.route.isNote
        // A key the note page answers itself, pressed while the page has the keyboard: the page's, not the menu's.
        // A Format key pressed in one of the app's own fields does nothing (as on the Mac); ⌘⌫ in one deletes there.
        if IPadMenuModel.pageKeys.contains(id), let command = sender as? UIKeyCommand, pressedNow(command) {
            if f.pageHasKeyboard { return false }
            if id.hasPrefix("format.") { return false }
            if id == "note.trash", FirstResponder.current is UITextInput { return false }
        }
        if id == "note.lock" { return noteOpen && m.canLockNote }
        if ["edit.find-next", "edit.find-previous", "edit.find-selection"].contains(id) { return noteOpen }
        if id.hasPrefix("format.") || id.hasPrefix("note.") || id == "file.export" || id == "file.print" || id == "view.inspector" || id == "view.focus" { return noteOpen }
        switch id {
        case "go.back": return m.history.canGoBack
        case "go.forward": return m.history.canGoForward
        case "file.reopen-closed-tab": return !m.tabs.closed.isEmpty
        case "go.ask-ai": return m.session.value?.capabilities.ai != false
        case "go.dna": return m.session.value?.capabilities.graph != false
        case "view.zoom-in": return PageZoom.canStep(+1, f.model.client)
        case "view.zoom-out": return PageZoom.canStep(-1, f.model.client)
        default: return true
        }
    }

    /// Titles, checks and Foli AI hidden while AI is off, as the Mac's menus show them.
    static func validate(_ command: UICommand) {
        guard let raw = command.propertyList as? String, let id = id(of: command) else { return }
        let m = RebuildFrameController.current?.desk
        switch id {
        case "view.sidebar":
            if !raw.hasSuffix(".alt") { command.title = m?.sidebarCollapsed == true ? "Show Sidebar" : "Hide Sidebar" }
        case "view.inspector": command.title = m?.editorPanel == .info ? "Hide Inspector" : "Show Inspector"
        case "view.focus": command.state = m?.focusMode == true ? .on : .off
        case "note.lock": command.title = m?.noteLocked == true ? "Unlock" : "Lock"
        case "view.appearance-light", "view.appearance-dark", "view.appearance-system":
            let now = m?.session.value?.appearance
            let mine: Bool = switch id {
            case "view.appearance-light": now == .light
            case "view.appearance-dark": now == .dark
            default: now == .system
            }
            command.state = mine ? .on : .off
        case "go.ask-ai":
            if m?.session.value?.capabilities.ai == false { command.attributes.insert(.hidden) } else { command.attributes.remove(.hidden) }
        default: break
        }
    }

    static func perform(_ id: String) {
        guard let f = readyFrame, isEnabled(id, sender: nil) else { return }
        if !f.wide { return performNarrow(id, f) }
        let m = f.desk
        let noteOpen = m.route.isNote
        func block(_ b: EditorBlock) { m.editor(.format(block: b)) }
        switch id {
        case "app.settings": m.open(FrameRoute(path: "/settings"))
        case "file.new-note": m.newNote()
        // The Templates page: its built-in gallery and the person's own, each a click from a new note.
        case "file.new-from-template": m.open(.notes(.templates))
        case "file.new-folder": m.newFolder()
        case "file.quick-add-task": f.model.quickAddShown = true
        // Home in front, the palette open to find what goes in it (the Mac focuses its sidebar's search).
        case "file.new-tab":
            m.open(.home)
            CommandPalette.show(m)
        case "file.open-quickly", "go.search": CommandPalette.show(m)
        case "edit.search-all": m.open(FrameRoute(path: "/search"))
        case "file.close-tab": m.closeTab()
        case "file.reopen-closed-tab": m.reopenClosedTab()
        case "file.tab-overview": m.overviewShown.toggle()
        // Settings' Import & Export for the space open here (the Mac's SettingsWindow.importSection).
        case "file.import": m.open(FrameRoute(path: "/settings/\(importSection(m.session.value))"))
        case "file.export": m.noteMenu(.export)
        case "file.print": printNote(f)
        case "edit.find", "edit.find-selection":
            if noteOpen { m.noteMenu(.find) } else { CommandPalette.show(m) }
        case "edit.find-next", "edit.find-previous": stepFind(id == "edit.find-next" ? 1 : -1, f)
        case "note.star": if let n = m.route.noteId { m.star([n], !(m.noteMeta[n]?.starred ?? false)) }
        case "note.archive": if let n = m.route.noteId { m.archive([n], !(m.noteMeta[n]?.archived ?? false)) }
        case "note.move": m.noteMenu(.move)
        case "note.duplicate": m.noteMenu(.duplicate)
        case "note.history": m.noteMenu(.history)
        case "note.trash": if let n = m.route.noteId { m.trash([n]) }
        case "note.lock": m.editor(.noteLock)
        case "note.copy-link":
            if let n = m.route.noteId {
                UIPasteboard.general.string = "https://app.folevi.com/d/\(n)"
                m.toast("Link copied")
            }
        case "format.bold": m.editor(.format(mark: .bold))
        case "format.italic": m.editor(.format(mark: .italic))
        case "format.underline": m.editor(.format(mark: .underline))
        case "format.strikethrough": m.editor(.format(mark: .strike))
        case "format.code": m.editor(.format(mark: .code))
        case "format.highlight": m.editor(.format(mark: .highlight))
        // The selection's link field, as the page's own ⇧⌘K and its right-click menu open it.
        case "format.link": f.runInPage(#"const e = document.activeElement?.closest?.(".fb-editor") ?? document.querySelector(".fb-editor"); e?.dispatchEvent(new CustomEvent("folevi:edit-link")); return Boolean(e);"#)
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
        case "view.sidebar": m.toggleSidebar()
        case "view.inspector": if m.editorPanel == .info { m.editor(.panelClose) } else { m.editor(.panelOpen(panel: .info)) }
        case "view.focus": m.editor(.focusToggle)
        case "view.appearance-light": m.setAppearance(.light)
        case "view.appearance-dark": m.setAppearance(.dark)
        case "view.appearance-system": m.setAppearance(.system)
        case "view.actual-size": PageZoom.set(1, f)
        case "view.zoom-in": PageZoom.step(+1, f)
        case "view.zoom-out": PageZoom.step(-1, f)
        case "go.back": m.goBack()
        case "go.forward": m.goForward()
        case "go.home": m.open(.home)
        case "go.today": m.open(.tasks(.today))
        case "go.inbox": m.open(.tasks(.inbox))
        case "go.calendar": m.open(.calendar(nil))
        case "go.dna": m.open(.web("/graph"))
        case "go.ask-ai": m.askAI()
        case "go.next-tab": m.nextTab(1)
        case "go.previous-tab": m.nextTab(-1)
        case "help.help": f.frameOpenHelp()
        case "help.shortcuts": m.openHelpShortcuts()
        case "help.whats-new", "help.feedback": performHelpLink(id, f)
        default:
            if id.hasPrefix("go.tab-"), let n = Int(id.dropFirst("go.tab-".count)) { m.selectTab(number: n) }
        }
    }

    /// The phone's layout (a narrow window): its own frame, as its key commands did.
    private static func performNarrow(_ id: String, _ f: RebuildFrameController) {
        func go(_ path: String) { if let url = DeepLink.fromPath(path) { f.openLink(url) } }
        switch id {
        case "app.settings": go("/settings")
        case "file.new-note": f.model.newNote()
        case "file.quick-add-task": f.model.quickAddShown = true
        case "file.open-quickly", "edit.search-all", "go.search":
            // What's typed before the search field has the focus waits for it, out of the note (F04).
            EarlyKeys.start(in: f.view.window)
            f.frame.open(FrameRoute(path: "/search"))
        case "go.back": f.frame.back()
        case "go.home": go("/documents")
        case "go.today": f.openLink(DeepLink.todayURL)
        case "go.calendar": go("/calendar")
        case "go.inbox": go("/tasks/inbox")
        case "go.ask-ai": RebuildFrame.ai.ask()
        case "help.help", "help.shortcuts": go("/help")
        case "help.whats-new", "help.feedback": performHelpLink(id, f)
        default: break
        }
    }

    /// As the Mac's menu bar opens them: the changelog in the browser, a message to support in Mail.
    private static func performHelpLink(_ id: String, _ f: RebuildFrameController) {
        let link = id == "help.whats-new" ? "https://folevi.com/changelog" : "mailto:support@folevi.com?subject=Folevi%20for%20iPad"
        if let url = URL(string: link) { f.openExternal(url) }
    }

    /// File > Import's section: Import & Export for the space open here (the Mac's SettingsWindow.importSection).
    static func importSection(_ session: SessionValue?) -> String {
        guard let s = session, s.spaces.first(where: { $0.id == s.space })?.kind == .workspace else { return "data" }
        return "workspace-data"
    }

    /// Find Next and Find Previous: through the note's find bar while it's open (its own Next and Previous match
    /// buttons), else Find opens it (the page's runNoteMenuCommand, which the iPad's page can't be sent).
    private static func stepFind(_ by: Int, _ f: RebuildFrameController) {
        let label = by > 0 ? "Next match" : "Previous match"
        let script = """
        const bar = document.querySelector('[aria-label="Find in note"]');
        const b = bar && [...bar.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "\(label)");
        if (!bar) return "none";
        if (b && !b.disabled) b.click();
        return "bar";
        """
        f.pageHost.pageView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak f] result in
            if case .success(let v) = result, v as? String == "bar" { return }
            f?.desk.noteMenu(.find)
        }
    }

    /// File > Print…: the note's page through iOS's print sheet (its print styles, as the Mac's printPage).
    private static func printNote(_ f: RebuildFrameController) {
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = f.desk.route.noteId.flatMap { f.desk.noteMeta[$0]?.title }.flatMap { $0.isEmpty ? nil : $0 } ?? "Folevi"
        controller.printInfo = info
        controller.printFormatter = f.pageHost.pageView.viewPrintFormatter()
        let anchor = CGRect(x: f.view.bounds.maxX - 60, y: 40, width: 1, height: 1)
        controller.present(from: anchor, in: f.view, animated: true)
    }

    // MARK: which key is down

    /// Whether `command`'s key is held down now (it's being pressed, not chosen in the menu bar or shown in the
    /// ⌘ overlay, where only ⌘ is held). GameController's view of the hardware keyboard; false without one.
    static func pressedNow(_ command: UIKeyCommand) -> Bool {
        guard let keyboard = GCKeyboard.coalesced?.keyboardInput, let input = command.input, let code = keyCode(input) else { return false }
        return keyboard.button(forKeyCode: code)?.isPressed == true
    }

    /// GameController's key code for the inputs of the page's keys.
    static func keyCode(_ input: String) -> GCKeyCode? {
        switch input {
        case UIKeyCommand.inputDelete: return .deleteOrBackspace
        case UIKeyCommand.inputUpArrow: return .upArrow
        case UIKeyCommand.inputDownArrow: return .downArrow
        case "0": return .zero
        case "1": return .one
        case "2": return .two
        case "3": return .three
        case "7": return .seven
        case "8": return .eight
        case "9": return .nine
        default:
            let letters: [Character: GCKeyCode] = [
                "b": .keyB, "d": .keyD, "e": .keyE, "f": .keyF, "h": .keyH, "i": .keyI, "u": .keyU, "x": .keyX,
            ]
            return input.count == 1 ? letters[Character(input.lowercased())] : nil
        }
    }
}

// MARK: View > Zoom

/// ⌘+ / ⌘- / ⌘0: the note's text size on this device, a step at a time through the page's own sizes (Settings >
/// Appearance's editor text size, `settings.update { editorZoom }`, which lays the note out again at the size). The
/// Mac zooms its whole page; WKWebView's pageZoom on iOS scales the page without a new layout, so a zoomed note ran
/// off the card's right edge.
@MainActor
enum PageZoom {
    /// The page's sizes (lib/editorZoom.ts EDITOR_ZOOMS) until the engine says.
    static let fallbackLevels: [Double] = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35]
    private static var store: ValueStore<AppearanceSettings>?
    private static weak var storeClient: EngineClient?

    /// This device's text size and the sizes offered (`settings.appearance`, watched from the first ask).
    private static func settings(_ client: EngineClient) -> AppearanceSettings? {
        if store == nil || storeClient !== client {
            store = client.watch(.settingsAppearance)
            storeClient = client
        }
        return store?.value
    }

    static func levels(_ client: EngineClient) -> [Double] {
        let offered = settings(client)?.editorZooms ?? []
        return offered.isEmpty ? fallbackLevels : offered.sorted()
    }

    static func level(_ client: EngineClient) -> Double { settings(client)?.editorZoom ?? 1 }

    /// A step either way is left (Zoom In and Zoom Out are off at the ends, as on the Mac).
    static func canStep(_ by: Int, _ client: EngineClient) -> Bool {
        let all = levels(client)
        let now = level(client)
        return by > 0 ? (all.last ?? 1) > now + 0.001 : (all.first ?? 1) < now - 0.001
    }

    static func set(_ value: Double, _ f: RebuildFrameController) {
        let all = levels(f.model.client)
        let v = all.min { abs($0 - value) < abs($1 - value) } ?? 1
        let client = f.model.client
        f.desk.perform { _ = try await client.command(.settingsUpdate(editorZoom: v)) }
    }

    static func step(_ by: Int, _ f: RebuildFrameController) {
        let all = levels(f.model.client)
        let now = level(f.model.client)
        let i = all.firstIndex { $0 >= now - 0.001 } ?? all.firstIndex(of: 1) ?? 0
        set(all[max(0, min(all.count - 1, i + by))], f)
    }
}

// MARK: what has the keyboard

@MainActor
enum FirstResponder {
    private static weak var found: UIResponder?

    /// The app's first responder now (nil when nothing has the keyboard).
    static var current: UIResponder? {
        found = nil
        UIApplication.shared.sendAction(#selector(UIResponder.foleviFoundFirstResponder(_:)), to: nil, from: nil, for: nil)
        return found
    }

    fileprivate static func set(_ r: UIResponder) { found = r }
}

extension UIResponder {
    @objc fileprivate func foleviFoundFirstResponder(_ sender: Any?) {
        MainActor.assumeIsolated { FirstResponder.set(self) }
    }
}

extension RebuildFrameController {
    /// The note page's web view has the keyboard (its text, its title, or any field in it).
    var pageHasKeyboard: Bool {
        guard let view = FirstResponder.current as? UIView else { return false }
        return view.isDescendant(of: pageHost.pageView)
    }

    /// Runs a script in the note page (the main world, where the editor is).
    func runInPage(_ script: String) {
        pageHost.pageView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page, completionHandler: nil)
    }
}
