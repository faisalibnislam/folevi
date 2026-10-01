import Observation
import SwiftUI

/// Every folder and tag of the open scope with counts, last updates and previews (organization:index), kept
/// for Home's Recent folders and the Folders and Tags pages. Offline it is worked out from this Mac's notes.
@MainActor
@Observable
final class OrganizationIndexStore {
    static let shared = OrganizationIndexStore()

    private(set) var index: OrganizationIndex?
    private(set) var scopeKey: String?
    /// Bumped when a folder changed here, so views fetch again.
    private(set) var revision = 0

    func invalidate() { revision += 1 }

    func load(app: AppModel) async {
        guard let session = app.session else { return }
        if scopeKey != session.scope.key {
            scopeKey = session.scope.key
            index = nil
        }
        let key = "organization.index.\(session.scope.key)"
        if index == nil, let cached = try? await session.store.codable(OrganizationIndex.self, forKey: key) { index = cached }
        if app.sync.isOnline, let fresh = try? await session.organization.index(scope: session.scope) {
            index = fresh
            try? await session.store.setCodable(fresh, forKey: key)
        } else if index == nil || !app.sync.isOnline {
            index = Self.local(app: app, previous: index)
        }
    }

    /// The same numbers from this Mac's notes (offline): top-level notes, not archived, not in Trash.
    static func local(app: AppModel, previous: OrganizationIndex?) -> OrganizationIndex {
        let docs = app.documents.filter { $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil && $0.kind != .template }
        let known = Dictionary((previous?.folders ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let folders = app.sidebar.folders.map { f -> OrganizationIndex.Folder in
            let inside = docs.filter { $0.folderId == f.id }.sorted { $0.updatedAt > $1.updatedAt }
            var row = OrganizationIndex.Folder(id: f.id, name: f.name, color: f.color, parentFolderId: f.parentFolderId,
                                               createdAt: known[f.id]?.createdAt ?? 0,
                                               updatedAt: max(known[f.id]?.updatedAt ?? 0, inside.first?.updatedAt ?? 0),
                                               documentCount: inside.count)
            row.previews = inside.prefix(3).map { .init(cover: $0.cover, title: $0.title, excerpt: String($0.excerpt.prefix(280))) }
            return row
        }
        let knownTags = Dictionary((previous?.tags ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let tags = app.sidebar.tags.map { t in
            OrganizationIndex.Tag(id: t.id, name: t.name, color: t.color, createdAt: knownTags[t.id]?.createdAt ?? 0,
                                  documentCount: knownTags[t.id]?.documentCount ?? docs.filter { ($0.tags ?? []).contains { $0.id == t.id } }.count)
        }
        return OrganizationIndex(folders: folders, tags: tags)
    }
}

extension OrganizationIndex.Folder {
    var info: FolderInfo { FolderInfo(id: id, name: name, icon: nil, parentFolderId: parentFolderId, rank: rank ?? "", color: color) }
}

/// A folder card with its menu over the front cover on hover (Home's Recent folders and the Folders page).
struct FolderCardItem: View {
    let folder: OrganizationIndex.Folder
    var parentName: String?
    var open: () -> Void
    var openDocument: (String) -> Void
    var present: (FolderDialog) -> Void
    @State private var hovering = false

    var body: some View {
        FolderCard(folder: folder.info, documentCount: folder.documentCount, updatedAt: folder.updatedAt > 0 ? folder.updatedAt : nil,
                   parentName: parentName, previews: folder.previews ?? [])
            .onTapGesture(perform: open)
            .accessibilityAction(.default, open)
            .overlay {
                GeometryReader { geo in
                    Menu {
                        FolderMenuItems(folder: folder.info, openDocument: openDocument, present: present)
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color(red: 0.09, green: 0.09, blue: 0.1).opacity(0.75))
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .background(Color.white.opacity(0.9), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .shadow(color: .black.opacity(0.18), radius: 1.5, y: 1)
                    .help(Text("Folder options for \(folder.name)"))
                    .accessibilityLabel(Text("Folder options for \(folder.name)"))
                    .position(x: geo.size.width / 2, y: geo.size.height * 0.7)
                    .opacity(hovering ? 1 : 0)
                    .allowsHitTesting(hovering)
                }
            }
            .onHover { hovering = $0 }
            .contextMenu { FolderMenuItems(folder: folder.info, openDocument: openDocument, present: present) }
    }
}

/// Every folder in the open scope, with search, sorting and a grid or list (the web's FoldersIndex).
struct FoldersIndexView: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @AppStorage("folevi:folders-sort") private var sort: OrganizationIndex.FolderSort = .name
    @AppStorage("folevi:folders-layout") private var layout: String = "grid"
    @State private var creating = false
    @State private var dialog: FolderDialog?
    private var store: OrganizationIndexStore { .shared }

    private struct ReloadKey: Equatable { var documents: Int; var folders: [FolderInfo]; var online: Bool; var revision: Int }

    var body: some View {
        let data = store.scopeKey == app.scope.key ? store.index : nil
        let all = data?.folders ?? []
        let list = OrganizationIndex.folders(all, query: query, sort: sort)
        let names = Dictionary(all.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if app.canEditHere {
                    ViewBar(subtitle: nil) {
                        Button { creating = true } label: { Label("New folder", systemImage: "folder.badge.plus") }
                            .buttonStyle(.folevi(.primary, .small))
                    }
                }
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 12) {
                        BrowseSearchField(text: $query, placeholder: String(localized: "Search folders"))
                        Text(data == nil ? String(localized: "Loading…")
                             : OrganizationIndex.countText(shown: list.count, total: all.count, searching: !query.trimmingCharacters(in: .whitespaces).isEmpty, noun: "folder"))
                            .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                            .accessibilityAddTraits(.updatesFrequently)
                        Spacer(minLength: 0)
                        SortField(selection: $sort, options: [
                            .init(value: .name, title: String(localized: "Name")),
                            .init(value: .updated, title: String(localized: "Last updated")),
                            .init(value: .count, title: String(localized: "Most pages")),
                            .init(value: .created, title: String(localized: "Newest")),
                        ], height: 36)
                        IconRadioGroup(selection: $layout, items: [
                            .init(value: "grid", label: String(localized: "Grid"), systemImage: "square.grid.2x2"),
                            .init(value: "list", label: String(localized: "List"), systemImage: "rectangle.grid.1x2"),
                        ], accessibilityLabel: String(localized: "Layout"))
                    }
                    if data != nil && list.isEmpty {
                        Text(query.trimmingCharacters(in: .whitespaces).isEmpty ? String(localized: "No folders yet. Create one to group related pages.")
                             : String(localized: "No folders match “\(query.trimmingCharacters(in: .whitespaces))”."))
                            .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 64)
                    } else if layout == "grid" {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 32)], spacing: 40) {
                            ForEach(list) { f in
                                FolderCardItem(folder: f, parentName: f.parentFolderId.flatMap { names[$0] },
                                               open: { nav.selection = .folder(f.id) }, openDocument: { nav.open($0) }, present: { dialog = $0 })
                            }
                        }
                        .padding(.top, 24)
                        .accessibilityLabel(Text("Folders"))
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(list.enumerated()), id: \.element.id) { i, f in
                                FolderListRow(folder: f, parentName: f.parentFolderId.map { names[$0] ?? String(localized: "a folder") },
                                              open: { nav.selection = .folder(f.id) }, openDocument: { nav.open($0) }, present: { dialog = $0 })
                                if i < list.count - 1 { FoleviColor.line.frame(height: 1) }
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .foleviCard(radius: 6)
                        .padding(.top, 24)
                        .accessibilityLabel(Text("Folders"))
                    }
                }
                .frame(maxWidth: 1152, alignment: .leading)
                .padding(.horizontal, 32)
                .padding(.top, 12)
                .padding(.bottom, 96)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollContentBackground(.hidden)
        .task(id: ReloadKey(documents: app.documentsRevision, folders: app.sidebar.folders, online: app.sync.isOnline, revision: store.revision)) {
            await store.load(app: app)
        }
        .sheet(isPresented: $creating) {
            PromptSheet(title: String(localized: "New folder"), label: String(localized: "Folder name"), confirmTitle: String(localized: "Create folder")) { name in
                createFolder(name)
            }
            .environment(app)
        }
        .folderDialogs($dialog)
    }

    private func createFolder(_ name: String) {
        guard let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        Task {
            do {
                let id = try await session.organization.createFolderReturningId(scope: session.scope, name: name)
                store.invalidate()
                nav.selection = .folder(id)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

/// A folder in the Folders page's list layout.
private struct FolderListRow: View {
    let folder: OrganizationIndex.Folder
    var parentName: String?
    var open: () -> Void
    var openDocument: (String) -> Void
    var present: (FolderDialog) -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 12) {
            FolderGlyph(color: folder.color, size: 24)
            HStack(spacing: 8) {
                Text(folder.name).font(.ui(14, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                if let parentName { Text("in \(parentName)").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(BrowseFormat.pages(folder.documentCount)).font(.ui(12)).monospacedDigit().foregroundStyle(FoleviColor.inkMuted)
                .frame(width: 80, alignment: .trailing)
            Text(folder.updatedAt > 0 ? CollabTime.relative(folder.updatedAt) : "").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                .frame(width: 128, alignment: .trailing)
            Color.clear.frame(width: 32, height: 1)
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .padding(.vertical, 10)
        .background(hovering ? FoleviColor.accentSoft.opacity(0.5) : .clear)
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
        .overlay(alignment: .trailing) {
            NoteMenuButton(title: folder.name) {
                FolderMenuItems(folder: folder.info, openDocument: openDocument, present: present)
            }
            .help(Text("Folder options for \(folder.name)"))
            .padding(.trailing, 12)
            .opacity(hovering ? 1 : 0)
        }
        .onHover { hovering = $0 }
        .contextMenu { FolderMenuItems(folder: folder.info, openDocument: openDocument, present: present) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(.default, open)
    }
}

/// Every tag in the open scope, with search and sorting (the web's TagsIndex).
struct TagsIndexView: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @AppStorage("folevi:tags-sort") private var sort: OrganizationIndex.TagSort = .name
    private var store: OrganizationIndexStore { .shared }

    private struct ReloadKey: Equatable { var documents: Int; var tags: [TagInfo]; var online: Bool; var revision: Int }

    var body: some View {
        let data = store.scopeKey == app.scope.key ? store.index : nil
        let all = data?.tags ?? []
        let list = OrganizationIndex.tags(all, query: query, sort: sort)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    BrowseSearchField(text: $query, placeholder: String(localized: "Search tags"))
                    Text(data == nil ? String(localized: "Loading…")
                         : OrganizationIndex.countText(shown: list.count, total: all.count, searching: !query.trimmingCharacters(in: .whitespaces).isEmpty, noun: "tag"))
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                        .accessibilityAddTraits(.updatesFrequently)
                    Spacer(minLength: 0)
                    SortField(selection: $sort, options: [
                        .init(value: .name, title: String(localized: "Name")),
                        .init(value: .count, title: String(localized: "Most used")),
                        .init(value: .created, title: String(localized: "Newest")),
                    ], height: 36)
                }
                if data != nil && list.isEmpty {
                    Text(query.trimmingCharacters(in: .whitespaces).isEmpty ? String(localized: "No tags yet. Add tags to a page from its Info panel.")
                         : String(localized: "No tags match “\(query.trimmingCharacters(in: .whitespaces))”."))
                        .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 64)
                } else {
                    FlowLayout(spacing: 8) {
                        ForEach(list) { t in
                            TagChipLink(tag: t) { nav.selection = .tag(t.id) }
                        }
                    }
                    .padding(.top, 24)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text("Tags"))
                }
            }
            .frame(maxWidth: 1152, alignment: .leading)
            .padding(.horizontal, 32)
            .padding(.top, 12)
            .padding(.bottom, 96)
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
        .task(id: ReloadKey(documents: app.documentsRevision, tags: app.sidebar.tags, online: app.sync.isOnline, revision: store.revision)) {
            await store.load(app: app)
        }
    }
}

/// A tag on the Tags page: its hash in the tag's colour, its name and how many pages carry it.
private struct TagChipLink: View {
    let tag: OrganizationIndex.Tag
    var open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                Image(systemName: "number").font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.folevi(tag: tag.color)).accessibilityHidden(true)
                Text(tag.name).font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.ink)
                Text(BrowseFormat.pages(tag.documentCount))
                    .font(.ui(11)).monospacedDigit().foregroundStyle(FoleviColor.inkMuted)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .accessibilityLabel(Text(", \(BrowseFormat.pages(tag.documentCount))"))
            }
            .padding(.leading, 12)
            .padding(.trailing, 8)
            .frame(height: 36)
            .background {
                Color.clear.foleviSurface(.color(hovering ? FoleviColor.accentSoft : FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
