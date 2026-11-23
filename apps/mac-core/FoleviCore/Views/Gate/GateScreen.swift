// What the window shows while the engine isn't ready: the first-launch choice (sign in, create an account, keep
// notes on this Mac), the session-ended and sign-in screens, unlocking encrypted notes, approvals from another
// device, onboarding, the device limit and a library move. The engine sends each as data (`gate.changed`: a
// title, text, fields and actions); Core draws it natively and sends the person's choice back (`gate.act`).
import FoleviDesign
import FoleviEngine
import AuthenticationServices
import SwiftUI

struct GateScreen: View {
    let gate: GateChangedEvent
    private var app: AppModel { .shared }
    @State private var values: [String: String] = [:]
    @FocusState private var focus: String?
    /// A new library's optional passphrase (the web's LibrarySetup): off, or on with a confirmation and a promise.
    @State private var encrypt = false
    @State private var confirm = ""
    @State private var understood = false
    @State private var problem: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                header
                if let p = gate.progress { progress(p) }
                if let m = gate.migration { MigrationSummaryView(summary: m) }
                if let d = gate.deviceLimit { deviceLimit(d) }
                if let e2ee = gate.e2ee { E2eeGateExtras(info: e2ee) }
                if let o = gate.onboarding { OnboardingStep(info: o, values: $values) }
                if isLibrarySetup { libraryPassphrase } else { fields }
                if let error = gate.error {
                    Label(error.message, coreSymbol: "exclamationmark.circle").foregroundStyle(.red)
                }
                if gate.gate == "modeChoice" { modeChoice } else { actions }
            }
            .frame(maxWidth: 440)
            .padding(40)
            .frame(maxWidth: .infinity, minHeight: 520)
        }
        .background(.background)
        .overlay(alignment: .top) { if gate.busy { ProgressView().controlSize(.small).padding(.top, 18) } }
        .onAppear { focus = gate.fields.first?.id }
        .onChange(of: gate.gate) { values = [:]; focus = gate.fields.first?.id }
        .onChange(of: gate.error?.message) {
            // A wrong passphrase or key: clear the secrets so the next try starts clean.
            guard gate.error != nil else { return }
            for f in gate.fields where f.kind == .secret || f.kind == .recoveryKey { values[f.id] = nil }
            focus = gate.fields.first { $0.kind == .secret || $0.kind == .recoveryKey }?.id
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            if let symbol = kindSymbol {
                Image(systemName: symbol).font(.system(size: 44, weight: .light)).foregroundStyle(.secondary).frame(height: 88).accessibilityHidden(true)
            } else {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 88, height: 88).accessibilityHidden(true)
            }
            Text(title).font(CoreType.screenTitle(28)).multilineTextAlignment(.center).accessibilityAddTraits(.isHeader)
            if !message.isEmpty {
                Text(message).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// A symbol for the screens that are about a problem or a wait, instead of the app icon.
    private var kindSymbol: String? {
        switch gate.gate {
        case "emailUnverified": "envelope.badge"
        case "suspended": "exclamationmark.octagon"
        case "setupFailed": "wrench.and.screwdriver"
        case "offline": "wifi.slash"
        case "error": "exclamationmark.triangle"
        case "updateRequired": "arrow.down.circle"
        default: nil
        }
    }

    /// The web's words when it sends them; Core's own for the screens it knows.
    private var title: String {
        if !gate.title.isEmpty { return gate.title }
        switch gate.gate {
        case "modeChoice", "welcome", "choose", "first-launch": return "Where should your notes live?"
        case "signedOut", "signin", "sign-in", "session-ended": return "Sign In to Folevi"
        case "loading": return "Opening your notes"
        case "emailUnverified": return "Check your inbox"
        case "suspended": return "This account is paused"
        case "setupFailed": return "Folevi couldn't finish setting up"
        case "offline": return "You're offline"
        case "updateRequired": return "Folevi needs an update"
        case "error": return "Something went wrong"
        case "librarySetup": return "Where should the library live?"
        default: return "Folevi"
        }
    }

    private var message: String {
        if !gate.message.isEmpty { return gate.message }
        switch gate.gate {
        case "modeChoice", "welcome", "choose", "first-launch": return "Sync and share them with a Folevi account, or keep them on your devices."
        case "emailUnverified": return "We sent you a link to confirm your email. It expires in 24 hours and works once."
        case "offline": return "Folevi needs a connection the first time it opens. Your notes open offline after that."
        case "updateRequired": return "This version can't open your notes any more. Choose Check for Updates in the Folevi menu."
        default: return ""
        }
    }

    /// Where your notes live: two big choices, an account or your devices.
    private var modeChoice: some View {
        VStack(spacing: 12) {
            ForEach(gate.actions, id: \.id) { a in
                let account = a.id == "account" || a.id.contains("sign")
                let local = a.id == "local"
                if account || local {
                    Button { act(a) } label: {
                        HStack(spacing: 14) {
                            if account { Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 40, height: 40) } else { Image(systemName: "laptopcomputer").font(.title).frame(width: 40, height: 40) }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.label).font(.headline)
                                Text(account ? "Sync and share your notes." : "Free forever. No account. Your notes stay on your devices.").font(.callout).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity)
                        .background(account ? Color.foleviInk.opacity(0.06) : Color.clear, in: .rect(cornerRadius: 12))
                        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(account ? Color.foleviInk.opacity(0.5) : Color.secondary.opacity(0.3)) }
                        .contentShape(.rect(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .disabled(!a.enabled || gate.busy)
                } else {
                    Button(a.label) { act(a) }.buttonStyle(.borderless).disabled(!a.enabled || gate.busy)
                }
            }
        }
    }

    /// While busy only the ways out stay pressable.
    private func canPress(_ a: GateAction) -> Bool {
        a.enabled && (!gate.busy || ["stop", "cancel", "cancelApproval", "back"].contains(a.id))
    }

    /// Library places' Mac detail lines.
    private func detail(_ a: GateAction) -> String? {
        switch a.id {
        case "place:icloud": "On all your Macs, through iCloud Drive."
        case "place:dropbox": "Folevi uses only its own folder."
        case "place:gdrive": "Folevi sees only the files it makes."
        case "place:folder": "A folder you pick; any sync app can carry it."
        case "place:device": "No sync. You can turn it on later."
        default: nil
        }
    }

    @ViewBuilder private var fields: some View {
        if !gate.fields.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(gate.fields, id: \.id) { f in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(f.label).font(.callout.weight(.medium))
                        Group {
                            if f.kind == .secret {
                                SecureField(f.placeholder, text: binding(f.id))
                            } else if f.kind == .recoveryKey {
                                // A recovery key types in groups of four, upper case, as it was shown.
                                TextField(f.placeholder, text: Binding(get: { values[f.id] ?? "" }, set: { values[f.id] = GateScreen.formatKey($0) }))
                                    .font(.body.monospaced())
                            } else {
                                TextField(f.placeholder, text: binding(f.id))
                                    .font(f.kind == .code ? .body.monospaced() : .body)
                            }
                        }
                        .textFieldStyle(.roundedBorder)
                        .controlSize(.large)
                        .disabled(gate.busy)
                        .focused($focus, equals: f.id)
                        .onSubmit { if let primary = gate.actions.first(where: { $0.style == .primary && $0.enabled }) { act(primary) } }
                    }
                }
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 10) {
            ForEach(gate.actions, id: \.id) { a in
                let lower = a.id.lowercased() + a.label.lowercased()
                if lower.contains("apple") {
                    // The system's own Sign in with Apple button (ASAuthorizationAppleIDButton); Folevi's sign-in flow.
                    AppleIDButton(continues: a.label.lowercased().contains("continue")) { act(a) }
                        .frame(maxWidth: .infinity, minHeight: 32, maxHeight: 32)
                        .disabled(!canPress(a))
                        .opacity(canPress(a) ? 1 : 0.5)
                        .accessibilityLabel(a.label)
                } else if lower.contains("google") {
                    Button { act(a) } label: {
                        HStack { Text("G").font(.headline).foregroundStyle(.blue); Text(a.label) }.frame(maxWidth: .infinity).padding(.vertical, 6)
                            .background(.background, in: .rect(cornerRadius: 8))
                            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(.separator) }
                    }
                    .buttonStyle(.plain).disabled(!canPress(a))
                } else {
                    VStack(spacing: 2) {
                        if a.style == .primary {
                            // Folevi's ink, not the system accent (the owner's black and white buttons).
                            Button { act(a) } label: { Text(a.label).frame(maxWidth: .infinity).padding(.vertical, 2) }
                                .buttonStyle(InkPillStyle())
                                .opacity(canPress(a) ? 1 : 0.45)
                                .disabled(!canPress(a))
                                .keyboardShortcut(.defaultAction)
                        } else {
                        Button { act(a) } label: {
                            Text(a.label).frame(maxWidth: a.style == .quiet ? nil : .infinity)
                        }
                        .controlSize(.large)
                        .buttonStyle(style(a.style))
                        .tint(a.style == .destructive ? .red : nil)
                        .disabled(!canPress(a))
                        .keyboardShortcut(a.style == .primary ? .defaultAction : nil)
                        }
                        if let d = detail(a) { Text(d).font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
        }
    }

    private func style(_ s: GateAction.Style) -> AnyPrimitiveButtonStyle {
        switch s {
        case .primary: AnyPrimitiveButtonStyle(.borderedProminent)
        case .secondary, .destructive: AnyPrimitiveButtonStyle(.bordered)
        case .quiet: AnyPrimitiveButtonStyle(.borderless)
        }
    }

    private func progress(_ p: GateProgress) -> some View {
        VStack(spacing: 6) {
            if let total = p.total, total > 0 {
                ProgressView(value: Double(p.done), total: Double(total))
            } else {
                ProgressView().controlSize(.small)
            }
            Text(p.label).font(.callout).foregroundStyle(.secondary)
        }
    }

    private func deviceLimit(_ d: DeviceLimitInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Signed in on \(d.devices.count) of \(d.limit) devices").font(.headline)
            ForEach(d.devices, id: \.id) { dev in
                HStack {
                    Image(systemName: "desktopcomputer")
                    Text(dev.label)
                    Text(CoreDates.relative(dev.lastSeenAt)).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Sign Out") { send("signOut:\(dev.id)", [:]) }
                }
            }
        }
        .padding(14)
        .background(.fill.quinary, in: .rect(cornerRadius: 10))
    }

    /// "abcd efgh-1234" → "ABCD-EFGH-1234".
    static func formatKey(_ raw: String) -> String {
        let chars = Array(raw.uppercased().filter { $0.isLetter || $0.isNumber })
        return stride(from: 0, to: chars.count, by: 4).map { String(chars[$0..<min($0 + 4, chars.count)]) }.joined(separator: "-")
    }

    private func binding(_ id: String) -> Binding<String> {
        Binding(get: { values[id] ?? "" }, set: { values[id] = $0 })
    }

    /// The page runs the choice (signing in opens the system's sign-in sheet through the shared shell; choosing a
    /// folder opens the Mac's folder panel).
    private func act(_ a: GateAction) {
        guard isLibrarySetup else { return send(a.id, values) }
        var v = values
        if a.style == .primary, encrypt {
            if let p = Self.passphraseProblem(values["passphrase"] ?? "", confirm, understood) { problem = p; return }
        } else {
            v["passphrase"] = nil
        }
        send(a.id, v)
    }

    /// A brand-new library with its optional passphrase field.
    private var isLibrarySetup: Bool { gate.gate == "librarySetup" && gate.fields.contains { $0.id == "passphrase" } }

    static let minPassphrase = 8

    static func passphraseProblem(_ passphrase: String, _ confirm: String, _ understood: Bool) -> String? {
        if passphrase.count < minPassphrase { return "Use at least \(minPassphrase) characters." }
        if passphrase != confirm { return "The two passphrases don't match." }
        if !understood { return "Tick the box to say you understand a lost passphrase can't be recovered." }
        return nil
    }

    /// "Encrypt with a passphrase": a switch, then the warning, the passphrase twice and the promise.
    private var libraryPassphrase: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                Toggle(isOn: $encrypt.animation(Motion.pick(Motion.tap, reduce: Motion.reduce))) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Encrypt with a passphrase").font(.headline)
                            Text(gate.message.contains("this Mac") ? "Optional. No one can read the files without it." : "Optional. No one can read the synced copy without it.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    } icon: { CoreIcon.image("lock", size: 17) }
                }
                .toggleStyle(.switch)
                .disabled(gate.busy)
                if encrypt {
                    Label {
                        Text("**If you lose this passphrase, nobody can open your notes' files.** Folevi can't reset it or recover it. Write it down and keep it somewhere safe.")
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: { Image(systemName: "exclamationmark.shield.fill").foregroundStyle(.red) }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.09), in: .rect(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Passphrase").font(.callout.weight(.medium))
                        SecureField("", text: binding("passphrase")).textFieldStyle(.roundedBorder).focused($focus, equals: "passphrase")
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Type it again").font(.callout.weight(.medium))
                        SecureField("", text: $confirm).textFieldStyle(.roundedBorder)
                    }
                    Text("Use at least \(Self.minPassphrase) characters. A few unrelated words are easy to remember and hard to guess.")
                        .font(.caption).foregroundStyle(.secondary)
                    Toggle("I understand a lost passphrase can't be recovered", isOn: $understood).toggleStyle(.checkbox)
                    if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
                }
            }
            .padding(6)
        }
        .disabled(gate.busy)
        .onChange(of: encrypt) { problem = nil; if encrypt { focus = "passphrase" } }
        .onChange(of: confirm) { problem = nil }
        .onChange(of: understood) { problem = nil }
    }

    private func send(_ action: String, _ extra: [String: String]) {
        app.perform { _ = try await $0.command(Commands.GateAct(GateActArgs(action: action, values: extra.isEmpty ? nil : extra))) }
    }
}

