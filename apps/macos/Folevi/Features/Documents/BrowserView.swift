import SwiftUI

/// Document browser: visual cards, compact grid or list; sort by updated/created/title.
struct BrowserView: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var remoteDocs: [DocumentSummary]?
    @State private var loadingRemote = false

    private var selection: SidebarItem { nav.selection }

    private var title: String {
        switch selection {
        case .folder(let id): return app.sidebar.folders.first { $0.id == id }?.name ?? String(localized: "Folder")
        case .tag(let id): return app.sidebar.tags.first { $0.id == id }.map { "#" + $0.name } ?? String(localized: "Tag")
        case .all: return String(localized: "All Documents")
        case .daily: return String(localized: "Daily Notes")
        case .templates: return String(localized: "Templates")
        case .starred: return String(localized: "Starred")
        case .archive: return String(localized: "Archive")
        case .trash: return String(localized: "Trash")
        default: return ""
        }
    }

    private var usesServerList: Bool {
        switch selection {
        case .starred, .tag: return true
        default: return false
        }
    }

    private var documents: [DocumentSummary] {
        var docs: [DocumentSummary]
        if usesServerList {
            // Prefer local copies (fresher offline edits) for documents the server listed.
            let ids = Set((remoteDocs ?? []).map(\.id))
            let local = Dictionary(app.documents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            docs = (remoteDocs ?? []).map { local[$0.id] ?? $0 }.filter { ids.contains($0.id) && $0.deletedAt == nil }
        } else {
            docs = app.documents.filter { d in
                switch selection {
                case .all: return d.kind == .document && d.deletedAt == nil && d.archivedAt == nil && d.parentDocumentId == nil
                case .folder(let id): return d.folderId == id && d.kind == .document && d.deletedAt == nil && d.archivedAt == nil && d.parentDocumentId == nil
                case .daily: return d.kind == .daily && d.deletedAt == nil
                case .templates: return d.kind == .template && d.deletedAt == nil
                case .archive: return d.archivedAt != nil && d.deletedAt == nil
                case .trash: return d.deletedAt != nil
                default: return false
                }
            }
        }
        switch nav.sort {
        case .updated: docs.sort { $0.updatedAt > $1.updatedAt }
        case .created: docs.sort { $0.createdAt > $1.createdAt }
        case .title: docs.sort { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
        }
        if selection == .daily { docs.sort { ($0.dailyDate ?? "") > ($1.dailyDate ?? "") } }
        return docs
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            let docs = documents
            if docs.isEmpty {
                empty
            } else {
                ScrollView {
                    switch nav.layout {
                    case .grid, .compact:
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: nav.layout == .grid ? 220 : 170, maximum: 320), spacing: 18)], spacing: 18) {
                            ForEach(docs) { doc in card(doc) }
                        }
                        .padding(24)
                    case .list:
                        LazyVStack(spacing: 0) {
                            ForEach(docs) { doc in listRow(doc) }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    }
                }
            }
        }
        .background(FoleviColor.canvas)
        .task(id: selection) { await loadRemote() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title).font(FoleviType.display(28)).foregroundStyle(FoleviColor.ink)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("browser.title")
            Text("\(documents.count)").font(.system(size: 13).monospacedDigit()).foregroundStyle(FoleviColor.inkFaint)
            if loadingRemote { ProgressView().controlSize(.small) }
            Spacer()
            if selection == .daily {
                Button("Today") { Task { await openToday() } }
                    .accessibilityIdentifier("browser.today")
            }
            Picker("Layout", selection: $nav.layout) {
                ForEach(BrowserLayout.allCases) { l in
                    Image(systemName: l.systemImage).help(Text(l.title)).accessibilityLabel(Text(l.title)).tag(l)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            Menu {
                Picker("Sort By", selection: $nav.sort) {
                    ForEach(BrowserSort.allCases) { s in Text(s.title).tag(s) }
                }
                .pickerStyle(.inline)
            } label: {
                Label("Sort", systemImage: "arrow.up.arrow.down")
            }
            .fixedSize()
            .accessibilityLabel(Text("Sort documents"))
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .padding(.bottom, 6)
    }

    @ViewBuilder private var empty: some View {
        switch selection {
        case .trash: EmptyStateView(systemImage: "trash", title: "Trash is empty", message: "Documents you delete stay here for 30 days.")
        case .archive: EmptyStateView(systemImage: "archivebox", title: "Nothing archived", message: "Archive documents you want to keep but not see every day.")
        case .starred:
            EmptyStateView(systemImage: "star", title: "No starred documents",
                           message: app.sync.isOnline ? "Star documents to keep them close." : "Starred documents appear here when you're online.")
        case .daily:
            EmptyStateView(systemImage: "sun.max", title: "No daily notes yet", message: "Start today's note to collect thoughts and tasks.", actionTitle: "Open Today") {
                Task { await openToday() }
            }
        case .templates: EmptyStateView(systemImage: "square.on.square.dashed", title: "No templates", message: "Templates you save appear here.")
        default:
            EmptyStateView(systemImage: "doc.on.doc", title: "Nothing here yet", message: "Create a document to begin.", actionTitle: "New Document") {
                Task {
                    var folderId: String?
                    if case .folder(let id) = selection { folderId = id }
                    if let id = await app.createDocument(folderId: folderId) { nav.open(id) }
                }
            }
        }
    }

    private func card(_ doc: DocumentSummary) -> some View {
        FolioCard(document: doc, compact: nav.layout == .compact)
            .onTapGesture { openDocument(doc.id, NSEvent.modifierFlags.contains(.option)) }
            .draggable(DocumentDragPayload(documentId: doc.id)) {
                Text(doc.displayTitle).padding(8).background(RoundedRectangle(cornerRadius: 8).fill(FoleviColor.surfaceRaised))
            }
            .contextMenu { DocumentContextMenu(document: doc, openDocument: openDocument) }
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("doc.\(doc.displayTitle)")
            .accessibilityAction { openDocument(doc.id, false) }
    }

    private func listRow(_ doc: DocumentSummary) -> some View {
        HStack(spacing: 12) {
            Text(doc.icon ?? "📄").frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(doc.displayTitle).font(.system(size: 13, weight: .medium)).foregroundStyle(FoleviColor.ink)
                if !doc.excerpt.isEmpty { Text(doc.excerpt).font(.caption).foregroundStyle(FoleviColor.inkMuted).lineLimit(1) }
            }
            Spacer()
            Text(Date(timeIntervalSince1970: doc.updatedAt / 1000), format: .dateTime.month(.abbreviated).day().hour().minute())
                .font(.caption).foregroundStyle(FoleviColor.inkFaint)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .onTapGesture { openDocument(doc.id, NSEvent.modifierFlags.contains(.option)) }
        .draggable(DocumentDragPayload(documentId: doc.id))
        .contextMenu { DocumentContextMenu(document: doc, openDocument: openDocument) }
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("doc.\(doc.displayTitle)")
    }

    private func loadRemote() async {
        guard usesServerList, let session = app.session else {
            remoteDocs = nil
            return
        }
        let key = "browser.\(selection.accessibilityId)"
        if let cached = try? await session.store.codable([DocumentSummary].self, forKey: key) { remoteDocs = cached }
        guard app.sync.isOnline else { return }
        loadingRemote = true
        defer { loadingRemote = false }
        let view: String
        var tagId: String?
        switch selection {
        case .starred: view = "starred"
        case .tag(let id):
            view = "tag"
            tagId = id
        default: return
        }
        if let docs = try? await session.documents.list(workspaceId: session.workspaceId, view: view, tagId: tagId) {
            remoteDocs = docs
            try? await session.store.setCodable(docs, forKey: key)
        }
    }

    private func openToday() async {
        if let id = await app.dailyNoteId(for: TaskLogic.localDate()) { openDocument(id, false) }
    }
}

