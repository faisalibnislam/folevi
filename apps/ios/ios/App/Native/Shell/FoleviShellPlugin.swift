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
        "libSetup", "libInfo", "libList", "libRead", "libWrite", "libRemove", "libConflictVersions", "libResolveConflicts", "libStartDownload",
        "libWatch", "libUnwatch", "libRescan", "journalAppend", "journalRead", "journalTruncate", "libUnlock", "libSetPassphrase", "libChangePassphrase", "libMove",
        "secretsHas", "secretsSet", "secretsDelete",
        "authSignIn", "authSignOut", "authFetch", "authConvexToken",
        "aiCapabilities", "aiGenerate", "aiCancel", "aiTestKey",
        "lockGet", "lockSet", "notifySchedule", "notifyCancel", "filesSave", "httpPreview", "httpCalendar",
        "e2eeDeviceKeys", "e2eeOpen", "e2eeSign", "e2eeReset", "e2eeSettings", "e2eeSetTouchId",
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
            ShellMode.current = mode
            call.resolve()
            // The page opens again in that mode (the network rules change with it).
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { FoleviViewController.restart() }
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
        onLibrary(call) { ["entries": try self.library.list(call.getString("dir") ?? "")] }
    }

    @objc func libRead(_ call: CAPPluginCall) {
        onLibrary(call) {
            switch try self.library.read(call.getString("path") ?? "") {
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
            switch try self.library.write(call.getString("path") ?? "", try self.bytes(call, "bytes"), ifMatch) {
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
            Task { @MainActor in call.resolve(["value": await ShellAuth.shared.signIn(window: self.bridge?.viewController?.view.window)]) }
        }
    }

    @objc func authSignOut(_ call: CAPPluginCall) {
        guarded(call) {
            Task {
                await ShellAuth.shared.signOut()
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
                    self.aiLock.lock()
                    self.aiTasks[id] = nil
                    self.aiLock.unlock()
                    call.resolve(result.json)
                }
                self.aiLock.lock()
                self.aiTasks[id] = task
                self.aiLock.unlock()
            }
        }
    }

    @objc func aiCancel(_ call: CAPPluginCall) {
        guarded(call) {
            self.aiLock.lock()
            let t = self.aiTasks[call.getString("id") ?? ""]
            self.aiLock.unlock()
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
