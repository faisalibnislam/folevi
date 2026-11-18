// Settings' pieces in the Mac's native look (docs/MAC_NATIVE_LOOK.md, 2026-11-18). The Settings window sets
// `settingsNative`, and SettingsKit's pieces (the card, text, switch, pop-up, field, buttons, terms, dialogs) then
// draw as stock macOS controls in the system font, with the MacLook metrics and colours; without it they draw as
// the web's (the iPad's wide layout, and the Mac's other callers of SettingsSwitch and SettingsSelect, keep that).
// The wrappers here (SButton, SIconButton, SSpinner, SIcon, sFont) are what the sections use in place of the web
// components, so one section's code draws both ways.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
#if os(macOS)
import AppKit
#endif

private struct NativeKey: EnvironmentKey {
    static let defaultValue = false
}

private struct HighlightKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    /// Settings draws in the Mac's native look (the Settings window). Never set on the iPad.
    var settingsNative: Bool {
        get { self[NativeKey.self] }
        set { self[NativeKey.self] = newValue }
    }

    /// The anchor of the card or row Settings' search went to: it shows a highlight for a moment.
    var settingsHighlight: String? {
        get { self[HighlightKey.self] }
        set { self[HighlightKey.self] = newValue }
    }
}

/// Where Settings' search can scroll to: a card by its title (or its own anchor), a switch row by its label.
enum SettingsAnchor {
    static func card(_ name: String) -> String { "card:\(name)" }
    static func row(_ name: String) -> String { "row:\(name)" }
}

/// `<Button>` in Settings: the web's button, or a native push button in the Settings window (primary is the
/// accent's prominent button, danger a destructive one, quiet a borderless one; `.sm` a small control).
struct SButton: View {
    let title: String
    var icon: WebIcon?
    var iconSize: CGFloat = 15
    var variant: WebButtonVariant = .secondary
    var size: WebButtonSize = .md
    let action: () -> Void
    @Environment(\.settingsNative) private var native

    init(_ title: String, icon: WebIcon? = nil, iconSize: CGFloat = 15, variant: WebButtonVariant = .secondary, size: WebButtonSize = .md, action: @escaping () -> Void = {}) {
        self.title = title
        self.icon = icon
        self.iconSize = iconSize
        self.variant = variant
        self.size = size
        self.action = action
    }

    var body: some View {
        #if os(macOS)
        if native {
            NativeSettingsButton(title: title, symbol: icon.flatMap(SIcon.symbol), variant: variant, small: size == .sm, action: action)
        } else {
            WebButton(title, icon: icon, iconSize: iconSize, variant: variant, size: size, action: action)
        }
        #else
        WebButton(title, icon: icon, iconSize: iconSize, variant: variant, size: size, action: action)
        #endif
    }
}

/// `<IconButton>` in Settings: the web's, or a borderless symbol button with its tooltip in the Settings window.
struct SIconButton: View {
    let icon: WebIcon
    let label: String
    let action: () -> Void
    @Environment(\.settingsNative) private var native

    init(_ icon: WebIcon, label: String, action: @escaping () -> Void) {
        self.icon = icon
        self.label = label
        self.action = action
    }

