// The "New Folevi Note with Selection" service (docs/MAC_WEBKIT_PLAN.md §10 WM5): select text in any app, choose
// it from that app's Services menu (or its shortcut, once set in System Settings > Keyboard > Keyboard Shortcuts >
// Services), and Folevi opens a new note holding it. Declared in Info.plist (NSServices: the message, the text it
// takes, the menu title, "New Folevi Dev Note with Selection" for a Debug build); this answers it. The page makes
// the note (the "new-note-with-text" command): its first line is the title, as in the editor.
import AppKit

@MainActor
final class ServicesProvider: NSObject {
    static let shared = ServicesProvider()

    /// The most text one service call brings (a long web page's worth).
    static let maxText = 1_000_000

    static func install() {
        NSApp.servicesProvider = shared
        NSUpdateDynamicServices()
    }

    /// The text a service call brings: plain text, else an RTF's text, else a link's address.
    static func text(from pasteboard: NSPasteboard) -> String? {
        if let s = pasteboard.string(forType: .string), !s.isEmpty { return s }
        if let rtf = pasteboard.data(forType: .rtf), let a = NSAttributedString(rtf: rtf, documentAttributes: nil), !a.string.isEmpty { return a.string }
        if let url = pasteboard.string(forType: .URL), !url.isEmpty { return url }
        return nil
    }

    /// NSMessage "newNoteWithSelection".
    @objc func newNoteWithSelection(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let raw = Self.text(from: pasteboard)?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            error.pointee = "There was no text to put in a note." as NSString
            return
        }
        let text = String(raw.prefix(Self.maxText))
        NSApp.activate()
        Task { @MainActor in
            _ = await Capabilities.ask(["type": "new-note-with-text", "text": text], timeout: 60)
        }
    }
}
