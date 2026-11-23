// Tags on the iPhone, as the web's phone layout draws them (apps/web/src/components/iphone/Organize.tsx
// IphoneTags): the large title, "…" in the glass pill (Sort by: Name, Most used, Newest), the search field under
// the bar, then a row per tag (its # in the tag's colour, the name, how many pages) that opens the tag's notes.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

public struct PhoneTagsScreen: View {
    @Bindable var model: TagsIndexModel
    let open: (String) -> Void
    let back: () -> Void
    let menu: (CGRect) -> Void
    let scrollToTop: Int
    @State private var moreFrame: CGRect = .zero
    @Environment(\.colorScheme) private var scheme

    /// `open` gets the tag's path (`/tags/<id>`); `menu` shows the sort menu from the pill's "…".
    public init(model: TagsIndexModel, open: @escaping (String) -> Void, back: @escaping () -> Void, menu: @escaping (CGRect) -> Void, scrollToTop: Int = 0) {
        self.model = model
        self.open = open
        self.back = back
        self.menu = menu
        self.scrollToTop = scrollToTop
    }

    /// The title, and iOS's own search field under it (the native look).
    private var searchOptions: PhoneScreenOptions {
        var o = PhoneScreenOptions(title: "Tags")
        if PhoneNotesListScreen.nativeSearch {
            o.search = $model.query
            o.searchPrompt = "Filter tags"
            o.searchIcon = .funnel
        }
        return o
    }

    public var body: some View {
        PhoneScreen(searchOptions, root: false, scrollToTop: scrollToTop, back: back) {
            EmptyView()
        } trailing: {
            PhoneBarMenuButton("Tags options") { menu($0) }
        } header: {
            if !PhoneNotesListScreen.nativeSearch { PhoneSearchField("Filter tags", text: $model.query, icon: .funnel) }
        } content: {
            let shown = model.shown
            if !model.isLoading && shown.isEmpty {
                let q = model.query.trimmingCharacters(in: .whitespaces)
                PhoneScreenEmpty(icon: .hash, title: q.isEmpty ? "No tags yet" : "No tags match “\(q)”", message: q.isEmpty ? "Add tags to a note from its Info panel." : nil)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(shown, id: \.id) { t in
                        PhoneListRow(t.name, detail: String(t.documentCount), action: { open("/tags/\(t.id)") }) {
                            PhoneRowGlyph(.hash).foregroundStyle(PhoneHomeContent.tagColor(t.color, scheme).color)
                        }
                    }
                }
                // (On one card: the owner, 2026-11-23.)
                .phoneCard()
                .padding(.top, 8)
                .accessibilityLabel("Tags")
            }
        }
    }
}
#endif
