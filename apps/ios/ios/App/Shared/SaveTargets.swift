// Where the share sheet, Quick Add, Siri and Shortcuts save to when this device holds several places
// (docs/MULTI_ACCOUNT_PLAN.md §6): the library on this device and each account, as the app last listed them,
// which one is open, and the one chosen last (preselected next time). The app writes it (ShellPlaces, on every
// change); the extensions only read it, and remember the last choice. Compiled into every target.
//
// Each account's REST token is also kept on its own (Keychain "rest-api.<user id>", next to the open place's
// "rest-api"), so something saved to an account that isn't open goes straight there. The library has no REST
// API: what's saved to it waits in the LocalActions or share queue, tagged with the place, and the library's
// page puts it in the next time the library is open. An account offline does the same with its own tag.
import Foundation

/// A place something can be saved to: "library" or "acct:<user id>".
struct SaveTarget: Codable, Equatable, Hashable, Identifiable {
    let id: String
    /// "Ana Lima", or "On this iPhone" for the library.
    let name: String
    /// The account's email, or where the library syncs.
    let detail: String

    var isLibrary: Bool { id == SaveTargets.library }
    var userId: String? { SaveTargets.userId(of: id) }
}

enum SaveTargets {
    static let library = "library"

    private enum Key {
        static let list = "saveTargets"
        static let current = "saveTargetCurrent"
        static let last = "saveTargetLast"
        static let accounts = "saveTargetAccounts"
        static let tokenIds = "saveTargetTokenIds"
    }

    private static let idPattern = #"^[A-Za-z0-9_-]{1,64}$"#

    static func userId(of place: String?) -> String? {
        guard let place, place.hasPrefix("acct:") else { return nil }
        let id = String(place.dropFirst(5))
        return id.range(of: idPattern, options: .regularExpression) != nil ? id : nil
    }

    static func valid(_ place: String?) -> Bool { place == library || userId(of: place) != nil }

    // MARK: The list (written by the app)

    static func load(defaults: UserDefaults = Folevi.defaults) -> [SaveTarget] {
        guard let data = defaults.data(forKey: Key.list), let list = try? JSONDecoder().decode([SaveTarget].self, from: data) else { return [] }
        return list.filter { valid($0.id) }
    }

    /// The place the app shows (nil: none yet, or an app that never wrote one).
    static func current(defaults: UserDefaults = Folevi.defaults) -> String? {
        defaults.string(forKey: Key.current).flatMap { valid($0) ? $0 : nil }
    }

    /// The app's places changed: the list, and which one is open.
    static func write(_ targets: [SaveTarget], current: String?, defaults: UserDefaults = Folevi.defaults) {
        defaults.set(try? JSONEncoder().encode(targets.filter { valid($0.id) }), forKey: Key.list)
        defaults.set(current.flatMap { valid($0) ? $0 : nil }, forKey: Key.current)
        // An account that went takes its own token and ids with it.
        let kept = Set(targets.compactMap(\.userId))
        for gone in accountIds(defaults: defaults).keys where !kept.contains(gone) { forget(userId: gone, defaults: defaults) }
    }

    /// Whether the pickers show: two places or more. With one (or none written) everything saves where it did before.
    static func several(defaults: UserDefaults = Folevi.defaults) -> Bool { load(defaults: defaults).count > 1 }

    static func target(_ id: String?, defaults: UserDefaults = Folevi.defaults) -> SaveTarget? {
        guard let id else { return nil }
        return load(defaults: defaults).first { $0.id == id }
    }

    // MARK: The last choice

    static func last(defaults: UserDefaults = Folevi.defaults) -> String? { defaults.string(forKey: Key.last) }

    static func remember(_ id: String, defaults: UserDefaults = Folevi.defaults) {
        guard valid(id) else { return }
        defaults.set(id, forKey: Key.last)
    }

