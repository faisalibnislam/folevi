// The bell's view model (plan 5.6; web app/NotificationsButton.tsx): `notifications.list` (kept in the launch
// snapshot, so the last list shows at once), All or Unread, marking read and unread, removing (with Undo), Mark all
// read, accepting a workspace or page invitation, and where tapping a notification goes.
import Foundation
import Observation
import FoleviDesign
import FoleviEngine

public enum NotificationsFilter: String, CaseIterable, Sendable { case all, unread }

@MainActor
@Observable
public final class NotificationsModel {
    public let client: EngineClient
    let feedback: ScreenFeedback
    public let store: ValueStore<NotificationsValue>
    public var filter: NotificationsFilter = .all

    /// Read states shown before the engine has them.
    public private(set) var shownRead: [String: Bool] = [:]
    /// Removed here, before the engine's update says so.
    public private(set) var removed: Set<String> = []
    /// Invitations being accepted (their buttons show progress).
    public private(set) var accepting: Set<String> = []
    public private(set) var allReadPending = false

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback()) {
        self.client = client
        self.feedback = feedback
        self.store = client.watch(.notificationsList, snapshotKey: "notifications.\(client.place)")
    }

    public var isLoading: Bool { store.value == nil }

    public func row(_ r: NotificationRow) -> NotificationRow {
        var r = r
        if allReadPending { r.read = true }
        if let read = shownRead[r.id] { r.read = read }
        return r
    }

    public var rows: [NotificationRow] {
        let all = (store.value?.rows ?? []).filter { !removed.contains($0.id) }.map(row)
        return filter == .unread ? all.filter { !$0.read } : all
    }

    public var unread: Int { (store.value?.rows ?? []).filter { !removed.contains($0.id) }.map(row).filter { !$0.read }.count }

    public var emptyText: (title: String, message: String) {
        filter == .unread ? ("You're all caught up", "Unread notifications show up here.") : ("No notifications yet", "Mentions, comments, shares and invitations show up here.")
    }

    // MARK: Reading

    public func setRead(_ r: NotificationRow, _ read: Bool) async {
        shownRead[r.id] = read
        feedback.haptic(.selection)
        do { try await client.command(.notificationMarkRead(ids: [r.id], read: read)) } catch {
            shownRead[r.id] = nil
            fail(error)
        }
    }

    public func toggleRead(_ r: NotificationRow) async { await setRead(r, !row(r).read) }

    public func markAllRead() async {
        guard unread > 0 else { return }
        allReadPending = true
        feedback.haptic(.success)
        do { try await client.command(.notificationMarkAllRead) } catch {
            allReadPending = false
            fail(error)
        }
    }

    public func remove(_ r: NotificationRow) async {
        removed.insert(r.id)
        feedback.haptic(.warning)
        do {
            try await client.command(.notificationRemove(ids: [r.id]))
        } catch {
            removed.remove(r.id)
            fail(error)
        }
    }

    // MARK: Invitations

    public enum InviteKind: Sendable { case workspace, page }

    public func inviteKind(_ r: NotificationRow) -> InviteKind? {
        if r.pageInviteId != nil { return .page }
        if r.kind == "invite", r.inviteId != nil { return .workspace }
        return nil
    }

    /// Accepts; a page opens (its note id comes back), a workspace says you joined.
    public func accept(_ r: NotificationRow) async -> ScreenIntent? {
        accepting.insert(r.id)
        defer { accepting.remove(r.id) }
        do {
            if let pid = r.pageInviteId {
                let res = try await client.command(.pageInviteAccept(inviteId: pid))
                feedback.haptic(.success)
                feedback.toast(ScreenToast("The page was added to Shared with Me.", tone: .success))
                shownRead[r.id] = true
                return .openNote(id: res.noteId, blockId: nil)
            }
            if let wid = r.inviteId {
                try await client.command(.inviteAccept(inviteId: wid))
                feedback.haptic(.success)
                feedback.toast(ScreenToast("You joined the workspace.", tone: .success))
                shownRead[r.id] = true
            }
        } catch {
            fail(error)
        }
        return nil
    }

    /// Declines (R11.2); until the engine has `invite.decline`, the notification is removed instead.
    public func decline(_ r: NotificationRow) async {
        guard let kind = inviteKind(r), let id = r.pageInviteId ?? r.inviteId else { return }
        removed.insert(r.id)
        do {
            try await client.command(.inviteDecline(inviteId: id, kind: kind == .page ? "page" : "workspace"))
            feedback.toast(ScreenToast("Invitation declined"))
        } catch let EngineFailure.engine(e) where e.code == BridgeErrorCode.unknownCommand.rawValue {
            await remove(r)
        } catch {
            removed.remove(r.id)
            fail(error)
        }
    }

    // MARK: Opening

    /// Where tapping goes: the note, the route, or nothing (then it's just marked read).
    public func intent(for r: NotificationRow) -> ScreenIntent? {
        if let route = r.route, !route.isEmpty { return .openRoute(route) }
        if let id = r.noteId { return .openNote(id: id, blockId: nil) }
        return nil
    }

    /// A tap: marks it read and says where to go.
    public func tap(_ r: NotificationRow) async -> ScreenIntent? {
        let target = intent(for: r)
        if !row(r).read { await setRead(r, true) }
        return target
    }

    public func reconcile() {
        guard let rows = store.value?.rows else { return }
        let byId = Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for (id, read) in shownRead where byId[id]?.read == read || byId[id] == nil { shownRead[id] = nil }
        removed = removed.filter { byId[$0] != nil }
        if allReadPending && !rows.contains(where: { !$0.read }) { allReadPending = false }
    }

    public func setVisible(_ visible: Bool) { store.setVisible(visible) }

    func fail(_ error: any Error) {
        feedback.haptic(.error)
        feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
    }

    /// The row's symbol by kind (web KindIcon).
    public static func symbol(_ kind: String) -> String {
        switch kind {
        case "comment", "reply": "bubble.left"
        case "mention": "at"
        case "share": "square.and.arrow.up"
        case "invite": "person.badge.plus"
        case "share_change": "key"
        case "reminder": "alarm"
        case "change": "arrow.triangle.2.circlepath"
        default: "doc.text"
        }
    }
}
