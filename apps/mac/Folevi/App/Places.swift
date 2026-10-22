// Several places on the Mac (docs/MULTI_ACCOUNT_PLAN.md §2.2, docs/MAC_WEBKIT_PLAN.md §6.6; Electron's main.ts
// "several places" and places.ts): the library on this Mac and any number of Folevi accounts, kept by the shared
// ShellPlaces (places.json, the same file and model as Electron's). Every main window shows the open place; each
// other place has a hidden runner, a web view in no window on /place-sync?place=<id>, that keeps it syncing and
// its notifications coming. A page is bound to its place by the host: switching places loads every main window
// again in the new place, with that place's policy, network rules and session.
//
// At launch (AppDelegate.beforeFirstWindow) this also opens the library, wires its changes and the cloud status
// to the library's pages, makes the places from what an older run left (ShellPlaces.migrate, as Electron's
// startPlaces), tells the shared services where the website is, and installs the per-view content rules (a
// library's views can't reach Folevi or Convex), the scheduling policy (runners and the library's windows keep
// running behind other windows) and the /_files reader.
import AppKit
import WebKit

@MainActor
final class Places {
    static let shared = Places()

    /// The hidden runners, by place.
    private(set) var runners: [String: FoleviWebView] = [:]
    /// Whether the library is set up (library.info().configured), for its runner.
    private(set) var libraryConfigured = false
    private var localRules: WKContentRuleList?
    /// The /_files reader (AppScheme.files).
    let attachments = LibraryAttachments()
    private var broadcastQueued = false
    private var started = false

    /// Posted after a switch (every main window loading in another place), for the menu bar's recent notes and
    /// Quick Add (WM2): object is the new place (or nil).
    static let switched = Notification.Name("folevi.places.switched")
    /// Posted when Quick Add's place changes (WM2 loads Quick Add again in it).
    static let quickAddChanged = Notification.Name("folevi.places.quickAdd")

    /// Hooks the launch (called from AppDelegate before the first window).
    static func install() {
        guard !Paths.testing else { return }
        AppDelegate.beforeFirstWindow.append { await Places.shared.start() }
        SignInInBrowser.install()
        #if DEBUG
        installEval()
        #endif
    }

    // MARK: launch

