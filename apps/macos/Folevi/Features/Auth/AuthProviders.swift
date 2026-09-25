import Foundation
@preconcurrency import ConvexMobile
@preconcurrency import Auth0

/// What the Convex client needs from a sign-in: an OIDC ID token.
struct FoleviCredentials: Sendable {
    var idToken: String
    var expiresAt: Date?
    var method: SignInMethod
}

enum SignInMethod: String, Sendable, Codable {
    case auth0
    case developer
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

// MARK: - Auth0 (Universal Login)

/// Stores Auth0 credentials in the Keychain via our wrapper (never UserDefaults).
struct KeychainCredentialsStorage: CredentialsStorage {
    let keychain = Keychain(service: "com.folevi.mac.auth0")
    func getEntry(forKey key: String) throws -> Data { try keychain.data(for: key) }
    func setEntry(_ data: Data, forKey key: String) throws { try keychain.set(data, for: key) }
    func deleteEntry(forKey key: String) throws { try keychain.delete(key) }
    func deleteAllEntries() throws { try keychain.deleteAll() }
}

/// Universal Login via ASWebAuthenticationSession (PKCE is Auth0.swift's default), scopes
/// `openid profile email offline_access`, credentials persisted by CredentialsManager and renewed
/// with the refresh token when the ID token is about to expire.
final class Auth0AuthProvider: @unchecked Sendable {
    let domain: String
    let clientId: String
    private let credentialsManager: CredentialsManager

    init(domain: String, clientId: String) {
        self.domain = domain
        self.clientId = clientId
        credentialsManager = CredentialsManager(authentication: Auth0.authentication(clientId: clientId, domain: domain),
                                                storage: KeychainCredentialsStorage())
    }

    @MainActor
    func login() async throws -> FoleviCredentials {
        let credentials = try await Auth0.webAuth(clientId: clientId, domain: domain)
            .scope("openid profile email offline_access")
            .start()
        try credentialsManager.store(credentials: credentials)
        return FoleviCredentials(idToken: credentials.idToken, expiresAt: JWT.expiry(credentials.idToken) ?? credentials.expiresAt, method: .auth0)
    }

    func loginFromCache() async throws -> FoleviCredentials {
        let credentials = try await credentialsManager.credentials(withScope: nil, minTTL: 120)
        return FoleviCredentials(idToken: credentials.idToken, expiresAt: JWT.expiry(credentials.idToken) ?? credentials.expiresAt, method: .auth0)
    }

    var hasStoredCredentials: Bool { credentialsManager.canRenew() || credentialsManager.hasValid() }

    @MainActor
    func logout() async {
        try? await Auth0.webAuth(clientId: clientId, domain: domain).logout(federated: false)
        _ = try? credentialsManager.clear()
    }
}

// MARK: - Developer sign-in (DEBUG only)

#if DEBUG
/// Development-only sign-in against the web app's `/api/dev-auth/token` endpoint (404 unless dev auth
/// is enabled). Compiled only into DEBUG builds and only reachable when FOLEVI_DEV_AUTH_URL is set.
enum DevAuthProvider {
    struct TokenResponse: Decodable {
        var token: String
        var expiresAt: Double?
    }

    static var endpoint: URL? {
        guard let s = AppConfig.current.devAuthURL, !AppConfig.isPlaceholder(s) else { return nil }
        return URL(string: s)
    }

    static func fetchToken(email: String, name: String, deviceId: String) async throws -> FoleviCredentials {
        guard let url = endpoint else { throw FoleviError.notConfigured }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["email": email, "name": name, "deviceId": deviceId])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw FoleviError.invalidResponse("no http response") }
        if http.statusCode == 404 {
            throw FoleviError.server(code: "dev_auth_disabled", message: String(localized: "Developer sign-in isn't enabled on this server."))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw FoleviError.server(code: "dev_auth_failed", message: String(localized: "Developer sign-in failed (HTTP \(http.statusCode))."))
        }
        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        let expiry = decoded.expiresAt.map { Date(timeIntervalSince1970: $0 > 10_000_000_000 ? $0 / 1000 : $0) } ?? JWT.expiry(decoded.token)
        return FoleviCredentials(idToken: decoded.token, expiresAt: expiry, method: .developer)
    }
}
#endif

// MARK: - Routing provider handed to the Convex client

/// The Convex client takes one provider for its lifetime; this one routes to the method the person
/// chose (Auth0, or in DEBUG builds the developer sign-in / injected token) and remembers it.
final class RoutingAuthProvider: AuthProvider, @unchecked Sendable {
    typealias T = FoleviCredentials

    enum Mode: Sendable {
        case none
        case auth0
        #if DEBUG
        case developer(email: String, name: String)
        case token(String)
        #endif
    }

    private let lock = NSLock()
    private var mode: Mode = .none
    let auth0: Auth0AuthProvider?
    private let keychain = Keychain.app

    init(config: AppConfig) {
        auth0 = config.isAuth0Configured ? Auth0AuthProvider(domain: config.auth0Domain, clientId: config.auth0ClientId) : nil
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

    /// Restores the last sign-in method from the Keychain (nil if none).
    func restoreSavedMode() -> Bool {
        guard let kind = keychain.string(for: "session.method"), let method = SignInMethod(rawValue: kind) else { return false }
        switch method {
        case .auth0:
            guard auth0 != nil else { return false }
            setMode(.auth0)
            return true
        case .developer:
            #if DEBUG
            guard let email = keychain.string(for: "dev.email") else { return false }
            setMode(.developer(email: email, name: keychain.string(for: "dev.name") ?? ""))
            return true
            #else
            return false
            #endif
        case .developerToken:
            #if DEBUG
            guard let token = keychain.string(for: "dev.token") else { return false }
            setMode(.token(token))
            return true
            #else
            return false
            #endif
        }
    }

    private func remember(_ creds: FoleviCredentials) {
        try? keychain.setString(creds.method.rawValue, for: "session.method")
        #if DEBUG
        if creds.method != .auth0 { try? keychain.setString(creds.idToken, for: "dev.token") }
        if case .developer(let email, let name) = currentMode {
            try? keychain.setString(email, for: "dev.email")
            try? keychain.setString(name, for: "dev.name")
        }
        #endif
    }

    func clearSaved() {
        for key in ["session.method", "dev.token", "dev.email", "dev.name"] { try? keychain.delete(key) }
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
        let m = currentMode
        if case .auth0 = m { await auth0?.logout() }
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
        case .auth0:
            guard let auth0 else { throw FoleviError.notConfigured }
            if interactive { return try await auth0.login() }
            return try await auth0.loginFromCache()
        #if DEBUG
        case .token(let token):
            return FoleviCredentials(idToken: token, expiresAt: JWT.expiry(token), method: .developerToken)
        case .developer(let email, let name):
            // Reuse the cached token while it is valid for at least two more minutes.
            if let cached = keychain.string(for: "dev.token"), let exp = JWT.expiry(cached), exp.timeIntervalSinceNow > 120 {
                return FoleviCredentials(idToken: cached, expiresAt: exp, method: .developer)
            }
            return try await DevAuthProvider.fetchToken(email: email, name: name, deviceId: DeviceIdentity.deviceId)
        #endif
        }
    }
}
