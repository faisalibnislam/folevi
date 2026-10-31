// The iPhone layout's plain lists, as the web draws them (apps/web/src/components/iphone/Rows.tsx): a row (an
// icon, the label, a count and the chevron, a hairline from the label to the screen's edge), a Home section (its
// title as a link, a "…" menu), the search field under a large title, and an empty section's quiet box. Sizes
// and colours are measured from the iPhone app's web (packages/design-tokens/match/app-styles/phone.json).
import SwiftUI

private func ps(_ id: String, _ scheme: ColorScheme) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

/// ListRow: 52 tall at least, 20 in from the left and 16 from the right, the icon in a 28 column, 12 to the label.
public struct PhoneListRow<Icon: View>: View {
    let label: String
    let detail: String?
    let chevron: Bool
    let icon: Icon?
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(_ label: String, detail: String? = nil, chevron: Bool = true, action: @escaping () -> Void, @ViewBuilder icon: () -> Icon) {
        self.label = label
        self.detail = detail
        self.chevron = chevron
        self.icon = icon()
        self.action = action
    }

    public var body: some View {
        let row = ps("phone.row", scheme)
        let iconBox = ps("phone.row.icon", scheme)
        let body = ps("phone.row.body", scheme)
        let text = ps("phone.row.label", scheme)
        let count = ps("phone.row.detail", scheme)
        let chev = ps("phone.row.chevron", scheme)
        Button(action: action) {
            HStack(spacing: row.gap) {
                if let icon {
                    icon.frame(width: iconBox.width).foregroundStyle(ps("phone.row.icon.svg", scheme).color.color)
                }
                HStack(spacing: body.gap) {
                    Text(label).webText(text.text).lineLimit(1).truncationMode(.tail)
                        .foregroundStyle(text.color.color)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let detail, !detail.isEmpty {
                        Text(detail).webText(count.text).monospacedDigit().foregroundStyle(count.color.color)
                    }
                    if chevron {
                        // (-mr-1: the chevron reaches 4 into the label column's right padding.)
                        WebIconView(.chevronRight, size: chev.width, strokeWidth: 2.4, absoluteStrokeWidth: true)
                            .foregroundStyle(chev.color.color)
                            .padding(.trailing, -4)
                    }
                }
                .padding(.trailing, body.padding.right)
                .frame(minHeight: body.height)
                .overlay(alignment: .bottom) { PhoneRowHairline() }
            }
            .padding(.leading, row.padding.left)
            .padding(.trailing, row.padding.right)
            .contentShape(Rectangle())
        }
        .buttonStyle(PhoneRowPressStyle())
    }
}

public extension PhoneListRow where Icon == EmptyView {
    init(_ label: String, detail: String? = nil, chevron: Bool = true, action: @escaping () -> Void) {
        self.init(label, detail: detail, chevron: chevron, action: action) { EmptyView() }
    }
}

/// `.ui-row-sep::after`: half a point of --iphone-separator from the label to past the row's right padding (16).
struct PhoneRowHairline: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        PhoneSurface.separator.resolve(scheme).color
            .frame(height: 0.5)
            .padding(.trailing, -16)
    }
}

/// A row's icon as ListRow draws it: lucide at 22, in the muted colour.
public struct PhoneRowGlyph: View {
    let icon: WebIcon
    public init(_ icon: WebIcon) { self.icon = icon }
    public var body: some View { WebIconView(icon, size: 22) }
}

/// HomeSection: 28 above, the heading row (the title in Title 2 with its chevron, 44 tall; "…" on the right),
/// then the rows, or the empty box.
public struct PhoneHomeSection<Content: View>: View {
    let title: String
    let open: (() -> Void)?
    let more: ((CGRect) -> Void)?
    /// A section that folds: whether it's open (its chevron turns down).
    let opened: Bool?
    let content: Content
    @State private var moreFrame: CGRect = .zero
    @Environment(\.colorScheme) private var scheme

    public init(_ title: String, open: (() -> Void)? = nil, more: ((CGRect) -> Void)? = nil, opened: Bool? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.open = open
        self.more = more
        self.opened = opened
        self.content = content()
    }

    public var body: some View {
        let section = ps("phone.section", scheme)
        let head = ps("phone.section.head", scheme)
        let link = ps("phone.section.link", scheme)
        let t = ps("phone.section.title", scheme)
        let chev = ps("phone.section.chevron", scheme)
        let dots = ps("phone.section.more", scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: head.gap) {
                Button { open?() } label: {
                    HStack(spacing: link.gap) {
                        Text(title).webText(t.text).foregroundStyle(t.color.color)
                        if open != nil {
                            WebIconView(.chevronRight, size: chev.width, strokeWidth: 2.6, absoluteStrokeWidth: true)
                                .foregroundStyle(chev.color.color)
                                .rotationEffect(.degrees(opened == true ? 90 : 0))
                                .padding(.top, 1)
                        }
                    }
                    .frame(height: link.height)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(open == nil)
                .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if let more {
                    Button { more(moreFrame) } label: {
                        WebIconView(.ellipsis, size: 22, strokeWidth: 2.2)
                            .foregroundStyle(dots.color.color)
                            .frame(width: dots.width, height: dots.height)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PhoneRowPressStyle())
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
                    .accessibilityLabel("\(title) options")
                }
            }
            .padding(.leading, head.padding.left)
            .padding(.trailing, head.padding.right)
            content
        }
        .padding(.top, section.margin.top)
    }
}

/// SearchField with onOpen: a 44 pt pill of 6.5% ink, the magnifier and the placeholder, opening search.
public struct PhoneSearchButton: View {
    let placeholder: String
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(_ placeholder: String, action: @escaping () -> Void) {
        self.placeholder = placeholder
        self.action = action
    }

    public var body: some View {
        let wrap = ps("phone.search.wrap", scheme)
        let box = ps("phone.search.box", scheme)
        let icon = ps("phone.search.icon", scheme)
        let text = ps("phone.search.text", scheme)
        Button(action: action) {
            HStack(spacing: box.gap) {
                WebIconView(.search, size: icon.width, strokeWidth: 2.1).foregroundStyle(icon.color.color)
                Text(placeholder).webText(text.text).lineLimit(1).foregroundStyle(text.color.color)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, box.padding.left)
            .frame(height: box.height)
            .background(RoundedRectangle(cornerRadius: box.radius, style: .continuous).fill(box.background.color))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(wrap.padding.edgeInsets)
        .accessibilityLabel(placeholder)
    }
}

/// EmptyBox: one quiet italic serif line in a 56 pt box of 4% ink, 16 in from the screen's edges.
public struct PhoneEmptyBox: View {
    let text: String
    @Environment(\.colorScheme) private var scheme

    public init(_ text: String) { self.text = text }

    public var body: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        // (font-serif italic, Subheadline: 15 on 20.)
        Text(text)
            .font(Font(WebFont.ctFont(.display, size: 15, italic: true)))
            .lineSpacing(20 - 15 * 1.24)
            .multilineTextAlignment(.center)
            .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).fill(ink.opacity(0.04).color))
            .padding(.horizontal, 16)
    }
}
