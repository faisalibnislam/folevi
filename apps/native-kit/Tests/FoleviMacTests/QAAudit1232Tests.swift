// QA audit 1.2.32 on the Mac: keys typed right after ⌘K wait for the palette's field (F04), each palette result
// is named on its own (F05), Calendar's days carry their own dates (F07), the note's page leaves the accessibility
// tree while a native screen covers it (F20), and a note's "…" is named after the note (F21).
#if os(macOS)
import AppKit
import Testing
@testable import FoleviMac
@testable import FoleviScreens

@MainActor
private func key(_ chars: String, code: UInt16 = 0, mods: NSEvent.ModifierFlags = [], window: NSWindow) -> NSEvent {
    NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: mods, timestamp: 0, windowNumber: window.windowNumber, context: nil,
                     characters: chars, charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code)!
}

@Suite("QA 1.2.32: early keys after ⌘K") @MainActor
struct EarlyKeysTests {
    @Test func whatWaitsForTheField() {
        #expect(EarlyKeys.holds(keyCode: 0, modifiers: [], characters: "a"))
        #expect(EarlyKeys.holds(keyCode: 0, modifiers: .shift, characters: "A"))
        #expect(EarlyKeys.holds(keyCode: 0, modifiers: .option, characters: "å"))
        #expect(EarlyKeys.holds(keyCode: 9, modifiers: .command, characters: "v"))
        // Escape closes the palette; other shortcuts run as usual.
        #expect(!EarlyKeys.holds(keyCode: 53, modifiers: [], characters: "\u{1b}"))
        #expect(!EarlyKeys.holds(keyCode: 13, modifiers: .command, characters: "w"))
        #expect(!EarlyKeys.holds(keyCode: 0, modifiers: .control, characters: "a"))
    }

    @Test func commandKMatchesTheMenuItem() {
        #expect(EarlyKeys.matches(characters: "k", modifiers: .command, key: "k", mask: .command))
        #expect(EarlyKeys.matches(characters: "K", modifiers: [.command, .capsLock], key: "k", mask: .command))
        #expect(!EarlyKeys.matches(characters: "k", modifiers: [.command, .option], key: "k", mask: .command))
        #expect(!EarlyKeys.matches(characters: "j", modifiers: .command, key: "k", mask: .command))
        #expect(!EarlyKeys.matches(characters: "k", modifiers: .command, key: "", mask: .command))
    }

    @Test func heldKeysReachTheFieldInOrderOnceItHasTheFocus() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        let field = NSTextField(frame: NSRect(x: 10, y: 10, width: 300, height: 24))
        let other = NSView(frame: NSRect(x: 0, y: 100, width: 10, height: 10))
        window.contentView?.addSubview(field)
        window.contentView?.addSubview(other)
        window.makeFirstResponder(nil)
        var ready = false
        let keys = EarlyKeys(window: window, isReady: { ready })
        // Typed before the field had the focus: held, nothing reaches anything else.
        for c in "cedarforest4" {
            #expect(keys.handle(key(String(c), window: window)) == nil)
        }
        #expect(keys.held.count == 12)
        // A shortcut that isn't typing goes on.
        #expect(keys.handle(key("w", code: 13, mods: .command, window: window)) != nil)
        // The field has the focus: what was held goes in first, then the key just pressed passes through.
        window.makeFirstResponder(field)
        ready = true
        let next = key("5", window: window)
        #expect(keys.handle(next) === next)
        #expect(keys.held.isEmpty)
        #expect(field.currentEditor()?.string == "cedarforest4")
    }

    @Test func textOfHeldKeysWhenTheFieldNeverCame() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
        let keys = EarlyKeys(window: window, isReady: { false })
        for c in "violetx" { _ = keys.handle(key(String(c), window: window)) }
        _ = keys.handle(key("\u{7f}", code: 51, window: window))
        _ = keys.handle(key("\u{F702}", code: 123, window: window))
        #expect(keys.releaseAsText() == "violet")
    }
}

@Suite("QA 1.2.32: accessibility names") @MainActor
struct QAAccessibilityNameTests {
    @Test func paletteResultsSayWhatTheyAre() {
        let note = PaletteModel.Item.note(id: "n", title: "QA 1105", snippet: "found here", updatedAt: nil, blockId: nil, meaning: false)
        #expect(note.accessibilityName == "QA 1105, document")
        #expect(note.accessibilityDetail == "found here")
        let meaning = PaletteModel.Item.note(id: "m", title: "", snippet: nil, updatedAt: nil, blockId: nil, meaning: true)
        #expect(meaning.accessibilityName == "Untitled, document found by meaning")
        let action = PaletteModel.Item.action(id: "a", label: "Open Trash", hint: "⌘J", icon: nil, ai: false) {}
        #expect(action.accessibilityName == "Open Trash, command")
        #expect(action.accessibilityDetail == "Shortcut ⌘J")
    }

    @Test func calendarDaysCarryTheirOwnDate() {
        // November 2026's grid starts on Monday 26 October: that day is named for October, not the month shown.
        #expect(MonthCell.accessibilityName(day: "2026-10-26", today: "2026-11-05", tasks: 0, events: 0) == "Monday, October 26, 2026, no tasks")
        #expect(MonthCell.accessibilityName(day: "2026-11-05", today: "2026-11-05", tasks: 2, events: 1) == "Today, Thursday, November 5, 2026, 2 tasks, 1 event")
        #expect(MonthCell.accessibilityName(day: "2026-12-01", today: "2026-11-05", tasks: 1, events: 3) == "Tuesday, December 1, 2026, 1 task, 3 events")
    }

    @Test func aNotesMenuButtonIsNamedForTheNote() {
        #expect(moreActionsLabel("Maple") == "More actions for Maple")
        #expect(moreActionsLabel("") == "More actions for Untitled")
    }

    @Test func aCoveredPageLeavesTheAccessibilityTree() {
        let clip = CardClipView(frame: NSRect(x: 0, y: 0, width: 200, height: 200))
        let page = NSView(frame: clip.bounds)
        let body = NSTextField(labelWithString: "Previous note body")
        page.addSubview(body)
        let screen = NSTextField(labelWithString: "Archive")
        clip.addSubview(page)
        clip.addSubview(screen)
        func reachable(_ element: Any, depth: Int = 0) -> [String] {
            guard depth < 8, let e = element as? any NSAccessibilityProtocol else { return [] }
            let me = [e.accessibilityValue() as? String, e.accessibilityLabel()].compactMap { $0 }
            let kids = e.accessibilityChildren() ?? []
            return me + kids.flatMap { reachable($0, depth: depth + 1) }
        }
        #expect(reachable(clip).contains("Previous note body"))
        clip.hiddenChild = page
        #expect(!reachable(clip).contains("Previous note body"))
        #expect(reachable(clip).contains("Archive"))
        #expect(CardClipView.element(body, isInside: page))
        clip.hiddenChild = nil
        #expect(reachable(clip).contains("Previous note body"))
    }
}
#endif
