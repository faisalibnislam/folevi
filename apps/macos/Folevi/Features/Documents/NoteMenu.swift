import SwiftUI

/// A dialog a note's menu (or the selection bar) asks its list to show.
enum NoteDialog: Identifiable {
    /// Move to folder: the notes, the first one's title, and where they are now (`.none` when mixed).
    case move(ids: [String], title: String?, current: String??)
    case deletePermanently(id: String, title: String)
    /// Several trashed notes at once.
    case deleteSelection(ids: [String])
    case emptyTrash

    var id: String {
        switch self {
        case .move(let ids, _, _): return "move." + ids.joined(separator: ",")
        case .deletePermanently(let id, _): return "delete." + id
        case .deleteSelection(let ids): return "deleteAll." + ids.joined(separator: ",")
        case .emptyTrash: return "emptyTrash"
        }
    }
}

/// A note's actions (its right-click menu and its "…" button), as the web's card menu: New page from template,
/// Open, Open in new tab, Star, Duplicate, Move to folder…, Archive, Remove from recent (Home), Select, Move
/// up / Move down (manual order), Move to Trash; in the Trash, Restore, Select and Delete permanently….
struct DocumentContextMenu: View {
    let document: DocumentSummary
    var openDocument: (String, Bool) -> Void
    /// Offer "Remove from recent" (Home's Recent notes).
    var recent = false
    /// Offer "Select" / "Deselect" (the keyboard way into multi-select).
    var select: (selected: Bool, toggle: () -> Void)?
    /// Offer "Move up" / "Move down" (a list in manual order).
    var arrange: (up: () -> Void, down: () -> Void)?
    /// Shows a dialog (Move to folder…, Delete permanently…) over the list.
    var present: ((NoteDialog) -> Void)?
    @Environment(AppModel.self) private var app

    private var actions: NoteActions { .shared }
    private var ids: [String] { [document.id] }

    var body: some View {
        if document.deletedAt != nil {
            Button { actions.restore(ids, app: app) } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
            selectItem
            Divider()
            Button(role: .destructive) {
                present?(.deletePermanently(id: document.id, title: document.title))
            } label: { Label("Delete permanently…", systemImage: "trash") }
            .disabled(present == nil)
        } else {
            if document.kind == .template {
                Button { Templates.use(document.id, title: document.title, app: app, open: { openDocument($0, false) }) } label: {
                    Label("New page from template", systemImage: "doc.badge.plus")
                }
            }
            Button { openDocument(document.id, false) } label: {
                Label(document.kind == .template ? "Edit template" : "Open", systemImage: "arrow.up.right.square")
            }
            // As the web's card menu: a new tab (a window where there are no tabs).
            Button {
                if let tab = OpenWindowBridge.shared.openInNewTab { tab(document.id) } else { openDocument(document.id, true) }
            } label: { Label("Open in new tab", systemImage: "arrow.up.right.square") }
            if actions.isStarred(document) {
                Button { actions.star(ids, false, app: app) } label: { Label("Unstar", systemImage: "star.slash") }
            } else {
                Button { actions.star(ids, true, app: app) } label: { Label("Star", systemImage: "star") }
            }
            Button {
                app.perform(String(localized: "Duplicating")) { session in
                    let copy = try await session.documents.duplicate(document.id)
                    await session.engine.storeDocuments([copy])
                    await MainActor.run { app.showToast(String(localized: "Duplicated")) }
                }
            } label: { Label("Duplicate", systemImage: "doc.on.doc") }
            if document.kind != .template, let present {
                Button {
                    present(.move(ids: ids, title: document.title, current: .some(document.folderId)))
                } label: { Label("Move to folder…", systemImage: "folder") }
            }
            if document.archivedAt != nil {
                Button { actions.archive(ids, false, app: app) } label: { Label("Unarchive", systemImage: "archivebox") }
            } else {
                Button { actions.archive(ids, true, app: app) } label: { Label("Archive", systemImage: "archivebox") }
            }
            if recent {
                Button { actions.removeFromRecent(ids, app: app) } label: { Label("Remove from recent", systemImage: "eye.slash") }
            }
            selectItem
            if let arrange {
                Divider()
                Button(action: arrange.up) { Label("Move up", systemImage: "arrow.up") }
                Button(action: arrange.down) { Label("Move down", systemImage: "arrow.down") }
            }
            Divider()
            Button(role: .destructive) { actions.trash(ids, app: app) } label: { Label("Move to Trash", systemImage: "trash") }
        }
    }

