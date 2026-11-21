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

    func applicationWillFinishLaunching(_ notification: Notification) {
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

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
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
    static func confirm(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return true }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) == true
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
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { if MacAppLock.shared.lock { MacAppLock.shared.isCovered = true } }
        }
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
            guard await AppLock.confirm(reason: on ? "Lock Folevi Core with Touch ID" : "Stop locking Folevi Core") else { return settings() }
            lock = on
        }
        Paths.defaults.set(["lock": lock, "lockAfter": lockAfter], forKey: Self.key)
        return settings()
    }

    /// Touch ID to take the cover down.
    func unlock() async {
        guard isCovered else { return }
        if await AppLock.confirm(reason: "Unlock Folevi Core") { isCovered = false }
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
    }

    var enabled: Bool {
        get { Paths.defaults.object(forKey: "folevi.spotlight") as? Bool ?? true }
        set {
            Paths.defaults.set(newValue, forKey: "folevi.spotlight")
            if !newValue { Task { try? await index.deleteAllSearchableItems() } }
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

    /// A place's notes leave Spotlight (signed out, the library forgotten).
    func forget(place: String) async {
        try? await index.deleteSearchableItems(withDomainIdentifiers: [Self.domainPrefix + place])
    }

    /// The place and note of a Spotlight result's identifier.
    static func parse(_ identifier: String) -> (place: String, note: String)? {
        let parts = identifier.split(separator: "|", maxSplits: 1).map(String.init)
        guard parts.count == 2, !parts[1].isEmpty else { return nil }
        return (parts[0], parts[1])
    }
}
