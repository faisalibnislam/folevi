// /vault on the Mac (apps/web/src/components/vault/VaultView.tsx, VaultGate.tsx), drawn natively from the live web's
// styles (packages/design-tokens/match/app-styles/vault.json): the Vault in the other theme (.ui-invert), the header
// row (open on this device, Lock, the ⋯ menu), the two tabs and the ⋯ section as a third, and the front door
// (set up, unlock, a forgotten passcode, choosing a passcode) until it's open. The engine does the rest.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The Vault's own styles, read inside .ui-invert: already the other theme's, so the screen (drawn with its scheme
/// flipped for the shared components) takes them flipped back.
@MainActor
enum VS {
    static func pair(_ id: String) -> WebStylePair {
        let p = WebStyles.named(id)
        return WebStylePair(light: p.dark, dark: p.light)
    }

    static func style(_ id: String, _ scheme: ColorScheme) -> WebComputedStyle { pair(id).resolve(scheme) }

    /// A CSS colour variable as the inverted Vault sees it (.ui-invert sets the other theme's variables, and the
    /// scheme here is already flipped).
    static func color(_ name: String, _ scheme: ColorScheme) -> Color {
        (WebStyles.vars["color-\(name)"] ?? WebStyles.vars[name])?.resolve(scheme).color ?? .clear
    }
}

extension EnvironmentValues {
    /// This Mac's Touch ID, for the passcode card's offer after unlocking encryption here.
    @Entry var vaultTouchId: TouchIdHook? = nil
}

struct VaultScreen: View {
    @State private var model: VaultModel
    let path: String
    let touchId: TouchIdHook?

    init(frame: FrameModel, path: String) {
        self.path = path
        touchId = frame.touchId
        _model = State(initialValue: VaultModel(client: frame.client, feedback: ScreenFeedback(toast: { [weak frame] t in
            frame?.toast(t.message, tone: t.tone == .error ? .error : t.tone == .success ? .success : .info)
        }), section: VaultSection(path: path)))
    }

    var body: some View {
        VaultBody(model: model)
            .uiInvert()
            .onChange(of: model.summary.value) { _, _ in model.summaryChanged() }
            // A link to /vault/<section> on the open tab: that section (the Vault stays one tab).
            .onChange(of: path) { _, p in model.section = VaultSection(path: p) ?? .files }
            #if DEBUG
            // screens.mjs: the first password opened, the Add dialog, or neither.
            .onReceive(NotificationCenter.default.publisher(for: .init("folevi.vault.passwords"))) { n in
                model.dialog = nil
                switch n.object as? String {
                case "first":
                    model.selected = model.vaultId.flatMap { id in (model.store("passwords") { .vaultItems(vaultId: id, section: .passwords) }).value?.items.first?.id }
                case "add": model.dialog = .addItem
                default: model.selected = nil
                }
            }
            #endif
            .environment(\.vaultTouchId, touchId)
            .accessibilityIdentifier("screen.vault")
    }
}

/// Everything inside .ui-invert (the scheme here is the Vault's, the other theme).
private struct VaultBody: View {
    @Bindable var model: VaultModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let view = VS.style("vault.view", scheme)
        let content = VS.style("vault.content", scheme)
        ZStack(alignment: .top) {
            // The Vault's canvas reaches up under the glass bar, as the web's .ui-invert view does.
            view.background.color
                .padding(.top, -ContentViewController.barHeight)
                .allowsHitTesting(false)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    VaultHeader(model: model)
                    VStack(alignment: .leading, spacing: 0) {
                        main
                    }
                    .frame(maxWidth: 1180 - content.padding.left - content.padding.right, alignment: .topLeading)
                    .padding(content.padding.edgeInsets)
                    .frame(maxWidth: .infinity)
                }
            }
            .scrollIndicators(.automatic)
            if let dialog = model.dialog {
                VaultDialogHost(model: model, dialog: dialog)
            }
        }
        .foregroundStyle(view.color.color)
    }

    @ViewBuilder private var main: some View {
        if let v = model.value {
            if let key = v.recoveryToSave, let id = v.vaultId {
                RecoveryKeyCard(model: model, vaultId: id, key: key)
            } else if v.state == .open {
                VaultTabs(model: model)
                VaultSectionView(model: model)
            } else if v.state != .none {
                VaultGateView(model: model, summary: v)
            } else {
                VaultEmpty(icon: .lock, title: "No Vault here", message: "This workspace's Vault is only for the people its owner or custodians add.")
            }
        }
    }
}

