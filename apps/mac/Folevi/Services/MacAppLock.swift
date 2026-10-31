// The Touch ID lock on the Mac (docs/MAC_WEBKIT_PLAN.md §4.2 and §5.1; Electron's lock.ts, whose rules this
// keeps): with it on, Folevi covers every window when it opens, when the Mac locks or sleeps, and when Folevi
// comes back to the front after being away longer than "Ask again" says, until Touch ID says it's the owner.
// The page reads and changes the settings through foleviShell.lock (ShellRouter's lockGet and lockSet);
// turning the lock on or off asks for Touch ID too, so someone at an unlocked Mac can't simply switch it off.
// The settings are lock.json in the support folder, as Electron kept them ({ lock, lockAfter }).
//
// The cover is an AppKit view over each main window's content, so the notes underneath aren't drawn (or
// reached by the keyboard) while it's up. `LockLogic` is the plain logic with its parts passed in (FoleviTests).
//
// `AppLock.confirm(reason:)` is what the shared E2eeKeys calls before encrypted notes open (the same meaning as on
// iOS: a yes within 30 seconds covers windows opening together).
import AppKit
import Foundation
import LocalAuthentication
import SwiftUI
import FoleviMac
import FoleviScreens

enum AppLock {
    private static var lastYes: Date?

    /// Asks for Touch ID (or the Mac's password); true when the person confirmed.
    @MainActor
    static func confirm(reason: String) async -> Bool {
        if let lastYes, Date().timeIntervalSince(lastYes) < 30 { return true }
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }
        let ok = (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
        if ok { lastYes = Date() }
        return ok
    }
}

/// A refusal the page reads as { code, message } (Electron's lockError).
struct LockError: Error {
    let code: String
    let message: String
}

/// Electron's AppLock, with its parts passed in.
@MainActor
final class LockLogic {
    /// The "Ask again" choices Settings offers; anything else is read as the nearest one below it.
    static let choices = [0, 60, 300, 900, 3600]

    struct Deps {
        /// lock.json.
        var file: URL
        /// Whether this Mac can ask for Touch ID.
        var canPrompt: () -> Bool
        /// Asks for Touch ID (with the Mac's password as the way out); true when it's the owner.
        var prompt: (_ reason: String) async -> Bool
        var show: () -> Void
        var hide: () -> Void
        var now: () -> Date = Date.init
    }

    private var deps: Deps
    private var lock = false
    private var lockAfter = 0
    private var awaySince: Date?
    private var asking: Task<Bool, Never>?
    /// True while the windows are covered.
    private(set) var locked = false

    init(_ deps: Deps) {
        self.deps = deps
        if let data = try? Data(contentsOf: deps.file), let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            lock = (raw["lock"] as? Bool) == true
            lockAfter = Self.validAfter(raw["lockAfter"]) ?? 0
        }
        // A lock this Mac can no longer honour (Touch ID removed) doesn't shut the person out.
        if lock && deps.canPrompt() { lockNow() }
    }

    static func validAfter(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, n !== kCFBooleanTrue, n !== kCFBooleanFalse, n.doubleValue.isFinite, n.doubleValue >= 0 else { return nil }
        return choices.last { Double($0) <= n.doubleValue } ?? 0
    }

    private var on: Bool { lock && deps.canPrompt() }

    /// { lock, lockAfter, method }: "touchID", or "none" on a Mac without it.
    var settings: [String: Any] {
        let method = deps.canPrompt() ? "touchID" : "none"
        return ["lock": lock && method != "none", "lockAfter": lockAfter, "method": method]
    }

    /// From the page. Turning the lock on or off asks for Touch ID first; a cancel leaves it as it was.
    func setSettings(lock newLock: Any?, lockAfter newAfter: Any?) async throws -> [String: Any] {
        var nextLock = lock
        var nextAfter = lockAfter
        if let newAfter, !(newAfter is NSNull) {
            guard let after = Self.validAfter(newAfter) else { throw LockError(code: "invalid_argument", message: "lockAfter is a number of seconds.") }
            nextAfter = after
        }
        if let newLock, !(newLock is NSNull) {
            guard let n = newLock as? NSNumber, n === kCFBooleanTrue || n === kCFBooleanFalse else { throw LockError(code: "invalid_argument", message: "lock is true or false.") }
            let wanted = n.boolValue
            if wanted != lock {
                guard deps.canPrompt() else { throw LockError(code: "unavailable", message: "This Mac has no Touch ID, or it isn't set up.") }
                guard await deps.prompt(wanted ? "turn on the Touch ID lock" : "turn off the Touch ID lock") else { throw LockError(code: "cancelled", message: "Touch ID didn't confirm it.") }
            }
            nextLock = wanted
        }
        lock = nextLock
        lockAfter = nextAfter
        save()
        return settings
    }

    private func save() {
        try? FileManager.default.createDirectory(at: deps.file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: ["lock": lock, "lockAfter": lockAfter], options: [.sortedKeys]) {
            try? data.write(to: deps.file, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: deps.file.path)
        }
    }

    /// Covers the windows now (the Mac locking or going to sleep, and at launch).
    func lockNow() {
        guard on else { return }
        locked = true
        awaySince = nil
        deps.show()
    }

    /// No Folevi window is in front any more.
    func away() {
        if awaySince == nil { awaySince = deps.now() }
    }

    /// A Folevi window came to the front: locks if it was away long enough, and asks for Touch ID if locked.
    func back() {
        let since = awaySince
        awaySince = nil
        if on && !locked, let since, deps.now().timeIntervalSince(since) >= Double(lockAfter) { lockNow() }
        if locked { _ = unlock() }
    }

    /// Asks for Touch ID (once at a time) and uncovers the windows if it's the owner.
    @discardableResult
    func unlock() -> Task<Bool, Never> {
        if !locked { return Task { true } }
        if !deps.canPrompt() {
            // Touch ID went away while locked: nothing could ever open it.
            locked = false
            deps.hide()
            return Task { true }
        }
        if let asking { return asking }
        let task = Task { @MainActor () -> Bool in
            let ok = await self.deps.prompt("unlock your notes")
            if ok {
                self.locked = false
                self.deps.hide()
            }
            self.asking = nil
            return ok
        }
        asking = task
        return task
    }
}

