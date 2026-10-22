// Sign in with Apple in Apple's own sheet (docs/IOS.md, "Sign in with Apple"; App Store rules 4.8 and 5.1.1(v)):
// `foleviNative.signInWithApple({ nonce })`. The page makes the nonce and keeps it; the request carries its
// SHA-256 in hex (Apple puts that in the id token as is). The answer is the credential's id token and one-time
// authorization code (UTF-8) and, the first time someone uses Apple with Folevi, their name; nil when the sheet
// was closed. The page signs in with the id token (Better Auth checks it against Apple's keys, the bundle ID and
// the nonce) and hands the code to /api/auth/apple/native-code so Folevi can revoke Apple's tokens later.
import AuthenticationServices
import Capacitor
import CryptoKit
import UIKit

@MainActor
final class AppleSignInSheet: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    static var current: AppleSignInSheet?
    private let window: UIWindow?
    private let finish: ([String: Any]?) -> Void
    private var controller: ASAuthorizationController?

    init(window: UIWindow?, finish: @escaping ([String: Any]?) -> Void) {
        self.window = window
        self.finish = finish
    }

    static func sha256Hex(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func start(nonce: String) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = Self.sha256Hex(nonce)
        let c = ASAuthorizationController(authorizationRequests: [request])
        c.delegate = self
        c.presentationContextProvider = self
        controller = c
        c.performRequests()
    }

    private func done(_ value: [String: Any]?) {
        Self.current = nil
        finish(value)
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { window ?? ASPresentationAnchor() }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        let token = credential?.identityToken.flatMap { String(data: $0, encoding: .utf8) }
        let code = credential?.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        let first = credential?.fullName?.givenName
        let last = credential?.fullName?.familyName
        MainActor.assumeIsolated {
            guard let token, let code else { return done(nil) }
            done(["idToken": token, "authorizationCode": code, "firstName": first ?? NSNull(), "lastName": last ?? NSNull()])
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated { done(nil) }
    }
}

extension FoleviNativePlugin {
    /// { nonce } -> { idToken, authorizationCode, firstName, lastName } or { value: null } when cancelled.
    @objc func signInWithApple(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.fromFolevi else { return call.reject("Not allowed here") }
            guard let nonce = call.getString("nonce"), nonce.range(of: #"^[A-Za-z0-9_-]{16,128}$"#, options: .regularExpression) != nil else {
                return call.reject("A nonce is needed")
            }
            AppleSignInSheet.current = nil
            let sheet = AppleSignInSheet(window: self.bridge?.viewController?.view.window) { value in
                if let value { call.resolve(value) } else { call.resolve(["value": NSNull()]) }
            }
            AppleSignInSheet.current = sheet
            sheet.start(nonce: nonce)
        }
    }
}
