import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

// Settings → Security (the web's SecuritySection): two-step verification, password, and deleting the
// account. Two-step verification and the password go through the same Better Auth endpoints as the web's
// authClient, with this Mac's own session; nothing is opened in the browser.

/// Better Auth calls for Settings → Security, with this Mac's session. When Better Auth replaces the session
/// (password changed, two-step verification turned on or off), the app fetches a token for the new one.
@MainActor
struct SecurityAuth {
    let app: AppModel

    func call(_ path: String, _ body: [String: JSONValue] = [:]) async throws -> JSONValue? {
        guard let account = app.authProvider.account else { throw FoleviError.notConfigured }
        let data = try JSONEncoder().encode(body)
        let result = try await account.authCall(path, body: data)
        if result.rotated { await app.sessionReplaced() }
        return result.json
    }

    /// Whether two-step verification is on (Better Auth's session user).
    func twoFactorEnabled() async throws -> Bool {
        guard let account = app.authProvider.account else { throw FoleviError.notConfigured }
        let result = try await account.authCall("get-session", method: "GET")
        if result.rotated { await app.sessionReplaced() }
        return result.json?["user"]?["twoFactorEnabled"]?.boolValue == true
    }

    /// A friendly message for a failed call (the web's authErrorMessage).
    static func message(_ error: Error, fallback: String? = nil, wait: String? = nil) -> String {
        if let e = error as? AuthCallError {
            return e.userMessage(fallback: fallback ?? String(localized: "Something went wrong. Please try again."), wait: wait ?? String(localized: "a minute"))
        }
        if error is URLError { return String(localized: "This needs a connection. Try again when you're back online.") }
        return fallback ?? ConvexService.mapError(error).localizedDescription
    }
}

struct SecuritySettings: View {
    var body: some View {
        SettingsPage {
            TwoStepCard()
            PasswordCard()
            DeleteAccountCard()
        }
    }
}

// MARK: - Two-step verification

private struct TwoStepCard: View {
    @Environment(AppModel.self) private var app
    @State private var enabled: Bool?
    @State private var gate: Gate?
    @State private var codes: [String]?
    @State private var totpURI: String?
    @State private var settingUp = false

    enum Gate: String, Identifiable { case codes, key, off; var id: String { rawValue } }

