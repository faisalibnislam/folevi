// Debug builds in the Simulator only (compiled out of everything else): the native parts run from a script,
// for checking what the Simulator can't easily do by hand (scripts/simulator.mjs native '<json>'). Write
// {"command": ..., ...} to the app's tmp/native.json, post com.folevi.ios.native, read tmp/native-result.json.
//
//   status        what native code knows: signed in, the API, the App Group and Keychain group, the queue
//   refresh       the widgets' copy fetched again: { state, tasks, notes }
//   spotlight     the index updated, then searched: the notes Spotlight has from Folevi
//   share         the share extension's save path (ShareSaver) with sample items: { text, url, title, image }
//   intent        an App Intent run here: { name: "addTask" | "newNote" | "openNote" | "showToday" | "quickAdd", text?, id?, place? }
//   outbox        what's waiting for accounts that aren't open sent with their own tokens (BackgroundRefresh): { queue? }
//   complete      a widget's check-off (ToggleTaskIntent): { id }
//   activity      a Spotlight result tapped: { id }
//   widgets       every widget drawn to PNGs in tmp/widgets (WidgetSnapshots): { font? (Spectral's path) }
//   push          notifications here: the status, and what's in Notification Center from Folevi
//   respond       a notification's button pressed (or the notification tapped): { action?, userInfo }
#if DEBUG && targetEnvironment(simulator)
import CoreSpotlight
import UIKit
import UserNotifications
import WidgetKit

@MainActor
enum DebugHooks {
    private static var installed = false

