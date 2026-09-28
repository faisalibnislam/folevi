import SwiftUI

/// Home (the web's HomeDashboard): recent notes and starred notes (the latest 10 each, in a row that
/// scrolls sideways) and recent folders (two rows), each with "See all".
struct HomeDashboardView: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var starred: [DocumentSummary]?

    private static let cardWidth: CGFloat = 250
    private static let carouselCount = 10

    private var recent: [DocumentSummary] {
        app.documents
            .filter { ($0.kind == .document || $0.kind == .daily) && $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(Self.carouselCount)
            .map { $0 }
    }

    private struct FolderStats { var count: Int; var updatedAt: Double? }

    private var folderStats: [String: FolderStats] {
        var out: [String: FolderStats] = [:]
        for d in app.documents where d.deletedAt == nil && d.archivedAt == nil {
            guard let f = d.folderId else { continue }
            var s = out[f] ?? FolderStats(count: 0, updatedAt: nil)
            s.count += 1
            s.updatedAt = max(s.updatedAt ?? 0, d.updatedAt)
            out[f] = s
        }
        return out
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if app.profile?.aiOn == true {
                    CatchUpView(openDocument: { openDocument($0, false) })
                        .padding(.top, 16)
                }
                section(title: "Recent notes", systemImage: "clock", target: .notes, first: true) {
                    if recent.isEmpty {
                        emptyText("No notes yet. Press New to write your first one.")
                    } else {
                        carousel(recent)
                    }
                }
                section(title: "Starred", systemImage: "star", target: .starred) {
                    if let starred, starred.isEmpty {
                        emptyText("Star notes you come back to often and they’ll appear here.")
                    } else if let starred {
                        carousel(starred)
                    } else {
                        ProgressView().controlSize(.small).frame(height: 80)
                    }
                }
                foldersSection
            }
            .frame(maxWidth: 1400, alignment: .leading)
            .padding(.horizontal, 32)
            .padding(.top, 8)
            .padding(.bottom, 40)
        }
        .scrollContentBackground(.hidden)
        .task(id: app.documentsRevision) { await loadStarred() }
    }

    private func section<Content: View>(title: LocalizedStringKey, systemImage: String, target: SidebarItem, count: String? = nil, first: Bool = false,
                                         @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(FoleviColor.heading)
                    .frame(width: 32, height: 32)
                    .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityHidden(true)
                Text(title)
                    .font(FoleviType.display(22))
                    .tracking(FoleviType.displayTracking(22))
                    .foregroundStyle(FoleviColor.heading)
                    .accessibilityAddTraits(.isHeader)
                if let count {
                    Text(count).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).padding(.leading, 4)
                }
                Spacer()
                Button {
                    nav.selection = target
                } label: {
                    HStack(spacing: 4) {
                        Text("See all")
                        Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold))
                    }
                    .font(.ui(13, .medium))
                    .foregroundStyle(FoleviColor.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("See all \(Text(title))"))
            }
            content()
        }
        .padding(.top, first ? 24 : 37)
    }

    private func emptyText(_ text: LocalizedStringKey) -> some View {
        Text(text).font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
    }

    private func carousel(_ docs: [DocumentSummary]) -> some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 32) {
                ForEach(docs) { doc in
                    let folder = doc.folderId.flatMap { id in app.sidebar.folders.first { $0.id == id } }
                    NoteCard(document: doc, folder: folder)
                        .frame(width: Self.cardWidth)
                        .onTapGesture { openDocument(doc.id, NSEvent.modifierFlags.contains(.option)) }
                        .contextMenu { DocumentContextMenu(document: doc, openDocument: openDocument) }
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { openDocument(doc.id, false) }
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 4)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.never)
        .scrollClipDisabled()
        .padding(.horizontal, -8)
    }

    private var foldersSection: some View {
        let stats = folderStats
        let folders = app.sidebar.folders.sorted { (stats[$0.id]?.updatedAt ?? 0) > (stats[$1.id]?.updatedAt ?? 0) }
        return section(title: "Recent folders", systemImage: "folder", target: .folders, count: "\(folders.count)") {
            if folders.isEmpty {
                emptyText("No folders yet. Create one from the sidebar to group related notes.")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 210, maximum: 300), spacing: 32)], spacing: 40) {
                    ForEach(folders.prefix(10)) { folder in
                        FolderCard(folder: folder, documentCount: stats[folder.id]?.count ?? 0, updatedAt: stats[folder.id]?.updatedAt,
                                   parentName: folder.parentFolderId.flatMap { id in app.sidebar.folders.first { $0.id == id }?.name },
                                   previews: previews(in: folder.id))
                            .onTapGesture { nav.selection = .folder(folder.id) }
                            .accessibilityAction { nav.selection = .folder(folder.id) }
                    }
                }
            }
        }
    }

    /// The three most recently edited notes in a folder.
    private func previews(in folderId: String) -> [DocumentSummary] {
        Array(app.documents
            .filter { $0.folderId == folderId && $0.deletedAt == nil && $0.archivedAt == nil && ($0.kind == .document || $0.kind == .daily) }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(3))
    }

    private func loadStarred() async {
        guard let session = app.session else { return }
        let key = "browser.sidebar.starred"
        if starred == nil, let cached = try? await session.store.codable([DocumentSummary].self, forKey: key) { starred = cached }
        guard app.sync.isOnline else {
            if starred == nil { starred = [] }
            return
        }
        if let docs = try? await session.documents.list(workspaceId: session.workspaceId, view: "starred", tagId: nil) {
            let local = Dictionary(app.documents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            starred = docs.prefix(Self.carouselCount).map { local[$0.id].map { var d = $0; d.starred = true; return d } ?? $0 }.filter { $0.deletedAt == nil }
            try? await session.store.setCodable(docs, forKey: key)
        } else if starred == nil {
            starred = []
        }
    }
}

/// Every folder as a card (the web's /folders).
struct FoldersIndexView: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app

    var body: some View {
        let folders = app.sidebar.folders
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Folders").foleviViewTitle(size: 34)
                    Text(folders.count == 1 ? String(localized: "1 folder") : String(localized: "\(folders.count) folders"))
                        .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                }
                if folders.isEmpty {
                    EmptyStateView(systemImage: "folder", title: "No folders yet", message: "Create one from the sidebar to group related notes.")
                        .frame(minHeight: 420)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 210, maximum: 300), spacing: 32)], spacing: 40) {
                        ForEach(folders) { folder in
                            let docs = app.documents.filter { $0.folderId == folder.id && $0.deletedAt == nil && $0.archivedAt == nil }
                            FolderCard(folder: folder, documentCount: docs.count, updatedAt: docs.map(\.updatedAt).max(),
                                       parentName: folder.parentFolderId.flatMap { id in folders.first { $0.id == id }?.name },
                                       previews: Array(docs.sorted { $0.updatedAt > $1.updatedAt }.prefix(3)))
                                .onTapGesture { nav.selection = .folder(folder.id) }
                                .accessibilityAction { nav.selection = .folder(folder.id) }
                        }
                    }
                }
            }
            .padding(.horizontal, 32)
            .padding(.top, 30)
            .padding(.bottom, 40)
        }
        .scrollContentBackground(.hidden)
    }
}