    var body: some View {
        Group {
            switch enabled {
            case nil:
                SettingsCard(title: String(localized: "Two-step verification")) {
                    if !app.sync.isOnline { OfflineNote() } else { EmptyView() }
                }
            case false?:
                SettingsCard(title: String(localized: "Two-step verification"),
                             description: String(localized: "Optional. When it's on, signing in on a new device needs a code from your authenticator app as well as your password, so a stolen password isn't enough.")) {
                    Label("Off", systemImage: "shield.slash")
                        .font(.ui(14, .medium))
                        .foregroundStyle(FoleviColor.inkMuted)
                    Button("Turn on two-step verification") { settingUp = true }
                        .buttonStyle(.folevi(.primary, .medium))
                        .padding(.top, 16)
                }
            case true?:
                SettingsCard(title: String(localized: "Two-step verification"),
                             description: String(localized: "Folevi asks for a code from your authenticator app every time you sign in on a new device.")) {
                    Label("On (authenticator app)", systemImage: "checkmark.shield")
                        .font(.ui(14, .medium))
                        .foregroundStyle(FoleviColor.success)
                    Text("When you tick “Trust this device for 30 days” while signing in, that browser skips the code for 30 days. Signing out, revoking the session below, or changing your password ends it.")
                        .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                    HStack(spacing: 8) {
                        Button("Move to a new authenticator app") { gate = .key }
                        Button("Get new backup codes") { gate = .codes }
                        Button("Turn off") { gate = .off }
                    }
                    .buttonStyle(.folevi(.secondary, .medium))
                    .padding(.top, 16)
                }
            }
        }
        .task(id: app.sync.isOnline) { await refresh() }
        .sheet(item: $gate) { g in passwordGate(g) }
        .sheet(isPresented: Binding(get: { codes != nil }, set: { if !$0 { codes = nil } })) {
            WebDialog(title: String(localized: "Save your new backup codes"), description: String(localized: "Each code works once. You'll only see these now."),
                      onClose: { codes = nil }) {
                BackupCodesView(codes: codes ?? [], doneLabel: String(localized: "Done")) {
                    codes = nil
                    app.showToast(String(localized: "New backup codes saved"))
                }
            }
        }
        .sheet(isPresented: Binding(get: { totpURI != nil }, set: { if !$0 { totpURI = nil } })) {
            WebDialog(title: String(localized: "Add Folevi to your new authenticator"), description: String(localized: "Scan the code or enter the key, then check that the codes match."),
                      onClose: { totpURI = nil }) {
                VStack(alignment: .trailing, spacing: 16) {
                    TotpEnrollmentView(totpURI: totpURI ?? "")
                    Button("Done") { totpURI = nil }
                        .buttonStyle(.folevi(.primary, .medium))
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .sheet(isPresented: $settingUp, onDismiss: { Task { await refresh() } }) {
            TwoFactorSetupSheet { settingUp = false }
                .environment(app)
        }
    }

    private func passwordGate(_ g: Gate) -> some View {
        let auth = SecurityAuth(app: app)
        switch g {
        case .off:
            return PasswordGate(title: String(localized: "Turn off two-step verification?"),
                                description: String(localized: "Signing in will only need your password. Your authenticator entry and backup codes stop working; you can turn it on again at any time."),
                                action: String(localized: "Turn off"), onClose: { gate = nil }) { password in
                do {
                    _ = try await auth.call("two-factor/disable", ["password": .string(password)])
                    gate = nil
                    enabled = false
                    app.showToast(String(localized: "Two-step verification is off"))
                    return nil
                } catch { return SecurityAuth.message(error) }
            }
        case .codes:
            return PasswordGate(title: String(localized: "New backup codes"),
                                description: String(localized: "Your old backup codes stop working as soon as new ones are created."),
                                action: String(localized: "Create new codes"), onClose: { gate = nil }) { password in
                do {
                    let json = try await auth.call("two-factor/generate-backup-codes", ["password": .string(password)])
                    guard let list = json?["backupCodes"]?.arrayValue?.compactMap(\.stringValue) else { return SecurityAuth.message(FoleviError.invalidResponse("codes")) }
                    gate = nil
                    codes = list
                    return nil
                } catch { return SecurityAuth.message(error) }
            }
        case .key:
            return PasswordGate(title: String(localized: "Move to a new authenticator app"),
                                description: String(localized: "Shows your authenticator key again so you can add Folevi to another app or phone."),
                                action: String(localized: "Show my key"), onClose: { gate = nil }) { password in
                do {
                    let json = try await auth.call("two-factor/get-totp-uri", ["password": .string(password)])
                    guard let uri = json?["totpURI"]?.stringValue else { return SecurityAuth.message(FoleviError.invalidResponse("uri")) }
                    gate = nil
                    totpURI = uri
                    return nil
                } catch { return SecurityAuth.message(error) }
            }
        }
    }

    private func refresh() async {
        guard app.sync.isOnline else { return }
        enabled = (try? await SecurityAuth(app: app).twoFactorEnabled()) ?? enabled
    }
}

/// Asks for the current password before showing secrets (backup codes, the authenticator key) or turning
/// two-step verification off. `onConfirm` returns a problem to show, or nil when done.
private struct PasswordGate: View {
    var title: String
    var description: String
    var action: String
    var onClose: () -> Void
    var onConfirm: (String) async -> String?
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        WebDialog(title: title, description: description, size: .sm, onClose: onClose) {
            VStack(alignment: .leading, spacing: 12) {
                if let error { WebAlert(text: error) }
                WebPasswordField(label: String(localized: "Current password"), text: $password, onSubmit: submit)
                HStack {
                    Spacer()
                    Button(action, action: submit)
                        .buttonStyle(.folevi(.primary, .medium))
                        .keyboardShortcut(.defaultAction)
                        .disabled(busy || password.isEmpty)
                }
            }
        }
    }

    private func submit() {
        guard !busy, !password.isEmpty else { return }
        busy = true
        let typed = password
        Task {
            let problem = await onConfirm(typed)
            busy = false
            if let problem { error = problem } else { password = "" }
        }
    }
}

/// The web's /two-factor/setup, as a sheet: confirm the password, scan the code and confirm one, then save
/// the backup codes. Three steps with the progress strip above.
private struct TwoFactorSetupSheet: View {
    var onDone: () -> Void
    @Environment(AppModel.self) private var app
    @State private var step = 0
    @State private var password = ""
    @State private var code = ""
    @State private var enrollment: (uri: String, codes: [String])?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                ForEach(Array([String(localized: "Confirm"), String(localized: "Scan"), String(localized: "Save codes")].enumerated()), id: \.offset) { i, label in
                    HStack(spacing: 8) {
                        Capsule().fill(step >= i ? FoleviColor.ember : FoleviColor.surfaceSunken).frame(width: 32, height: 6)
                        Text(label.uppercased()).font(.ui(12, .semibold)).tracking(0.72)
                            .foregroundStyle(step >= i ? FoleviColor.heading : FoleviColor.inkFaint)
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Step \(step + 1) of 3"))
            .padding(.bottom, 16)
            switch step {
            case 0: confirm
            case 1: scan
            default: save
            }
            if step < 2 {
                TextLinkButton(title: step == 0 ? String(localized: "Not now") : String(localized: "Cancel"), accent: true, size: 14) { onDone() }
                    .padding(.top, 24)
                    .keyboardShortcut(.cancelAction)
            }
            if let email = app.profile?.email {
                Text("Signed in as \(email).").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 12)
            }
        }
        .padding(32)
        .frame(width: 480, alignment: .leading)
        .background(FoleviColor.surface)
    }

    private func heading(_ title: String, _ lede: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(FoleviType.display(34)).tracking(FoleviType.displayTracking(34)).foregroundStyle(FoleviColor.heading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(lede).font(.ui(15)).foregroundStyle(FoleviColor.inkMuted).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 24)
    }

    private var confirm: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(String(localized: "Protect your account"),
                    String(localized: "Turn on two-step verification so a code from your authenticator app is needed as well as your password. First, confirm your password."))
            if let error { WebAlert(text: error) }
            WebPasswordField(label: String(localized: "Password"), text: $password, onSubmit: start)
            submitButton(String(localized: "Continue"), action: start)
        }
    }

    private var scan: some View {
        VStack(alignment: .leading, spacing: 0) {
            heading(String(localized: "Add Folevi to your authenticator"), String(localized: "Then enter the 6-digit code it shows to confirm."))
            TotpEnrollmentView(totpURI: enrollment?.uri ?? "")
            VStack(alignment: .leading, spacing: 16) {
                if let error { WebAlert(text: error) }
                CodeField(code: $code, onSubmit: verify)
                submitButton(String(localized: "Turn on two-step verification"), action: verify)
            }
            .padding(.top, 24)
        }
    }

    private var save: some View {
        VStack(alignment: .leading, spacing: 0) {
            heading(String(localized: "Save your backup codes"), String(localized: "If you lose your phone, a backup code gets you in. You'll only see these once."))
            BackupCodesView(codes: enrollment?.codes ?? [], doneLabel: String(localized: "Continue to Folevi")) {
                app.showToast(String(localized: "Two-step verification is on"))
                onDone()
            }
        }
    }

    private func submitButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().controlSize(.small).tint(FoleviColor.accentInk) }
                Text(title)
            }
        }
        .buttonStyle(.folevi(.primary, .large, fullWidth: true))
        .keyboardShortcut(.defaultAction)
        .disabled(busy)
    }

    private func start() {
        guard !busy, !password.isEmpty else { return }
        busy = true
        error = nil
        let typed = password
        Task {
            defer { busy = false }
            do {
                let json = try await SecurityAuth(app: app).call("two-factor/enable", ["password": .string(typed), "issuer": "Folevi"])
                guard let uri = json?["totpURI"]?.stringValue, let codes = json?["backupCodes"]?.arrayValue?.compactMap(\.stringValue) else {
                    error = String(localized: "We couldn't start setup. Try again.")
                    return
                }
                enrollment = (uri, codes)
                password = ""
                step = 1
            } catch {
                self.error = SecurityAuth.message(error, fallback: String(localized: "We couldn't start setup. Try again."))
            }
        }
    }

    private func verify() {
        guard !busy else { return }
        guard code.count == 6 else {
            error = String(localized: "Enter all 6 digits.")
            return
        }
        busy = true
        error = nil
        let typed = code
        Task {
            defer { busy = false }
            do {
                _ = try await SecurityAuth(app: app).call("two-factor/verify-totp", ["code": .string(typed)])
                step = 2
            } catch {
                self.error = SecurityAuth.message(error)
            }
        }
    }
}

