// Notifications from Folevi on this iPhone or iPad, through Apple's push service (convex/apnsSend.ts):
// reminders (with Done and Snooze 1 hour, which work without opening the app) and mentions (Open). Tapping
// one opens what it's about the way a folevi:// link does (DeepLinkRouter, a cold launch too). In front,
// a notification still shows as a banner.
//
// Permission is asked only when the person turns notifications on (Settings > Notifications, or the first
// reminder they set: the page decides when, lib/nativePush.ts), never at launch. The device token goes to
// the page, which registers it with Folevi (push.registerApns); the switch is kept on the device.
import UIKit
import UserNotifications
import WidgetKit
import os

/// What the server puts in a notification (convex/lib/apns.ts) and the buttons the app adds to it.
enum PushPayload {
    static let reminderCategory = "REMINDER"
    static let mentionCategory = "MENTION"
    static let doneAction = "folevi.done"
    static let snoozeAction = "folevi.snooze"
    static let openAction = "folevi.open"
    static let snoozeFor: TimeInterval = 60 * 60

    /// The categories registered at launch: a reminder's Done and Snooze 1 hour (in the background), a
    /// mention's Open (brings the app up).
    static var categories: Set<UNNotificationCategory> {
        let done = UNNotificationAction(identifier: doneAction, title: "Done", options: [])
        let snooze = UNNotificationAction(identifier: snoozeAction, title: "Snooze 1 hour", options: [])
        let open = UNNotificationAction(identifier: openAction, title: "Open", options: [.foreground])
        return [
            UNNotificationCategory(identifier: reminderCategory, actions: [done, snooze], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: mentionCategory, actions: [open], intentIdentifiers: [], options: []),
        ]
    }
}

/// Where a notification leads when it's tapped, or what one of its buttons does.
enum NotificationRoute: Equatable {
    /// Opens a folevi:// link in the page.
    case open(URL)
    /// Done: the task is checked off through the REST API.
    case complete(taskId: String)
    /// Snooze 1 hour: the reminder moves, and rings again then.
    case snooze(taskId: String, until: Date)
    /// Swiped away: nothing.
    case nothing

