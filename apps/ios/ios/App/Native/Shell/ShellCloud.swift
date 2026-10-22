// "Sync with Dropbox" and "Sync with Google Drive" on iPhone and iPad (docs/LOCAL_MODE_PLAN.md WP9b): the sign-in,
// the tokens and the library's copy on this device. The provider code itself (listing, downloads, uploads, the
// change feed, merging) is the shared packages/cloud-folders, the same DropboxFs and DriveFs the Mac and the
// Android app run, bundled into the bridge (folevi-cloud.js, scripts/bundle-cloud.mjs). Every request it makes
// comes through `request` here, which allows only the provider's own API hosts and adds the token, so the page
// never holds one. The same contract as the Android app's CloudAuth.kt and MirrorStore.kt.
//
// - Both providers: OAuth 2 authorization code with PKCE (S256, no client secret) in iOS's sign-in sheet
//   (ASWebAuthenticationSession), refresh tokens in the Keychain, refreshed a minute before they expire or after a
//   401. A refused refresh (access revoked) leaves the connection in "reconnect".
// - Dropbox: app-folder access, back on com.folevi.ios://oauth/dropbox on iOS and folevi://oauth/dropbox on the Mac
//   (Platform.dropboxRedirect, each registered in the Dropbox App Console).
// - Google Drive: the drive.file scope with an iOS OAuth client, back on its reversed client id
//   (com.googleusercontent.apps.<id>:/oauth2redirect).
// - Client ids come from the build (capacitor.config.ts plugins.FoleviShell, from FOLEVI_DROPBOX_APP_KEY and
//   FOLEVI_GOOGLE_IOS_CLIENT_ID); a provider without one isn't offered.
import AuthenticationServices
import CryptoKit
import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct CloudError: Error {
    /// "unavailable" | "one_connection" | "cancelled" | "reconnect" | "offline" | "invalid" | "protocol"
    let code: String
    let message: String
}

final class ShellCloud: NSObject {
    static let shared = ShellCloud()

    var dropboxAppKey = ""
    var googleClientId = ""
    /// Status changes for the page ("cloud-status").
    var onStatus: (([String: Any]) -> Void)?

    static let dropboxRedirect = Platform.dropboxRedirect
    private static let dropboxHosts: Set<String> = ["api.dropboxapi.com", "content.dropboxapi.com"]
    private static let googleHosts: Set<String> = ["www.googleapis.com"]
    private static let forbidden: Set<String> = ["authorization", "cookie", "host", "origin", "referer", "proxy-authorization"]
    private static let keychainService = "com.folevi.cloud-tokens"

