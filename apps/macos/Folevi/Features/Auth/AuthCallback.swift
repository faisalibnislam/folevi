import Foundation

/// Auth0 native callback URLs: `com.folevi.mac://{domain}/macos/com.folevi.mac/callback`.
/// Auth0.swift performs the exchange itself; this parser lets us validate/diagnose callbacks
/// (and is unit tested) without trusting anything but the expected scheme, host and path.
public enum AuthCallback: Equatable, Sendable {
    case code(code: String, state: String?)
    case error(code: String, description: String?)

    public static func callbackURL(bundleId: String, domain: String) -> URL? {
        URL(string: "\(bundleId.lowercased())://\(domain)/macos/\(bundleId)/callback")
    }

    /// Parses a callback URL. Returns nil unless scheme, host and path match exactly.
    public static func parse(_ url: URL, bundleId: String, domain: String) -> AuthCallback? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              comps.scheme?.lowercased() == bundleId.lowercased(),
              comps.host?.lowercased() == domain.lowercased(),
              comps.path == "/macos/\(bundleId)/callback" else { return nil }
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

/// Runtime configuration read from Info.plist (populated from Config/*.xcconfig).
public struct AppConfig: Sendable, Equatable {
    public var convexURL: String
    public var auth0Domain: String
    public var auth0ClientId: String
    public var devAuthURL: String?

    public init(convexURL: String, auth0Domain: String, auth0ClientId: String, devAuthURL: String?) {
        self.convexURL = convexURL
        self.auth0Domain = auth0Domain
        self.auth0ClientId = auth0ClientId
        self.devAuthURL = devAuthURL
    }

    public static func from(info: [String: Any]) -> AppConfig {
        func value(_ key: String) -> String {
            (info[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        let dev = value("FoleviDevAuthURL")
        return AppConfig(convexURL: value("FoleviConvexURL"), auth0Domain: value("FoleviAuth0Domain"),
                         auth0ClientId: value("FoleviAuth0ClientID"), devAuthURL: dev.isEmpty ? nil : dev)
    }

    public static var current: AppConfig { from(info: Bundle.main.infoDictionary ?? [:]) }

    static func isPlaceholder(_ value: String) -> Bool {
        let v = value.lowercased()
        return v.isEmpty || v.contains("set-me") || v.contains("<") || v.contains("placeholder") || v.contains("$(")
    }

    /// Auth0 Universal Login is available only with real values.
    public var isAuth0Configured: Bool {
        !AppConfig.isPlaceholder(auth0Domain) && !AppConfig.isPlaceholder(auth0ClientId)
    }

    public var isBackendConfigured: Bool {
        !AppConfig.isPlaceholder(convexURL) && URL(string: convexURL)?.scheme != nil
    }
}
