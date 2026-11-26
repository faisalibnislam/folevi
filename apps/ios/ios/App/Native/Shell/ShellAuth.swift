// Signed-in mode for the built-in interface (docs/LOCAL_MODE_PLAN.md §1 and §4.3, WP4): `foleviShell.auth` on
// iPhone and iPad, the iOS twin of the Electron Mac app's authBridge.ts.
//
// The page lives on capacitor://localhost, where the website's cookie session can't work. So the app signs in
// the way native apps do (Authorization Code with PKCE, convex/lib/nativeAuth.ts, client "folevi-shell"):
//   1. signIn() opens the website's /connect page in iOS's sign-in sheet (ASWebAuthenticationSession); the
//      person signs in there as on the website (password, two-step, Google, Apple, passkeys) and presses Continue.
//      With a provider (the app's own "Continue with Google" or "Continue with Apple") it opens /app-google
//      instead, which goes straight on to that provider's page and issues the code by itself afterwards;
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

    /// Folevi Cloud's website (sign-in, /api/auth): the build's NEXT_PUBLIC_APP_URL as shell/build.json records it.
    var cloudService = URL(string: "https://app.folevi.com")!

    /// The website of the place a call acts for: its Folevi Server's (ShellPlaces.actingServer, at the address in
    /// use now), else Folevi Cloud's. Setting it sets Folevi Cloud's.
    var service: URL {
        get { ShellPlaces.actingServer?.appURL ?? cloudService }
        set { cloudService = newValue }
    }

    /// The website an account's session belongs to (its server's, or Folevi Cloud's), whichever place is acting.
    func service(for userId: String?) -> URL {
        ShellPlaces.server(ofUser: userId)?.appURL ?? cloudService
    }

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
    /// With no account yet (a sign-in screen) it is the one session older builds kept, which was always Folevi
    /// Cloud's: on a server's sign-in screen there is none, and nothing is kept there, so Folevi Cloud's old
    /// session never goes to a server and a server's never takes its place.
    var token: String? {
        get {
            if let userId = ShellPlaces.currentUserId { return token(for: userId) }
            return ShellPlaces.actingServer == nil ? token(for: nil) : nil
        }
        set {
            if let userId = ShellPlaces.currentUserId { return setToken(newValue, for: userId) }
            if ShellPlaces.actingServer == nil { setToken(newValue, for: nil) }
        }
    }

    var signedIn: Bool { token != nil }

    /// Who a session belongs to (Better Auth's get-session with that bearer), or nil. `site`: the website asked
    /// (nil: the acting place's).
    func userOf(_ bearer: String, at site: URL? = nil) async -> (userId: String, name: String, email: String, avatarUrl: String?)? {
        guard let url = URL(string: "/api/auth/get-session", relativeTo: site ?? service)?.absoluteURL,
              let (res, data, _) = try? await send(url, method: "GET", bearer: bearer, keepRotated: false), res.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let user = json["user"] as? [String: Any],
              let id = user["id"] as? String, id.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil else { return nil }
        let image = (user["image"] as? String).flatMap { $0.hasPrefix("https://") ? $0 : nil }
        return (id, (user["name"] as? String) ?? "", (user["email"] as? String) ?? "", image)
    }

    /// The single session an older build kept, moved to its account's own item: that account, or nil. That session
    /// was Folevi Cloud's (builds before places had no servers), so Folevi Cloud is asked whose it is, whichever
    /// place is open. An id that is already an account on a server here is left alone.
    func adoptLegacy() async -> (userId: String, name: String, email: String, avatarUrl: String?)? {
        guard let legacy = token(for: nil), let user = await userOf(legacy, at: cloudService) else { return nil }
        guard ShellPlaces.server(ofUser: user.userId) == nil else { return nil }
        if token(for: user.userId) == nil { setToken(legacy, for: user.userId) }
        setToken(nil, for: nil)
        return user
    }

    /// Whether a sign-in that came back as `userId` must be refused: an account with that id is already on this
    /// device from another server than the one this sign-in went to (the acting place's; nil is Folevi Cloud).
    /// Sessions are kept by user id, and a server says what its user ids are: without this, a server answering
    /// with the id of an account from elsewhere would take that account's place here.
    static func belongsElsewhere(_ userId: String) -> Bool {
        guard let existing = ShellPlaces.state.accounts.first(where: { $0.userId == userId }) else { return false }
        return !ShellServer.same(existing.server, ShellPlaces.actingServer)
    }

    /// Signs in to one more account: who it is, or nil. The same person again replaces only their own session.
    /// `provider` ("google" or "apple"): the sheet opens straight on that provider's page.
    @MainActor
    func signInAccount(window: PlatformWindow?, provider: String? = nil) async -> (userId: String, name: String, email: String, avatarUrl: String?)? {
        guard let access = await obtain(window: window, provider: provider) else { return nil }
        guard let user = await userOf(access), !Self.belongsElsewhere(user.userId) else {
            await endSession(access)
            return nil
        }
        let previous = token(for: user.userId)
        let issuedAt = issuer(of: user.userId)
        setToken(access, for: user.userId)
        if let previous, previous != access, let issuedAt { await endSession(previous, at: issuedAt) }
        return user
    }

    /// The website that issued the session an id holds here: its account's own (its server's, or Folevi Cloud's).
    /// Nil when no account here has that id: a session nobody can place is dropped without being sent anywhere.
    /// The session a sign-in replaces is ended there, never at the website the new sign-in went to.
    func issuer(of userId: String) -> URL? {
        ShellPlaces.state.accounts.contains { $0.userId == userId } ? service(for: userId) : nil
    }

    /// Another account's Convex token (moving notes between two accounts).
    func convexToken(for userId: String) async throws -> String? {
        guard let bearer = token(for: userId), let url = URL(string: "/api/auth/convex/token", relativeTo: service(for: userId))?.absoluteURL else { return nil }
        let (res, data, _) = try await send(url, method: "GET", bearer: bearer, slot: .some(userId))
        guard (200..<300).contains(res.statusCode) else { return nil }
        let jwt = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["token"] as? String
        return (jwt?.isEmpty ?? true) ? nil : jwt
    }

    /// Ends one account's session here and forgets its token.
    func signOut(userId: String) async {
        if let bearer = token(for: userId) { await endSession(bearer, at: service(for: userId)) }
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
    func send(_ url: URL, method: String, headers: [String: String] = [:], body: String? = nil, bearer: String?, keepRotated: Bool = true, slot: String?? = nil) async throws -> (HTTPURLResponse, Data, String?) {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        // The website's own origin: the one the request goes to (every call here is on a place's website).
        req.setValue(Self.origin(of: url), forHTTPHeaderField: "Origin")
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

    static func origin(of url: URL) -> String {
        let host = url.host ?? ""
        var o = "\(url.scheme ?? "https")://\(host.contains(":") ? "[\(host)]" : host)"
        if let p = url.port { o += ":\(p)" }
        return o
    }

    private func endSession(_ bearer: String, at site: URL? = nil) async {
        guard let url = URL(string: "/api/auth/sign-out", relativeTo: site ?? service) else { return }
        // Offline: the session expires on its own, and Settings > Devices can end it from anywhere.
        _ = try? await send(url.absoluteURL, method: "POST", headers: ["content-type": "application/json"], body: "{}", bearer: bearer)
    }

    @MainActor
    func signIn(window: PlatformWindow?, provider: String? = nil) async -> Bool {
        guard let access = await obtain(window: window, provider: provider) else { return false }
        let previous = token
        token = access
        // Signing in again (another account, or after a stale session) ends the session this device held before.
        if let previous, previous != access { await endSession(previous) }
        return true
    }

    /// The providers the sheet can open straight on (the website's /app-google); anything else is the sign-in page.
    static let providers: Set<String> = ["google", "apple"]

    /// Where the sheet starts: /app-google?provider=… for a known provider (straight on to its page, no choices
    /// on the way), otherwise /connect (the website's sign-in page). Both take the same PKCE request, for this
    /// client and its folevi://auth/callback, and both end there.
    static func signInStart(service: URL, provider: String?, challenge: String, state: String) -> URL? {
        let direct = provider.map { providers.contains($0) } ?? false
        var c = URLComponents(url: service.appendingPathComponent(direct ? "app-google" : "connect"), resolvingAgainstBaseURL: false)
        var items: [URLQueryItem] = [
            .init(name: "client_id", value: clientId), .init(name: "redirect_uri", value: redirectURI),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"), .init(name: "state", value: state),
        ]
        if direct, let provider { items.append(.init(name: "provider", value: provider)) }
        c?.queryItems = items
        return c?.url
    }

    /// The sign-in sheet, ending with a new session's token (or nil).
    @MainActor
    private func obtain(window: PlatformWindow?, provider: String? = nil) async -> String? {
        sheet?.session.cancel()
        let pkce = Self.pkcePair()
        let state = Self.b64url(LibraryCrypto.randomBytes(24))
        guard let connect = Self.signInStart(service: service, provider: provider, challenge: pkce.challenge, state: state) else { return nil }
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
        return await exchange(code: code, verifier: pkce.verifier)
    }

    /// The sheet's last step: the code from folevi://auth/callback, with its PKCE verifier, for a new session's
    /// token at the acting place's website (Folevi Cloud's or a Folevi Server's), or nil.
    func exchange(code: String, verifier: String) async -> String? {
        let body: [String: Any] = ["grant_type": "authorization_code", "code": code, "code_verifier": verifier, "client_id": Self.clientId, "redirect_uri": Self.redirectURI, "device_name": String(Self.deviceName.prefix(60))]
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

// MARK: - Email and password, two-step, sign-up, reset (native sign-in, docs/NATIVE_CONTRACT_REQUESTS.md R14.1)
//
// The native sign-in screens send the form here instead of opening the website's page in the sheet. Better Auth's
// bearer plugin answers a successful sign-in with the session's token in `set-auth-token`, which becomes this
// device's session for that account (as the sheet's PKCE exchange does for providers). The two-step screen needs
// Better Auth's short-lived two-factor cookie from the first answer: it's kept in memory for that one request and
// never stored. Messages are the web's (lib/auth/client.ts authErrorMessage).

extension ShellAuth {
    enum EmailOutcome: Equatable {
        /// Signed in: who it is (the token is stored under their own Keychain item already).
        case signedIn(userId: String, name: String, email: String, avatarUrl: String?)
        case twoFactor
        case emailUnverified
        case failed(String)
    }

    enum FormReply: Equatable {
        case done
        case failed(String)
        case fieldError(field: String, message: String)
    }

    private static var twoFactorCookie: String?

    /// What the sign-in screens say when `belongsElsewhere` refuses.
    static let elsewhereMessage = "This account is already on this device from another server. Sign out of it there first, then sign in again."

    private func authPost(_ path: String, _ body: [String: Any], cookie: String? = nil) async -> (status: Int, json: [String: Any], token: String?, cookies: String?)? {
        guard let url = authURL(path), let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        var headers = ["content-type": "application/json"]
        if let cookie { headers["cookie"] = cookie }
        guard let (res, out, rotated) = try? await send(url, method: "POST", headers: headers, body: String(data: data, encoding: .utf8), bearer: nil, keepRotated: false) else { return nil }
        let json = (try? JSONSerialization.jsonObject(with: out) as? [String: Any]) ?? [:]
        // Only the cookie names Better Auth's two-step needs, as "name=value" pairs (no attributes).
        var pairs: [String] = []
        for (k, v) in res.allHeaderFields where (k as? String)?.lowercased() == "set-cookie" {
            for part in "\(v)".components(separatedBy: ",") {
                guard let first = part.split(separator: ";").first else { continue }
                let pair = first.trimmingCharacters(in: .whitespaces)
                if pair.contains("two_factor") || pair.contains("two-factor") || pair.contains("dont_remember") { pairs.append(pair) }
            }
        }
        let token = rotated.flatMap { $0.range(of: #"^[A-Za-z0-9._~+/=-]{16,1024}$"#, options: .regularExpression) != nil ? $0 : nil }
        return (res.statusCode, json, token, pairs.isEmpty ? nil : pairs.joined(separator: "; "))
    }

    static func message(_ json: [String: Any], status: Int, fallback: String = "Something went wrong. Please try again.", wait: String = "a minute") -> String {
        let code = json["code"] as? String ?? ""
        if status == 429 || code == "TOO_MANY_REQUESTS" { return "Too many attempts. Wait \(wait), then try again." }
        switch code {
        case "INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD", "USER_NOT_FOUND", "INVALID_EMAIL", "CREDENTIAL_ACCOUNT_NOT_FOUND": return "The email or password is incorrect."
        case "EMAIL_NOT_VERIFIED": return "Verify your email address first. We've sent you a new link."
        case "PASSWORD_TOO_SHORT": return "Use at least 10 characters for your password."
        case "PASSWORD_TOO_LONG": return "Use at most 128 characters for your password."
        case "PASSWORD_COMPROMISED": return "This password has appeared in a data breach. Choose a different one."
        case "INVALID_CODE": return "That code didn't work. Check your authenticator app and try again."
        case "INVALID_BACKUP_CODE": return "That backup code didn't work. Each code works only once."
        case "OTP_HAS_EXPIRED", "TWO_FACTOR_NOT_ENABLED", "INVALID_TWO_FACTOR_COOKIE", "SESSION_EXPIRED": return "This sign-in attempt expired. Start again from the sign-in page."
        case "INVALID_TOKEN", "TOKEN_EXPIRED": return "This link is invalid or has expired. Request a new one."
        case "SIGNUPS_PAUSED": return "New sign-ups are paused right now. Please try again later."
        case "ACCOUNT_TEMPORARILY_LOCKED", "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE": return "Too many incorrect codes. For your security this account is locked for a while. Try again later or reset your password."
        default:
            if let m = json["message"] as? String, !m.isEmpty, m.range(of: "internal", options: .caseInsensitive) == nil { return m }
            return fallback
        }
    }

    /// A session token from a sign-in answer becomes that account's session here.
    private func adopt(_ token: String) async -> EmailOutcome {
        guard let user = await userOf(token) else { return .failed("Something went wrong. Please try again.") }
        if Self.belongsElsewhere(user.userId) {
            if let url = URL(string: "/api/auth/sign-out", relativeTo: service)?.absoluteURL {
                _ = try? await send(url, method: "POST", headers: ["content-type": "application/json"], body: "{}", bearer: token, keepRotated: false)
            }
            return .failed(Self.elsewhereMessage)
        }
        let previous = self.token(for: user.userId)
        let issuedAt = issuer(of: user.userId)
        setToken(token, for: user.userId)
        if let previous, previous != token, let issuedAt, let url = URL(string: "/api/auth/sign-out", relativeTo: issuedAt)?.absoluteURL {
            _ = try? await send(url, method: "POST", headers: ["content-type": "application/json"], body: "{}", bearer: previous, keepRotated: false)
        }
        return .signedIn(userId: user.userId, name: user.name, email: user.email, avatarUrl: user.avatarUrl)
    }

    func signIn(email: String, password: String) async -> EmailOutcome {
        Self.twoFactorCookie = nil
        guard let r = await authPost("/api/auth/sign-in/email", ["email": email.trimmingCharacters(in: .whitespaces), "password": password, "rememberMe": true]) else { return .failed("Folevi can't be reached right now. Check your connection and try again.") }
        if r.status == 200, r.json["twoFactorRedirect"] as? Bool == true {
            Self.twoFactorCookie = r.cookies
            return .twoFactor
        }
        if r.json["code"] as? String == "EMAIL_NOT_VERIFIED" { return .emailUnverified }
        guard r.status == 200, let token = r.token else { return .failed(Self.message(r.json, status: r.status)) }
        return await adopt(token)
    }

    func verifyTwoFactor(code: String, backup: Bool, trustDevice: Bool) async -> EmailOutcome {
        guard let cookie = Self.twoFactorCookie else { return .failed("This sign-in attempt expired. Start again from the sign-in page.") }
        let path = backup ? "/api/auth/two-factor/verify-backup-code" : "/api/auth/two-factor/verify-totp"
        guard let r = await authPost(path, ["code": code.trimmingCharacters(in: .whitespaces), "trustDevice": trustDevice], cookie: cookie) else { return .failed("Folevi can't be reached right now. Check your connection and try again.") }
        guard r.status == 200, let token = r.token else { return .failed(Self.message(r.json, status: r.status)) }
        Self.twoFactorCookie = nil
        return await adopt(token)
    }

    func signUp(name: String, email: String, password: String) async -> FormReply {
        guard let r = await authPost("/api/auth/sign-up/email", ["name": String(name.trimmingCharacters(in: .whitespaces).prefix(80)), "email": email.trimmingCharacters(in: .whitespaces), "password": password]) else { return .failed("Folevi can't be reached right now. Check your connection and try again.") }
        let code = r.json["code"] as? String
        if code == "PASSWORD_COMPROMISED" { return .fieldError(field: "password", message: Self.message(r.json, status: r.status)) }
        // An address that already has an account gets the same answer (no account enumeration), as on the web.
        if r.status >= 400, code != "USER_ALREADY_EXISTS", code != "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" { return .failed(Self.message(r.json, status: r.status, wait: "up to an hour")) }
        return .done
    }

    func requestPasswordReset(email: String) async -> FormReply {
        guard let r = await authPost("/api/auth/request-password-reset", ["email": email.trimmingCharacters(in: .whitespaces), "redirectTo": "/reset-password"]) else { return .failed("Folevi can't be reached right now. Check your connection and try again.") }
        if r.status == 429 { return .failed(Self.message(r.json, status: r.status, wait: "a few minutes")) }
        return .done
    }

    func sendVerificationEmail(email: String) async -> FormReply {
        guard let r = await authPost("/api/auth/send-verification-email", ["email": email.trimmingCharacters(in: .whitespaces)]) else { return .failed("Folevi can't be reached right now. Check your connection and try again.") }
        if r.status == 429 { return .failed(Self.message(r.json, status: r.status, wait: "a few minutes")) }
        return .done
    }

    /// Sign in with Apple's own sheet: Better Auth checks the id token (Apple's keys, the bundle ID, the nonce).
    func signIn(appleIdToken: String, nonce: String, firstName: String? = nil, lastName: String? = nil) async -> EmailOutcome {
        var idToken: [String: Any] = ["token": appleIdToken, "nonce": nonce]
        // The name Apple gives only the first time, as the page sends it.
        if firstName != nil || lastName != nil { idToken["user"] = ["name": ["firstName": firstName ?? "", "lastName": lastName ?? ""]] }
        guard let r = await authPost("/api/auth/sign-in/social", ["provider": "apple", "idToken": idToken]) else { return .failed("Folevi can't be reached right now. Check your connection and try again.") }
        guard r.status == 200, let token = r.token else { return .failed(Self.message(r.json, status: r.status)) }
        return await adopt(token)
    }
}

/// Answers are never followed somewhere else (a redirect comes back to the page as it is).
final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
