// Mac notifications (docs/MAC_POLISH_PLAN.md §3.11) through UNUserNotificationCenter: mentions and comments (Reply,
// Mark as Read), tasks assigned (Open, Complete) and reminders (Complete, Snooze), grouped by note, with the place's
// name as the subtitle when there are several places. Clicking one opens its page in its place. Shown while Folevi
// is in front only for reminders; activity shows in the bell then.
//
// This is the app's one notification delegate: local mode's reminders (ShellNotify, shared with iOS, scheduled
// with the system so they fire with Folevi quit) arrive here too, and open in the library.
//
// An action that needs the page (a reply, marking read, completing a task) goes to a page of that place as
// { type: "notification", action, id, ... } (foleviDesktop.onCommand, DesktopBridge.tsx).
import AppKit
import UserNotifications

@MainActor
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()

    struct Note {
        var id: String
        var title: String
        var body: String
        var path: String?
        /// The server's kind ("mention", "comment", "reply", "assigned", ...); picks the actions.
        var kind: String
        /// The note it's about (groups the notifications).
        var thread: String
        /// The note's title (the group's summary).
        var threadTitle: String
        /// The comment thread a reply goes to.
        var commentThread: String
        /// The place the page that asked is bound to.
        var place: String?
    }

    enum Category: String, CaseIterable {
        case comment = "folevi.comment"
        case task = "folevi.task"
        case reminder = "folevi.reminder"
        case plain = "folevi.plain"
    }

    /// Which actions a server kind gets. Pure (ChromeTests).
    nonisolated static func category(for kind: String, hasThread: Bool) -> Category {
        let k = kind.lowercased()
        if k.contains("remind") || k.contains("due") { return .reminder }
        if k.contains("assign") || k.contains("task") { return .task }
        if (k.contains("mention") || k.contains("comment") || k.contains("reply")) && hasThread { return .comment }
        return .plain
    }

    private var installed = false
    private var center: UNUserNotificationCenter? { Paths.testing ? nil : UNUserNotificationCenter.current() }

    func install() {
        guard !installed, let center else { return }
        installed = true
        center.delegate = self
        let reply = UNTextInputNotificationAction(identifier: "reply", title: "Reply", options: [], textInputButtonTitle: "Reply", textInputPlaceholder: "Reply")
        let read = UNNotificationAction(identifier: "read", title: "Mark as Read", options: [])
        let open = UNNotificationAction(identifier: "open", title: "Open", options: [.foreground])
        let complete = UNNotificationAction(identifier: "complete", title: "Complete", options: [])
        let hour = UNNotificationAction(identifier: "snooze-hour", title: "Snooze 1 Hour", options: [])
        let evening = UNNotificationAction(identifier: "snooze-evening", title: "Snooze Until This Evening", options: [])
        let tomorrow = UNNotificationAction(identifier: "snooze-tomorrow", title: "Snooze Until Tomorrow", options: [])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Category.comment.rawValue, actions: [reply, read], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Category.task.rawValue, actions: [open, complete], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Category.reminder.rawValue, actions: [complete, hour, evening, tomorrow], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Category.plain.rawValue, actions: [read], intentIdentifiers: [], options: []),
        ])
    }

    /// Shows a notification now (the page decided it's new; Settings allows them).
    func post(_ n: Note) {
        guard let center else { return }
        Task { @MainActor in
            let settings = await center.notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            }
            let content = UNMutableNotificationContent()
            content.title = n.title
            if !n.body.isEmpty { content.body = n.body }
            // Several places: which one it's from (docs/MULTI_ACCOUNT_PLAN.md §5.2).
            if Chrome.places.count > 1, let label = Chrome.placeLabel(n.place) { content.subtitle = label }
            content.sound = .default
            content.threadIdentifier = n.thread.isEmpty ? "folevi" : "note-\(n.thread)"
            if !n.threadTitle.isEmpty { content.summaryArgument = n.threadTitle }
            content.categoryIdentifier = Self.category(for: n.kind, hasThread: !n.commentThread.isEmpty).rawValue
            var info: [String: Any] = ["kind": n.kind, "id": n.id]
            if let path = n.path { info["path"] = path }
            if let place = n.place { info["place"] = place }
            if !n.commentThread.isEmpty { info["commentThread"] = n.commentThread }
            content.userInfo = info
            let id = "folevi.n.\(n.id.isEmpty ? UUID().uuidString : n.id)"
            try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // In front: reminders still show (a banner); activity is in the bell.
        let kind = notification.request.content.userInfo["kind"] as? String ?? ""
        let category = notification.request.content.categoryIdentifier
        let reminder = kind == "local-reminder" || category == Category.reminder.rawValue
        completionHandler(reminder ? [.banner, .sound, .list] : [])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let action = response.actionIdentifier
        let text = (response as? UNTextInputNotificationResponse)?.userText ?? ""
        let path = info["path"] as? String
        let kind = info["kind"] as? String ?? ""
        let place = info["place"] as? String
        let id = info["id"] as? String ?? ""
        let commentThread = info["commentThread"] as? String ?? ""
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                Notifications.shared.respond(action: action, kind: kind, id: id, path: path, place: kind == "local-reminder" ? (place ?? ShellPlaces.library) : place, text: text, commentThread: commentThread)
                completionHandler()
            }
        }
    }

    /// What a click or an action does.
    func respond(action: String, kind: String, id: String, path: String?, place: String?, text: String, commentThread: String) {
        switch action {
        case UNNotificationDefaultActionIdentifier, "open":
            Chrome.open(path: path, place: place)
            NSApp.activate()
        case UNNotificationDismissActionIdentifier:
            break
        default:
            var command: [String: Any] = ["type": "notification", "action": action, "id": id, "kind": kind]
            if let path { command["path"] = path }
            if !text.isEmpty { command["text"] = String(text.prefix(4000)) }
            if !commentThread.isEmpty { command["thread"] = commentThread }
            send(command, place: place)
        }
    }

    /// A command for a page of the place: one already open (a main window, else its runner), or the front main
    /// window when it's the open place.
    private func send(_ command: [String: Any], place: String?) {
        let views = WindowManager.shared.allViews.filter { $0.loaded && $0.role != .quickAdd && (place == nil || $0.place == place) }
        if let view = views.first(where: { $0.role == .main }) ?? views.first {
            Events.command(command, to: view)
        } else if place == nil || place == WindowManager.shared.currentPlace() {
            WindowManager.shared.showMain()
            if let view = WindowManager.shared.frontMain?.view { Chrome.whenLoaded(view) { Events.command(command, to: $0) } }
        }
    }
}