/// Six-digit code input tuned for authenticator apps: digits only, centred, monospaced, wide tracking.
private struct CodeField: View {
    @Binding var code: String
    var onSubmit: () -> Void

    var body: some View {
        LabeledField(label: String(localized: "6-digit code"), large: true) {
            TextField("", text: $code)
                .textContentType(.oneTimeCode)
                .tracking(8)
                .onSubmit(onSubmit)
                .onChange(of: code) { _, v in
                    let digits = String(v.filter(\.isNumber).prefix(6))
                    if digits != v { code = digits }
                }
                .accessibilityLabel(Text("6-digit code"))
                .modifier(WebFieldChrome(height: 44, fontSize: 20, mono: true, centered: true))
        }
    }
}

/// The scannable QR code (made on this Mac, so the secret never goes to a QR service) and the manual key.
struct TotpEnrollmentView: View {
    var totpURI: String

    private var secret: String {
        URLComponents(string: totpURI)?.queryItems?.first { $0.name == "secret" }?.value ?? ""
    }

    private var grouped: String {
        var out = ""
        for (i, c) in secret.enumerated() {
            if i > 0 && i % 4 == 0 { out.append(" ") }
            out.append(c)
        }
        return out
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Group {
                if let image = Self.qr(totpURI) {
                    Image(nsImage: image)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 164, height: 164)
                        .accessibilityLabel(Text("QR code to add Folevi to your authenticator app"))
                } else {
                    Text("Preparing…").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                }
            }
            .frame(width: 188, height: 188)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .foleviShadow(FoleviShadow.card, radius: 6)
            VStack(alignment: .leading, spacing: 8) {
                Text("Scan with an authenticator app (1Password, Google Authenticator, Authy, Microsoft Authenticator…), or enter this key:")
                    .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "key").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 2).accessibilityHidden(true)
                    Text(grouped)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(FoleviColor.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel(Text("Key: \(secret)"))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                Text("Time-based, 6 digits, every 30 seconds.").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
    }

    /// A QR code in the web's colours (#1D1814 on white, error correction M, a one-module margin).
    static func qr(_ text: String) -> NSImage? {
        guard !text.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let colored = output.applyingFilter("CIFalseColor", parameters: [
            "inputColor0": CIColor(red: 0x1D / 255, green: 0x18 / 255, blue: 0x14 / 255),
            "inputColor1": CIColor(red: 1, green: 1, blue: 1),
        ])
        let padded = colored.transformed(by: CGAffineTransform(translationX: 1, y: 1))
            .composited(over: CIImage(color: .white).cropped(to: CGRect(x: 0, y: 0, width: output.extent.width + 2, height: output.extent.height + 2)))
        let scaled = padded.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let rep = NSCIImageRep(ciImage: scaled)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }
}

