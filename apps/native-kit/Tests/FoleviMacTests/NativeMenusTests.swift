// The Mac's menus, popovers and sheets are the system's (owner decision 2026-11-18, docs/MAC_NATIVE_LOOK.md):
// Folevi's menu rows become an NSMenu with nothing lost (every row, in order, with its separators, headings,
// checkmarks, disabled and destructive states, subtitles, notes and key equivalents), the account menu too, and the
// palette, Quick Add, the sync popover, dialogs and toasts draw in the system's type and colours.
//
// FOLEVI_MENU_DUMP=<dir> writes each menu's rows before (the drawn panel's rows) and after (the NSMenu's items) as
// text; FOLEVI_MENU_SHOTS=<dir> writes pictures of the converted popover, palette, Quick Add and dialog content in
// light and dark, for a person to look at.
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
@testable import FoleviScreens

@Suite("Native menus, popovers and sheets", .serialized) @MainActor
struct NativeMenusTests {
    // MARK: rows to items

    @Test func keyEquivalentsParse() {
        #expect(NativeMenu.keyEquivalent("⌘K")?.key == "k")
        #expect(NativeMenu.keyEquivalent("⌘K")?.modifiers == [.command])
        #expect(NativeMenu.keyEquivalent("⌘⌥N")?.modifiers == [.command, .option])
        #expect(NativeMenu.keyEquivalent("⇧⌘D")?.modifiers == [.command, .shift])
        #expect(NativeMenu.keyEquivalent("\u{2318},")?.key == ",")
        #expect(NativeMenu.keyEquivalent("⌘\\")?.key == "\\")
        #expect(NativeMenu.keyEquivalent("⌘⌫")?.key == "\u{8}")
        // Nothing to press, or words: no key equivalent (the row keeps its title).
        #expect(NativeMenu.keyEquivalent("K") == nil)
        #expect(NativeMenu.keyEquivalent("Click") == nil)
        #expect(NativeMenu.keyEquivalent("") == nil)
    }

    @Test func everyKindOfRowBecomesASystemItem() {
        let menu = NativeMenu.build(Self.everyKind)
        let items = menu.items
        // No separator at either end, never two in a row (M02).
        #expect(items.first?.isSeparatorItem == false)
        #expect(items.last?.isSeparatorItem == false)
        #expect(!zip(items, items.dropFirst()).contains { $0.isSeparatorItem && $1.isSeparatorItem })
        let header = try? #require(items.first)
        #expect(header?.isSectionHeader == true)
        #expect(header?.title == "Sort by")
        func item(_ id: String) -> NSMenuItem? { items.first { $0.identifier?.rawValue == id } }
        #expect(item("updated")?.state == .on)
        #expect(item("created")?.state == .off)
        #expect(item("search")?.keyEquivalent == "k")
        #expect(item("search")?.keyEquivalentModifierMask == [.command])
        #expect(item("cut")?.isEnabled == false)
        #expect(item("delete")?.attributedTitle?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor == .systemRed)
        #expect(item("focus")?.subtitle == "Dim notes more than two steps away")
        #expect(item("plan")?.badge?.stringValue == "Pro")
        #expect(item("moss")?.image != nil)
        #expect(item("ai")?.image != nil)
        #expect(item("folder")?.image != nil)
        #expect(menu.autoenablesItems == false)
    }

    @Test func pickingAnItemRunsItsAction() {
        var ran = ""
        let menu = NativeMenu.build([WebMenuEntry(.item("Rename…", icon: .pencilLine)) { ran = "rename" }])
        let item = try? #require(menu.items.first)
        if let item, let action = item.action { _ = (item.target as? NSObject)?.perform(action, with: item) }
        #expect(ran == "rename")
    }

