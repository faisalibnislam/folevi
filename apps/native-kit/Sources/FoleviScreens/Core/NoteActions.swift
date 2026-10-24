// Actions on one or many notes and on folders, shared by Home and every list (the web's
// components/views/noteActions.ts and FolderMenu.tsx): each runs an engine command, shows the web's toast
// wording with Undo where the web offers it, and updates the screen at once (plan 3.4: optimistic, rolled back
// with a toast when the engine refuses). Data never lives here: overrides only bridge the gap until the
// engine's next update, and expire on their own.
import Foundation
import Observation
import FoleviEngine

/// A folder to move notes into; `id: nil` is Drafts.
public struct FolderTarget: Hashable, Sendable {
    public var id: String?
    public var name: String
    public init(id: String?, name: String) {
        self.id = id
        self.name = name
    }
    public static let drafts = FolderTarget(id: nil, name: "Drafts")
}

@MainActor
@Observable
public final class NoteActions {
    /// Star states shown before the engine confirms them.
    public private(set) var starOverrides: [String: Bool] = [:]
    /// Notes that left this list (archived, trashed, moved, restored, deleted) before the engine's update.
    public private(set) var hidden: Set<String> = []

    @ObservationIgnored let client: EngineClient
    @ObservationIgnored public var feedback: ScreenFeedback
    @ObservationIgnored public var space: SpaceRef?
    /// How long an override outlives a confirmed command (the engine's update normally lands well before).
    @ObservationIgnored public var settleAfter: Duration = .seconds(3)

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback(), space: SpaceRef? = nil) {
        self.client = client
        self.feedback = feedback
        self.space = space
    }

    public func isStarred(_ row: NoteRow) -> Bool { starOverrides[row.id] ?? row.starred }
    public func isHidden(_ id: String) -> Bool { hidden.contains(id) }

    // MARK: Notes

    public func star(_ ids: [String], _ starred: Bool) async {
        guard !ids.isEmpty else { return }
        for id in ids { starOverrides[id] = starred }
        feedback.haptic(.selection)
        await perform(ids, undoable: true, rollback: { for id in ids { self.starOverrides[id] = nil } }, settle: { for id in ids { self.starOverrides[id] = nil } }) {
            try await self.client.command(.noteStar(ids: ids, starred: starred))
        } message: { n in
            starred ? (n == 1 ? "Starred" : "Starred \(notesText(n))") : (n == 1 ? "Removed from Starred" : "Unstarred \(notesText(n))")
        } undo: { done in
            Task { await self.quietly { try await self.client.command(.noteStar(ids: done, starred: !starred)) } }
        }
    }

    /// `leavesList`: the note disappears from the screen it's on (Archive leaving Archive, a list leaving
    /// for Archive).
    public func archive(_ ids: [String], _ archived: Bool, leavesList: Bool = true) async {
        guard !ids.isEmpty else { return }
        hide(ids, leavesList)
        await perform(ids, undoable: true, rollback: { self.unhide(ids) }, settle: { self.unhide(ids) }) {
            try await self.client.command(.noteArchive(ids: ids, archived: archived))
        } message: { n in
            archived ? (n == 1 ? "Archived" : "Archived \(notesText(n))") : (n == 1 ? "Moved out of Archive" : "Moved \(notesText(n)) out of Archive")
        } undo: { done in
            Task { await self.quietly { try await self.client.command(.noteArchive(ids: done, archived: !archived)) } }
        }
    }

    public func trash(_ ids: [String]) async {
        guard !ids.isEmpty else { return }
        hide(ids, true)
        feedback.haptic(.warning)
        await perform(ids, undoable: true, rollback: { self.unhide(ids) }, settle: { self.unhide(ids) }) {
            try await self.client.command(.noteTrash(ids: ids))
        } message: { n in
            n == 1 ? "Moved to Trash" : "Moved \(notesText(n)) to Trash"
        } undo: { done in
            Task { await self.quietly { try await self.client.command(.noteRestore(ids: done)) } }
        }
    }

    public func restore(_ ids: [String]) async {
        guard !ids.isEmpty else { return }
        hide(ids, true)
        await perform(ids, undoable: true, rollback: { self.unhide(ids) }, settle: { self.unhide(ids) }) {
            try await self.client.command(.noteRestore(ids: ids))
        } message: { n in
            n == 1 ? "Restored" : "Restored \(notesText(n))"
        } undo: { done in
            Task { await self.quietly { try await self.client.command(.noteTrash(ids: done)) } }
        }
    }

    /// Deletes for good (Trash only; the screen asks first).
    public func deleteForever(_ ids: [String]) async {
        guard !ids.isEmpty else { return }
        hide(ids, true)
        await perform(ids, undoable: false, rollback: { self.unhide(ids) }, settle: { self.unhide(ids) }) {
            try await self.client.command(PendingCommands.NoteDeleteForever(NoteIdsArgs(ids: ids)))
        } message: { n in
            "\(notesText(n)) will be permanently deleted."
        } undo: { _ in }
    }

    /// Moves notes into a folder (or Drafts). `from` gives each note's folder now, for Undo; `leavesList` hides
    /// them from a folder's or Drafts' screen.
    public func move(_ ids: [String], to folder: FolderTarget, from: [String: String?] = [:], leavesList: Bool = false) async {
        guard !ids.isEmpty else { return }
        hide(ids, leavesList)
        await perform(ids, undoable: !from.isEmpty, rollback: { self.unhide(ids) }, settle: { self.unhide(ids) }) {
            try await self.client.command(PendingCommands.NoteMove(NoteMoveExplicitArgs(ids: ids, folderId: folder.id)))
        } message: { n in
            n == 1 ? "Moved to \(folder.name)" : "Moved \(notesText(n)) to \(folder.name)"
        } undo: { done in
            // Each note goes back to the folder it came from.
            var byFolder: [String?: [String]] = [:]
            for id in done { byFolder[from[id] ?? nil, default: []].append(id) }
            Task {
                for (folderId, back) in byFolder {
                    await self.quietly { try await self.client.command(PendingCommands.NoteMove(NoteMoveExplicitArgs(ids: back, folderId: folderId))) }
                }
            }
        }
    }

    public func copy(_ ids: [String], to space: SpaceInfo) async {
        guard !ids.isEmpty else { return }
        await perform(ids, undoable: false, rollback: {}, settle: {}) {
            try await self.client.command(PendingCommands.NoteCopyTo(NoteCopyToArgs(ids: ids, space: space.id)))
        } message: { n in
            n == 1 ? "Copied to \(space.name)" : "Copied \(notesText(n)) to \(space.name)"
        } undo: { _ in }
    }

    @discardableResult
    public func duplicate(_ id: String) async -> String? {
        do {
            let r = try await client.command(PendingCommands.NoteDuplicate(NoteIdArgs(id: id)))
            feedback.toast(ScreenToast("Duplicated", tone: .success))
            return r.id
        } catch {
            report(error)
            return nil
        }
    }

    public func removeFromRecent(_ ids: [String]) async {
        guard !ids.isEmpty else { return }
        hide(ids, true)
        do {
            let r = try await client.command(.noteHideFromRecent(ids: ids))
            if r.hidden > 0 {
                let msg = r.hidden == 1 ? "Removed from Recent notes" : "Removed \(notesText(r.hidden)) from Recent notes"
                feedback.toast(ScreenToast(msg, actionTitle: "Undo") { [weak self] in
                    guard let self else { return }
                    Task { await self.quietly { try await self.client.command(PendingCommands.NoteShowInRecent(NoteIdsArgs(ids: ids))) } }
                })
            }
            scheduleSettle { self.unhide(ids) }
        } catch {
            unhide(ids)
            report(error)
        }
    }

    /// Makes a note (in a folder, or Drafts) and returns its id; the screen then opens it with the zoom.
    public func create(folderId: String?, templateId: String? = nil, title: String? = nil) async -> String? {
        do {
            return try await client.command(.noteCreate(space: space, folderId: folderId, parentId: nil, title: title, templateId: templateId, open: false)).id
        } catch {
            report(error)
            return nil
        }
    }

    public func createTemplate() async -> String? {
        do {
            return try await client.command(PendingCommands.TemplateCreate(TemplateCreateArgs(space: space))).id
        } catch {
            report(error)
            return nil
        }
    }

    public func reorder(_ id: String, after afterId: String?, view: NotesListView, folderId: String?) async {
        do {
            try await client.command(PendingCommands.NoteReorder(NoteReorderArgs(id: id, afterId: afterId, view: view, folderId: folderId)))
        } catch {
            report(error)
        }
    }

    public func emptyTrash() async {
        do {
            let r = try await client.command(PendingCommands.TrashEmpty(SpaceArgs(space: space)))
            if r.deleted > 0 { feedback.toast(ScreenToast("\(notesText(r.deleted)) will be permanently deleted.")) }
            if r.skipped > 0 { feedback.toast(ScreenToast("\(notesText(r.skipped)) couldn’t be deleted. You may not have permission.", tone: .error)) }
        } catch {
            report(error)
        }
    }

    // MARK: Folders

    @discardableResult
    public func createFolder(name: String, parentId: String?) async -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        do {
            return try await client.command(.folderCreate(space: space, name: trimmed, parentId: parentId, color: nil)).id
        } catch {
            report(error)
            return nil
        }
    }

    public func renameFolder(_ id: String, to name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        await folderCommand(PendingCommands.FolderRename(FolderRenameArgs(id: id, name: trimmed)), "Renamed")
    }

    public func setFolderColor(_ id: String, _ color: String?) async {
        await folderCommand(PendingCommands.FolderSetColor(FolderSetColorArgs(id: id, color: color)), nil)
    }

    public func moveFolder(_ id: String, to place: FolderRules.Place, message: String) async {
        await folderCommand(PendingCommands.FolderMove(FolderMoveArgs(id: id, parentId: place.parentId, afterId: place.afterId)), message)
    }

    public func deleteFolder(_ id: String) async {
        feedback.haptic(.warning)
        await folderCommand(PendingCommands.FolderDelete(FolderIdArgs(id: id)), "Folder deleted")
    }

    // MARK: Plumbing

    private func folderCommand<C: EngineCommandSpec>(_ command: C, _ message: String?) async {
        do {
            try await client.command(command)
            if let message { feedback.toast(ScreenToast(message, tone: .success)) }
        } catch {
            report(error)
        }
    }

    private func perform(_ ids: [String], undoable: Bool, rollback: @escaping @MainActor () -> Void, settle: @escaping @MainActor () -> Void, run: @escaping @MainActor () async throws -> BulkResult, message: (Int) -> String, undo: @escaping @MainActor ([String]) -> Void) async {
        do {
            let r = try await run()
            if r.skipped > 0 {
                feedback.toast(ScreenToast("\(notesText(r.skipped)) couldn’t be changed. You may not have permission.", tone: .error))
            }
            let skippedIds = Set(ids).subtracting(r.done)
            if !r.done.isEmpty {
                let done = r.done
                if undoable && !r.queued {
                    feedback.toast(ScreenToast(message(done.count), actionTitle: "Undo") { undo(done) })
                } else {
                    feedback.toast(ScreenToast(message(done.count)))
                }
            }
            // Notes that weren't changed come straight back; the rest wait for the engine's update.
            if !skippedIds.isEmpty && !r.queued {
                for id in skippedIds { starOverrides[id] = nil; hidden.remove(id) }
            }
            scheduleSettle(settle)
        } catch {
            rollback()
            feedback.haptic(.error)
            report(error)
        }
    }

    private func quietly(_ run: @escaping @MainActor () async throws -> some Sendable) async {
        do { _ = try await run() } catch { report(error) }
    }

    private func hide(_ ids: [String], _ yes: Bool) {
        guard yes else { return }
        hidden.formUnion(ids)
    }

    private func unhide(_ ids: [String]) { hidden.subtract(ids) }

    private func scheduleSettle(_ settle: @escaping @MainActor () -> Void) {
        let delay = settleAfter
        Task { @MainActor in
            try? await Task.sleep(for: delay)
            settle()
        }
    }

    func report(_ error: any Error) {
        feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
    }
}

public enum ScreenErrors {
    /// The engine's own words when it gave any (`data.message` per plan 3.5), else a plain sentence.
    public static func message(_ error: any Error) -> String {
        if let failure = error as? EngineFailure {
            switch failure {
            case .engine(let e): return e.message
            case .notReady: return "Folevi is still starting. Try again in a moment."
            case .timeout: return "That took too long. Try again."
            default: break
            }
        }
        return "Something went wrong. Try again."
    }
}
