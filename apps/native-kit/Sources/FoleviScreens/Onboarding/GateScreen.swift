// The gate screens (plan 5.1), one view for every `gate.changed` kind: the first-launch choice ("Sign in to Folevi"
// highlighted with the Folevi mark, "Keep notes on my devices" second), sign-in (SignInFlow), onboarding, the local
// library's setup and lock, "move or keep" and its progress, moves between places, the E2EE unlock (passphrase,
// recovery key, approval from another device with the shared code), setup (the recovery key shown once and
// confirmed with groups 3 and 7), waiting and trust, the device limit, update required, offline, suspended and
// setup failed. Headings, text, fields and buttons are the engine's (the web screen's own words); each button is
// `gate.act`. Kinds without special parts fall back to the heading, text, fields and buttons, so a new gate still
// works before native knows it.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct GateScreen: View {
    @Bindable var model: GateModel
    let signIn: SignInModel?

    /// `signIn`: the sign-in flow for the `signedOut` gate (the host's AuthService behind it).
    public init(model: GateModel, signIn: SignInModel?) {
        self.model = model
        self.signIn = signIn
    }

    public var body: some View {
        Group {
            switch model.kind {
            case .signedOut:
                if let signIn { SignInFlow(model: signIn) } else { generic }
            case .modeChoice:
                modeChoice
            default:
                generic
            }
        }
        .accessibilityIdentifier("gate-\(model.kind.raw)")
    }

    // MARK: First launch

    private var modeChoice: some View {
        PreAppPage(title: model.title, identifier: "gate-page") {
            ForEach(model.gate?.actions ?? [], id: \.id) { a in
                let account = a.id == "account"
                ChoiceCard(title: a.label, detail: Self.choiceDetail(a.id), recommended: account, busy: model.pending == a.id, identifier: "gate-action-\(a.id)") {
                    if account { FoleviMark(size: 24) } else { Image(systemName: a.id == "local" ? "internaldrive" : "arrow.right").font(.system(size: 19, weight: .medium)).foregroundStyle(Folevi.color.heading) }
                } action: {
                    Task { await model.act(a.id) }
                }
                .disabled(!model.isEnabled(a))
            }
            Text(model.message)
                .foleviFont(.footnote)
                .foregroundStyle(Folevi.color.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.top, 8)
            if let error = model.errorMessage { InlineAlert(text: error, tone: .danger) }
        }
    }

    static func choiceDetail(_ id: String) -> String {
        switch id {
        case "account": "Your notes in your Folevi account, with sharing."
        case "local": "Free forever. No account."
        default: ""
        }
    }

    // MARK: Every other screen

    private var generic: some View {
        PreAppPage(title: model.title, lede: model.kind == .onboarding ? nil : model.message, showsLogo: model.kind != .onboarding, identifier: "gate-page") {
            special
            if let p = model.gate?.progress { ProgressBlock(progress: p) } else if model.gate?.busy == true, model.kind != .e2eeLocked { ProgressView().controlSize(.regular).padding(.vertical, 8) }
            if let error = model.errorMessage { InlineAlert(text: error, tone: .danger).accessibilityIdentifier("gate-error") }
            ForEach(model.visibleFields, id: \.id) { f in
                LabeledField(f.label, text: binding(f.id), kind: Self.fieldKind(f.kind), placeholder: f.placeholder, identifier: "gate-field-\(f.id)") {
                    if let first = model.visibleActions.first(where: { model.isEnabled($0) && $0.style == .primary }) { Task { await model.act(first.id) } }
                }
            }
            ForEach(Array(model.visibleActions.enumerated()), id: \.element.id) { index, a in
                if model.kind == .deviceLimit, a.id.hasPrefix("signOut:") {
                    EmptyView()
                } else {
                    PreAppButton(a.label, kind: a.style.buttonKind, busy: model.pending == a.id) { Task { await model.act(a.id) } }
                        .disabled(!model.isEnabled(a))
                        .accessibilityIdentifier("gate-action-\(a.id)")
                        .modifier(DefaultActionIf(on: index == 0 && a.style == .primary))
                }
            }
            ForEach(model.otherMethods, id: \.id) { m in
                TextLinkButton(title: Self.switchLabel(m), identifier: "gate-method-\(m.id)") { model.choose(method: m.id) }
            }
        }
    }

    /// "Use recovery key" stays as the engine words it; a passphrase method reads "Use passphrase instead".
    static func switchLabel(_ a: GateAction) -> String {
        if a.id == "passphrase" { return "Use passphrase instead" }
        return a.label
    }

    @ViewBuilder private var special: some View {
        switch model.kind {
        case .deviceLimit: DeviceLimitBlock(model: model)
        case .migration: if let m = model.gate?.migration { MigrationBlock(summary: m, device: model.device) }
        case .onboarding: OnboardingBlock(step: model.gate?.onboarding?.step ?? "intro")
        case .e2eeLocked, .e2eeWaiting, .e2eeTrust: if let e = model.gate?.e2ee { E2eeBlock(info: e, kind: model.kind) }
        case .e2eeSetup: if let e = model.gate?.e2ee { E2eeSetupBlock(info: e, model: model) }
        case .updateRequired, .offline, .suspended, .setupFailed, .error, .libraryLocked, .emailUnverified:
            Image(systemName: Self.symbol(model.kind))
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Folevi.color.inkMuted)
                .frame(width: 56, height: 56)
                .background(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).fill(Folevi.color.surfaceSunken))
                .accessibilityHidden(true)
        default: EmptyView()
        }
    }

    static func symbol(_ kind: GateKind) -> String {
        switch kind {
        case .updateRequired: "arrow.down.circle"
        case .offline: "wifi.slash"
        case .suspended: "hand.raised"
        case .libraryLocked: "lock"
        case .emailUnverified: "envelope.badge"
        default: "exclamationmark.triangle"
        }
    }

    static func fieldKind(_ k: GateField.Kind) -> LabeledField.Kind {
        switch k {
        case .text: .text
        case .secret: .password
        case .recoveryKey: .recoveryKey
        case .code: .code
        }
    }

    private func binding(_ id: String) -> Binding<String> {
        Binding(get: { model.values[id] ?? "" }, set: { model.values[id] = $0 })
    }
}

