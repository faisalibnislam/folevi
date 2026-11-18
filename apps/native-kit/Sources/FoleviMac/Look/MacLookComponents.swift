// The native look's shared pieces (MacLook.swift has the numbers). One component per role, reused by the frame,
// the Settings window and the screens, so no screen re-creates a toolbar group, a sidebar row or a form row:
//
//   TopBar / BarGroup / BarButtonStyle / BarSearchField   the card's top bar: glass capsules, 36 pt
//   CapsuleTrack                                          a capsule track with a capsule selection (H - 2 * inset)
//   SidebarRow / SidebarHeading                           the compact row scale (13 pt, 14 pt symbol in 18 pt, 28 pt)
//   SidePanel                                             a flat, rounded panel in the card (the inspector)
//   FormGroup / FormRow                                   grouped native settings rows
//   EdgeFade                                              a scroll view's overflow cue, only while content continues
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign

// MARK: - Top bar

/// The card's top bar: the first thing in it, its controls in one glass container.
public struct TopBar<Content: View>: View {
    let content: Content
    public init(@ViewBuilder content: () -> Content) { self.content = content() }
    public var body: some View {
        GlassEffectContainer(spacing: MacLook.barSpacing) {
            HStack(spacing: MacLook.barSpacing) { content }
        }
        .padding(.horizontal, MacLook.barPaddingSides)
        .padding(.top, MacLook.barPaddingTop)
        .padding(.bottom, MacLook.barPaddingBottom)
        .frame(maxWidth: .infinity)
    }
}

/// Related bar buttons in one glass capsule.
public struct BarGroup<Content: View>: View {
    let content: Content
    public init(@ViewBuilder content: () -> Content) { self.content = content() }
    public var body: some View {
        HStack(spacing: 0) { content }
            .padding(.horizontal, MacLook.capsuleInset)
            .frame(height: MacLook.barControlHeight)
            .glassEffect(.regular.interactive(), in: .capsule)
    }
}

/// A button inside a BarGroup: a capsule hover fill, never a second material.
public struct BarButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        BarButtonBody(configuration: configuration)
    }

    private struct BarButtonBody: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isEnabled) private var isEnabled
        @State private var hovered = false
        var body: some View {
            configuration.label
                .font(MacLook.Text.body.weight(.medium))
                .foregroundStyle(MacLook.Colors.label)
                .padding(.horizontal, 8)
                .frame(minWidth: 32, minHeight: MacLook.barControlHeight - MacLook.capsuleInset * 2)
                .opacity(isEnabled ? 1 : 0.35)
                .background(fill, in: Capsule())
                .contentShape(Capsule())
                .onHover { hovered = $0 }
        }

        private var fill: Color {
            guard isEnabled else { return .clear }
            if configuration.isPressed { return MacLook.Colors.hover.opacity(1.6) }
            return hovered ? MacLook.Colors.hover : .clear
        }
    }
}

/// An icon-only bar button: a symbol, a tooltip and an accessible name, always.
public struct BarIconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    public init(_ label: String, symbol: String, action: @escaping () -> Void) {
        self.symbol = symbol
        self.label = label
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: symbol).imageScale(.medium)
        }
        .buttonStyle(BarButtonStyle())
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }
}

/// The top bar's search field: glass capsule, clear button, focus from Find (⌘F) through `focus`.
public struct BarSearchField: View {
    @Binding var text: String
    let prompt: String
    let focus: FocusState<Bool>.Binding
    let onSubmit: () -> Void
    public init(text: Binding<String>, prompt: String, focus: FocusState<Bool>.Binding, onSubmit: @escaping () -> Void = {}) {
        _text = text
        self.prompt = prompt
        self.focus = focus
        self.onSubmit = onSubmit
    }

    public var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(MacLook.Colors.secondary)
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .font(MacLook.Text.body)
                .focused(focus)
                .onSubmit(onSubmit)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(MacLook.Colors.tertiary).padding(2)
                }
                .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
                .accessibilityLabel("Clear search")
                .foleviTooltip("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: MacLook.barControlHeight)
        .frame(minWidth: 170, idealWidth: 240, maxWidth: 300)
        .glassEffect(.regular, in: .capsule)
    }
}

/// A small control's quiet hover: the hover fill in its shape under the pointer, deeper while pressed (`active`
/// false: none, for a control that shows its state another way).
public struct QuietHoverStyle: ButtonStyle {
    let shape: AnyShape
    let active: Bool
    public init(shape: AnyShape, active: Bool = true) {
        self.shape = shape
        self.active = active
    }

    public func makeBody(configuration: Configuration) -> some View { Face(configuration: configuration, shape: shape, active: active) }

