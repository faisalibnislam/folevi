import AppKit
import AuthenticationServices
import Foundation
@preconcurrency import ConvexMobile

/// What the Convex client needs from a sign-in: a short-lived Convex JWT.
struct FoleviCredentials: Sendable {
    var idToken: String
    var expiresAt: Date?
    var method: SignInMethod
}

enum SignInMethod: String, Sendable, Codable {
    /// A Folevi account, signed in through the browser (Authorization Code + PKCE).
    case folevi
    /// DEBUG only: a token injected by UI tests.
    case developerToken
}

/// Minimal JWT payload reader (no verification — the backend verifies every token).
enum JWT {
    static func payload(_ token: String) -> JSONValue? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64) else { return nil }
        return try? JSONValue(jsonData: data)
    }

    static func expiry(_ token: String) -> Date? {
        guard let exp = payload(token)?["exp"]?.doubleValue else { return nil }
        return Date(timeIntervalSince1970: exp)
    }
}

// MARK: - Browser step

/// Shows Folevi's /connect page in a system browser sheet and returns the callback URL.
/// Shares cookies with Safari, so someone already signed in there only has to press Continue.
@MainActor
final class WebSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func run(_ url: URL) async throws -> URL {
        defer { session = nil }
        return try await withCheckedThrowingContinuation { continuation in
            // AuthenticationServices calls this on a background queue: it must not be main-actor isolated
            // (Swift 6 traps on the isolation check otherwise), so it is @Sendable and only resumes.
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme(AuthCallback.scheme)) { @Sendable callbackURL, error in
                if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: CancellationError())
                } else {
                    continuation.resume(throwing: error ?? FoleviError.invalidResponse("no callback"))
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                continuation.resume(throwing: FoleviError.server(code: "browser_unavailable", message: String(localized: "Folevi couldn't open the sign-in page.")))
            }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first ?? ASPresentationAnchor() }
    }
}

// MARK: - Folevi accounts

/// Sign-in with a Folevi account (convex/lib/nativeAuth.ts):
///
/// 1. /connect in the browser, where the person signs in (password + two-step verification) and approves
///    this Mac; the page returns a one-time code bound to our PKCE challenge.
/// 2. The code and verifier are exchanged for a session of this Mac's own (Settings → Devices lists it).
/// 3. That session token lives only in the Keychain. It buys 15-minute Convex JWTs from /convex/token,
///    which also keeps the session rolling; a 401 there means it was signed out, revoked or expired.
final class FoleviAccountAuth: @unchecked Sendable {
    static let clientId = AuthCallback.clientId
    private static let sessionKey = "folevi.session"

    let origin: URL
    private let keychain: Keychain
    private let http: URLSession
    private let lock = NSLock()
    private var cached: FoleviCredentials?
    /// DEBUG automation only: a session kept in memory instead of the Keychain.
    private var ephemeralSession: String?

    init(origin: URL, keychain: Keychain = .app, http: URLSession = .shared) {
        self.origin = origin
        self.keychain = keychain
        self.http = http
    }

    var hasSession: Bool { storedSession != nil }

    private var storedSession: String? {
        lock.lock()
        let ephemeral = ephemeralSession
        lock.unlock()
        return ephemeral ?? keychain.string(for: Self.sessionKey)
    }

    #if DEBUG
    /// Uses `token` for this process only (see `LaunchOptions.devSession`).
    func useEphemeralSession(_ token: String) {
        lock.lock()
        ephemeralSession = token
        cached = nil
        lock.unlock()
    }
    #endif

    private var originHeader: String {
        var comps = URLComponents()
        comps.scheme = origin.scheme
        comps.host = origin.host
        comps.port = origin.port
        return comps.string ?? origin.absoluteString
    }

    private func endpoint(_ path: String) -> URL { origin.appending(path: path) }

    /// The interactive sign-in (browser sheet, then code exchange).
    func signIn() async throws -> FoleviCredentials {
        let pkce = PKCE.make()
        let state = PKCE.randomURLSafe(16)
        guard let url = AuthCallback.connectURL(origin: origin, pkce: pkce, state: state) else { throw FoleviError.notConfigured }
        let browser = await WebSignIn()
        let callback = try await browser.run(url)
        switch AuthCallback.parse(callback) {
        case .code(let code, let returnedState):
            guard returnedState == state else {
                throw FoleviError.server(code: "state_mismatch", message: String(localized: "Sign-in didn't complete. Try again."))
            }
            let token = try await exchange(code: code, verifier: pkce.verifier)
            try keychain.setString(token, for: Self.sessionKey)
            setCached(nil)
            return try await credentials()
        case .error(let code, _):
            if code == "access_denied" { throw CancellationError() }
            throw FoleviError.server(code: code, message: String(localized: "Sign-in didn't complete. Try again."))
        case nil:
            throw FoleviError.invalidResponse("callback")
        }
    }

