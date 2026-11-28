// The menu bar note in the Mac app (apps/native-kit FoleviMenuBarNote, owner decisions 2026-11-28): the menu bar icon
// and the global shortcut (⌥Space, Settings > General) open Home's quick note in a panel. It's written natively; the
// saving goes through a quiet page of the open place (`/float/menu?panel=1`, made the first time it's needed, never
// shown), which answers "menu-note-destinations", "menu-note-save", "menu-note-task" and "menu-note-unsave"
// (apps/web components/app/MenuBarNote.tsx), so a note is made exactly as Home's Save makes it and syncs like any
// other. The panel's menu ends with today's menu bar items (StatusItem).
import AppKit
import FoleviMenuBarNote
import WebKit

@MainActor
final class MacMenuBarNote: MenuBarNoteHost {
    static let shared = MacMenuBarNote()

    private var started = false
    private var view: FoleviWebView?

    private(set) lazy var note: MenuBarNote = {
        started = true
        let n = MenuBarNote(defaults: Paths.defaults, host: self)
        n.anchor = { StatusItem.shared.buttonScreenFrame }
        n.onShownChange = { StatusItem.shared.setHighlighted($0) }
        return n
    }()

    func toggle() {
        // Before the first launch's choice there's nowhere to write: the main window says what to do.
        guard ShellMode.current != "unset" else { return WindowManager.shared.showMain() }
        _ = page()
        note.toggle()
    }

    func show() {
        guard ShellMode.current != "unset" else { return WindowManager.shared.showMain() }
        _ = page()
        note.show()
    }

    /// Another place opened: a page of that place (its session and data are its own).
    func placeChanged() {
        guard started else { return }
        dropPage()
        note.placeChanged()
    }

    /// Nothing waits in the page (a save is answered once it's made), so quitting needs nothing here.
    func flushIfStarted() {}

    // MARK: the quiet page

    /// The place's quiet page, made once per place.
    private func page() -> FoleviWebView {
        let place = WindowManager.shared.currentPlace()
        if let view, view.place == place { return view }
        dropPage()
        let made = WebViewFactory.make(place: place, role: .float, bootstrap: WindowManager.shared.bootstrapOf(place, .float), frame: NSRect(x: 0, y: 0, width: 400, height: 300), window: { nil })
        made.load(URLRequest(url: Links.appURL("/float/menu?panel=1")))
        view = made
        return made
    }

    private func dropPage() {
        guard let old = view else { return }
        view = nil
        old.load(URLRequest(url: URL(string: "about:blank")!))
    }

    /// The page once it has loaded (up to 15 seconds), else an error to show.
    private func ready() async throws -> FoleviWebView {
        let v = page()
        for _ in 0..<150 where !v.loaded { try? await Task.sleep(for: .milliseconds(100)) }
        guard v.loaded else { throw MenuBarNoteError("Folevi is still starting. Try again in a moment.") }
        return v
    }

    private func ask(_ command: [String: Any], timeout: TimeInterval) async throws -> [String: Any] {
        let v = try await ready()
        guard let answer = await Capabilities.ask(command, to: v, timeout: timeout) else { throw MenuBarNoteError("Folevi didn't answer. Try again.") }
        guard answer["ok"] as? Bool == true else { throw MenuBarNoteError(answer["message"] as? String ?? "Folevi couldn't do that.") }
        return answer
    }

    // MARK: MenuBarNoteHost

    var placeID: String { WindowManager.shared.currentPlace() ?? "default" }

    var shortcutLabel: String? { Self.label(DesktopSettings.current.quickAddShortcut) }

    func destinations() async throws -> [NoteSpace] {
        let answer = try await ask(["type": "menu-note-destinations"], timeout: 20)
        let data = try JSONSerialization.data(withJSONObject: answer["spaces"] ?? [])
        return try JSONDecoder().decode([NoteSpace].self, from: data)
    }

    func save(_ payload: MenuNotePayload) async throws -> String {
        let note: [String: Any] = [
            "space": payload.destination.space,
            "folderId": payload.destination.folderId ?? NSNull(),
            "text": payload.text,
            "images": payload.images.map { ["mime": $0.mime, "name": $0.name, "data": $0.data.base64EncodedString()] },
        ]
        // Uploading screenshots can take a while on a slow connection.
        let answer = try await ask(["type": "menu-note-save", "note": note], timeout: 180)
        guard let id = answer["noteId"] as? String else { throw MenuBarNoteError("Folevi couldn't save the note. Your words are still here.") }
        return id
    }

    func addTask(_ text: String, space: String) async throws {
        _ = try await ask(["type": "menu-note-task", "text": text, "space": space], timeout: 30)
    }

    func undoSave(noteID: String) async throws {
        _ = try await ask(["type": "menu-note-unsave", "noteId": noteID], timeout: 30)
    }

    func openInFolevi(path: String) {
        note.hide()
        WindowManager.shared.showMain(path: path)
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