// MARK: header

private struct VaultHeader: View {
    @Bindable var model: VaultModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let header = VS.style("vault.header", scheme)
        let sub = VS.style("vault.header.subtitle", scheme)
        HStack(spacing: header.gap) {
            Text(subtitle).webText(sub.text).lineLimit(1).foregroundStyle(sub.color.color)
            Spacer(minLength: 0)
            if model.isOpen {
                HStack(spacing: VS.style("vault.header.actions", scheme).gap) {
                    WebButton("Lock", icon: .lock, variant: .primary, size: .sm) { model.lock() }
                        .foleviTooltip("Lock the Vault")
                    WebMenuButton(width: 200, entries: { menu }) {
                        let more = VS.style("vault.header.more", scheme)
                        WebIconView(.ellipsis, size: 15)
                            .frame(width: more.width, height: more.height)
                            .webBox(VS.pair("vault.header.more"))
                            .contentShape(Rectangle())
                    }
                    .foleviTooltip("More in the Vault")
                    .accessibilityLabel("More in the Vault")
                }
            }
        }
        .padding(header.padding.edgeInsets)
        .frame(height: header.height)
        .padding(header.margin.edgeInsets)
    }

    private var subtitle: String {
        guard let v = model.value, v.state == .open else { return "Locked" }
        let m = v.autoLockMinutes
        return "Open on this device · locks after \(m) idle \(m == 1 ? "minute" : "minutes")"
    }

    private var menu: [WebMenuEntry] {
        (model.value?.moreSections ?? []).flatMap { s -> [WebMenuEntry] in
            (s == .settings ? [.separator()] : []) + [WebMenuEntry(.item(s.label, icon: s.icon, checked: model.section == s)) { model.open(s) }]
        }
    }
}

// MARK: tabs

private struct VaultTabs: View {
    @Bindable var model: VaultModel
    @Environment(\.colorScheme) private var scheme
    @State private var hovered: VaultSection?

    var body: some View {
        let tabs = VS.style("vault.tabs", scheme)
        HStack(alignment: .bottom, spacing: tabs.gap) {
            tab(.files)
            tab(.passwords)
            if let s = model.fromMenu { menuTab(s) }
            Spacer(minLength: 0)
        }
        .frame(minHeight: tabs.height, alignment: .bottom)
        .background(alignment: .bottom) {
            Rectangle().fill(VS.color("line", scheme)).frame(height: 1)
        }
        .padding(.bottom, tabs.margin.bottom)
    }

