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
                .overlay(alignment: .bottom) { PhoneRowHairlineView() }
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
public struct PhoneRowHairlineView: View {
    @Environment(\.colorScheme) private var scheme
    public init() {}
    public var body: some View {
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

/// SearchField with a value: the same pill as a field that filters a list, Cancel beside it while it's in use.
public struct PhoneSearchField: View {
    let placeholder: String
    @Binding var text: String
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    public init(_ placeholder: String, text: Binding<String>) {
        self.placeholder = placeholder
        self._text = text
    }

    public var body: some View {
        let wrap = ps("phone.search.wrap", scheme)
        let box = ps("phone.searchfield.box", scheme)
        let input = ps("phone.searchfield.input", scheme)
        let icon = ps("phone.search.icon", scheme)
        HStack(spacing: wrap.gap) {
            HStack(spacing: box.gap) {
                WebIconView(.search, size: icon.width, strokeWidth: 2.1).foregroundStyle(icon.color.color)
                // (The placeholder in the web's letter spacing: a UIKit field's prompt has none.)
                TextField("", text: $text)
                    .font(Font(input.text.ctFont))
                    .foregroundStyle(input.color.color)
                    .overlay(alignment: .leading) {
                        if text.isEmpty {
                            Text(placeholder).webText(input.text).lineLimit(1).foregroundStyle(box.color.color)
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
                    .accessibilityLabel(placeholder)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
            }
            .padding(.horizontal, box.padding.left)
            .frame(height: box.height)
            .background(RoundedRectangle(cornerRadius: box.radius, style: .continuous).fill(box.background.color))
            if focused || !text.isEmpty {
                Button("Cancel") {
                    text = ""
                    focused = false
                }
                .webText(input.text)
                .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                .padding(.horizontal, 4)
                .frame(height: 44)
                .transition(.opacity)
            }
        }
        .padding(wrap.padding.edgeInsets)
        .animation(.easeOut(duration: 0.15), value: focused || !text.isEmpty)
    }
}

/// ScreenEmpty: a whole screen with nothing in it, one centred block 280 wide: the icon, a title and a line of
/// help, and an action if there is one.
public struct PhoneScreenEmpty<Action: View>: View {
    let icon: WebIcon?
    let title: String
    let message: String?
    let action: Action
    @Environment(\.colorScheme) private var scheme

    public init(icon: WebIcon?, title: String, message: String?, @ViewBuilder action: () -> Action) {
        self.icon = icon
        self.title = title
        self.message = message
        self.action = action()
    }

    public var body: some View {
        let block = ps("phone.empty", scheme)
        let glyph = ps("phone.empty.icon", scheme)
        let t = ps("phone.empty.title", scheme)
        let b = ps("phone.empty.body", scheme)
        VStack(spacing: 0) {
            if let icon {
                WebIconView(icon, size: 40, strokeWidth: 1.5)
                    .foregroundStyle(glyph.color.color)
                    .frame(width: glyph.width, height: glyph.height)
                    .padding(.bottom, 12)
            }
            WebParagraph([WebRun(title)], style: t.text, width: block.width, alignment: .center, wrap: .balance)
                .foregroundStyle(t.color.color)
            if let message {
                WebParagraph([WebRun(message)], style: b.text, width: block.width, alignment: .center, wrap: .greedy)
                    .foregroundStyle(b.color.color)
                    .padding(.top, 4)
            }
            action.padding(.top, 20)
        }
        .frame(width: block.width)
        .padding(.top, block.padding.top)
        .padding(.bottom, block.padding.bottom)
        .frame(maxWidth: .infinity)
    }
}

public extension PhoneScreenEmpty where Action == EmptyView {
    init(icon: WebIcon?, title: String, message: String?) {
        self.init(icon: icon, title: title, message: message) { EmptyView() }
    }
}

/// NoteGlyph: a note in a list row, a small page with its folder's colour down the spine (a draft's is plain).
public struct PhoneNoteGlyph: View {
    /// The folder's colour id; nil for a draft, `.some(nil)`-like "none" for a template (a plain page).
    let folderColorId: String?
    let template: Bool
    @Environment(\.colorScheme) private var scheme

    public init(folderColorId: String?, template: Bool = false) {
        self.folderColorId = folderColorId
        self.template = template
    }

    public var body: some View {
        let page = WebStyles.named("phone.list.glyph")
        let p = page.resolve(scheme)
        let line1 = ps("phone.list.line1", scheme)
        let line2 = ps("phone.list.line2", scheme)
        let spine: RGBA = template ? p.background
            : folderColorId.map { FolderColor.resolve($0).color } ?? ps("phone.list.spine", scheme).background
        let shape = WebCornersShape(topLeft: FoleviTokens.Radius.tiny, topRight: FoleviTokens.Radius.chip, bottomRight: FoleviTokens.Radius.chip, bottomLeft: FoleviTokens.Radius.tiny)
        ZStack(alignment: .topLeading) {
            shape.fill(p.background.color)
            spine.color.frame(width: 4)
            Capsule().fill(line1.background.color).frame(width: line1.width, height: 1.5).offset(x: 8, y: 6)
            Capsule().fill(line2.background.color).frame(width: line2.width, height: 1.5).offset(x: 8, y: 12)
        }
        .frame(width: p.width, height: p.height)
        .clipShape(shape)
        .overlay(WebShapeBox(shape: shape, fill: nil, shadows: p.visibleShadows))
        .frame(width: 28, height: 28)
    }
}

/// `ui-seg`: two or three choices in a 6% ink well, the chosen one raised on the glass (Comments' Open and
/// Resolved, Notifications' All and Unread).
public struct PhoneSegmented: View {
    let options: [(id: String, label: String)]
    @Binding var selection: String
    let accessibility: String
    @Environment(\.colorScheme) private var scheme

    public init(_ options: [(id: String, label: String)], selection: Binding<String>, accessibility: String) {
        self.options = options
        self._selection = selection
        self.accessibility = accessibility
    }

    public var body: some View {
        let c = { (p: ColorPair) in p.resolve(scheme).color }
        HStack(spacing: 2) {
            ForEach(options, id: \.id) { o in
                let on = selection == o.id
                Button { selection = o.id } label: {
                    Text(o.label)
                        .webText(WebTextStyle(size: WebTypeRole.callout.metrics.size, leading: WebTypeRole.callout.metrics.leading, weight: 550))
                        .lineLimit(1)
                        .foregroundStyle(c(on ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.inkMuted))
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .background {
                            if on {
                                WebShapeBox(shape: WebCornersShape(topLeft: FoleviTokens.Radius.chip, topRight: FoleviTokens.Radius.chip, bottomRight: FoleviTokens.Radius.chip, bottomLeft: FoleviTokens.Radius.chip), fill: c(FoleviTokens.Glass.active), shadows: PhoneStyleSheetContent.glassEdge(scheme) + [ShadowLayer(x: 0, y: 1, blur: 3, spread: 0, color: RGBA(0, 0, 0, 0.08))])
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(c(FoleviTokens.Chrome.ink).opacity(0.06), in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular))
        .accessibilityLabel(accessibility)
    }
}