    @ViewBuilder private var selectItem: some View {
        if let select {
            Button(action: select.toggle) { Label(select.selected ? "Deselect" : "Select", systemImage: "checkmark.square") }
        }
    }
}

/// New pages from templates, through the sync engine (so it works offline, as on the web): the server fills
/// in the template's blocks when the page syncs.
@MainActor
enum Templates {
    /// "Use" / "New page from template": a page titled like the template (a built-in's key is "builtin:…").
    static func use(_ templateId: String, title: String, app: AppModel, open: @escaping (String) -> Void) {
        Task {
            if let id = await app.createDocument(title: title, templateId: templateId) { open(id) }
        }
    }

    /// "New template": an empty template page.
    static func newTemplate(app: AppModel, open: @escaping (String) -> Void) {
        Task {
            if let id = await app.createDocument(folderId: nil, kind: .template) { open(id) }
        }
    }
}

extension View {
    /// Presents the dialogs a note list's menus and selection bar ask for.
    func noteDialogs(_ dialog: Binding<NoteDialog?>, onDone: @escaping () -> Void = {}) -> some View {
        modifier(NoteDialogsModifier(dialog: dialog, onDone: onDone))
    }
}

private struct NoteDialogsModifier: ViewModifier {
    @Binding var dialog: NoteDialog?
    var onDone: () -> Void
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        content.sheet(item: $dialog) { d in
            Group {
                switch d {
                case .move(let ids, let title, let current):
                    MoveToFolderSheet(count: ids.count, noteTitle: title, currentFolderId: current) { folder in
                        onDone()
                        NoteActions.shared.moveTo(ids, folder, app: app)
                    }
                case .deletePermanently(let id, let title):
                    PermanentDeleteSheet(documentId: id, title: title)
                case .deleteSelection(let ids):
                    DeleteSelectionSheet(ids: ids, onDone: onDone)
                case .emptyTrash:
                    EmptyTrashSheet(onDone: onDone)
                }
            }
            .environment(app)
        }
    }
}

/// Several trashed notes, deleted for good (the selection bar's "Delete permanently…").
private struct DeleteSelectionSheet: View {
    var ids: [String]
    var onDone: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        FoleviDialog(title: ids.count == 1 ? String(localized: "Delete 1 note permanently?") : String(localized: "Delete \(ids.count.formatted()) notes permanently?"),
                     message: String(localized: "They’ll be deleted for everyone, with their nested pages, attachments and version history. This can’t be undone. Notes you don’t have permission to delete stay in Trash."),
                     confirmTitle: String(localized: "Delete permanently")) {
            dismiss()
            onDone()
            NoteActions.shared.deleteForever(ids, app: app)
        }
    }
}

/// "Empty Trash?" with how many notes it would delete for you (documents:trashSummary).
private struct EmptyTrashSheet: View {
    var onDone: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var summary: TrashSummary?
    @State private var failed = false

    var body: some View {
        FoleviDialog(title: String(localized: "Empty Trash?"), message: text, confirmTitle: String(localized: "Delete permanently"),
                     confirmDisabled: (summary?.deletable ?? 0) == 0) {
            empty()
        }
        .task { await load() }
    }

    private var text: String {
        if let s = summary { return Organize.emptyTrashText(total: Int(s.total), deletable: Int(s.deletable), more: s.more) }
        return failed ? String(localized: "This needs a connection. Try again when you're back online.") : String(localized: "Counting the notes in Trash…")
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else {
            failed = true
            return
        }
        do { summary = try await session.documents.trashSummary(scope: session.scope) } catch { failed = true }
    }

    private func empty() {
        guard let session = app.session else { return }
        let count = Int(summary?.deletable ?? 0)
        dismiss()
        onDone()
        Task {
            do {
                let r = try await session.documents.emptyTrash(scope: session.scope)
                app.showToast(Organize.trashScheduled(max(count, Int(r.scheduled))))
                await session.engine.syncNow()
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}
