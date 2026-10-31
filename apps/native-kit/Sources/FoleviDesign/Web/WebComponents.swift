// The web app's components drawn natively from its computed styles (Generated/WebStyles.swift): Button and
// IconButton (components/ui/Button.tsx), the Select trigger, text inputs (.ui-input), menus (ui/Menu.tsx),
// dialogs (ui/Dialog.tsx), cards (.ui-card), chips and key caps. Each is a sample of the screenshot diffs.
import SwiftUI

public enum WebButtonVariant: String, Sendable, CaseIterable {
    case primary, secondary, ghost, quiet, danger
}

public enum WebButtonSize: String, Sendable {
    case sm, md
}

/// `<Button variant size>`: a label, with an optional leading icon.
public struct WebButton: View {
    let title: String
    let icon: WebIcon?
    let variant: WebButtonVariant
    let size: WebButtonSize
    let iconSize: CGFloat
    let iconOpacity: CGFloat
    let styleName: String?
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled

    /// `iconSize`: the icon's size where the web gives it one (`<Upload size={14} />`); 15 otherwise.
    /// `styleName`: the button's own measured style where it has one (the top bar's New note), and `iconOpacity`
    /// its icon's.
    public init(_ title: String, icon: WebIcon? = nil, iconSize: CGFloat = 15, iconOpacity: CGFloat = 1, styleName: String? = nil, variant: WebButtonVariant = .secondary, size: WebButtonSize = .md, action: @escaping () -> Void = {}) {
        self.title = title
        self.icon = icon
        self.iconSize = iconSize
        self.iconOpacity = iconOpacity
        self.styleName = styleName
        self.variant = variant
        self.size = size
        self.action = action
    }

    public var body: some View {
        let style = WebStyles.named(styleName ?? "button.\(variant.rawValue).\(size == .sm && icon != nil ? "sm" : size.rawValue)")
        Button(action: action) {
            WebButtonLabel(title: title, icon: icon, style: style, iconSize: iconSize, iconOpacity: iconOpacity)
        }
        .buttonStyle(WebPressStyle())
        // (CSS opacity fades the button as one picture, not its fill and label each.)
        .compositingGroup()
        .opacity(enabled ? 1 : Self.disabledOpacity)
    }

    /// `.ui-btn:disabled`: 0.5, and 0.4 on the Mac (`[data-desktop="mac"]`).
    static var disabledOpacity: CGFloat {
        #if os(macOS)
        0.4
        #else
        0.5
        #endif
    }
}

struct WebButtonLabel: View {
    let title: String
    let icon: WebIcon?
    let style: WebStylePair
    var iconSize: CGFloat = 15
    var iconOpacity: CGFloat = 1
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = style.resolve(scheme)
        HStack(spacing: s.gap) {
            if let icon {
                WebIconView(icon, size: iconSize).opacity(iconOpacity)
            }
            Text(title).webText(s.text).lineLimit(1).fixedSize()
        }
        .webElement(style)
    }
}

/// `<IconButton>`: a 28 pt square (on the Mac) with one icon; `pressed` is `aria-pressed`.
public struct WebIconButton: View {
    let icon: WebIcon
    let label: String
    let pressed: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(_ icon: WebIcon, label: String, pressed: Bool = false, action: @escaping () -> Void = {}) {
        self.icon = icon
        self.label = label
        self.pressed = pressed
        self.action = action
    }

    public var body: some View {
        let style = WebStyles.named(pressed ? "button.quiet.icon.pressed" : "button.quiet.icon")
        let s = style.resolve(scheme)
        Button(action: action) {
            WebIconView(icon, size: 16)
                .frame(width: s.width, height: s.height)
                .foregroundStyle(s.color.color)
                .webBox(style)
        }
        .buttonStyle(WebPressStyle())
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }
}

/// No system highlight: the web shows its own hover and press states.
struct WebPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Rectangle())
    }
}

/// The Select trigger (ui/Select.tsx) in an input well: the chosen label and a chevron.
public struct WebSelectTrigger: View {
    let label: String
    let minWidth: CGFloat
    @Environment(\.colorScheme) private var scheme

    public init(_ label: String, minWidth: CGFloat = 160) {
        self.label = label
        self.minWidth = minWidth
    }

    public var body: some View {
        let style = WebStyles.named("select.trigger")
        let s = style.resolve(scheme)
        let chevron = WebStyles.named("select.trigger.chevron").resolve(scheme)
        HStack(spacing: s.gap) {
            Text(label).webText(s.text).lineLimit(1)
            Spacer(minLength: 0)
            WebIconView(.chevronDown, size: 14).opacity(chevron.opacity)
        }
        .padding(s.padding.edgeInsets)
        .frame(minWidth: minWidth, maxWidth: minWidth > 0 ? minWidth : nil)
        .frame(height: s.height)
        .foregroundStyle(s.color.color)
        .webBox(style)
    }
}

extension EnvironmentValues {
    /// Drawn into a picture (ImageRenderer, the iOS screenshot diffs): no UIKit views, which a picture can't hold.
    /// Text fields are drawn as their text, glass without its live blur.
    @Entry public var webSnapshot = false
}

