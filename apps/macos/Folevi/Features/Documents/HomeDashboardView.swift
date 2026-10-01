import SwiftUI

/// Home (the web's HomeDashboard): Catch me up (with AI), recent notes and starred notes (the latest 10
/// each, in a row that scrolls sideways) and recent folders (two whole rows), each with "See all".
struct HomeDashboardView: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var starred: [DocumentSummary]?
    /// documents:recentNotes (without the notes you removed); nil until loaded, or offline.
    @State private var serverRecent: [DocumentSummary]?
    @State private var dialog: NoteDialog?
    @State private var folderDialog: FolderDialog?
    @State private var folderColumns = 4
    @State private var unsynced: Set<String> = []
    private var notes: NoteActions { .shared }
    private var organization: OrganizationIndexStore { .shared }

    static let cardWidth: CGFloat = 250
    private static let carouselCount = 10
    private static let folderMin: CGFloat = 210
    private static let gap: CGFloat = 32

    private var recent: [DocumentSummary]? {
        if let serverRecent {
            // The server's list and order, with this Mac's fresher copies.
            let local = Dictionary(app.documents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            return serverRecent.map { remote in
                guard var d = local[remote.id] else { return remote }
                d.preview = d.preview ?? remote.preview
                return d
            }.filter { $0.deletedAt == nil && $0.archivedAt == nil }
        }
        if app.sync.isOnline && app.documents.isEmpty { return nil }
        return app.documents
            .filter { ($0.kind == .document || $0.kind == .daily) && $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(Self.carouselCount)
            .map { $0 }
    }

    private struct ReloadKey: Equatable { var documents: Int; var organized: Int; var online: Bool }
    private struct FolderKey: Equatable { var documents: Int; var folders: [FolderInfo]; var online: Bool; var revision: Int }

    var body: some View {
        let org = organization.scopeKey == app.scope.key ? organization.index : nil
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if app.aiAvailable {
                    CatchUpView(openDocument: { openDocument($0, false) })
                        .padding(.top, 24) // the web's first:mt-6
                }
                section(title: "Recent notes", systemImage: "clock", target: .notes, top: app.aiAvailable ? 37 : 24,
                        empty: recent.map { $0.isEmpty } == true ? "No notes yet. Press New to write your first one." : nil) {
                    NoteCarousel(docs: recent, label: String(localized: "Recent notes"), recent: true, unsynced: unsynced,
                                 openDocument: openDocument, present: { dialog = $0 })
                }
                section(title: "Starred", systemImage: "star", target: .starred, top: 37,
                        empty: starred.map { $0.isEmpty } == true ? "Star notes you come back to often and they’ll appear here." : nil) {
                    NoteCarousel(docs: starred, label: String(localized: "Starred notes"), unsynced: unsynced,
                                 openDocument: openDocument, present: { dialog = $0 })
                }
                foldersSection(org)
            }
            // max-w-[1400px] px-8: the 1400 includes the padding (1336 of content), as in CSS.
            .padding(.horizontal, 32)
            .frame(maxWidth: 1400, alignment: .leading)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
        .task(id: ReloadKey(documents: app.documentsRevision, organized: notes.revision, online: app.sync.isOnline)) {
            await loadStarred()
            await loadRecent()
        }
        .task(id: FolderKey(documents: app.documentsRevision, folders: app.sidebar.folders, online: app.sync.isOnline, revision: organization.revision)) {
            await organization.load(app: app)
        }
        .task(id: app.sync.pendingCount) { unsynced = await PendingDocuments.ids(app: app) }
        .noteDialogs($dialog)
        .folderDialogs($folderDialog)
    }

    private func loadRecent() async {
        guard let session = app.session, app.sync.isOnline else { return }
        if let docs = try? await session.documents.recentNotes(scope: session.scope, limit: Self.carouselCount) { serverRecent = docs }
    }

    /// A Home section: a heading with its icon tile (and a count), "See all", then its content or a line
    /// saying it's empty.
    private func section<Content: View>(title: LocalizedStringKey, systemImage: String, target: SidebarItem, count: String? = nil, top: CGFloat,
                                         empty: LocalizedStringKey?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: systemImage)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(FoleviColor.heading)
                        .frame(width: 32, height: 32)
                        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .accessibilityHidden(true)
                    Text(title)
                        .font(FoleviType.display(22))
                        .tracking(FoleviType.displayTracking(22))
                        .foregroundStyle(FoleviColor.heading)
                    if let count {
                        Text(count).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).padding(.leading, 8)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                Spacer()
                SeeAllButton(title: title) { nav.selection = target }
            }
            if let empty {
                Text(empty).font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
            } else {
                content()
            }
        }
        .padding(.top, top)
    }

    @ViewBuilder private func foldersSection(_ org: OrganizationIndex?) -> some View {
        let all = org?.folders ?? []
        let names = Dictionary(all.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let shown = Array(all.sorted { $0.updatedAt > $1.updatedAt }.prefix(folderColumns * 2))
        section(title: "Recent folders", systemImage: "folder", target: .folders, count: org.map { "\($0.folders.count)" }, top: 46,
                empty: org != nil && all.isEmpty ? "No folders yet. Create one from the sidebar to group related notes." : nil) {
            Grid(horizontalSpacing: Self.gap, verticalSpacing: 40) {
                ForEach(0..<max(1, (shown.count + folderColumns - 1) / folderColumns), id: \.self) { row in
                    GridRow {
                        ForEach(0..<folderColumns, id: \.self) { col in
                            let i = row * folderColumns + col
                            if shown.indices.contains(i) {
                                let f = shown[i]
                                FolderCardItem(folder: f, parentName: f.parentFolderId.flatMap { names[$0] },
                                               open: { nav.selection = .folder(f.id) }, openDocument: { nav.open($0) }, present: { folderDialog = $0 })
                            } else {
                                Color.clear.gridCellUnsizedAxes(.vertical)
                            }
                        }
                    }
                }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
            let cols = max(1, Int((width + Self.gap) / (Self.folderMin + Self.gap)))
            if cols != folderColumns { folderColumns = cols }
        }
    }

    private func loadStarred() async {
        guard let session = app.session else { return }
        notes.scopeChanged(session.scope)
        let key = "browser.sidebar.starred"
        if starred == nil, let cached = try? await session.store.codable([DocumentSummary].self, forKey: key) { starred = cached }
        guard app.sync.isOnline else {
            if starred == nil { starred = [] }
            return
        }
        if let docs = try? await session.documents.list(scope: session.scope, view: "starred", tagId: nil) {
            notes.noteStarred(docs, scope: session.scope)
            let local = Dictionary(app.documents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            starred = docs.prefix(Self.carouselCount).map { local[$0.id].map { var d = $0; d.starred = true; d.preview = d.preview ?? docs.first { $0.id == d.id }?.preview; return d } ?? $0 }
                .filter { $0.deletedAt == nil }
            try? await session.store.setCodable(docs, forKey: key)
        } else if starred == nil {
            starred = []
        }
    }
}

/// "See all →" at the end of a Home section heading.
private struct SeeAllButton: View {
    var title: LocalizedStringKey
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text("See all")
                Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold)).accessibilityHidden(true)
            }
            .font(.ui(13, .medium))
            .foregroundStyle(FoleviColor.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? FoleviColor.accentSoft : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text("See all \(Text(title))"))
    }
}

