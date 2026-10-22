// Several places on iPhone and iPad (docs/MULTI_ACCOUNT_PLAN.md §2.2; the iOS twin of the Mac's
// apps/desktop/src/places.ts): the library on this device and any number of Folevi accounts, each with its own
// session (ShellAuth, Keychain account `session.<user id>`), encryption keys (E2eeKeys, `device.<user id>`) and
// data. This keeps the list in the app's Application Support (places.json): which place the app shows, the
// accounts (what each account's own page last said of itself, for the switcher), and Quick Add's last place.
// Nothing here is secret. The app has one web view: the open place is the page's place.
import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum ShellPlaces {
    static let library = "library"
    private static let idPattern = #"^[A-Za-z0-9_-]{1,64}$"#

    struct Workspace: Codable, Equatable {
        var id: String
        var name: String
        var logoUrl: String?
    }

    struct Account: Codable, Equatable {
        var userId: String
        var profileId: String?
        var name: String
        var email: String
        var avatarUrl: String?
        var workspaces: [Workspace]
        var unread: Int
        var reminders: Int
        var waiting: Int
        var id: String { "acct:\(userId)" }
    }

    struct State: Codable, Equatable {
        var v = 1
        var current: String?
        var library = false
        var accounts: [Account] = []
        var quickAdd: String?
        var lastAdded: String?
    }

    private static let lock = NSLock()
    private static var cached: State?

    private static var file: URL {
        Platform.supportFolder.appendingPathComponent("places.json")
    }

    static var exists: Bool { FileManager.default.fileExists(atPath: file.path) }

    static var state: State {
        lock.lock()
        defer { lock.unlock() }
        if let cached { return cached }
        let loaded = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(State.self, from: $0) } ?? State()
        cached = clean(loaded)
        return cached!
    }

    private static func clean(_ s: State) -> State {
        var out = s
        var seen = Set<String>()
        out.accounts = s.accounts.filter { $0.userId.range(of: idPattern, options: .regularExpression) != nil && seen.insert($0.userId).inserted }
        let valid = { (p: String?) -> Bool in guard let p else { return false }; return (p == library && out.library) || out.accounts.contains { $0.id == p } }
        if !valid(out.current) { out.current = nil }
        if !valid(out.quickAdd) { out.quickAdd = nil }
        if !valid(out.lastAdded) { out.lastAdded = nil }
        return out
    }

    private static func commit(_ next: State) {
        lock.lock()
        let before = cached?.current
        cached = clean(next)
        let value = cached!
        lock.unlock()
        mirror(value, before: before)
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(value) { try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
        // The mode older code reads (AppServices, the extensions' rules) follows the open place.
        ShellMode.current = modeOf(value.current, pending: pendingAccount)
        NotificationCenter.default.post(name: changed, object: nil)
    }

    static let changed = Notification.Name("folevi.places.changed")

    /// What the share sheet, Quick Add, Siri and Shortcuts offer (Shared/SaveTargets.swift), written with every
    /// change; another place opening also swaps the open place's REST token for that account's own.
    private static func mirror(_ s: State, before: String?) {
        let here = Platform.deviceLabel
        var targets: [SaveTarget] = []
        if s.library { targets.append(SaveTarget(id: library, name: "On this \(here)", detail: "Kept on this device only")) }
        for a in s.accounts { targets.append(SaveTarget(id: a.id, name: a.name.isEmpty ? a.email : a.name, detail: a.email)) }
        SaveTargets.write(targets, current: s.current)
        if let quickAdd = s.quickAdd, SaveTargets.last() == nil { SaveTargets.remember(quickAdd) }
        // The open place's token (one kept before places, the one account this device had) stays that account's
        // own when another place opens.
        SaveTargets.keepOpenToken(userId: userIdOf(before == s.current ? s.current : before))
        if before != s.current { SaveTargets.openedPlace(s.current) }
    }

    /// Account mode with no account yet (the sign-in screen). Kept for this run only.
    static var pendingAccount = false

    static func modeOf(_ place: String?, pending: Bool = pendingAccount) -> String {
        if place == library { return "local" }
        if userIdOf(place) != nil { return "account" }
        return pending ? "account" : "unset"
    }

    static func userIdOf(_ place: String?) -> String? {
        guard let place, place.hasPrefix("acct:") else { return nil }
        let id = String(place.dropFirst(5))
        return id.range(of: idPattern, options: .regularExpression) != nil ? id : nil
    }

    static func has(_ place: String?) -> Bool {
        guard let place else { return false }
        let s = state
        return (place == library && s.library) || s.accounts.contains { $0.id == place }
    }

    /// The place a call acts for when the host binds it (the Mac app's views are each bound to a place, and a
    /// place's background runner isn't the open one: docs/MAC_WEBKIT_PLAN.md §3). Set around a call by the Mac's
    /// router; iOS never sets it (its one web view is the open place's).
    @TaskLocal static var acting: String?

    /// The open place's user id (nil: the library, or no account yet); the acting place's when one is set.
    static var currentUserId: String? { userIdOf(acting ?? state.current) }

    static func setCurrent(_ place: String?, pending: Bool = false) {
        var s = state
        guard place == nil || has(place) else { return }
        s.current = place
        pendingAccount = place == nil && pending
        commit(s)
    }

    static func setLibrary(_ on: Bool) {
        var s = state
        s.library = on
        if !on {
            if s.current == library { s.current = nil }
            if s.quickAdd == library { s.quickAdd = nil }
        }
        commit(s)
    }

    @discardableResult
    static func addAccount(userId: String, name: String, email: String, avatarUrl: String?) -> Account? {
        guard userId.range(of: idPattern, options: .regularExpression) != nil else { return nil }
        var s = state
        if let i = s.accounts.firstIndex(where: { $0.userId == userId }) {
            s.accounts[i].name = name.isEmpty ? s.accounts[i].name : name
            s.accounts[i].email = email.isEmpty ? s.accounts[i].email : email
            if avatarUrl != nil { s.accounts[i].avatarUrl = avatarUrl }
        } else {
            s.accounts.append(Account(userId: userId, profileId: nil, name: String(name.prefix(120)), email: String(email.prefix(254)), avatarUrl: avatarUrl, workspaces: [], unread: 0, reminders: 0, waiting: 0))
        }
        s.lastAdded = "acct:\(userId)"
        commit(s)
        return state.accounts.first { $0.userId == userId }
    }

    /// What the open account's page says of itself.
    static func describe(_ place: String, _ d: [String: Any]) {
        var s = state
        guard let i = s.accounts.firstIndex(where: { $0.id == place }) else { return }
        var a = s.accounts[i]
        if let v = d["profileId"] as? String, v.range(of: idPattern, options: .regularExpression) != nil { a.profileId = v }
        if let v = d["name"] as? String, !v.isEmpty { a.name = String(v.prefix(120)) }
        if let v = d["email"] as? String, !v.isEmpty { a.email = String(v.prefix(254)) }
        if d.keys.contains("avatarUrl") { a.avatarUrl = (d["avatarUrl"] as? String).flatMap { $0.hasPrefix("https://") && $0.count <= 2000 ? $0 : nil } }
        if let ws = d["workspaces"] as? [[String: Any]] {
            a.workspaces = ws.prefix(50).compactMap { w in
                guard let id = w["id"] as? String, id.range(of: idPattern, options: .regularExpression) != nil, let name = w["name"] as? String else { return nil }
                return Workspace(id: id, name: String(name.prefix(120)), logoUrl: (w["logoUrl"] as? String).flatMap { $0.hasPrefix("https://") ? $0 : nil })
            }
        }
        for (key, path) in [("unread", \Account.unread), ("reminders", \Account.reminders), ("waiting", \Account.waiting)] as [(String, WritableKeyPath<Account, Int>)] {
            if let n = d[key] as? Int { a[keyPath: path] = max(0, min(n, 1_000_000)) }
        }
        guard a != s.accounts[i] else { return }
        s.accounts[i] = a
        commit(s)
    }

    /// Removes an account; returns the place the app opens next when it was the open one.
    static func removeAccount(_ place: String) -> String? {
        var s = state
        s.accounts.removeAll { $0.id == place }
        if s.quickAdd == place { s.quickAdd = nil }
        if s.lastAdded == place { s.lastAdded = nil }
        if s.current == place { s.current = s.accounts.first?.id ?? (s.library ? library : nil) }
        commit(s)
        return state.current
    }

    static func setQuickAdd(_ place: String) {
        guard has(place) else { return }
        SaveTargets.remember(place)
        var s = state
        s.quickAdd = place
        commit(s)
    }

    private static func orNull(_ v: Any?) -> Any { v ?? NSNull() }

    /// The places as the page lists them (apps/web/src/lib/shell/types.ts ShellPlace).
    static func list(libraryKind: String?, displayPath: String, configured: Bool) -> [[String: Any]] {
        let s = state
        var out: [[String: Any]] = []
        if s.library {
            out.append(["kind": "library", "id": library, "configured": configured, "syncs": orNull(libraryKind), "displayPath": displayPath, "unread": 0, "reminders": 0, "waiting": 0])
        }
        for a in s.accounts {
            out.append([
                "kind": "account", "id": a.id, "userId": a.userId, "profileId": orNull(a.profileId), "name": a.name, "email": a.email,
                "avatarUrl": orNull(a.avatarUrl), "workspaces": a.workspaces.map { ["id": $0.id, "name": $0.name, "logoUrl": orNull($0.logoUrl)] },
                "unread": a.unread, "reminders": a.reminders, "waiting": a.waiting,
            ])
        }
        return out
    }

    /// A first run of this version: where the app was (its mode) becomes the places.
    static func migrate(libraryConfigured: Bool) {
        guard !exists else { return }
        var s = State()
        let mode = ShellMode.current
        s.library = libraryConfigured || mode == "local"
        if mode == "local" { s.current = library }
        lock.lock()
        cached = clean(s)
        lock.unlock()
        pendingAccount = mode == "account"
        commit(s)
    }

    /// Tests only.
    static func resetForTests() {
        lock.lock()
        cached = nil
        lock.unlock()
        try? FileManager.default.removeItem(at: file)
        pendingAccount = false
    }
}
