// The sign-in flow's state (web parity: components/app/ShellSignIn.tsx, components/auth/SignInForm.tsx,
// TwoFactor.tsx, SignUpForm.tsx, PasswordResetForms.tsx, CheckInbox.tsx). Shown for the `signedOut` gate, and from
// the first-launch choice's "Sign in to Folevi". Continue with Apple and Google go straight to the provider; email
// and password, the two-step code, sign-up, the reset link and the confirmation email are native forms.
import Foundation
import Observation

@MainActor
@Observable
public final class SignInModel {
    public enum Step: Equatable, Sendable {
        /// Apple, Google, or email.
        case choose
        case email
        case twoFactor
        case forgot
        case forgotSent
        case signUp
        /// "Check your inbox" after signing up (or an unconfirmed address).
        case checkInbox(String)
        /// A provider's or the website's sheet is open.
        case waiting(AuthProvider?)
    }

    public let auth: any AuthService
    let feedback: ScreenFeedback
    let device: ScreenDevice
    /// "Keep notes on my devices instead" (the host switches the app to local mode); nil hides the button.
    @ObservationIgnored public var keepLocally: (@MainActor () -> Void)?
    /// Called after `.signedIn` (the host reloads the Page View into the account).
    @ObservationIgnored public var onSignedIn: (@MainActor () -> Void)?

    public private(set) var step: Step
    private var history: [Step] = []

    public var name = ""
    public var email = ""
    public var password = ""
    public var code = ""
    public var backupCode = ""
    public var useBackup = false
    public var trustDevice = false

    public private(set) var busy: String?
    public private(set) var error: String?
    /// A field's own problem, by field ("name", "email", "password").
    public private(set) var fieldErrors: [String: String] = [:]
    /// The success line under a form ("a new link is on its way").
    public private(set) var notice: String?
    /// The address needs confirming (the sign-in form's info box).
    public private(set) var unverified = false
    /// The last sheet didn't finish ("Signing in didn't finish. Try again.").
    public private(set) var sheetFailed = false

    public init(auth: any AuthService, feedback: ScreenFeedback = ScreenFeedback(), device: ScreenDevice = .current, start: Step = .choose) {
        self.auth = auth
        self.feedback = feedback
        self.device = device
        self.step = start
    }

    // MARK: Moving between steps

    public var canGoBack: Bool { !history.isEmpty }

    public func go(_ next: Step) {
        guard next != step else { return }
        if case .waiting = step {} else { history.append(step) }
        step = next
        clearMessages()
    }

    public func back() {
        if case .waiting = step { auth.cancel() }
        step = history.popLast() ?? .choose
        clearMessages()
    }

    /// Leaves the "waiting" step after its sheet closed by itself (nothing to cancel).
    private func popWaiting() {
        step = history.popLast() ?? .choose
    }

    /// "Start over" from the two-step step.
    public func startOver() {
        history = []
        step = .email
        code = ""
        backupCode = ""
        password = ""
        clearMessages()
    }

    private func clearMessages() {
        error = nil
        fieldErrors = [:]
        notice = nil
        unverified = false
    }

    // MARK: Copy (the web's)

    public var title: String {
        switch step {
        case .choose, .waiting: "Sign in to Folevi"
        case .email: "Welcome back"
        case .twoFactor: "Two-step verification"
        case .forgot, .forgotSent: "Reset your password"
        case .signUp: "Start writing"
        case .checkInbox: "Check your inbox"
        }
    }

    public var lede: String {
        switch step {
        case .choose:
            return "Continue with \(providerNames(or: true)), or sign in with your email. You come back here signed in."
        case .waiting(let p):
            let place = device == .mac ? "Your browser is open" : "The sign-in sheet is open"
            return "\(place)\(p.map { " on \($0.name)'s page" } ?? ""). Finish signing in there, and Folevi comes back here by itself."
        case .email:
            return "Sign in with your email and password."
        case .twoFactor:
            return useBackup ? "Enter one of the backup codes you saved when you set up two-step verification." : "Enter the 6-digit code from your authenticator app."
        case .forgot, .forgotSent:
            return "Enter the email address on your account. We'll send a link to choose a new password."
        case .signUp:
            let offered = providerNames(or: true)
            return offered.isEmpty ? "Create your Folevi account. We'll email you a link to confirm your address." : "Create your Folevi account with \(offered), or with your email (we'll email you a link to confirm it)."
        case .checkInbox(let address):
            return address.isEmpty
                ? "Open the confirmation link we emailed you to continue. It expires in 24 hours and works once."
                : "We sent a confirmation link to \(address). Open it on this device to continue. It expires in 24 hours and works once."
        }
    }

    private func providerNames(or: Bool) -> String {
        auth.providers.map(\.name).joined(separator: or ? " or " : ", ")
    }

    // MARK: Actions

    public func signIn(with provider: AuthProvider) async {
        guard busy == nil else { return }
        sheetFailed = false
        error = nil
        let native = provider == .apple && auth.nativeApple
        if native {
            busy = "apple"
        } else {
            go(.waiting(provider))
        }
        let outcome = await auth.signIn(provider: provider)
        busy = nil
        finish(outcome, from: native ? nil : .waiting(provider), providerName: provider.name)
    }

