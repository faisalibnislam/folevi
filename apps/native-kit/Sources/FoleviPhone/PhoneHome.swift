// Home on the iPhone, as the web draws it (apps/web/src/components/iphone/IphoneHome.tsx): recent notes as cards
// in a row, Catch me up as its own card, All notes, Drafts, Foli DNA (Shared with Me where it's off), Changes and
// Reviews as tiles two by two, Bookmarks (rows in a rounded card), Folders (their cards in a row) and Tags (two
// lines), and All folders, Shared with Me (when Foli DNA has its tile), the Vault (for someone with one), Templates, Archive and Trash in a card
// at the end. Everything
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
    /// The Folders section's "…", from where it was tapped; nil: none (the native look: All folders is a row of its
    /// own, and Home makes no folders, the owner, 2026-11-19).
    public var foldersMenu: ((CGRect) -> Void)?
    /// A folder card's menu (its long press), from the card.
    public var folderMenu: (FolderCard, CGRect) -> Void = { _, _ in }
    /// A note's menu (its long press on a recent card or a Starred row), from where it was held.
    public var noteMenu: (NoteRow, CGRect) -> Void = { _, _ in }
    /// A tag row's menu (its long press: Edit tag…, its colours, Delete tag…), from the row; nil where tags can't
    /// be changed.
    public var tagMenu: ((TagRow, CGRect) -> Void)?

    public init(open: @escaping (String) -> Void, openNote: @escaping (String) -> Void, foldersMenu: ((CGRect) -> Void)? = nil) {
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
    /// iOS puts bars in a column at the side (iPhone Duo): the card rail stops short of it.
    @Environment(\.phoneSideBars) private var sideBars

    public init(model: HomeModel, actions: PhoneHomeActions) {
        self.model = model
        self.actions = actions
    }

    private func ps(_ id: String) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

    /// Today's Home order (the owner, 2026-11-25, as `IphoneHome.tsx`): the recent notes as cards straight under
    /// the search field (no heading), Catch me up, the places two by two, then Bookmarks, Folders and Tags as titled
    /// sections, and the rest of the library at the end.
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
                // In sight, not in a menu (the owner, 2026-11-19).
                PhoneListRow("All folders", action: { actions.open("/folders") }) { PhoneRowGlyph(.folder) }
                // Shared with Me moves down here when Foli DNA takes its tile (the owner, 2026-11-27).
                if let shared = sharedBelow {
                    PhoneListRow(shared.title, action: { actions.open(shared.route) }) { PhoneRowGlyph(Self.icon(shared.id)) }
                }
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

    /// One of the tiles: a place from the engine's rows, or Foli DNA.
    private struct Tile: Identifiable {
        let id: String
        let title: String
        let icon: WebIcon
        let count: Int?
        let route: String
    }

    /// Home's places: the tiles in order (nil is Foli DNA) and the row that goes to the card at the end. With Foli
    /// DNA on, it takes Shared with Me's tile and Shared with Me becomes a row at the end (the owner, 2026-11-27);
    /// with no Shared with Me, Foli DNA comes third. With it off, the engine's rows as they come.
    nonisolated static func places(_ rows: [HomeRow], graphOn: Bool) -> (tiles: [HomeRow?], sharedBelow: HomeRow?) {
        guard graphOn else { return (rows.map { $0 }, nil) }
        let shared = rows.first { $0.id == .shared }
        var tiles: [HomeRow?] = rows.map { $0.id == .shared ? nil : $0 }
        if shared == nil { tiles.insert(nil, at: min(2, tiles.count)) }
        return (tiles, shared)
    }

    /// Shared with Me, when Foli DNA is on and takes its tile: it's then a row in the card at the end.
    private var sharedBelow: HomeRow? { Self.places(model.rows, graphOn: model.graphOn).sharedBelow }

    /// All notes, Drafts, Foli DNA (Shared with Me where Foli DNA is off), Changes (and Reviews), two by two.
    private var tileList: [Tile] {
        Self.places(model.rows, graphOn: model.graphOn).tiles.map { row in
            guard let row else { return Tile(id: "graph", title: "Foli DNA", icon: .waypoints, count: nil, route: "/graph") }
            return Tile(id: row.id.rawValue, title: row.title, icon: Self.icon(row.id), count: model.count(row), route: row.route)
        }
    }

    /// The tiles two by two; an odd last tile takes the whole row.
    private var tiles: some View {
        let rows = tileList
        let pairs = stride(from: 0, to: rows.count, by: 2).map { Array(rows[$0..<min($0 + 2, rows.count)]) }
        return Grid(horizontalSpacing: PhoneLook.gap, verticalSpacing: PhoneLook.gap) {
            ForEach(pairs, id: \.first!.id) { pair in
                GridRow {
                    ForEach(pair) { tile in
                        PhoneHomeTile(tile.title, icon: tile.icon, count: tile.count) { actions.open(tile.route) }
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

    /// Home's two strips share one rhythm (the owner, 21 November 2026): cards 176 pt wide, notes and folders alike
    /// (two in sight and the next one peeking), 10 pt apart.
    static let stripGap: CGFloat = 10

    @ViewBuilder private var recents: some View {
        let strip = ps("phone.recents")
        if !model.recentsLoaded {
            // Three placeholders while the first answer comes (the web's pulse boxes). (In a still scroll view, which
            // takes the screen's width: the row on its own is wider than the screen and pushed the whole of Home left.)
            ScrollView(.horizontal) {
                HStack(spacing: Self.stripGap) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: PhoneLook.tileRadius, style: .continuous)
                            .fill(PhoneLook.card.resolve(scheme).color)
                            .frame(width: Self.cardWidth)
                            .aspectRatio(WebNoteCard.aspect, contentMode: .fit)
                    }
                }
                .padding(strip.padding.edgeInsets)
            }
            .scrollDisabled(true)
            .scrollIndicators(.hidden)
            .accessibilityLabel("Loading")
        } else if model.recents.isEmpty {
            PhoneEmptyBox("Notes you open show up here").padding(.top, 12)
        } else {
            ScrollView(.horizontal) {
                LazyHStack(spacing: Self.stripGap) {
                    ForEach(Array(zip(model.recents, model.recentCards)), id: \.0.id) { row, card_ in
                        PhonePressable(scale: 0.97, onTap: { actions.openNote(row.id) }, onLongPress: { actions.noteMenu(row, $0) }) {
                            WebNoteCard(card_).frame(width: Self.cardWidth)
                        }
                        .phoneZoomSource(row.id)
                    }
                }
                .scrollTargetLayout()
                .padding(strip.padding.edgeInsets)
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
            // The cards' shadows fade out past the strip instead of being cut off (the owner, 21 November 2026).
            .scrollClipDisabled()
            .contentMargins(.horizontal, strip.padding.left, for: .scrollContent)
            // (To the screen's edges, except where iOS's column of bars sits at the side, iPhone Duo: the cards stop
            // short of it rather than slide under it and the status bar.)
            .padding(.leading, -strip.padding.left)
            .padding(.trailing, sideBars ? 0 : -strip.padding.left)
            // (Where it stops short, the cards fade out at its end rather than being cut off. The mask reaches well
            // above and below the strip, so it only ever fades that side, never the cards' shadows.)
            .mask {
                HStack(spacing: 0) {
                    Color.black
                    if sideBars {
                        LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .leading, endPoint: .trailing)
                            .frame(width: 36)
                    }
                }
                .padding(.vertical, -60)
            }
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

    /// A card's width in Home's strips, notes and folders alike: 176 pt, the least at which the Frosted front holds a two-line name at the
    /// iPhone's 17/22 with its counts and Edited date (the old card's 142 pt cut the date off: the owner, 21 November
    /// 2026). About two and a bit show at once.
    static let cardWidth: CGFloat = 176

    private var folders: some View {
        let strip = ps("phone.folders")
        return PhoneHomeSection("Folders", open: { actions.open("/folders") }, more: actions.foldersMenu) {
            if model.folders.isEmpty {
                PhoneEmptyBox("Folders keep related notes together")
            } else {
                ScrollView(.horizontal) {
                    LazyHStack(spacing: Self.stripGap) {
                        ForEach(Array(zip(model.folders, model.folderCards)), id: \.0.id) { folder, model_ in
                            PhonePressable(scale: 0.97, onTap: { actions.open("/folders/\(folder.id)") }, onLongPress: { actions.folderMenu(folder, $0) }) {
                                WebFolderCard(model_).frame(width: Self.cardWidth)
                            }
                        }
                    }
                    .scrollTargetLayout()
                    // 12 pt under the cards, room for their shadow: the web's 28 on top of the next section's 28 left
                    // a blank band before Tags (the owner, 21 November 2026).
                    .padding(EdgeInsets(top: strip.padding.top, leading: strip.padding.left, bottom: 12, trailing: strip.padding.right))
                }
                .scrollIndicators(.hidden)
                .scrollTargetBehavior(.viewAligned)
                // The cards' shadow fades out past the strip's edge instead of being cut off in a straight line under
                // them (the owner, 21 November 2026); the strip spans the screen, so nothing else shows past it.
                .scrollClipDisabled()
                // The next section starts as close as the others do; the cards' shadow keeps its room under it.
                .padding(.bottom, -10)
                .accessibilityLabel("Folders")
            }
        }
    }

    // MARK: Tags

    /// How many lines of tag chips Home shows; See all opens the rest (the owner, 2026-11-27).
    static let tagLinesShown = 2

    /// Tags as chips that wrap, as on the Mac's Home (the owner, 2026-11-23), two lines of them; See all opens every
    /// tag (/tags). A chip's long press is the tag's menu.
    private var tags: some View {
        PhoneHomeSection("Tags", seeAll: { actions.open("/tags") }) {
            PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false, maxLines: Self.tagLinesShown) {
                ForEach(model.tags, id: \.id) { tag in
                    PhoneTagChip(name: tag.name, color: Self.tagColor(tag.color, scheme).color, open: { actions.open("/tags/\(tag.id)") },
                                 menu: actions.tagMenu.map { menu in { menu(tag, $0) } })
                }
            }
            // The chips past the second line are set outside the frame; clipping keeps them out of sight.
            .clipped()
            .padding(.horizontal, PhoneRowGroupMetrics.inset)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Tags")
        }
    }

    /// `var(--color-<color>)`, the muted ink for "muted".
    public static func tagColor(_ color: String, _ scheme: ColorScheme) -> RGBA {
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
        let shape = RoundedRectangle(cornerRadius: PhoneLook.tileRadius, style: .continuous)
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    WebIconView(icon, size: 22).foregroundStyle(ink(FoleviTokens.Chrome.inkMuted)).frame(width: 24, height: 24)
                    Spacer(minLength: 0)
                    if let count {
                        // A quiet count badge, as Mail's and Files' (the owner, 2026-11-20: the big dark number
                        // looked out of place): the muted ink, a touch of weight, in a soft capsule.
                        Text(count > 999 ? "999+" : String(count))
                            .webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 18, weight: 500))
                            .monospacedDigit()
                            .foregroundStyle(ink(FoleviTokens.Chrome.inkMuted))
                            .padding(.horizontal, 8)
                            .frame(minWidth: 26, minHeight: 22)
                            .background(Capsule().fill(ink(FoleviTokens.Chrome.ink).opacity(scheme == .dark ? 0.12 : 0.07)))
                    }
                }
                Text(title)
                    .webText(WebTextStyle(size: WebTypeRole.body.metrics.size, leading: 22, weight: 500))
                    .lineLimit(1)
                    .foregroundStyle(ink(FoleviTokens.Chrome.ink))
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
            .background(shape.fill(ink(PhoneLook.card)))
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
        let shape = RoundedRectangle(cornerRadius: PhoneLook.tileRadius, style: .continuous)
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
            .background(shape.fill(ink(PhoneLook.card)))
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
/// A tag on Home: its name after a coloured #, in a capsule on the card fill; a long press opens its menu.
struct PhoneTagChip: View {
    let name: String
    let color: Color
    let open: () -> Void
    let menu: ((CGRect) -> Void)?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PhonePressable(scale: 0.96, onTap: open, onLongPress: menu) {
            HStack(spacing: 4) {
                WebIconView(.hash, size: 15, strokeWidth: 2.2).foregroundStyle(color)
                Text(name)
                    .webText(PhoneType.body())
                    .lineLimit(1)
                    .foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
            }
            .padding(.horizontal, 14)
            // (The HIG's 44 pt touch target, `accessibility.md`.)
            .frame(minHeight: 44)
            .background(Capsule().fill(PhoneLook.card.resolve(scheme).color))
            .contentShape(Capsule())
        }
        .accessibilityLabel("Tag \(name)")
        .accessibilityAddTraits(.isButton)
    }
}
#endif
