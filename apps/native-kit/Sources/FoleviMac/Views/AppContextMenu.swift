// Folevi's right-click menu wherever a part of the window has none of its own (apps/web/src/components/app/
// AppContextMenu.tsx as Folevi for Mac shows it; Shift+right-click keeps the system's):
// - a text field: Cut, Copy, Paste and Select all, with the Mac's spelling guesses, Look Up and Share
//   (lib/desktop/textMenu.ts);
// - anywhere else: New note, Search or jump to…, Ask Foli AI, then Back, Forward and Reload.
// The note page draws its own menus (the editor's), so a right click over it is left to the page.
#if os(macOS)
import AppKit
import WebKit
import FoleviDesign

@MainActor
enum AppContextMenu {
    private struct Attached {
        weak var window: NSWindow?
        weak var model: FrameModel?
    }

    private static var frames: [ObjectIdentifier: Attached] = [:]

    /// The window's frame, for its "anywhere" menu.
    static func attach(_ model: FrameModel, window: NSWindow?) {
        guard let window else { return }
        frames = frames.filter { $0.value.window != nil }
        frames[ObjectIdentifier(window)] = Attached(window: window, model: model)
    }

    /// The menu for a right click no view answered, or nil to leave the click alone.
    static func entries(for event: NSEvent, in window: NSWindow) -> [WebMenuEntry]? {
        if event.modifierFlags.contains(.shift) { return nil }
        guard let content = window.contentView else { return nil }
        let hit = content.hitTest(content.convert(event.locationInWindow, from: nil))
        var v = hit
        while let view = v {
            if view is WKWebView { return nil }
            v = view.superview
        }
        if let text = textView(hit, in: window) { return textEntries(text, event: event) }
        guard let model = frames[ObjectIdentifier(window)]?.model else { return nil }
        return anywhereEntries(model, window: window)
    }

    // MARK: text fields

    /// The text the click landed in: a field's editor (focusing the field first, as the web does), or a text view.
    private static func textView(_ hit: NSView?, in window: NSWindow) -> NSTextView? {
        if let t = hit as? NSTextView, t.isEditable || t.isSelectable { return t }
        var v = hit
        while let view = v, !(view is NSTextField) { v = view.superview }
        guard let field = v as? NSTextField, field.isEditable || field.isSelectable else { return nil }
        if field.currentEditor() == nil { window.makeFirstResponder(field) }
        return field.currentEditor() as? NSTextView
    }