    var body: some View {
        #if os(macOS)
        if native {
            Button(action: action) {
                // (Folevi's own icon, as the web's Settings: the owner, 2026-11-18.)
                WebIconView(icon, size: 16)
                    .frame(width: MacLook.iconButton, height: MacLook.compactControlHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(QuietHoverStyle(shape: AnyShape(RoundedRectangle(cornerRadius: 6, style: .continuous))))
            .foregroundStyle(MacLook.Colors.secondary)
            .foleviTooltip(label)
            .accessibilityLabel(label)
        } else {
            WebIconButton(icon, label: label, action: action)
        }
        #else
        WebIconButton(icon, label: label, action: action)
        #endif
    }
}

/// A spinner: the web's arc, or the system's small progress indicator.
struct SSpinner: View {
    var size: CGFloat = 14
    @Environment(\.settingsNative) private var native

    var body: some View {
        #if os(macOS)
        if native { ProgressView().controlSize(.small) } else { WebSpinner(size: size) }
        #else
        WebSpinner(size: size)
        #endif
    }
}

/// A Folevi line icon (in the Settings window, sized to the rows' icon column).
struct SIcon: View {
    let icon: WebIcon
    var size: CGFloat = 16
    @Environment(\.settingsNative) private var native

    init(_ icon: WebIcon, size: CGFloat = 16) {
        self.icon = icon
        self.size = size
    }

    var body: some View {
        #if os(macOS)
        if native {
            // (Folevi's own icon in the rows' icon column: the Mac's icons are the web's.)
            WebIconView(icon, size: 17).frame(width: MacLook.rowIconSlot)
        } else {
            WebIconView(icon, size: size)
        }
        #else
        WebIconView(icon, size: size)
        #endif
    }

    /// The SF Symbol standing for a Folevi icon Settings draws.
    static func symbol(_ icon: WebIcon) -> String? {
        switch icon {
        case .smartphone: "iphone"
        case .laptop: "laptopcomputer"
        case .triangleAlert: "exclamationmark.triangle"
        case .cloudDownload: "icloud.and.arrow.down"
        case .hourglass: "hourglass"
        case .keyRound: "key"
        case .check: "checkmark"
        case .cloud: "icloud"
        case .folder: "folder"
        case .hardDrive: "externaldrive"
        case .shieldAlert: "exclamationmark.shield"
        case .sun: "sun.max"
        case .moon: "moon"
        case .monitor: "desktopcomputer"
        case .refreshCw: "arrow.clockwise"
        case .upload: "square.and.arrow.up"
        case .folderUp: "folder.badge.plus"
        case .copy: "doc.on.doc"
        case .externalLink: "arrow.up.right.square"
        case .x: "xmark"
        case .pencil: "pencil"
        case .trash: "trash"
        default: nil
        }
    }
}

extension View {
    /// A web text style, or a system font in the Settings window.
    func sFont(_ web: WebTextStyle, _ mac: Font) -> some View { modifier(SettingsFont(web: web, mac: mac)) }

    /// A path or a key in the web's mono type, or the system's monospaced small type in the Settings window.
    func sMono() -> some View { modifier(SettingsMono()) }
}

private struct SettingsMono: ViewModifier {
    @Environment(\.settingsNative) private var native
    func body(content: Content) -> some View {
        content.font(native ? Font.subheadline.monospaced() : WebFont.font(.mono, size: 12))
    }
}

/// A checkbox with its words: the web's, or the system's checkbox in the Settings window.
struct SCheckbox: View {
    let label: String
    @Binding var isOn: Bool
    @Environment(\.settingsNative) private var native

    init(_ label: String, isOn: Binding<Bool>) {
        self.label = label
        _isOn = isOn
    }

    var body: some View {
        #if os(macOS)
        if native {
            Toggle(label, isOn: $isOn).toggleStyle(.checkbox).font(MacLook.Text.body).tint(MacLook.Colors.accent)
        } else {
            Toggle(label, isOn: $isOn).toggleStyle(WebCheckboxStyle()).webText(.role(.body))
        }
        #else
        Toggle(label, isOn: $isOn).toggleStyle(WebCheckboxStyle()).webText(.role(.body))
        #endif
    }
}

private struct SettingsFont: ViewModifier {
    let web: WebTextStyle
    let mac: Font
    @Environment(\.settingsNative) private var native

    func body(content: Content) -> some View {
        #if os(macOS)
        if native { content.font(mac) } else { content.webText(web) }
        #else
        content.webText(web)
        #endif
    }
}

#if os(macOS)
/// The Settings window's metrics on top of MacLook's (the window, its category list, the readable column).
enum MacSettingsLook {
    /// The category list's width: the longest category name, its symbol and the row insets, with room to spare.
    static let sidebarWidth: CGFloat = 220
    /// The settings column's widest (it centres in a wider window; the title aligns with it).
    static let contentMaxWidth: CGFloat = 640
    /// The column's least margin from the pane's edges.
    static let contentMargin: CGFloat = MacLook.Space.xl
    /// The gap between groups on a page.
    static let groupGap: CGFloat = MacLook.Space.xl + MacLook.Space.xs
    /// The window's first size, and the smallest it can be (the column and the list both still read whole).
    static let defaultSize = CGSize(width: 880, height: 640)
    static let minSize = CGSize(width: 660, height: 460)
    /// A term's column in a list of terms and values.
    static let termWidth: CGFloat = 132
    /// The least room over the content for the traffic lights (a plain title bar's).
    static let minChromeTop: CGFloat = 28
    /// How long a found card or row stays highlighted.
    static let highlightSeconds: Double = 2.2
}

/// A settings text style's role in the native look: its font and colour.
enum SettingsNativeText {
    static func font(_ style: String, weight: CGFloat?) -> Font {
        let base: Font
        switch style {
        case "heading": base = MacLook.Text.title3Strong
        case "card.title", "empty.title": base = MacLook.Text.headline
        case "row.hint", "muted", "card.description", "hint", "device.sub", "device.when", "device.here", "key.status", "model.status",
             "created", "shortcut.hint", "ai.text", "ai.more", "empty.text", "progress", "can", "toggle.text":
            base = MacLook.Text.small
        default: base = MacLook.Text.body
        }
        guard let weight else { return base }
        return base.weight(weight >= 600 ? .semibold : weight >= 500 ? .medium : .regular)
    }

    static func color(_ style: String) -> Color {
        switch style {
        case "row.hint", "muted", "card.description", "hint", "device.sub", "device.when", "device.here", "key.status", "model.status",
             "created", "shortcut.hint", "ai.text", "ai.more", "empty.text", "progress", "can", "toggle.text", "dt":
            MacLook.Colors.secondary
        default: MacLook.Colors.label
        }
    }
}

/// A card or row Settings' search went to: a soft accent wash and ring for a moment.
struct SettingsFoundHighlight: ViewModifier {
    let anchor: String
    var radius: CGFloat = 10
    var outset: CGFloat = 4
    @Environment(\.settingsHighlight) private var highlight
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let on = highlight == anchor
        content
            .background {
                RoundedRectangle(cornerRadius: radius + outset, style: .continuous)
                    .fill(MacLook.Colors.accent.opacity(on ? 0.07 : 0))
                    .padding(-outset)
            }
            .overlay {
                RoundedRectangle(cornerRadius: radius + outset, style: .continuous)
                    .strokeBorder(MacLook.Colors.accent.opacity(on ? 0.55 : 0), lineWidth: 1.5)
                    .padding(-outset)
                    .allowsHitTesting(false)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.35), value: on)
            .id(anchor)
    }
}

