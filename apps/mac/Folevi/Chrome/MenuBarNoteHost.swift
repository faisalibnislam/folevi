// The menu bar note in the Mac app (apps/native-kit FoleviMenuBarNote, owner decisions 2026-11-28): the menu bar icon
// and the global shortcut (⌥Space, Settings > General) open a panel with one real Folevi note in Folevi's own editor:
// the float page without its bar (`/float/<id>?panel=1`), in a web view of the open place made the first time the
// panel opens. Its empty page (`/float/new?...`) makes the note in Drafts, or the folder picked, on the first
// keystroke; it syncs like any other note (the account, or an iCloud or "On this Mac" library). The page answers the
// panel's "menu-note-destinations" and "menu-note-image" (apps/web components/app/MenuBarNote.tsx). The panel's
// menu ends with today's menu bar items (StatusItem).
import AppKit
import FoleviMenuBarNote
import WebKit

@MainActor
final class MacMenuBarNote: MenuBarNoteHost {
    static let shared = MacMenuBarNote()

    private var started = false
    private var view: FoleviWebView?
    private let box = NSView()
    private var urlObservation: NSKeyValueObservation?

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
        note.toggle()
    }

    func show() {
        guard ShellMode.current != "unset" else { return WindowManager.shared.showMain() }
        note.show()
    }

    /// Another place opened: a page of that place (its session and data are its own).
    func placeChanged() {
        guard started else { return }
        dropView()
        note.placeChanged()
    }

    /// The page saves what was typed last before the app quits.
    func flushIfStarted() {
        guard started, let view else { return }
        PageClosing.flush(view)
    }

    // MARK: the note's page

    /// The web view of the place's float page, made once per place.
    private func ensureView() -> FoleviWebView {
        let place = WindowManager.shared.currentPlace()
        if let view, view.place == place { return view }
        dropView()
        let made = WebViewFactory.make(place: place, role: .float, bootstrap: WindowManager.shared.bootstrapOf(place, .float), frame: box.bounds, window: { [weak box] in box?.window })
        made.frame = box.bounds
        made.autoresizingMask = [.width, .height]
        box.addSubview(made)
        urlObservation = made.observe(\.url, options: [.new]) { view, _ in
            MainActor.assumeIsolated {
                guard let path = MacMenuBarNote.path(of: view.url) else { return }
                MacMenuBarNote.shared.note.pathChanged(path)
            }
        }
        view = made
        return made
    }

    private func dropView() {
        urlObservation = nil
        guard let old = view else { return }
        view = nil
        PageClosing.flush(old) {
            old.load(URLRequest(url: URL(string: "about:blank")!))
            old.removeFromSuperview()
        }
    }

    /// An app URL's path and query ("/float/01AB?panel=1").
    nonisolated static func path(of url: URL?) -> String? {
        guard let url, let c = URLComponents(url: url, resolvingAgainstBaseURL: false), !c.path.isEmpty, c.path != "blank" else { return nil }
        return c.path + (c.percentEncodedQuery.map { "?" + $0 } ?? "")
    }

    // MARK: MenuBarNoteHost

    var placeID: String { WindowManager.shared.currentPlace() ?? "default" }

    var shortcutLabel: String? { Self.label(DesktopSettings.current.quickAddShortcut) }

    var noteView: NSView { box }

    var currentPath: String? { view.flatMap { Self.path(of: $0.url) } }

    func load(path: String) {
        let v = ensureView()
        if v.loaded { WindowManager.shared.navigate(v, to: path) } else { v.load(URLRequest(url: Links.appURL(path))) }
    }

    func destinations() async throws -> [NoteSpace] {
        let v = ensureView()
        for _ in 0..<150 where !v.loaded { try? await Task.sleep(for: .milliseconds(100)) }
        guard v.loaded, let answer = await Capabilities.ask(["type": "menu-note-destinations"], to: v, timeout: 20) else {
            throw MenuBarNoteError("Folevi is still starting. Try again in a moment.")
        }
        guard answer["ok"] as? Bool == true, let spaces = answer["spaces"] else {
            throw MenuBarNoteError(answer["message"] as? String ?? "Folevi couldn't list your folders.")
        }
        let data = try JSONSerialization.data(withJSONObject: spaces)
        return try JSONDecoder().decode([NoteSpace].self, from: data)
    }

    func insertImage(_ data: Data, mime: String, name: String) async throws {
        let v = ensureView()
        let answer = await Capabilities.ask(["type": "menu-note-image", "data": data.base64EncodedString(), "mime": mime, "name": name], to: v, timeout: 60)
        guard answer?["ok"] as? Bool == true else {
            throw MenuBarNoteError(answer?["message"] as? String ?? "Folevi couldn't add the screenshot.")
        }
    }

    func focusNote() {
        guard let v = view else { return }
        v.window?.makeFirstResponder(v)
        guard v.loaded else { return }
        // The note's text, or the empty page's field, has the keyboard (where it was last).
        v.evaluateJavaScript("(document.querySelector('textarea[aria-label^=\"New note\"]') || document.querySelector('.ProseMirror[contenteditable=\"true\"]') || document.querySelector('textarea[id^=\"title-\"]'))?.focus()")
    }

    func flush() {
        guard let v = view, v.loaded else { return }
        v.evaluateJavaScript("window.dispatchEvent(new Event('pagehide'))")
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
