// Signing in natively (plan 5.1, "Sign in / sign up / forgot / two-factor / verify email"). There's no session yet,
// so these don't go through the Page View: the host answers them with its Swift services (ShellAuth: the PKCE sheet
// for Google and Apple straight on the provider's page, Sign in with Apple's own sheet on iOS, and Better Auth's
// /api/auth/* for email and password). The screens only see this protocol, so they run against a scripted service
// in tests, previews and screenshots, and never touch a real account there.
import Foundation

public enum AuthProvider: String, Sendable, CaseIterable, Hashable {
    case apple, google

    public var name: String {
        switch self {
        case .apple: "Apple"
        case .google: "Google"
        }
    }
}

/// How a sign-in attempt ended.
public enum SignInOutcome: Equatable, Sendable {
    /// Signed in: the host reloads the Page View into the account (the gate goes away by itself).
    case signedIn
    /// The password was right; the account asks for its two-step code next.
    case twoFactor
    /// The address isn't confirmed yet; a fresh link went out.
    case emailUnverified
    /// The person closed the sheet.
    case cancelled
    /// This host can't sign in with a password natively: the website's sign-in page opens in the sheet instead.
    case useWebSignIn
    /// The web's own message for what went wrong ("Incorrect email or password.").
    case failed(String)
}

/// The answer to a form that sends an email or makes an account.
public enum AuthReply: Equatable, Sendable {
    case done
    case failed(String)
    /// A problem with one field ("password": "That password has appeared in a data breach…").
    case fieldError(field: String, message: String)
}

@MainActor
public protocol AuthService: AnyObject {
    /// The providers this build offers (Apple, Google), in order.
    var providers: [AuthProvider] { get }
    /// Whether "Continue with Apple" uses the system's own sheet (iOS) rather than a web page.
    var nativeApple: Bool { get }
    /// Continue with Apple or Google: straight to the provider (ShellAuth's /app-google, or AppleSignIn on iOS).
    func signIn(provider: AuthProvider) async -> SignInOutcome
    /// The website's sign-in page in the sheet (passkeys, SSO, anything the native form doesn't do).
    func signInOnWeb() async -> SignInOutcome
    /// Email and password (Better Auth's /api/auth/sign-in/email).
    func signIn(email: String, password: String) async -> SignInOutcome
    /// The two-step code (TOTP) or a backup code, after `.twoFactor`.
    func verifyTwoFactor(code: String, backup: Bool, trustDevice: Bool) async -> SignInOutcome
    func signUp(name: String, email: String, password: String) async -> AuthReply
    func requestPasswordReset(email: String) async -> AuthReply
    func resendVerification(email: String) async -> AuthReply
    /// Cancels a provider or web sheet that's still open.
    func cancel()
}

/// An auth service answered from Swift: tests, SwiftUI previews and snapshot runs. It records what was asked and
/// answers with the outcomes it's given; it never reaches a server.
@MainActor
public final class ScriptedAuthService: AuthService {
    public var providers: [AuthProvider]
    public var nativeApple: Bool
    public var signInOutcome: SignInOutcome = .signedIn
    public var providerOutcome: SignInOutcome = .signedIn
    public var twoFactorOutcome: SignInOutcome = .signedIn
    public var reply: AuthReply = .done
    /// Each call, in order ("email:a@b.c", "provider:apple", "totp:123456", ...); passwords are never recorded.
    public private(set) var calls: [String] = []
    /// Holds each answer until `release()` (tests of the busy state).
    public var holds = false
    private var held: [CheckedContinuation<Void, Never>] = []

    public init(providers: [AuthProvider] = [.apple, .google], nativeApple: Bool = true) {
        self.providers = providers
        self.nativeApple = nativeApple
    }

    public func release() {
        let h = held
        held = []
        for c in h { c.resume() }
    }

    private func wait() async {
        guard holds else { return }
        await withCheckedContinuation { held.append($0) }
    }

    public func signIn(provider: AuthProvider) async -> SignInOutcome {
        calls.append("provider:\(provider.rawValue)")
        await wait()
        return providerOutcome
    }

    public func signInOnWeb() async -> SignInOutcome {
        calls.append("web")
        await wait()
        return providerOutcome
    }

    public func signIn(email: String, password: String) async -> SignInOutcome {
        calls.append("email:\(email)")
        await wait()
        return signInOutcome
    }

    public func verifyTwoFactor(code: String, backup: Bool, trustDevice: Bool) async -> SignInOutcome {
        calls.append("\(backup ? "backup" : "totp"):\(code)\(trustDevice ? ":trust" : "")")
        await wait()
        return twoFactorOutcome
    }

    public func signUp(name: String, email: String, password: String) async -> AuthReply {
        calls.append("signUp:\(email)")
        await wait()
        return reply
    }

    public func requestPasswordReset(email: String) async -> AuthReply {
        calls.append("reset:\(email)")
        await wait()
        return reply
    }

    public func resendVerification(email: String) async -> AuthReply {
        calls.append("resend:\(email)")
        await wait()
        return reply
    }

    public func cancel() { calls.append("cancel") }
}