/// Context menu shared by cards and list rows.
struct DocumentContextMenu: View {
    let document: DocumentSummary
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        Button("Open") { openDocument(document.id, false) }
        Button("Open in New Window") { openDocument(document.id, true) }
        Divider()
        if document.deletedAt == nil {
            Button(document.starred == true ? "Unstar" : "Star") {
                let starred = !(document.starred ?? false)
                app.perform(String(localized: "Starring")) { try await $0.documents.setStarred(document.id, starred) }
            }
            Menu("Move to Folder") {
                Button("No Folder") { Task { await app.updateDocument(document.id, patch: WireDocumentPatch(folderId: .some(nil))) } }
                ForEach(app.sidebar.folders) { f in
                    Button(f.name) { Task { await app.updateDocument(document.id, patch: WireDocumentPatch(folderId: .some(f.id))) } }
                }
            }
            Button("Duplicate") {
                app.perform(String(localized: "Duplicating")) { session in
                    let copy = try await session.documents.duplicate(document.id)
                    await session.engine.storeDocuments([copy])
                }
            }
            Button(document.archivedAt == nil ? "Archive" : "Unarchive") {
                let archive = document.archivedAt == nil
                app.perform(String(localized: "Archiving")) { try await $0.documents.setArchived(document.id, archive) }
            }
            Divider()
            Button("Move to Trash", role: .destructive) {
                app.perform(String(localized: "Moving to Trash")) { try await $0.documents.moveToTrash(document.id) }
            }
        } else {
            Button("Restore") {
                app.perform(String(localized: "Restoring")) { try await $0.documents.restoreFromTrash(document.id) }
            }
        }
    }
}
