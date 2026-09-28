import Foundation
import os

/// Structured logging. Never log note bodies, titles, tokens or email addresses — only ids, kinds,
/// counts, revisions and status codes. Dynamic values default to `.private` in os.Logger; we mark
/// only non-sensitive identifiers as public.
enum Log {
    static let subsystem = "com.folevi.mac"
    static let app = Logger(subsystem: subsystem, category: "app")
    static let auth = Logger(subsystem: subsystem, category: "auth")
    static let sync = Logger(subsystem: subsystem, category: "sync")
    static let store = Logger(subsystem: subsystem, category: "store")
    static let remote = Logger(subsystem: subsystem, category: "remote")
    static let editor = Logger(subsystem: subsystem, category: "editor")
    static let files = Logger(subsystem: subsystem, category: "files")
}

/// Process-wide launch options (launch arguments are also readable via UserDefaults' argument domain).
enum LaunchOptions {
    static var arguments: [String] { ProcessInfo.processInfo.arguments }

    static func value(after flag: String) -> String? {
        let args = arguments
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    static func flag(_ name: String) -> Bool {
        if let v = value(after: name) { return ["1", "yes", "true", "YES"].contains(v) }
        return arguments.contains(name)
    }

    #if DEBUG
    /// `-FoleviDevToken <jwt>` or `FOLEVI_DEV_TOKEN` (DEBUG builds only).
    static var devToken: String? {
        if let t = value(after: "-FoleviDevToken"), !t.isEmpty, !t.hasPrefix("-") { return t }
        if let t = ProcessInfo.processInfo.environment["FOLEVI_DEV_TOKEN"], !t.isEmpty { return t }
        return nil
    }

    /// `FOLEVI_DEV_SESSION=<session token>` (DEBUG builds only): signs in with a Folevi session from the
    /// local web app (e.g. one minted by apps/web/e2e for a test account), kept in memory — never written to
    /// the Keychain — and renewed like a real sign-in. For screenshots and automation. Taken from the
    /// environment only, so it never shows up in the process's arguments.
    static var devSession: String? {
        guard let t = ProcessInfo.processInfo.environment["FOLEVI_DEV_SESSION"], !t.isEmpty else { return nil }
        return t
    }
    #endif

    /// Wipes local state and cached credentials on launch (UI tests).
    static var uiTestReset: Bool { flag("-FoleviUITestReset") }

    /// Starts with the sync engine forced offline (debug/UI tests).
    static var forceOffline: Bool {
        #if DEBUG
        return flag("-FoleviForceOffline")
        #else
        return false
        #endif
    }

    static var isRunningUnitTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }
}

/// A stable, non-secret per-install identifier (docs/SYNC_PROTOCOL.md: stored in UserDefaults).
enum DeviceIdentity {
    static var deviceId: String {
        let key = "folevi.deviceId"
        if let existing = UserDefaults.standard.string(forKey: key), ULID.isValidId(existing), existing.count >= 8 { return existing }
        let id = ULID.make()
        UserDefaults.standard.set(id, forKey: key)
        return id
    }

    static var label: String {
        let name = Host.current().localizedName ?? "Mac"
        return String(localized: "Folevi for Mac — \(name)")
    }
}

/// Races an async operation against a timeout without requiring the operation to be cancellable
/// (the Convex FFI calls queue while disconnected and ignore cancellation).
func withTimeout<T: Sendable>(_ seconds: Double, _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
    let box = ResumeOnce<T>()
    return try await withCheckedThrowingContinuation { continuation in
        box.set(continuation)
        Task {
            do { box.resume(.success(try await operation())) } catch { box.resume(.failure(error)) }
        }
        Task {
            try? await Task.sleep(for: .seconds(seconds))
            box.resume(.failure(FoleviError.timeout))
        }
    }
}

final class ResumeOnce<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?
    private var done = false

    func set(_ c: CheckedContinuation<T, Error>) {
        lock.lock()
        continuation = c
        lock.unlock()
    }

    func resume(_ result: Result<T, Error>) {
        lock.lock()
        guard !done, let c = continuation else {
            lock.unlock()
            return
        }
        done = true
        continuation = nil
        lock.unlock()
        c.resume(with: result)
    }
}

/// App-level errors with user-facing copy.
enum FoleviError: Error, LocalizedError, Equatable {
    case timeout
    case offline
    case notSignedIn
    case notConfigured
    case server(code: String, message: String)
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .timeout: return String(localized: "The server took too long to respond.")
        case .offline: return String(localized: "You're offline. Changes are saved on this Mac and will sync later.")
        case .notSignedIn: return String(localized: "You're signed out.")
        case .notConfigured: return String(localized: "Folevi isn't configured for sign-in yet.")
        case .server(_, let message): return message
        case .invalidResponse: return String(localized: "The server sent an unexpected response.")
        }
    }

    var code: String {
        switch self {
        case .timeout: return "timeout"
        case .offline: return "offline"
        case .notSignedIn: return "unauthenticated"
        case .notConfigured: return "not_configured"
        case .server(let code, _): return code
        case .invalidResponse: return "invalid_response"
        }
    }

    var isNetwork: Bool { self == .timeout || self == .offline }
}
