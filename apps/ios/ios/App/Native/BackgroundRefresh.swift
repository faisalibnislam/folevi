// What Folevi does for this device's places while it isn't on screen (docs/MULTI_ACCOUNT_PLAN.md §5.3). iOS
// never keeps a web view running in the background, and each place's notes, edits and encryption live in its
// page, so a place that isn't open can't sync its notes until it opens. What native code can do with each
// account's own REST token (SaveTargets) it does here:
//
// - what the share sheet, Siri, Shortcuts and the widgets saved to an account that isn't open while offline
//   (the LocalActions and share queues, tagged with the place) goes to that account;
// - the open account's widgets copy is fetched again.
//
// It runs as a BGAppRefreshTask (iOS decides when, usually a few times a day for an app that's used), and when a
// silent push (content-available) arrives. The server doesn't send silent pushes yet: notifications for every
// account already come by ordinary push. The library's queue waits for the library's page: only it can write
// the library.
import BackgroundTasks
import UIKit
import WidgetKit

enum BackgroundRefresh {
    static let identifier = "com.folevi.ios.refresh"

    /// At launch, before it finishes (iOS's rule for BGTaskScheduler).
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return task.setTaskCompleted(success: false) }
            handle(task)
        }
    }

    /// Asks iOS for the next run (it's never sooner than this, and may be much later).
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func handle(_ task: BGAppRefreshTask) {
        schedule()
        let work = Task {
            let sent = await run()
            task.setTaskCompleted(success: sent >= 0)
        }
        task.expirationHandler = { work.cancel() }
    }

    /// Sends what's waiting for accounts that aren't open, then refreshes the open account's widgets. The number
    /// sent (for the silent push's answer).
    @discardableResult
    static func run() async -> Int {
        let sent = await PlaceOutbox.send()
        if let api = SharedAccount.api() {
            await WidgetStore.shared.refresh(api: api)
            WidgetCenter.shared.reloadAllTimelines()
        }
        return sent
    }
}

/// What was saved to an account while it couldn't be sent, sent with that account's own token.
enum PlaceOutbox {
    static func send(actions: LocalActions = .shared, shares: ShareQueue = .shared, open: String? = SaveTargets.current()) async -> Int {
        var sent = 0
        let targets = SaveTargets.load()
        for target in targets where !target.isLibrary && target.id != open {
            guard let api = SaveTargets.api(for: target) else { continue }
            for action in actions.for(place: target.id) {
                if Task.isCancelled { return sent }
                do {
                    switch action.kind {
                    case .addTask:
                        _ = try await api.createTask(text: action.text ?? "", dueDate: action.dueDate, noteId: action.noteId, key: action.id)
                    case .newNote:
                        _ = try await api.createNote(title: action.title ?? "Untitled", markdown: action.markdown ?? "", place: nil, inInbox: false, key: action.id)
                    case .toggleTask:
                        try await api.setTask(action.taskId ?? "", completed: action.completed ?? true)
                    }
                    actions.remove(action.id)
                    sent += 1
                } catch FoleviAPI.Failure.offline, FoleviAPI.Failure.rateLimited {
                    return sent
                } catch FoleviAPI.Failure.signedOut {
                    // Its token went: the account's page takes it when it next opens.
                    break
                } catch {
                    // Refused for good (the note it was for is gone): kept for the page, which says so.
                    continue
                }
            }
            // Shares with files need the page's upload; text and links go now.
            for share in shares.all() where share.target == target.id && share.files.isEmpty {
                if Task.isCancelled { return sent }
                let content = ShareContent(title: share.title, text: share.text, url: share.url.isEmpty ? nil : share.url)
                do {
                    _ = try await api.createNote(title: share.title.isEmpty ? "Untitled" : share.title, markdown: content.markdown, place: share.place, key: share.id)
                    shares.remove(share.id)
                    sent += 1
                } catch FoleviAPI.Failure.offline, FoleviAPI.Failure.rateLimited {
                    return sent
                } catch {
                    continue
                }
            }
        }
        return sent
    }
}