/// One row of note cards that scrolls sideways, with arrow buttons at either end (shown only when there's
/// more to see that way) and the cards fading out at an edge while there's more beyond it.
private struct NoteCarousel: View {
    var docs: [DocumentSummary]?
    var label: String
    var recent = false
    var unsynced: Set<String> = []
    var openDocument: (String, Bool) -> Void
    var present: (NoteDialog) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var position = ScrollPosition(edge: .leading)
    @State private var edges = Edges()

    private struct Edges: Equatable {
        var start = true
        var end = true
        var offset: CGFloat = 0
        var viewport: CGFloat = 0
    }

    private static let count = 10
    private var notes: NoteActions { .shared }

    var body: some View {
        if let docs {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 32) {
                    ForEach(docs.prefix(Self.count)) { doc in
                        HomeNoteCard(doc: doc, recent: recent, unsynced: unsynced.contains(doc.id), openDocument: openDocument, present: present)
                            .frame(width: HomeDashboardView.cardWidth)
                    }
                }
                .scrollTargetLayout()
                .padding(.horizontal, 8)
                .padding(.top, 4)
                // Room for the cards' soft shadow inside the row (its fade mask clips at the frame).
                .padding(.bottom, 52)
            }
            .scrollPosition($position)
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.never)
            .onScrollGeometryChange(for: Edges.self) { geo in
                // The visible rectangle in content coordinates: the content's own 8pt inset doesn't count as
                // scrolled (the raw offset started past the edge test, so the back arrow showed at the start).
                Edges(start: geo.visibleRect.minX <= 10, end: geo.visibleRect.maxX >= geo.contentSize.width - 10,
                      offset: geo.contentOffset.x, viewport: geo.containerSize.width)
            } action: { _, new in edges = new }
            .mask(fadeMask)
            .padding(.horizontal, -8)
            // The extra shadow room overlaps the next section instead of pushing it down.
            .padding(.bottom, -24)
            .overlay(alignment: .leading) {
                if !edges.start { arrow("chevron.left", String(localized: "Scroll \(label.lowercased()) back")) { scroll(-1) } }
            }
            .overlay(alignment: .trailing) {
                if !edges.end { arrow("chevron.right", String(localized: "Scroll \(label.lowercased()) forward")) { scroll(1) } }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(label))
        } else {
            HStack(spacing: 32) {
                ForEach(0..<6, id: \.self) { _ in
                    PulsePlaceholder(radius: 12)
                        .frame(width: HomeDashboardView.cardWidth)
                        .aspectRatio(NoteCard.aspect, contentMode: .fit)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
            .padding(.bottom, 28)
            .clipped()
            .accessibilityElement()
            .accessibilityLabel(Text("Loading"))
        }
    }

    /// The row fades out at an edge while there's more to scroll that way.
    private var fadeMask: some View {
        HStack(spacing: 0) {
            LinearGradient(colors: [edges.start ? .black : .clear, .black], startPoint: .leading, endPoint: .trailing).frame(width: 64)
            Color.black
            LinearGradient(colors: [.black, edges.end ? .black : .clear], startPoint: .leading, endPoint: .trailing).frame(width: 64)
        }
    }

    private func scroll(_ dir: CGFloat) {
        let step = max(HomeDashboardView.cardWidth + 32, edges.viewport - HomeDashboardView.cardWidth / 2)
        let x = max(0, edges.offset + dir * step)
        if reduceMotion { position.scrollTo(x: x) } else { withAnimation(.easeInOut(duration: 0.35)) { position.scrollTo(x: x) } }
    }

    private func arrow(_ systemImage: String, _ label: String, action: @escaping () -> Void) -> some View {
        CarouselArrow(systemImage: systemImage, label: label, action: action)
            .padding(.bottom, 24)
    }
}

