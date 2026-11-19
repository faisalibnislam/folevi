// Folevi for iPhone's native look (the owner, 2026-11-19): native iOS chrome, Folevi content, as the Mac's
// (docs/MAC_NATIVE_LOOK.md). The system tab bar and navigation bars in Liquid Glass, the system font (SF Pro) for
// interface text at Apple's text sizes with Dynamic Type, native menus, sheets, fields, switches and segmented
// pickers, and Folevi's black and white accent. Notes, note cards and the editor keep Instrument Sans and Spectral
// (cards reset the chrome for what they draw, `noteContent()`).
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public enum PhoneNativeLook {
    #if canImport(UIKit)
    /// Folevi's accent (`.ui-neutral-chrome`): #1F1F22 light, #F2F2F3 dark.
    public static let accentColor = UIColor { t in
        t.userInterfaceStyle == .dark ? UIColor(red: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF3 / 255, alpha: 1)
            : UIColor(red: 0x1F / 255, green: 0x1F / 255, blue: 0x22 / 255, alpha: 1)
    }

    /// Ink on the accent: #FFFFFF light, #101011 dark.
    public static let onAccentColor = UIColor { t in
        t.userInterfaceStyle == .dark ? UIColor(red: 0x10 / 255, green: 0x10 / 255, blue: 0x11 / 255, alpha: 1) : .white
    }

    public static let accent = Color(uiColor: accentColor)
    public static let onAccent = Color(uiColor: onAccentColor)
    #else
    public static let accent = Color.primary
    public static let onAccent = Color.white
    #endif

    /// What the shared web components draw natively on the iPhone: interface text at Apple's sizes with Dynamic Type
    /// (Large Title 34, Title 28, Title 3 20, Body 17, Footnote 13 as the fixed fallbacks), the accent for the one
    /// prominent action.
    public static let chrome = NativeChrome(title: 28, title3: 20, body: 17, small: 13, accent: accent, onAccent: onAccent,
                                            hover: Color.primary.opacity(0.08), dynamicType: true)

    /// How much of the web's drawn shadows (a note card's lift) the native look keeps: half, as the Mac (the
    /// owner, 2026-11-18: "less shadows").
    public static let webShadowScale = 0.5
}

public extension View {
    /// The iPhone's native look for everything inside: the chrome, the accent as the tint, the lighter shadows.
    func phoneNativeChrome(menus: PhoneMenus? = nil) -> some View {
        environment(\.nativeChrome, PhoneNativeLook.chrome)
            .environment(\.phoneMenus, menus)
            .environment(\.nativeShadowScale, PhoneNativeLook.webShadowScale)
            .tint(PhoneNativeLook.accent)
            // Every plain switch in the switch's own colour: the accent can't fill it in dark mode (FoleviSwitchTint).
            .toggleStyle(NativeSwitchStyle())
    }
}

public extension EnvironmentValues {
    /// Set inside a system toolbar (PhoneScreen's bar): the glass controls drawn there leave the glass to the bar,
    /// which gives every item its own Liquid Glass capsule.
    @Entry var phoneInSystemBar = false
    /// The frame's menus, set by the native look: long presses and bar buttons show iOS's own menus holding the
    /// rows their menu-building code gives (`PhoneMenus.entries`). Nil: Folevi's drawn menus, from where they sit.
    @Entry var phoneMenus: PhoneMenus? = nil
    /// The colour of the screen behind the bar, set by PhoneScreen for its root bar's account button, whose badge
    /// is ringed in it. Nil: the grouped grey.
    @Entry var phoneScreenSurface: Color? = nil
    /// The tab's first screen's Create and Foli AI buttons, set by the frame for that screen only (PhoneScreen draws
    /// them in its bar). Nil: none.
    @Entry var phoneRootCreate: PhoneRootCreate? = nil
}

/// What a tab's first screen offers in its bar besides the bell and More (the owner, 2026-11-19): + for the Create
/// menu, New note, From template and Quick task, no New folder (on Tasks a quick task straight away), and Foli AI's flower when Foli AI is on. They were a bar of their own
/// over the tab bar, Ask Foli AI as wide as the screen; up here Foli AI is there without being the screen's focus.
public struct PhoneRootCreate {
    public var aiOn: Bool
    /// Tasks: + adds a quick task, with no menu.
    public var quickTaskOnly: Bool
    public var openAI: @MainActor () -> Void
    public var newNote: @MainActor () -> Void
    public var fromTemplate: @MainActor () -> Void
    public var quickTask: @MainActor () -> Void

    public init(aiOn: Bool, quickTaskOnly: Bool, openAI: @escaping @MainActor () -> Void, newNote: @escaping @MainActor () -> Void,
                fromTemplate: @escaping @MainActor () -> Void, quickTask: @escaping @MainActor () -> Void) {
        self.aiOn = aiOn
        self.quickTaskOnly = quickTaskOnly
        self.openAI = openAI
        self.newNote = newNote
        self.fromTemplate = fromTemplate
        self.quickTask = quickTask
    }
}

#if os(iOS)
/// The flower and +, in one of the bar's glass capsules.
public struct PhoneRootCreateButtons: View {
    let create: PhoneRootCreate

    public init(_ create: PhoneRootCreate) { self.create = create }

    public var body: some View {
        HStack(spacing: 6) {
            if create.aiOn {
                Button(action: create.openAI) { AiMarkGlyph(size: 21).frame(width: 30, height: 30) }
                    .buttonStyle(.plain)
                    .sheetZoomSource("ai")
                    .accessibilityLabel("Foli AI")
                    .accessibilityIdentifier("root-ai")
            }
            if create.quickTaskOnly {
                Button(action: create.quickTask) { plus }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Quick task")
                    .accessibilityIdentifier("root-create")
            } else {
                Menu {
                    Button(action: create.newNote) { Label { Text("New note") } icon: { WebIcon.filePlusCorner.image() } }
                    Button(action: create.fromTemplate) { Label { Text("From template") } icon: { WebIcon.layoutTemplate.image() } }
                    Button(action: create.quickTask) { Label { Text("Quick task") } icon: { WebIcon.listPlus.image() } }
                } label: {
                    plus
                }
                .accessibilityLabel("Create")
                .accessibilityIdentifier("root-create")
            }
        }
    }

    private var plus: some View {
        WebIconView(.plus, size: 22, strokeWidth: 2.1)
            .foregroundStyle(.primary)
            .frame(width: 30, height: 30)
            .contentShape(Rectangle())
    }
}
#endif
