// The iPhone's inset grouped lists, as the web draws them (apps/web/src/components/iphone/Grouped.tsx and
// globals.css `.ui-grouped`): a small heading in caps, the rows on one rounded tile with hairlines between them that
// start at the text (past a row's icon), and a note under it. Settings and the account sheet are made of these.
import SwiftUI

public extension ContainerValues {
    /// Where the hairline above a row starts (the web's --sep-inset): past the row's icon, at its text.
    @Entry var phoneSeparatorInset: CGFloat = 16
}

public extension View {
    /// The hairline above this row (in a PhoneGroupedSection) starts `inset` points in.
    func phoneSeparatorInset(_ inset: CGFloat) -> some View {
        containerValue(\.phoneSeparatorInset, inset)
    }
}

/// A section of an inset grouped list: `px-4`, the heading `.ui-caption-caps` 16 in with 8 under it, the rows on
/// `--iphone-row` with the container radius, the footer in Footnote 8 under.
public struct PhoneGroupedSection<Content: View>: View {
    let title: String?
    let footer: String?
    let content: Content
    @Environment(\.colorScheme) private var scheme

    public init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                Text(title.uppercased())
                    .webText(PhoneType.captionCaps)
                    .lineLimit(1)
                    .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
            VStack(spacing: 0) {
                Group(subviews: content) { rows in
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                        row.overlay(alignment: .top) {
                            if i > 0 {
                                PhoneSurface.separator.resolve(scheme).color
                                    .frame(height: 0.5)
                                    .padding(.leading, row.containerValues.phoneSeparatorInset)
                                    .allowsHitTesting(false)
                            }
                        }
                    }
                }
            }
            .background(PhoneSurface.row.resolve(scheme).color)
            .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .circular))
            if let footer {
                // (On exact CSS line boxes: a paragraph laid out by Text drifted a little each line.)
                WebFittedLines(footer, style: WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: 18), maxLines: 40)
                    .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
        }
        .padding(.horizontal, 16)
    }
}

/// Type the phone's lists use that isn't a plain role.
public enum PhoneType {
    /// `.ui-caption-caps`: Footnote, 600, +0.04em, in capitals.
    public static var captionCaps: WebTextStyle {
        let m = WebTypeRole.footnote.metrics
        return WebTextStyle(size: m.size, leading: m.leading, weight: FoleviTokens.FontWeight.semibold, letterSpacing: 0.04 * m.size)
    }

    /// `text-body leading-[22px]`.
    public static func body(weight: CGFloat? = nil) -> WebTextStyle {
        WebTextStyle(size: WebTypeRole.body.metrics.size, leading: 22, weight: weight ?? FoleviTokens.FontWeight.regular)
    }

    /// `text-subheadline` at a given line height.
    public static func subheadline(leading: CGFloat) -> WebTextStyle {
        WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: leading)
    }
}

/// A row pressed: `active:bg-[var(--liquid-press)]` at once, fading back over 150 ms.
public struct PhoneRowPressStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .background(configuration.isPressed ? LiquidGlassLook.press.resolve(scheme).color : .clear)
            .animation(configuration.isPressed ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// RowIcon: an icon (17 pt, in the heading ink) on a 30 pt tile with the small radius, the ink at 7% (or `tone`).
public struct PhoneRowIcon: View {
    let icon: WebIcon
    let tone: Color?
    let ink: Color?
    @Environment(\.colorScheme) private var scheme

    public init(_ icon: WebIcon, tone: Color? = nil, ink: Color? = nil) {
        self.icon = icon
        self.tone = tone
        self.ink = ink
    }

    public var body: some View {
        WebIconView(icon, size: 17)
            .foregroundStyle(ink ?? FoleviTokens.Chrome.heading.resolve(scheme).color)
            .frame(width: 30, height: 30)
            .background(tone ?? FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.07), in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .circular))
            .accessibilityHidden(true)
    }
}

/// GroupedRow: an icon, a label (and a quieter second line), a value, a check, a chevron; at least 52 tall, 16 in,
/// 12 between its parts. Its hairline starts past its icon.
public struct PhoneGroupedRow<Icon: View, Trailing: View>: View {
    let label: String
    let description: String?
    let detail: String?
    let checked: Bool
    let chevron: Bool
    let danger: Bool
    let action: (() -> Void)?
    let icon: Icon
    let trailing: Trailing
    @Environment(\.colorScheme) private var scheme

    public init(_ label: String, description: String? = nil, detail: String? = nil, checked: Bool = false, chevron: Bool = false, danger: Bool = false, action: (() -> Void)? = nil, @ViewBuilder icon: () -> Icon, @ViewBuilder trailing: () -> Trailing) {
        self.label = label
        self.description = description
        self.detail = detail
        self.checked = checked
        self.chevron = chevron
        self.danger = danger
        self.action = action
        self.icon = icon()
        self.trailing = trailing()
    }

    public var body: some View {
        let row = HStack(spacing: 12) {
            icon
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .webText(PhoneType.body())
                    .lineLimit(1)
                    .foregroundStyle((danger ? FoleviTokens.Chrome.destructive : FoleviTokens.Chrome.ink).resolve(scheme).color)
                if let description {
                    Text(description)
                        .webText(PhoneType.subheadline(leading: 20))
                        .lineLimit(1)
                        .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                }
            }
            .padding(.vertical, description == nil ? 15 : 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            if let detail {
                Text(detail)
                    .webText(PhoneType.body())
                    .lineLimit(1)
                    .monospacedDigit()
                    .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
            }
            trailing
            if checked {
                WebIconView(.check, size: 20, strokeWidth: 2.4)
                    .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                    .accessibilityHidden(true)
            }
            if chevron {
                // RowChevron: 20 pt, an absolute 2.4 stroke, in the faint ink, 4 pt into the row's padding.
                WebIconView(.chevronRight, size: 20, strokeWidth: 2.4, absoluteStrokeWidth: true)
                    .foregroundStyle(FoleviTokens.Chrome.inkFaint.resolve(scheme).color)
                    .padding(.trailing, -4)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        Group {
            if let action {
                Button(action: action) { row }
                    .buttonStyle(PhoneRowPressStyle())
                    .accessibilityAddTraits(checked ? .isSelected : [])
            } else {
                row
            }
        }
        .phoneSeparatorInset(Icon.self == EmptyView.self ? 16 : 58)
    }
}

public extension PhoneGroupedRow where Trailing == EmptyView {
    init(_ label: String, description: String? = nil, detail: String? = nil, checked: Bool = false, chevron: Bool = false, danger: Bool = false, action: (() -> Void)? = nil, @ViewBuilder icon: () -> Icon) {
        self.init(label, description: description, detail: detail, checked: checked, chevron: chevron, danger: danger, action: action, icon: icon, trailing: { EmptyView() })
    }
}

public extension PhoneGroupedRow where Icon == EmptyView, Trailing == EmptyView {
    init(_ label: String, description: String? = nil, detail: String? = nil, checked: Bool = false, chevron: Bool = false, danger: Bool = false, action: (() -> Void)? = nil) {
        self.init(label, description: description, detail: detail, checked: checked, chevron: chevron, danger: danger, action: action, icon: { EmptyView() }, trailing: { EmptyView() })
    }
}
