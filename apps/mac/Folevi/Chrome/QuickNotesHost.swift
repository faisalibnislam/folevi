// The menu bar's quick notes in the Mac app (apps/native-kit FoleviQuickNotes, owner decisions 2026-11-28): the menu
// bar icon and the global shortcut (⌥Space, Settings > General) open the panel; its notes live on this Mac in the
// build's own support folder; "Save to note" and the destination menu go through the open place's page, as the
// Shortcuts and Services do (Capabilities.ask: "quick-note-destinations", "quick-note-save", "quick-note-unsave",
// answered by apps/web DesktopCapabilities). The panel's menu ends with today's menu bar items (StatusItem).
import AppKit
import FoleviQuickNotes

@MainActor
final class MacQuickNotes: QuickNotesHost {
    static let shared = MacQuickNotes()

    private var started = false

    func flushIfStarted() { if started { notes.flush() } }

    private(set) lazy var notes: QuickNotes = {
        started = true
        let q = QuickNotes(defaults: Paths.defaults, folder: Paths.testing ? nil : Paths.supportFolder.appendingPathComponent("Quick Notes", isDirectory: true), host: self)
        q.anchor = { StatusItem.shared.buttonScreenFrame }
        q.onShownChange = { StatusItem.shared.setHighlighted($0) }
        return q
    }()

    func toggle() {
        // Before the first launch's choice there's nowhere to save: the main window says what to do.
        guard ShellMode.current != "unset" else { return WindowManager.shared.showMain() }
        notes.toggle()
    }

    func show() {
        guard ShellMode.current != "unset" else { return WindowManager.shared.showMain() }
        notes.show()
    }

    // MARK: QuickNotesHost

    var placeID: String { WindowManager.shared.currentPlace() ?? "default" }

    var placeName: String? {
        guard Chrome.places.count > 1 else { return nil }
        return Chrome.placeLabel(placeID)
    }

    var shortcutLabel: String? { Self.label(DesktopSettings.current.quickAddShortcut) }

    func destinations() async throws -> [QuickNoteSpace] {
        // Never opens a window just to list folders: the first one up answers.
        guard let answer = await Capabilities.ask(["type": "quick-note-destinations"], timeout: 20, open: false) else {
            throw QuickNotesHostError("Open Folevi once to list your folders.")
        }
        guard answer["ok"] as? Bool == true, let spaces = answer["spaces"] else {
            throw QuickNotesHostError(answer["message"] as? String ?? "Folevi couldn't list your folders.")
        }
        let data = try JSONSerialization.data(withJSONObject: spaces)
        return try JSONDecoder().decode([QuickNoteSpace].self, from: data)
    }

    func save(_ payload: QuickNotePayload) async throws -> String {
        let note: [String: Any] = [
            "space": payload.destination.space,
            "folderId": payload.destination.folderId ?? NSNull(),
            "title": payload.title,
            "markdown": payload.markdown,
            "images": payload.images.map { ["ref": $0.ref, "mime": $0.mime, "name": $0.name, "data": $0.data.base64EncodedString()] },
        ]
        // Uploading screenshots can take a while on a slow connection.
        guard let answer = await Capabilities.ask(["type": "quick-note-save", "note": note], timeout: 180, open: true) else {
            throw QuickNotesHostError("Folevi couldn't open a window to save the note. Your quick note is still here.")
        }
        guard answer["ok"] as? Bool == true, let id = answer["noteId"] as? String else {
            throw QuickNotesHostError(answer["message"] as? String ?? "Folevi couldn't save the note. Your quick note is still here.")
        }
        return id
    }

    func undoSave(noteID: String) async throws {
        guard let answer = await Capabilities.ask(["type": "quick-note-unsave", "noteId": noteID], timeout: 30, open: false), answer["ok"] as? Bool == true else {
            throw QuickNotesHostError("Open Folevi and move it to the Trash there.")
        }
    }

    func openNote(_ id: String) {
        notes.hide()
        WindowManager.shared.showMain(path: "/d/\(id)")
        NSApp.activate()
    }

    func appMenuItems() -> [NSMenuItem] { StatusItem.shared.appItems() }

    /// An Electron accelerator as the Mac writes it ("Alt+Space" → "⌥Space"), nil for none.
    nonisolated static func label(_ accelerator: String) -> String? {
        guard !accelerator.isEmpty else { return nil }
        var parts = accelerator.components(separatedBy: "+")
        guard let key = parts.popLast() else { return nil }
        let order: [(Set<String>, String)] = [(["Control", "Ctrl"], "⌃"), (["Alt", "Option"], "⌥"), (["Shift"], "⇧"), (["Command", "Cmd", "CommandOrControl", "CmdOrCtrl", "Super", "Meta"], "⌘")]
        let mods = order.filter { !$0.0.isDisjoint(with: parts) }.map(\.1).joined()
        return mods + key
    }
}
