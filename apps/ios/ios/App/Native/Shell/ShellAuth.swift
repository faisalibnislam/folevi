// Signed-in mode for the built-in interface (docs/LOCAL_MODE_PLAN.md §1 and §4.3, WP4): `foleviShell.auth` on
// iPhone and iPad, the iOS twin of the Mac's apps/desktop/src/authBridge.ts.
//
// The page lives on capacitor://localhost, where the website's cookie session can't work. So the app signs in
// the way native apps do (Authorization Code with PKCE, convex/lib/nativeAuth.ts, client "folevi-shell"):
//   1. signIn() opens the website's /connect page in iOS's sign-in sheet (ASWebAuthenticationSession); the
//      person signs in there as on the website (password, two-step, Google, Apple, passkeys) and presses Continue;
//   2. the sheet ends on folevi://auth/callback?code=…&state=… (only the state this app made is accepted);
//   3. the app trades the code and its PKCE verifier for a session of its own at /api/auth/native/token and
//      keeps that bearer token in the Keychain. It never reaches the page.
// Afterwards the page's Better Auth client sends every request through fetch() here: only the website's
// /api/auth/*, with `Authorization: Bearer`, no cookies, `Origin` set to the website, a rotated
// `set-auth-token` kept, and the token scrubbed from anything handed back. convexToken() gets the page its
// short-lived Convex JWT.
import AuthenticationServices
import CryptoKit
import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

final class ShellAuth: NSObject {
    static let shared = ShellAuth()
    static let clientId = "folevi-shell"
    static let redirectURI = "folevi://auth/callback"
    private static let keychainService = "com.folevi.shell-auth"
    private static let keychainAccount = "session"
    private static let pageHeaders: Set<String> = ["accept", "accept-language", "content-type", "cache-control", "pragma"]
    private static let hiddenHeaders: Set<String> = ["set-cookie", "set-cookie2", "set-auth-token"]
    private static let tokenPattern = #"^[A-Za-z0-9._~+/=-]{16,1024}$"#