/// A one-line text field drawn as `.ui-input`.
public struct WebTextField: View {
    @Binding var text: String
    let placeholder: String
    let width: CGFloat?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.webSnapshot) private var asText

    public init(_ placeholder: String = "", text: Binding<String>, width: CGFloat? = nil) {
        self.placeholder = placeholder
        _text = text
        self.width = width
    }

    public var body: some View {
        let style = WebStyles.named("input")
        let s = style.resolve(scheme)
        Group {
            if asText {
                Text(text.isEmpty ? placeholder : text).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField(placeholder, text: $text).textFieldStyle(.plain)
            }
        }
            .webText(s.text)
            .lineLimit(1)
            #if os(macOS)
            // AppKit's field editor sets its text 1.125 pt right of and 1 pt above where CSS puts an input's
            // text (measured by the screenshot diffs, components-controls); this puts it back.
            .offset(x: asText ? 0 : -1.125, y: asText ? 0 : 1.035)
            #endif
            .padding(s.padding.edgeInsets)
            .frame(width: width, height: s.height)
            .foregroundStyle(s.color.color)
            .webBox(style)
    }
}

/// One row of a Folevi menu.
public struct WebMenuItem: Identifiable, Sendable {
    public enum Kind: Sendable { case item, heading, separator }
    public var id: String
    public var kind: Kind
    public var title: String
    public var icon: WebIcon?
    public var shortcut: String?
    public var danger: Bool
    public var checked: Bool

    public static func item(_ title: String, icon: WebIcon? = nil, shortcut: String? = nil, danger: Bool = false, checked: Bool = false, id: String? = nil) -> WebMenuItem {
        WebMenuItem(id: id ?? title, kind: .item, title: title, icon: icon, shortcut: shortcut, danger: danger, checked: checked)
    }

    public static func heading(_ title: String) -> WebMenuItem {
        WebMenuItem(id: "h:\(title)", kind: .heading, title: title, icon: nil, shortcut: nil, danger: false, checked: false)
    }

    public static func separator(_ n: Int = 0) -> WebMenuItem {
        WebMenuItem(id: "sep:\(n)", kind: .separator, title: "", icon: nil, shortcut: nil, danger: false, checked: false)
    }
}

/// A Folevi menu's panel (ui/Menu.tsx on the Mac): headings, rows with icon, label and shortcut, separators.
/// `highlighted` is the row under the pointer or keyboard. On iPhone and iPad it's drawn as the web draws its menus
/// there (globals.css, the iOS menu rules): at least 250 wide, the icon after the label, hairlines between rows,
/// headings as written rather than in capitals.
public struct WebMenuPanel: View {
    let items: [WebMenuItem]
    let width: CGFloat
    let highlighted: String?
    let onSelect: (WebMenuItem) -> Void
    @Environment(\.colorScheme) private var scheme

    public init(_ items: [WebMenuItem], width: CGFloat = 224, highlighted: String? = nil, onSelect: @escaping (WebMenuItem) -> Void = { _ in }) {
        self.items = items
        self.width = width
        self.highlighted = highlighted
        self.onSelect = onSelect
    }

