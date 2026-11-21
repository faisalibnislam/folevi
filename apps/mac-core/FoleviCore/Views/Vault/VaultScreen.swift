// The Vault: Folevi's end-to-end encrypted place for passwords, codes, files and private notes. A PIN of 6, 8 or
// 12 digits opens it on this Mac; it locks after a while. A recovery key (or a custodian, in a workspace) gets
// you back in. Inside: Files & Notes, Passwords & Credentials, Health, Activity, People, Trash and Settings.
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI

enum VaultPane: String, CaseIterable, Identifiable {
    case files = "Files & Notes", passwords = "Passwords", health = "Health", activity = "Activity", people = "People", trash = "Trash", settings = "Settings"
    var id: String { rawValue }
}

struct VaultScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var summary = Live<Views.VaultSummary>()
    @State private var pane: VaultPane = .passwords

    var body: some View {
        Group {
            if let s = summary.value {
                switch s.state {
                case .none:
                    if s.personal || s.local {
                        VaultChoosePin(summary: s, mode: .setUp)
                    } else {
                        EmptyScreen(symbol: "lock.shield", title: "No Vault for You Here", message: "This workspace's Vault is only for the people its owner or custodians add.")
                    }
                case .setUp: VaultChoosePin(summary: s, mode: .setUp)
                case .encryptionLocked: E2eeUnlockView()
                case .waitingForKey:
                    EmptyScreen(symbol: "hourglass", title: "Waiting for the Vault's Key", message: "You were added to this Vault. Its key reaches you when a custodian next opens the Vault, then you choose your PIN here.")
                case .needsPasscode: VaultChoosePin(summary: s, mode: .finish)
                case .locked: VaultUnlock(summary: s)
                case .open: open(s)
                }
            } else {
                LoadingScreen()
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) { summary.bind(app.client, Views.VaultSummary(SpaceArgs())) }
    }

    private func open(_ s: VaultSummaryValue) -> some View {
        let vault = s.vaultId ?? ""
        let panes = VaultPane.allCases.filter { $0 != .people || (!s.personal && !s.local) }
        return VStack(spacing: 0) {
            if let key = s.recoveryToSave { RecoveryKeyCard(key: key, vaultId: vault) }
            if s.accessReviewDue && !s.personal {
                Button { pane = .people } label: {
                    Label("Check who has access to this Vault.", systemImage: "person.badge.shield.checkmark")
                        .frame(maxWidth: .infinity, alignment: .leading).padding(10).background(.yellow.opacity(0.15))
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 10) {
                Picker("Section", selection: $pane) { ForEach(panes) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                Spacer()
                Text("Open on this Mac · locks after \(s.autoLockMinutes) idle minute\(s.autoLockMinutes == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            Divider()
            switch pane {
            case .files: VaultFilesView(vaultId: vault)
            case .passwords: VaultPasswordsView(vaultId: vault)
            case .health: VaultHealthView(vaultId: vault)
            case .activity: VaultActivityView(vaultId: vault)
            case .people: VaultPeopleView(vaultId: vault)
            case .trash: VaultTrashView(vaultId: vault)
            case .settings: VaultSettingsView(summary: s)
            }
        }
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Button { app.perform { _ = try await $0.command(Commands.VaultLock(VaultIdArgs(vaultId: vault))) } } label: {
                    Label { Text("Lock the Vault") } icon: { WebIcon.lock.image(size: 15) }
                }
                .help("Lock the Vault")
            }
        }
    }
}

// MARK: PIN

/// A PIN typed into boxes (dots for what's typed). Letters are allowed too, for a passcode from before PINs.
struct PinField: View {
    @Binding var text: String
    var length: Int
    var onComplete: () -> Void = {}
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            SecureField("", text: $text)
                .focused($focused)
                .opacity(0.02)
                .onSubmit(onComplete)
                .onChange(of: text) { _, t in
                    if t.count > 64 { text = String(t.prefix(64)) }
                    if t.count == length, t.allSatisfy(\.isNumber) { onComplete() }
                }
            HStack(spacing: 8) {
                ForEach(0..<max(length, text.count), id: \.self) { i in
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(i == text.count && focused ? Color.foleviInk : Color.secondary.opacity(0.35), lineWidth: i == text.count && focused ? 2 : 1)
                        .frame(width: 34, height: 42)
                        .overlay { if i < text.count { Circle().fill(Color.primary).frame(width: 9, height: 9) } }
                }
            }
            .allowsHitTesting(false)
        }
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .onAppear { focused = true }
        .accessibilityElement()
        .accessibilityLabel("PIN, \(text.count) of \(length) digits")
    }
}