    private struct Face: View {
        let configuration: ButtonStyleConfiguration
        let shape: AnyShape
        let active: Bool
        @State private var hovered = false
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .background(shape.fill(active && isEnabled && (hovered || configuration.isPressed) ? MacLook.Colors.hover.opacity(configuration.isPressed ? 0.9 : 0.5) : .clear))
                .onHover { hovered = $0 }
        }
    }
}

// MARK: - Capsule track (tabs, inspector sections, segmented choices drawn by Folevi)

/// A capsule track whose selected item is a capsule inset by `inset` on every side, end caps included.
public struct CapsuleTrack<Item: Hashable, Label: View>: View {
    let items: [Item]
    @Binding var selection: Item
    let height: CGFloat
    let inset: CGFloat
    let equalWidths: Bool
    let label: (Item, Bool) -> Label
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var ns

    public init(_ items: [Item], selection: Binding<Item>, height: CGFloat = 28, inset: CGFloat = MacLook.capsuleInset,
                equalWidths: Bool = true, @ViewBuilder label: @escaping (Item, Bool) -> Label) {
        self.items = items
        _selection = selection
        self.height = height
        self.inset = inset
        self.equalWidths = equalWidths
        self.label = label
    }

    public var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.self) { item in
                let selected = item == selection
                Button {
                    withAnimation(MacLook.animation(reduceMotion)) { selection = item }
                } label: {
                    label(item, selected)
                        .font(selected ? MacLook.Text.body.weight(.semibold) : MacLook.Text.body)
                        .foregroundStyle(selected ? MacLook.Colors.label : MacLook.Colors.secondary)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: equalWidths ? .infinity : nil)
                        .frame(height: height - inset * 2)
                        .background {
                            if selected {
                                Capsule()
                                    .fill(MacLook.Colors.container)
                                    .shadow(color: .black.opacity(0.12), radius: 1.5, y: 0.5)
                                    .matchedGeometryEffect(id: "selection", in: ns)
                            }
                        }
                        .contentShape(Capsule())
                }
                // (A hover fill on the others; the selected one has its capsule.)
                .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule()), active: !selected))
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }
        .padding(inset)
        .frame(height: height)
        .background(MacLook.Colors.hover.opacity(0.7), in: Capsule())
    }
}

// MARK: - Sidebar rows

/// A sidebar or Settings category row at the compact scale. The whole row is the hit target.
public struct SidebarRow<Trailing: View>: View {
    let title: String
    let symbol: String?
    /// A row's own icon in place of a symbol (a folder's or a tag's colour, a brand mark), in the same slot.
    let icon: AnyView?
    let selected: Bool
    let level: Int
    let trailing: Trailing
    @State private var hovered = false
    @Environment(\.controlActiveState) private var activeState

    public init(_ title: String, symbol: String?, selected: Bool = false, level: Int = 0,
                @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.title = title
        self.symbol = symbol
        self.icon = nil
        self.selected = selected
        self.level = level
        self.trailing = trailing()
    }

    /// A row whose icon is drawn by the caller (kept to the symbol's size and slot).
    public init<Icon: View>(_ title: String, selected: Bool = false, level: Int = 0, @ViewBuilder icon: () -> Icon,
                            @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.title = title
        self.symbol = nil
        self.icon = AnyView(icon())
        self.selected = selected
        self.level = level
        self.trailing = trailing()
    }

    public var body: some View {
        HStack(spacing: MacLook.rowIconGap) {
            if let icon {
                icon
                    .font(.system(size: MacLook.rowSymbolSize))
                    .frame(width: MacLook.rowIconSlot, height: MacLook.rowIconSlot, alignment: .center)
            } else if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: MacLook.rowSymbolSize))
                    .foregroundStyle(selected ? MacLook.Colors.label : MacLook.Colors.secondary)
                    .frame(width: MacLook.rowIconSlot, alignment: .center)
            }
            Text(title)
                .font(selected ? MacLook.Text.body.weight(.semibold) : MacLook.Text.body)
                .foregroundStyle(MacLook.Colors.label)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 4)
            trailing
                .font(MacLook.Text.small)
                .foregroundStyle(MacLook.Colors.secondary)
        }
        .padding(.leading, 8 + CGFloat(level) * MacLook.rowIndent)
        .padding(.trailing, 8)
        .frame(height: MacLook.rowHeight)
        .background(background, in: RoundedRectangle(cornerRadius: MacLook.rowRadius, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: MacLook.rowRadius, style: .continuous))
        .onHover { hovered = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : [.isButton])
    }

    private var background: Color {
        if selected { return activeState == .inactive ? MacLook.Colors.hover.opacity(0.7) : MacLook.Colors.selection }
        return hovered ? MacLook.Colors.hover.opacity(0.5) : .clear
    }
}

