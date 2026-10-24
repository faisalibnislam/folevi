// The native sign-in screens' service on iPhone and iPad (FoleviScreens' AuthService, docs/NATIVE_CONTRACT_REQUESTS.md
// R14.1), over ShellAuth: email and password, the two-step code, sign-up, password reset and the confirmation email
// through Better Auth's /api/auth/* (ShellAuth's email section); Google straight on the provider's page in iOS's
// sign-in sheet (PKCE with the state checked, ShellAuth.signInAccount); Apple in Apple's own sheet (AppleSignIn.swift,
// the id token checked by Better Auth with a fresh nonce). A new session becomes a place (ShellPlaces) and the app
// opens again in it.
import CryptoKit
import UIKit
import FoleviScreens

@MainActor
final class PhoneAuthService: AuthService {
    weak var window: UIWindow?
    /// Runs once a session was stored: the frame makes it the open place and starts again.
    var signedIn: (_ userId: String, _ name: String, _ email: String, _ avatarUrl: String?) -> Void = { _, _, _, _ in }

    init(window: UIWindow?) { self.window = window }

    var providers: [AuthProvider] { [.apple, .google] }
    var nativeApple: Bool { true }

    func signIn(provider: AuthProvider) async -> SignInOutcome {
        if provider == .apple { return await apple() }
        guard let u = await ShellAuth.shared.signInAccount(window: window, provider: provider.rawValue) else { return .cancelled }
        signedIn(u.userId, u.name, u.email, u.avatarUrl)
        return .signedIn
    }

    func signInOnWeb() async -> SignInOutcome {
        guard let u = await ShellAuth.shared.signInAccount(window: window, provider: nil) else { return .cancelled }
        signedIn(u.userId, u.name, u.email, u.avatarUrl)
        return .signedIn
    }

    func signIn(email: String, password: String) async -> SignInOutcome {
        outcome(await ShellAuth.shared.signIn(email: email, password: password))
    }

    func verifyTwoFactor(code: String, backup: Bool, trustDevice: Bool) async -> SignInOutcome {
        outcome(await ShellAuth.shared.verifyTwoFactor(code: code, backup: backup, trustDevice: trustDevice))
    }

    func signUp(name: String, email: String, password: String) async -> AuthReply {
        reply(await ShellAuth.shared.signUp(name: name, email: email, password: password))
    }

    func requestPasswordReset(email: String) async -> AuthReply {
        reply(await ShellAuth.shared.requestPasswordReset(email: email))
    }

    func resendVerification(email: String) async -> AuthReply {
        reply(await ShellAuth.shared.sendVerificationEmail(email: email))
    }

    func cancel() {
        AppleSignInSheet.current = nil
    }

    // MARK: Apple's own sheet

    private func apple() async -> SignInOutcome {
        let nonce = Data((0..<32).map { _ in UInt8.random(in: 0...255) }).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let answer: [String: Any]? = await withCheckedContinuation { c in
            let sheet = AppleSignInSheet(window: window) { c.resume(returning: $0) }
            AppleSignInSheet.current = sheet
            sheet.start(nonce: nonce)
        }
        guard let answer, let idToken = answer["idToken"] as? String else { return .cancelled }
        let result = await ShellAuth.shared.signIn(appleIdToken: idToken, nonce: nonce, firstName: answer["firstName"] as? String, lastName: answer["lastName"] as? String)
        if case .signedIn(let userId, _, _, _) = result, let code = answer["authorizationCode"] as? String {
            // So Folevi can revoke Apple's tokens if the account is deleted (as the page does after Apple's sheet).
            await ShellAuth.shared.registerAppleCode(code, userId: userId)
        }
        return outcome(result)
    }

    // MARK: Answers

    private func outcome(_ o: ShellAuth.EmailOutcome) -> SignInOutcome {
        switch o {
        case .signedIn(let id, let name, let email, let avatar):
            signedIn(id, name, email, avatar)
            return .signedIn
        case .twoFactor: return .twoFactor
        case .emailUnverified: return .emailUnverified
        case .failed(let m): return .failed(m)
        }
    }

    private func reply(_ r: ShellAuth.FormReply) -> AuthReply {
        switch r {
        case .done: .done
        case .failed(let m): .failed(m)
        case .fieldError(let f, let m): .fieldError(field: f, message: m)
        }
    }
}

extension ShellAuth {
    /// Hands Apple's one-time code to Folevi (/api/auth/apple/native-code), best effort.
    func registerAppleCode(_ code: String, userId: String) async {
        guard let bearer = token(for: userId), let url = URL(string: "/api/auth/apple/native-code", relativeTo: service)?.absoluteURL,
              let body = try? JSONSerialization.data(withJSONObject: ["authorization_code": code]) else { return }
        _ = try? await send(url, method: "POST", headers: ["content-type": "application/json"], body: String(data: body, encoding: .utf8), bearer: bearer, slot: .some(userId))
    }
}
