// FoleviNativePlugin's calls for the widgets, Shortcuts and Spotlight in local mode (Shared/LocalExtras.swift,
// lib/nativeApp.ts, components/app/NativeBridge.tsx): the page hands over the widgets' tasks and notes, the
// notes Shortcuts can pick from and Spotlight's notes, and takes what a widget, Siri or Shortcuts did while it
// wasn't there. Only in local mode, and only for Folevi's own page, like every FoleviNative call.
import Capacitor
import UIKit
import WidgetKit

@MainActor
enum LocalExtensions {
    private static weak var bridge: CAPBridgeProtocol?
    private static var observing = false

    /// Tells the page when a widget or an intent queues something while the app is running (the widget
    /// extension says so with a Darwin notification), so it's in the library at once.
    static func attach(_ bridge: CAPBridgeProtocol?) {
        self.bridge = bridge
        guard !observing else { return }
        observing = true
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(), nil,
            { _, _, _, _, _ in
                DispatchQueue.main.async { LocalExtensions.queued() }
            },
            LocalActions.changed as CFString, nil, .deliverImmediately
        )
    }

    private static func queued() {
        // With several places an account's page takes what was saved to it while offline, too.
        guard LocalMode.on || SaveTargets.current() != nil else { return }
        bridge?.triggerWindowJSEvent(eventName: "folevi:local-actions")
    }

    static func validId(_ id: String) -> Bool {
        id.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil
    }

    /// Decodes what the page sent (plain JSON objects) as one of the shared models.
    static func decode<T: Decodable>(_ value: Any?, as type: T.Type) -> T? {
        guard let value, JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}

private func orNull(_ value: Any?) -> Any { value ?? NSNull() }

extension FoleviNativePlugin {
    /// The queue's calls: in local mode, and with several places in an account too (what was saved to it offline).
    @MainActor private func queueAllowed(_ call: CAPPluginCall) -> Bool {
        guard fromFolevi else {
            call.reject("Not allowed here")
            return false
        }
        guard LocalMode.on || SaveTargets.current() != nil else {
            call.reject("Only in local mode")
            return false
        }
        return true
    }

    /// The place whose actions the open page puts in: the library in local mode, else the open account.
    @MainActor private var openPlace: String? { LocalMode.on ? SaveTargets.library : SaveTargets.current() }

    @MainActor private func localOnly(_ call: CAPPluginCall) -> Bool {
        guard fromFolevi else {
            call.reject("Not allowed here")
            return false
        }
        guard LocalMode.on else {
            call.reject("Only in local mode")
            return false
        }
        return true
    }

    /// { day, tasks, notes, catalog }: the widgets' copy (open tasks through tomorrow, the recent notes) and the
    /// notes Shortcuts offers, then the widgets draw again.
    @objc func setWidgetSnapshot(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.localOnly(call) else { return }
            guard let day = call.getString("day"), day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                  let tasks = LocalExtensions.decode(call.getArray("tasks"), as: [TaskItem].self),
                  let notes = LocalExtensions.decode(call.getArray("notes"), as: [NoteSummary].self) else {
                return call.reject("That isn't a widget snapshot")
            }
            WidgetStore.shared.setLocal(tasks: Array(tasks.prefix(200)), notes: notes, day: day)
            if let catalog = LocalExtensions.decode(call.getArray("catalog"), as: [NoteSummary].self) { LocalCatalog.save(catalog) }
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        }
    }

    /// What's waiting for the page, oldest first: [{ id, kind, taskId, completed, text, dueDate, noteId, title, markdown }].
    @objc func takeLocalActions(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.queueAllowed(call) else { return }
            let list: [[String: Any]] = LocalActions.shared.for(place: self.openPlace).map { a in
                [
                    "id": a.id,
                    "kind": a.kind.rawValue,
                    "taskId": orNull(a.taskId),
                    "completed": orNull(a.completed),
                    "text": orNull(a.text),
                    "dueDate": orNull(a.dueDate),
                    "noteId": orNull(a.noteId),
                    "title": orNull(a.title),
                    "markdown": orNull(a.markdown),
                ]
            }
            call.resolve(["value": list])
        }
    }

    /// { id }: the page put it in the library (or there was nothing to do): it goes from the queue.
    @objc func finishLocalAction(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.queueAllowed(call) else { return }
            guard let id = call.getString("id"), LocalActions.validId(id) else { return call.reject("Not an action") }
            if let action = LocalActions.shared.action(id), (action.place ?? SaveTargets.library) == (self.openPlace ?? SaveTargets.library) {
                LocalActions.shared.remove(id)
                if action.kind == .toggleTask, let taskId = action.taskId {
                    WidgetStore.shared.settleLocal(taskId, completed: action.completed ?? true)
                    WidgetCenter.shared.reloadAllTimelines()
                }
            }
            call.resolve()
        }
    }

    /// { items: [{ id, title, excerpt, location, starred, updatedAt }] }: the notes Spotlight finds.
    @objc func indexSpotlight(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.localOnly(call) else { return }
            let raw = call.getArray("items") ?? []
            let notes: [SpotlightIndex.LocalNote] = raw.prefix(200).compactMap { value in
                guard let o = value as? [String: Any], let id = o["id"] as? String, LocalExtensions.validId(id) else { return nil }
                return SpotlightIndex.LocalNote(
                    id: id,
                    title: String((o["title"] as? String ?? "").prefix(300)),
                    excerpt: o["excerpt"] as? String ?? "",
                    location: String((o["location"] as? String ?? "Folevi").prefix(200)),
                    starred: o["starred"] as? Bool ?? false,
                    updatedAt: (o["updatedAt"] as? NSNumber)?.doubleValue ?? 0
                )
            }
            await SpotlightIndex.shared.replace(with: notes)
            call.resolve()
        }
    }
}
