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
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled

    public init(_ title: String, icon: WebIcon? = nil, variant: WebButtonVariant = .secondary, size: WebButtonSize = .md, action: @escaping () -> Void = {}) {
        self.title = title
        self.icon = icon
        self.variant = variant
        self.size = size
        self.action = action
    }

    public var body: some View {
        let style = WebStyles.named("button.\(variant.rawValue).\(size == .sm && icon != nil ? "sm" : size.rawValue)")
        Button(action: action) {
            WebButtonLabel(title: title, icon: icon, style: style)
        }
        .buttonStyle(WebPressStyle())
        .opacity(enabled ? 1 : 0.4)
    }
}

struct WebButtonLabel: View {
    let title: String
    let icon: WebIcon?
    let style: WebStylePair
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = style.resolve(scheme)
        HStack(spacing: s.gap) {
            if let icon {
                WebIconView(icon, size: 15)
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
        .help(label)
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

/// A one-line text field drawn as `.ui-input`.
public struct WebTextField: View {
    @Binding var text: String
    let placeholder: String
    let width: CGFloat?
    @Environment(\.colorScheme) private var scheme

    public init(_ placeholder: String = "", text: Binding<String>, width: CGFloat? = nil) {
        self.placeholder = placeholder
        _text = text
        self.width = width
    }

    public var body: some View {
        let style = WebStyles.named("input")
        let s = style.resolve(scheme)
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .webText(s.text)
            .lineLimit(1)
            // AppKit's field editor sets its text 1.125 pt right of and 1 pt above where CSS puts an input's
            // text (measured by the screenshot diffs, components-controls); this puts it back.
            .offset(x: -1.125, y: 1.035)
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
/// `highlighted` is the row under the pointer or keyboard.
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
        .frame(width: width, alignment: .topLeading)
        .webBox(panel)
    }

    @ViewBuilder
    private func row(_ item: WebMenuItem) -> some View {
        switch item.kind {
        case .heading:
            let h = WebStyles.named("menu.heading").resolve(scheme)
            Text(item.title.uppercased())
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
                    if let i = item.icon {
                        WebIconView(i, size: 15)
                            .frame(width: icon.width, height: icon.height)
                            .foregroundStyle(item.danger ? s.color.color : icon.color.color)
                    }
                    Text(item.title).webText(s.text).lineLimit(1)
                    Spacer(minLength: 0)
                    if let k = item.shortcut {
                        Text(k).webText(shortcut.text).lineLimit(1).foregroundStyle(shortcut.color.color).padding(.leading, shortcut.padding.left)
                    }
                }
                .padding(s.padding.edgeInsets)
                .frame(maxWidth: .infinity, minHeight: s.height, maxHeight: s.height, alignment: .leading)
                .foregroundStyle(s.color.color)
                .webBox(style)
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
