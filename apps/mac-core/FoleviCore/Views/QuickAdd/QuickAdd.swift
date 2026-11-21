// Quick Add (⌥Space from any app, the menu bar extra, the Dock menu): a floating glass panel with one field. A
// task (with its date read from plain words) or a note, into the open place's Inbox, without leaving the app
// you're in. The global shortcut is Carbon's hot key (no Accessibility permission needed).
import AppKit
import Carbon.HIToolbox
import FoleviDesign
import FoleviEngine
import SwiftUI

@MainActor
final class QuickAdd {
    static let shared = QuickAdd()

    private var panel: QuickAddPanel?
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    var paused = false

    func show() {
        if panel == nil {
            let p = QuickAddPanel()
            p.contentView = NSHostingView(rootView: QuickAddView(close: { [weak self] in self?.hide() }).environment(AppModel.shared))
            panel = p
        }
        guard let panel else { return }
        if let screen = NSScreen.main {
            let f = screen.visibleFrame
            panel.setFrameTopLeftPoint(NSPoint(x: f.midX - panel.frame.width / 2, y: f.maxY - f.height * 0.22))
        }
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func hide() { panel?.orderOut(nil) }

    func toggle() { panel?.isVisible == true ? hide() : show() }

    // MARK: the global shortcut

    /// Registers `accelerator` ("Alt+Space"); empty for none.
    func register(_ accelerator: String) {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil
        guard !accelerator.isEmpty, !Paths.testing, let (code, mods) = HotKey.carbon(accelerator) else { return }
        if handler == nil {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
                DispatchQueue.main.async { MainActor.assumeIsolated { if !QuickAdd.shared.paused { QuickAdd.shared.toggle() } } }
                return noErr
            }, 1, &spec, nil, &handler)
        }
        let id = EventHotKeyID(signature: OSType(0x464F4C56), id: 1)
        RegisterEventHotKey(code, mods, id, GetApplicationEventTarget(), 0, &hotKey)
    }
}

final class QuickAddPanel: NSPanel {
    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 560, height: 140), styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel], backing: .buffered, defer: false)
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        isFloatingPanel = true
        level = .floating
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isReleasedWhenClosed = false
        backgroundColor = .clear
        standardWindowButton(.closeButton)?.isHidden = true
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true
    }

    override var canBecomeKey: Bool { true }

    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}

extension HotKey {
    /// "Alt+Space" as Carbon's key code and modifiers.
    static func carbon(_ accelerator: String) -> (UInt32, UInt32)? {
        var parts = accelerator.components(separatedBy: "+")
        guard let key = parts.popLast() else { return nil }
        var mods: UInt32 = 0
        for p in parts {
            switch p {
            case "Command", "Cmd", "CommandOrControl", "CmdOrCtrl", "Super", "Meta": mods |= UInt32(cmdKey)
            case "Control", "Ctrl": mods |= UInt32(controlKey)
            case "Alt", "Option": mods |= UInt32(optionKey)
            case "Shift": mods |= UInt32(shiftKey)
            default: return nil
            }
        }
        guard let code = keyCodes[key] else { return nil }
        return (UInt32(code), mods)
    }

    /// The accelerator a key press makes, or nil (no modifier other than Shift).
    static func accelerator(_ e: NSEvent) -> String? {
        var parts: [String] = []
        let f = e.modifierFlags
        if f.contains(.control) { parts.append("Control") }
        if f.contains(.option) { parts.append("Alt") }
        if f.contains(.shift) { parts.append("Shift") }
        if f.contains(.command) { parts.append("Command") }
        guard let key = keyCodes.first(where: { Int($0.value) == Int(e.keyCode) })?.key else { return nil }
        parts.append(key)
        return parts.joined(separator: "+")
    }

    /// "Alt+Space" as the Mac writes it ("⌥Space").
    static func display(_ accelerator: String) -> String {
        accelerator.components(separatedBy: "+").map { p in
            switch p {
            case "Command", "Cmd", "CommandOrControl", "CmdOrCtrl", "Super", "Meta": "⌘"
            case "Control", "Ctrl": "⌃"
            case "Alt", "Option": "⌥"
            case "Shift": "⇧"
            default: p
            }
        }.joined()
    }

    static let keyCodes: [String: Int] = [
        "A": kVK_ANSI_A, "B": kVK_ANSI_B, "C": kVK_ANSI_C, "D": kVK_ANSI_D, "E": kVK_ANSI_E, "F": kVK_ANSI_F, "G": kVK_ANSI_G,
        "H": kVK_ANSI_H, "I": kVK_ANSI_I, "J": kVK_ANSI_J, "K": kVK_ANSI_K, "L": kVK_ANSI_L, "M": kVK_ANSI_M, "N": kVK_ANSI_N,
        "O": kVK_ANSI_O, "P": kVK_ANSI_P, "Q": kVK_ANSI_Q, "R": kVK_ANSI_R, "S": kVK_ANSI_S, "T": kVK_ANSI_T, "U": kVK_ANSI_U,
        "V": kVK_ANSI_V, "W": kVK_ANSI_W, "X": kVK_ANSI_X, "Y": kVK_ANSI_Y, "Z": kVK_ANSI_Z,
        "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6,
        "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
        "Space": kVK_Space, "Tab": kVK_Tab, "Return": kVK_Return, "Enter": kVK_Return, "Backspace": kVK_Delete, "Delete": kVK_ForwardDelete,
        "Up": kVK_UpArrow, "Down": kVK_DownArrow, "Left": kVK_LeftArrow, "Right": kVK_RightArrow, "Home": kVK_Home, "End": kVK_End,
        "PageUp": kVK_PageUp, "PageDown": kVK_PageDown, "Escape": kVK_Escape,
        "F1": kVK_F1, "F2": kVK_F2, "F3": kVK_F3, "F4": kVK_F4, "F5": kVK_F5, "F6": kVK_F6, "F7": kVK_F7, "F8": kVK_F8, "F9": kVK_F9, "F10": kVK_F10, "F11": kVK_F11, "F12": kVK_F12,
        "`": kVK_ANSI_Grave, "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal, "[": kVK_ANSI_LeftBracket, "]": kVK_ANSI_RightBracket, "\\": kVK_ANSI_Backslash,
        ";": kVK_ANSI_Semicolon, "'": kVK_ANSI_Quote, ",": kVK_ANSI_Comma, ".": kVK_ANSI_Period, "/": kVK_ANSI_Slash,
    ]
}

/// Services > "New Folevi Core Note with Selection": the selected text from any app as a new note.
@MainActor
final class ServicesProvider: NSObject {
    static let shared = ServicesProvider()

    @objc func newNoteWithSelection(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        let text = pasteboard.string(forType: .string) ?? pasteboard.data(forType: .rtf).flatMap { NSAttributedString(rtf: $0, documentAttributes: nil)?.string } ?? ""
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else {
            error.pointee = "There was no text to put in a note." as NSString
            return
        }
        NSApp.activate()
        let app = AppModel.shared
        app.perform { client in
            let r = try await client.command(Commands.NoteCreate(NoteCreateArgs(space: nil, folderId: nil, parentId: nil, title: nil, templateId: nil, open: false, text: String(clean.prefix(1_000_000)))))
            app.open(.note(r.id), newTab: true)
        }
    }
}
