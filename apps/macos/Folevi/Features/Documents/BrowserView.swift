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
        case .notes: return String(localized: "All notes")
        case .drafts: return String(localized: "Drafts")
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
                // Former Daily Notes are ordinary pages now.
                case .notes: return (d.kind == .document || d.kind == .daily) && d.deletedAt == nil && d.archivedAt == nil && d.parentDocumentId == nil
                // Drafts: notes that aren't in a folder yet.
                case .drafts: return d.folderId == nil && (d.kind == .document || d.kind == .daily) && d.deletedAt == nil && d.archivedAt == nil && d.parentDocumentId == nil
                case .folder(let id): return d.folderId == id && (d.kind == .document || d.kind == .daily) && d.deletedAt == nil && d.archivedAt == nil && d.parentDocumentId == nil
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
        return docs
    }

    var body: some View {
        let docs = documents
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header(count: docs.count)
                if selection == .templates {
                    BuiltInTemplatesSection(openDocument: openDocument)
                }
                if docs.isEmpty {
                    empty.frame(minHeight: 420)
                } else {
                    switch nav.layout {
                    case .grid, .compact:
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: nav.layout == .grid ? 230 : 188, maximum: nav.layout == .grid ? 290 : 340), spacing: nav.layout == .grid ? 32 : 20)], spacing: nav.layout == .grid ? 36 : 20) {
                            ForEach(docs) { doc in card(doc) }
                        }
                        .padding(.top, 22)
                    case .list:
                        LazyVStack(spacing: 0) {
                            ForEach(Array(docs.enumerated()), id: \.element.id) { idx, doc in
                                listRow(doc)
                                if idx < docs.count - 1 { FoleviColor.line.frame(height: 1).padding(.leading, 52).opacity(0.8) }
                            }
                        }
                        .padding(.vertical, 6)
                        .foleviCard(radius: 18)
                        .padding(.top, 22)
                    }
                }
            }
            .padding(.horizontal, 32)
            .padding(.top, 30)
            .padding(.bottom, 40)
        }
        .scrollContentBackground(.hidden)
        .task(id: selection) { await loadRemote() }
    }

    private func header(count: Int) -> some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .foleviViewTitle(size: 34)
                    .accessibilityIdentifier("browser.title")
                HStack(spacing: 8) {
                    Text(count == 1 ? String(localized: "1 document") : String(localized: "\(count) documents"))
                        .font(.ui(14))
                        .foregroundStyle(FoleviColor.inkMuted)
                    if loadingRemote { ProgressView().controlSize(.mini) }
                }
            }
            Spacer(minLength: 12)
            Menu {
                Picker("Sort By", selection: $nav.sort) {
                    ForEach(BrowserSort.allCases) { s in Text(s.title).tag(s) }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 6) {
                    Text("Sort").foregroundStyle(FoleviColor.inkMuted)
                    Text(nav.sort.title).foregroundStyle(FoleviColor.ink)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(FoleviColor.inkMuted)
                }
                .font(.ui(13, .medium))
                .padding(.horizontal, 12)
                .frame(height: 30)
                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel(Text("Sort documents"))
            FoleviSegmented(selection: $nav.layout, items: BrowserLayout.allCases.map { .init(value: $0, title: $0.title, systemImage: $0.systemImage) },
                            showTitles: false, height: 26, fontSize: 12.5, accessibilityLabel: "Layout")
                .frame(width: 118)
        }
    }

    @ViewBuilder private var empty: some View {
        switch selection {
        case .trash: EmptyStateView(systemImage: "trash", title: "Trash is empty", message: "Documents you delete stay here for 30 days.")
        case .archive: EmptyStateView(systemImage: "archivebox", title: "Nothing archived", message: "Archive documents you want to keep but not see every day.")
        case .starred:
            EmptyStateView(systemImage: "star", title: "No starred documents",
                           message: app.sync.isOnline ? "Star documents to keep them close." : "Starred documents appear here when you're online.")
        case .templates: EmptyStateView(systemImage: "square.on.square.dashed", title: "No templates of your own yet", message: "Save a page as a template and it appears here.")
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
        let folder = doc.folderId.flatMap { id in app.sidebar.folders.first { $0.id == id } }
        return Group {
            if nav.layout == .compact {
                CompactNoteCard(document: doc, folder: folder)
            } else {
                NoteCard(document: doc, folder: folder)
            }
        }
            .onTapGesture { openDocument(doc.id, NSEvent.modifierFlags.contains(.option)) }
            .draggable(DocumentDragPayload(documentId: doc.id)) {
                Text(doc.displayTitle).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading)
                    .padding(.horizontal, 16).frame(height: 36).foleviSurface(.color(FoleviColor.surface), shape: .capsule, shadow: FoleviShadow.lift)
            }
            .contextMenu { DocumentContextMenu(document: doc, openDocument: openDocument) }
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("doc.\(doc.displayTitle)")
            .accessibilityAction { openDocument(doc.id, false) }
    }

    private func listRow(_ doc: DocumentSummary) -> some View {
        BrowserListRow(doc: doc)
            .contentShape(Rectangle())
            .onTapGesture { openDocument(doc.id, NSEvent.modifierFlags.contains(.option)) }
            .draggable(DocumentDragPayload(documentId: doc.id))
            .contextMenu { DocumentContextMenu(document: doc, openDocument: openDocument) }
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
        if let docs = try? await session.documents.list(scope: session.scope, view: view, tagId: tagId) {
            remoteDocs = docs
            try? await session.store.setCodable(docs, forKey: key)
        }
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

private struct BrowserListRow: View {
    var doc: DocumentSummary
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 12) {
            Text(doc.icon ?? "📄")
                .font(.system(size: 15))
                .frame(width: 30, height: 30)
                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(9), shadow: FoleviShadow.control)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(doc.displayTitle).font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                if !doc.excerpt.isEmpty { Text(doc.excerpt).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1) }
            }
            Spacer()
            Text(Date(timeIntervalSince1970: doc.updatedAt / 1000), format: .relative(presentation: .named))
                .font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hovering ? FoleviColor.accentSoft.opacity(0.6) : .clear).padding(.horizontal, 6))
        .onHover { hovering = $0 }
    }
}
