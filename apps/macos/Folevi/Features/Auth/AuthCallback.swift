import CryptoKit
import Foundation

/// Where the web's /connect page sends the browser back: `com.folevi.mac://auth/callback?code=…&state=…`
/// (convex/lib/nativeClients.ts registers exactly this URI). The parser trusts nothing but the expected
/// scheme, host and path.
public enum AuthCallback: Equatable, Sendable {
    case code(code: String, state: String?)
    case error(code: String, description: String?)

    public static let scheme = "com.folevi.mac"
    public static let redirectURI = "com.folevi.mac://auth/callback"
    public static let clientId = "folevi-mac"

    /// The web page that signs this Mac in: `<origin>/connect?client_id=…&code_challenge=…&state=…`.
    /// The PKCE verifier itself never leaves the Mac.
    public static func connectURL(origin: URL, pkce: PKCE, state: String) -> URL? {
        var comps = URLComponents(url: origin.appending(path: "connect"), resolvingAgainstBaseURL: false)
        comps?.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]
        return comps?.url
    }

    /// Parses a callback URL. Returns nil unless scheme, host and path match exactly.
    public static func parse(_ url: URL) -> AuthCallback? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              comps.scheme?.lowercased() == scheme,
              comps.host?.lowercased() == "auth",
              comps.path == "/callback" else { return nil }
        var items: [String: String] = [:]
        for item in comps.queryItems ?? [] { items[item.name] = item.value ?? "" }
        if let error = items["error"], !error.isEmpty {
            return .error(code: error, description: items["error_description"])
        }
        if let code = items["code"], !code.isEmpty {
            return .code(code: code, state: items["state"])
        }
        return nil
    }
}

/// Proof Key for Code Exchange (RFC 7636, S256): a random verifier kept on this Mac, and its hash sent
/// with the sign-in request. Only the holder of the verifier can redeem the code the browser returns.
public struct PKCE: Sendable, Equatable {
    public let verifier: String
    public let challenge: String

    public init(verifier: String) {
        self.verifier = verifier
        challenge = PKCE.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    public static func make() -> PKCE { PKCE(verifier: randomURLSafe(32)) }

    /// `bytes` of randomness, base64url without padding (32 bytes → 43 characters).
    public static func randomURLSafe(_ bytes: Int) -> String {
        var buffer = [UInt8](repeating: 0, count: bytes)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes, &buffer)
        precondition(status == errSecSuccess, "no system randomness")
        return base64URL(Data(buffer))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Runtime configuration read from Info.plist (populated from Config/*.xcconfig).
public struct AppConfig: Sendable, Equatable {
    /// The Convex deployment (…convex.cloud) the app syncs with.
    public var convexURL: String
    /// The web app (https://app.folevi.com): sign-in pages and the /api/auth endpoints.
    public var appURL: String

    public init(convexURL: String, appURL: String) {
        self.convexURL = convexURL
        self.appURL = appURL
    }

    public static func from(info: [String: Any]) -> AppConfig {
        func value(_ key: String) -> String {
            (info[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        return AppConfig(convexURL: value("FoleviConvexURL"), appURL: value("FoleviAppURL"))
    }

    public static var current: AppConfig { from(info: Bundle.main.infoDictionary ?? [:]) }

    static func isPlaceholder(_ value: String) -> Bool {
        let v = value.lowercased()
        return v.isEmpty || v.contains("set-me") || v.contains("<") || v.contains("placeholder") || v.contains("$(")
    }

    /// The web app's origin, when configured with a real http(s) URL.
    public var appOrigin: URL? {
        guard !AppConfig.isPlaceholder(appURL), let url = URL(string: appURL), url.scheme == "https" || url.scheme == "http", url.host != nil else { return nil }
        return url
    }

    public var isSignInConfigured: Bool { appOrigin != nil }

    public var isBackendConfigured: Bool {
        !AppConfig.isPlaceholder(convexURL) && URL(string: convexURL)?.scheme != nil
    }
}
