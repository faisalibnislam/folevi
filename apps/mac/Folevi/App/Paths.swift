// The only place that knows which build this is and where it keeps things (docs/MAC_WEBKIT_PLAN.md §3.2). Every
// service gets its folder, Keychain names, settings and web storage from here, so a Debug build never touches the
// installed app's data, and a run with FOLEVI_USER_DATA (tests, scratch runs) touches nothing but that folder:
//
// | Build   | Bundle id          | Support folder                         | Keychain services   | URL scheme  |
// | Debug   | com.folevi.mac.dev | Application Support/Folevi Dev         | com.folevi.dev.*    | folevi-dev  |
// | Release | com.folevi.mac     | Application Support/Folevi (Electron's) | com.folevi.*        | folevi      |
//
// With FOLEVI_USER_DATA the support folder is that folder, and the Keychain names, settings and web storage get a
// suffix of their own taken from its path.
import CryptoKit
import Foundation
import WebKit

enum Paths {
    private static let env = ProcessInfo.processInfo.environment

    /// A Debug build (Xcode, scripts/build.mjs): never installed, never the owner's data.
    static var isDebug: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    /// FOLEVI_USER_DATA: a folder of the run's own (as in Electron, docs/DESKTOP.md).
    static let userDataOverride: URL? = {
        guard let raw = env["FOLEVI_USER_DATA"], !raw.isEmpty else { return nil }
        return URL(fileURLWithPath: (raw as NSString).expandingTildeInPath, isDirectory: true).standardizedFileURL
    }()

    /// Eight hex characters naming the FOLEVI_USER_DATA folder, or nil without one.
    static let runTag: String? = userDataOverride.map { url in
        SHA256.hash(data: Data(url.path.utf8)).prefix(4).map { String(format: "%02x", $0) }.joined()
    }

    /// Application Support/Folevi (release, Electron's userData), Application Support/Folevi Dev, or FOLEVI_USER_DATA.
    static let supportFolder: URL = {
        let dir = userDataOverride ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(isDebug ? "Folevi Dev" : "Folevi", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    /// Where a library "on this Mac" goes: ~/Documents as Electron (Documents/<device folder>); a Debug build or a
    /// test run keeps it in its own support folder instead.
    static var documentsFolder: URL {
        if isDebug || userDataOverride != nil { return supportFolder.appendingPathComponent("Documents", isDirectory: true) }
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// The Keychain service for a shared service name: "com.folevi.e2ee" stays as it is in a release build,
    /// becomes "com.folevi.dev.e2ee" in a Debug build, and "com.folevi.dev.<run>.e2ee" in a FOLEVI_USER_DATA run.
    static func keychainService(_ service: String) -> String {
        var prefix = isDebug ? "com.folevi.dev." : "com.folevi."
        if let runTag { prefix += "\(runTag)." }
        guard service.hasPrefix("com.folevi.") else { return prefix + service }
        return prefix + service.dropFirst("com.folevi.".count)
    }

    /// Settings: the app's own (per bundle id), or a run's own suite with FOLEVI_USER_DATA.
    static let defaults: UserDefaults = {
        guard let runTag, let suite = UserDefaults(suiteName: "\(Bundle.main.bundleIdentifier ?? "com.folevi.mac.dev").run-\(runTag)") else { return .standard }
        return suite
    }()

    /// The web views' storage (IndexedDB, localStorage): the default store of this bundle id (so the Debug and
    /// release builds never share), or a store of the run's own with FOLEVI_USER_DATA.
    @MainActor static let dataStore: WKWebsiteDataStore = {
        guard let userDataOverride else { return .default() }
        let digest = Array(SHA256.hash(data: Data(("folevi-webkit:" + userDataOverride.path).utf8)))
        var b = Array(digest.prefix(16))
        b[6] = (b[6] & 0x0F) | 0x50
        b[8] = (b[8] & 0x3F) | 0x80
        let id = UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
        return WKWebsiteDataStore(forIdentifier: id)
    }()

    /// folevi-dev:// for a Debug build, folevi:// for a release.
    static var urlScheme: String {
        (Bundle.main.object(forInfoDictionaryKey: "FoleviURLScheme") as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (isDebug ? "folevi-dev" : "folevi")
    }

    /// Folevi's version ("1.0.00", version.json at the repo root, scripts/version.mjs), the one every app shows.
    /// `build` (CFBundleVersion) is the hidden whole number Sparkle compares; it's never shown.
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0" }
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "" }

    /// The built-in interface (the shell export): FOLEVI_SHELL_DIR, else the app's Resources/web, else (Debug builds)
    /// the development copy in apps/mac/web.
    static var shellRoot: URL {
        if let raw = env["FOLEVI_SHELL_DIR"], !raw.isEmpty { return URL(fileURLWithPath: (raw as NSString).expandingTildeInPath, isDirectory: true).standardizedFileURL }
        if let res = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true), FileManager.default.fileExists(atPath: res.appendingPathComponent("index.html").path) { return res }
        if isDebug, let dev = Bundle.main.object(forInfoDictionaryKey: "FoleviDevShellDir") as? String, !dev.isEmpty {
            return URL(fileURLWithPath: dev, isDirectory: true).standardizedFileURL
        }
        return Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true) ?? URL(fileURLWithPath: "/nonexistent")
    }

    /// What the built-in interface was built for (shell/build.json: target, siteUrl, convexUrl, dbVersion...).
    static var shellBuild: [String: Any]? {
        guard let data = try? Data(contentsOf: shellRoot.appendingPathComponent("shell/build.json")) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// Folevi's website: sign-in, the page's /api/auth requests and links. FOLEVI_URL, else the site the built-in
    /// interface was built for (a development export names the dev site), else app.folevi.com.
    static var serviceURL: URL {
        if let raw = env["FOLEVI_URL"], let url = URL(string: raw), url.scheme == "http" || url.scheme == "https" { return url }
        if let raw = shellBuild?["siteUrl"] as? String, let url = URL(string: raw), url.scheme == "http" || url.scheme == "https" { return url }
        return URL(string: "https://app.folevi.com")!
    }

    /// More origins signed-in pages may connect to (FOLEVI_SHELL_CONNECT, e.g. a local Convex backend).
    static var extraConnect: [String] {
        (env["FOLEVI_SHELL_CONNECT"] ?? "").split(whereSeparator: { $0 == " " || $0 == "," || $0 == "\n" }).map(String.init)
            .filter { $0.range(of: #"^(https?|wss?)://[^\s;']+$"#, options: .regularExpression) != nil }
    }

    /// FOLEVI_OFFLINE=1: no network at all (every web view blocks http, https, ws and wss; URLSession refuses).
    static var offline: Bool { env["FOLEVI_OFFLINE"] == "1" }

    /// Running inside XCTest: no windows open.
    static var testing: Bool { env["XCTestConfigurationFilePath"] != nil || NSClassFromString("XCTestCase") != nil }

    /// Debug-only files (MacEval's requests and answers, the app's pid).
    static var debugFolder: URL {
        let dir = supportFolder.appendingPathComponent("Debug", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
