// Keys typed right after ⌘K, before the search field has the focus (QA audit F04): the palette or the search
// screen takes a moment to draw and focus its field, and whatever was typed meanwhile went to the note underneath
// or was lost. From ⌘K on, the keys are held here and handed to the field once it has the focus, in order.
//
// The Mac holds the key presses themselves and sends them on as typed, so an input method composes them as it
// would have, and ⌘V pastes. The iPad and the iPhone take the typing into a hidden key catcher meanwhile.
#if os(macOS)
import AppKit

@MainActor
public final class EarlyKeys {
    /// The keys being held now (one keyboard: at most one at a time).
    public private(set) static var current: EarlyKeys?

    public let window: NSWindow
    /// Whether the field has the focus now (its field editor is the window's first responder).
    let isReady: @MainActor () -> Bool
    private var monitor: Any?
    private(set) var held: [NSEvent] = []

    init(window: NSWindow, isReady: (@MainActor () -> Bool)? = nil) {
        self.window = window
        self.isReady = isReady ?? { [weak window] in (window?.firstResponder as? NSTextView)?.isFieldEditor == true }
    }

    /// Starts holding the keys typed into `window` (anything held before is dropped).
    @discardableResult
    public static func start(in window: NSWindow) -> EarlyKeys {
        current?.cancel()
        let keys = EarlyKeys(window: window)
        keys.monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak keys] e in
            guard let keys else { return e }
            return keys.handle(e)
        }
        current = keys
        // Never held for long: if nothing took them (the palette didn't open), they go where the focus is.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak keys] in
            MainActor.assumeIsolated { if let keys, keys.monitor != nil { keys.release() } }
        }
        return keys
    }

    /// Whether a key press is a menu item's shortcut (`key` and `mask` as NSMenuItem has them): ⌘K, for one, has
    /// to run when it's pressed, not once the page underneath has let it go (F04).
    public nonisolated static func matches(characters: String?, modifiers: NSEvent.ModifierFlags, key: String, mask: NSEvent.ModifierFlags) -> Bool {
        guard !key.isEmpty, let characters, characters.lowercased() == key.lowercased() else { return false }
        let relevant: NSEvent.ModifierFlags = [.command, .shift, .option, .control]
        return modifiers.intersection(relevant) == mask.intersection(relevant)
    }

    /// Whether a key press waits for the field: typing (characters, with Shift or Option too, Return, Tab, the
    /// arrows, Delete) and ⌘V. Escape and the other ⌘ and ⌃ shortcuts go on as usual.
    nonisolated static func holds(keyCode: UInt16, modifiers: NSEvent.ModifierFlags, characters: String?) -> Bool {
        if keyCode == 53 { return false }
        let mods = modifiers.intersection([.command, .control])
        if mods.isEmpty { return true }
        return mods == .command && characters?.lowercased() == "v"
    }

    /// The monitor's step: the event, or nil while it's held.
    func handle(_ e: NSEvent) -> NSEvent? {
        guard e.type == .keyDown, e.window == nil || e.window === window else { return e }
        if isReady() {
            // The field has it now: what's held goes first, then this key, as typed.
            release()
            return e
        }
        guard Self.holds(keyCode: e.keyCode, modifiers: e.modifierFlags, characters: e.charactersIgnoringModifiers) else { return e }
        held.append(e)
        return nil
    }

    /// Hands what's held to the focus (the field), in order: keys as typed, ⌘V as Paste. Stops holding.
    public func release() {
        stop()
        let events = held
        held = []
        for e in events {
            if e.modifierFlags.contains(.command) {
                window.firstResponder?.tryToPerform(#selector(NSText.paste(_:)), with: nil)
            } else {
                window.sendEvent(e)
            }
        }
    }

    /// The typed text of what's held (when the field never got the focus, it goes straight into its text). Stops.
    public func releaseAsText() -> String {
        stop()
        let text = Self.text(of: held)
        held = []
        return text
    }

    nonisolated static func text(of events: [NSEvent]) -> String {
        var out = ""
        for e in events {
            if e.modifierFlags.contains(.command) {
                out += NSPasteboard.general.string(forType: .string) ?? ""
            } else if e.keyCode == 51 {
                if !out.isEmpty { out.removeLast() }
            } else if let c = e.characters, let scalar = c.unicodeScalars.first, scalar.value >= 0x20, scalar.value != 0x7f, !(0xF700...0xF8FF).contains(scalar.value) {
                out += c
            }
        }
        return out
    }

    /// Drops what's held (the palette closed first). Stops.
    public func cancel() {
        stop()
        held = []
    }

    /// Waits (at most `timeout`) for the field to have the focus, then hands it the keys; past that, their text.
    public func settle(timeout: Duration = .seconds(1), fallback: @MainActor (String) -> Void) async {
        let clock = ContinuousClock()
        let end = clock.now + timeout
        while !isReady(), clock.now < end, monitor != nil {
            try? await Task.sleep(for: .milliseconds(8))
        }
        guard monitor != nil || !held.isEmpty else { return }
        if isReady() {
            release()
        } else {
            let text = releaseAsText()
            if !text.isEmpty { fallback(text) }
        }
    }

    private func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        if Self.current === self { Self.current = nil }
    }
}
#elseif os(iOS)
import UIKit

