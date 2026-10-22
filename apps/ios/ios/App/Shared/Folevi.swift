// What the app and its extensions (the share extension, the widgets) share: the App Group (a container and
// settings both can read) and the Keychain group holding this device's token for the REST API. Compiled into
// every target.
//
// The app writes the API's address and the account here when the page hands over a token
// (FoleviNativePlugin), and removes everything on sign-out; the extensions only read it.
import Foundation

enum Folevi {
    /// The App Group shared by the app and its extensions.
    static let appGroup = "group.com.folevi"

    /// The Keychain access group (the team prefix and com.folevi.shared), from Info.plist's FoleviKeychainGroup
    /// so it matches the entitlement Xcode signed with. Nil only when Info.plist lacks it (it never should).
    static var keychainGroup: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "FoleviKeychainGroup") as? String
        return value?.isEmpty == false ? value : nil
    }

    #if os(macOS)
    /// The Mac app (apps/mac) has no extensions to share with: these are its build's own settings (Platform's,
    /// so Folevi Dev's never mix with Folevi's, nor a FOLEVI_USER_DATA run's with either).
    static var defaults: UserDefaults { Platform.defaults }
    #else
    /// Settings both the app and the extensions see.
    static let defaults: UserDefaults = UserDefaults(suiteName: appGroup) ?? .standard
    #endif

    /// The shared container (queued shares, the widgets' copy of tasks and notes). Falls back to the target's
    /// own Application Support when the App Group isn't there (a build without its entitlement).
    static var container: URL {
        #if os(macOS)
        // On the Mac every build answers for any App Group, entitlement or not: the build's own folder instead.
        let own = Platform.supportFolder.appendingPathComponent("Shared", isDirectory: true)
        try? FileManager.default.createDirectory(at: own, withIntermediateDirectories: true)
        return own
        #else
        if let shared = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) { return shared }
        let own = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: own, withIntermediateDirectories: true)
        return own
        #endif
    }

    /// The app's bundle id; extensions are com.folevi.ios.<name>.
    static let appBundleId = "com.folevi.ios"
    static var isApp: Bool { Bundle.main.bundleIdentifier == appBundleId }
}

/// Who is signed in, as native code knows it: the account the token belongs to, where the API is, and this
/// device's install id. The token itself is in the Keychain (DeviceCredential).
enum SharedAccount {
    private enum Key {
        static let apiBase = "apiBase"
        static let accountId = "accountId"
        static let tokenId = "tokenId"
        static let deviceId = "deviceId"
    }

    /// https://app.folevi.com/api/v1 (or the dev server's), written by the app on each launch.
    static var apiBase: URL? {
        get { Folevi.defaults.string(forKey: Key.apiBase).flatMap(URL.init(string:)) }
        set { Folevi.defaults.set(newValue?.absoluteString, forKey: Key.apiBase) }
    }

    static var accountId: String? {
        get { Folevi.defaults.string(forKey: Key.accountId) }
        set { Folevi.defaults.set(newValue, forKey: Key.accountId) }
    }

    static var tokenId: String? {
        get { Folevi.defaults.string(forKey: Key.tokenId) }
        set { Folevi.defaults.set(newValue, forKey: Key.tokenId) }
    }

    /// This install's id (a UUID made the first time it's asked for): the server keeps one token per device.
    static var deviceId: String {
        if let id = Folevi.defaults.string(forKey: Key.deviceId) { return id }
        let id = UUID().uuidString
        Folevi.defaults.set(id, forKey: Key.deviceId)
        return id
    }

    /// The REST API with this device's token, or nil when signed out (or the app hasn't been opened yet). Nil in
    /// local mode too, even with an account's token still kept: nothing there reaches Folevi (LocalExtras.swift).
    static func api(session: URLSession = .shared) -> FoleviAPI? {
        guard !LocalMode.on, let base = apiBase, let token = DeviceCredential.shared.token else { return nil }
        return FoleviAPI(base: base, token: token, session: session)
    }

    static var signedIn: Bool { apiBase != nil && DeviceCredential.shared.token != nil }

    /// Signing out: the token and who it was for. (The app also clears the widgets' copy and Spotlight.)
    static func forget() {
        DeviceCredential.shared.token = nil
        accountId = nil
        tokenId = nil
    }
}