    private func exchange(code: String, verifier: String) async throws -> String {
        var request = URLRequest(url: endpoint("api/auth/native/token"), timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "grant_type": "authorization_code", "code": code, "code_verifier": verifier,
            "client_id": Self.clientId, "redirect_uri": AuthCallback.redirectURI, "device_name": DeviceIdentity.label,
        ])
        let (data, response) = try await http.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Self.serverError(data, fallback: "Sign-in didn't complete. Try again.") }
        struct TokenResponse: Decodable { let access_token: String }
        return try JSONDecoder().decode(TokenResponse.self, from: data).access_token
    }

    /// A Convex JWT valid for at least `minTTL` more seconds, fetched with the stored session if needed.
    /// Network failures are rethrown as they are (the app keeps working offline and retries).
    func credentials(minTTL: TimeInterval = 120) async throws -> FoleviCredentials {
        if let c = getCached(), let exp = c.expiresAt, exp.timeIntervalSinceNow > minTTL { return c }
        guard let session = storedSession else { throw FoleviError.notSignedIn }
        var request = URLRequest(url: endpoint("api/auth/convex/token"), timeoutInterval: 20)
        request.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 {
            // Signed out elsewhere, revoked, or expired: this Mac's session is gone for good.
            forget()
            throw FoleviError.notSignedIn
        }
        guard status == 200 else { throw Self.serverError(data, fallback: "Folevi couldn't refresh your sign-in. Try again.") }
        struct ConvexToken: Decodable { let token: String }
        let token = try JSONDecoder().decode(ConvexToken.self, from: data).token
        let creds = FoleviCredentials(idToken: token, expiresAt: JWT.expiry(token), method: .folevi)
        setCached(creds)
        return creds
    }

    /// Ends this Mac's session on the server (best effort) and forgets it here.
    func signOut() async {
        if let session = storedSession {
            var request = URLRequest(url: endpoint("api/auth/sign-out"), timeoutInterval: 10)
            request.httpMethod = "POST"
            request.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // Better Auth checks the origin of state-changing requests; this is the web app's own origin.
            request.setValue(originHeader, forHTTPHeaderField: "Origin")
            request.httpBody = Data("{}".utf8)
            _ = try? await http.data(for: request)
        }
        forget()
    }

    func forget() {
        lock.lock()
        let ephemeral = ephemeralSession != nil
        ephemeralSession = nil
        lock.unlock()
        if !ephemeral { try? keychain.delete(Self.sessionKey) }
        setCached(nil)
    }

    private func getCached() -> FoleviCredentials? {
        lock.lock()
        defer { lock.unlock() }
        return cached
    }

    private func setCached(_ value: FoleviCredentials?) {
        lock.lock()
        cached = value
        lock.unlock()
    }

    private static func serverError(_ data: Data, fallback: String.LocalizationValue) -> FoleviError {
        let body = try? JSONValue(jsonData: data)
        let code = body?["error"]?.stringValue ?? body?["code"]?.stringValue ?? "auth_failed"
        let message = body?["error_description"]?.stringValue ?? body?["message"]?.stringValue
        return .server(code: code, message: message ?? String(localized: fallback))
    }
}

// MARK: - Routing provider handed to the Convex client

/// The Convex client takes one provider for its lifetime; this one routes to the method in use (a
/// Folevi account, or in DEBUG builds a token injected by UI tests) and remembers it.
final class RoutingAuthProvider: AuthProvider, @unchecked Sendable {
    typealias T = FoleviCredentials

    enum Mode: Sendable {
        case none
        case folevi
        #if DEBUG
        case token(String)
        /// A Folevi session kept in memory (LaunchOptions.devSession); nothing is saved.
        case ephemeral
        #endif
    }

    private let lock = NSLock()
    private var mode: Mode = .none
    let account: FoleviAccountAuth?
    private let keychain = Keychain.app

    init(config: AppConfig) {
        account = config.appOrigin.map { FoleviAccountAuth(origin: $0) }
    }

    func setMode(_ m: Mode) {
        lock.lock()
        mode = m
        lock.unlock()
    }

    var currentMode: Mode {
        lock.lock()
        defer { lock.unlock() }
        return mode
    }

    /// Restores the last sign-in method from the Keychain (false if there's nothing to restore).
    func restoreSavedMode() -> Bool {
        switch keychain.string(for: "session.method").flatMap(SignInMethod.init(rawValue:)) {
        case .folevi:
            guard account?.hasSession == true else { return false }
            setMode(.folevi)
            return true
        case .developerToken:
            #if DEBUG
            guard let token = keychain.string(for: "dev.token") else { return false }
            setMode(.token(token))
            return true
            #else
            return false
            #endif
        case nil:
            // Nothing saved, or an Auth0 sign-in from an older build (no longer accepted).
            clearSaved()
            return false
        }
    }

    private func remember(_ creds: FoleviCredentials) {
        #if DEBUG
        if case .ephemeral = currentMode { return }
        #endif
        try? keychain.setString(creds.method.rawValue, for: "session.method")
        #if DEBUG
        if creds.method == .developerToken { try? keychain.setString(creds.idToken, for: "dev.token") }
        #endif
    }

    func clearSaved() {
        #if DEBUG
        if case .ephemeral = currentMode {
            account?.forget()
            return
        }
        #endif
        for key in ["session.method", "dev.token", "dev.email", "dev.name"] { try? keychain.delete(key) }
        account?.forget()
    }

    // AuthProvider

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> FoleviCredentials {
        let creds = try await obtain(interactive: true)
        remember(creds)
        onIdToken(creds.idToken)
        return creds
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> FoleviCredentials {
        let creds = try await obtain(interactive: false)
        remember(creds)
        onIdToken(creds.idToken)
        return creds
    }

    func logout() async throws {
        switch currentMode {
        case .folevi: await account?.signOut()
        #if DEBUG
        case .ephemeral: account?.forget()
        #endif
        default: break
        }
        clearSaved()
        setMode(.none)
    }

    func extractIdToken(from authResult: FoleviCredentials) -> String {
        authResult.idToken
    }

    private func obtain(interactive: Bool) async throws -> FoleviCredentials {
        switch currentMode {
        case .none:
            throw FoleviError.notSignedIn
        case .folevi:
            guard let account else { throw FoleviError.notConfigured }
            return interactive ? try await account.signIn() : try await account.credentials()
        #if DEBUG
        case .token(let token):
            return FoleviCredentials(idToken: token, expiresAt: JWT.expiry(token), method: .developerToken)
        case .ephemeral:
            guard let account else { throw FoleviError.notConfigured }
            return try await account.credentials()
        #endif
        }
    }
}
