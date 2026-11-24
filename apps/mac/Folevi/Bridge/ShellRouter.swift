// foleviShell's native side on the Mac (docs/MAC_WEBKIT_PLAN.md §4.3 and §5.1): the same method names, options and
// answers as the iOS plugin (Native/Shell/FoleviShellPlugin.swift), so the shared shell-bridge.js calls the same
// names on both, answered by the shared iOS services (LibraryService, ShellAuth, E2eeKeys, ShellAI, ShellPlaces,
// ShellCloud, ShellServices). Where the Mac differs from the iPhone it does what Electron's main.ts does:
//
// - A view is bound to its place by the host (each window's page, and each place's hidden runner: Places.swift),
//   never by an argument: every call runs with ShellPlaces.acting set to the sender's place, so the session
//   (ShellAuth), the encryption keys (E2eeKeys) and what a page says of itself are that place's.
// - Switching places, the mode, signing in from a "session ended" screen or signing out reload every main window
//   in the new place (Places.switchTo), and the other places get runners.
// - Reminders and subscribed calendars answer only a page in the library (local mode), as Electron's localShell.
// - The lock is Touch ID's (MacAppLock.swift, Electron's lock.ts).
//
// Answers are plain JSON objects; failures are BridgeError (code, message, path), as Capacitor's on iOS.
import AppKit
import Foundation

final class ShellRouter {
    /// The sender view's place, bound by the host (never an argument).
    let place: () -> String?
    /// The window a sheet or panel attaches to (nil for a runner).
    let window: () -> NSWindow?
    let events: BridgeEvents

    /// Foli AI answers on their way, by the page's id (cancel stops one).
    private var aiTasks: [String: Task<Void, Never>] = [:]

    init(place: @escaping () -> String?, window: @escaping () -> NSWindow?, events: BridgeEvents) {
        self.place = place
        self.window = window
        self.events = events
    }

    private var library: LibraryService { LibraryService.shared }

    /// Every method shell-bridge.js calls (the iOS plugin's list).
    static let methods: Set<String> = [
        "setMode",
        "placesList", "placesSwitch", "placesSignIn", "placesDescribe", "placesSignOut", "placesForgetLibrary", "placesConvexToken", "placesQuickAdd", "placesSetQuickAdd",
        "libSetup", "libInfo", "libList", "libRead", "libWrite", "libRemove", "libConflictVersions", "libResolveConflicts", "libStartDownload",
        "libWatch", "libUnwatch", "libRescan", "journalAppend", "journalRead", "journalTruncate", "libUnlock", "libSetPassphrase", "libChangePassphrase", "libMove",
        "secretsHas", "secretsSet", "secretsDelete",
        "authSignIn", "authSignOut", "authFetch", "authConvexToken",
        "aiCapabilities", "aiGenerate", "aiCancel", "aiTestKey",
        "lockGet", "lockSet", "notifySchedule", "notifyCancel", "filesSave", "httpPreview", "httpCalendar",
        "e2eeDeviceKeys", "e2eeOpen", "e2eeSign", "e2eeReset", "e2eeSettings", "e2eeSetTouchId",
        "cloudStatus", "cloudConnect", "cloudCancel", "cloudSignOut", "cloudRequest", "libSetCloud",
        "mirrorRead", "mirrorWrite", "mirrorDelete", "mirrorPaths", "mirrorLoadState", "mirrorSaveState",
    ]

    @MainActor
    func handle(_ method: String, _ options: [String: Any]) async throws -> [String: Any] {
        guard Self.methods.contains(method) else { throw BridgeError.unavailable("foleviShell (\(method))") }
        let bound = place()
        do {
            return try await ShellPlaces.$acting.withValue(bound) { try await self.route(method, options, bound) }
        } catch {
            throw Self.bridgeError(error)
        }
    }

    /// The page's { code, message, path } for any failure (local-store's codes for the library).
    static func bridgeError(_ error: Error) -> BridgeError {
        switch error {
        case let e as BridgeError: return e
        case let e as LibraryError: return BridgeError(code: e.code.rawValue, message: e.message, path: e.path)
        case let e as E2eeError: return BridgeError(code: e.code, message: e.message)
        case let e as CloudError: return BridgeError(code: e.code, message: e.message)
        default: return BridgeError(code: "io", message: (error as NSError).localizedDescription)
        }
    }

    // MARK: options

