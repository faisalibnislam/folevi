// The panel's keyboard shortcuts. Folevi's main menu has its own ⌘N and the rest, so the panel answers these first
// (MenuBarNotePanel and MenuBarNoteWindow call `handleKey` before anything else); the note's own keys (⌘B, ⌘K,
// Markdown as you type) are the editor's, in the page.
import AppKit

extension MenuBarNoteModel {
    struct Shortcut: Equatable {
        var key: String
        var command = false, shift = false, option = false, control = false

        static func of(_ event: NSEvent) -> Shortcut? {
            guard event.type == .keyDown else { return nil }
            let f = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let key: String
            switch event.keyCode {
            case 23 where f.contains(.shift): key = "5" // ⇧5 reads "%"
            case 36, 76: key = "return"
            default: key = (event.charactersIgnoringModifiers ?? "").lowercased()
            }
            return Shortcut(key: key, command: f.contains(.command), shift: f.contains(.shift), option: f.contains(.option), control: f.contains(.control))
        }
    }

    enum Action: Equatable {
        case newNote, sendToFolevi, screenshot, pin, window, openInFolevi
    }

    /// The action a key press runs, or nil (pure: tests).
    nonisolated static func action(for s: Shortcut) -> Action? {
        guard s.command, !s.control else { return nil }
        switch (s.key, s.shift, s.option) {
        case ("n", false, false): return .newNote
        case ("\r", false, false), ("return", false, false): return .sendToFolevi
        case ("5", true, false): return .screenshot
        case ("p", true, false): return .pin
        case ("d", false, true): return .window
        case ("o", true, false): return .openInFolevi
        default: return nil
        }
    }

    func handleKey(_ event: NSEvent) -> Bool {
        guard let s = Shortcut.of(event), let action = Self.action(for: s) else { return false }
        perform(action)
        return true
    }

    func perform(_ action: Action) {
        switch action {
        case .newNote: newNote()
        case .sendToFolevi: sendToFolevi()
        case .screenshot: capture(.region)
        case .pin: panel?.togglePin()
        case .window: panel?.toggleDetach()
        case .openInFolevi: openInFolevi()
        }
    }
}