    private func tab(_ s: VaultSection) -> some View {
        let on = model.section == s
        let st = VS.style(on ? "vault.tab.active" : "vault.tab", scheme)
        let active = VS.style("vault.tab.active", scheme)
        return Button { model.open(s) } label: {
            HStack(spacing: st.gap) {
                WebIconView(s.icon, size: 14)
                Text(s.label).webText(st.text).lineLimit(1).fixedSize()
            }
            .foregroundStyle(on || hovered == s ? active.color.color : st.color.color)
            .padding(st.padding.edgeInsets)
            // border-b-2 below the padding (transparent when not chosen).
            .padding(.bottom, 2)
            .overlay(alignment: .bottom) {
                Rectangle().fill(on ? active.color.color : .clear).frame(height: 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 ? s : (hovered == s ? nil : hovered) }
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func menuTab(_ s: VaultSection) -> some View {
        let st = VS.style("vault.tab.menu", scheme)
        let close = VS.style("vault.tab.menu.close", scheme)
        return HStack(spacing: st.gap) {
            HStack(spacing: st.gap) {
                WebIconView(s.icon, size: 14)
                Text(s.label).webText(st.text).lineLimit(1).fixedSize()
            }
            Button { model.open(.files) } label: {
                WebIconView(.x, size: 12)
                    .frame(width: close.width, height: close.height)
                    .foregroundStyle(close.color.color)
                    .contentShape(Rectangle())
            }
            .buttonStyle(WebHoverRowStyle(radius: close.radius, hover: WebStyles.vars["glass-hover"], press: nil, selected: false))
            .foleviTooltip("Close")
            .accessibilityLabel("Close \(s.label)")
        }
        .foregroundStyle(st.color.color)
        .padding(st.padding.edgeInsets)
        .padding(.bottom, 2)
        .overlay(alignment: .bottom) { Rectangle().fill(st.color.color).frame(height: 2) }
    }
}

// MARK: empty states (components/ui/EmptyState.tsx)

struct VaultEmpty: View {
    let icon: WebIcon
    let title: String
    var message: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let muted = VS.style("vault.header.subtitle", scheme)
        let heading = VS.style("vault.gate.title", scheme)
        VStack(spacing: 8) {
            WebIconView(icon, size: 22).foregroundStyle(muted.color.color).padding(.bottom, 4)
            Text(title).webText(VS.style("vault.files.title", scheme).text).foregroundStyle(heading.color.color)
            if let message {
                Text(message).webText(muted.text).foregroundStyle(muted.color.color).multilineTextAlignment(.center).frame(maxWidth: 420)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }
}

// MARK: the front door (VaultGate.tsx)

private struct GateCard<Content: View>: View {
    let icon: WebIcon
    let title: String
    @ViewBuilder let content: Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let card = VS.style("vault.gate.card", scheme)
        let iconBox = VS.style("vault.gate.icon", scheme)
        let t = VS.style("vault.gate.title", scheme)
        let b = VS.style("vault.gate.body", scheme)
        VStack(alignment: .leading, spacing: 0) {
            WebIconView(icon, size: 20)
                .foregroundStyle(iconBox.color.color)
                .frame(width: iconBox.width, height: iconBox.height)
                .background(RoundedRectangle(cornerRadius: iconBox.radius).fill(iconBox.background.color))
                .padding(.bottom, iconBox.margin.bottom)
            Text(title).webText(t.text).foregroundStyle(t.color.color)
            VStack(alignment: .leading, spacing: 16) { content }
                .foregroundStyle(b.color.color)
                .padding(.top, b.margin.top)
        }
        .padding(card.padding.edgeInsets)
        .frame(width: card.width, alignment: .leading)
        .webBox(VS.pair("vault.gate.card"))
        .padding(.top, card.margin.top)
        .frame(maxWidth: .infinity)
    }
}

/// A paragraph of the front door's text (13/18, muted).
struct GateText: View {
    let text: String
    init(_ text: String) { self.text = text }
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let b = VS.style("vault.gate.body", scheme)
        Text(text).webText(b.text).foregroundStyle(b.color.color).fixedSize(horizontal: false, vertical: true)
    }
}

/// A passcode field drawn as dots (VaultGate's PasscodeField: a text field, never offered to a password manager).
struct PasscodeInput: View {
    let label: String
    @Binding var value: String
    var digits: Int?
    var autoFocus = false
    var onSubmit: () -> Void = {}
    @Environment(\.colorScheme) private var scheme
    @FocusState private var focused: Bool

    var body: some View {
        let l = VS.style("vault.gate.label", scheme)
        let input = VS.style("vault.gate.input", scheme)
        VStack(alignment: .leading, spacing: l.margin.bottom) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).webText(l.text).lineLimit(1).foregroundStyle(l.color.color)
                Spacer(minLength: l.gap)
                if let digits {
                    Text("\(value.count) of \(digits)").webText(WebTextStyle(size: l.fontSize, leading: l.lineHeight ?? 16, weight: 400)).foregroundStyle(VS.style("vault.row.time", scheme).color.color)
                }
            }
            SecureField("", text: Binding(get: { value }, set: { v in
                let clean = digits == nil ? v : String(v.filter(\.isNumber).prefix(digits!))
                value = clean
            }))
            .textFieldStyle(.plain)
            .textContentType(.oneTimeCode)
            .webText(input.text)
            .focused($focused)
            .onSubmit(onSubmit)
            .padding(input.padding.edgeInsets)
            .frame(height: input.height)
            .foregroundStyle(input.color.color)
            .webBox(VS.pair("vault.gate.input"))
        }
        .onAppear { if autoFocus { focused = true } }
    }
}