    private static func textEntries(_ text: NSTextView, event: NSEvent) -> [WebMenuEntry] {
        let secure = text.delegate is NSSecureTextField
        let selected = text.selectedRange()
        let picked = selected.length > 0
        let editable = text.isEditable
        let string = text.string as NSString
        var out: [WebMenuEntry] = []

        // Spelling: the word under the caret (or the selection, when it is that word), as the web asks the Mac.
        let caret = text.characterIndexForInsertion(at: text.convert(event.locationInWindow, from: nil))
        let word = !secure && editable ? wordRange(string, at: picked ? selected.location : caret) : nil
        if let word, !picked || NSEqualRanges(word, selected) {
            let w = string.substring(with: word)
            let checker = NSSpellChecker.shared
            let miss = checker.checkSpelling(of: w, startingAt: 0)
            if miss.location != NSNotFound {
                let guesses = (checker.guesses(forWordRange: NSRange(location: 0, length: (w as NSString).length), in: w, language: nil, inSpellDocumentWithTag: text.spellCheckerDocumentTag) ?? []).prefix(5)
                if guesses.isEmpty {
                    out.append(WebMenuEntry(.item("No guesses found", id: "spell-none"), disabled: true))
                } else {
                    for (i, g) in guesses.enumerated() {
                        out.append(WebMenuEntry(.item(g, id: "spell-\(i)")) {
                            text.window?.makeFirstResponder(text)
                            if text.shouldChangeText(in: word, replacementString: g) {
                                text.replaceCharacters(in: word, with: g)
                                text.didChangeText()
                            }
                        })
                    }
                }
                out.append(WebMenuEntry(.item("Learn spelling")) { checker.learnWord(w) })
                out.append(WebMenuEntry(.item("Ignore spelling")) { checker.ignoreWord(w, inSpellDocumentWithTag: text.spellCheckerDocumentTag) })
                out.append(.separator(1))
            }
        }

        // Look Up: the selection, or the word under the pointer.
        let lookRange = picked ? selected : (secure ? nil : wordRange(string, at: caret))
        if !secure, let r = lookRange {
            let t = string.substring(with: r).trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty {
                let short = t.count > 24 ? "\(t.prefix(22).trimmingCharacters(in: .whitespaces))…" : t
                out.append(WebMenuEntry(.item("Look up \u{201C}\(short)\u{201D}")) { lookUp(text, r) })
                out.append(.separator(2))
            }
        }

        if editable {
            out.append(WebMenuEntry(.item("Cut", icon: .scissors, shortcut: "⌘X"), disabled: !picked || secure) { text.cut(nil) })
        }
        out.append(WebMenuEntry(.item("Copy", icon: .copy, shortcut: "⌘C"), disabled: !picked || secure) { text.copy(nil) })
        if editable {
            out.append(WebMenuEntry(.item("Paste", icon: .clipboardPaste, shortcut: "⌘V")) { text.window?.makeFirstResponder(text); text.paste(nil) })
        }
        out.append(.separator(3))
        out.append(WebMenuEntry(.item("Select all", icon: .squareDashedText, shortcut: "⌘A")) { text.window?.makeFirstResponder(text); text.selectAll(nil) })

        if picked, !secure {
            let s = string.substring(with: selected)
            if !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let at = event.locationInWindow
                out.append(.separator(4))
                out.append(WebMenuEntry(.item("Share…", icon: .share)) {
                    guard let host = text.window?.contentView else { return }
                    let p = host.convert(at, from: nil)
                    NSSharingServicePicker(items: [s]).show(relativeTo: NSRect(origin: p, size: .init(width: 1, height: 1)), of: host, preferredEdge: .maxY)
                })
            }
        }
        return out
    }

    /// The system's Look Up panel for a range of the text, at its first line's baseline.
    private static func lookUp(_ text: NSTextView, _ r: NSRange) {
        guard let window = text.window, let attr = text.attributedSubstring(forProposedRange: r, actualRange: nil) else { return }
        let onScreen = text.firstRect(forCharacterRange: r, actualRange: nil)
        let rect = text.convert(window.convertFromScreen(onScreen), from: nil)
        let font = attr.attribute(.font, at: 0, effectiveRange: nil) as? NSFont ?? text.font ?? .systemFont(ofSize: NSFont.systemFontSize)
        text.showDefinition(for: attr, at: NSPoint(x: rect.minX, y: text.isFlipped ? rect.maxY + font.descender : rect.minY - font.descender))
    }

    /// The word around `offset` (the web's wordAround: letters, digits, marks, inner quotes and hyphens), or nil
    /// between words.
    private static func wordRange(_ s: NSString, at offset: Int) -> NSRange? {
        let text = s as String
        let chars = Array(text.utf16)
        let n = chars.count
        func isWord(_ i: Int) -> Bool {
            guard i >= 0, i < n, let u = Unicode.Scalar(chars[i]) else { return false }
            if "'’-".unicodeScalars.contains(u) { return true }
            let p = u.properties.generalCategory
            switch p {
            case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
                 .decimalNumber, .letterNumber, .otherNumber, .nonspacingMark, .spacingMark, .enclosingMark:
                return true
            default: return false
            }
        }
        var start = max(0, min(offset, n))
        var end = start
        while start > 0, isWord(start - 1) { start -= 1 }
        while end < n, isWord(end) { end += 1 }
        let edge: Set<UInt16> = Set("'’-".utf16)
        while start < end, edge.contains(chars[start]) { start += 1 }
        while end > start, edge.contains(chars[end - 1]) { end -= 1 }
        guard end > start else { return nil }
        let r = NSRange(location: start, length: end - start)
        return s.substring(with: r).unicodeScalars.contains(where: { $0.properties.isAlphabetic }) ? r : nil
    }

    // MARK: anywhere

    private static func anywhereEntries(_ model: FrameModel, window: NSWindow) -> [WebMenuEntry] {
        var out: [WebMenuEntry] = [
            WebMenuEntry(.item("New note", icon: .filePlusCorner, shortcut: "⌘⌥N")) { model.newNote() },
            WebMenuEntry(.item("Search or jump to…", icon: .search, shortcut: "⌘K")) {
                FrameSheets.attach(model, window: window)
                CommandPalette.show(model)
            },
        ]
        if model.session.value?.capabilities.ai ?? false {
            out.append(WebMenuEntry(.ai("Ask Foli AI", shortcut: "⌘J")) { model.askAI() })
        }
        out += [
            .separator(1),
            WebMenuEntry(.item("Back", icon: .arrowLeft)) { model.goBack() },
            WebMenuEntry(.item("Forward", icon: .arrowRight)) { model.goForward() },
            WebMenuEntry(.item("Reload", icon: .rotateCw)) { model.reloadScreen() },
        ]
        return out
    }
}
#endif
