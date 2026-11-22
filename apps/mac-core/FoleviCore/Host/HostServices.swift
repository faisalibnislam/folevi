// Small host services the shared files call by name: the launch hook (`AppDelegate.beforeFirstWindow`), the
// Touch ID lock (`MacAppLock`, `AppLock`) and Spotlight (`Spotlight`). Core's versions of each.
import AppKit
import CoreSpotlight
import os

enum CoreLog {
    static let launch = Logger(subsystem: "app.folevicore", category: "launch")
    static let engine = Logger(subsystem: "app.folevicore", category: "engine")

    /// Debug builds also keep a plain log in the support folder's Debug/core.log (scripts read it).
    static func debug(_ message: String) {
        #if DEBUG
        let line = "\(Date().formatted(.iso8601)) \(message)\n"
        let url = Paths.debugFolder.appendingPathComponent("core.log")
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile()
            h.write(Data(line.utf8))
            try? h.close()
        } else {
            try? Data(line.utf8).write(to: url)
        }
        #endif
    }
}
import LocalAuthentication
import UniformTypeIdentifiers

/// The app delegate: launch work the shared Places hooks into, reopen, Services and the Dock menu.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Work before the first window shows (Places.start). Each returns whether launch may go on.
    static var beforeFirstWindow: [() async -> Bool] = []

    /// Set once `beforeFirstWindow` ran.
    private(set) static var launched = false
    private static var waiters: [CheckedContinuation<Void, Never>] = []

    /// Waits until launch work is done (the app model starts its pages after it).
    static func whenLaunched() async {
        if launched { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    /// The app model's hooks (Core's own windows, Quick Add, the Dock menu).
    static var onReopen: (() -> Void)?
    static var onOpenURLs: (([URL]) -> Void)?
    static var dockMenu: (() -> NSMenu?)?
    static var services: NSObject?

    /// Links that arrive while launching (a folevi-core:// link that opened the app) are caught before the app is
    /// up and handed on like any other (they wait for the windows).
    @objc func handleGetURL(_ event: NSAppleEventDescriptor, withReplyEvent reply: NSAppleEventDescriptor) {
        guard let s = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue, let url = URL(string: s) else { return }
        Self.onOpenURLs?([url])
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleGetURL(_:withReplyEvent:)), forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
        // Before any web view: spelling is checked while typing in notes, as in today's app.
        UserDefaults.standard.register(defaults: ["WebContinuousSpellCheckingEnabled": true])
        CoreLog.debug("willFinishLaunching")
        Offline.installIfAsked()
        Places.install()
        NSWindow.allowsAutomaticWindowTabbing = true
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        CoreLog.debug("didFinishLaunching")
        if let services = Self.services { NSApp.servicesProvider = services }
        NSUpdateDynamicServices()
        Task { @MainActor in
            CoreLog.debug("launch: rules")
            await WebViewFactory.prepareRules()
            CoreLog.debug("launch: \(Self.beforeFirstWindow.count) steps")
            for step in Self.beforeFirstWindow { _ = await step() }
            CoreLog.debug("launch: done")
            Self.launched = true
            for waiter in Self.waiters { waiter.resume() }
            Self.waiters.removeAll()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { Self.onReopen?() }
        return true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        Self.onOpenURLs?(urls)
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? { Self.dockMenu?() }

    /// A Spotlight result or a Handoff of a note: the note opens in Core (in its place).
    static var onContinue: ((NSUserActivity) -> Bool)?

    func application(_ application: NSApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void) -> Bool {
        Self.onContinue?(userActivity) ?? false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        PagePool.shared.client?.snapshot?.flush()
        // Every page saves what was typed last before the app goes.
        let views = WindowManager.shared.allViews.filter(\.loaded)
        guard !views.isEmpty else { return .terminateNow }
        var left = views.count
        for view in views {
            PageClosing.flush(view) {
                left -= 1
                if left == 0 { NSApp.reply(toApplicationShouldTerminate: true) }
            }
        }
        return .terminateLater
    }
}

// MARK: the Touch ID lock

/// Asks for Touch ID (or the Mac's password) before something sensitive (the shared E2eeKeys calls it).
enum AppLock {
    /// When the last yes was given: one yes covers 30 s of encrypted notes opening.
    nonisolated(unsafe) private static var lastYes: Date?

    /// `fresh`: always ask (unlocking the cover, changing the lock); otherwise a yes in the last 30 s counts.
    static func confirm(reason: String, fresh: Bool = false) async -> Bool {
        if !fresh, let last = lastYes, Date().timeIntervalSince(last) < 30 { return true }
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return true }
        let ok = (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) == true
        if ok { lastYes = Date() }
        return ok
    }
}

/// "Lock Folevi Core": Touch ID before the app's windows show their notes, after it was away for a while. The
/// cover itself is Core's (Views/AppLockCover.swift); this keeps the settings and the state.
@MainActor
@Observable
final class MacAppLock {
    static let shared = MacAppLock()

    private static let key = "folevi.lock"

    /// "lock": on or off; "lockAfter": seconds away before it asks (0 = every time).
    private(set) var lock = false
    private(set) var lockAfter = 0
    /// The cover is up (notes hidden until Touch ID).
    private(set) var isCovered = false
    private var awaySince: Date?

    func start() {
        let saved = Paths.defaults.dictionary(forKey: Self.key) ?? [:]
        lock = saved["lock"] as? Bool ?? false
        lockAfter = saved["lockAfter"] as? Int ?? 0
        if lock { isCovered = true }
        let center = NotificationCenter.default
        center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { MacAppLock.shared.awaySince = Date() }
        }
        center.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { MacAppLock.shared.cameBack() }
        }
        let cover: @Sendable (Notification) -> Void = { _ in
            MainActor.assumeIsolated { if MacAppLock.shared.lock { MacAppLock.shared.isCovered = true } }
        }
        // Sleep, the screen locking and switching to another user all cover the windows.
        for name in [NSWorkspace.screensDidSleepNotification, NSWorkspace.willSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main, using: cover)
        }
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("com.apple.screenIsLocked"), object: nil, queue: .main, using: cover)
        watchKeys()
    }

    private func cameBack() {
        defer { awaySince = nil }
        guard lock, let since = awaySince else { return }
        if Date().timeIntervalSince(since) >= Double(lockAfter) { isCovered = true }
    }

    /// What the page reads (foleviShell.lockGet): { lock, lockAfter, method }, "touchID" or "none".
    func settings() -> [String: Any] {
        let method = Self.available ? "touchID" : "none"
        return ["lock": lock && method != "none", "lockAfter": lockAfter, "method": method]
    }

    /// Sets the lock from Core's own Settings (asks for Touch ID when it turns on or off).
    func set(lock on: Bool? = nil, after seconds: Int? = nil) async {
        _ = try? await setSettings(lock: on.map { NSNumber(value: $0) }, lockAfter: seconds.map { NSNumber(value: $0) })
    }

    static var available: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// foleviShell.lockSet: turning it on or off asks first.
    func setSettings(lock newLock: Any?, lockAfter newAfter: Any?) async throws -> [String: Any] {
        if let n = newAfter as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() {
            guard n.doubleValue.isFinite, n.intValue >= 0, n.intValue <= 86_400 else { throw BridgeError(code: "invalid_argument", message: "lockAfter is a number of seconds.") }
            lockAfter = n.intValue
        }
        if let n = newLock as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID(), n.boolValue != lock {
            let on = n.boolValue
            guard await AppLock.confirm(reason: on ? "Lock Folevi Core with Touch ID" : "Stop locking Folevi Core", fresh: true) else { return settings() }
            lock = on
        }
        Paths.defaults.set(["lock": lock, "lockAfter": lockAfter], forKey: Self.key)
        return settings()
    }

    private var prompting = false

    /// Touch ID to take the cover down: one prompt at a time, however many windows are covered.
    func unlock() async {
        guard isCovered, !prompting else { return }
        prompting = true
        defer { prompting = false }
        if await AppLock.confirm(reason: "Unlock Folevi Core", fresh: true) { isCovered = false }
    }

    /// While covered, keys and menu shortcuts go nowhere; Return or Space asks to unlock.
    private var keyMonitor: Any?
    private func watchKeys() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            MainActor.assumeIsolated {
                guard MacAppLock.shared.isCovered else { return e }
                if e.keyCode == 36 || e.keyCode == 49 { Task { await MacAppLock.shared.unlock() } }
                return nil
            }
        }
    }

    func debugCover(_ on: Bool) { isCovered = on }
}