/// Choosing a passcode (PasscodeFields.tsx NewPasscode): the length, the PIN, and the PIN again.
struct NewPasscodeFields: View {
    var label = "Choose a passcode"
    var lengths: [Int] = [6, 8, 12]
    @Binding var pin: String?
    var autoFocus = false
    @State private var digits = 6
    @State private var first = ""
    @State private var again = ""
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let l = VS.style("vault.gate.label", scheme)
        let seg = VS.style("vault.files.seg", scheme)
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: l.margin.bottom) {
                Text("Passcode length").webText(l.text).lineLimit(1).foregroundStyle(l.color.color)
                HStack(spacing: 4) {
                    ForEach(lengths, id: \.self) { d in
                        let on = d == digits
                        Button {
                            digits = d
                            first = String(first.prefix(d))
                            again = String(again.prefix(d))
                            report()
                        } label: {
                            Text("\(d) digits").webText(WebTextStyle(size: 12, leading: 16, weight: 500))
                                .foregroundStyle(on ? VS.style("vault.files.seg.on", scheme).color.color : VS.style("vault.files.seg.off", scheme).color.color)
                                .frame(maxWidth: .infinity, minHeight: 32)
                                .background(RoundedRectangle(cornerRadius: 6).fill(on ? VS.style("vault.gate.card", scheme).background.color : .clear))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(4)
                .background(RoundedRectangle(cornerRadius: seg.radius).fill(seg.background.color))
            }
            PasscodeInput(label: label, value: Binding(get: { first }, set: { first = $0; report() }), digits: digits, autoFocus: autoFocus)
            PasscodeInput(label: "Type it again", value: Binding(get: { again }, set: { again = $0; report() }), digits: digits)
            if again.count == digits && again != first {
                Text("The two don't match.").webText(VS.style("vault.health.body", scheme).text).foregroundStyle(VS.color("warning", scheme))
            }
        }
        .onAppear { pin = nil }
    }

    private func report() { pin = first.count == digits && first == again ? first : nil }
}