    @Test func aSelectOpensOnItsChosenOption() throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        let trigger = NSView(frame: NSRect(x: 20, y: 200, width: 220, height: 28))
        window.contentView?.addSubview(trigger)
        let m = try #require(WebMenuWindow.showSelect(["Any time", "Past week", "Past month"].map { WebMenuEntry(.item($0, checked: $0 == "Past week")) }, below: trigger))
        #expect(m.menu.minimumWidth == 220)
        #expect(m.menu.items.filter { $0.state == .on }.map(\.title) == ["Past week"])
        #expect(WebMenuWindow.isOpen(from: trigger))
        m.close()
        #expect(WebMenuWindow.shown == nil)
    }

    @Test func oneMenuAtATime() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        let a = WebMenuWindow.show([WebMenuEntry(.item("One"))], at: NSPoint(x: 10, y: 10), in: window)
        let b = WebMenuWindow.show([WebMenuEntry(.item("Two"))], at: NSPoint(x: 10, y: 10), in: window)
        #expect(WebMenuWindow.shown === b)
        #expect(a !== b)
        b.close()
        #expect(WebMenuWindow.shown == nil)
    }

    // MARK: nothing lost: before and after, every menu that can be built here

    @Test func nothingIsLostInTheConversion() async throws {
        let frame = FrameModel(client: DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000)).client())
        await eventually("session", timeout: .seconds(8)) { frame.session.value != nil && frame.folders.value != nil }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 600), styleMask: [.titled], backing: .buffered, defer: false)
        frame.open(.notes(.all), .replace)
        frame.open(.tasks(.today), .replace)

        var menus: [(String, [WebMenuEntry])] = [
            ("every-kind", Self.everyKind),
            ("anywhere", AppContextMenu.anywhereEntries(frame, window: window)),
            ("selection", selectionMenuEntries(BulkAction.allCases, run: { _ in }, clear: {})),
        ]
        let folder = MenuFolder(id: "fld_trips", name: "Trips", parentId: "fld_work", color: nil)
        let ctx = FolderMenuContext(canEdit: true, inviteSpace: "ws", aiOn: true, otherPlaces: true, links: [], canLock: true, sharing: true)
        menus.append(("folder", WebFolderMenu.entries(folder, context: ctx, frame: frame)))

        // A text field's menu (a misspelled word, selected): spelling, Look Up, edit commands, Share.
        let field = NSTextView(frame: NSRect(x: 20, y: 20, width: 300, height: 40))
        field.string = "Helo world"
        window.contentView?.addSubview(field)
        window.makeFirstResponder(field)
        field.setSelectedRange(NSRange(location: 0, length: 4))
        let p = field.convert(NSPoint(x: 8, y: 10), to: nil)
        if let event = NSEvent.mouseEvent(with: .rightMouseDown, location: p, modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1),
           let text = AppContextMenu.menu(for: event, in: window) {
            menus.append(("text-field", text.entries))
            // The Share row is the system's Share submenu there.
            #expect(text.menu.items.contains { $0.identifier?.rawValue == AppContextMenu.shareId && !($0 is MenuActionItem) })
            try dump("text-field", before: text.entries, after: NativeMenu.describe(text.menu))
        }

        for (name, entries) in menus {
            let native = NativeMenu.build(entries)
            // Every offered row is there, in order, with its state.
            let rows = entries.filter { $0.item.kind != .separator }
            let items = native.items.filter { !$0.isSeparatorItem }
            #expect(items.map(\.title) == rows.map(\.item.title), "\(name)")
            #expect(items.map(\.isEnabled) == rows.map { !($0.disabled || $0.item.disabled) || $0.item.kind == .heading }, "\(name)")
            #expect(items.map { $0.state == .on } == rows.map(\.item.checked), "\(name)")
            // Separators between groups stay (one at most between two rows).
            let groups = entries.split { $0.item.kind == .separator }.count
            #expect(native.items.filter(\.isSeparatorItem).count == max(0, groups - 1), "\(name)")
            if name != "text-field" { try dump(name, before: entries, after: NativeMenu.describe(native)) }
        }

        // The account menu: its rows (AccountMenuRows) and the system menu built from them.
        let rows = AccountMenuRows.build(model: frame)
        let account = AccountMenu.build(model: frame)
        let titled = rows.filter { $0.kind != .separator }
        #expect(account.items.filter { !$0.isSeparatorItem }.map(\.title) == titled.map(\.title))
        #expect(account.items.first { $0.identifier?.rawValue == "settings" }?.keyEquivalent == ",")
        try dumpAccount(rows, after: NativeMenu.describe(account))
        frame.stop()
    }

    // MARK: pictures

    static let shots = ProcessInfo.processInfo.environment["FOLEVI_MENU_SHOTS"]
    static let dumps = ProcessInfo.processInfo.environment["FOLEVI_MENU_DUMP"]

    @Test func pictures() async {
        guard Self.shots != nil else { return }
        let frame = FrameModel(client: DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000)).client())
        await eventually("session", timeout: .seconds(8)) { frame.session.value != nil && frame.sync.value != nil }
        // The sync popover (an NSPopover's content).
        await draw("popover-sync", size: CGSize(width: 280, height: 150), surface: .popover) { _ in SyncPopover(model: frame) }
        // A dialog with a destructive action, and one with the default button.
        await draw("sheet-delete-folder", size: CGSize(width: 384, height: 170), surface: .sheet) { _ in
            WebSheetDialog(title: "Delete \u{201C}Quarterly planning notes for the whole team and partners\u{201D}?", description: "The folder is removed. Its documents are kept and move to Drafts.", close: {}) {
                EmptyView()
            } footer: {
                WebSheetFooter {
                    WebSheetButton(title: "Cancel") {}
                    WebSheetButton(title: "Delete folder", danger: true) {}
                }
            }
        }
        await draw("sheet-rename", size: CGSize(width: 384, height: 190), surface: .sheet) { _ in
            WebSheetDialog(title: "Rename folder", close: {}) {
                TextField("Name", text: .constant("Trips")).textFieldStyle(.roundedBorder)
            } footer: {
                WebSheetFooter {
                    WebSheetButton(title: "Cancel") {}
                    WebSheetButton(title: "Rename", primary: true) {}
                }
            }
        }
        // The palette, before typing.
        let palette = PaletteModel(frame: frame)
        try? await Task.sleep(for: .seconds(1))
        await draw("sheet-palette", size: CGSize(width: MacCommandPaletteView.width, height: 420), surface: .sheet) { _ in
            MacCommandPaletteView(model: palette, close: {})
        }
        // A toast with an action.
        frame.toast("Moved 3 notes to Trips", tone: .success)
        await draw("toast", size: CGSize(width: 480, height: 90), surface: .window) { _ in ToastStack(model: frame) }
        // Quick Add: the empty field, then words with chips.
        let queue = QuickAddQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent("qa-\(UUID().uuidString).json"))
        let qa = QuickAddModel(client: frame.client, queue: queue)
        await draw("quickadd-empty", size: CGSize(width: 640, height: 90), surface: .popover) { _ in
            WebQuickAddPanel(model: qa, close: {}, openPage: { _ in })
        }
        qa.text = "Call the printer tomorrow 9am !high"
        try? await Task.sleep(for: .milliseconds(400))
        await draw("quickadd-chips", size: CGSize(width: 640, height: 110), surface: .popover) { _ in
            WebQuickAddPanel(model: qa, close: {}, openPage: { _ in })
        }
        // The floating note's bar.
        await draw("floating-note-bar", size: CGSize(width: 360, height: 28), surface: .window) { _ in
            FloatingNoteBar(model: frame, state: FloatingNoteState(onTop: true), toggleOnTop: {})
        }
        frame.stop()
    }

    enum Surface { case sheet, popover, window }

    private func draw<V: View>(_ name: String, size: CGSize, surface: Surface, _ view: (ColorScheme) -> V) async {
        guard let out = Self.shots else { return }
        for scheme in [ColorScheme.light, .dark] {
            let root = view(scheme)
                .frame(width: size.width, height: size.height, alignment: .topLeading)
                .background(Color(nsColor: surface == .window ? .controlBackgroundColor : .windowBackgroundColor))
                .environment(\.colorScheme, scheme)
                // (Drawn as in the key window: an offscreen window is never key.)
                .environment(\.controlActiveState, .key)
            let host = NSHostingView(rootView: root)
            host.frame = CGRect(origin: .zero, size: size)
            let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            window.contentView = host
            window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
            window.orderFrontRegardless()
            defer { window.orderOut(nil) }
            for _ in 0..<4 {
                host.layoutSubtreeIfNeeded()
                try? await Task.sleep(for: .milliseconds(120))
            }
            if let image = DnaSnapshotTests.image(host, scale: 2), let data = DnaSnapshotTests.png(image) {
                let d = URL(fileURLWithPath: out)
                try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
                try? data.write(to: d.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
            }
        }
    }

    private func dump(_ name: String, before: [WebMenuEntry], after: [String]) throws {
        guard let dir = Self.dumps else { return }
        let rows = before.map { e -> String in
            switch e.item.kind {
            case .separator: return "---"
            case .heading: return "# \(e.item.title)"
            case .item:
                var t = e.item.title
                if let k = e.item.shortcut { t += " [\(k)]" }
                if e.item.checked { t += " ✓" }
                if let d = e.item.description { t += " {\(d)}" }
                if let d = e.item.detail { t += " <\(d)>" }
                if e.disabled || e.item.disabled { t += " (off)" }
                if e.item.danger { t += " (danger)" }
                return t
            }
        }
        try write(name, before: rows, after: after, dir: dir)
    }

    private func dumpAccount(_ rows: [AccountMenuRow], after: [String]) throws {
        guard let dir = Self.dumps else { return }
        let before = rows.map { r -> String in
            switch r.kind {
            case .separator: return "---"
            case .heading: return "# \(r.title)"
            default:
                var t = r.title
                if let k = r.shortcut { t += " [\(k)]" }
                if r.checked { t += " ✓" }
                if let d = r.detail { t += " {\(d)}" }
                if r.badge > 0 { t += " <\(r.badge)>" }
                if r.dot { t += " <dot>" }
                if r.kind == .sub { t += " (indent 1)" }
                if r.disabled { t += " (off)" }
                return t
            }
        }
        try write("account", before: before, after: after, dir: dir)
    }

    private func write(_ name: String, before: [String], after: [String], dir: String) throws {
        let d = URL(fileURLWithPath: dir)
        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        let text = "BEFORE (the drawn menu's rows)\n" + before.joined(separator: "\n") + "\n\nAFTER (the NSMenu's items: [key] ✓ {subtitle} <badge> (indent) (off) (danger) 🖼 image)\n" + after.joined(separator: "\n") + "\n"
        try text.write(to: d.appendingPathComponent("\(name).txt"), atomically: true, encoding: .utf8)
    }

    /// A menu with a row of every kind.
    static var everyKind: [WebMenuEntry] {
        [
            .separator(0),
            .heading("Sort by"),
            WebMenuEntry(.item("Last updated", checked: true, id: "updated")),
            WebMenuEntry(.item("Date created", checked: false, id: "created")),
            .separator(1),
            .separator(2),
            WebMenuEntry(.item("Search or jump to…", icon: .search, shortcut: "⌘K", id: "search")),
            WebMenuEntry(.ai("Ask Foli AI", shortcut: "⌘J", id: "ai")),
            WebMenuEntry(.item("Cut", icon: .scissors, shortcut: "⌘X", id: "cut"), disabled: true),
            WebMenuEntry(.item("Focus", checked: false, description: "Dim notes more than two steps away", id: "focus")),
            WebMenuEntry(.item("Studio", detail: "Pro", id: "plan")),
            WebMenuEntry(.item("Color: Moss", swatch: .green, id: "moss")),
            WebMenuEntry(.item("Move folder…", icon: .folderInput, id: "folder")),
            .separator(3),
            WebMenuEntry(.item("Delete folder…", icon: .trash, danger: true, id: "delete")),
            .separator(4),
        ]
    }
}
#endif