private struct DefaultActionIf: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.keyboardShortcut(.defaultAction) } else { content }
    }
}

/// A move's or a migration's progress.
struct ProgressBlock: View {
    let progress: GateProgress
    var body: some View {
        VStack(spacing: 8) {
            if let total = progress.total, total > 0 {
                ProgressView(value: Double(min(progress.done, total)), total: Double(total)).tint(Folevi.color.heading)
                HStack {
                    Text(progress.label)
                    Spacer()
                    Text("\(progress.done.formatted()) of \(total.formatted())").monospacedDigit()
                }
                .foleviFont(.footnote)
                .foregroundStyle(Folevi.color.inkMuted)
            } else {
                ProgressView().controlSize(.regular)
                Text(progress.label).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("gate-progress")
    }
}

/// The other devices, each with Sign out (`signOut:<id>`).
struct DeviceLimitBlock: View {
    @Bindable var model: GateModel

    var body: some View {
        let info = model.gate?.deviceLimit
        VStack(spacing: 0) {
            ForEach(info?.devices ?? [], id: \.id) { d in
                let id = "signOut:\(d.id)"
                let action = model.gate?.actions.first { $0.id == id }
                HStack(spacing: 12) {
                    Image(systemName: Self.symbol(d.label)).foregroundStyle(Folevi.color.inkMuted).frame(width: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.label).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                        Text("Last used \(AgeText.relative(Date(timeIntervalSince1970: d.lastSeenAt / 1000), now: ScreenClock.now()))").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                    }
                    Spacer()
                    if let action {
                        Button(model.pending == id ? "Signing out…" : "Sign out") { Task { await model.act(id) } }
                            .buttonStyle(FoleviButtonStyle(.secondary, size: .medium))
                            .disabled(!model.isEnabled(action))
                            .accessibilityLabel(action.label)
                            .accessibilityIdentifier("gate-action-\(id)")
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                if d.id != info?.devices.last?.id { Divider().padding(.leading, 50) }
            }
        }
        .background(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).fill(Folevi.color.surface))
        .overlay(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).strokeBorder(Folevi.color.line, lineWidth: 0.5))
        if let info, model.gate?.message.isEmpty ?? true {
            Text("Your plan works on \(info.limit) \(info.limit == 1 ? "device" : "devices") at a time. Sign out of one below to use Folevi here.")
                .foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).multilineTextAlignment(.center)
        }
    }

    static func symbol(_ label: String) -> String {
        let l = label.lowercased()
        if l.contains("iphone") || l.contains("android") || l.contains("phone") { return "iphone" }
        if l.contains("ipad") || l.contains("tablet") { return "ipad" }
        if l.contains("mac") || l.contains("laptop") { return "laptopcomputer" }
        return "globe"
    }
}