/// The Mac's half: the cover over every main window, and the moments that lock.
@MainActor
final class MacAppLock {
    static let shared = MacAppLock()

    private var logic: LockLogic?
    private var covers: [ObjectIdentifier: (window: NSWindow, view: LockCoverView)] = [:]
    private var up = false

    /// Electron's systemPreferences.canPromptTouchID.
    static func canPromptTouchID() -> Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    /// Electron's promptTouchID: Touch ID, with the Mac's password when it can't be used.
    static func promptTouchID(_ reason: String) async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "Use Password"
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }

    private var current: LockLogic {
        if let logic { return logic }
        let made = LockLogic(.init(file: Paths.supportFolder.appendingPathComponent("lock.json"), canPrompt: Self.canPromptTouchID, prompt: Self.promptTouchID,
                                   show: { [weak self] in self?.show() }, hide: { [weak self] in self?.hide() }))
        logic = made
        return made
    }

    func settings() -> [String: Any] { current.settings }

    func setSettings(lock: Any?, lockAfter: Any?) async throws -> [String: Any] {
        do {
            return try await current.setSettings(lock: lock, lockAfter: lockAfter)
        } catch let e as LockError {
            throw BridgeError(code: e.code, message: e.message)
        }
    }

    /// At launch: the windows open covered when the lock is on; the Mac locking or sleeping covers them; Folevi
    /// leaving the front starts the "away" clock, coming back checks it.
    func start() {
        _ = current
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { MacAppLock.shared.current.lockNow() } }
        ws.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { MacAppLock.shared.current.lockNow() } }
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { MacAppLock.shared.current.lockNow() }
        }
        let nc = NotificationCenter.default
        nc.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { MacAppLock.shared.current.away() } }
        nc.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { MacAppLock.shared.current.back() } }
        // Windows opened while it's up are covered too.
        nc.addObserver(forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { MacAppLock.shared.attachAll() } }
        nc.addObserver(forName: NSWindow.didUpdateNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { if MacAppLock.shared.up { MacAppLock.shared.attachAll() } } }
    }

    private func show() {
        up = true
        attachAll()
    }

    private func hide() {
        up = false
        for (_, c) in covers {
            c.view.removeFromSuperview()
            if let main = WindowManager.shared.mains.first(where: { $0.window === c.window }) { c.window.makeFirstResponder(main.view) }
        }
        covers.removeAll()
    }

    private func attachAll() {
        guard up else { return }
        for main in WindowManager.shared.mains {
            guard let window = main.window, let content = window.contentView else { continue }
            if let c = covers[ObjectIdentifier(window)], c.view.superview === content {
                // Kept on top of whatever the window put over its page since.
                if content.subviews.last !== c.view { content.addSubview(c.view, positioned: .above, relativeTo: nil) }
                continue
            }
            let view = LockCoverView(frame: content.bounds) { MacAppLock.shared.current.unlock() }
            view.autoresizingMask = [.width, .height]
            content.addSubview(view, positioned: .above, relativeTo: nil)
            window.makeFirstResponder(view)
            covers[ObjectIdentifier(window)] = (window, view)
        }
        covers = covers.filter { entry in WindowManager.shared.mains.contains { $0.window === entry.value.window } }
    }

    /// Debug and tests: whether the windows are covered.
    var isCovered: Bool { up }

    #if DEBUG
    /// Debug only (mac.mjs `cmd lock-cover`): the cover up or down without Touch ID, for screenshots.
    func debugCover(_ on: Bool) {
        if on { show() } else { hide() }
    }
    #endif
}

/// What shows instead of the notes while Folevi is locked: the lock, a line, and Unlock with Touch ID, drawn as the
/// web draws its locked library (FoleviMac's WebLockCover). The whole cover moves the window; it takes the keyboard
/// so nothing reaches the page.
final class LockCoverView: NSView {
    private let onUnlock: () -> Void

    init(frame: NSRect, onUnlock: @escaping () -> Void) {
        self.onUnlock = onUnlock
        super.init(frame: frame)
        let host = NSHostingView(rootView: WebLockCover(unlock: onUnlock))
        host.translatesAutoresizingMaskIntoConstraints = false
        addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: leadingAnchor),
            host.trailingAnchor.constraint(equalTo: trailingAnchor),
            host.topAnchor.constraint(equalTo: topAnchor),
            host.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Folevi is locked")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    // Nothing behind the cover gets the pointer or the keyboard.
    override func hitTest(_ point: NSPoint) -> NSView? { super.hitTest(point) ?? self }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36 || event.keyCode == 49 { onUnlock() }
    }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        // ⌘Q, ⌘W, ⌘M and ⌘H still work; nothing reaches the page.
        let keys: Set<String> = ["q", "w", "m", "h"]
        if event.modifierFlags.contains(.command), let c = event.charactersIgnoringModifiers?.lowercased(), keys.contains(c) { return false }
        return true
    }
}