    /// The website's sign-in page (passkeys and the rest).
    public func signInOnWeb() async {
        guard busy == nil else { return }
        sheetFailed = false
        go(.waiting(nil))
        let outcome = await auth.signInOnWeb()
        finish(outcome, from: .waiting(nil), providerName: nil)
    }

    public func submitEmail() async {
        guard busy == nil else { return }
        clearMessages()
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty, !password.isEmpty else {
            error = "Enter your email and password."
            feedback.haptic(.error)
            return
        }
        busy = "email"
        let outcome = await auth.signIn(email: address, password: password)
        busy = nil
        switch outcome {
        case .twoFactor:
            code = ""
            backupCode = ""
            useBackup = false
            go(.twoFactor)
        case .emailUnverified:
            unverified = true
        case .useWebSignIn:
            await signInOnWeb()
        default:
            finish(outcome, from: nil, providerName: nil)
        }
    }

    public func submitTwoFactor() async {
        guard busy == nil else { return }
        error = nil
        if !useBackup && code.count != 6 { return fail("Enter all 6 digits.") }
        let backup = backupCode.trimmingCharacters(in: .whitespaces)
        if useBackup && backup.count < 6 { return fail("Enter a backup code.") }
        busy = "verify"
        let outcome = await auth.verifyTwoFactor(code: useBackup ? backup : code, backup: useBackup, trustDevice: trustDevice)
        busy = nil
        finish(outcome, from: nil, providerName: nil)
    }

    /// Keeps the code field to six digits, as the web's does.
    public func setCode(_ text: String) {
        code = String(text.filter(\.isNumber).prefix(6))
    }

    public func toggleBackup() {
        useBackup.toggle()
        error = nil
    }

    public func submitForgot() async {
        guard busy == nil else { return }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty else { return fail("Enter your email.") }
        busy = "forgot"
        let reply = await auth.requestPasswordReset(email: address)
        busy = nil
        switch reply {
        case .done: go(.forgotSent)
        case .failed(let m), .fieldError(_, let m): fail(m)
        }
    }

    /// "If an account exists for …" after the reset link went out.
    public var forgotSentText: String {
        "If an account exists for \(email.trimmingCharacters(in: .whitespaces)), a reset link is on its way. It expires in one hour and works once."
    }

    public func submitSignUp() async {
        guard busy == nil else { return }
        clearMessages()
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        var problems: [String: String] = [:]
        if name.trimmingCharacters(in: .whitespaces).isEmpty { problems["name"] = "Tell us what to call you." }
        if !Self.validEmail(address) { problems["email"] = "Enter a valid email address." }
        if let p = Self.passwordProblem(password, email: address) { problems["password"] = p }
        fieldErrors = problems
        guard problems.isEmpty else { return feedback.haptic(.error) }
        busy = "signUp"
        let reply = await auth.signUp(name: String(name.trimmingCharacters(in: .whitespaces).prefix(80)), email: address, password: password)
        busy = nil
        switch reply {
        case .done:
            password = ""
            go(.checkInbox(address))
        case .fieldError(let field, let m):
            fieldErrors = [field: m]
            feedback.haptic(.error)
        case .failed(let m):
            fail(m)
        }
    }

    public func resend() async {
        guard busy == nil, case .checkInbox(let address) = step else { return }
        let to = address.isEmpty ? email.trimmingCharacters(in: .whitespaces) : address
        guard !to.isEmpty else { return fail("Enter your email.") }
        busy = "resend"
        let reply = await auth.resendVerification(email: to)
        busy = nil
        switch reply {
        case .done: notice = "If that address has an account waiting for confirmation, a new link is on its way."
        case .failed(let m), .fieldError(_, let m): fail(m)
        }
    }

    private func fail(_ message: String) {
        error = message
        feedback.haptic(.error)
    }

    private func finish(_ outcome: SignInOutcome, from waiting: Step?, providerName: String?) {
        switch outcome {
        case .signedIn:
            feedback.haptic(.success)
            onSignedIn?()
        case .twoFactor:
            go(.twoFactor)
        case .emailUnverified:
            go(.checkInbox(email.trimmingCharacters(in: .whitespaces)))
        case .cancelled:
            if let waiting, step == waiting { popWaiting() }
        case .useWebSignIn:
            if let waiting, step == waiting { popWaiting() }
            sheetFailed = true
        case .failed(let message):
            if let waiting, step == waiting {
                // The sheet stays on its "waiting" screen with the way to open it again.
                sheetFailed = true
                error = message
            } else {
                fail(message)
            }
        }
    }

    // MARK: Rules (the web's)

    static func validEmail(_ s: String) -> Bool {
        s.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    /// SignUpForm.tsx `passwordProblem`: length matters most; only what's too short or obviously weak is blocked.
    static func passwordProblem(_ password: String, email: String) -> String? {
        if password.count < 10 { return "Use at least 10 characters." }
        if password.count > 128 { return "Use at most 128 characters." }
        let local = email.split(separator: "@").first.map { $0.lowercased() } ?? ""
        if local.count >= 4 && password.lowercased().contains(local) { return "Don't include your email address in your password." }
        if let first = password.first, password.allSatisfy({ $0 == first }) { return "Avoid a single repeated character." }
        return nil
    }
}