/// What a move into (or out of) an account takes along, and whether it fits.
struct MigrationBlock: View {
    let summary: MigrationSummary
    let device: ScreenDevice

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            row("doc.text", Self.count(summary.notes, "note", "notes"))
            if summary.folders > 0 { row("folder", Self.count(summary.folders, "folder", "folders")) }
            if summary.tags > 0 { row("tag", Self.count(summary.tags, "tag", "tags")) }
            if summary.files > 0 { row("paperclip", "\(Self.count(summary.files, "file", "files")), \(ByteCountFormatter.string(fromByteCount: Int64(summary.fileBytes), countStyle: .file))") }
            if summary.existingNotes > 0 { row("tray.full", "They go next to the \(Self.count(summary.existingNotes, "note", "notes")) already in this account.") }
            if !summary.fits {
                InlineAlert(text: "There isn't room for these files in this account's storage.", tone: .danger)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).fill(Folevi.color.surface))
        .overlay(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).strokeBorder(Folevi.color.line, lineWidth: 0.5))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("gate-migration")
    }

    private func row(_ symbol: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(Folevi.color.inkMuted).frame(width: 20)
            Text(text).foleviFont(.body).foregroundStyle(Folevi.color.ink).fixedSize(horizontal: false, vertical: true)
        }
    }

    static func count(_ n: Int, _ one: String, _ many: String) -> String { "\(n.formatted()) \(n == 1 ? one : many)" }
}

/// The unlock screen's parts: which space, the shared code while approving from another device.
struct E2eeBlock: View {
    let info: E2eeGateInfo
    let kind: GateKind

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: kind == .e2eeTrust ? "checkmark.shield" : "lock.fill")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(Folevi.color.heading)
                .frame(width: 56, height: 56)
                .background(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).fill(Folevi.color.surfaceSunken))
                .accessibilityHidden(true)
            if let name = info.spaceName {
                Text(name).foleviFont(.footnote).fontWeight(.semibold).foregroundStyle(Folevi.color.inkMuted)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Capsule().fill(Folevi.color.surfaceSunken))
            }
            switch info.approval {
            case "waiting":
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("Open Folevi on a device that's already unlocked and approve this one.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
                }
                .accessibilityIdentifier("gate-approval-waiting")
            case "compare":
                VStack(spacing: 8) {
                    Text("Check that your other device shows the same code, then approve it there.")
                        .foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).multilineTextAlignment(.center)
                    Text(info.approvalCode ?? "")
                        .font(FoleviFonts.font(.mono, size: 34, weight: .semibold))
                        .tracking(4)
                        .foregroundStyle(Folevi.color.heading)
                        .padding(.vertical, 14).padding(.horizontal, 22)
                        .background(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).fill(Folevi.color.surfaceSunken))
                        .accessibilityLabel("Code \(info.approvalCode?.map { String($0) }.joined(separator: " ") ?? "")")
                        .accessibilityIdentifier("gate-approval-code")
                }
            case "failed":
                InlineAlert(text: "The other device didn't approve this one in time. Try again, or use another way.", tone: .info)
            default:
                EmptyView()
            }
        }
    }
}

/// Setting encryption up (revision 8): the ways in added so far, and the recovery key shown once with Copy, Save
/// and Print, then confirmed with two of its groups (the fields `group3` and `group7`).
struct E2eeSetupBlock: View {
    let info: E2eeGateInfo
    @Bindable var model: GateModel

    var body: some View {
        VStack(spacing: 14) {
            if !info.methodsAdded.isEmpty || info.setupStep == "methods" {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(["recoveryKey", "passphrase", "passkey", "device"], id: \.self) { m in
                        let on = info.methodsAdded.contains(m)
                        HStack(spacing: 10) {
                            Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? Folevi.color.success : Folevi.color.inkFaint)
                            Text(Self.methodName(m)).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                        }
                    }
                    Text("Add two ways to unlock, so you can still get in if you lose one.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).fill(Folevi.color.surface))
                .overlay(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).strokeBorder(Folevi.color.line, lineWidth: 0.5))
                .accessibilityIdentifier("gate-e2ee-methods")
            }
            if info.setupStep == "recovery", let key = info.recoveryKey {
                RecoveryKeyCard(key: key, saved: $model.recoveryKeySaved, copy: model.feedback.copy)
            }
        }
    }

    static func methodName(_ m: String) -> String {
        switch m {
        case "recoveryKey": "Recovery key"
        case "passphrase": "Passphrase"
        case "passkey": "Passkey"
        case "device": "Another device"
        default: m
        }
    }
}

/// The recovery key, shown once: groups of four in a mono grid, Copy, Save (share sheet) and Print.
struct RecoveryKeyCard: View {
    let key: String
    @Binding var saved: Bool
    let copy: @MainActor @Sendable (String) -> Void

    private var groups: [String] { key.split(separator: "-").map(String.init) }
    private var text: String { "Folevi recovery key\nKeep it somewhere safe. It's the only way in if you lose your other ways to unlock.\n\n\(key)\n" }