    func start() async -> Bool {
        guard !started else { return true }
        started = true
        configureServices()
        let lib = LibraryService.shared
        let attachments = self.attachments
        lib.onChanges = { changes in
            attachments.reset()
            Self.toLibrary("libraryChanges", ["changes": changes])
        }
        lib.onCloudWant = { path in Self.toLibrary("cloudWant", ["path": path]) }
        ShellCloud.shared.onStatus = { status in Self.toLibrary("cloudStatus", ["status": status]) }
        let info = await Self.onLibraryQueue { () -> [String: Any] in
            lib.open()
            return lib.info()
        }
        libraryConfigured = (info["configured"] as? Bool) == true
        startPlaces()
        WindowManager.shared.modeOf = { ShellPlaces.modeOf($0) }
        WindowManager.shared.currentPlace = { ShellPlaces.state.current }
        localRules = await Self.compileLocalRules()
        WebViewFactory.rulesFor = { place, _ in
            guard ShellPlaces.modeOf(place) == "local", let rules = Places.shared.localRules else { return [] }
            return [rules]
        }
        WebViewFactory.configure.append { config, place, role in
            // Electron's applyThrottling, and §6.6: a runner, and the library's windows (its sync and reminders
            // run in the page), keep their timers behind other windows.
            if role == .runner || ShellPlaces.modeOf(place) == "local" { config.preferences.inactiveSchedulingPolicy = .none }
        }
        WebViewFactory.scheme.files = attachments
        NotificationCenter.default.addObserver(forName: ShellPlaces.changed, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Places.shared.placesChanged() }
        }
        MacAppLock.shared.start()
        // Once the first window is on its way.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { MainActor.assumeIsolated { Places.shared.ensureRunners() } }
        return true
    }

    /// Where the website is (sign-in, /api/auth), and the Dropbox and Google Drive clients of this build (the
    /// environment first, as Electron's readCloudConfig; then Info.plist's FoleviDropboxAppKey and
    /// FoleviGoogleClientId, an iOS-type Google client, which works on the Mac too). None: not offered.
    private func configureServices() {
        ShellAuth.shared.service = Paths.serviceURL
        let env = ProcessInfo.processInfo.environment
        let info = { (key: String) in (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces) ?? "" }
        ShellCloud.shared.dropboxAppKey = env["FOLEVI_DROPBOX_APP_KEY"].flatMap { $0.isEmpty ? nil : $0 } ?? info("FoleviDropboxAppKey")
        ShellCloud.shared.googleClientId = env["FOLEVI_GOOGLE_IOS_CLIENT_ID"].flatMap { $0.isEmpty ? nil : $0 } ?? info("FoleviGoogleClientId")
    }

    /// The places from what this Mac had (Electron's startPlaces): a first run makes them from the mode; an account
    /// mode with no open account opens the first one, or the sign-in screen.
    private func startPlaces() {
        ShellPlaces.migrate(libraryConfigured: libraryConfigured)
        let mode = ShellMode.current
        if libraryConfigured && mode == "local" && !ShellPlaces.state.library { ShellPlaces.setLibrary(true) }
        if mode == "account" && ShellPlaces.state.current == nil {
            if let first = ShellPlaces.state.accounts.first { ShellPlaces.setCurrent(first.id) } else { ShellPlaces.pendingAccount = true }
        }
        if mode == "local" && ShellPlaces.state.current == nil && ShellPlaces.state.library { ShellPlaces.setCurrent(ShellPlaces.library) }
        // The one session an older build kept moves to its account (as the iOS app's startPlaces).
        guard ShellAuth.shared.token(for: nil) != nil else { return }
        Task { @MainActor in
            guard let u = await ShellAuth.shared.adoptLegacy(), let a = self.addAccount(u) else { return }
            if ShellPlaces.state.current == nil && ShellMode.current == "account" { self.switchTo(a.id) }
        }
    }

    // MARK: the library's pages

    static func onLibraryQueue<T>(_ work: @escaping () -> T) async -> T {
        await withCheckedContinuation { cont in LibraryService.shared.queue.async { cont.resume(returning: work()) } }
    }

    /// An event for the pages that may use the library (the library's, and the first-launch screen setting one up).
    nonisolated static func toLibrary(_ event: String, _ data: [String: Any]) {
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                Events.broadcast("FoleviShell", event, data, where: { $0 == ShellPlaces.library || $0 == nil })
            }
        }
    }

    /// The library was set up, moved or forgotten: its place and runner follow.
    func libraryChanged() {
        attachments.reset()
        Task { @MainActor in
            let info = await Self.onLibraryQueue { LibraryService.shared.info() }
            self.libraryConfigured = (info["configured"] as? Bool) == true
            self.placesChanged()
        }
    }

    // MARK: the list

    /// The places as the page lists them (lib/shell/types.ts ShellPlace), with the library's own counts.
    func list() async -> [[String: Any]] {
        let info = await Self.onLibraryQueue { LibraryService.shared.info() }
        let configured = (info["configured"] as? Bool) == true
        var out = ShellPlaces.list(libraryKind: configured ? info["kind"] as? String : nil, displayPath: (info["displayPath"] as? String) ?? "", configured: configured)
        let counts = Self.libraryCounts
        for i in out.indices where out[i]["id"] as? String == ShellPlaces.library {
            out[i]["reminders"] = counts.reminders
            out[i]["waiting"] = counts.waiting
        }
        return out
    }

    private static let countsKey = "folevi.places.libraryCounts"

    /// What the library's page last said of itself (Electron's libraryCounts in places.json).
    static var libraryCounts: (reminders: Int, waiting: Int) {
        let d = Paths.defaults.dictionary(forKey: countsKey) ?? [:]
        return ((d["reminders"] as? Int) ?? 0, (d["waiting"] as? Int) ?? 0)
    }

    private static func count(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, n !== kCFBooleanTrue, n !== kCFBooleanFalse, n.doubleValue.isFinite else { return nil }
        return max(0, min(Int(n.doubleValue.rounded(.down)), 1_000_000))
    }

    /// Every place's list to every page, once per change burst; the runners follow.
    func placesChanged() {
        guard !broadcastQueued else { return }
        broadcastQueued = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            MainActor.assumeIsolated {
                self.broadcastQueued = false
                Task { @MainActor in
                    let list = await self.list()
                    Events.broadcast("FoleviShell", "placesChanged", ["places": list])
                    self.ensureRunners()
                }
            }
        }
    }

    // MARK: what the pages ask

    /// What a page says of its own place (the sender's, never one it names).
    func describe(_ place: String?, _ d: [String: Any]) {
        if place == ShellPlaces.library {
            let now = Self.libraryCounts
            let next = (reminders: Self.count(d["reminders"]) ?? now.reminders, waiting: Self.count(d["waiting"]) ?? now.waiting)
            guard next != now else { return }
            Paths.defaults.set(["reminders": next.reminders, "waiting": next.waiting], forKey: Self.countsKey)
            placesChanged()
        } else if let place, ShellPlaces.userIdOf(place) != nil {
            ShellPlaces.describe(place, d)
        }
    }

    /// An account this Mac just signed in to: a place (and its runner); this Mac's first keys if it's the first.
    @discardableResult
    func addAccount(_ u: (userId: String, name: String, email: String, avatarUrl: String?)) -> ShellPlaces.Account? {
        let first = ShellPlaces.state.accounts.isEmpty
        guard let a = ShellPlaces.addAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl) else { return nil }
        if first { E2eeKeys.adoptLegacy(userId: u.userId) }
        return a
    }

    /// The page's mode switch (Electron's shell:set-mode): "local" opens the library (one of the places from now
    /// on); "account" the account signed in last, else the first, else the sign-in screen.
    func setMode(_ mode: String, from place: String?) {
        if mode == "local" {
            if place == ShellPlaces.library && ShellPlaces.state.current == ShellPlaces.library { return }
            ShellPlaces.setLibrary(true)
            libraryConfigured = true
            switchTo(ShellPlaces.library, later: true)
            return
        }
        let s = ShellPlaces.state
        let target = [s.lastAdded, s.accounts.first?.id].compactMap { $0 }.first { ShellPlaces.has($0) }
        if target == place && ShellPlaces.userIdOf(place) != nil { return }
        switchTo(target, pending: target == nil, later: true)
    }

    /// Opens a place in every main window (they load again, at `path`); the place that was open gets a runner.
    /// nil with `pending`: account mode with no account yet (the sign-in screen); without: the first-launch
    /// choice. `later`: once the page asking has its answer.
    func switchTo(_ place: String?, path: String = "/documents", pending: Bool = false, later: Bool = false) {
        guard later else { return applySwitch(place, path: path, pending: pending) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { MainActor.assumeIsolated { self.applySwitch(place, path: path, pending: pending) } }
    }

    private func applySwitch(_ place: String?, path: String, pending: Bool) {
        guard place == nil || ShellPlaces.has(place) else { return }
        ShellPlaces.setCurrent(place, pending: pending)
        for main in WindowManager.shared.mains { main.rebuild(place: .some(place), path: path) }
        ensureRunners()
        NotificationCenter.default.post(name: Self.switched, object: place)
    }

    /// A path a switch may open ("/documents" otherwise), as Electron's places-switch.
    static func safePath(_ raw: String?) -> String {
        guard let raw, raw.hasPrefix("/"), !raw.hasPrefix("//"), raw.count <= 500 else { return "/documents" }
        return raw
    }

    /// Signs this Mac out of one account: its session ends, its keys go, its runner closes. When it was open, the
    /// windows go to the next place (or `next`: the library, after the account came down into it).
    func signOut(_ id: String, next: String?) async {
        guard let user = ShellPlaces.userIdOf(id), ShellPlaces.has(id) else { return }
        await ShellAuth.shared.signOut(userId: user)
        E2eeKeys.forget(userId: user)
        closeRunner(id)
        let wasOpen = ShellPlaces.state.current == id
        var after = ShellPlaces.removeAccount(id)
        if next == ShellPlaces.library {
            if !ShellPlaces.state.library {
                ShellPlaces.setLibrary(true)
                libraryConfigured = true
            }
            after = ShellPlaces.library
        }
        if wasOpen { switchTo(after, later: true) } else { ensureRunners() }
    }

    /// Forgets the library on this Mac (its folder stays as it is): its reminders and runner go; when it was open,
    /// the windows go to the first account, or the first-launch choice.
    func forgetLibrary() async {
        await Self.onLibraryQueue { LibraryService.shared.forget() }
        libraryConfigured = false
        let wasOpen = ShellPlaces.state.current == ShellPlaces.library
        ShellPlaces.setLibrary(false)
        ShellNotify.cancelAll()
        closeRunner(ShellPlaces.library)
        if wasOpen { switchTo(ShellPlaces.state.accounts.first?.id, later: true) }
    }

    /// Quick Add's place: the one picked there last, or the open place (Electron's quickAddPlace).
    var quickAddPlace: String? {
        let s = ShellPlaces.state
        if let q = s.quickAdd, ShellPlaces.has(q) { return q }
        return s.current
    }

    func setQuickAdd(_ id: String) {
        ShellPlaces.setQuickAdd(id)
        NotificationCenter.default.post(name: Self.quickAddChanged, object: id)
    }

    // MARK: runners (§6.6)

    /// One runner per place no main window shows: every account but the open one, and the library when it's set
    /// up and not open.
    func ensureRunners() {
        guard !Paths.testing else { return }
        let s = ShellPlaces.state
        var want = Set(s.accounts.map(\.id).filter { $0 != s.current })
        if s.library && libraryConfigured && s.current != ShellPlaces.library { want.insert(ShellPlaces.library) }
        for id in runners.keys where !want.contains(id) { closeRunner(id) }
        for id in want.sorted() where runners[id] == nil { runners[id] = makeRunner(id) }
    }

    private func makeRunner(_ place: String) -> FoleviWebView {
        let view = WebViewFactory.make(place: place, role: .runner, bootstrap: WindowManager.shared.bootstrapOf(place, .runner), frame: NSRect(x: 0, y: 0, width: 480, height: 320), window: { nil })
        var c = URLComponents()
        c.path = "/place-sync"
        c.queryItems = [URLQueryItem(name: "place", value: place)]
        view.load(URLRequest(url: Links.appURL(c.string ?? "/place-sync")))
        return view
    }

    private func closeRunner(_ place: String) {
        guard let view = runners.removeValue(forKey: place) else { return }
        view.stopLoading()
        // The page leaves (its databases and locks close) before the view goes.
        view.load(URLRequest(url: URL(string: "about:blank")!))
    }

    // MARK: network rules for the library's views

    /// Electron's localModeBlockPatterns: Folevi's and Convex's hosts and the website's, over http(s) and ws(s).
    static func localRulesJSON(serviceHost: String) -> String {
        func esc(_ s: String) -> String { NSRegularExpression.escapedPattern(for: s).replacingOccurrences(of: "\\", with: "\\\\") }
        var filters: [String] = []
        for scheme in ["^https?://", "^wss?://"] {
            filters.append(scheme + "folevi\\\\.com[:/]")
            filters.append(scheme + "[^/]*\\\\.folevi\\\\.com[:/]")
            filters.append(scheme + "[^/]*\\\\.convex\\\\.cloud[:/]")
            filters.append(scheme + "[^/]*\\\\.convex\\\\.site[:/]")
            if !serviceHost.isEmpty { filters.append(scheme + esc(serviceHost.lowercased()) + "[:/]") }
        }
        let rules = Array(Set(filters)).sorted().map { #"{"trigger":{"url-filter":"\#($0)","url-filter-is-case-sensitive":false},"action":{"type":"block"}}"# }
        return "[" + rules.joined(separator: ",") + "]"
    }

    private static func compileLocalRules() async -> WKContentRuleList? {
        let json = localRulesJSON(serviceHost: Paths.serviceURL.host ?? "")
        return try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "folevi-library", encodedContentRuleList: json)
    }
}

