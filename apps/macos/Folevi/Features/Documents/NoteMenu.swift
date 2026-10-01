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

/// A note's actions on right-click, as the web's card menu: open, star, duplicate, move to a folder,
/// archive, Remove from recent (Home), Select, Move to Trash; in the Trash, Restore and Delete permanently.
struct DocumentContextMenu: View {
    let document: DocumentSummary
    var openDocument: (String, Bool) -> Void
    /// Offer "Remove from recent" (Home's Recent notes).
    var recent = false
    /// Offer "Select" / "Deselect" (the keyboard way into multi-select).
    var select: (selected: Bool, toggle: () -> Void)?
    /// Shows a dialog (Move to folder…, Delete permanently…) over the list.
    var present: ((NoteDialog) -> Void)?
    @Environment(AppModel.self) private var app

    private var actions: NoteActions { .shared }
    private var ids: [String] { [document.id] }

    var body: some View {
        if document.deletedAt != nil {
            Button("Restore") { actions.restore(ids, app: app) }
            selectItem
            Divider()
            Button("Delete permanently…", role: .destructive) {
                present?(.deletePermanently(id: document.id, title: document.title))
            }
            .disabled(present == nil)
        } else {
            if document.kind == .template {
                Button("New page from template") { useTemplate() }
            }
            Button(document.kind == .template ? "Edit template" : "Open") { openDocument(document.id, false) }
            Button("Open in new window") { openDocument(document.id, true) }
            if actions.isStarred(document) {
                Button("Unstar") { actions.star(ids, false, app: app) }
            } else {
                Button("Star") { actions.star(ids, true, app: app) }
            }
            Button("Duplicate") {
                app.perform(String(localized: "Duplicating")) { session in
                    let copy = try await session.documents.duplicate(document.id)
                    await session.engine.storeDocuments([copy])
                    await MainActor.run { app.showToast(String(localized: "Duplicated")) }
                }
            }
            if document.kind != .template, let present {
                Button("Move to folder…") {
                    present(.move(ids: ids, title: document.title, current: .some(document.folderId)))
                }
            }
            if document.archivedAt != nil {
                Button("Unarchive") { actions.archive(ids, false, app: app) }
            } else {
                Button("Archive") { actions.archive(ids, true, app: app) }
            }
            if recent {
                Button("Remove from recent") { actions.removeFromRecent(ids, app: app) }
            }
            selectItem
            Divider()
            Button("Move to Trash", role: .destructive) { actions.trash(ids, app: app) }
        }
    }

    @ViewBuilder private var selectItem: some View {
        if let select {
            Button(select.selected ? "Deselect" : "Select") { select.toggle() }
        }
    }

    private func useTemplate() {
        guard let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "Templates need a connection. Try again when you're online."))
            return
        }
        let id = ULID.make()
        let title = document.title
        let templateId = document.id
        Task {
            do {
                try await session.documents.createFromTemplate(id: id, scope: session.scope, templateId: templateId, title: title, folderId: nil)
                await session.engine.syncNow()
                openDocument(id, false)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
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