    private let defaults = Platform.defaults
    private var connecting: String?
    private var sheet: SignInSheet?
    private let refreshLock = NSLock()
    private var refreshing: [String: Task<String, Error>] = [:]

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.timeoutIntervalForRequest = 150 // Dropbox's longpoll holds a request up to two minutes
        return URLSession(configuration: c, delegate: NoRedirects(), delegateQueue: nil)
    }()

    var googleRedirectScheme: String {
        let id = googleClientId.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
        return "com.googleusercontent.apps.\(id)"
    }

    var available: [String] {
        var out: [String] = []
        if dropboxAppKey.range(of: "^[a-z0-9]{8,32}$", options: .regularExpression) != nil { out.append("dropbox") }
        if googleClientId.hasSuffix(".apps.googleusercontent.com") { out.append("googleDrive") }
        return out
    }

    static func name(_ p: String) -> String { p == "dropbox" ? "Dropbox" : "Google Drive" }

    private func pref(_ k: String) -> String? { defaults.string(forKey: "folevi.cloud.\(k)") }
    private func setPref(_ k: String, _ v: String?) { defaults.set(v, forKey: "folevi.cloud.\(k)") }

    var provider: String? { pref("provider").flatMap { available.contains($0) ? $0 : nil } }

    func status() -> [String: Any] {
        let p = provider
        let state: String
        if connecting != nil { state = "connecting" } else if p == nil { state = "none" } else if pref("reconnect") == "1" { state = "reconnect" } else if pref("offline") == "1" { state = "offline" } else { state = "connected" }
        return ["available": available, "provider": p ?? NSNull(), "state": state, "account": (p != nil ? pref("account") : nil) ?? NSNull()]
    }

    private func changed() { onStatus?(status()) }

    // MARK: tokens

    private struct Tokens: Codable {
        var accessToken: String
        var refreshToken: String?
        var expiresAt: Double
    }

    private func tokens(_ p: String) -> Tokens? {
        Keychain.get(Self.keychainService, p).flatMap { try? JSONDecoder().decode(Tokens.self, from: $0) }
    }

    private func save(_ p: String, _ t: Tokens) {
        if let d = try? JSONEncoder().encode(t) { Keychain.set(Self.keychainService, p, d) }
    }

    private static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    // MARK: connecting

    func cancel() {
        Task { @MainActor in self.sheet?.session.cancel() }
    }

    /// Signs in to the provider (also to reconnect). Throws when cancelled, refused or another provider holds it.
    @MainActor
    func connect(_ p: String, window: PlatformWindow?) async throws -> [String: Any] {
        guard available.contains(p) else { throw CloudError(code: "unavailable", message: "\(Self.name(p)) isn't in this build of Folevi.") }
        if let current = provider, current != p { throw CloudError(code: "one_connection", message: "This library syncs with \(Self.name(current)). Sign out of \(Self.name(current)) first.") }
        connecting = p
        changed()
        defer {
            connecting = nil
            changed()
        }
        let verifier = Self.b64url(LibraryCrypto.randomBytes(32))
        let challenge = Self.b64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.b64url(LibraryCrypto.randomBytes(16))
        let redirect = p == "dropbox" ? Self.dropboxRedirect : "\(googleRedirectScheme):/oauth2redirect"
        var c: URLComponents
        if p == "dropbox" {
            c = URLComponents(string: "https://www.dropbox.com/oauth2/authorize")!
            c.queryItems = [.init(name: "client_id", value: dropboxAppKey), .init(name: "token_access_type", value: "offline")]
        } else {
            c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
            c.queryItems = [.init(name: "client_id", value: googleClientId), .init(name: "scope", value: "https://www.googleapis.com/auth/drive.file email"), .init(name: "access_type", value: "offline"), .init(name: "prompt", value: "consent")]
        }
        c.queryItems! += [.init(name: "response_type", value: "code"), .init(name: "redirect_uri", value: redirect), .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"), .init(name: "state", value: state)]
        let scheme = p == "dropbox" ? Platform.dropboxScheme : googleRedirectScheme
        let back: URL? = await withCheckedContinuation { cont in
            let s = ASWebAuthenticationSession(url: c.url!, callbackURLScheme: scheme) { url, _ in cont.resume(returning: url) }
            s.prefersEphemeralWebBrowserSession = false
            let holder = SignInSheet(session: s, window: window)
            s.presentationContextProvider = holder
            sheet = holder
            if !s.start() { cont.resume(returning: nil) }
        }
        sheet = nil
        guard let back, let items = URLComponents(url: back, resolvingAgainstBaseURL: false)?.queryItems, items.first(where: { $0.name == "state" })?.value == state else {
            throw CloudError(code: "cancelled", message: "The \(Self.name(p)) sign-in was closed.")
        }
        guard let code = items.first(where: { $0.name == "code" })?.value else {
            throw CloudError(code: "cancelled", message: "\(Self.name(p)) didn't sign Folevi in (\(items.first { $0.name == "error" }?.value ?? "no code")).")
        }
        let t = try await tokenRequest(p, form: ["grant_type": "authorization_code", "code": code, "code_verifier": verifier, "client_id": p == "dropbox" ? dropboxAppKey : googleClientId, "redirect_uri": redirect], previousRefresh: nil)
        save(p, t)
        setPref("provider", p)
        setPref("account", await account(p, t.accessToken))
        setPref("reconnect", nil)
        setPref("offline", nil)
        connecting = nil
        return status()
    }

    private func tokenRequest(_ p: String, form: [String: String], previousRefresh: String?) async throws -> Tokens {
        var req = URLRequest(url: URL(string: p == "dropbox" ? "https://api.dropboxapi.com/oauth2/token" : "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
        req.setValue("application/json", forHTTPHeaderField: "accept")
        var body = URLComponents()
        body.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
        req.httpBody = Data((body.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
        let data: Data
        let response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw CloudError(code: "offline", message: "Can't reach \(Self.name(p)).") }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (200..<300).contains(status), let access = json["access_token"] as? String, !access.isEmpty else {
            if status == 400 || status == 401 { throw CloudError(code: "reconnect", message: "\(Self.name(p)) refused the sign-in (\(json["error"] as? String ?? String(status))).") }
            throw CloudError(code: "protocol", message: "Unexpected answer from \(Self.name(p)) (\(status)).")
        }
        let expires = (json["expires_in"] as? NSNumber)?.doubleValue ?? 3600
        return Tokens(accessToken: access, refreshToken: (json["refresh_token"] as? String) ?? previousRefresh, expiresAt: Date().timeIntervalSince1970 * 1000 + max(60, expires) * 1000)
    }

    private func account(_ p: String, _ token: String) async -> String? {
        var req: URLRequest
        if p == "dropbox" {
            req = URLRequest(url: URL(string: "https://api.dropboxapi.com/2/users/get_current_account")!)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = Data("null".utf8)
        } else {
            req = URLRequest(url: URL(string: "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress%2CdisplayName)")!)
        }
        req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        guard let (data, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if p == "dropbox" { return (json["email"] as? String) ?? ((json["name"] as? [String: Any])?["display_name"] as? String) }
        let user = json["user"] as? [String: Any]
        return (user?["emailAddress"] as? String) ?? (user?["displayName"] as? String)
    }

    // MARK: tokens in use

    private func markReconnect() {
        setPref("reconnect", "1")
        changed()
    }

    /// A fresh access token (refreshed a minute before it expires, or after a 401), one refresh at a time.
    private func accessToken(_ p: String, force: Bool) async throws -> String {
        guard let t = tokens(p) else {
            markReconnect()
            throw CloudError(code: "reconnect", message: "\(Self.name(p)) needs to be connected again.")
        }
        if !force && t.expiresAt - Date().timeIntervalSince1970 * 1000 > 60_000 { return t.accessToken }
        let task: Task<String, Error> = refreshLock.withLock {
            if let r = refreshing[p] { return r }
            let r = Task<String, Error> {
                defer { self.refreshLock.withLock { self.refreshing[p] = nil } }
                guard let refresh = t.refreshToken else { throw CloudError(code: "reconnect", message: "\(Self.name(p)) needs to be connected again.") }
                do {
                    let next = try await self.tokenRequest(p, form: ["grant_type": "refresh_token", "refresh_token": refresh, "client_id": p == "dropbox" ? self.dropboxAppKey : self.googleClientId], previousRefresh: refresh)
                    self.save(p, next)
                    return next.accessToken
                } catch let e as CloudError where e.code == "reconnect" {
                    Keychain.delete(Self.keychainService, p)
                    self.markReconnect()
                    throw e
                }
            }
            refreshing[p] = r
            return r
        }
        return try await task.value
    }

    /// One request from the bridge's provider code: only the connected provider's API hosts (or Dropbox's
    /// longpoll host without a token), https only, no redirects. A 401 refreshes once and tries again.
    func request(_ p: String, url raw: String, method: String, headers: [String: String], body: Data?, authorized: Bool) async throws -> (status: Int, headers: [String: String], body: Data) {
        guard let url = URL(string: raw), url.scheme == "https", url.user == nil, url.port == nil || url.port == 443 else { throw CloudError(code: "invalid", message: "Not an address.") }
        let hosts: Set<String> = p == "dropbox" ? (authorized ? Self.dropboxHosts : ["notify.dropboxapi.com"]) : Self.googleHosts
        guard let host = url.host, hosts.contains(host) else { throw CloudError(code: "invalid", message: "Folevi only talks to \(Self.name(p)) from here.") }
        if authorized && p != provider { throw CloudError(code: "reconnect", message: "\(Self.name(p)) isn't connected.") }
        let m = method.uppercased()
        guard ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(m) else { throw CloudError(code: "invalid", message: "Not a method Folevi sends.") }
        for attempt in 1...2 {
            var req = URLRequest(url: url)
            req.httpMethod = m
            for (k, v) in headers where !Self.forbidden.contains(k.lowercased()) { req.setValue(v, forHTTPHeaderField: k) }
            if authorized { req.setValue("Bearer \(try await accessToken(p, force: attempt > 1))", forHTTPHeaderField: "authorization") }
            if m != "GET" { req.httpBody = body ?? Data() }
            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await session.data(for: req)
            } catch {
                if pref("offline") != "1" {
                    setPref("offline", "1")
                    changed()
                }
                throw CloudError(code: "offline", message: "Can't reach \(Self.name(p)).")
            }
            if pref("offline") == "1" {
                setPref("offline", nil)
                changed()
            }
            let http = response as! HTTPURLResponse
            var out: [String: String] = [:]
            for (k, v) in http.allHeaderFields { if let key = k as? String { out[key.lowercased()] = "\(v)" } }
            if http.statusCode != 401 || !authorized { return (http.statusCode, out, data) }
            if attempt == 2 {
                Keychain.delete(Self.keychainService, p)
                markReconnect()
                return (http.statusCode, out, data)
            }
        }
        throw CloudError(code: "protocol", message: "Unreachable.")
    }

    /// Signs out: the grant is revoked (best effort), the tokens deleted; the library's copy here stays.
    func signOut() async -> [String: Any] {
        cancel()
        if let p = pref("provider") {
            if let t = tokens(p) {
                var req: URLRequest
                if p == "dropbox" {
                    req = URLRequest(url: URL(string: "https://api.dropboxapi.com/2/auth/token/revoke")!)
                    req.httpMethod = "POST"
                    req.setValue("Bearer \(t.accessToken)", forHTTPHeaderField: "authorization")
                } else {
                    var c = URLComponents(string: "https://oauth2.googleapis.com/revoke")!
                    c.queryItems = [.init(name: "token", value: t.refreshToken ?? t.accessToken)]
                    req = URLRequest(url: c.url!)
                    req.httpMethod = "POST"
                }
                _ = try? await URLSession.shared.data(for: req)
            }
            Keychain.delete(Self.keychainService, p)
        }
        for k in ["provider", "account", "reconnect", "offline"] { setPref(k, nil) }
        changed()
        return status()
    }

    // MARK: the library's copy on this device

    /// Application Support/Folevi/Cloud libraries/<provider>: the same layout as the cloud folder, with each
    /// file's provider etag beside it and the provider's state (cursor, index) in .state.json.
    static func mirrorRoot(_ p: String) throws -> URL {
        guard p == "dropbox" || p == "googleDrive" else { throw CloudError(code: "invalid", message: "Not a provider.") }
        let dir = Platform.supportFolder.appendingPathComponent("Cloud libraries/\(p)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func mirrorURL(_ p: String, _ path: String) throws -> URL {
        guard LibraryPaths.isValid(path), !path.hasPrefix(".") else { throw LibraryError(.invalidPath, "Invalid library path.", path: path) }
        return try mirrorRoot(p).appendingPathComponent(path)
    }

    private static func etagURL(_ file: URL) -> URL { file.deletingLastPathComponent().appendingPathComponent(".\(file.lastPathComponent).etag") }

    static func mirrorRead(_ p: String, _ path: String) throws -> (data: Data, etag: String)? {
        let f = try mirrorURL(p, path)
        guard let data = try? Data(contentsOf: f) else { return nil }
        return (data, (try? String(contentsOf: etagURL(f), encoding: .utf8)) ?? "")
    }

    static func mirrorWrite(_ p: String, _ path: String, _ data: Data, etag: String) throws {
        let f = try mirrorURL(p, path)
        try FileManager.default.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: f, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try Data(etag.utf8).write(to: etagURL(f), options: .atomic)
    }

    static func mirrorDelete(_ p: String, _ path: String) throws {
        let f = try mirrorURL(p, path)
        try? FileManager.default.removeItem(at: f)
        try? FileManager.default.removeItem(at: etagURL(f))
    }

    static func mirrorPaths(_ p: String) throws -> [String] {
        let root = try mirrorRoot(p)
        let base = root.standardizedFileURL.path
        var out: [String] = []
        if let e = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) {
            for case let u as URL in e where (try? u.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
                let path = String(u.standardizedFileURL.path.dropFirst(base.count + 1))
                if LibraryPaths.isValid(path) { out.append(path) }
            }
        }
        return out.sorted()
    }

    static func mirrorLoadState(_ p: String) throws -> String? {
        try? String(contentsOf: try mirrorRoot(p).appendingPathComponent(".state.json"), encoding: .utf8)
    }

    static func mirrorSaveState(_ p: String, _ state: String) throws {
        try Data(state.utf8).write(to: try mirrorRoot(p).appendingPathComponent(".state.json"), options: .atomic)
    }
}
