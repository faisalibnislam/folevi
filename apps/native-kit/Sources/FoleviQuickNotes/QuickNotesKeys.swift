// The panel's keyboard shortcuts. Folevi's main menu has its own ⌘N, ⌘1 and the rest, so the panel answers these
// first (QuickNotesPanel and QuickNotesWindow call `handleKey` before the menus); everything else goes on to Folevi's
// menus (Edit's Copy, Paste and Undo).
import AppKit

extension QuickNotesModel {
    struct Shortcut: Equatable {
        var key: String
        var command = false, shift = false, option = false, control = false

        static func of(_ event: NSEvent) -> Shortcut? {
            guard event.type == .keyDown else { return nil }
            let f = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let key: String
            switch event.keyCode {
            case 51: key = "delete"
            case 36, 76: key = "return"
            case 23 where f.contains(.shift): key = "5" // ⇧5 reads "%"
            case 27: key = "-"
            default: key = (event.charactersIgnoringModifiers ?? "").lowercased()
            }
            return Shortcut(key: key, command: f.contains(.command), shift: f.contains(.shift), option: f.contains(.option), control: f.contains(.control))
        }
    }

    /// The panel's shortcuts, as the cheat sheet lists them.
    enum Action: Equatable {
        case dot(Int), nextDot, previousDot, newDot, renameDot, deleteDot, clearDot
        case moveDotLeft, moveDotRight
        case toggleRich, screenshot, pin, window, save, shortcuts
        case bold, italic, underline, strikethrough, link, checkbox, divider, copyMarkdown
        case zoomIn, zoomOut, zoomReset
    }

    /// The action a key press runs, or nil (pure: KeysTests).
    nonisolated static func action(for s: Shortcut) -> Action? {
        guard s.command, !s.control else { return nil }
        switch (s.key, s.shift, s.option) {
        case let (k, false, false) where k.count == 1 && ("1"..."9").contains(k): return .dot(Int(k)! - 1)
        case ("]", false, false): return .nextDot
        case ("[", false, false): return .previousDot
        case ("]", false, true): return .moveDotRight
        case ("[", false, true): return .moveDotLeft
        case ("n", false, false): return .newDot
        case ("r", false, false): return .renameDot
        case ("delete", false, false): return .deleteDot
        case ("delete", false, true): return .clearDot
        case ("t", true, false): return .toggleRich
        case ("5", true, false): return .screenshot
        case ("p", true, false): return .pin
        case ("d", false, true): return .window
        case ("s", false, false), ("return", false, false): return .save
        case ("/", false, false): return .shortcuts
        case ("b", false, false): return .bold
        case ("i", false, false): return .italic
        case ("u", false, false): return .underline
        case ("x", true, false): return .strikethrough
        case ("k", false, false): return .link
        case ("l", true, false): return .checkbox
        case ("-", true, false): return .divider
        case ("c", true, false): return .copyMarkdown
        case ("=", false, false), ("+", false, false), ("=", true, false): return .zoomIn
        case ("-", false, false): return .zoomOut
        case ("0", false, false): return .zoomReset
        default: return nil
        }
    }

    /// Runs the panel's shortcut for `event` (true: handled).
    func handleKey(_ event: NSEvent) -> Bool {
        guard overlay == nil || event.keyCode == 53, let s = Shortcut.of(event), let action = Self.action(for: s) else { return false }
        perform(action)
        return true
    }

    func perform(_ action: Action) {
        let tv = editor.activeTextView
        switch action {
        case .dot(let i): selectDot(index: i)
        case .nextDot: selectNextDot()
        case .previousDot: selectPreviousDot()
        case .moveDotLeft: moveActiveDot(by: -1)
        case .moveDotRight: moveActiveDot(by: 1)
        case .newDot: addDot()
        case .renameDot: if let id = activeDotID { overlay = .rename(id) }
        case .deleteDot: requestDelete()
        case .clearDot: clearDot()
        case .toggleRich: toggleRichText()
        case .screenshot: capture(.region)
        case .pin: panel?.togglePin()
        case .window: panel?.toggleDetach()
        case .save: saveToNote()
        case .shortcuts: overlay = .cheatSheet
        case .bold: tv?.quickNoteToggleBold(nil)
        case .italic: tv?.quickNoteToggleItalic(nil)
        case .underline: tv?.underline(nil)
        case .strikethrough: tv?.quickNoteToggleStrikethrough(nil)
        case .link: tv?.editLink(nil)
        case .checkbox: tv?.quickNoteInsertCheckbox(nil)
        case .divider: tv?.quickNoteInsertDivider(nil)
        case .copyMarkdown: tv?.copyAsMarkdown(nil)
        case .zoomIn: zoom(1)
        case .zoomOut: zoom(-1)
        case .zoomReset: zoom(nil)
        }
    }
}
