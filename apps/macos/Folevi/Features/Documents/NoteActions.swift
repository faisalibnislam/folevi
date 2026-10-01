import Observation
import SwiftUI

/// Something the toast offers to do (Undo), as on the web.
struct ToastAction {
    var title: String
    var run: @MainActor () -> Void

    static func undo(_ run: @escaping @MainActor () -> Void) -> ToastAction {
        ToastAction(title: String(localized: "Undo"), run: run)
    }
}

/// A folder to move notes into; `id: nil` is Drafts (no folder).
struct FolderTarget: Hashable {
    var id: String?
    var name: String

    static var drafts: FolderTarget { FolderTarget(id: nil, name: String(localized: "Drafts")) }
}

/// Actions on one or many notes (multi-select, dragging to a folder, the card menus), with the toast and
/// Undo each one shows (the web's noteActions.ts). Star, archive, Trash, restore and permanent deletion go
/// through documents:bulkUpdate, which checks every note on its own and skips the ones you can't change.
/// Moves go through the sync engine, so they work offline too, and undo the same way.
@MainActor
@Observable
final class NoteActions {
    static let shared = NoteActions()

    /// Your starred notes in the open scope (the server's Starred list, kept in step with your stars).
    private(set) var starredIds: Set<String> = []
    private(set) var starredLoaded = false
    private var starredScope: String?
    /// Bumped after anything that changes lists the server works out (Recent notes, Starred).
    private(set) var revision = 0

    func isStarred(_ doc: DocumentSummary) -> Bool {
        starredLoaded ? starredIds.contains(doc.id) : (doc.starred ?? false)
    }

    /// Takes the server's Starred list for the open scope.
    func noteStarred(_ docs: [DocumentSummary], scope: Scope) {
        starredIds = Set(docs.map(\.id))
        starredScope = scope.key
        starredLoaded = true
    }

    /// One note's star changed from its own page menu.
    func noteStarChanged(_ id: String, _ starred: Bool) {
        if starred { starredIds.insert(id) } else { starredIds.remove(id) }
        revision += 1
    }

    func scopeChanged(_ scope: Scope) {
        guard starredScope != scope.key else { return }
        starredIds = []
        starredLoaded = false
        starredScope = scope.key
    }

    // MARK: Actions

    func moveTo(_ ids: [String], _ folder: FolderTarget, app: AppModel) {
        guard !ids.isEmpty else { return }
        // Where each note is now (nil = Drafts), for Undo; notes this Mac doesn't have aren't undone.
        var previous: [String: String?] = [:]
        for id in ids {
            if let doc = app.document(id) { previous.updateValue(doc.folderId, forKey: id) }
        }
        let moving = ids.filter { id in previous[id].map { $0 != folder.id } ?? true }
        guard !moving.isEmpty else { return }
        Task {
            for id in moving { await app.updateDocument(id, patch: WireDocumentPatch(folderId: .some(folder.id))) }
            app.showToast(Organize.message(for: .move(folderId: folder.id), count: moving.count, folderName: folder.name), action: .undo {
                Task {
                    for group in Organize.moveBack(done: moving.filter { previous[$0] != nil }, previousFolders: previous) {
                        for id in group.ids { await app.updateDocument(id, patch: WireDocumentPatch(folderId: .some(group.folderId))) }
                    }
                }
            })
        }
    }

    func star(_ ids: [String], _ starred: Bool, app: AppModel) {
        let before = starredIds
        if starred { starredIds.formUnion(ids) } else { starredIds.subtract(ids) }
        run(ids, .star(starred), app: app) { self.starredIds = before }
    }

    func archive(_ ids: [String], _ archived: Bool, app: AppModel) { run(ids, .archive(archived), app: app) }
    func trash(_ ids: [String], app: AppModel) { run(ids, .trash, app: app) }
    func restore(_ ids: [String], app: AppModel) { run(ids, .restore, app: app) }
    func deleteForever(_ ids: [String], app: AppModel) { run(ids, .delete, app: app) }

    /// Removes notes from your Recent notes on Home (nobody else's list changes).
    func removeFromRecent(_ ids: [String], app: AppModel) {
        guard let session = app.session, !ids.isEmpty else { return }
        guard app.sync.isOnline else { return offline(app) }
        let batch = Array(ids.prefix(Organize.chunkSize))
        Task {
            do {
                let hidden = try await session.documents.hideFromRecent(batch)
                revision += 1
                guard hidden > 0 else { return }
                app.showToast(hidden == 1 ? String(localized: "Removed from Recent notes") : String(localized: "Removed \(Organize.notes(hidden)) from Recent notes"),
                              action: .undo {
                                  Task {
                                      do {
                                          try await session.documents.showInRecent(batch)
                                          self.revision += 1
                                      } catch {
                                          app.showToast(ConvexService.mapError(error).localizedDescription)
                                      }
                                  }
                              })
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    /// Runs a bulk action in chunks of 50 and reports it: the toast (with Undo when there's an inverse), and
    /// any notes that were skipped.
    private func run(_ ids: [String], _ action: BulkAction, app: AppModel, revert: (() -> Void)? = nil) {
        guard let session = app.session, !ids.isEmpty else { return }
        guard app.sync.isOnline else {
            revert?()
            return offline(app)
        }
        Task {
            do {
                let r = try await bulk(ids, action, session: session)
                await session.engine.syncNow()
                revision += 1
                if r.skipped > 0 { app.showToast(Organize.skippedMessage(r.skipped)) }
                guard !r.done.isEmpty else { return }
                // A skipped-notes message shows first; the result follows it.
                if r.skipped > 0 { try? await Task.sleep(for: .seconds(2)) }
                let undo: ToastAction? = Organize.inverse(of: action).map { inverse in
                    .undo { self.quietly(r.done, inverse, app: app) }
                }
                app.showToast(Organize.message(for: action, count: r.done.count), action: undo)
            } catch {
                revert?()
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    /// Undo: runs the inverse without a toast of its own.
    private func quietly(_ ids: [String], _ action: BulkAction, app: AppModel) {
        guard let session = app.session else { return }
        if case .star(let starred) = action {
            if starred { starredIds.formUnion(ids) } else { starredIds.subtract(ids) }
        }
        Task {
            do {
                _ = try await bulk(ids, action, session: session)
                await session.engine.syncNow()
                revision += 1
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func bulk(_ ids: [String], _ action: BulkAction, session: SessionContext) async throws -> BulkUpdateResult {
        var out = BulkUpdateResult()
        for chunk in Organize.chunks(ids) {
            let r = try await session.documents.bulkUpdate(chunk, action)
            out.done += r.done
            out.skipped += r.skipped
            out.previousFolders.merge(r.previousFolders) { a, _ in a }
        }
        return out
    }

    private func offline(_ app: AppModel) {
        app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
    }
}

/// Where new top-level notes go from here: the open folder, as on the web (⌘N, ⌘⌥N, New note).
extension NavigationModel {
    var currentFolderId: String? {
        if case .folder(let id) = selection, openDocumentId == nil { return id }
        return nil
    }
}
