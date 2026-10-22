// Quick Add's shortcut from any app (⌥Space by default, docs/MAC_POLISH_PLAN.md §3.8): Carbon's
// RegisterEventHotKey, which needs no Accessibility permission (Electron's globalShortcut did the same). Paused
// while Settings records a new shortcut (foleviDesktop.pauseShortcut).
import AppKit
import Carbon.HIToolbox

@MainActor
final class HotKey {
    static let shared = HotKey()

    /// What the shortcut does (QuickAddPanel's toggle).
    var action: (() -> Void)?

    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private(set) var registered: String?
    private var paused = false

    /// The accelerator as Carbon's key code and modifiers, or nil when it isn't one ("Alt+Space" → kVK_Space, optionKey).
    nonisolated static func parse(_ accelerator: String) -> (keyCode: UInt32, modifiers: UInt32)? {
        guard !accelerator.isEmpty, DesktopSettings.isValidShortcut(accelerator) else { return nil }
        var parts = accelerator.components(separatedBy: "+")
        guard let key = parts.popLast(), let code = keyCodes[key] else { return nil }
        var mods: UInt32 = 0
        for m in parts {
            switch m {
            case "Command", "Cmd", "CommandOrControl", "CmdOrCtrl", "Super", "Meta": mods |= UInt32(cmdKey)
            case "Control", "Ctrl": mods |= UInt32(controlKey)
            case "Alt", "Option": mods |= UInt32(optionKey)
            case "Shift": mods |= UInt32(shiftKey)
            default: return nil
            }
        }
        return (UInt32(code), mods)
    }

    /// Registers `accelerator` (replacing the one before). Nil on success, else the message Settings shows.
    @discardableResult
    func register(_ accelerator: String) -> String? {
        unregister()
        registered = nil
        guard !accelerator.isEmpty else { return nil }
        guard let (code, mods) = Self.parse(accelerator) else { return "Folevi can't use that shortcut. Choose a different one." }
        installHandler()
        var newRef: EventHotKeyRef?
        let id = EventHotKeyID(signature: OSType(0x464F_4C56) /* "FOLV" */, id: 1)
        let status = RegisterEventHotKey(code, mods, id, GetApplicationEventTarget(), 0, &newRef)
        guard status == noErr, let newRef else { return "Another app is already using this shortcut. Choose a different one." }
        ref = newRef
        registered = accelerator
        return nil
    }

    func unregister() {
        if let ref { UnregisterEventHotKey(ref) }
        ref = nil
    }

    /// Settings is recording a new shortcut: the current one stays quiet until it's done.
    func pause(_ on: Bool) {
        guard on != paused else { return }
        paused = on
        if on {
            let keep = registered
            unregister()
            registered = keep
        } else if let keep = registered {
            register(keep)
        }
    }

    private func installHandler() {
        guard handler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ -> OSStatus in
            DispatchQueue.main.async { MainActor.assumeIsolated { HotKey.shared.action?() } }
            return noErr
        }, 1, &spec, nil, &handler)
    }

    /// Electron accelerator key names to macOS virtual key codes (Carbon's kVK_*).
    nonisolated static let keyCodes: [String: Int] = {
        var m: [String: Int] = [
            "A": kVK_ANSI_A, "B": kVK_ANSI_B, "C": kVK_ANSI_C, "D": kVK_ANSI_D, "E": kVK_ANSI_E, "F": kVK_ANSI_F, "G": kVK_ANSI_G,
            "H": kVK_ANSI_H, "I": kVK_ANSI_I, "J": kVK_ANSI_J, "K": kVK_ANSI_K, "L": kVK_ANSI_L, "M": kVK_ANSI_M, "N": kVK_ANSI_N,
            "O": kVK_ANSI_O, "P": kVK_ANSI_P, "Q": kVK_ANSI_Q, "R": kVK_ANSI_R, "S": kVK_ANSI_S, "T": kVK_ANSI_T, "U": kVK_ANSI_U,
            "V": kVK_ANSI_V, "W": kVK_ANSI_W, "X": kVK_ANSI_X, "Y": kVK_ANSI_Y, "Z": kVK_ANSI_Z,
            "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6,
            "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
            "Space": kVK_Space, "Tab": kVK_Tab, "Enter": kVK_Return, "Return": kVK_Return, "Backspace": kVK_Delete, "Delete": kVK_ForwardDelete,
            "Up": kVK_UpArrow, "Down": kVK_DownArrow, "Left": kVK_LeftArrow, "Right": kVK_RightArrow, "Home": kVK_Home, "End": kVK_End,
            "PageUp": kVK_PageUp, "PageDown": kVK_PageDown, "Escape": kVK_Escape, "Plus": kVK_ANSI_Equal,
            "`": kVK_ANSI_Grave, "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal, "[": kVK_ANSI_LeftBracket, "]": kVK_ANSI_RightBracket,
            "\\": kVK_ANSI_Backslash, ";": kVK_ANSI_Semicolon, "'": kVK_ANSI_Quote, ",": kVK_ANSI_Comma, ".": kVK_ANSI_Period, "/": kVK_ANSI_Slash,
        ]
        let f = [kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6, kVK_F7, kVK_F8, kVK_F9, kVK_F10, kVK_F11, kVK_F12, kVK_F13, kVK_F14, kVK_F15, kVK_F16, kVK_F17, kVK_F18, kVK_F19, kVK_F20]
        for (i, code) in f.enumerated() { m["F\(i + 1)"] = code }
        return m
    }()
}