    /// Once per run: switching places starts the app's screen again, which would add a second listener.
    static func install() {
        guard !installed else { return }
        installed = true
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, { _, _, _, _, _ in
            Task { @MainActor in await DebugHooks.run() }
        }, "com.folevi.ios.native" as CFString, nil, .deliverImmediately)
    }

    /// UI tests' driver (scripts/native-smoke.mjs): FOLEVI_TEST_SESSION in the launch environment is a scratch test
    /// account's session on the development deployment; it's stored as the sign-in sheet's end would store it, and
    /// the app opens in that account. Simulator Debug builds only; never printed.
    static func seedFromEnvironment() {
        guard let token = ProcessInfo.processInfo.environment["FOLEVI_TEST_SESSION"], !token.isEmpty else { return }
        Task { @MainActor in
            guard let u = await ShellAuth.shared.userOf(token) else { return }
            if ShellPlaces.state.current == "acct:\(u.userId)", ShellAuth.shared.token(for: u.userId) != nil { return }
            ShellAuth.shared.setToken(token, for: u.userId)
            guard let a = ShellPlaces.addAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl) else { return }
            ShellMode.current = "account"
            ShellPlaces.setCurrent(a.id)
            FoleviViewController.restart()
        }
    }

    private static func run() async {
        let tmp = FileManager.default.temporaryDirectory
        let out = tmp.appendingPathComponent("native-result.json")
        try? FileManager.default.removeItem(at: out)
        guard let data = try? Data(contentsOf: tmp.appendingPathComponent("native.json")), let input = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        var answer: [String: Any]
        do {
            answer = try await handle(input)
        } catch {
            answer = ["error": String(describing: error)]
        }
        let json = (try? JSONSerialization.data(withJSONObject: answer, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
        try? json.write(to: out)
    }

    private static func handle(_ input: [String: Any]) async throws -> [String: Any] {
        switch input["command"] as? String {
        case "key":
            // A hardware keyboard shortcut, as the overlay's commands send it (KeyCommands.swift).
            let title = input["title"] as? String ?? ""
            guard let shortcut = FoleviShortcut.all.first(where: { $0.title == title }) else { return ["error": "No shortcut called \(title)", "titles": FoleviShortcut.all.map(\.title)] }
            await MainActor.run {
                let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
                (root as? FoleviViewController)?.press(shortcut)
            }
            return ["pressed": title]
        case "frame":
            // The native frame's state (Native/Phone): what the bars are drawn from.
            guard let f = PhoneFrameController.current else { return ["frame": false] }
            let m = f.model
            return [
                "frame": true, "client": String(describing: m.client.state), "shownNote": m.shownNote ?? NSNull(),
                "keyboardVisible": m.keyboardVisible, "keyboardOverlap": Double(m.keyboardOverlap), "editing": m.editing,
                "editorNote": m.editorState?.noteId ?? NSNull(), "editorFocused": m.editorState?.focused ?? NSNull(),
                "panel": m.editorPanel?.rawValue ?? NSNull(), "ready": Array(m.readyNotes), "gate": m.gate?.gate ?? NSNull(),
                "bar": f.debugBar(),
            ]
        case "signedOut":
            // Every account on this Simulator signed out (scratch test accounts only), account mode: the sign-in gate.
            for a in ShellPlaces.state.accounts {
                await ShellAuth.shared.signOut(userId: a.userId)
                _ = ShellPlaces.removeAccount(a.id)
            }
            // A first launch again: the choice, then sign-in.
            Platform.defaults.removeObject(forKey: "folevi.shell.mode")
            ShellPlaces.setCurrent(nil)
            FoleviViewController.restart()
            return ["accounts": ShellPlaces.state.accounts.count, "mode": ShellMode.current]
        case "signInSheet":
            // The native sign-in flow on its own (FoleviScreens' SignInFlow over PhoneAuthService), for checking it
            // with a scratch account whatever gate the page is on.
            PhoneFrameController.current?.presentSignIn()
            return ["presented": PhoneFrameController.current != nil]
        case "authCheck":
            // R14.1's adapter without the screens (UI tests own the Simulator meanwhile): scratch dev accounts only.
            // Never returns tokens.
            let email = input["email"] as? String ?? ""
            let password = input["password"] as? String ?? ""
            let auth = PhoneAuthService(window: nil)
            var adopted: String?
            auth.signedIn = { id, _, _, _ in adopted = id }
            let wrong = await auth.signIn(email: email, password: password + "x")
            let right = await auth.signIn(email: email, password: password)
            let reset = await auth.requestPasswordReset(email: email)
            let resend = await auth.resendVerification(email: email)
            let signUp = await auth.signUp(name: "Native Check", email: "native-check-\(Int(Date().timeIntervalSince1970))@example.com", password: password)
            let weak = await auth.signUp(name: "Native Check", email: "native-check-weak-\(Int(Date().timeIntervalSince1970))@example.com", password: "short")
            let stored = adopted.map { ShellAuth.shared.token(for: $0) != nil } ?? false
            return ["wrongPassword": String(describing: wrong), "rightPassword": String(describing: right), "sessionStored": stored, "reset": String(describing: reset), "resend": String(describing: resend), "signUp": String(describing: signUp), "weakPassword": String(describing: weak)]
        case "status":
            return [
                "signedIn": SharedAccount.signedIn,
                "apiBase": SharedAccount.apiBase?.absoluteString ?? NSNull(),
                "accountId": SharedAccount.accountId ?? NSNull(),
                "tokenHeld": DeviceCredential.shared.token != nil,
                "keychainGroup": Folevi.keychainGroup ?? NSNull(),
                "appGroup": FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Folevi.appGroup)?.path ?? NSNull(),
                "deviceId": SharedAccount.deviceId,
                "model": DeviceModel.name,
                "queued": ShareQueue.shared.all().map { ["id": $0.id, "title": $0.title, "files": $0.files.count] },
                "places": PlacesCache.load().map(\.name),
                "localMode": LocalMode.on,
                "localActions": LocalActions.shared.all().map { ["kind": $0.kind.rawValue, "taskId": $0.taskId ?? "", "text": $0.text ?? $0.title ?? ""] },
                "catalog": LocalCatalog.load().count,
                // Several places (SaveTargets): what the pickers offer and which accounts hold their own token.
                "saveTargets": SaveTargets.load().map(\.id),
                "saveCurrent": SaveTargets.current() ?? NSNull(),
                "saveLast": SaveTargets.last() ?? NSNull(),
                "ownTokens": SaveTargets.load().compactMap(\.userId).filter { SaveTargets.credential(userId: $0).token != nil },
                "placeActions": LocalActions.shared.all().map { ["kind": $0.kind.rawValue, "place": $0.place ?? "library", "text": $0.text ?? $0.title ?? ""] },
                "queuedTargets": ShareQueue.shared.all().map { $0.target ?? "" },
            ]
        case "outbox":
            // { queue?: { place, text } }: keeps a task for a place first (as Siri does offline), then sends.
            if let q = input["queue"] as? [String: Any], let place = q["place"] as? String {
                try LocalActions.shared.add(.addTask, text: q["text"] as? String ?? "Kept offline", place: place)
            }
            return ["sent": await PlaceOutbox.send(), "left": LocalActions.shared.all().map { $0.place ?? "library" }]
        case "refresh":
            let snapshot = await WidgetStore.shared.refresh()
            WidgetCenter.shared.reloadAllTimelines()
            return ["state": snapshot.state.rawValue, "tasks": snapshot.openTasks.map { ["id": $0.id, "text": $0.text, "due": $0.dueDate ?? ""] }, "notes": snapshot.notes.map(\.title), "pending": snapshot.pending]
        case "timeline":
            let timeline = await FoleviTimelineProvider().timeline()
            return ["entries": timeline.entries.map { ["state": $0.snapshot.state.rawValue, "tasks": $0.snapshot.openTasks.count, "notes": $0.snapshot.notes.count] }]
        case "spotlight":
            if let api = SharedAccount.api() { await SpotlightIndex.shared.update(api: api) }
            return ["items": await searchSpotlight()]
        case "share":
            let content = ShareContent.tidy(title: input["title"] as? String, text: input["text"] as? String, url: input["url"] as? String)
            var files: [(name: String, type: String, data: Data)] = []
            if input["image"] as? Bool == true, let png = sampleImage().pngData() { files.append((name: "Sample.png", type: "image/png", data: png)) }
            let outcome = try await ShareSaver().save(content, place: input["place"] as? String, target: SaveTargets.target(input["target"] as? String), files: files)
            switch outcome {
            case .sent(let id): return ["outcome": "sent", "noteId": id, "message": "Saved to your Inbox"]
            case .queued: return ["outcome": "queued", "queued": ShareQueue.shared.all().count, "message": "Saved, it will sync when Folevi opens"]
            }
        case "intent":
            switch input["name"] as? String {
            case "addTask":
                let due = (input["due"] as? String) == "today" ? Date() : nil
                let place = SaveTargets.target(input["place"] as? String).map(SavePlaceEntity.init)
                let result = try await AddTaskIntent(text: input["text"] as? String ?? "From a Shortcut", dueDate: due, place: place).perform()
                return ["ran": "addTask", "dialog": String(describing: result)]
            case "newNote":
                _ = try await NewNoteIntent(text: input["text"] as? String, place: SaveTargets.target(input["place"] as? String).map(SavePlaceEntity.init)).perform()
            case "openNote":
                let entities = try await NoteQuery().entities(matching: input["text"] as? String ?? "")
                guard let first = entities.first else { return ["found": 0] }
                _ = try await OpenNoteIntent(note: first).perform()
                return ["opened": first.title]
            case "showToday":
                _ = try await ShowTodayIntent().perform()
            case "quickAdd":
                _ = try await OpenQuickAddIntent().perform()
            default:
                return ["error": "Unknown intent"]
            }
            return ["ran": input["name"] as? String ?? ""]
        case "complete":
            _ = try await ToggleTaskIntent(taskId: input["id"] as? String ?? "", completed: true).perform()
            return ["pending": WidgetStore.shared.load().pending, "open": WidgetStore.shared.load().openTasks.map(\.text)]
        case "activity":
            let activity = NSUserActivity(activityType: CSSearchableItemActionType)
            activity.userInfo = [CSSearchableItemActivityIdentifier: input["id"] as? String ?? ""]
            guard let url = DeepLinkRouter.link(for: activity) else { return ["opened": NSNull()] }
            DeepLinkRouter.open(url)
            return ["opened": url.absoluteString]
        case "push":
            let delivered = await UNUserNotificationCenter.current().deliveredNotifications()
            var status = await PushNotifications.shared.status()
            if let token = status["token"] as? String { status["token"] = "\(token.prefix(6))... (\(token.count))" }
            return ["status": status, "delivered": delivered.map { ["title": $0.request.content.title, "body": $0.request.content.body, "category": $0.request.content.categoryIdentifier, "thread": $0.request.content.threadIdentifier] }]
        case "respond":
            let userInfo = input["userInfo"] as? [String: Any] ?? [:]
            let route = NotificationRoute.from(userInfo: userInfo, action: input["action"] as? String ?? UNNotificationDefaultActionIdentifier)
            let content = UNMutableNotificationContent()
            content.title = input["title"] as? String ?? "Reminder"
            content.userInfo = userInfo
            await PushNotifications.shared.handle(route, content: content)
            switch route {
            case .open(let url): return ["route": "open", "url": url.absoluteString]
            case .complete(let id): return ["route": "complete", "taskId": id, "pending": WidgetStore.shared.load().pending[id] ?? NSNull()]
            case .snooze(let id, let until): return ["route": "snooze", "taskId": id, "until": ISO8601DateFormatter().string(from: until)]
            case .nothing: return ["route": "nothing"]
            }
        case "widgets":
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("widgets", isDirectory: true)
            let font = (input["font"] as? String).map { URL(fileURLWithPath: $0) }
            return ["folder": folder.path, "files": try WidgetSnapshots.render(into: folder, font: font)]
        default:
            return ["error": "Unknown command"]
        }
    }

    /// Folevi's notes in Spotlight, by title.
    private static func searchSpotlight() async -> [[String: String]] {
        await withCheckedContinuation { done in
            let context = CSSearchQueryContext()
            context.fetchAttributes = ["title", "contentDescription", "containerDisplayName"]
            let query = CSSearchQuery(queryString: "title == \"*\"", queryContext: context)
            var found: [[String: String]] = []
            query.foundItemsHandler = { items in
                for item in items {
                    found.append(["id": item.uniqueIdentifier, "title": item.attributeSet.title ?? "", "where": item.attributeSet.containerDisplayName ?? "", "excerpt": String((item.attributeSet.contentDescription ?? "").prefix(80))])
                }
            }
            query.completionHandler = { _ in done.resume(returning: found) }
            query.start()
        }
    }

    private static func sampleImage() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { ctx in
            UIColor.systemGray5.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
    }
}
#endif
