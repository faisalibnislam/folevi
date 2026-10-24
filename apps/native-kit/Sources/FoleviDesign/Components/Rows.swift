// List rows and section headers for native lists (Home's rows with counts, Settings, folder and note lists).
import SwiftUI

public enum RowAccessory: Sendable {
    case none
    case chevron
    case count(Int)
    case badge(Int)
    case text(String)
    case check(Bool)
}

/// A row: leading icon (SF Symbol or any view), title, optional subtitle, trailing accessory. 44 pt minimum.
public struct ListRow<Leading: View>: View {
    let title: String
    let subtitle: String?
    let accessory: RowAccessory
    let leading: Leading

    public init(_ title: String, subtitle: String? = nil, accessory: RowAccessory = .none, @ViewBuilder leading: () -> Leading) {
        self.title = title
        self.subtitle = subtitle
        self.accessory = accessory
        self.leading = leading()
    }

    public var body: some View {
        HStack(spacing: 12) {
            leading
                .frame(minWidth: 22)
                .foregroundStyle(Folevi.color.inkMuted)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .foleviFont(.body)
                    .foregroundStyle(Folevi.color.ink)
                    .lineLimit(2)
                if let subtitle {
                    Text(subtitle)
                        .foleviFont(.footnote)
                        .foregroundStyle(Folevi.color.inkMuted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            accessoryView
        }
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder var accessoryView: some View {
        switch accessory {
        case .none: EmptyView()
        case .chevron: chevron
        case .count(let n):
            HStack(spacing: 6) {
                Text(n.formatted()).foleviFont(.callout).foregroundStyle(Folevi.color.inkFaint).monospacedDigit()
                chevron
            }
        case .badge(let n):
            HStack(spacing: 6) {
                Badge(count: n)
                chevron
            }
        case .text(let s):
            HStack(spacing: 6) {
                Text(s).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
                chevron
            }
        case .check(let on):
            Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Folevi.color.ink).opacity(on ? 1 : 0)
        }
    }

    private var chevron: some View {
        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Folevi.color.inkFaint).accessibilityHidden(true)
    }
}

public extension ListRow where Leading == RowIcon {
    init(_ title: String, subtitle: String? = nil, systemImage: String, accessory: RowAccessory = .none) {
        self.init(title, subtitle: subtitle, accessory: accessory) { RowIcon(systemImage) }
    }
}

public struct RowIcon: View {
    let systemName: String
    public init(_ systemName: String) { self.systemName = systemName }
    public var body: some View {
        Image(systemName: systemName).font(.system(size: 16, weight: .regular)).frame(width: 22).accessibilityHidden(true)
    }
}

/// A section header: Spectral title with an optional trailing action ("See all"), or the small caps label.
public struct SectionHeader: View {
    public enum Style: Sendable { case title, caps }
    let title: String
    let style: Style
    let actionTitle: String?
    let action: (() -> Void)?

    public init(_ title: String, style: Style = .title, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.title = title
        self.style = style
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foleviFont(style == .title ? .title2 : .caps)
                .foregroundStyle(style == .title ? Folevi.color.heading : Folevi.color.inkFaint)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.plain)
                    .foleviFont(.callout)
                    .foregroundStyle(Folevi.color.inkMuted)
            }
        }
        .padding(.top, style == .title ? 8 : 4)
    }
}

/// A grouped container for rows (Settings-like inset group): surface, panel radius, hairline. Put a
/// `RowDivider()` between rows.
public struct RowGroup<Content: View>: View {
    let content: Content
    public init(@ViewBuilder content: () -> Content) { self.content = content() }
    public var body: some View {
        VStack(spacing: 0) { content }
            .padding(.horizontal, 12)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(Folevi.color.surface))
            .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).strokeBorder(Folevi.color.line, lineWidth: 0.75))
    }
}

/// A hairline between rows, inset past the leading icon.
public struct RowDivider: View {
    let leadingInset: CGFloat
    public init(leadingInset: CGFloat = 34) { self.leadingInset = leadingInset }
    public var body: some View {
        Rectangle().fill(Folevi.color.line).frame(height: 0.75).padding(.leading, leadingInset)
    }
}