#if DEBUG
extension Places {
    /// mac.mjs commands: `cmd places` (the places, runners and lock), `cmd runner-eval {"place","script"}` (an async
    /// function body in a runner's page), `cmd switch {"place","path"}`.
    static func installEval() {
        MacEval.commands["places"] = { _, done in
            let s = ShellPlaces.state
            // The page's process (WebKit's private _webProcessIdentifier, Debug only), for footprint measurements.
            let pid = { (v: FoleviWebView) -> Int in v.responds(to: Selector(("_webProcessIdentifier"))) ? ((v.value(forKey: "_webProcessIdentifier") as? Int) ?? 0) : 0 }
            let runners: [[String: Any]] = Places.shared.runners.map { id, v in ["place": id, "url": v.url?.absoluteString ?? "", "loaded": v.loaded, "inWindow": v.window != nil, "pid": pid(v)] }
            done(["value": [
                "current": s.current ?? NSNull(), "library": s.library, "accounts": s.accounts.map(\.id), "quickAdd": s.quickAdd ?? NSNull(), "mode": ShellMode.current,
                "pending": ShellPlaces.pendingAccount, "libraryConfigured": Places.shared.libraryConfigured, "runners": runners.sorted { ($0["place"] as! String) < ($1["place"] as! String) },
                "lock": MacAppLock.shared.settings(), "covered": MacAppLock.shared.isCovered,
                "mains": WindowManager.shared.mains.map { $0.view.place ?? "" },
                "mainPids": WindowManager.shared.mains.map { pid($0.view) },
            ] as [String: Any]])
        }
        MacEval.commands["runner-eval"] = { req, done in
            guard let place = req["place"] as? String, let view = Places.shared.runners[place], let script = req["script"] as? String else { return done(["error": "no such runner or no script"]) }
            view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let value): done(["value": JSONSerialization.isValidJSONObject(["v": value]) ? value : String(describing: value)])
                case .failure(let error): done(["error": (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription])
                }
            }
        }
        // Forgets the cached key of an encrypted library (the next launch asks for its passphrase).
        MacEval.commands["forget-library-key"] = { _, done in
            let file = Paths.supportFolder.appendingPathComponent("library.json")
            guard let data = try? Data(contentsOf: file), let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let id = json["libraryId"] as? String else { return done(["error": "no library"]) }
            Keychain.delete("com.folevi.library-key", id)
            done(["value": id])
        }
        // A session made outside the app (a test approving /connect in a browser and trading the code itself, since the
        // sign-in sheet can't be driven from a script): kept as that account's, which becomes a place.
        MacEval.commands["test-session"] = { req, done in
            guard let token = req["token"] as? String, token.range(of: #"^[A-Za-z0-9._~+/=-]{16,1024}$"#, options: .regularExpression) != nil else { return done(["error": "no token"]) }
            Task { @MainActor in
                guard let u = await ShellAuth.shared.userOf(token) else { return done(["error": "the website doesn't know that session"]) }
                ShellAuth.shared.setToken(token, for: u.userId)
                guard let a = Places.shared.addAccount(u) else { return done(["error": "not an account"]) }
                if req["open"] as? Bool != false { Places.shared.switchTo(a.id) }
                done(["value": a.id])
            }
        }
        // An account place with no session (scripts that check places and runners without the website).
        MacEval.commands["add-account"] = { req, done in
            guard let user = req["userId"] as? String, let a = Places.shared.addAccount((userId: user, name: req["name"] as? String ?? "Test", email: req["email"] as? String ?? "test@example.com", avatarUrl: nil)) else { return done(["error": "not an account"]) }
            if req["open"] as? Bool == true { Places.shared.switchTo(a.id) }
            done(["value": a.id])
        }
        // Hides the app (every window off screen, as when another app is in front), or shows it again.
        MacEval.commands["hide"] = { req, done in
            if req["value"] as? Bool == false { NSApp.unhide(nil) } else { NSApp.hide(nil) }
            done(["value": NSApp.isHidden])
        }
        MacEval.commands["lock-cover"] = { req, done in
            MacAppLock.shared.debugCover(req["value"] as? Bool != false)
            done(["value": MacAppLock.shared.isCovered])
        }
        MacEval.commands["switch"] = { req, done in
            Places.shared.switchTo(req["place"] as? String, path: Places.safePath(req["path"] as? String))
            done(["value": true])
        }
    }
}
#endif