/// A sidebar section heading: 11 pt semibold, secondary, aligned with the rows' labels' leading edge.
public struct SidebarHeading<Trailing: View>: View {
    let title: String
    /// The heading's own page (Folders, Tags): its title opens it, in the label colour while it's open.
    let action: (() -> Void)?
    let selected: Bool
    let trailing: Trailing
    public init(_ title: String, selected: Bool = false, action: (() -> Void)? = nil,
                @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.title = title
        self.action = action
        self.selected = selected
        self.trailing = trailing()
    }

    public var body: some View {
        HStack {
            let label = Text(title).font(MacLook.Text.smallStrong)
                .foregroundStyle(selected ? MacLook.Colors.label : MacLook.Colors.secondary)
            if let action {
                Button(action: action) { label.contentShape(Rectangle()) }
                    .buttonStyle(QuietHoverStyle(shape: AnyShape(RoundedRectangle(cornerRadius: 4, style: .continuous))))
                    .foleviTooltip("Open \(title)")
            } else {
                label
            }
            Spacer(minLength: 4)
            trailing.foregroundStyle(MacLook.Colors.secondary)
        }
        .padding(.horizontal, 8)
        .padding(.top, MacLook.Space.m)
        .padding(.bottom, MacLook.Space.xs)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Side panel (inspector)

/// A flat, rounded panel inside the card: the note's inspector. No glass, no shadow, no second outline.
public struct SidePanel<Content: View>: View {
    let content: Content
    public init(@ViewBuilder content: () -> Content) { self.content = content() }
    public var body: some View {
        content
            .frame(maxHeight: .infinity, alignment: .top)
            .background(MacLook.Colors.panel, in: RoundedRectangle(cornerRadius: MacLook.panelRadius, style: .continuous))
    }
}

// MARK: - Forms

/// A group of settings rows: a heading, then one rounded surface sized to its rows.
public struct FormGroup<Content: View>: View {
    let title: String?
    let footer: String?
    let content: Content
    public init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title).font(MacLook.Text.smallStrong).foregroundStyle(MacLook.Colors.secondary)
                    .padding(.horizontal, 4)
                    .accessibilityAddTraits(.isHeader)
            }
            VStack(spacing: 0) { content }
                .background(MacLook.Colors.hover.opacity(0.35), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(MacLook.Colors.separator.opacity(0.6)))
            if let footer {
                Text(footer).font(MacLook.Text.small).foregroundStyle(MacLook.Colors.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }
        }
    }
}

/// One settings row: label (and an optional helper under it) leading, the control trailing. Rows after the first
/// draw a separator inset to the content.
public struct FormRow<Control: View>: View {
    let label: String
    let helper: String?
    let first: Bool
    let control: Control
    public init(_ label: String, helper: String? = nil, first: Bool = false, @ViewBuilder control: () -> Control) {
        self.label = label
        self.helper = helper
        self.first = first
        self.control = control()
    }

    public var body: some View {
        VStack(spacing: 0) {
            if !first { Divider().padding(.horizontal, MacLook.Space.m) }
            HStack(alignment: .center, spacing: MacLook.Space.l) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(MacLook.Text.body).foregroundStyle(MacLook.Colors.label)
                    if let helper {
                        Text(helper).font(MacLook.Text.small).foregroundStyle(MacLook.Colors.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: MacLook.Space.m)
                control
            }
            .padding(.horizontal, MacLook.Space.m)
            .padding(.vertical, 8)
            .frame(minHeight: 38)
        }
    }
}

// MARK: - Edge fade

/// A soft fade at a horizontal scroll view's edge, shown only while content continues past that edge. Apply it as a
/// mask to the scrolling layer (header and rows together), never to fixed controls.
public struct EdgeFade: ViewModifier {
    let leading: Bool
    let trailing: Bool
    public init(leading: Bool, trailing: Bool) {
        self.leading = leading
        self.trailing = trailing
    }

    public func body(content: Content) -> some View {
        content.mask {
            HStack(spacing: 0) {
                LinearGradient(colors: [.black.opacity(leading ? 0 : 1), .black], startPoint: .leading, endPoint: .trailing)
                    .frame(width: MacLook.edgeFadeWidth)
                Rectangle()
                LinearGradient(colors: [.black, .black.opacity(trailing ? 0 : 1)], startPoint: .leading, endPoint: .trailing)
                    .frame(width: MacLook.edgeFadeWidth)
            }
        }
    }
}
#endif