private struct VaultGateView: View {
    @Bindable var model: VaultModel
    let summary: VaultSummaryValue
    @State private var passcode = ""
    @State private var next: String?
    @State private var recovery = ""
    @State private var old: String?
    @State private var mode = "passcode"
    @State private var busy = false
    @State private var error: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        switch summary.state {
        case .encryptionLocked:
            // This Mac unlocks encryption in this same card, then goes straight on to the passcode (VaultGate.tsx).
            let device = model.e2ee.value?.device ?? "this Mac"
            GateCard(icon: .lock, title: "Unlock the Vault on \(device)") {
                GateText("Your Vault is end-to-end encrypted. \(device.prefix(1).uppercased())\(device.dropFirst()) needs your account's encryption keys once, then your Vault passcode.")
                EncryptionStep(model: model)
            }
        case .setUp:
            GateCard(icon: .shieldCheck, title: summary.personal ? "Set up your Vault" : "Set up your team's Vault") {
                GateText(summary.local ? "A place for passwords, API keys and sensitive files. It's encrypted on this device with your own passcode, and opens only with it." : "A place for passwords, API keys and sensitive files. It's always end-to-end encrypted, opens with your own passcode, and keeps a record of everything done in it.")
                VStack(alignment: .leading, spacing: 12) {
                    NewPasscodeFields(lengths: summary.passcodeLengths, pin: $next, autoFocus: true)
                    errorLine
                    WebButton(busy ? "Setting up…" : "Set up the Vault", variant: .primary) { setUp() }
                        .disabled(busy || next == nil)
                }
            }
        case .waitingForKey:
            GateCard(icon: .keyRound, title: "Waiting for the Vault's key") {
                GateText("You were added to this Vault. Its key reaches you when a custodian next opens the Vault on one of their devices. Nothing to do here until then.")
            }
        case .needsPasscode:
            GateCard(icon: .keyRound, title: "Choose your Vault passcode") {
                GateText("A custodian shared the Vault's key with you. Choose the passcode you'll open it with. Nobody else knows it, Folevi included.")
                VStack(alignment: .leading, spacing: 12) {
                    NewPasscodeFields(lengths: summary.passcodeLengths, pin: $next, autoFocus: true)
                    errorLine
                    WebButton(busy ? "Opening…" : "Set passcode and open", variant: .primary) {
                        guard let next, let id = summary.vaultId else { return }
                        go { try await model.client.command(.vaultFinishPasscode(vaultId: id, passcode: next)) }
                    }
                    .disabled(busy || next == nil)
                }
            }
        default:
            if let old {
                GateCard(icon: .keyRound, title: "Choose a new passcode") {
                    GateText("Vault passcodes are now a PIN of 6, 8 or 12 digits. Choose yours to open the Vault; your old passcode stops working.")
                    VStack(alignment: .leading, spacing: 12) {
                        NewPasscodeFields(label: "New passcode", lengths: summary.passcodeLengths, pin: $next, autoFocus: true)
                        errorLine
                        HStack(spacing: 8) {
                            WebButton(busy ? "Opening…" : "Save passcode and open", variant: .primary) {
                                guard let next, let id = summary.vaultId else { return }
                                go {
                                    let r = try await model.client.command(.vaultChangePasscode(vaultId: id, current: old, next: next))
                                    if r.status != "ok" { self.old = nil }
                                    return r
                                }
                            }
                            .disabled(busy || next == nil)
                            WebButton("Back", variant: .quiet) { self.old = nil; error = nil }
                        }
                    }
                }
            } else {
                locked
            }
        }
    }

    private var locked: some View {
        let actions = VS.style("vault.gate.actions", scheme)
        return GateCard(icon: .lock, title: "The Vault is locked") {
            if model.encryptionUnlockedHere { TouchIdOffer(model: model) }
            VStack(alignment: .leading, spacing: 12) {
                if mode == "passcode" {
                    PasscodeInput(label: "Passcode", value: $passcode, autoFocus: true) { unlock() }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Vault recovery key").webText(VS.style("vault.gate.label", scheme).text).foregroundStyle(VS.style("vault.gate.label", scheme).color.color)
                        TextField("", text: $recovery)
                            .textFieldStyle(.plain)
                            .font(.system(size: 14, design: .monospaced))
                            .padding(VS.style("vault.gate.input", scheme).padding.edgeInsets)
                            .frame(height: 40)
                            .webBox(VS.pair("vault.gate.input"))
                    }
                    NewPasscodeFields(label: "New passcode", lengths: summary.passcodeLengths, pin: $next)
                }
                errorLine
                HStack(spacing: actions.gap) {
                    WebButton(busy ? "Unlocking…" : mode == "passcode" ? "Unlock" : "Reset passcode and open", variant: .primary) { unlock() }
                        .disabled(busy || (mode == "passcode" ? passcode.isEmpty : recovery.isEmpty || next == nil))
                    WebButton(mode == "passcode" ? "Forgot your passcode?" : "Use the passcode", variant: .quiet) {
                        mode = mode == "passcode" ? "recovery" : "passcode"
                        error = nil
                    }
                }
                if mode == "recovery" && !summary.personal {
                    HStack(spacing: 4) {
                        GateText("No recovery key?")
                        Button("Ask a custodian") {
                            guard let id = summary.vaultId else { return }
                            model.run {
                                _ = try await model.client.command(.vaultRequestReset(vaultId: id))
                                model.toast("Asked. A custodian's device shares the key with you again when they next open the Vault.", tone: .success)
                            }
                        }
                        .buttonStyle(.plain)
                        .underline()
                        .webText(VS.style("vault.health.body", scheme).text)
                    }
                }
            }
        }
    }

    @ViewBuilder private var errorLine: some View {
        if let error {
            Text(error).webText(VS.style("vault.health.body", scheme).text).foregroundStyle(VS.color("danger", scheme))
        }
    }

    private func unlock() {
        guard let id = summary.vaultId else { return }
        if mode == "passcode" {
            guard !passcode.isEmpty else { return }
            let p = passcode
            go {
                let r = try await model.client.command(.vaultUnlock(vaultId: id, passcode: p))
                if r.status == "oldPasscode" {
                    self.old = p
                    self.passcode = ""
                    self.next = nil
                }
                return r
            }
        } else {
            guard let next, !recovery.isEmpty else { return }
            let key = recovery
            go { try await model.client.command(.vaultReset(vaultId: id, recoveryKey: key, passcode: next)) }
        }
    }

    private func setUp() {
        guard let next else { return }
        busy = true
        error = nil
        Task { @MainActor in
            do { _ = try await model.client.command(.vaultSetUp(passcode: next)) } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }

    private func go(_ work: @escaping @MainActor () async throws -> VaultUnlockResult) {
        busy = true
        error = nil
        Task { @MainActor in
            do {
                let r = try await work()
                if r.status != "ok" && r.status != "oldPasscode" { error = r.message }
            } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }
}

/// The ways to unlock this Mac's encryption, in the Vault's card (VaultEncryptionStep.tsx): approve from another
/// device first, the passphrase, the recovery key (no passkeys in the app: they're used from the browser). The Mac
/// keeps the key once unlocked (it can be removed in Settings > Devices); the Vault then asks for its passcode.
private struct EncryptionStep: View {
    @Bindable var model: VaultModel
    @State private var step = "choose"
    @State private var secret = ""
    @State private var busy = false
    @State private var error: String?
    @Environment(\.colorScheme) private var scheme

    private var value: E2eeStateValue? { model.e2ee.value }

    var body: some View {
        Group {
            switch step {
            case "passphrase", "recovery": secretForm
            case "approve": approving
            default: choices
            }
        }
        #if DEBUG
        // Scripts drive the step (screens.mjs --vault-unlock, through `frame {do:"post"}`): a way, a secret, Unlock.
        .onReceive(NotificationCenter.default.publisher(for: .init("folevi.vault.unlock"))) { n in
            switch n.object as? String {
            case "approve"?: approve()
            case "submit"?: unlock()
            case "choose"?: back()
            case let way? where way == "passphrase" || way == "recovery": start(way)
            case let text? where text.hasPrefix("secret:"): secret = String(text.dropFirst(7))
            default: break
            }
        }
        #endif
    }

    private var choices: some View {
        VStack(alignment: .leading, spacing: 8) {
            WideButton("Approve from another device", icon: .smartphone, primary: true) { approve() }
            WideButton("Enter passphrase", icon: .lockKeyhole) { start("passphrase") }
            WideButton("Enter recovery key", icon: .scrollText) { start("recovery") }
            GateText("To use your passkey, open Folevi in your browser and approve \(value?.device ?? "this Mac") from there.").padding(.top, 4)
        }
    }

    private var secretForm: some View {
        let l = VS.style("vault.gate.label", scheme)
        let input = VS.style("vault.gate.input", scheme)
        let recovery = step == "recovery"
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: l.margin.bottom) {
                Text(recovery ? "Recovery key" : "Encryption passphrase").webText(l.text).foregroundStyle(l.color.color)
                Group {
                    if recovery {
                        TextField("XXXX-XXXX-XXXX-…", text: $secret).font(.system(size: input.fontSize, design: .monospaced))
                    } else {
                        SecureField("", text: $secret).webText(input.text)
                    }
                }
                .textFieldStyle(.plain)
                .onSubmit { unlock() }
                .padding(input.padding.edgeInsets)
                .frame(height: input.height)
                .foregroundStyle(input.color.color)
                .webBox(VS.pair("vault.gate.input"))
                .onChange(of: secret) { error = nil }
            }
            if let error { ErrorLine(text: error) }
            HStack {
                WebButton("Other ways to unlock", icon: .arrowLeft, iconSize: 14, variant: .quiet) { back() }
                Spacer(minLength: 8)
                WebButton(busy ? "Unlocking…" : "Unlock", variant: .primary) { unlock() }
                    .disabled(busy || secret.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private var approving: some View {
        let t = VS.style("vault.gate.label", scheme)
        return VStack(alignment: .leading, spacing: 12) {
            Text("Waiting for approval").webText(t.text).foregroundStyle(VS.style("vault.gate.title", scheme).color.color)
            switch value?.approval {
            case .failed?: ErrorLine(text: "Approval didn't finish. Try again, or use another way to unlock.")
            case .compare?:
                GateText("Check that your other device shows this code:")
                Text(value?.approvalCode ?? "")
                    .font(.system(size: 22, weight: .semibold, design: .monospaced))
                    .foregroundStyle(VS.style("vault.gate.title", scheme).color.color)
                    .textSelection(.enabled)
            default: GateText("Open Folevi on a device you've already unlocked. It will ask you to approve this one.")
            }
            HStack {
                WebButton("Other ways to unlock", icon: .arrowLeft, iconSize: 14, variant: .quiet) { back() }
                Spacer(minLength: 8)
                if value?.approval == .failed { WebButton("Approve from another device", variant: .primary) { approve() } }
            }
        }
    }

    private func start(_ s: String) {
        model.encryptionUnlockedHere = true
        secret = ""
        error = nil
        step = s
    }

    private func approve() {
        start("approve")
        model.run { _ = try await model.client.command(.e2eeApprovalStart) }
    }

    private func back() {
        if step == "approve" { model.run { _ = try await model.client.command(.e2eeApprovalCancel) } }
        error = nil
        step = "choose"
    }

    private func unlock() {
        let value = secret.trimmingCharacters(in: .whitespaces)
        guard !busy, !value.isEmpty else { return }
        busy = true
        error = nil
        let method: E2eeUnlockMethod = step == "recovery" ? .recovery : .passphrase
        Task { @MainActor in
            do {
                let r = try await model.client.command(.e2eeUnlock(method: method, secret: secret))
                if r.status != .ok { error = r.message ?? "That didn't unlock this Mac. Check it and try again." }
            } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }
}

/// UnlockScreen's full-width choice: 44 tall, the icon before the words, primary or secondary.
private struct WideButton: View {
    let title: String
    let icon: WebIcon
    var primary = false
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    init(_ title: String, icon: WebIcon, primary: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.primary = primary
        self.action = action
    }

    var body: some View {
        let pair = WebStyles.named(primary ? "button.primary.md" : "button.secondary.md")
        let s = pair.resolve(scheme)
        Button(action: action) {
            HStack(spacing: s.gap) {
                WebIconView(icon, size: 15)
                Text(title).webText(s.text)
            }
            .foregroundStyle(s.color.color)
            .frame(maxWidth: .infinity, minHeight: 44)
            .webBox(pair)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct ErrorLine: View {
    let text: String
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        Text(text).webText(VS.style("vault.gate.body", scheme).text).foregroundStyle(VS.color("danger", scheme)).fixedSize(horizontal: false, vertical: true)
    }
}

/// Right after this Mac unlocked encryption: Touch ID next time instead of the passphrase (VaultTouchIdOffer).
private struct TouchIdOffer: View {
    @Bindable var model: VaultModel
    /// Answered here: turned on, or "Not now".
    @State private var answered = false
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.vaultTouchId) private var touchId

    /// Shown while this Mac has Touch ID and it isn't on yet.
    private var shown: Bool {
        guard !answered, let s = touchId?.status() else { return false }
        return s.available && !s.on
    }

    var body: some View {
        Group {
            if shown {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Use Touch ID next time?").webText(VS.style("vault.gate.label", scheme).text).foregroundStyle(VS.style("vault.gate.title", scheme).color.color)
                    GateText("This Mac asks for Touch ID instead of your passphrase before it opens your encrypted notes and your Vault's keys. You can change this in Settings.")
                    HStack(spacing: 8) {
                        WebButton("Use Touch ID", variant: .primary, size: .sm) {
                            guard let hook = touchId, !busy else { return }
                            busy = true
                            Task { @MainActor in
                                if let on = try? await hook.turnOn() { answered = on }
                                busy = false
                            }
                        }
                        .disabled(busy)
                        WebButton("Not now", variant: .quiet, size: .sm) { answered = true }
                    }
                    .padding(.top, 10)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: VS.style("vault.gate.input", scheme).radius, style: .continuous).fill(VS.color("sunken", scheme)))
            }
        }
    }
}

/// The recovery key, once, right after setting up or making a new one (RecoveryKeyPanel's words), until saved.
private struct RecoveryKeyCard: View {
    @Bindable var model: VaultModel
    let vaultId: String
    let key: String
    @State private var check = ""
    @State private var copied = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GateCard(icon: .keyRound, title: "Save your Vault recovery key") {
            GateText("If you forget your passcode, this key opens the Vault. Folevi can't. Keep it somewhere safe, away from this device.")
            Text(key)
                .font(.system(size: 15, weight: .medium, design: .monospaced))
                .foregroundStyle(VS.style("vault.gate.title", scheme).color.color)
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .webBox(VS.pair("vault.gate.input"))
            HStack(spacing: 8) {
                WebButton(copied ? "Copied" : "Copy", icon: .copy) {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(key, forType: .string)
                    copied = true
                }
                WebButton("Save as a file…", icon: .download) { save() }
            }
            WebButton("I've saved it", variant: .primary) {
                model.run { _ = try await model.client.command(.vaultRecoverySaved(vaultId: vaultId)) }
            }
        }
    }

    private func save() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "Folevi Vault recovery key.txt"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? "Folevi Vault recovery key\n\n\(key)\n\nIf you forget your Vault passcode, this key opens the Vault. Keep it somewhere safe.\n".write(to: url, atomically: true, encoding: .utf8)
    }
}
#endif
