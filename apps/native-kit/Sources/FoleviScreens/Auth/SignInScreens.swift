// The sign-in screens (SignInModel): the three ways in, the email form, the two-step code, forgot password, sign-up
// and "Check your inbox". Each uses the web's words. Keyboard: Return submits each form; on the Mac, Escape goes back.
import SwiftUI
import FoleviDesign

public struct SignInFlow: View {
    @Bindable var model: SignInModel

    public init(model: SignInModel) { self.model = model }

    public var body: some View {
        PreAppPage(title: model.title, lede: model.lede, identifier: "sign-in-\(stepId)") {
            content
            if model.canGoBack, model.step != .twoFactor {
                TextLinkButton(title: "Back", identifier: "sign-in-back") { model.back() }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .animation(.folevi(), value: model.step)
    }

    private var stepId: String {
        switch model.step {
        case .choose: "choose"
        case .email: "email"
        case .twoFactor: "two-factor"
        case .forgot: "forgot"
        case .forgotSent: "forgot-sent"
        case .signUp: "sign-up"
        case .checkInbox: "check-inbox"
        case .waiting: "waiting"
        }
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .choose: choose
        case .waiting(let p): waiting(p)
        case .email: emailForm
        case .twoFactor: twoFactor
        case .forgot: forgot
        case .forgotSent: forgotSent
        case .signUp: signUp
        case .checkInbox: checkInbox
        }
    }

    // MARK: The three ways in

    @ViewBuilder private var choose: some View {
        providerButtons
        PreAppButton("Sign in with email", kind: .secondary, systemImage: "envelope") { model.go(.email) }
            .disabled(model.busy != nil)
            .accessibilityIdentifier("sign-in-email")
        if let error = model.error { InlineAlert(text: error, tone: .danger) }
        if model.sheetFailed && model.error == nil { Text("Signing in didn't finish. Try again.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) }
        if let keep = model.keepLocally {
            TextLinkButton(title: "Keep notes on my devices instead", identifier: "sign-in-keep-local") { keep() }
        }
    }

    @ViewBuilder private var providerButtons: some View {
        ForEach(model.auth.providers, id: \.self) { p in
            switch p {
            case .apple:
                AppleButton(busy: model.busy == "apple") { Task { await model.signIn(with: .apple) } }
            case .google:
                Button { Task { await model.signIn(with: .google) } } label: {
                    HStack(spacing: 10) {
                        GoogleMark()
                        Text("Continue with Google")
                    }
                    .frame(maxWidth: .infinity, minHeight: PreApp.buttonHeight)
                }
                .buttonStyle(FoleviButtonStyle(.secondary, size: .large, fullWidth: true))
                .disabled(model.busy != nil)
                .accessibilityIdentifier("sign-in-google")
            }
        }
    }

    @ViewBuilder private func waiting(_ provider: AuthProvider?) -> some View {
        let mac = model.device == .mac
        PreAppButton(mac ? "Waiting for your browser…" : "Waiting for the sign-in sheet…", busy: true) {}
            .disabled(true)
        PreAppButton(mac ? "Open the browser again" : "Open the sign-in sheet again", kind: .secondary) {
            Task {
                if let provider { await model.signIn(with: provider) } else { await model.signInOnWeb() }
            }
        }
        .accessibilityIdentifier("sign-in-reopen")
        PreAppButton("Sign in another way", kind: .secondary) { model.back() }
            .accessibilityIdentifier("sign-in-other-way")
        if let error = model.error { InlineAlert(text: error, tone: .danger) }
    }

    // MARK: Email and password

    @ViewBuilder private var emailForm: some View {
        if let error = model.error { InlineAlert(text: error, tone: .danger) }
        if model.unverified {
            InlineAlert(text: "Verify your email address first. We've sent a fresh link to \(model.email.trimmingCharacters(in: .whitespaces)). Open it on this device to continue.", tone: .info)
        }
        LabeledField("Email", text: $model.email, kind: .email, identifier: "sign-in-field-email")
        LabeledField("Password", text: $model.password, kind: .password, identifier: "sign-in-field-password") { Task { await model.submitEmail() } }
        HStack {
            Spacer()
            TextLinkButton(title: "Forgot your password?", identifier: "sign-in-forgot") { model.go(.forgot) }
        }
        PreAppButton("Sign in", busy: model.busy == "email") { Task { await model.submitEmail() } }
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("sign-in-submit")
        TextLinkButton(title: "Sign in with a passkey", identifier: "sign-in-passkey") { Task { await model.signInOnWeb() } }
        HStack(spacing: 4) {
            Text("New to Folevi?").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
            TextLinkButton(title: "Create an account", identifier: "sign-in-create") { model.go(.signUp) }
        }
    }

    // MARK: Two-step

    @ViewBuilder private var twoFactor: some View {
        Image(systemName: "checkmark.shield")
            .font(.system(size: 22, weight: .medium))
            .foregroundStyle(Folevi.color.accentSoftInk)
            .frame(width: 48, height: 48)
            .background(RoundedRectangle(cornerRadius: Folevi.radius.chip, style: .continuous).fill(Folevi.color.accentSoft))
            .accessibilityHidden(true)
        if let error = model.error { InlineAlert(text: error, tone: .danger) }
        if model.useBackup {
            LabeledField("Backup code", text: $model.backupCode, kind: .recoveryKey, placeholder: "", identifier: "sign-in-field-backup") { Task { await model.submitTwoFactor() } }
        } else {
            LabeledField("6-digit code", text: Binding(get: { model.code }, set: { model.setCode($0) }), kind: .code, identifier: "sign-in-field-code") { Task { await model.submitTwoFactor() } }
        }
        Toggle(isOn: $model.trustDevice) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Trust this device for 30 days").foleviFont(.callout).fontWeight(.medium).foregroundStyle(Folevi.color.ink)
                Text("You won't be asked for a code here again until then. Don't use this on shared computers.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
            }
        }
        .toggleStyle(.switch)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: Folevi.radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
        .accessibilityIdentifier("sign-in-trust")
        PreAppButton("Verify", busy: model.busy == "verify") { Task { await model.submitTwoFactor() } }
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("sign-in-verify")
        HStack {
            TextLinkButton(title: model.useBackup ? "Use my authenticator app" : "Use a backup code instead", identifier: "sign-in-toggle-backup") { model.toggleBackup() }
            Spacer()
            TextLinkButton(title: "Start over", identifier: "sign-in-start-over") { model.startOver() }
        }
    }

    // MARK: Forgot password

    @ViewBuilder private var forgot: some View {
        if let error = model.error { InlineAlert(text: error, tone: .danger) }
        LabeledField("Email", text: $model.email, kind: .email, identifier: "sign-in-field-email") { Task { await model.submitForgot() } }
        PreAppButton("Send reset link", busy: model.busy == "forgot") { Task { await model.submitForgot() } }
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("sign-in-send-reset")
        rememberedIt
    }

    @ViewBuilder private var forgotSent: some View {
        InlineAlert(text: model.forgotSentText, tone: .success)
        rememberedIt
    }

    private var rememberedIt: some View {
        HStack(spacing: 4) {
            Text("Remembered it?").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
            TextLinkButton(title: "Sign in", identifier: "sign-in-back-to-sign-in") { model.go(.email) }
        }
    }

    // MARK: Sign up

    @ViewBuilder private var signUp: some View {
        providerButtons
        if let error = model.error { InlineAlert(text: error, tone: .danger) }
        LabeledField("Your name", text: $model.name, kind: .name, error: model.fieldErrors["name"], identifier: "sign-up-field-name")
        LabeledField("Email", text: $model.email, kind: .email, error: model.fieldErrors["email"], identifier: "sign-up-field-email")
        LabeledField("Password", text: $model.password, kind: .newPassword, hint: "At least 10 characters. A few unrelated words make a strong, memorable password.", error: model.fieldErrors["password"], identifier: "sign-up-field-password") { Task { await model.submitSignUp() } }
        PreAppButton("Create account", busy: model.busy == "signUp") { Task { await model.submitSignUp() } }
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("sign-up-submit")
        Text(.init("By creating an account you agree to the [Terms](https://folevi.com/terms) and [Privacy Policy](https://folevi.com/privacy)."))
            .foleviFont(.footnote)
            .foregroundStyle(Folevi.color.inkMuted)
            .tint(Folevi.color.accent)
            .multilineTextAlignment(.center)
        HStack(spacing: 4) {
            Text("Already have an account?").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
            TextLinkButton(title: "Sign in", identifier: "sign-up-sign-in") { model.go(.email) }
        }
    }

    // MARK: Check your inbox

    @ViewBuilder private var checkInbox: some View {
        if let notice = model.notice { InlineAlert(text: notice, tone: .success) }
        if let error = model.error { InlineAlert(text: error, tone: .danger) }
        PreAppButton("Send a new link", kind: .secondary, busy: model.busy == "resend") { Task { await model.resend() } }
            .accessibilityIdentifier("sign-in-resend")
        HStack(spacing: 4) {
            Text("Already confirmed?").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
            TextLinkButton(title: "Sign in", identifier: "sign-in-confirmed") { model.go(.email) }
        }
    }
}
