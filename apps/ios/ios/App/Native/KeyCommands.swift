// Folevi's keyboard shortcuts with a hardware keyboard on an iPad (or an iPhone): listed in the overlay iPadOS
// shows while ⌘ is held, and handed to the page as the same key press, so the web app does what it does for
// them anywhere (Shell.tsx and the editor). Only the app's own commands are here; editing keys (⌘B, ⌘C, ⌘Z)
// stay with the web view, as typed.
import UIKit
import WebKit

struct FoleviShortcut {
    let title: String
    let input: String
    let modifiers: UIKeyModifierFlags
    /// The key press for the page: KeyboardEvent's `key` and `code`.
    let key: String
    let code: String

    static let all: [FoleviShortcut] = [
        FoleviShortcut(title: "New Note", input: "n", modifiers: .command, key: "n", code: "KeyN"),
        FoleviShortcut(title: "Search", input: "k", modifiers: .command, key: "k", code: "KeyK"),
        FoleviShortcut(title: "Quick Add Task", input: "a", modifiers: [.command, .shift], key: "A", code: "KeyA"),
        FoleviShortcut(title: "Ask Foli AI", input: "j", modifiers: .command, key: "j", code: "KeyJ"),
        FoleviShortcut(title: "Today's Tasks", input: "t", modifiers: [.command, .alternate], key: "†", code: "KeyT"),
        FoleviShortcut(title: "Show or Hide Sidebar", input: "\\", modifiers: .command, key: "\\", code: "Backslash"),
        FoleviShortcut(title: "Back", input: "[", modifiers: .command, key: "[", code: "BracketLeft"),
        FoleviShortcut(title: "Forward", input: "]", modifiers: .command, key: "]", code: "BracketRight"),
    ]

    /// The script that presses this key in the page: on what has focus, so the editor and fields see it too.
    var script: String {
        let flags = modifiers
        func js(_ s: String) -> String { s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
        return """
        (function(){var t=document.activeElement||document.body;var o={key:"\(js(key))",code:"\(code)",metaKey:\(flags.contains(.command)),shiftKey:\(flags.contains(.shift)),altKey:\(flags.contains(.alternate)),ctrlKey:false,bubbles:true,cancelable:true,composed:true};t.dispatchEvent(new KeyboardEvent("keydown",o));t.dispatchEvent(new KeyboardEvent("keyup",o));})();
        """
    }

    func keyCommand(action: Selector) -> UIKeyCommand {
        let command = UIKeyCommand(title: title, action: action, input: input, modifierFlags: modifiers)
        command.discoverabilityTitle = title
        command.wantsPriorityOverSystemBehavior = true
        return command
    }

    static func matching(_ command: UIKeyCommand) -> FoleviShortcut? {
        all.first { $0.input == command.input && $0.modifiers == command.modifierFlags }
    }
}

extension FoleviViewController {
    override var keyCommands: [UIKeyCommand]? {
        (super.keyCommands ?? []) + FoleviShortcut.all.map { $0.keyCommand(action: #selector(pressShortcut(_:))) }
    }

    @objc func pressShortcut(_ command: UIKeyCommand) {
        guard let shortcut = FoleviShortcut.matching(command) else { return }
        press(shortcut)
    }

    /// Hands a shortcut to the page (on Folevi's own pages only).
    func press(_ shortcut: FoleviShortcut) {
        guard let webView, let page = webView.url, let server = bridge?.serverURL, AppOrigin.of(page) == AppOrigin.of(server) else { return }
        webView.evaluateJavaScript(shortcut.script)
    }
}