/// The library's attachments for app://folevi/_files/<sha256> (AppScheme), from the shared LibraryService: a plain
/// library's file, an encrypted one's decrypted a STREAM chunk at a time, or a cloud library's copy here (asked
/// of the bridge when it isn't here yet), as the iOS app's LibraryFileHandler.
final class LibraryAttachments: LibraryFiles {
    private struct Open {
        let at: Date
        let size: Int
        let read: (Int, Int) throws -> Data
    }

    private let lock = NSLock()
    private var open: [String: Open] = [:]

    func stat(_ sha256: String) -> LibraryFileInfo? {
        file(sha256).map { LibraryFileInfo(size: $0.size, mime: nil) }
    }

    func read(_ sha256: String, _ start: Int, _ end: Int) throws -> Data {
        // A file opened a moment ago may have moved since (the library encrypted, moved, or written again): once
        // more from the library before giving up.
        for attempt in 0..<2 {
            guard let f = file(sha256, fresh: attempt > 0), start >= 0, end >= start, end < f.size else { throw URLError(.fileDoesNotExist) }
            do {
                // One read at a time: a stream reader isn't shared across threads.
                lock.lock()
                defer { lock.unlock() }
                return try f.read(start, end - start + 1)
            } catch where attempt == 0 {
                continue
            }
        }
        throw URLError(.fileDoesNotExist)
    }

    /// Forgets what was opened (the library changed).
    func reset() {
        lock.lock()
        open.removeAll()
        lock.unlock()
    }

    private func file(_ sha: String, fresh: Bool = false) -> Open? {
        lock.lock()
        if fresh { open[sha] = nil }
        if let o = open[sha], Date().timeIntervalSince(o.at) < 30 {
            lock.unlock()
            return o
        }
        lock.unlock()
        let service = LibraryService.shared
        guard let place = service.queue.sync(execute: { service.locateAttachment(sha: sha) }), let f = LibraryService.openAttachment(place) else { return nil }
        let o = Open(at: Date(), size: f.size, read: f.read)
        lock.lock()
        if open.count >= 16, let oldest = open.min(by: { $0.value.at < $1.value.at })?.key { open[oldest] = nil }
        open[sha] = o
        lock.unlock()
        return o
    }
}
