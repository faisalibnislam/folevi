import Foundation
import Observation
import SwiftUI

/// Tasks that end with their owner: the live queries of one open note stop when it closes.
final class TaskBag: @unchecked Sendable {
    private let lock = NSLock()
    private var tasks: [Task<Void, Never>] = []
    func add(_ task: Task<Void, Never>) {
        lock.lock()
        tasks.append(task)
        lock.unlock()
    }
    func cancelAll() {
        lock.lock()
        let all = tasks
        tasks = []
        lock.unlock()
        all.forEach { $0.cancel() }
    }
    deinit { cancelAll() }
}

/// Where a link (a notification, "Copy link to comment") wants a note to open: a comment thread or a block.
struct CommentTarget: Equatable, Sendable {
    var threadId: String?
    var blockId: String?
}

/// The comments on one open note, live from the server (comments:threads), as the web's Comments.tsx keeps
/// them: the thread list and per-block summaries, the people who can be @mentioned, your comment
/// notifications for the note, and which thread floats under which block. Edits are optimistic, as on the
/// web; a failed one goes back to the server's state and says why.
@MainActor
@Observable
final class NoteComments {
    let documentId: String
    @ObservationIgnored private weak var editor: EditorModel?
    @ObservationIgnored private let app: AppModel

    /// What the server last said, with this Mac's not-yet-confirmed changes on top.
    private(set) var data: CommentsData?
    @ObservationIgnored private var serverData: CommentsData?
    private(set) var people: [MentionPerson] = []
    private(set) var subscription: NoteSubscription?

    /// The block whose thread card is open (floating under it), and the thread it shows (nil: its latest open
    /// thread, or a new one).
    private(set) var openBlockId: String?
    private(set) var openThreadId: String?
    /// A thread to show in the Comments panel (on the whole note, on a deleted or folded-away block, or asked
    /// for by a link). The dock opens the panel when this changes.
    var panelThreadId: String?
    var panelRequest = 0

    @ObservationIgnored private let bag = TaskBag()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var markedRead: Set<String> = []
    @ObservationIgnored private var peopleLoaded = false

    /// Links waiting for their note to open (documentId → target), set before the note opens.
    static var pendingTargets: [String: CommentTarget] = [:]

    init(documentId: String, editor: EditorModel, app: AppModel) {
        self.documentId = documentId
        self.editor = editor
        self.app = app
    }

    private var repo: CollaborationRepository? { app.session.map { CollaborationRepository(convex: $0.convex) } }

    /// Starts the live queries (once). They end when the note closes.
    func start() {
        guard !started else { return }
        started = true
        watch({ [documentId] in $0.threadUpdates(documentId) }) { [weak self] value in self?.receive(value) }
        watch({ [documentId] in $0.noteSubscriptionUpdates(documentId) }) { [weak self] value in self?.subscription = value }
    }

    func stop() {
        bag.cancelAll()
        started = false
    }

    private func watch<T: Sendable>(_ make: @escaping @MainActor (CollaborationRepository) -> AsyncThrowingStream<T, Error>,
                                    apply: @escaping @MainActor (T) -> Void) {
        bag.add(Task { @MainActor [weak self] in
            while !Task.isCancelled {
                if let repo = self?.repo {
                    do {
                        for try await value in make(repo) {
                            if Task.isCancelled { return }
                            apply(value)
                        }
                    } catch {}
                }
                // Signed out, offline or the server said no: try again in a moment.
                try? await Task.sleep(for: .seconds(4))
            }
        })
    }

    private func receive(_ value: CommentsData) {
        serverData = value
        data = value
        if !peopleLoaded, value.canComment { Task { await loadPeople() } }
        if let target = Self.pendingTargets.removeValue(forKey: documentId) { open(target) }
    }

