// Home on the iPhone, as the web draws it (apps/web/src/components/iphone/IphoneHome.tsx): recent notes as cards
// in a row, then Catch me up, All notes, Drafts, Shared with Me, Changes and Reviews as rows, Starred, Folders
// (their cards in a row) and Tags (folded at first), and Templates, Archive and Trash at the end. Everything
// comes from the engine's `home` view (HomeModel); the frame draws the bar, the large title and the search field.
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
            VStack(spacing: 0) {
                if model.aiOn {
                    PhoneListRow("Catch me up", chevron: false, action: { actions.open("/catch-up") }) {
                        WebAiMark(size: ps("phone.catchup.icon").width)
                    }
                }
                ForEach(model.rows, id: \.id) { row in
                    PhoneListRow(row.title, detail: model.count(row).map(String.init), action: { actions.open(row.route) }) {
                        PhoneRowGlyph(Self.icon(row.id))
                    }
                }
            }
            starred
            folders
            if !model.tags.isEmpty { tags }
            VStack(spacing: 0) {
                PhoneListRow("Templates", action: { actions.open("/templates") }) { PhoneRowGlyph(.layoutTemplate) }
                PhoneListRow("Archive", action: { actions.open("/archive") }) { PhoneRowGlyph(.archive) }
                PhoneListRow("Trash", action: { actions.open("/trash") }) { PhoneRowGlyph(.trash) }
            }
            .padding(.top, ps("phone.more").margin.top)
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
                        Button { actions.openNote(row.id) } label: {
                            WebNoteCard(card_).frame(width: card.width)
                        }
                        .buttonStyle(PhoneCardPressStyle())
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

    private var starred: some View {
        PhoneHomeSection("Starred", open: { actions.open("/starred") }) {
            if model.starred.isEmpty {
                PhoneEmptyBox("Star notes to keep them close")
            } else {
                VStack(spacing: 0) {
                    ForEach(model.starred.prefix(6), id: \.id) { row in
                        PhoneListRow(row.title.isEmpty ? "Untitled" : row.title, action: { actions.openNote(row.id) }) { PhoneRowGlyph(.fileText) }
                    }
                    if model.moreStarred {
                        PhoneListRow("See all starred", action: { actions.open("/starred") })
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
                            Button { actions.open("/folders/\(folder.id)") } label: {
                                WebFolderCard(model_).frame(width: card.width)
                            }
                            .buttonStyle(PhoneCardPressStyle())
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
                    VStack(spacing: 0) {
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

/// A card in a row pressed: it shrinks to 97% (`active:scale-[0.97]`).
struct PhoneCardPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
