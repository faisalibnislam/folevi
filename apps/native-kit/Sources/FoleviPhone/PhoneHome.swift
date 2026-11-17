// Home on the iPhone, as the web draws it (apps/web/src/components/iphone/IphoneHome.tsx): recent notes as cards
// in a row, Catch me up as its own card, All notes, Drafts, Shared with Me, Changes and Reviews as tiles two by
// two, Bookmarks (rows in a rounded card), Folders (their cards in a row) and Tags (folded at first), and
// the Vault (for someone with one), Templates, Archive and Trash in a card at the end. Everything
// comes from the engine's `home` view (HomeModel); the frame draws the bar, the large title and the search field.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// What Home asks the frame for.
public struct PhoneHomeActions {
    /// A web route (`/notes`, `/folders/<id>`, `/starred`): the frame opens its screen.
    public var open: (String) -> Void
    public var openNote: (String) -> Void
    /// The Folders section's "…" (New folder, All folders), from where it was tapped.
    public var foldersMenu: (CGRect) -> Void
    /// A folder card's menu (its long press), from the card.
    public var folderMenu: (FolderCard, CGRect) -> Void = { _, _ in }
    /// A note's menu (its long press on a recent card or a Starred row), from where it was held.
    public var noteMenu: (NoteRow, CGRect) -> Void = { _, _ in }

    public init(open: @escaping (String) -> Void, openNote: @escaping (String) -> Void, foldersMenu: @escaping (CGRect) -> Void) {
        self.open = open
        self.openNote = openNote
        self.foldersMenu = foldersMenu
    }
}

public struct PhoneHomeContent: View {
    let model: HomeModel
    let actions: PhoneHomeActions
    @AppStorage("folevi:iphone-home:tags") private var tagsOpen = false
    @Environment(\.colorScheme) private var scheme

    public init(model: HomeModel, actions: PhoneHomeActions) {
        self.model = model
        self.actions = actions
    }