    static func from(userInfo: [AnyHashable: Any], action: String, now: Date = Date()) -> NotificationRoute {
        let task = (userInfo["taskId"] as? String).flatMap { $0.range(of: #"^[0-9A-Za-z_-]{1,64}$"#, options: .regularExpression) != nil ? $0 : nil }
        switch action {
        case UNNotificationDismissActionIdentifier:
            return .nothing
        case PushPayload.doneAction:
            if let task { return .complete(taskId: task) }
        case PushPayload.snoozeAction:
            if let task { return .snooze(taskId: task, until: now.addingTimeInterval(PushPayload.snoozeFor)) }
        default:
            break
        }
        return .open(link(forPath: userInfo["path"] as? String))
    }

    /// The folevi:// link for the path the server sent ("/d/ID#block-X"); the notes list for anything else.
    static func link(forPath path: String?) -> URL {
        path.flatMap(DeepLink.fromPath) ?? URL(string: "folevi://documents")!
    }
}

@MainActor
final class PushNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotifications()

    private static let log = Logger(subsystem: "com.folevi.ios", category: "push")
    private let center = UNUserNotificationCenter.current()
    private var waiting: [CheckedContinuation<String?, Never>] = []

    private enum Key {
        static let enabled = "pushEnabled"
        static let token = "pushToken"
        static let asked = "pushAsked"
    }

    /// Debug builds get sandbox tokens; TestFlight and the App Store, production ones.
    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// At launch, before anything else: notifications that open the app (a cold launch) reach the delegate.
    func attach() {
        center.delegate = self
        center.setNotificationCategories(PushPayload.categories)
        // Turned on before: the token again (iOS may change it), for the page to send on.
        Task {
            if enabled, await permission() == "granted" { _ = await register() }
        }
    }

    /// Whether the person turned notifications on for this device (in Folevi; iOS has its own switch).
    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: Key.enabled) }
        set { UserDefaults.standard.set(newValue, forKey: Key.enabled) }
    }

    private var token: String? {
        get { UserDefaults.standard.string(forKey: Key.token) }
        set { UserDefaults.standard.set(newValue, forKey: Key.token) }
    }

    /// "notDetermined" | "denied" | "granted" (provisional and ephemeral count as granted).
    func permission() async -> String {
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        default: return "granted"
        }
    }

    /// { permission, enabled, asked, token, environment, bundleId }: what the page shows and registers.
    func status() async -> [String: Any] {
        [
            "permission": await permission(),
            "enabled": enabled,
            "asked": UserDefaults.standard.bool(forKey: Key.asked),
            "token": (enabled ? token : nil) ?? NSNull(),
            "environment": Self.environment,
            "bundleId": Bundle.main.bundleIdentifier ?? Folevi.appBundleId,
        ]
    }

    /// Turning notifications on: asks iOS (the first time), then registers with Apple for a device token.
    func enable() async -> [String: Any] {
        UserDefaults.standard.set(true, forKey: Key.asked)
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        guard granted else { return await status() }
        enabled = true
        _ = await register()
        return await status()
    }

    /// Turned off in Folevi (the page has told the server): nothing is shown here from now on.
    func disable() {
        enabled = false
        center.removeAllDeliveredNotifications()
        setBadge(0)
    }

    func setBadge(_ count: Int) {
        center.setBadgeCount(max(0, count)) { _ in }
    }

    // MARK: The device token

    private func register() async -> String? {
        await withCheckedContinuation { done in
            waiting.append(done)
            UIApplication.shared.registerForRemoteNotifications()
            // Apple usually answers in a moment; without a connection it may never.
            Task {
                try? await Task.sleep(for: .seconds(15))
                self.finish(nil)
            }
        }
    }

    func registered(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = hex
        finish(hex)
    }

    func failedToRegister(_ error: Error) {
        Self.log.error("Registering for remote notifications failed: \(error.localizedDescription, privacy: .public)")
        #if DEBUG && targetEnvironment(simulator)
        // A Simulator that can't reach Apple: a stand-in token, so the rest of the path (the page, Folevi's
        // registration) can still be tried. Apple would refuse it, and the server then removes it.
        let fake = Self.simulatorToken(SharedAccount.deviceId)
        token = fake
        finish(fake)
        #else
        finish(token)
        #endif
    }

    /// 64 hex characters from the install id: stable, and clearly not Apple's.
    nonisolated static func simulatorToken(_ deviceId: String) -> String {
        let hex = deviceId.lowercased().filter { $0.isHexDigit }
        return String((hex + hex + String(repeating: "0", count: 64)).prefix(64))
    }

    private func finish(_ value: String?) {
        let all = waiting
        waiting = []
        all.forEach { $0.resume(returning: value) }
    }

    // MARK: UNUserNotificationCenterDelegate

    // The completion-handler forms, each handler called on the main thread: UIKit asserts (and the app
    // stops) when the async forms finish on another thread, which a tap that launches the app hits.

    /// In front: still a banner (and in the list), with its sound and badge.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        DispatchQueue.main.async { completionHandler([.banner, .list, .sound, .badge]) }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        let route = NotificationRoute.from(userInfo: content.userInfo, action: response.actionIdentifier)
        nonisolated(unsafe) let done = completionHandler
        Task { @MainActor in
            await self.handle(route, content: content)
            done()
        }
    }

    func handle(_ route: NotificationRoute, content: UNNotificationContent) async {
        switch route {
        case .open(let url):
            Self.log.info("Opened from a notification")
            DeepLinkRouter.open(url)
        case .complete(let taskId):
            // The widgets' check-off: sent now, or kept and sent with the next refresh when offline.
            await WidgetStore.shared.setTask(taskId, completed: true)
            WidgetCenter.shared.reloadAllTimelines()
            let waiting = WidgetStore.shared.load().pending[taskId] != nil
            Self.log.info("Done from a notification: \(waiting ? "kept for later" : "sent", privacy: .public)")
        case .snooze(let taskId, let until):
            var moved = false
            if let api = SharedAccount.api() {
                do {
                    try await api.snoozeTask(taskId, until: until)
                    moved = true
                } catch {
                    moved = false
                }
            }
            // Offline (or signed out here): the same notification again from this device instead.
            if !moved { await remindLocally(content, at: until) }
            Self.log.info("Snoozed from a notification: \(moved ? "moved on Folevi" : "kept on this device", privacy: .public)")
        case .nothing:
            break
        }
    }

    private func remindLocally(_ content: UNNotificationContent, at date: Date) async {
        guard let copy = content.mutableCopy() as? UNMutableNotificationContent else { return }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(60, date.timeIntervalSinceNow), repeats: false)
        try? await center.add(UNNotificationRequest(identifier: "snooze-\(UUID().uuidString)", content: copy, trigger: trigger))
    }
}