/// The backup codes in two columns, Copy and Download, "I saved these codes…", and the done button.
struct BackupCodesView: View {
    var codes: [String]
    var doneLabel: String
    var onDone: () -> Void
    @Environment(AppModel.self) private var app
    @State private var saved = false
    @State private var copied = false

    private var text: String { "Folevi backup codes\nEach code works once. Keep them somewhere safe.\n\n\(codes.joined(separator: "\n"))\n" }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(codes, id: \.self) { c in
                    Text(c)
                        .font(.system(size: 15, design: .monospaced))
                        .foregroundStyle(FoleviColor.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .foleviShadow(FoleviShadow.hairline, radius: 6)
                }
            }
            .padding(16)
            .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Backup codes"))
            HStack(spacing: 8) {
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(text, forType: .string)
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(2))
                        copied = false
                    }
                } label: {
                    Label(copied ? String(localized: "Copied") : String(localized: "Copy"), systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.folevi(.secondary, .large, fullWidth: true))
                Button {
                    let url = DataSettings.uniqueDownloadURL("folevi-backup-codes.txt")
                    do {
                        try Data(text.utf8).write(to: url)
                        NSWorkspace.shared.activateFileViewerSelecting([url])
                    } catch {
                        app.showToast(error.localizedDescription)
                    }
                } label: {
                    Label("Download", systemImage: "arrow.down.to.line")
                }
                .buttonStyle(.folevi(.secondary, .large, fullWidth: true))
            }
            WebCheckbox(isOn: $saved, accessibilityLabel: String(localized: "I saved these codes somewhere safe")) {
                Text("I saved these codes somewhere safe. Each one works once, and they're the only way in if I lose my authenticator app.")
                    .font(.ui(14)).foregroundStyle(FoleviColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(doneLabel, action: onDone)
                .buttonStyle(.folevi(.primary, .large, fullWidth: true))
                .disabled(!saved)
        }
    }
}