    /// What a picker starts on: the place chosen last, else the open one, else the first.
    static func preferred(defaults: UserDefaults = Folevi.defaults) -> SaveTarget? {
        let list = load(defaults: defaults)
        for id in [last(defaults: defaults), current(defaults: defaults)] {
            if let found = list.first(where: { $0.id == id }) { return found }
        }
        return list.first
    }

    // MARK: Each account's own token

    static func credential(userId: String) -> DeviceCredential {
        DeviceCredential(service: "com.folevi.device-token", accessGroup: Folevi.keychainGroup, account: "rest-api.\(userId)")
    }

    /// Each account's REST account id (the one its token is for), by user id.
    static func accountIds(defaults: UserDefaults = Folevi.defaults) -> [String: String] {
        (defaults.dictionary(forKey: Key.accounts) as? [String: String]) ?? [:]
    }

    static func tokenIds(defaults: UserDefaults = Folevi.defaults) -> [String: String] {
        (defaults.dictionary(forKey: Key.tokenIds) as? [String: String]) ?? [:]
    }

    /// The app got a token for an account (the page handed it over while that account was open).
    static func keep(userId: String, accountId: String, tokenId: String, token: String, defaults: UserDefaults = Folevi.defaults) {
        guard userId.range(of: idPattern, options: .regularExpression) != nil, credential(userId: userId).store(token) else { return }
        var accounts = accountIds(defaults: defaults)
        accounts[userId] = accountId
        defaults.set(accounts, forKey: Key.accounts)
        var tokens = tokenIds(defaults: defaults)
        tokens[userId] = tokenId
        defaults.set(tokens, forKey: Key.tokenIds)
    }

    /// Signing out of an account: its token here goes.
    static func forget(userId: String, defaults: UserDefaults = Folevi.defaults) {
        credential(userId: userId).token = nil
        var accounts = accountIds(defaults: defaults)
        accounts[userId] = nil
        defaults.set(accounts, forKey: Key.accounts)
        var tokens = tokenIds(defaults: defaults)
        tokens[userId] = nil
        defaults.set(tokens, forKey: Key.tokenIds)
    }

    /// The open place's token becomes `userId`'s own when it has none yet (a token from before places), unless it
    /// already belongs to another account here.
    static func keepOpenToken(userId: String?, defaults: UserDefaults = Folevi.defaults) {
        guard let userId, credential(userId: userId).token == nil, let token = DeviceCredential.shared.token,
              let accountId = SharedAccount.accountId, let tokenId = SharedAccount.tokenId,
              !accountIds(defaults: defaults).values.contains(accountId) else { return }
        keep(userId: userId, accountId: accountId, tokenId: tokenId, token: token, defaults: defaults)
    }

    /// Another place opens: the open place's token (what the widgets and Spotlight use) becomes that account's
    /// own, or none for the library and an account that has none yet (its page asks for one as it opens).
    static func openedPlace(_ place: String?, defaults: UserDefaults = Folevi.defaults) {
        guard let userId = userId(of: place), let token = credential(userId: userId).token, let accountId = accountIds(defaults: defaults)[userId] else {
            if place != nil { SharedAccount.forget() }
            return
        }
        guard DeviceCredential.shared.store(token) else { return }
        SharedAccount.accountId = accountId
        SharedAccount.tokenId = tokenIds(defaults: defaults)[userId]
    }

    /// The REST API for an account place, with its own token; nil for the library, or before that account has
    /// been opened on this device (it has no token yet).
    static func api(for target: SaveTarget, session: URLSession = .shared) -> FoleviAPI? {
        guard let userId = target.userId, let base = SharedAccount.apiBase, let token = credential(userId: userId).token else { return nil }
        return FoleviAPI(base: base, token: token, session: session)
    }

    /// The REST account id a queued share for this place carries.
    static func accountId(for target: SaveTarget) -> String? {
        target.userId.flatMap { accountIds()[$0] }
    }

    /// Whether something tagged for `place` belongs to the page that's open now.
    static func isOpen(_ place: String?, defaults: UserDefaults = Folevi.defaults) -> Bool {
        guard let place else { return false }
        return place == current(defaults: defaults)
    }
}