// MARK: Spotlight

/// Notes in Spotlight (Settings > General > "Show notes in Spotlight"): titles and a short text of notes that
/// aren't encrypted, by place, so a sign-out takes that place's out. Opening a result opens the note in Core.
@MainActor
final class Spotlight {
    static let shared = Spotlight()

    private let index = CSSearchableIndex(name: "app.folevicore.notes")
    static let domainPrefix = "place:"

    struct Item {
        let id: String
        let title: String
        let text: String
        let edited: Date?
        /// What the page made it from: a note whose stamp changed is sent again.
        var stamp: String = ""
    }

    /// When what an entry holds changes, every place is indexed again from scratch.
    static let indexVersion = 2
    private static let versionKey = "spotlight.indexVersion"

    private func recordsKey(_ place: String) -> String { "spotlight.stamps.\(place)" }
    private func records(_ place: String) -> [String: String] { Paths.defaults.dictionary(forKey: recordsKey(place)) as? [String: String] ?? [:] }

    /// A new index version: everything comes out, and the pages hand every note over again.
    func checkVersion() {
        guard Paths.defaults.integer(forKey: Self.versionKey) != Self.indexVersion else { return }
        Task { try? await index.deleteAllSearchableItems() }
        for key in Paths.defaults.dictionaryRepresentation().keys where key.hasPrefix("spotlight.stamps.") { Paths.defaults.removeObject(forKey: key) }
        Paths.defaults.set(Self.indexVersion, forKey: Self.versionKey)
    }