// MARK: - Password

private struct PasswordCard: View {
    @Environment(AppModel.self) private var app
    @State private var current = ""
    @State private var next = ""
    @State private var repeatNew = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        SettingsCard(title: String(localized: "Password"), description: String(localized: "Changing your password signs you out on every other device.")) {
            VStack(alignment: .leading, spacing: 12) {
                if let error { WebAlert(text: error) }
                WebPasswordField(label: String(localized: "Current password"), text: $current, onSubmit: submit)
                WebPasswordField(label: String(localized: "New password"), text: $next, hint: String(localized: "At least 10 characters."), contentType: .newPassword, onSubmit: submit)
                WebPasswordField(label: String(localized: "Repeat new password"), text: $repeatNew, contentType: .newPassword, onSubmit: submit)
                HStack(spacing: 12) {
                    Button("Change password", action: submit)
                        .buttonStyle(.folevi(.primary, .medium))
                        .disabled(busy)
                    TextLinkButton(title: String(localized: "Forgot your current password?"), accent: true, size: 14) {
                        openWebApp("forgot-password", config: app.config)
                    }
                }
            }
            .frame(maxWidth: 448, alignment: .leading)
        }
    }

    private func submit() {
        guard !busy else { return }
        if current.isEmpty || next.isEmpty || repeatNew.isEmpty { return }
        guard next.count >= 10 else {
            error = String(localized: "Use at least 10 characters for the new password.")
            return
        }
        guard next == repeatNew else {
            error = String(localized: "The two new passwords don't match.")
            return
        }
        busy = true
        error = nil
        let body: [String: JSONValue] = ["currentPassword": .string(current), "newPassword": .string(next), "revokeOtherSessions": .bool(true)]
        Task {
            defer { busy = false }
            do {
                _ = try await SecurityAuth(app: app).call("change-password", body)
                current = ""
                next = ""
                repeatNew = ""
                app.showToast(String(localized: "Password changed. Other devices were signed out."))
            } catch {
                self.error = SecurityAuth.message(error, wait: String(localized: "up to an hour"))
            }
        }
    }
}