    public var body: some View {
        let panel = WebStyles.named("menu.panel")
        let p = panel.resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(items) { item in
                row(item)
            }
        }
        .padding(p.padding.edgeInsets)
        .frame(width: Self.ios ? max(width, 250) : width, alignment: .topLeading)
        .webBox(panel)
    }

    private static var ios: Bool {
        #if os(iOS)
        true
        #else
        false
        #endif
    }

    /// Whether any item is checked (the web draws the check column for the whole menu then).
    private var hasChecks: Bool { items.contains { $0.checked } }

    /// `--iphone-separator`, the hairline between a section's rows on iOS.
    private var hairline: Color {
        (scheme == .dark ? RGBA(84, 84, 88, 0.5) : RGBA(60, 60, 67, 0.16)).color
    }

    /// Whether the row before this one is also an item (the web's `.ui-menu-item + .ui-menu-item`).
    private func followsItem(_ item: WebMenuItem) -> Bool {
        guard let i = items.firstIndex(where: { $0.id == item.id }), i > 0 else { return false }
        return items[i - 1].kind == .item
    }

    @ViewBuilder
    private func row(_ item: WebMenuItem) -> some View {
        switch item.kind {
        case .heading:
            let h = WebStyles.named("menu.heading").resolve(scheme)
            Text(Self.ios ? item.title : item.title.uppercased())
                .webText(h.text)
                .lineLimit(1)
                .foregroundStyle(h.color.color)
                .padding(h.padding.edgeInsets)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .separator:
            let sep = WebStyles.named("menu.separator").resolve(scheme)
            Rectangle().fill(sep.background.color)
                .frame(height: sep.height)
                .padding(sep.margin.edgeInsets)
        case .item:
            let styleId = item.danger ? "menu.item.danger" : highlighted == item.id ? "menu.item.highlighted" : "menu.item"
            let style = WebStyles.named(styleId)
            let s = style.resolve(scheme)
            let icon = WebStyles.named("menu.item.icon").resolve(scheme)
            let shortcut = WebStyles.named("menu.item.shortcut").resolve(scheme)
            Button { onSelect(item) } label: {
                HStack(spacing: s.gap) {
                    // iOS: a menu with checks gives every item a 16 pt column before its words (globals.css
                    // `[data-menu-part="check"]`: order -1, 2 pt pulled in), the tick in the ink when chosen.
                    if Self.ios, hasChecks {
                        ZStack {
                            if item.checked {
                                WebIconView(.check, size: 16, strokeWidth: 2.6)
                                    .foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
                            }
                        }
                        .frame(width: 16)
                        .padding(.trailing, -2)
                    }
                    if let i = item.icon, !Self.ios {
                        WebIconView(i, size: 15)
                            .frame(width: icon.width, height: icon.height)
                            .foregroundStyle(item.danger ? s.color.color : icon.color.color)
                    }
                    Text(item.title).webText(s.text).lineLimit(1)
                    Spacer(minLength: 0)
                    if let k = item.shortcut {
                        Text(k).webText(shortcut.text).lineLimit(1).foregroundStyle(shortcut.color.color).padding(.leading, shortcut.padding.left)
                    }
                    // iOS: the icon last (`order: 5`), 20 pt with a 1.9 stroke in a 22 pt column, in the row's ink.
                    if let i = item.icon, Self.ios {
                        WebIconView(i, size: 20, strokeWidth: 1.9)
                            .frame(width: 22, height: icon.height)
                    }
                }
                .padding(s.padding.edgeInsets)
                .frame(maxWidth: .infinity, minHeight: s.height, maxHeight: s.height, alignment: .leading)
                .foregroundStyle(s.color.color)
                .webBox(style)
                .overlay(alignment: .top) {
                    if Self.ios, followsItem(item) {
                        Rectangle().fill(hairline).frame(height: 0.5)
                    }
                }
            }
            .buttonStyle(WebPressStyle())
        }
    }
}

/// A web dialog (ui/Dialog.tsx as the Mac shows it): title, description, body and a footer of buttons.
public struct WebDialog<Body: View, Footer: View>: View {
    let title: String
    let description: String?
    let width: CGFloat?
    let content: Body
    let footer: Footer
    @Environment(\.colorScheme) private var scheme

    public init(_ title: String, description: String? = nil, width: CGFloat? = nil, @ViewBuilder content: () -> Body, @ViewBuilder footer: () -> Footer) {
        self.title = title
        self.description = description
        self.width = width
        self.content = content()
        self.footer = footer()
    }

    public var body: some View {
        let panel = WebStyles.named("dialog.panel")
        let p = panel.resolve(scheme)
        let header = WebStyles.named("dialog.header").resolve(scheme)
        let t = WebStyles.named("dialog.title").resolve(scheme)
        let d = WebStyles.named("dialog.description").resolve(scheme)
        let bodyStyle = WebStyles.named("dialog.body").resolve(scheme)
        let footerStyle = WebStyles.named("dialog.footer")
        let f = footerStyle.resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).webText(t.text).foregroundStyle(t.color.color).lineLimit(1)
                if let description {
                    Text(description).webText(d.text).foregroundStyle(d.color.color).padding(.top, 4)
                }
            }
            .padding(header.padding.edgeInsets)
            .frame(maxWidth: .infinity, alignment: .leading)
            content
                .padding(bodyStyle.padding.edgeInsets)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: f.gap) {
                Spacer(minLength: 0)
                footer
            }
            .padding(f.padding.edgeInsets)
            .frame(maxWidth: .infinity)
            .webBox(footerStyle)
        }
        .frame(width: width ?? p.width)
        .clipShape(RoundedRectangle(cornerRadius: p.radius, style: .circular))
        .webBox(panel)
    }
}

/// `.ui-card` with its padding.
public struct WebCard<Content: View>: View {
    let content: Content
    let width: CGFloat?

    public init(width: CGFloat? = nil, @ViewBuilder content: () -> Content) {
        self.width = width
        self.content = content()
    }

    @Environment(\.colorScheme) private var scheme

    public var body: some View {
        let style = WebStyles.named("card")
        let s = style.resolve(scheme)
        content
            .padding(s.padding.edgeInsets)
            .frame(width: width, alignment: .topLeading)
            .webBox(style)
    }
}

/// `.ui-chip`.
public struct WebChip: View {
    let title: String
    @Environment(\.colorScheme) private var scheme

    public init(_ title: String) { self.title = title }

    public var body: some View {
        let style = WebStyles.named("chip")
        let s = style.resolve(scheme)
        Text(title).webText(s.text).lineLimit(1).fixedSize().webElement(style)
    }
}

/// `.ui-kbd`: a key cap.
public struct WebKbd: View {
    let keys: String
    @Environment(\.colorScheme) private var scheme

    public init(_ keys: String) { self.keys = keys }

    public var body: some View {
        let style = WebStyles.named("kbd")
        let s = style.resolve(scheme)
        Text(keys).webText(s.text).lineLimit(1).fixedSize().webElement(style)
    }
}
