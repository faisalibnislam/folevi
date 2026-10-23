// "FoleviShell": the Capacitor plugin behind `window.foleviShell` in the built-in interface (bridge.js,
// docs/LOCAL_MODE_PLAN.md §4.1; the page's types are apps/web/src/lib/shell/types.ts). The iOS twin of the
// Mac's preload.ts and main-process handlers: the library (LibraryService), secrets, sign-in (ShellAuth), Foli
// AI (ShellAI), the lock, reminders, saving files, fetching calendars and previews, and this device's
// end-to-end encryption keys (E2eeKeys). Every call checks the web view is showing the app's own page first.
// Bytes cross as base64; failures reject with the library's code (and `data.path`, the reason) so the page
// reads them as `{ code, message, path }`.
import Capacitor
import UIKit
import WebKit

@objc(FoleviShellPlugin)
final class FoleviShellPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "FoleviShellPlugin"
    let jsName = "FoleviShell"
    let pluginMethods: [CAPPluginMethod] = [
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
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private var appOrigin: String { AppOrigin.of(bridge?.config.serverURL) }
    private var library: LibraryService { LibraryService.shared }
    private var aiTasks: [String: Task<Void, Never>] = [:]
    private let aiLock = NSLock()

    override func load() {
        library.onChanges = { [weak self] changes in
            self?.notifyListeners("libraryChanges", data: ["changes": changes])
        }
        library.queue.async { self.library.open() }
        library.onCloudWant = { [weak self] path in self?.notifyListeners("cloudWant", data: ["path": path]) }
        ShellCloud.shared.onStatus = { [weak self] status in self?.notifyListeners("cloudStatus", data: ["status": status]) }
    }

    /// Whether the page asking is the app's own (the built-in interface), never another site.
    @MainActor private var fromApp: Bool {
        guard let page = bridge?.webView?.url else { return false }
        return !appOrigin.isEmpty && AppOrigin.of(page) == appOrigin
    }

    /// Runs `work` for a call from the app's own page, answering a refusal otherwise.
    private func guarded(_ call: CAPPluginCall, _ work: @escaping () -> Void) {
        Task { @MainActor in
            guard self.fromApp else { return call.reject("Not allowed here", "unavailable") }
            work()
        }
    }

    private func fail(_ call: CAPPluginCall, _ error: Error) {
        if let e = error as? LibraryError {
            call.reject(e.message, e.code.rawValue, nil, e.path.map { ["path": $0] } ?? [:])
        } else if let e = error as? E2eeError {
            call.reject(e.message, e.code)
        } else {
            call.reject(error.localizedDescription, "io")
        }
    }

    /// Library work on the library's queue, answered with its value.
    private func onLibrary(_ call: CAPPluginCall, _ work: @escaping () throws -> Any?) {
        guarded(call) {
            self.library.queue.async {
                do {
                    let value = try work()
                    if let dict = value as? [String: Any] { call.resolve(dict) } else { call.resolve(["value": value ?? NSNull()]) }
                } catch {
                    self.fail(call, error)
                }
            }
        }
    }

    private func bytes(_ call: CAPPluginCall, _ key: String) throws -> Data {
        guard let b64 = call.getString(key), let d = Data(base64Encoded: b64) else { throw LibraryError(.invalidArgument, "Bytes are needed.") }
        return d
    }

    // MARK: mode

    @objc func setMode(_ call: CAPPluginCall) {
        guarded(call) {
            guard let mode = call.getString("mode"), mode == "local" || mode == "account" else { return call.reject("Unknown mode", "invalid_argument") }
            // Several places (ShellPlaces): "local" opens the library (one of the places from now on); "account" the
            // account signed in last, else the first, else the sign-in screen.
            if mode == "local" {
                ShellPlaces.setLibrary(true)
                ShellPlaces.setCurrent(ShellPlaces.library)
            } else {
                let s = ShellPlaces.state
                let target = s.lastAdded ?? s.accounts.first?.id
                ShellPlaces.setCurrent(target, pending: target == nil)
            }
            call.resolve()
            // The page opens again in that place (the network rules change with it).
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { FoleviViewController.restart() }
        }
    }

    // MARK: places (docs/MULTI_ACCOUNT_PLAN.md §2.2)

    private func libraryInfo(_ done: @escaping (_ kind: String?, _ path: String, _ configured: Bool) -> Void) {
        library.queue.async {
            let i = self.library.info()
            let configured = (i["configured"] as? Bool) == true
            done(configured ? i["kind"] as? String : nil, (i["displayPath"] as? String) ?? "", configured)
        }
    }

    private func broadcastPlaces() {
        libraryInfo { kind, path, configured in
            self.notifyListeners("placesChanged", data: ["places": ShellPlaces.list(libraryKind: kind, displayPath: path, configured: configured)])
        }
    }

    @objc func placesList(_ call: CAPPluginCall) {
        guarded(call) { self.libraryInfo { kind, path, configured in call.resolve(["places": ShellPlaces.list(libraryKind: kind, displayPath: path, configured: configured)]) } }
    }

    @objc func placesSwitch(_ call: CAPPluginCall) {
        guarded(call) {
            guard let id = call.getString("id"), ShellPlaces.has(id) else { return call.reject("That place isn't on this device.", "invalid_argument") }
            let path = call.getString("path").flatMap { $0.hasPrefix("/") && !$0.hasPrefix("//") && $0.count <= 500 ? $0 : nil } ?? "/documents"
            ShellPlaces.setCurrent(id)
            FoleviViewController.startPath = path
            call.resolve()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { FoleviViewController.restart() }
        }
    }

    @objc func placesSignIn(_ call: CAPPluginCall) {
        guarded(call) {
            Task { @MainActor in
                guard let u = await ShellAuth.shared.signInAccount(window: self.bridge?.viewController?.view.window, provider: call.getString("provider")) else { return call.resolve(["value": NSNull()]) }
                let first = ShellPlaces.state.accounts.isEmpty
                let a = ShellPlaces.addAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl)
                if first { E2eeKeys.adoptLegacy(userId: u.userId) }
                self.broadcastPlaces()
                call.resolve(["value": a.map { $0.id as Any } ?? NSNull()])
            }
        }
    }

    @objc func placesDescribe(_ call: CAPPluginCall) {
        guarded(call) {
            if let place = ShellPlaces.state.current, ShellPlaces.userIdOf(place) != nil { ShellPlaces.describe(place, call.options as? [String: Any] ?? [:]) }
            call.resolve()
        }
    }

    @objc func placesSignOut(_ call: CAPPluginCall) {
        guarded(call) {
            guard let id = call.getString("id"), let user = ShellPlaces.userIdOf(id), ShellPlaces.has(id) else { return call.reject("That account isn't on this device.", "invalid_argument") }
            let next = call.getString("next")
            Task {
                await ShellAuth.shared.signOut(userId: user)
                E2eeKeys.forget(userId: user)
                let wasOpen = ShellPlaces.state.current == id
                var after = ShellPlaces.removeAccount(id)
                if next == ShellPlaces.library {
                    ShellPlaces.setLibrary(true)
                    after = ShellPlaces.library
                }
                if wasOpen { ShellPlaces.setCurrent(after) }
                call.resolve()
                if wasOpen { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { FoleviViewController.restart() } } else { self.broadcastPlaces() }
            }
        }
    }

    @objc func placesForgetLibrary(_ call: CAPPluginCall) {
        guarded(call) {
            self.library.queue.async {
                self.library.forget()
                DispatchQueue.main.async {
                    let wasOpen = ShellPlaces.state.current == ShellPlaces.library
                    ShellPlaces.setLibrary(false)
                    ShellNotify.cancelAll()
                    if wasOpen { ShellPlaces.setCurrent(ShellPlaces.state.accounts.first?.id) }
                    call.resolve()
                    if wasOpen { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { FoleviViewController.restart() } }
                }
            }
        }
    }

    @objc func placesConvexToken(_ call: CAPPluginCall) {
        guarded(call) {
            // Only a page that is itself signed in moves notes between accounts.
            guard let id = call.getString("id"), let user = ShellPlaces.userIdOf(id), ShellPlaces.has(id), ShellPlaces.currentUserId != nil else { return call.resolve(["value": NSNull()]) }
            Task { call.resolve(["value": ((try? await ShellAuth.shared.convexToken(for: user)) ?? nil).map { $0 as Any } ?? NSNull()]) }
        }
    }

    @objc func placesQuickAdd(_ call: CAPPluginCall) {
        // The place chosen last anywhere: in the app's Quick Add, the share sheet, Siri or a widget (SaveTargets).
        guarded(call) { call.resolve(["value": ([SaveTargets.last(), ShellPlaces.state.quickAdd, ShellPlaces.state.current].compactMap { $0 }.first { ShellPlaces.has($0) }).map { $0 as Any } ?? NSNull()]) }
    }

    @objc func placesSetQuickAdd(_ call: CAPPluginCall) {
        guarded(call) {
            if let id = call.getString("id") { ShellPlaces.setQuickAdd(id) }
            call.resolve()
        }
    }

    // MARK: library

    @objc func libSetup(_ call: CAPPluginCall) {
        guarded(call) {
            let kind = call.getString("kind") ?? ""
            guard ["icloud", "folder", "device"].contains(kind) else { return call.reject("This place isn't on iPhone and iPad.", "unavailable", nil, ["path": "unsupported"]) }
            Task { @MainActor in
                var picked: URL?
                if kind == "folder" {
                    picked = await FolderPicker.shared.pick(from: self.topController())
                    if picked == nil { return call.resolve(["value": NSNull()]) }
                }
                self.library.queue.async {
                    do { call.resolve(try self.library.setup(kind: kind, picked: picked)) } catch { self.fail(call, error) }
                }
            }
        }
    }

    @objc func libMove(_ call: CAPPluginCall) {
        guarded(call) {
            let kind = call.getString("kind") ?? ""
            guard ["icloud", "folder", "device"].contains(kind) else { return call.reject("This place isn't on iPhone and iPad.", "unavailable", nil, ["path": "unsupported"]) }
            Task { @MainActor in
                var picked: URL?
                if kind == "folder" {
                    picked = await FolderPicker.shared.pick(from: self.topController())
                    if picked == nil {
                        return self.library.queue.async { call.resolve(self.library.info()) }
                    }
                }
                self.library.queue.async {
                    do { call.resolve(try self.library.move(kind: kind, picked: picked)) } catch { self.fail(call, error) }
                }
            }
        }
    }

    @objc func libInfo(_ call: CAPPluginCall) { onLibrary(call) { self.library.info() } }

    @objc func libList(_ call: CAPPluginCall) {
        onLibrary(call) {
            if let root = call.getString("root") { return ["entries": try self.library.filesAt(root).list(try LibraryPaths.checkDir(call.getString("dir") ?? "")).map(\.json)] }
            return ["entries": try self.library.list(call.getString("dir") ?? "")]
        }
    }

    @objc func libRead(_ call: CAPPluginCall) {
        onLibrary(call) {
            let path = call.getString("path") ?? ""
            let r = try call.getString("root").map { try self.library.filesAt($0).read(try LibraryPaths.check(path)) } ?? self.library.read(path)
            switch r {
            case .notDownloaded: return ["notDownloaded": true]
            case .bytes(let d, let etag): return ["bytes": d.base64EncodedString(), "etag": etag]
            }
        }
    }

    @objc func libWrite(_ call: CAPPluginCall) {
        onLibrary(call) {
            let ifMatch: IfMatch
            switch call.getString("mode") {
            case "create": ifMatch = .create
            case "match":
                guard let e = call.getString("ifMatch") else { throw LibraryError(.invalidArgument, "ifMatch must be a string or null.") }
                ifMatch = .match(e)
            default: ifMatch = .any
            }
            let path = call.getString("path") ?? ""
            let data = try self.bytes(call, "bytes")
            let r = try call.getString("root").map { try self.library.filesAt($0).write(try LibraryPaths.check(path), data, ifMatch) } ?? self.library.write(path, data, ifMatch)
            switch r {
            case .written(let etag): return ["etag": etag]
            case .mismatch(let etag): return ["mismatch": true, "etag": etag]
            }
        }
    }

    @objc func libRemove(_ call: CAPPluginCall) {
        onLibrary(call) {
            try self.library.remove(call.getString("path") ?? "", ifMatch: call.getString("ifMatch"))
            return nil
        }
    }

    @objc func libConflictVersions(_ call: CAPPluginCall) {
        onLibrary(call) { ["versions": try self.library.conflictVersions(call.getString("path") ?? "").map { ["id": $0.id, "bytes": $0.bytes.base64EncodedString()] }] }
    }

    @objc func libResolveConflicts(_ call: CAPPluginCall) {
        onLibrary(call) {
            try self.library.resolveConflicts(call.getString("path") ?? "", ids: (call.getArray("ids") ?? []).compactMap { $0 as? String })
            return nil
        }
    }

    @objc func libStartDownload(_ call: CAPPluginCall) {
        onLibrary(call) {
            try self.library.startDownload((call.getArray("paths") ?? []).compactMap { $0 as? String })
            return nil
        }
    }

    @objc func libWatch(_ call: CAPPluginCall) { onLibrary(call) { nil } }
    @objc func libUnwatch(_ call: CAPPluginCall) { onLibrary(call) { nil } }

    @objc func libRescan(_ call: CAPPluginCall) {
        onLibrary(call) {
            self.library.rescan()
            return nil
        }
    }

    @objc func journalAppend(_ call: CAPPluginCall) {
        onLibrary(call) {
            try self.library.journal().append(try self.bytes(call, "record"))
            return nil
        }
    }

    @objc func journalRead(_ call: CAPPluginCall) {
        onLibrary(call) { ["records": try self.library.journal().records().map { $0.base64EncodedString() }] }
    }

    @objc func journalTruncate(_ call: CAPPluginCall) {
        onLibrary(call) {
            try self.library.journal().truncate(call.getInt("n") ?? -1)
            return nil
        }
    }

    @objc func libUnlock(_ call: CAPPluginCall) { onLibrary(call) { try self.library.unlock(call.getString("passphrase") ?? "") } }

    @objc func libSetPassphrase(_ call: CAPPluginCall) {
        onLibrary(call) {
            try self.library.setPassphrase(call.getString("passphrase"))
            return nil
        }
    }

    @objc func libChangePassphrase(_ call: CAPPluginCall) {
        onLibrary(call) { try self.library.changePassphrase(call.getString("old") ?? "", call.getString("new") ?? "") }
    }

    // MARK: Dropbox and Google Drive (ShellCloud.swift; the provider code itself runs in the bridge)

    private func cloudFail(_ call: CAPPluginCall, _ error: Error) {
        if let e = error as? CloudError { call.reject(e.message, e.code) } else { fail(call, error) }
    }

    @objc func cloudStatus(_ call: CAPPluginCall) { guarded(call) { call.resolve(ShellCloud.shared.status()) } }

    @objc func cloudConnect(_ call: CAPPluginCall) {
        guarded(call) {
            Task { @MainActor in
                do { call.resolve(try await ShellCloud.shared.connect(call.getString("provider") ?? "", window: self.bridge?.viewController?.view.window)) } catch { self.cloudFail(call, error) }
            }
        }
    }

    @objc func cloudCancel(_ call: CAPPluginCall) {
        guarded(call) {
            ShellCloud.shared.cancel()
            call.resolve()
        }
    }

    @objc func cloudSignOut(_ call: CAPPluginCall) { guarded(call) { Task { call.resolve(await ShellCloud.shared.signOut()) } } }

    @objc func cloudRequest(_ call: CAPPluginCall) {
        guarded(call) {
            var headers: [String: String] = [:]
            for (k, v) in (call.options["headers"] as? [String: Any]) ?? [:] { if let s = v as? String { headers[k] = s } }
            let body = call.getString("body").flatMap { Data(base64Encoded: $0) }
            Task {
                do {
                    let r = try await ShellCloud.shared.request(call.getString("provider") ?? "", url: call.getString("url") ?? "", method: call.getString("method") ?? "GET", headers: headers, body: body, authorized: call.getBool("authorized") != false)
                    call.resolve(["status": r.status, "headers": r.headers, "body": r.body.base64EncodedString()])
                } catch { self.cloudFail(call, error) }
            }
        }
    }

    @objc func libSetCloud(_ call: CAPPluginCall) { onLibrary(call) { try self.library.setCloud(kind: call.getString("kind") ?? "", libraryId: call.getString("libraryId") ?? "") } }

    @objc func mirrorRead(_ call: CAPPluginCall) {
        onLibrary(call) {
            guard let r = try ShellCloud.mirrorRead(call.getString("provider") ?? "", call.getString("path") ?? "") else { return ["missing": true] }
            return ["data": r.data.base64EncodedString(), "etag": r.etag]
        }
    }

    @objc func mirrorWrite(_ call: CAPPluginCall) {
        onLibrary(call) {
            try ShellCloud.mirrorWrite(call.getString("provider") ?? "", call.getString("path") ?? "", try self.bytes(call, "data"), etag: call.getString("etag") ?? "")
            return nil
        }
    }

    @objc func mirrorDelete(_ call: CAPPluginCall) {
        onLibrary(call) {
            try ShellCloud.mirrorDelete(call.getString("provider") ?? "", call.getString("path") ?? "")
            return nil
        }
    }

    @objc func mirrorPaths(_ call: CAPPluginCall) { onLibrary(call) { ["paths": try ShellCloud.mirrorPaths(call.getString("provider") ?? "")] } }
    @objc func mirrorLoadState(_ call: CAPPluginCall) { onLibrary(call) { ["state": (try ShellCloud.mirrorLoadState(call.getString("provider") ?? "")).map { $0 as Any } ?? NSNull()] } }

    @objc func mirrorSaveState(_ call: CAPPluginCall) {
        onLibrary(call) {
            try ShellCloud.mirrorSaveState(call.getString("provider") ?? "", call.getString("state") ?? "null")
            return nil
        }
    }

    // MARK: secrets

    @objc func secretsHas(_ call: CAPPluginCall) { guarded(call) { call.resolve(["value": ShellSecrets.has(call.getString("name") ?? "")]) } }

    @objc func secretsSet(_ call: CAPPluginCall) {
        guarded(call) {
            do {
                try ShellSecrets.set(call.getString("name") ?? "", call.getString("value") ?? "")
                call.resolve()
            } catch { self.fail(call, error) }
        }
    }

    @objc func secretsDelete(_ call: CAPPluginCall) {
        guarded(call) {
            do {
                try ShellSecrets.delete(call.getString("name") ?? "")
                call.resolve()
            } catch { self.fail(call, error) }
        }
    }

    // MARK: sign-in

    @objc func authSignIn(_ call: CAPPluginCall) {
        guarded(call) {
            Task { @MainActor in
                // Several places: the account becomes one of them. From the library the page goes on itself (move my
                // notes, or keep them separate) and opens it; otherwise the app opens it now.
                let place = ShellPlaces.state.current
                guard let u = await ShellAuth.shared.signInAccount(window: self.bridge?.viewController?.view.window, provider: call.getString("provider")) else { return call.resolve(["value": false]) }
                let first = ShellPlaces.state.accounts.isEmpty
                guard let a = ShellPlaces.addAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl) else { return call.resolve(["value": false]) }
                if first { E2eeKeys.adoptLegacy(userId: u.userId) }
                if place != ShellPlaces.library && a.id != place { ShellPlaces.setCurrent(a.id) }
                call.resolve(["value": true])
            }
        }
    }

    @objc func authSignOut(_ call: CAPPluginCall) {
        guarded(call) {
            Task {
                if let place = ShellPlaces.state.current, let user = ShellPlaces.userIdOf(place) {
                    await ShellAuth.shared.signOut(userId: user)
                    E2eeKeys.forget(userId: user)
                    ShellPlaces.setCurrent(ShellPlaces.removeAccount(place))
                } else {
                    await ShellAuth.shared.signOut()
                }
                call.resolve()
            }
        }
    }

    @objc func authFetch(_ call: CAPPluginCall) {
        guarded(call) {
            Task {
                do {
                    call.resolve(try await ShellAuth.shared.fetch(path: call.getString("path") ?? "", method: call.getString("method"), headers: call.options["headers"] as? [String: Any], body: call.getString("body")))
                } catch { self.fail(call, error) }
            }
        }
    }

    @objc func authConvexToken(_ call: CAPPluginCall) {
        guarded(call) {
            Task {
                do { call.resolve(["value": try await ShellAuth.shared.convexToken() ?? NSNull()]) } catch { self.fail(call, error) }
            }
        }
    }

    // MARK: Foli AI

    @objc func aiCapabilities(_ call: CAPPluginCall) { guarded(call) { call.resolve(ShellAI.capabilities()) } }

    @objc func aiGenerate(_ call: CAPPluginCall) {
        guarded(call) {
            guard let id = call.getString("id"), id.count <= 64, let raw = call.options["req"] as? [String: Any] else { return call.reject("Not a request Foli AI can send.", "invalid_argument") }
            switch ShellAI.check(raw) {
            case .failure(let e):
                call.resolve(AiResult(text: "", stopReason: "error", error: e.message, errorCode: "invalid").json)
            case .success(let req):
                let task = Task {
                    let result = await ShellAI.generate(req) { [weak self] text in self?.notifyListeners("aiChunk", data: ["id": id, "text": text]) }
                    self.aiLock.withLock { self.aiTasks[id] = nil }
                    call.resolve(result.json)
                }
                self.aiLock.withLock { self.aiTasks[id] = task }
            }
        }
    }

    @objc func aiCancel(_ call: CAPPluginCall) {
        guarded(call) {
            let t = self.aiLock.withLock { self.aiTasks[call.getString("id") ?? ""] }
            t?.cancel()
            call.resolve()
        }
    }

    @objc func aiTestKey(_ call: CAPPluginCall) {
        guarded(call) { Task { call.resolve(await ShellAI.testKey(call.getString("provider") ?? "")) } }
    }

    // MARK: the lock

    private static func lockSettings() -> [String: Any] {
        ["lock": LockSettings.enabled, "lockAfter": LockSettings.after, "method": LockSettings.method()]
    }

    @objc func lockGet(_ call: CAPPluginCall) { guarded(call) { call.resolve(Self.lockSettings()) } }

    @objc func lockSet(_ call: CAPPluginCall) {
        guarded(call) {
            Task { @MainActor in
                if let after = call.getInt("lockAfter") {
                    guard LockSettings.choices.contains(after) else { return call.reject("Unknown lock time", "invalid_argument") }
                    LockSettings.after = after
                }
                if let lock = call.getBool("lock"), lock != LockSettings.enabled {
                    if lock {
                        guard LockSettings.method() != "none" else { return call.reject("Set a passcode for this device in the Settings app first.", "unavailable") }
                        guard await AppLock.confirm(reason: "Turn on the lock for Folevi") else { return call.reject("The lock wasn't turned on.", "cancelled") }
                    }
                    LockSettings.enabled = lock
                }
                call.resolve(Self.lockSettings())
            }
        }
    }

    // MARK: reminders, files, the web

    @objc func notifySchedule(_ call: CAPPluginCall) {
        guarded(call) {
            guard let id = call.getString("id"), let at = call.getDouble("at") else { return call.reject("Not a reminder.", "invalid_argument") }
            Task {
                do {
                    try await ShellNotify.schedule(id: id, at: Date(timeIntervalSince1970: at / 1000), title: call.getString("title") ?? "Reminder", body: call.getString("body") ?? "", path: call.getString("path") ?? "/tasks")
                    call.resolve(["value": true])
                } catch { call.resolve(["value": false]) }
            }
        }
    }

    @objc func notifyCancel(_ call: CAPPluginCall) {
        guarded(call) {
            ShellNotify.cancel(id: call.getString("id") ?? "")
            call.resolve()
        }
    }

    @objc func filesSave(_ call: CAPPluginCall) {
        guarded(call) {
            guard let data = try? self.bytes(call, "bytes") else { return call.reject("Bytes are needed.", "invalid_argument") }
            Task { @MainActor in call.resolve(["value": await ShellFiles.shared.save(name: call.getString("name") ?? "Folevi export", bytes: data, from: self.topController())]) }
        }
    }

    @objc func httpPreview(_ call: CAPPluginCall) {
        guarded(call) { Task { call.resolve(["value": await ShellHTTP.shared.preview(call.getString("url") ?? "") ?? NSNull()]) } }
    }

    @objc func httpCalendar(_ call: CAPPluginCall) {
        guarded(call) {
            let prev = (call.options["previous"] as? [String: Any]) ?? [:]
            Task { call.resolve(await ShellHTTP.shared.calendar(call.getString("url") ?? "", etag: prev["etag"] as? String, lastModified: prev["lastModified"] as? String)) }
        }
    }

    // MARK: end-to-end encryption

    @objc func e2eeDeviceKeys(_ call: CAPPluginCall) {
        guarded(call) {
            do {
                let k = try E2eeKeys.shared.deviceKeys()
                call.resolve(["deviceId": k.deviceId, "x25519Pub": k.x25519Pub.base64EncodedString(), "ed25519Pub": k.ed25519Pub.base64EncodedString()])
            } catch { self.fail(call, error) }
        }
    }

    @objc func e2eeOpen(_ call: CAPPluginCall) {
        guarded(call) {
            guard let box = try? self.bytes(call, "box"), let context = call.getString("context") else { return call.reject("Not a sealed Folevi box.", "invalid_argument") }
            Task {
                do { call.resolve(["bytes": try await E2eeKeys.shared.open(box, context: context).base64EncodedString()]) } catch { self.fail(call, error) }
            }
        }
    }

    @objc func e2eeSign(_ call: CAPPluginCall) {
        guarded(call) {
            do { call.resolve(["value": try E2eeKeys.shared.sign(kind: call.getString("kind") ?? "", body: call.getString("body") ?? "")]) } catch { self.fail(call, error) }
        }
    }

    @objc func e2eeReset(_ call: CAPPluginCall) {
        guarded(call) {
            E2eeKeys.shared.reset()
            call.resolve()
        }
    }

    @objc func e2eeSettings(_ call: CAPPluginCall) {
        guarded(call) {
            let s = E2eeKeys.shared.settings()
            call.resolve(["touchId": s.touchId, "available": s.available])
        }
    }

    @objc func e2eeSetTouchId(_ call: CAPPluginCall) {
        guarded(call) {
            Task {
                do {
                    let s = try await E2eeKeys.shared.setFaceId(call.getBool("on") == true)
                    call.resolve(["touchId": s.touchId, "available": s.available])
                } catch { self.fail(call, error) }
            }
        }
    }

    @MainActor private func topController() -> UIViewController? {
        var top = bridge?.viewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