    /// The website (sign-in, /api/auth): the build's NEXT_PUBLIC_APP_URL as shell/build.json records it.
    var service = URL(string: "https://app.folevi.com")!

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.timeoutIntervalForRequest = 30
        return URLSession(configuration: c, delegate: NoRedirects(), delegateQueue: nil)
    }()

    private var sheet: SignInSheet?

    /// Several places (ShellPlaces): each account's session is its own Keychain item, `session.<user id>`; nil is the
    /// single session older builds kept (`session`).
    private static func account(_ userId: String?) -> String { userId.map { "\(keychainAccount).\($0)" } ?? keychainAccount }

    func token(for userId: String?) -> String? { Keychain.getString(Self.keychainService, Self.account(userId)) }

    func setToken(_ value: String?, for userId: String?) {
        if let value { Keychain.setString(Self.keychainService, Self.account(userId), value) } else { Keychain.delete(Self.keychainService, Self.account(userId)) }
    }

    /// The open place's session: the page's (the app has one web view, bound to the open place).
    var token: String? {
        get { token(for: ShellPlaces.currentUserId) }
        set { setToken(newValue, for: ShellPlaces.currentUserId) }
    }

    var signedIn: Bool { token != nil }

    /// Who a session belongs to (Better Auth's get-session with that bearer), or nil.
    func userOf(_ bearer: String) async -> (userId: String, name: String, email: String, avatarUrl: String?)? {
        guard let url = URL(string: "/api/auth/get-session", relativeTo: service)?.absoluteURL,
              let (res, data, _) = try? await send(url, method: "GET", bearer: bearer, keepRotated: false), res.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let user = json["user"] as? [String: Any],
              let id = user["id"] as? String, id.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil else { return nil }
        let image = (user["image"] as? String).flatMap { $0.hasPrefix("https://") ? $0 : nil }
        return (id, (user["name"] as? String) ?? "", (user["email"] as? String) ?? "", image)
    }

    /// The single session an older build kept, moved to its account's own item: that account, or nil.
    func adoptLegacy() async -> (userId: String, name: String, email: String, avatarUrl: String?)? {
        guard let legacy = token(for: nil), let user = await userOf(legacy) else { return nil }
        if token(for: user.userId) == nil { setToken(legacy, for: user.userId) }
        setToken(nil, for: nil)
        return user
    }

    /// Signs in to one more account: who it is, or nil. The same person again replaces only their own session.
    @MainActor
    func signInAccount(window: PlatformWindow?) async -> (userId: String, name: String, email: String, avatarUrl: String?)? {
        guard let access = await obtain(window: window) else { return nil }
        guard let user = await userOf(access) else {
            await endSession(access)
            return nil
        }
        let previous = token(for: user.userId)
        setToken(access, for: user.userId)
        if let previous, previous != access { await endSession(previous) }
        return user
    }

    /// Another account's Convex token (moving notes between two accounts).
    func convexToken(for userId: String) async throws -> String? {
        guard let bearer = token(for: userId), let url = URL(string: "/api/auth/convex/token", relativeTo: service)?.absoluteURL else { return nil }
        let (res, data, _) = try await send(url, method: "GET", bearer: bearer, slot: .some(userId))
        guard (200..<300).contains(res.statusCode) else { return nil }
        let jwt = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["token"] as? String
        return (jwt?.isEmpty ?? true) ? nil : jwt
    }

    /// Ends one account's session here and forgets its token.
    func signOut(userId: String) async {
        if let bearer = token(for: userId) { await endSession(bearer) }
        setToken(nil, for: userId)
    }

    private static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// RFC 7636: a 43-character verifier from 32 random bytes, and its S256 challenge.
    static func pkcePair() -> (verifier: String, challenge: String) {
        let verifier = b64url(LibraryCrypto.randomBytes(32))
        return (verifier, b64url(Data(SHA256.hash(data: Data(verifier.utf8)))))
    }

    /// The page's path as a URL on the website's /api/auth, or nil (no other host, no traversal, no encoded
    /// slashes or backslashes, no control characters).
    func authURL(_ path: String) -> URL? {
        guard path.count <= 4096, path.hasPrefix("/api/auth/"), path.range(of: #"[\u0000-\u001f\u007f\\]"#, options: .regularExpression) == nil,
              path.range(of: "%(2f|5c|00|2e)", options: [.regularExpression, .caseInsensitive]) == nil,
              let joined = URL(string: path, relativeTo: service)?.absoluteURL.standardized,
              var c = URLComponents(url: joined, resolvingAgainstBaseURL: false) else { return nil }
        c.fragment = nil
        guard let url = c.url?.standardized, url.scheme == service.scheme, url.host == service.host, url.port == service.port, url.path.hasPrefix("/api/auth/"), url.user == nil, url.password == nil else { return nil }
        return url
    }

    /// Removes every form of the session token from text bound for the page.
    static func scrub(_ text: String, _ tokens: [String?]) -> String {
        var forms = Set<String>()
        for t in tokens.compactMap({ $0 }) {
            for f in [t, t.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? t, String(t.split(separator: ".").first ?? "")] where f.count >= 16 { forms.insert(f) }
        }
        var out = text
        for f in forms.sorted(by: { $0.count > $1.count }) { out = out.replacingOccurrences(of: f, with: "") }
        return out
    }

    /// `slot`: whose item a rotated token goes back to (nil: the open place's; `.some(id)`: that account's).
    private func send(_ url: URL, method: String, headers: [String: String] = [:], body: String? = nil, bearer: String?, keepRotated: Bool = true, slot: String?? = nil) async throws -> (HTTPURLResponse, Data, String?) {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue(origin, forHTTPHeaderField: "Origin")
        if let bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = Data(body.utf8) }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        // A refreshed session comes back as a new token (Better Auth's bearer plugin): keep it.
        let rotated = http.value(forHTTPHeaderField: "set-auth-token")
        if keepRotated, let bearer, let rotated, rotated != bearer, rotated.range(of: Self.tokenPattern, options: .regularExpression) != nil {
            if let slot { setToken(rotated, for: slot) } else { token = rotated }
        }
        return (http, data, rotated)
    }

    private var origin: String {
        var o = "\(service.scheme ?? "https")://\(service.host ?? "")"
        if let p = service.port { o += ":\(p)" }
        return o
    }

    private func endSession(_ bearer: String) async {
        guard let url = URL(string: "/api/auth/sign-out", relativeTo: service) else { return }
        // Offline: the session expires on its own, and Settings > Devices can end it from anywhere.
        _ = try? await send(url.absoluteURL, method: "POST", headers: ["content-type": "application/json"], body: "{}", bearer: bearer)
    }

    @MainActor
    func signIn(window: PlatformWindow?) async -> Bool {
        guard let access = await obtain(window: window) else { return false }
        let previous = token
        token = access
        // Signing in again (another account, or after a stale session) ends the session this device held before.
        if let previous, previous != access { await endSession(previous) }
        return true
    }

    /// The sign-in sheet, ending with a new session's token (or nil).
    @MainActor
    private func obtain(window: PlatformWindow?) async -> String? {
        sheet?.session.cancel()
        let pkce = Self.pkcePair()
        let state = Self.b64url(LibraryCrypto.randomBytes(24))
        var c = URLComponents(url: service.appendingPathComponent("connect"), resolvingAgainstBaseURL: false)!
        c.queryItems = [
            .init(name: "client_id", value: Self.clientId), .init(name: "redirect_uri", value: Self.redirectURI),
            .init(name: "code_challenge", value: pkce.challenge), .init(name: "code_challenge_method", value: "S256"), .init(name: "state", value: state),
        ]
        guard let connect = c.url else { return nil }
        let callback: URL? = await withCheckedContinuation { cont in
            let session = ASWebAuthenticationSession(url: connect, callbackURLScheme: "folevi") { url, _ in cont.resume(returning: url) }
            // Safari's own sign-in to Folevi (and Google's) carries over, so there's often nothing to type.
            session.prefersEphemeralWebBrowserSession = false
            let s = SignInSheet(session: session, window: window)
            session.presentationContextProvider = s
            sheet = s
            if !session.start() { cont.resume(returning: nil) }
        }
        sheet = nil
        guard let callback, callback.host == "auth", callback.path == "/callback",
              let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
              items.first(where: { $0.name == "state" })?.value == state,
              items.first(where: { $0.name == "error" }) == nil,
              let code = items.first(where: { $0.name == "code" })?.value, code.count <= 128 else { return nil }
        let body: [String: Any] = ["grant_type": "authorization_code", "code": code, "code_verifier": pkce.verifier, "client_id": Self.clientId, "redirect_uri": Self.redirectURI, "device_name": String(Self.deviceName.prefix(60))]
        guard let data = try? JSONSerialization.data(withJSONObject: body), let url = URL(string: "/api/auth/native/token", relativeTo: service)?.absoluteURL,
              let (res, out, _) = try? await send(url, method: "POST", headers: ["content-type": "application/json"], body: String(data: data, encoding: .utf8), bearer: nil),
              res.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: out) as? [String: Any], let access = json["access_token"] as? String,
              access.range(of: Self.tokenPattern, options: .regularExpression) != nil else { return nil }
        return access
    }

    /// "Folevi app (Faisal's iPhone)" in Settings > Devices.
    static var deviceName: String { Platform.deviceName }

    func signOut() async {
        await MainActor.run { sheet?.session.cancel() }
        if let bearer = token { await endSession(bearer) }
        token = nil
    }

    /// The page's request (only /api/auth/*): { status, headers, body }.
    func fetch(path: String, method: String?, headers: [String: Any]?, body: String?) async throws -> [String: Any] {
        guard let url = authURL(path) else { throw LibraryError(.invalidArgument, "Folevi only sends the website's /api/auth requests from here.") }
        let m = (method ?? "GET").uppercased()
        guard m == "GET" || m == "POST" else { throw LibraryError(.invalidArgument, "Only GET and POST.") }
        if body != nil && (m == "GET" || body!.utf8.count > 1_000_000) { throw LibraryError(.invalidArgument, "Not a request Folevi sends.") }
        var clean: [String: String] = [:]
        for (k, v) in headers ?? [:] {
            let key = k.lowercased()
            if Self.pageHeaders.contains(key), let s = v as? String, s.count <= 1000, !s.contains("\r"), !s.contains("\n") { clean[key] = s }
        }
        // Sign in with Apple's own sheet (AppleSignIn.swift): the page signs in with the id token through here,
        // and the new session's token (the bearer plugin's set-auth-token) becomes this app's session.
        let social = m == "POST" && url.path == "/api/auth/sign-in/social"
        let bearer = social ? nil : token
        let (res, data, rotated) = try await send(url, method: m, headers: clean, body: body, bearer: bearer)
        if social, res.statusCode == 200, let rotated, rotated.range(of: Self.tokenPattern, options: .regularExpression) != nil {
            let previous = token
            token = rotated
            if let previous, previous != rotated { await endSession(previous) }
        }
        var out: [String: String] = [:]
        for (k, v) in res.allHeaderFields {
            guard let key = (k as? String)?.lowercased(), !Self.hiddenHeaders.contains(key) else { continue }
            out[key] = "\(v)"
        }
        let text = Self.scrub(String(data: data, encoding: .utf8) ?? "", [bearer, rotated, token])
        return ["status": res.statusCode, "headers": out, "body": text]
    }

    /// A short-lived Convex JWT, or nil when signed out (a 401 also forgets the session).
    func convexToken() async throws -> String? {
        guard let bearer = token, let url = URL(string: "/api/auth/convex/token", relativeTo: service)?.absoluteURL else { return nil }
        let (res, data, _) = try await send(url, method: "GET", bearer: bearer)
        if res.statusCode == 401 {
            token = nil
            return nil
        }
        if res.statusCode == 403 { return nil }
        guard (200..<300).contains(res.statusCode) else { throw URLError(.badServerResponse) }
        let jwt = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["token"] as? String
        return (jwt?.isEmpty ?? true) ? nil : jwt
    }
}

/// Answers are never followed somewhere else (a redirect comes back to the page as it is).
final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