@MainActor
public final class EarlyKeys {
    /// The keys being held now (one keyboard: at most one at a time).
    public private(set) static var current: EarlyKeys?

    let catcher = EarlyKeyCatcher()

    /// Starts taking the typing in `window` (anything taken before is dropped): the note or page underneath no
    /// longer gets it.
    @discardableResult
    public static func start(in window: UIWindow?) -> EarlyKeys {
        current?.cancel()
        let keys = EarlyKeys()
        if let window {
            keys.catcher.frame = CGRect(x: -10, y: -10, width: 1, height: 1)
            window.addSubview(keys.catcher)
            keys.catcher.becomeFirstResponder()
        }
        current = keys
        // Never kept for long: if no field took the keys over (the screen didn't open), the catcher lets go.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak keys] in
            MainActor.assumeIsolated { if let keys, EarlyKeys.current === keys { keys.cancel() } }
        }
        return keys
    }

    /// What was typed so far.
    public var typed: String { catcher.typed }

    /// What was typed, for the field (which has the focus now). Stops taking keys.
    public func take() -> String {
        let text = catcher.typed
        stop()
        return text
    }

    /// Drops what was typed. Stops taking keys.
    public func cancel() {
        catcher.typed = ""
        stop()
    }

    /// Waits a moment for the field to have the focus, then hands over what was typed before it did.
    public func settle(into apply: @MainActor (String) -> Void) async {
        // (The field's focus lands on the next pass; the catcher lets go of the keyboard when it does.)
        for _ in 0..<60 where catcher.isFirstResponder {
            try? await Task.sleep(for: .milliseconds(8))
        }
        let text = take()
        if !text.isEmpty { apply(text) }
    }

    private func stop() {
        if catcher.isFirstResponder { catcher.resignFirstResponder() }
        catcher.removeFromSuperview()
        if Self.current === self { Self.current = nil }
    }
}

/// An invisible text input that keeps the typing until the search field takes over.
final class EarlyKeyCatcher: UIView, UIKeyInput {
    var typed = ""
    var hasText: Bool { !typed.isEmpty }
    override var canBecomeFirstResponder: Bool { true }
    var autocorrectionType: UITextAutocorrectionType { get { .no } set {} }
    var autocapitalizationType: UITextAutocapitalizationType { get { .none } set {} }

    func insertText(_ text: String) { typed += text }

    func deleteBackward() { if !typed.isEmpty { typed.removeLast() } }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        action == #selector(paste(_:)) ? UIPasteboard.general.hasStrings : super.canPerformAction(action, withSender: sender)
    }

    override func paste(_ sender: Any?) { typed += UIPasteboard.general.string ?? "" }
}
#endif