private struct CarouselArrow: View {
    var systemImage: String
    var label: String
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(FoleviColor.heading)
                .frame(width: 40, height: 40)
                .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.black.opacity(0.05)))
                .shadow(color: .black.opacity(0.16), radius: 5, y: 2)
                .scaleEffect(hovering ? 1.05 : 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering)
        .accessibilityLabel(Text(label))
    }
}

/// A note on Home: opens on click, drags onto a folder in the sidebar, and has its actions on right-click
/// and in a "…" button that shows on hover (Recent notes adds "Remove from recent").
private struct HomeNoteCard: View {
    let doc: DocumentSummary
    var recent: Bool
    var unsynced: Bool
    var openDocument: (String, Bool) -> Void
    var present: (NoteDialog) -> Void
    @Environment(AppModel.self) private var app
    @State private var hovering = false
    private var notes: NoteActions { .shared }

    var body: some View {
        let folder = doc.folderId.flatMap { id in app.sidebar.folders.first { $0.id == id } }
        var shown = doc
        shown.starred = notes.isStarred(doc)
        let starred = shown.starred == true
        return NoteCard(document: shown, folder: folder, unsynced: unsynced)
            .onTapGesture { openDocument(doc.id, NSEvent.modifierFlags.contains(.option)) }
            .draggable(DocumentDragPayload(documentId: doc.id))
            .contextMenu { menu }
            .overlay(alignment: .topTrailing) {
                GeometryReader { geo in
                    NoteMenuButton(title: doc.displayTitle, raised: true) { menu }
                        .padding(.top, 8)
                        .padding(.trailing, starred ? geo.size.width * 0.12 + 8 : 8)
                        .frame(maxWidth: .infinity, alignment: .topTrailing)
                        .opacity(hovering ? 1 : 0)
                }
            }
            .onHover { hovering = $0 }
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { openDocument(doc.id, false) }
    }

    private var menu: DocumentContextMenu {
        DocumentContextMenu(document: doc, openDocument: openDocument, recent: recent, present: present)
    }
}