    var body: some View {
        VStack(spacing: 12) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(Array(groups.enumerated()), id: \.offset) { i, g in
                    VStack(spacing: 2) {
                        Text("\(i + 1)").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
                        Text(g).font(FoleviFonts.font(.mono, size: 17, weight: .semibold)).foregroundStyle(Folevi.color.heading)
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(RoundedRectangle(cornerRadius: Folevi.radius.chip, style: .continuous).fill(Folevi.color.surface))
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: Folevi.radius.panel, style: .continuous).fill(Folevi.color.surfaceSunken))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Recovery key: \(groups.joined(separator: ", "))")
            .accessibilityIdentifier("gate-recovery-key")
            HStack(spacing: 8) {
                Button { copy(key); saved = true } label: { Label("Copy", systemImage: "doc.on.doc").frame(maxWidth: .infinity) }
                    .buttonStyle(FoleviButtonStyle(.secondary, size: .medium, fullWidth: true))
                    .accessibilityIdentifier("gate-recovery-copy")
                ShareLink(item: text, subject: Text("Folevi recovery key")) { Label("Save", systemImage: "square.and.arrow.down").frame(maxWidth: .infinity) }
                    .buttonStyle(FoleviButtonStyle(.secondary, size: .medium, fullWidth: true))
                    .simultaneousGesture(TapGesture().onEnded { saved = true })
                Button { RecoveryPrint.print(text); saved = true } label: { Label("Print", systemImage: "printer").frame(maxWidth: .infinity) }
                    .buttonStyle(FoleviButtonStyle(.secondary, size: .medium, fullWidth: true))
            }
            Text("Then type groups 3 and 7 below, to show you have it.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
        }
    }
}

/// Prints plain text with the system's print panel.
@MainActor
enum RecoveryPrint {
    static func print(_ text: String) {
        #if os(iOS)
        let c = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = "Folevi recovery key"
        c.printInfo = info
        c.printFormatter = UISimpleTextPrintFormatter(text: text)
        c.present(animated: true)
        #else
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 480, height: 300))
        view.string = text
        view.font = NSFont.monospacedSystemFont(ofSize: 14, weight: .regular)
        NSPrintOperation(view: view).run()
        #endif
    }
}

/// Onboarding's step: where it is in the six steps, and the step's words (Onboarding.tsx).
struct OnboardingBlock: View {
    let step: String

    static let steps: [(key: String, name: String, title: String, text: String)] = [
        ("workspace", "Welcome", "Welcome to Folevi", "Folevi is a notes app for documents, tasks and linked pages. Let’s set up your Personal space. It takes about a minute."),
        ("uses", "Your pages", "What will you use Folevi for?", "Pick any that fit. Each one adds two starter pages made from Folevi’s templates, next to the pages we already made for you."),
        ("style", "Note theme", "Pick a theme for your first page", "A note theme gives a page its cover, paper and text colours. This one is for “Welcome to Folevi”. New pages start Plain."),
        ("appearance", "Appearance", "Light or dark?", "The app around your notes stays white, or near-black in dark mode, so your notes carry the colour. You can change this in Settings."),
        ("ai", "Foli AI", "Meet Foli AI", "It answers questions from your notes and links the notes it used, so you can check the answer."),
        ("welcome", "Ready", "Your Folevi is ready.", "Here’s what we set up. Your Welcome page has a short tour and a few things to try."),
    ]

    static func index(_ step: String) -> Int {
        let aliases = ["intro": "workspace", "useCases": "uses", "done": "welcome"]
        let key = aliases[step] ?? step
        return steps.firstIndex { $0.key == key } ?? 0
    }

    var body: some View {
        let i = Self.index(step)
        let s = Self.steps[i]
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 6) {
                ForEach(0..<Self.steps.count, id: \.self) { n in
                    Capsule().fill(n <= i ? Folevi.color.ember : Folevi.color.surfaceSunken).frame(height: 4)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Step \(i + 1) of \(Self.steps.count): \(s.name)")
            Text("\(i + 1) of \(Self.steps.count) · \(s.name)").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
            Text(s.title).font(FoleviFonts.font(.display, size: PreApp.titleSize, weight: .semibold, relativeTo: .largeTitle)).foregroundStyle(Folevi.color.heading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(s.text).foleviFont(.body).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
            if i == 0 {
                VStack(alignment: .leading, spacing: 14) {
                    fact("wifi.slash", "Works offline", "Your writing is saved on this device first, and syncs when you reconnect.")
                    fact("link", "Pages that link up", "Type [[ to link one page to another. The page you link to shows a backlink.")
                    fact("person.2", "Yours, and easy to share", "Personal is your own space. Share single pages with anyone, or start a workspace for a team any time.")
                }
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("gate-onboarding-\(s.key)")
    }

    private func fact(_ symbol: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).foregroundStyle(Folevi.color.heading).frame(width: 32, height: 32)
                .background(RoundedRectangle(cornerRadius: Folevi.radius.small, style: .continuous).fill(Folevi.color.surfaceSunken))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.ink)
                Text(body).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

#if os(iOS)
import UIKit
#else
import AppKit
#endif