    /// For the page (spotlightState): whether it's on, and the stamp of each note held for the place.
    func state(place: String) -> [String: Any] {
        checkVersion()
        guard enabled else { return ["enabled": false, "known": [String: String](), "place": place] }
        return ["enabled": true, "known": records(place), "place": place]
    }

    /// The notes leaving: those held that `keep` (every note of the place) doesn't name, and those in `remove`,
    /// unless they're going in now.
    nonisolated static func leaving(held: Set<String>, adding: Set<String>, keep: Set<String>?, remove: Set<String>) -> Set<String> {
        let unkept = keep.map { held.subtracting($0) } ?? []
        return unkept.union(remove).subtracting(adding)
    }

    /// These notes go in; with `keep`, the place's others come out; those in `remove` come out too.
    func update(_ items: [Item], place: String, keep: Set<String>?, remove: Set<String>) async {
        guard enabled else { return }
        await index(items, place: place)
        let gone = Self.leaving(held: Set(records(place).keys), adding: Set(items.map(\.id)), keep: keep, remove: remove)
        if !gone.isEmpty { await self.remove(Array(gone), place: place) }
        var held = records(place)
        for i in items { held[i.id] = i.stamp }
        for id in gone { held[id] = nil }
        Paths.defaults.set(held, forKey: recordsKey(place))
    }

    var enabled: Bool {
        get { Paths.defaults.object(forKey: "folevi.spotlight") as? Bool ?? true }
        set {
            Paths.defaults.set(newValue, forKey: "folevi.spotlight")
            if !newValue {
                Task { try? await index.deleteAllSearchableItems() }
                for key in Paths.defaults.dictionaryRepresentation().keys where key.hasPrefix("spotlight.stamps.") { Paths.defaults.removeObject(forKey: key) }
            }
        }
    }

    /// The notes of `place` as they are now (never encrypted ones: the caller leaves those out).
    func index(_ items: [Item], place: String) async {
        guard enabled, !items.isEmpty else { return }
        let entries = items.map { item -> CSSearchableItem in
            let a = CSSearchableItemAttributeSet(contentType: .text)
            a.title = item.title.isEmpty ? "Untitled" : item.title
            a.contentDescription = String(item.text.prefix(300))
            a.contentModificationDate = item.edited
            let entry = CSSearchableItem(uniqueIdentifier: "\(place)|\(item.id)", domainIdentifier: Self.domainPrefix + place, attributeSet: a)
            entry.expirationDate = .distantFuture
            return entry
        }
        try? await index.indexSearchableItems(entries)
    }

    /// Notes of `place` that went away (deleted, encrypted, moved out).
    func remove(_ ids: [String], place: String) async {
        try? await index.deleteSearchableItems(withIdentifiers: ids.map { "\(place)|\($0)" })
    }

    /// A place's notes leave Spotlight (signed out, the library forgotten).
    func forget(place: String) async {
        try? await index.deleteSearchableItems(withDomainIdentifiers: [Self.domainPrefix + place])
        Paths.defaults.removeObject(forKey: recordsKey(place))
    }

    /// The place and note of a Spotlight result's identifier.
    static func parse(_ identifier: String) -> (place: String, note: String)? {
        let parts = identifier.split(separator: "|", maxSplits: 1).map(String.init)
        guard parts.count == 2, !parts[1].isEmpty else { return nil }
        return (parts[0], parts[1])
    }
}