    private func ps(_ id: String) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            recents
            if model.aiOn {
                PhoneCatchUpCard { actions.open("/catch-up") }
                    .padding(.horizontal, PhoneRowGroupMetrics.inset)
            }
            tiles.padding(.top, model.aiOn ? 10 : 0)
            starred
            folders
            if !model.tags.isEmpty { tags }
            PhoneRowGroup("More") {
                // Only for someone with a Vault, as the web's sidebar lists it (the phone has no sidebar).
                if model.hasVault {
                    PhoneListRow("Vault", action: { actions.open("/vault") }) { PhoneRowGlyph(.lock) }
                }
                PhoneListRow("Templates", action: { actions.open("/templates") }) { PhoneRowGlyph(.layoutTemplate) }
                PhoneListRow("Archive", action: { actions.open("/archive") }) { PhoneRowGlyph(.archive) }
                PhoneListRow("Trash", action: { actions.open("/trash") }) { PhoneRowGlyph(.trash) }
            }
            .padding(.top, 28)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.webPhoneCards, true)
    }

    static func icon(_ id: HomeRow.Id) -> WebIcon {
        switch id {
        case .notes: .files
        case .drafts: .inbox
        case .shared: .share2
        case .changes: .fileDiff
        case .reviews: .layers
        }
    }

    // MARK: Places

    /// All notes, Drafts, Shared with Me, Changes (and Reviews) two by two; an odd last tile takes the whole row.
    private var tiles: some View {
        let rows = model.rows
        let pairs = stride(from: 0, to: rows.count, by: 2).map { Array(rows[$0..<min($0 + 2, rows.count)]) }
        return Grid(horizontalSpacing: 10, verticalSpacing: 10) {
            ForEach(pairs, id: \.first!.id) { pair in
                GridRow {
                    ForEach(pair, id: \.id) { row in
                        PhoneHomeTile(row.title, icon: Self.icon(row.id), count: model.count(row)) { actions.open(row.route) }
                            .gridCellColumns(pair.count == 1 ? 2 : 1)
                    }
                }
            }
        }
        .padding(.horizontal, PhoneRowGroupMetrics.inset)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Notes")
    }

    // MARK: Recent notes

    @ViewBuilder private var recents: some View {
        let strip = ps("phone.recents")
        let card = ps("phone.recents.card")
        if !model.recentsLoaded {
            // Three placeholders while the first answer comes (the web's pulse boxes).
            HStack(spacing: strip.gap) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
                        .fill(FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color)
                        .frame(width: card.width)
                        .aspectRatio(WebNoteCard.aspect, contentMode: .fit)
                }
            }
            .padding(strip.padding.edgeInsets)
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
            .accessibilityLabel("Loading")
        } else if model.recents.isEmpty {
            PhoneEmptyBox("Notes you open show up here").padding(.top, 12)
        } else {
            ScrollView(.horizontal) {
                LazyHStack(spacing: strip.gap) {
                    ForEach(Array(zip(model.recents, model.recentCards)), id: \.0.id) { row, card_ in
                        PhonePressable(scale: 0.97, onTap: { actions.openNote(row.id) }, onLongPress: { actions.noteMenu(row, $0) }) {
                            WebNoteCard(card_).frame(width: card.width)
                        }
                        .phoneZoomSource(row.id)
                    }
                }
                .scrollTargetLayout()
                .padding(strip.padding.edgeInsets)
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
            .contentMargins(.horizontal, strip.padding.left, for: .scrollContent)
            .padding(.horizontal, -strip.padding.left)
            .accessibilityLabel("Recent notes")
        }
    }

    // MARK: Starred

    /// How many bookmarks Home shows before "See all".
    static let bookmarksShown = 5

    private var starred: some View {
        let shown = Array(model.starred.prefix(Self.bookmarksShown))
        let more = model.moreStarred || model.starred.count > shown.count
        return PhoneHomeSection("Bookmarks", open: { actions.open("/starred") }, seeAll: more ? { actions.open("/starred") } : nil) {
            if model.starred.isEmpty {
                PhoneEmptyBox("Bookmark notes to keep them close")
            } else {
                PhoneRowGroup("Bookmarks") {
                    ForEach(shown, id: \.id) { row in
                        PhoneListRow(row.title.isEmpty ? "Untitled" : row.title, action: { actions.openNote(row.id) }, onLongPress: { actions.noteMenu(row, $0) }) { PhoneRowGlyph(.fileText) }
                    }
                }
            }
        }
    }

    // MARK: Folders

    private var folders: some View {
        let strip = ps("phone.folders")
        let card = ps("phone.folders.card")
        return PhoneHomeSection("Folders", open: { actions.open("/folders") }, more: actions.foldersMenu) {
            if model.folders.isEmpty {
                PhoneEmptyBox("Folders keep related notes together")
            } else {
                ScrollView(.horizontal) {
                    LazyHStack(spacing: strip.gap) {
                        ForEach(Array(zip(model.folders, model.folderCards)), id: \.0.id) { folder, model_ in
                            PhonePressable(scale: 0.97, onTap: { actions.open("/folders/\(folder.id)") }, onLongPress: { actions.folderMenu(folder, $0) }) {
                                WebFolderCard(model_).frame(width: card.width)
                            }
                        }
                    }
                    .scrollTargetLayout()
                    .padding(strip.padding.edgeInsets)
                }
                .scrollIndicators(.hidden)
                .scrollTargetBehavior(.viewAligned)
                .accessibilityLabel("Folders")
            }
        }
    }

    // MARK: Tags

    private var tags: some View {
        VStack(alignment: .leading, spacing: 0) {
            PhoneHomeSection("Tags", open: { withAnimation(.easeOut(duration: 0.2)) { tagsOpen.toggle() } }, opened: tagsOpen) {
                if tagsOpen {
                    PhoneRowGroup("Tags") {
                        ForEach(model.tags, id: \.id) { tag in
                            PhoneListRow(tag.name, action: { actions.open("/tags/\(tag.id)") }) {
                                PhoneRowGlyph(.hash).foregroundStyle(Self.tagColor(tag.color, scheme).color)
                            }
                        }
                    }
                }
            }
        }
    }

    /// `var(--color-<color>)`, the muted ink for "muted".
    static func tagColor(_ color: String, _ scheme: ColorScheme) -> RGBA {
        if color == "muted" { return FoleviTokens.Chrome.inkMuted.resolve(scheme) }
        return (WebStyles.vars["color-\(color)"] ?? FoleviTokens.Chrome.inkMuted).resolve(scheme)
    }
}