    private static func str(_ o: [String: Any], _ k: String) -> String? { o[k] as? String }
    private static func int(_ o: [String: Any], _ k: String) -> Int? { (o[k] as? NSNumber).flatMap { $0 === kCFBooleanTrue || $0 === kCFBooleanFalse ? nil : $0.intValue } }
    private static func double(_ o: [String: Any], _ k: String) -> Double? { (o[k] as? NSNumber)?.doubleValue }
    private static func bool(_ o: [String: Any], _ k: String) -> Bool? { o[k] as? Bool }
    private static func strings(_ o: [String: Any], _ k: String) -> [String] { ((o[k] as? [Any]) ?? []).compactMap { $0 as? String } }

    private static func bytes(_ o: [String: Any], _ k: String) throws -> Data {
        guard let b64 = o[k] as? String, let d = Data(base64Encoded: b64) else { throw LibraryError(.invalidArgument, "Bytes are needed.") }
        return d
    }

    /// Library work on the library's queue, answered with its value (a dictionary as it is, anything else as
    /// { value }), as the iOS plugin's onLibrary.
    private func onLibrary(_ work: @escaping () throws -> Any?) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<[String: Any], Error>) in
            library.queue.async {
                do {
                    let value = try work()
                    if let dict = value as? [String: Any] { cont.resume(returning: dict) } else { cont.resume(returning: ["value": value ?? NSNull()]) }
                } catch {
                    cont.resume(throwing: error)
                }
            }
        }
    }

    private static func orNull(_ v: Any?) -> Any { v ?? NSNull() }

    // MARK: the routes

    @MainActor
    private func route(_ method: String, _ o: [String: Any], _ bound: String?) async throws -> [String: Any] {
        let s = Self.str, places = Places.shared
        switch method {
        // ---- mode and places (Electron's shell:set-mode and shell:places-*)
        case "setMode":
            guard let mode = s(o, "mode"), mode == "local" || mode == "account" else { throw BridgeError.invalid("Unknown mode") }
            places.setMode(mode, from: bound)
            return [:]
        case "placesList":
            return ["places": await places.list()]
        case "placesSwitch":
            guard let id = s(o, "id"), ShellPlaces.has(id) else { throw BridgeError.invalid("That place isn't on this Mac.") }
            places.switchTo(id, path: Places.safePath(s(o, "path")), later: true)
            return [:]
        case "placesSignIn":
            guard let u = await ShellAuth.shared.signInAccount(window: window(), provider: s(o, "provider")) else { return ["value": NSNull()] }
            return ["value": Self.orNull(places.addAccount(u)?.id)]
        case "placesDescribe":
            places.describe(bound, o)
            return [:]
        case "placesSignOut":
            guard let id = s(o, "id"), ShellPlaces.userIdOf(id) != nil, ShellPlaces.has(id) else { throw BridgeError.invalid("That account isn't on this Mac.") }
            await places.signOut(id, next: s(o, "next"))
            return [:]
        case "placesForgetLibrary":
            await places.forgetLibrary()
            return [:]
        case "placesConvexToken":
            // Only a page that is itself signed in moves notes between accounts.
            guard let id = s(o, "id"), let user = ShellPlaces.userIdOf(id), ShellPlaces.has(id), ShellPlaces.currentUserId != nil else { return ["value": NSNull()] }
            return ["value": Self.orNull((try? await ShellAuth.shared.convexToken(for: user)) ?? nil)]
        case "placesQuickAdd":
            return ["value": Self.orNull(places.quickAddPlace)]
        case "placesSetQuickAdd":
            if let id = s(o, "id"), ShellPlaces.has(id) { places.setQuickAdd(id) }
            return [:]

        // ---- the library (LibraryService; Dropbox and Google Drive run in the bridge, folevi-cloud.js)
        case "libSetup", "libMove":
            let kind = s(o, "kind") ?? ""
            guard ["icloud", "folder", "device"].contains(kind) else { throw BridgeError(code: "unavailable", message: "This place isn't on the Mac.", path: "unsupported") }
            var picked: URL?
            if kind == "folder" {
                #if DEBUG
                // Tests: FOLEVI_TEST_FOLDER answers "Choose a folder" (a scratch folder; never a real library).
                if let test = ProcessInfo.processInfo.environment["FOLEVI_TEST_FOLDER"], !test.isEmpty { picked = URL(fileURLWithPath: test, isDirectory: true) }
                #endif
                if picked == nil { picked = await FolderPicker.shared.pick(from: window()) }
                if picked == nil { return method == "libSetup" ? ["value": NSNull()] : try await onLibrary { self.library.info() } }
            }
            let answer = try await onLibrary { method == "libSetup" ? try self.library.setup(kind: kind, picked: picked) : try self.library.move(kind: kind, picked: picked) }
            places.libraryChanged()
            return answer
        case "libInfo":
            return try await onLibrary { self.library.info() }
        case "libList":
            let root = s(o, "root"), dir = s(o, "dir") ?? ""
            return try await onLibrary {
                if let root { return ["entries": try self.library.filesAt(root).list(try LibraryPaths.checkDir(dir)).map(\.json)] }
                return ["entries": try self.library.list(dir)]
            }
        case "libRead":
            let root = s(o, "root"), path = s(o, "path") ?? ""
            return try await onLibrary {
                let r = try root.map { try self.library.filesAt($0).read(try LibraryPaths.check(path)) } ?? self.library.read(path)
                switch r {
                case .notDownloaded: return ["notDownloaded": true]
                case .bytes(let d, let etag): return ["bytes": d.base64EncodedString(), "etag": etag]
                }
            }
        case "libWrite":
            let ifMatch: IfMatch
            switch s(o, "mode") {
            case "create": ifMatch = .create
            case "match":
                guard let e = s(o, "ifMatch") else { throw LibraryError(.invalidArgument, "ifMatch must be a string or null.") }
                ifMatch = .match(e)
            default: ifMatch = .any
            }
            let root = s(o, "root"), path = s(o, "path") ?? ""
            let data = try Self.bytes(o, "bytes")
            return try await onLibrary {
                let r = try root.map { try self.library.filesAt($0).write(try LibraryPaths.check(path), data, ifMatch) } ?? self.library.write(path, data, ifMatch)
                switch r {
                case .written(let etag): return ["etag": etag]
                case .mismatch(let etag): return ["mismatch": true, "etag": etag]
                }
            }
        case "libRemove":
            let path = s(o, "path") ?? "", ifMatch = s(o, "ifMatch")
            return try await onLibrary {
                try self.library.remove(path, ifMatch: ifMatch)
                return nil
            }
        case "libConflictVersions":
            let path = s(o, "path") ?? ""
            return try await onLibrary { ["versions": try self.library.conflictVersions(path).map { ["id": $0.id, "bytes": $0.bytes.base64EncodedString()] }] }
        case "libResolveConflicts":
            let path = s(o, "path") ?? "", ids = Self.strings(o, "ids")
            return try await onLibrary {
                try self.library.resolveConflicts(path, ids: ids)
                return nil
            }
        case "libStartDownload":
            let paths = Self.strings(o, "paths")
            return try await onLibrary {
                try self.library.startDownload(paths)
                return nil
            }
        case "libWatch", "libUnwatch":
            // The watcher runs while the library is open; its changes reach every page in the library.
            return try await onLibrary { nil }
        case "libRescan":
            return try await onLibrary {
                self.library.rescan()
                return nil
            }
        case "journalAppend":
            let record = try Self.bytes(o, "record")
            return try await onLibrary {
                try self.library.journal().append(record)
                return nil
            }
        case "journalRead":
            return try await onLibrary { ["records": try self.library.journal().records().map { $0.base64EncodedString() }] }
        case "journalTruncate":
            let n = Self.int(o, "n") ?? -1
            return try await onLibrary {
                try self.library.journal().truncate(n)
                return nil
            }
        case "libUnlock":
            let passphrase = s(o, "passphrase") ?? ""
            let answer = try await onLibrary { try self.library.unlock(passphrase) }
            places.libraryChanged()
            return answer
        case "libSetPassphrase":
            let passphrase = s(o, "passphrase")
            // The files are rewritten (encrypted or plain): what /_files opened before is stale, done or not.
            defer { places.libraryChanged() }
            return try await onLibrary {
                try self.library.setPassphrase(passphrase)
                return nil
            }
        case "libChangePassphrase":
            let old = s(o, "old") ?? "", new = s(o, "new") ?? ""
            return try await onLibrary { try self.library.changePassphrase(old, new) }

        // ---- Dropbox and Google Drive (ShellCloud.swift; the provider code itself runs in the bridge)
        case "cloudStatus":
            return ShellCloud.shared.status()
        case "cloudConnect":
            return try await ShellCloud.shared.connect(s(o, "provider") ?? "", window: window())
        case "cloudCancel":
            ShellCloud.shared.cancel()
            return [:]
        case "cloudSignOut":
            return await ShellCloud.shared.signOut()
        case "cloudRequest":
            var headers: [String: String] = [:]
            for (k, v) in (o["headers"] as? [String: Any]) ?? [:] { if let value = v as? String { headers[k] = value } }
            let body = s(o, "body").flatMap { Data(base64Encoded: $0) }
            let r = try await ShellCloud.shared.request(s(o, "provider") ?? "", url: s(o, "url") ?? "", method: s(o, "method") ?? "GET", headers: headers, body: body, authorized: Self.bool(o, "authorized") != false)
            return ["status": r.status, "headers": r.headers, "body": r.body.base64EncodedString()]
        case "libSetCloud":
            let kind = s(o, "kind") ?? "", id = s(o, "libraryId") ?? ""
            let answer = try await onLibrary { try self.library.setCloud(kind: kind, libraryId: id) }
            places.libraryChanged()
            return answer
        case "mirrorRead":
            let p = s(o, "provider") ?? "", path = s(o, "path") ?? ""
            return try await onLibrary {
                guard let r = try ShellCloud.mirrorRead(p, path) else { return ["missing": true] }
                return ["data": r.data.base64EncodedString(), "etag": r.etag]
            }
        case "mirrorWrite":
            let p = s(o, "provider") ?? "", path = s(o, "path") ?? "", etag = s(o, "etag") ?? ""
            let data = try Self.bytes(o, "data")
            return try await onLibrary {
                try ShellCloud.mirrorWrite(p, path, data, etag: etag)
                return nil
            }
        case "mirrorDelete":
            let p = s(o, "provider") ?? "", path = s(o, "path") ?? ""
            return try await onLibrary {
                try ShellCloud.mirrorDelete(p, path)
                return nil
            }
        case "mirrorPaths":
            let p = s(o, "provider") ?? ""
            return try await onLibrary { ["paths": try ShellCloud.mirrorPaths(p)] }
        case "mirrorLoadState":
            let p = s(o, "provider") ?? ""
            return try await onLibrary { ["state": Self.orNull(try ShellCloud.mirrorLoadState(p))] }
        case "mirrorSaveState":
            let p = s(o, "provider") ?? "", state = s(o, "state") ?? "null"
            return try await onLibrary {
                try ShellCloud.mirrorSaveState(p, state)
                return nil
            }

        // ---- Foli AI's keys, written and removed, never read back
        case "secretsHas":
            return ["value": ShellSecrets.has(s(o, "name") ?? "")]
        case "secretsSet":
            try ShellSecrets.set(s(o, "name") ?? "", s(o, "value") ?? "")
            return [:]
        case "secretsDelete":
            try ShellSecrets.delete(s(o, "name") ?? "")
            return [:]

        // ---- signing in (ShellAuth: the sign-in sheet, the session in the Keychain, never in the page)
        case "authSignIn":
            // The account becomes one of the places. From the library the page goes on itself (move my notes, or
            // keep them separate) and opens it; a first sign-in, or someone else on a "session ended" screen,
            // opens that account in every window (Electron's signIn).
            guard let u = await ShellAuth.shared.signInAccount(window: window(), provider: s(o, "provider")), let a = places.addAccount(u) else { return ["value": false] }
            if bound != ShellPlaces.library && a.id != bound { places.switchTo(a.id, path: "/documents", later: true) }
            return ["value": true]
        case "authSignOut":
            if let id = bound, ShellPlaces.userIdOf(id) != nil, ShellPlaces.has(id) {
                await places.signOut(id, next: nil)
            } else {
                await ShellAuth.shared.signOut()
            }
            return [:]
        case "authFetch":
            return try await ShellAuth.shared.fetch(path: s(o, "path") ?? "", method: s(o, "method"), headers: o["headers"] as? [String: Any], body: s(o, "body"))
        case "authConvexToken":
            return ["value": Self.orNull(try await ShellAuth.shared.convexToken())]

        // ---- Foli AI on this Mac (ShellAI: Apple's on-device model, or the person's own keys)
        case "aiCapabilities":
            #if DEBUG
            if FakeAI.on { return FakeAI.capabilities }
            #endif
            return ShellAI.capabilities()
        case "aiGenerate":
            guard let id = s(o, "id"), id.count <= 64, let raw = o["req"] as? [String: Any] else { throw BridgeError.invalid("Not a request Foli AI can send.") }
            switch ShellAI.check(raw) {
            case .failure(let e):
                return AiResult(text: "", stopReason: "error", error: e.message, errorCode: "invalid").json
            case .success(let req):
                let events = self.events
                return await withCheckedContinuation { (cont: CheckedContinuation<[String: Any], Never>) in
                    let task = Task {
                        #if DEBUG
                        if FakeAI.on {
                            let result = await FakeAI.generate(req) { text in events.emit("FoleviShell", "aiChunk", ["id": id, "text": text]) }
                            await MainActor.run { self.aiTasks[id] = nil }
                            return cont.resume(returning: result.json)
                        }
                        #endif
                        let result = await ShellAI.generate(req) { text in events.emit("FoleviShell", "aiChunk", ["id": id, "text": text]) }
                        await MainActor.run { self.aiTasks[id] = nil }
                        cont.resume(returning: result.json)
                    }
                    aiTasks[id] = task
                }
            }
        case "aiCancel":
            aiTasks[s(o, "id") ?? ""]?.cancel()
            return [:]
        case "aiTestKey":
            return await ShellAI.testKey(s(o, "provider") ?? "")

        // ---- the Touch ID lock (MacAppLock.swift, Electron's lock.ts)
        case "lockGet":
            return MacAppLock.shared.settings()
        case "lockSet":
            return try await MacAppLock.shared.setSettings(lock: o["lock"], lockAfter: o["lockAfter"])

        // ---- reminders (local mode only, as Electron), files, the web
        case "notifySchedule":
            guard let id = s(o, "id"), let at = Self.double(o, "at") else { throw BridgeError.invalid("Not a reminder.") }
            guard ShellPlaces.modeOf(bound) == "local" else { return ["value": false] }
            do {
                try await ShellNotify.schedule(id: id, at: Date(timeIntervalSince1970: at / 1000), title: s(o, "title") ?? "Reminder", body: s(o, "body") ?? "", path: s(o, "path") ?? "/tasks")
                return ["value": true]
            } catch {
                return ["value": false]
            }
        case "notifyCancel":
            if ShellPlaces.modeOf(bound) == "local" { ShellNotify.cancel(id: s(o, "id") ?? "") }
            return [:]
        case "filesSave":
            guard let data = try? Self.bytes(o, "bytes") else { throw BridgeError.invalid("Bytes are needed.") }
            return ["value": await ShellFiles.shared.save(name: s(o, "name") ?? "Folevi export", bytes: data, from: window())]
        case "httpPreview":
            return ["value": Self.orNull(await ShellHTTP.shared.preview(s(o, "url") ?? ""))]
        case "httpCalendar":
            // Electron's words for a page outside the library (the server reads an account's calendars).
            guard ShellPlaces.modeOf(bound) == "local" else { return ["kind": "error", "message": "Couldn't load this calendar: the address couldn't be reached."] }
            let prev = (o["previous"] as? [String: Any]) ?? [:]
            return await ShellHTTP.shared.calendar(s(o, "url") ?? "", etag: prev["etag"] as? String, lastModified: prev["lastModified"] as? String)

        // ---- this Mac's end-to-end encryption keys (E2eeKeys: the sender's account's own, in the Keychain)
        case "e2eeDeviceKeys":
            let k = try E2eeKeys.shared.deviceKeys()
            return ["deviceId": k.deviceId, "x25519Pub": k.x25519Pub.base64EncodedString(), "ed25519Pub": k.ed25519Pub.base64EncodedString()]
        case "e2eeOpen":
            guard let box = try? Self.bytes(o, "box"), let context = s(o, "context") else { throw BridgeError.invalid("Not a sealed Folevi box.") }
            return ["bytes": try await E2eeKeys.shared.open(box, context: context).base64EncodedString()]
        case "e2eeSign":
            return ["value": try E2eeKeys.shared.sign(kind: s(o, "kind") ?? "", body: s(o, "body") ?? "")]
        case "e2eeReset":
            E2eeKeys.shared.reset()
            return [:]
        case "e2eeSettings":
            let k = E2eeKeys.shared.settings()
            return ["touchId": k.touchId, "available": k.available]
        case "e2eeSetTouchId":
            let k = try await E2eeKeys.shared.setFaceId(Self.bool(o, "on") == true)
            return ["touchId": k.touchId, "available": k.available]

        default:
            throw BridgeError.unavailable("foleviShell (\(method))")
        }
    }
}