/// A Settings group in the native look, laid out as System Settings lays one out (the owner, 2026-11-18: "redo
/// the settings page"): the group's name as a 13 pt semibold heading, what it is for in small secondary words
/// under the name, and then one rounded surface that holds only the group's rows and controls. The explanation
/// used to sit inside the surface, over the controls, which made every group a wall of grey text.
struct NativeSettingsCard<Content: View>: View {
    let title: String
    let description: String?
    let anchor: String
    let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(MacLook.Text.headline).foregroundStyle(MacLook.Colors.label)
                .padding(.horizontal, MacLook.Space.xs)
                .accessibilityAddTraits(.isHeader)
            if let description {
                Text(description).font(MacLook.Text.small).foregroundStyle(MacLook.Colors.secondary)
                    .lineSpacing(1)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 520, alignment: .leading)
                    .padding(.horizontal, MacLook.Space.xs)
                    .padding(.top, 3)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, MacLook.Space.m)
                .padding(.vertical, MacLook.Space.s + 2)
                .background(MacLook.Colors.hover.opacity(0.35), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(MacLook.Colors.separator.opacity(0.5)))
                .padding(.top, MacLook.Space.s)
        }
        .modifier(SettingsFoundHighlight(anchor: SettingsAnchor.card(anchor), radius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}

/// A native push button for Settings: bordered; the accent's prominent one for the primary action; red words for a
/// destructive one; borderless for a quiet one.
struct NativeSettingsButton: View {
    let title: String
    let symbol: String?
    let variant: WebButtonVariant
    let small: Bool
    let action: () -> Void

    var body: some View {
        let button = Button(role: variant == .danger ? .destructive : nil, action: action) {
            if let symbol { Label(title, systemImage: symbol) } else { Text(title) }
        }
        // (One size and shape for every push button, as the card's screens: the system's large, a capsule. A
        // "small" one is the compact size, never the system's small.)
        .controlSize(small ? .regular : MacLook.controlSize)
        .buttonBorderShape(.capsule)
        .fixedSize()
        switch variant {
        case .primary:
            // (Not .borderedProminent: its white words would vanish on the near-white accent in dark mode.)
            button.buttonStyle(NativeAccentButtonStyle(small: small))
        case .danger:
            button.buttonStyle(.bordered).foregroundStyle(MacLook.Colors.red)
        case .quiet:
            button.buttonStyle(.borderless)
        case .secondary, .ghost:
            button.buttonStyle(.bordered)
        }
    }
}

/// The one prominent action: a push button's shape and size filled with Folevi's accent, its words in the ink on
/// the accent (#1F1F22 with white in light, #F2F2F3 with near-black in dark), active or not.
struct NativeAccentButtonStyle: ButtonStyle {
    let small: Bool
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(MacLook.Text.body)
            .foregroundStyle(MacLook.Colors.onAccent)
            .lineLimit(1)
            .padding(.horizontal, small ? MacLook.Space.m : 14)
            .frame(minHeight: small ? MacLook.compactControlHeight : MacLook.controlHeight)
            .background(MacLook.Colors.accent, in: Capsule())
            .opacity(enabled ? (configuration.isPressed ? 0.82 : 1) : 0.4)
            .contentShape(Capsule())
    }
}

/// A native switch for Settings: the small system switch in Folevi's accent.
struct NativeSettingsSwitch: View {
    let isOn: Binding<Bool>
    let label: String
    var body: some View {
        Toggle(label, isOn: isOn)
            .toggleStyle(.switch)
            .controlSize(.small)
            .labelsHidden()
            .tint(MacLook.Colors.accent)
            .accessibilityLabel(label)
    }
}
#endif
#endif