    /// The people who can be @mentioned (comments:mentionable), loaded when first needed.
    func loadPeople() async {
        guard !peopleLoaded, let repo else { return }
        peopleLoaded = true
        do { people = try await repo.mentionable(documentId) } catch { peopleLoaded = false }
    }

    // MARK: Opening threads

    /// Whether a block's row is on screen (not deleted, not folded away in a toggle).
    private func isShown(_ blockId: String) -> Bool { editor?.rows.contains { $0.id == blockId } ?? false }

    /// A block's comments, floating under it: the chosen thread, else its latest open one, else a new thread.
    /// A block that isn't on screen shows the thread in the Comments panel instead.
    func openBlock(_ blockId: String, threadId: String? = nil) {
        guard isShown(blockId) else {
            if let threadId { showInPanel(threadId) }
            return
        }
        openBlockId = blockId
        openThreadId = threadId ?? data?.threadToShow(onBlock: blockId, chosen: nil)?.id
        editor?.revealBlockId = blockId
    }

    func selectThread(_ threadId: String) { openThreadId = threadId }

    func closeThread() {
        openBlockId = nil
        openThreadId = nil
    }

    /// A click elsewhere in the note closed the open thread. Its block's comment line was maybe the click, so
    /// that line doesn't reopen it right away (pressing an open line closes it, as on the web).
    func dismissFromOutside() {
        guard let id = openBlockId else { return }
        lastDismissed = (id, Date())
        closeThread()
    }

    /// The thread on `blockId` was just closed by the click that's now pressing its comment line.
    func justDismissed(_ blockId: String) -> Bool {
        guard let d = lastDismissed, d.blockId == blockId else { return false }
        return Date().timeIntervalSince(d.at) < 0.8
    }

    @ObservationIgnored private var lastDismissed: (blockId: String, at: Date)?

    func showInPanel(_ threadId: String?) {
        closeThread()
        panelThreadId = threadId
        panelRequest += 1
    }