/// HomeTile: one of Home's places in the grid, the icon and its count on top, the name under them, in the sunken
/// card fill with the search field's corners (`rounded-panel bg-[var(--iphone-card)] p-3 min-h-[80px]`).
struct PhoneHomeTile: View {
    let title: String
    let icon: WebIcon
    let count: Int?
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    init(_ title: String, icon: WebIcon, count: Int?, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.count = count
        self.action = action
    }

    var body: some View {
        let ink = { (p: ColorPair) in p.resolve(scheme).color }
        let shape = RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous)
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    WebIconView(icon, size: 22).foregroundStyle(ink(FoleviTokens.Chrome.inkMuted)).frame(width: 24, height: 24)
                    Spacer(minLength: 0)
                    if let count {
                        Text(String(count))
                            .webText(WebTextStyle(size: WebTypeRole.title3.metrics.size, leading: 24, weight: 600))
                            .monospacedDigit()
                            .foregroundStyle(ink(FoleviTokens.Chrome.heading))
                    }
                }
                Text(title)
                    .webText(WebTextStyle(size: WebTypeRole.body.metrics.size, leading: 22, weight: 500))
                    .lineLimit(1)
                    .foregroundStyle(ink(FoleviTokens.Chrome.ink))
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
            .background(shape.fill(ink(PhoneSurface.card)))
            .contentShape(shape)
        }
        .buttonStyle(PhoneTilePressStyle(shape: shape))
        #if os(iOS)
        .hoverEffect(.highlight)
        #endif
        .accessibilityLabel(count.map { "\(title), \($0)" } ?? title)
    }
}

/// Catch me up on Home: its own card in the tiles' light fill (no edge or shadow), Foli AI's flower and what it does
/// in a line under its name.
struct PhoneCatchUpCard: View {
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let ink = { (p: ColorPair) in p.resolve(scheme).color }
        let r = FoleviTokens.Radius.container
        let shape = RoundedRectangle(cornerRadius: r, style: .continuous)
        Button(action: action) {
            HStack(spacing: 12) {
                WebAiMark(size: 28).frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Catch me up")
                        .webText(WebTextStyle(size: WebTypeRole.body.metrics.size, leading: 22, weight: 600))
                        .foregroundStyle(ink(FoleviTokens.Chrome.heading))
                    Text("A quick brief of this week\u{2019}s notes")
                        .webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 20))
                        .foregroundStyle(ink(FoleviTokens.Chrome.inkMuted))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 68)
            .background(shape.fill(ink(PhoneSurface.card)))
            .contentShape(shape)
        }
        .buttonStyle(PhoneTilePressStyle(shape: shape, scale: 0.98))
        #if os(iOS)
        .hoverEffect(.highlight)
        #endif
        .accessibilityLabel("Catch me up")
        .accessibilityHint("A quick Foli AI brief of this week\u{2019}s notes and what\u{2019}s due")
        .accessibilityIdentifier("home-catch-up")
    }
}

/// A tile or card pressed: it dips (`active:scale-[0.97]`) under the press fill (`active:bg-[var(--liquid-press)]`).
struct PhoneTilePressStyle<S: Shape>: ButtonStyle {
    let shape: S
    var scale: CGFloat = 0.97
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay { if configuration.isPressed { shape.fill(LiquidGlassLook.press.resolve(scheme).color).allowsHitTesting(false) } }
            .pressDip(configuration.isPressed, scale: scale)
    }
}

/// A card in a row pressed: it shrinks to 97% (`active:scale-[0.97]`).
struct PhoneCardPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.pressDip(configuration.isPressed, scale: 0.97)
    }
}
#endif