/// Choosing a PIN: setting the Vault up, finishing after a custodian shared its key, moving from an old passcode,
/// changing it, or after a recovery key reset.
struct VaultChoosePin: View {
    enum Mode { case setUp, finish, upgrade(old: String), change(current: String), reset(recovery: String) }
    let summary: VaultSummaryValue
    let mode: Mode
    var done: () -> Void = {}
    private var app: AppModel { .shared }
    @State private var length = 6
    @State private var first = ""
    @State private var second = ""
    @State private var confirming = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 18) {
            WebIcon.shieldCheck.image(size: 44).foregroundStyle(.secondary)
            Text(title).font(CoreType.screenTitle(26))
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary).frame(maxWidth: 440)
            if !confirming {
                Picker("Passcode length", selection: $length) {
                    ForEach(summary.passcodeLengths.isEmpty ? [6, 8, 12] : summary.passcodeLengths, id: \.self) { Text("\($0) digits").tag($0) }
                }
                .pickerStyle(.segmented).fixedSize()
                PinField(text: $first, length: length) { next() }.id("first\(length)")
            } else {
                Text("Type it again").font(.headline)
                PinField(text: $second, length: length) { save() }.id("second")
            }
            if let error { Text(error).foregroundStyle(.red) }
            HStack {
                if confirming { Button("Back") { confirming = false; second = ""; error = nil } }
                Button(confirming ? "Done" : "Next") { confirming ? save() : next() }
                    .buttonStyle(InkPillStyle())
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var title: String {
        switch mode {
        case .setUp: "Set Up Your Vault"
        case .finish: "Choose Your Vault PIN"
        case .upgrade: "Vault Passcodes Are Now a PIN"
        case .change: "Change Your PIN"
        case .reset: "Choose a New PIN"
        }
    }

    private var message: String {
        switch mode {
        case .setUp: "Keep passwords, one-time codes, files and private notes end to end encrypted. Choose a PIN you'll remember: Folevi can't see it or reset it for you."
        case .finish: "A custodian shared the Vault's key with you. Choose the PIN that opens it on your devices."
        case .upgrade: "Vault passcodes are now a PIN of 6, 8 or 12 digits. Choose yours; your old passcode stops working."
        case .change: "Choose a new PIN of 6, 8 or 12 digits."
        case .reset: "Your recovery key checks out. Choose a new PIN for the Vault."
        }
    }

    private func next() {
        guard first.count == length, first.allSatisfy(\.isNumber) else { error = "Use \(length) digits."; return }
        error = nil
        confirming = true
    }

    private func save() {
        guard second == first else { error = "The two don't match."; second = ""; return }
        let pin = first
        let vault = summary.vaultId ?? ""
        Task { @MainActor in
            guard let client = app.client else { return }
            do {
                switch mode {
                case .setUp:
                    _ = try await client.command(Commands.VaultSetUp(VaultSetUpArgs(passcode: pin)))
                case .finish:
                    try check(await client.command(Commands.VaultFinishPasscode(VaultPasscodeArgs(vaultId: vault, passcode: pin))))
                case .upgrade(let old), .change(let old):
                    try check(await client.command(Commands.VaultChangePasscode(VaultChangePasscodeArgs(vaultId: vault, current: old, next: pin))))
                case .reset(let recovery):
                    try check(await client.command(Commands.VaultReset(VaultResetArgs(vaultId: vault, recoveryKey: recovery, passcode: pin))))
                }
                done()
            } catch let f as EngineFailure {
                error = f.message
                confirming = false
                first = ""
                second = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func check(_ r: VaultUnlockResult) throws {
        if r.status != "ok" { throw VaultRefusal(message: r.message ?? "That didn't work. Try again.") }
    }
}

/// A Vault command's refusal (wrong PIN, locked out), with the engine's words.
struct VaultRefusal: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Opening a locked Vault: the PIN, then "Forgot your PIN?" (the recovery key, or asking a custodian).
struct VaultUnlock: View {
    let summary: VaultSummaryValue
    private var app: AppModel { .shared }
    @State private var pin = ""
    @State private var error: String?
    @State private var upgradeFrom: String?
    @State private var forgot = false
    @State private var recovery = ""
    @State private var resetKey: String?
    @State private var asked = false

    var body: some View {
        if let old = upgradeFrom {
            VaultChoosePin(summary: summary, mode: .upgrade(old: old)) { upgradeFrom = nil }
        } else if let key = resetKey {
            VaultChoosePin(summary: summary, mode: .reset(recovery: key)) { resetKey = nil; forgot = false }
        } else if forgot {
            VStack(spacing: 16) {
                Text("Forgot Your PIN?").font(CoreType.screenTitle(24))
                Text("Type the Vault's recovery key to choose a new PIN.").foregroundStyle(.secondary)
                TextField("Vault recovery key", text: $recovery).textFieldStyle(.roundedBorder).font(.body.monospaced()).frame(width: 380)
                HStack {
                    Button("Back") { forgot = false }
                    Button("Next") { resetKey = recovery.trimmingCharacters(in: .whitespacesAndNewlines) }.buttonStyle(InkPillStyle()).disabled(recovery.count < 10)
                }
                if !summary.personal {
                    Divider().frame(width: 300)
                    if asked {
                        Label("Asked. A custodian can reset your access next time they open the Vault.", systemImage: "checkmark.circle").foregroundStyle(.secondary)
                    } else {
                        Button("No recovery key? Ask a custodian") {
                            app.perform { _ = try await $0.command(Commands.VaultRequestReset(VaultIdArgs(vaultId: summary.vaultId ?? ""))); asked = true }
                        }
                        .buttonStyle(InkLinkStyle())
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: 18) {
                WebIcon.lock.image(size: 40).foregroundStyle(.secondary)
                Text("The Vault Is Locked").font(CoreType.screenTitle(26))
                PinField(text: $pin, length: summary.passcodeLengths.max() ?? 6) { unlock() }
                if let error { Text(error).foregroundStyle(.red) }
                Button("Unlock", action: unlock).buttonStyle(InkPillStyle()).keyboardShortcut(.defaultAction)
                Button("Forgot your PIN?") { forgot = true }.buttonStyle(InkLinkStyle())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func unlock() {
        let p = pin
        guard !p.isEmpty, let vault = summary.vaultId else { return }
        Task { @MainActor in
            do {
                let r = try await app.client?.command(Commands.VaultUnlock(VaultPasscodeArgs(vaultId: vault, passcode: p)))
                pin = ""
                switch r?.status {
                case "oldPasscode": upgradeFrom = p; error = nil
                case "ok", nil: error = nil
                default: error = r?.message ?? "That isn't right. Try again."
                }
            } catch let f as EngineFailure { error = f.message; pin = "" } catch {}
        }
    }
}

/// The recovery key, until it's saved: copy it, save it as a file, or say it's saved.
struct RecoveryKeyCard: View {
    let key: String
    let vaultId: String
    private var app: AppModel { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Save your Vault's recovery key", systemImage: "key.horizontal").font(.headline)
            Text("If you forget your PIN, this key is the only way back in. Keep it somewhere safe, such as your password manager.").font(.callout).foregroundStyle(.secondary)
            Text(key).font(.body.monospaced()).textSelection(.enabled)
            HStack {
                Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(key, forType: .string) }
                Button("Save as a File…") { Task { _ = await ShellFiles.shared.save(name: "Folevi Vault recovery key.txt", bytes: Data(key.utf8), from: NSApp.keyWindow) } }
                Spacer()
                Button("I've Saved It") { app.perform { _ = try await $0.command(Commands.VaultRecoverySaved(VaultIdArgs(vaultId: vaultId))) } }.buttonStyle(InkPillStyle())
            }
        }
        .padding(14)
        .background(.yellow.opacity(0.12))
    }
}

// MARK: account encryption

/// The account's end-to-end encryption on this Mac, before the Vault can open: approve from another device, the
/// passphrase or the recovery key.
struct E2eeUnlockView: View {
    private var app: AppModel { .shared }
    @State private var state = Live<Views.E2eeState>()
    @State private var method: E2eeUnlockMethod = .passphrase
    @State private var secret = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            WebIcon.lockKeyhole.image(size: 40).foregroundStyle(.secondary)
            Text("Unlock Your Encrypted Notes").font(CoreType.screenTitle(24))
            Text("The Vault opens once this Mac has your encryption keys.").foregroundStyle(.secondary)
            if let s = state.value {
                Picker("How", selection: $method) {
                    ForEach(s.methods, id: \.self) { m in
                        Text(m == .approve ? "Approve from Another Device" : m == .passphrase ? "Enter Passphrase" : "Enter Recovery Key").tag(m)
                    }
                }
                .pickerStyle(.segmented).fixedSize()
                if method == .approve {
                    if s.approval == .waiting || s.approval == .compare, let code = s.approvalCode {
                        Text("Waiting for approval. Check this code on your other device:").foregroundStyle(.secondary)
                        Text(code).font(.system(size: 28, weight: .semibold, design: .monospaced))
                        Button("Cancel") { app.perform { _ = try await $0.command(Commands.E2eeApprovalCancel()) } }
                    } else {
                        Button("Ask My Other Device") { app.perform { _ = try await $0.command(Commands.E2eeApprovalStart()) } }.buttonStyle(InkPillStyle())
                    }
                } else {
                    SecureField(method == .passphrase ? "Passphrase" : "Recovery key", text: $secret).textFieldStyle(.roundedBorder).frame(width: 360).onSubmit(unlock)
                    Button("Unlock", action: unlock).buttonStyle(InkPillStyle()).keyboardShortcut(.defaultAction)
                }
                if let error { Text(error).foregroundStyle(.red) }
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { state.bind(app.client, Views.E2eeState()) }
        .onChange(of: state.value?.methods) {
            if let m = state.value?.methods.first(where: { $0 != .approve }) ?? state.value?.methods.first { method = m }
        }
    }

    private func unlock() {
        let s = secret
        guard !s.isEmpty else { return }
        Task { @MainActor in
            do {
                _ = try await app.client?.command(Commands.E2eeUnlock(E2eeUnlockArgs(method: method, secret: s)))
                secret = ""
                error = nil
                TouchIdOffer.offerIfUseful()
            } catch let f as EngineFailure { error = f.message } catch {}
        }
    }
}

/// After encrypted notes open with a passphrase: "Use Touch ID next time?" (once, when this Mac has Touch ID).
@MainActor
enum TouchIdOffer {
    static func offerIfUseful() {
        let k = E2eeKeys.shared.settings()
        guard k.available, !k.touchId, Paths.defaults.object(forKey: "core.touchIdOffered") == nil else { return }
        Paths.defaults.set(true, forKey: "core.touchIdOffered")
        let alert = NSAlert()
        alert.messageText = "Use Touch ID next time?"
        alert.informativeText = "Unlock your encrypted notes and the Vault with Touch ID on this Mac."
        alert.addButton(withTitle: "Use Touch ID")
        alert.addButton(withTitle: "Not Now")
        if alert.runModal() == .alertFirstButtonReturn { Task { _ = try? await E2eeKeys.shared.setFaceId(true) } }
    }
}