// MARK: - Delete account

/// Delete account: scheduled with a 7-day grace period, cancelable. Workspaces other people use must be
/// handed on or deleted first (the server refuses otherwise).
struct DeleteAccountCard: View {
    @Environment(AppModel.self) private var app
    @State private var blockers: DeletionBlockers?
    @State private var confirming = false
    @State private var typed = ""
    @State private var busy = false

    private var pending: Bool { app.profile?.status == "pending_deletion" }

    var body: some View {
        SettingsCard(title: String(localized: "Delete account"),
                     description: String(localized: "Deletes your account, your Personal and everything in it after a 7-day grace period, along with workspaces you own that nobody else is in. Export your data first if you want to keep it.")) {
            if pending {
                HStack(spacing: 12) {
                    Text(app.profile?.deletionScheduledFor.map { String(localized: "Scheduled for \(WebFormat.dateTime($0)).") } ?? String(localized: "Scheduled for soon."))
                        .font(.ui(14)).foregroundStyle(FoleviColor.ink)
                    Button("Cancel deletion") { cancel() }.buttonStyle(.folevi(.secondary, .medium))
                }
            } else if let blockers, !blockers.workspaces.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(blockers.workspaces.count == 1
                         ? String(localized: "You own a workspace other people use. Your account can’t be deleted until you make another member the owner (Members → Make owner) or delete it (General → Delete workspace):")
                         : String(localized: "You own workspaces other people use. Your account can’t be deleted until you make another member the owner (Members → Make owner) or delete them (General → Delete workspace):"))
                        .font(.ui(14)).foregroundStyle(FoleviColor.ink).fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(blockers.workspaces) { w in
                            let n = Int(w.otherMembers)
                            Text("•  \(w.name) · \(n) other \(n == 1 ? String(localized: "member") : String(localized: "members"))")
                                .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                        }
                    }
                    .padding(.leading, 8)
                }
                .frame(maxWidth: 576, alignment: .leading)
            } else {
                Button("Delete my account…") {
                    typed = ""
                    confirming = true
                }
                .buttonStyle(.folevi(.danger, .medium))
            }
        }
        .task(id: pending) { await load() }
        .sheet(isPresented: $confirming) {
            WebConfirmDialog(title: String(localized: "Delete your account?"),
                             description: String(localized: "You can cancel within 7 days by signing in. After that, deletion is permanent and cannot be undone. We'll email you a confirmation."),
                             cancelTitle: String(localized: "Keep my account"),
                             confirmTitle: String(localized: "Schedule deletion"),
                             confirmDisabled: typed.trimmingCharacters(in: .whitespaces).lowercased() != (app.profile?.email ?? "").lowercased(),
                             busy: busy, onCancel: { confirming = false }, onConfirm: request) {
                ConfirmByTyping(expected: app.profile?.email ?? "", text: $typed)
            }
        }
    }

    private func load() async {
        guard !pending, let session = app.session, app.sync.isOnline else { return }
        let stream: AsyncThrowingStream<DeletionBlockers, Error> = session.convex.subscribe("users:deletionBlockers")
        do {
            for try await value in stream { blockers = value }
        } catch {
            blockers = try? await session.account.deletionBlockers()
        }
    }

    private func request() {
        guard let session = app.session else { return }
        let email = typed
        busy = true
        Task {
            defer { busy = false }
            do {
                let r = try await session.account.requestAccountDeletion(confirmEmail: email)
                app.profile?.status = "pending_deletion"
                app.profile?.deletionScheduledFor = r.scheduledFor
                confirming = false
                app.showToast(String(localized: "Account deletion scheduled"))
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func cancel() {
        app.settingsAction(String(localized: "Deletion canceled")) { session in
            try await session.account.cancelAccountDeletion()
            await MainActor.run {
                app.profile?.status = "active"
                app.profile?.deletionScheduledFor = nil
            }
        }
    }
}