/// A primitive button style of either kind (a gate action's style is data).
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ s: S) { make = { AnyView(s.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// What a move to or from the library takes (notes, folders, files, the room it needs).
struct MigrationSummaryView: View {
    let summary: MigrationSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
            GridRow { Text("Notes").foregroundStyle(.secondary); Text(summary.notes.formatted()) }
            GridRow { Text("Folders").foregroundStyle(.secondary); Text(summary.folders.formatted()) }
            GridRow { Text("Tags").foregroundStyle(.secondary); Text(summary.tags.formatted()) }
            GridRow { Text("Files").foregroundStyle(.secondary); Text("\(summary.files.formatted()) (\(ByteCountFormatter.string(fromByteCount: Int64(summary.fileBytes), countStyle: .file)))") }
            if summary.existingNotes > 0 {
                GridRow { Text("Already there").foregroundStyle(.secondary); Text(summary.existingNotes == 1 ? "1 note, kept" : "\(summary.existingNotes.formatted()) notes, kept") }
            }
            if let room = summary.availableBytes {
                GridRow { Text("Room").foregroundStyle(.secondary); Text(ByteCountFormatter.string(fromByteCount: Int64(room), countStyle: .file) + " free") }
            }
        }
        if !summary.fits {
            Label("There isn't room for everything there.", coreSymbol: "exclamationmark.triangle").foregroundStyle(.orange).padding(.top, 4)
        }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quinary, in: .rect(cornerRadius: 10))
    }
}