    /// Opens what a link points at: a thread under its block (or in the panel), or just the block.
    func open(_ target: CommentTarget, attempt: Int = 0) {
        // The note's blocks may still be arriving (just opened from a link): give them a moment.
        if editor?.loadState != .ready || editor?.rows.isEmpty == true, attempt < 20 {
            Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(150))
                self?.open(target, attempt: attempt + 1)
            }
            return
        }
        if let threadId = target.threadId {
            guard let t = data?.thread(threadId) else {
                // Not loaded yet: try again when the threads arrive.
                if data == nil { Self.pendingTargets[documentId] = target }
                return
            }
            if let blockId = t.blockId, t.blockExists != false, isShown(blockId) {
                openBlock(blockId, threadId: t.id)
            } else {
                showInPanel(t.id)
            }
        } else if let blockId = target.blockId, isShown(blockId) {
            editor?.revealBlockId = blockId
            editor?.select(blockId, extend: false)
        }
    }

    /// ⌘⌥M: comment on the block with the caret (or open the Comments panel).
    func commentOnFocusedBlock() {
        if let id = editor?.focusedBlockId ?? editor?.selectedBlockIds.first, id != "__title__", data?.canComment == true {
            openBlock(id)
        } else {
            showInPanel(nil)
        }
    }

    // MARK: Actions

    private var me: PersonFace { PersonFace(name: app.profile?.displayName ?? "", avatarUrl: nil) }
    private var meId: String { app.profile?.id ?? "" }
    private var now: Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    /// Runs one change: shows it right away, then asks the server; a failure goes back to the server's state.
    @discardableResult
    private func run(_ optimistic: ((CommentsData) -> CommentsData)?, toast ok: String? = nil,
                     _ call: @escaping @Sendable (CollaborationRepository) async throws -> Void) async -> Bool {
        guard let repo else { return false }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return false
        }
        if let optimistic, let d = data { data = optimistic(d) }
        do {
            try await call(repo)
            if let ok { app.showToast(ok) }
            return true
        } catch {
            data = serverData
            app.showToast(ConvexService.mapError(error).localizedDescription)
            return false
        }
    }

    /// Sends a comment: a reply in `threadId`, else a new thread on `blockId` (nil: the whole note).
    func send(_ text: String, picked: [MentionPerson], threadId: String?, blockId: String?) async -> Bool {
        let body = CommentText.body(from: text.trimmingCharacters(in: .whitespacesAndNewlines), picked: picked, people: people)
        guard !body.isEmpty else { return false }
        let me = self.me, meId = self.meId, now = self.now, documentId = self.documentId
        if let threadId, !threadId.hasPrefix("pending-") {
            return await run({ $0.replying(threadId: threadId, body: body, me: me, meId: meId, now: now) }) { repo in
                try await repo.reply(threadId: threadId, body: body)
            }
        }
        let created = await run({ $0.creatingThread(blockId: blockId, body: body, me: me, meId: meId, now: now) }) { repo in
            _ = try await repo.createComment(documentId: documentId, blockId: blockId, body: body)
        }
        // The card follows the new thread once the server's list arrives (it's the block's latest).
        if created, blockId != nil, openBlockId == blockId { openThreadId = nil }
        return created
    }

    func edit(_ commentId: String, text: String, picked: [MentionPerson]) async {
        let body = CommentText.body(from: text.trimmingCharacters(in: .whitespacesAndNewlines), picked: picked, people: people)
        guard !body.isEmpty else { return }
        let now = self.now
        await run({ $0.editing(commentId: commentId, body: body, now: now) }) { try await $0.edit(commentId: commentId, body: body) }
    }

    func remove(_ commentId: String) async {
        await run({ $0.removing(commentId: commentId) }, toast: String(localized: "Comment deleted")) { _ = try await $0.removeComment(commentId) }
    }

    func setResolved(_ threadId: String, _ resolved: Bool) async {
        let name = me.name, now = self.now
        await run({ $0.resolving(threadId: threadId, resolved: resolved, by: name, now: now) },
                  toast: resolved ? String(localized: "Thread resolved") : nil) { try await $0.setResolved(threadId: threadId, resolved: resolved) }
    }

    func deleteThread(_ threadId: String) async {
        if openThreadId == threadId { closeThread() }
        await run({ $0.deletingThread(threadId) }, toast: String(localized: "Thread deleted")) { try await $0.deleteThread(threadId) }
    }

    /// Opening a thread reads it (and the notifications about it), once per new activity.
    func markReadIfNeeded(_ thread: CommentsData.Thread) {
        guard thread.unread, !thread.isPending else { return }
        let key = "\(thread.id):\(thread.lastActivityAt)"
        guard markedRead.insert(key).inserted else { return }
        Task { await run({ $0.markingThread(thread.id, unread: false) }) { try await $0.markThreadRead(thread.id) } }
    }

    func markUnread(_ thread: CommentsData.Thread) async {
        markedRead.insert("\(thread.id):\(thread.lastActivityAt)")
        if openThreadId == thread.id || openBlockId == thread.blockId { closeThread() }
        await run({ $0.markingThread(thread.id, unread: true) }) { try await $0.markThreadUnread(thread.id) }
    }

    /// "Copy link to comment": opens the note on this thread (`#comment-<id>`).
    func copyLink(_ threadId: String) {
        guard let origin = app.config.appOrigin else {
            app.showToast(String(localized: "Couldn't copy the link."))
            return
        }
        let url = origin.appending(path: "d/\(documentId)").absoluteString + "#comment-\(threadId)"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
        app.showToast(String(localized: "Link copied"))
    }

    // MARK: Note notifications ("Follow comments" / "Mute comment notifications")

    func setNotifyMode(_ mode: String, message: String) {
        guard let repo else { return }
        let documentId = self.documentId
        Task {
            do {
                try await repo.setNoteSubscription(documentId, mode: mode)
                app.showToast(message)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}