/// An onboarding step: what you'll use Folevi for, a note style, the appearance, Foli AI on or off.
struct OnboardingStep: View {
    let info: OnboardingGateInfo
    @Binding var values: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Step \(info.index + 1) of \(info.total)").font(.caption).foregroundStyle(.secondary)
            switch info.step {
            case "use", "useCases":
                ForEach(info.useCaseOptions, id: \.id) { o in
                    Toggle(o.label, isOn: Binding(
                        get: { (values["useCases"] ?? info.useCases.joined(separator: ",")).split(separator: ",").map(String.init).contains(o.id) },
                        set: { on in
                            var set = Set((values["useCases"] ?? info.useCases.joined(separator: ",")).split(separator: ",").map(String.init))
                            if on { set.insert(o.id) } else { set.remove(o.id) }
                            values["useCases"] = set.sorted().joined(separator: ",")
                        }
                    ))
                    .toggleStyle(.checkbox)
                }
            case "style", "noteStyle":
                Picker("Note style", selection: Binding(get: { values["noteStyle"] ?? info.noteStyle }, set: { values["noteStyle"] = $0 })) {
                    ForEach(info.noteStyleOptions, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .pickerStyle(.radioGroup)
            case "appearance":
                Picker("Appearance", selection: Binding(get: { values["appearance"] ?? info.appearance }, set: { values["appearance"] = $0 })) {
                    Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
            case "ai":
                Toggle("Turn on Foli AI", isOn: Binding(get: { (values["ai"] ?? (info.aiEnabled ? "on" : "off")) == "on" }, set: { values["ai"] = $0 ? "on" : "off" }))
                    .toggleStyle(.switch)
            default:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}


/// Encryption steps: approving from another device (waiting, the code to compare, failed), and the new recovery
/// key as its own block with Copy, Save and Print.
struct E2eeGateExtras: View {
    let info: E2eeGateInfo

    var body: some View {
        VStack(spacing: 10) {
            if let name = info.spaceName { Text(name).font(.caption.weight(.medium)).padding(.horizontal, 8).padding(.vertical, 2).background(.fill.tertiary, in: .capsule) }
            switch info.approval {
            case "waiting":
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Waiting for your other device…").foregroundStyle(.secondary) }
            case "failed":
                Label("The approval was cancelled or ran out of time. Try again.", coreSymbol: "exclamationmark.circle").foregroundStyle(.orange)
            default:
                EmptyView()
            }
            if let code = info.approvalCode {
                Text("Check that your other device shows the same code").foregroundStyle(.secondary)
                Text(code).font(.system(size: 30, weight: .semibold, design: .monospaced)).textSelection(.enabled)
            }
            if info.setupStep == "recovery", let key = info.recoveryKey {
                VStack(spacing: 8) {
                    Text("Your recovery key").font(.headline)
                    Text(key).font(.system(.title3, design: .monospaced)).textSelection(.enabled).multilineTextAlignment(.center)
                        .padding(12).frame(maxWidth: .infinity).background(.fill.quinary, in: .rect(cornerRadius: 10))
                    Text("Keep it somewhere safe. It's the only way back in if you lose your devices, and it's shown only now.").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    HStack {
                        Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(key, forType: .string) }
                        Button("Save as a File…") { save(key) }
                        Button("Print…") { print(key) }
                    }
                    .controlSize(.regular)
                }
            }
            if !info.methodsAdded.isEmpty {
                Text("Added: " + info.methodsAdded.map { m in ["recoveryKey": "Recovery key", "passphrase": "Passphrase", "passkey": "Passkey", "device": "Another device"][m] ?? m }.joined(separator: ", ") + ". Two ways are needed.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func save(_ key: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "Folevi recovery key.txt"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? ("Folevi recovery key\n\n" + key + "\n").write(to: url, atomically: true, encoding: .utf8)
    }

    private func print(_ key: String) {
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 468, height: 200))
        view.string = "Folevi recovery key\n\n" + key
        view.font = .monospacedSystemFont(ofSize: 16, weight: .regular)
        NSPrintOperation(view: view).run()
    }
}


/// The system's Sign in with Apple button, black in light mode and white in dark (Apple's rule), sending the press
/// to Folevi's own sign-in.
struct AppleIDButton: NSViewRepresentable {
    let continues: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    func makeNSView(context: Context) -> ASAuthorizationAppleIDButton {
        let b = ASAuthorizationAppleIDButton(authorizationButtonType: continues ? .continue : .signIn, authorizationButtonStyle: scheme == .dark ? .white : .black)
        b.cornerRadius = 8
        b.setContentHuggingPriority(.defaultLow, for: .horizontal)
        b.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        b.target = context.coordinator
        b.action = #selector(Coordinator.press)
        return b
    }

    func updateNSView(_ view: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
    }

    /// As wide as the other sign-in buttons (the system button would keep its own width).
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: ASAuthorizationAppleIDButton, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 280, height: 32)
    }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func press() { action() }
    }
}
