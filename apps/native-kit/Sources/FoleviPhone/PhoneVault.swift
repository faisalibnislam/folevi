// /vault on the iPhone (docs/IOS_REBUILD_PLAN.md, I6): the web draws its Vault (components/vault/VaultView.tsx) in
// the phone's general screen, not inverted: the large title, a row under it with "Locked" or "Open on this device"
// and, once open, Lock and ⋯; then the front door (VaultGate.tsx) or the two tabs and the section. Drawn natively
// from the web's measured phone styles (packages/design-tokens/match/app-styles/phone.json, phone.vault.*) on the
// kit's shared VaultModel. iOS's own: sheets for the dialogs, Face ID to unlock, Files and Photos to upload, Quick
// Look, PDFKit and AVKit to preview.
#if os(iOS)
import LocalAuthentication
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The phone Vault's measured styles (`phone.vault.<id>`) and the web's colour variables.
@MainActor
enum PV {
    static func pair(_ id: String) -> WebStylePair { WebStyles.named("phone.vault.\(id)") }
    static func style(_ id: String, _ scheme: ColorScheme) -> WebComputedStyle { pair(id).resolve(scheme) }
    static func color(_ name: String, _ scheme: ColorScheme) -> Color {
        (WebStyles.vars["color-\(name)"] ?? WebStyles.vars[name])?.resolve(scheme).color ?? .clear
    }
    /// Debug hooks (screen-match.mjs): no field takes the keyboard.
    static let noKeyboard = ProcessInfo.processInfo.environment["FOLEVI_GATE_NO_KEYBOARD"] == "1"
}

extension EnvironmentValues {
    /// The width the Vault's sections are laid out in (the screen less the content's padding): what paragraphs
    /// break for (WebPrettyText needs it before it's drawn).
    @Entry var phoneVaultWidth: CGFloat = 370
}

/// What the phone's Vault keeps beside the model: the Face ID offer after a passcode unlock.
@MainActor
@Observable
final class PhoneVaultState {
    /// Just unlocked with the passcode on a device with Face ID that isn't on for this Vault: ask once.
    var faceIdOffer: (vaultId: String, passcode: String)?
}

public struct PhoneVaultScreen: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus
    let back: () -> Void
    @State private var state = PhoneVaultState()
    @State private var moreFrame: CGRect = .zero
    @State private var width: CGFloat = 370
    @Environment(\.colorScheme) private var scheme

    public init(model: VaultModel, menus: PhoneMenus, back: @escaping () -> Void) {
        self.model = model
        self.menus = menus
        self.back = back
    }

    public var body: some View {
        PhoneScreen(PhoneScreenOptions(title: "Vault"), root: false, back: back) {
            EmptyView()
        } trailing: {
            EmptyView()
        } header: {
            header
        } content: {
            let content = PV.style("content", scheme)
            VStack(alignment: .leading, spacing: 0) {
                main
            }
            .environment(\.phoneVaultWidth, width)
            .padding(content.padding.edgeInsets)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width - content.padding.left - content.padding.right } action: { width = $0 }
        }
        .onChange(of: model.summary.value) { _, _ in model.summaryChanged() }
        .phoneVaultDialogs(model: model, state: state, menus: menus)
        .alert(faceIdTitle, isPresented: Binding(get: { state.faceIdOffer != nil }, set: { if !$0 { state.faceIdOffer = nil } })) {
            Button("Use \(VaultBiometrics.name)") {
                guard let offer = state.faceIdOffer else { return }
                state.faceIdOffer = nil
                Task { @MainActor in
                    if await VaultBiometrics.turnOn(vaultId: offer.vaultId, passcode: offer.passcode) {
                        model.toast("\(VaultBiometrics.name) opens the Vault on this \(VaultBiometrics.device) now.", tone: .success)
                    }
                }
            }
            Button("Not now", role: .cancel) {
                if let id = state.faceIdOffer?.vaultId { VaultBiometrics.decline(vaultId: id) }
                state.faceIdOffer = nil
            }
        } message: {
            Text("This \(VaultBiometrics.device) asks for \(VaultBiometrics.name) instead of your passcode to open the Vault. You can turn it off in the Vault's Settings.")
        }
        .accessibilityIdentifier("screen.vault")
    }

    private var faceIdTitle: String { "Open the Vault with \(VaultBiometrics.name)?" }

    // MARK: header (ViewChrome's row under the large title: the subtitle, then Lock and ⋯, wrapping)

    private var header: some View {
        let open = model.isOpen
        let h = PV.style(open ? "header.open" : "header", scheme)
        let sub = PV.style("header.subtitle", scheme)
        return PhoneVaultFlow(gap: h.gap, rowGap: h.gap, pushAfterFirst: true) {
            // (WebKit sets 17 pt text in its 22 pt line 2 px higher than Core Text does; measured, both themes.)
            Text(subtitle).webText(sub.text).lineLimit(1).foregroundStyle(sub.color.color)
                .offset(y: -2.0 / 3)
                .accessibilityAddTraits(.updatesFrequently)
            if open {
                HStack(spacing: PV.style("header.actions", scheme).gap) {
                    WebButton("Lock", icon: .lock, iconSize: 13, styleName: "phone.vault.header.lock", variant: .primary) { model.lock() }
                    let more = PV.style("header.more", scheme)
                    Button { showMore() } label: {
                        WebIconView(.ellipsis, size: 15)
                            .foregroundStyle(more.color.color)
                            .frame(width: more.width, height: more.height)
                            .webBox(PV.pair("header.more"))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("More in the Vault")
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
                }
            }
        }
        .padding(h.padding.edgeInsets)
    }

    private var subtitle: String {
        guard let v = model.value, v.state == .open else { return "Locked" }
        let m = v.autoLockMinutes
        return "Open on this device · locks after \(m) idle \(m == 1 ? "minute" : "minutes")"
    }

    private func showMore() {
        let entries = (model.value?.moreSections ?? []).flatMap { s -> [PhoneMenuEntry] in
            (s == .settings ? [PhoneMenuEntry(.separator())] : []) + [PhoneMenuEntry(.item(s.label, icon: s.icon, checked: model.section == s)) { model.open(s) }]
        }
        menus.show(entries, from: moreFrame, side: .bottom, align: .end, minWidth: 200)
    }

    // MARK: the body

    @ViewBuilder private var main: some View {
        if let v = model.value {
            if let key = v.recoveryToSave, let id = v.vaultId {
                PhoneVaultRecoveryCard(model: model, vaultId: id, key: key)
            } else if v.state == .open {
                notices(v)
                PhoneVaultTabs(model: model)
                PhoneVaultSectionView(model: model, menus: menus)
            } else if v.state != .none {
                PhoneVaultGate(model: model, state: state, summary: v)
            } else {
                PhoneVaultEmpty(icon: .lock, title: "No Vault here", message: "This workspace's Vault is only for the people its owner or custodians add.")
            }
        }
    }

    /// The recovery key that went out of date, and the 90-day access review (VaultView.tsx's two notices).
    @ViewBuilder private func notices(_ v: VaultSummaryValue) -> some View {
        let text = PV.style("health.lead", scheme)
        if v.recoveryOutdated {
            Button { model.open(.settings) } label: {
                (Text("The Vault's key changed since you saved your recovery key. Make a new one in ") + Text("Settings").underline() + Text("."))
                    .webText(text.text)
                    .foregroundStyle(PV.color("warning", scheme))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).stroke(PV.color("warning", scheme).opacity(0.4)))
            }
            .buttonStyle(.plain)
            .padding(.bottom, 12)
        }
        if v.accessReviewDue {
            Button { model.open(.people) } label: {
                (Text("It's been 90 days since anyone checked who has access to this Vault. Have a look in ") + Text("People").underline().foregroundColor(FoleviTokens.Chrome.heading.resolve(scheme).color) + Text("."))
                    .webText(text.text)
                    .foregroundStyle(text.color.color)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).stroke(FoleviTokens.Chrome.line.resolve(scheme).color))
            }
            .buttonStyle(.plain)
            .padding(.bottom, 12)
        }
    }
}

// MARK: tabs

private struct PhoneVaultTabs: View {
    @Bindable var model: VaultModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let tabs = PV.style("tabs", scheme)
        // (Each tab's -mb-px: a second row starts 1 pt higher than the gap alone.)
        PhoneVaultFlow(gap: tabs.gap, rowGap: tabs.gap - 1, pushAfterFirst: false) {
            tab(.files)
            tab(.passwords)
            if let s = model.fromMenu { menuTab(s) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .bottom) {
            FoleviTokens.Chrome.line.resolve(scheme).color.frame(height: 1)
        }
        .padding(.bottom, tabs.margin.bottom)
    }

    private func tab(_ s: VaultSection) -> some View {
        let on = model.section == s
        let st = PV.style(on ? "tab.active" : "tab", scheme)
        return Button { model.open(s) } label: {
            HStack(spacing: st.gap) {
                WebIconView(s.icon, size: 14)
                Text(s.label).webText(st.text).lineLimit(1).fixedSize()
            }
            .foregroundStyle(st.color.color)
            .padding(st.padding.edgeInsets)
            .padding(.bottom, 2)
            .overlay(alignment: .bottom) {
                Rectangle().fill(on ? st.color.color : .clear).frame(height: 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func menuTab(_ s: VaultSection) -> some View {
        let st = PV.style("tab.menu", scheme)
        let close = PV.style("tab.menu.close", scheme)
        return HStack(spacing: st.gap) {
            HStack(spacing: st.gap) {
                WebIconView(s.icon, size: 14)
                Text(s.label).webText(st.text).lineLimit(1).fixedSize()
            }
            Button { model.open(.files) } label: {
                WebIconView(.x, size: 12)
                    .frame(width: close.width, height: close.height)
                    .foregroundStyle(close.color.color)
                    // (A 20 pt button: the tap reaches 44.)
                    .contentShape(Rectangle().inset(by: -12))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close \(s.label)")
        }
        .foregroundStyle(st.color.color)
        .padding(st.padding.edgeInsets)
        .padding(.bottom, 2)
        .overlay(alignment: .bottom) { Rectangle().fill(st.color.color).frame(height: 2) }
    }
}

/// `flex flex-wrap items-center gap`: each child at its own width, a new line when the next doesn't fit; with
/// `pushAfterFirst` the first child's `mr-auto` sends the rest of its line to the end (the header's subtitle, a
/// section's title). Children are centred in their line.
struct PhoneVaultFlow: Layout {
    let gap: CGFloat
    let rowGap: CGFloat
    let pushAfterFirst: Bool

    private func lines(_ width: CGFloat, _ sizes: [CGSize]) -> [[Int]] { Self.lines(sizes.map(\.width), width: width, gap: gap) }

    /// Which children share a line: each at its width (at most the line's), a new line when the next doesn't fit.
    static func lines(_ widths: [CGFloat], width: CGFloat, gap: CGFloat) -> [[Int]] {
        var out: [[Int]] = []
        var line: [Int] = []
        var used: CGFloat = 0
        for (i, wanted) in widths.enumerated() {
            let w = min(wanted, width)
            if !line.isEmpty && used + gap + w > width + 0.5 {
                out.append(line)
                line = []
                used = 0
            }
            used += (line.isEmpty ? 0 : gap) + w
            line.append(i)
        }
        if !line.isEmpty { out.append(line) }
        return out
    }

    private func measure(_ subviews: Subviews, _ width: CGFloat) -> [CGSize] {
        subviews.map { v in
            let ideal = v.sizeThatFits(.unspecified)
            return ideal.width > width ? v.sizeThatFits(ProposedViewSize(width: width, height: nil)) : ideal
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let sizes = measure(subviews, width)
        let ls = lines(width, sizes)
        var height: CGFloat = rowGap * CGFloat(max(0, ls.count - 1))
        var used: CGFloat = 0
        for l in ls {
            var h: CGFloat = 0
            var w: CGFloat = gap * CGFloat(l.count - 1)
            for i in l {
                h = max(h, sizes[i].height)
                w += min(sizes[i].width, width)
            }
            height += h
            used = max(used, w)
        }
        return CGSize(width: proposal.width ?? used, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = measure(subviews, bounds.width)
        var y = bounds.minY
        for l in lines(bounds.width, sizes) {
            let h = l.map { sizes[$0].height }.max() ?? 0
            let rest = l.dropFirst().map { min(sizes[$0].width, bounds.width) }.reduce(0, +) + gap * CGFloat(max(0, l.count - 1))
            var x = bounds.minX
            for (n, i) in l.enumerated() {
                var w = min(sizes[i].width, bounds.width)
                if n == 0 && i == 0 && pushAfterFirst && l.count > 1 { w = min(w, bounds.width - rest) }
                subviews[i].place(at: CGPoint(x: x, y: y + (h - sizes[i].height) / 2), proposal: ProposedViewSize(width: w, height: sizes[i].height))
                x += w + gap
                if n == 0 && i == 0 && pushAfterFirst { x = max(x, bounds.maxX - rest + gap) }
            }
            y += h + rowGap
        }
    }
}

/// A paragraph broken where the iPhone's WebKit breaks it (`text.layout`: the page sets it in a box of `width`,
/// `text-wrap: pretty` for a <p>, plain for a span), each line in its exact CSS line box; the kit's own model
/// stands in until the page has answered.
struct PhoneVaultText: View {
    let text: String
    let style: WebTextStyle
    let width: CGFloat
    var paragraph = true
    var alignment: TextAlignment = .leading

    var body: some View {
        let h: HorizontalAlignment = alignment == .center ? .center : .leading
        let asked = WebLineLayout.Style(family: style.family == .display ? .display : .sans, size: style.size, lineHeight: style.leading, weight: style.weight, letterSpacing: style.letterSpacing, width: width, wrap: paragraph ? .pretty : .wrap, pre: false)
        if let lines = WebLineLayout.shared.lines(text, style: asked) {
            VStack(alignment: h, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(verbatim: line).webText(style).lineLimit(1).fixedSize()
                }
            }
            .frame(maxWidth: .infinity, alignment: Alignment(horizontal: h, vertical: .top))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(text)
        } else {
            WebPrettyText(text, style: style, alignment: alignment, wrap: paragraph ? .pretty : .greedy, width: width)
        }
    }
}

// MARK: empty states (components/ui/EmptyState.tsx)

struct PhoneVaultEmpty: View {
    let icon: WebIcon
    let title: String
    var message: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let muted = PV.style("header.subtitle", scheme)
        VStack(spacing: 8) {
            WebIconView(icon, size: 22).foregroundStyle(muted.color.color).padding(.bottom, 4)
            Text(title).webText(PV.style("files.title", scheme).text).foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color).multilineTextAlignment(.center)
            if let message {
                Text(message).webText(PV.style("health.lead", scheme).text).foregroundStyle(muted.color.color).multilineTextAlignment(.center).frame(maxWidth: 420)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }
}

// MARK: the front door (VaultGate.tsx)

private struct PhoneGateCard<Content: View>: View {
    let icon: WebIcon
    let title: String
    @ViewBuilder let content: Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let card = PV.style("gate.card", scheme)
        let iconBox = PV.style("gate.icon", scheme)
        let t = PV.style("gate.title", scheme)
        let b = PV.style("gate.body", scheme)
        VStack(alignment: .leading, spacing: 0) {
            WebIconView(icon, size: 20)
                .foregroundStyle(iconBox.color.color)
                .frame(width: iconBox.width, height: iconBox.height)
                .background(RoundedRectangle(cornerRadius: iconBox.radius, style: .continuous).fill(iconBox.background.color))
                .padding(.bottom, iconBox.margin.bottom)
            Text(title).webText(t.text).foregroundStyle(t.color.color).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 16) { content }
                .foregroundStyle(b.color.color)
                .padding(.top, b.margin.top)
        }
        .padding(card.padding.edgeInsets)
        .frame(maxWidth: 448, alignment: .leading)
        .webBox(PV.pair("gate.card"))
        .padding(.top, card.margin.top)
        .frame(maxWidth: .infinity)
    }
}

/// A paragraph of the front door's text (subheadline, muted).
struct PhoneGateText: View {
    let text: String
    init(_ text: String) { self.text = text }
    @Environment(\.colorScheme) private var scheme
    @Environment(\.phoneVaultWidth) private var width

    var body: some View {
        let b = PV.style("gate.body", scheme)
        let card = PV.style("gate.card", scheme)
        // The card's text column: max-w-md (448) less its padding.
        PhoneVaultText(text: text, style: b.text, width: min(448, width) - card.padding.left - card.padding.right).foregroundStyle(b.color.color)
    }
}

/// A passcode field drawn as dots (PasscodeFields.tsx PasscodeField), the number pad for a PIN; never offered to
/// a password manager (iOS offers AutoFill only to fields that ask for it).
struct PhonePasscodeInput: View {
    let label: String
    @Binding var value: String
    var digits: Int?
    var autoFocus = false
    var onSubmit: () -> Void = {}
    @Environment(\.colorScheme) private var scheme
    @FocusState private var focused: Bool

    var body: some View {
        let l = PV.style("gate.label", scheme)
        let input = PV.style(digits == nil ? "gate.input" : "setup.input", scheme)
        VStack(alignment: .leading, spacing: l.margin.bottom) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).webText(l.text).lineLimit(1).foregroundStyle(l.color.color)
                Spacer(minLength: 12)
                if let digits {
                    let count = PV.style("setup.count", scheme)
                    Text("\(value.count) of \(digits)").webText(count.text).foregroundStyle(count.color.color)
                }
            }
            SecureField("", text: Binding(get: { value }, set: { v in
                value = digits.map { String(v.filter(\.isNumber).prefix($0)) } ?? v
            }))
            .keyboardType(digits == nil ? .default : .numberPad)
            .textContentType(nil)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .font(.system(size: input.fontSize, design: digits == nil ? .default : .monospaced))
            .focused($focused)
            .onSubmit(onSubmit)
            .padding(input.padding.edgeInsets)
            .frame(height: input.height)
            .foregroundStyle(input.color.color)
            .webBox(PV.pair(digits == nil ? "gate.input" : "setup.input"))
            .accessibilityLabel(label)
        }
        .onAppear { if autoFocus && !PV.noKeyboard { focused = true } }
    }
}

/// Choosing a passcode (PasscodeFields.tsx NewPasscode): the length, the PIN, and the PIN again.
struct PhoneNewPasscode: View {
    var label = "Choose a passcode"
    var lengths: [Int] = [6, 8, 12]
    @Binding var pin: String?
    var autoFocus = false
    @State private var digits = 6
    @State private var first = ""
    @State private var again = ""
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let l = PV.style("setup.length", scheme)
        let seg = PV.style("setup.seg", scheme)
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: l.margin.bottom) {
                Text("Passcode length").webText(l.text).lineLimit(1).foregroundStyle(l.color.color)
                HStack(spacing: seg.gap) {
                    ForEach(lengths, id: \.self) { d in
                        let on = d == digits
                        let s = PV.style(on ? "setup.seg.on" : "setup.seg.off", scheme)
                        Button {
                            digits = d
                            first = String(first.prefix(d))
                            again = String(again.prefix(d))
                            report()
                        } label: {
                            Text("\(d) digits").webText(s.text)
                                .foregroundStyle(s.color.color)
                                .frame(maxWidth: .infinity, minHeight: s.height)
                                .webBox(PV.pair(on ? "setup.seg.on" : "setup.seg.off"))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(seg.padding.edgeInsets)
                .webBox(PV.pair("setup.seg"))
            }
            PhonePasscodeInput(label: label, value: Binding(get: { first }, set: { first = $0; report() }), digits: digits, autoFocus: autoFocus)
            PhonePasscodeInput(label: "Type it again", value: Binding(get: { again }, set: { again = $0; report() }), digits: digits)
            if again.count == digits && again != first {
                Text("The two don't match.").webText(PV.style("health.body", scheme).text).foregroundStyle(PV.color("warning", scheme))
            }
        }
        .onAppear { pin = nil }
    }

    private func report() { pin = first.count == digits && first == again ? first : nil }
}

private struct PhoneVaultGate: View {
    @Bindable var model: VaultModel
    let state: PhoneVaultState
    let summary: VaultSummaryValue
    @State private var passcode = ""
    @State private var next: String?
    @State private var recovery = ""
    @State private var old: String?
    @State private var mode = "passcode"
    @State private var busy = false
    @State private var error: String?
    /// Face ID asked once each time the locked card shows.
    @State private var askedBiometrics = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        switch summary.state {
        case .encryptionLocked:
            // This iPhone unlocks encryption in this same card, then goes straight on to the passcode.
            let device = model.e2ee.value?.device ?? "this \(VaultBiometrics.device)"
            PhoneGateCard(icon: .lock, title: "Unlock the Vault on \(device)") {
                PhoneGateText("Your Vault is end-to-end encrypted. \(device.prefix(1).uppercased())\(device.dropFirst()) needs your account's encryption keys once, then your Vault passcode.")
                PhoneVaultEncryptionStep(model: model)
            }
        case .setUp:
            PhoneGateCard(icon: .shieldCheck, title: summary.personal ? "Set up your Vault" : "Set up your team's Vault") {
                PhoneGateText(summary.local ? "A place for passwords, API keys and sensitive files. It's encrypted on this device with your own passcode, and opens only with it." : "A place for passwords, API keys and sensitive files. It's always end-to-end encrypted, opens with your own passcode, and keeps a record of everything done in it.")
                VStack(alignment: .leading, spacing: 12) {
                    PhoneNewPasscode(lengths: summary.passcodeLengths, pin: $next, autoFocus: true)
                    errorLine
                    WebButton(busy ? "Setting up…" : "Set up the Vault", styleName: "phone.vault.setup.submit", variant: .primary) { setUp() }
                        .disabled(busy || next == nil)
                }
            }
        case .waitingForKey:
            PhoneGateCard(icon: .keyRound, title: "Waiting for the Vault's key") {
                PhoneGateText("You were added to this Vault. Its key reaches you when a custodian next opens the Vault on one of their devices. Nothing to do here until then.")
            }
        case .needsPasscode:
            PhoneGateCard(icon: .keyRound, title: "Choose your Vault passcode") {
                PhoneGateText("A custodian shared the Vault's key with you. Choose the passcode you'll open it with. Nobody else knows it, Folevi included.")
                VStack(alignment: .leading, spacing: 12) {
                    PhoneNewPasscode(lengths: summary.passcodeLengths, pin: $next, autoFocus: true)
                    errorLine
                    WebButton(busy ? "Opening…" : "Set passcode and open", styleName: "phone.vault.setup.submit", variant: .primary) {
                        guard let next, let id = summary.vaultId else { return }
                        go(passcode: next) { try await model.client.command(.vaultFinishPasscode(vaultId: id, passcode: next)) }
                    }
                    .disabled(busy || next == nil)
                }
            }
        default:
            if let old {
                PhoneGateCard(icon: .keyRound, title: "Choose a new passcode") {
                    PhoneGateText("Vault passcodes are now a PIN of 6, 8 or 12 digits. Choose yours to open the Vault; your old passcode stops working.")
                    VStack(alignment: .leading, spacing: 12) {
                        PhoneNewPasscode(label: "New passcode", lengths: summary.passcodeLengths, pin: $next, autoFocus: true)
                        errorLine
                        PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false) {
                            WebButton(busy ? "Opening…" : "Save passcode and open", styleName: "phone.vault.gate.unlock", variant: .primary) {
                                guard let next, let id = summary.vaultId else { return }
                                go(passcode: next) {
                                    let r = try await model.client.command(.vaultChangePasscode(vaultId: id, current: old, next: next))
                                    if r.status != "ok" { self.old = nil }
                                    return r
                                }
                            }
                            .disabled(busy || next == nil)
                            WebButton("Back", styleName: "phone.vault.gate.forgot", variant: .quiet) { self.old = nil; error = nil }
                        }
                    }
                }
            } else {
                locked
            }
        }
    }

    private var locked: some View {
        let actions = PV.style("gate.actions", scheme)
        let id = summary.vaultId ?? ""
        let biometrics = VaultBiometrics.isOn(vaultId: id)
        return PhoneGateCard(icon: .lock, title: "The Vault is locked") {
            VStack(alignment: .leading, spacing: 12) {
                if biometrics && mode == "passcode" {
                    WebButton("Unlock with \(VaultBiometrics.name)", icon: VaultBiometrics.icon, styleName: "phone.vault.gate.forgot", variant: .secondary) { unlockWithBiometrics() }
                }
                if mode == "passcode" {
                    PhonePasscodeInput(label: "Passcode", value: $passcode, autoFocus: !biometrics) { unlock() }
                } else {
                    VStack(alignment: .leading, spacing: PV.style("gate.label", scheme).margin.bottom) {
                        Text("Vault recovery key").webText(PV.style("gate.label", scheme).text).foregroundStyle(PV.style("gate.label", scheme).color.color)
                        TextField("", text: $recovery)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.system(size: PV.style("gate.input", scheme).fontSize, design: .monospaced))
                            .padding(PV.style("gate.input", scheme).padding.edgeInsets)
                            .frame(height: PV.style("gate.input", scheme).height)
                            .webBox(PV.pair("gate.input"))
                            .accessibilityLabel("Vault recovery key")
                    }
                    PhoneNewPasscode(label: "New passcode", lengths: summary.passcodeLengths, pin: $next)
                }
                errorLine
                PhoneVaultFlow(gap: actions.gap, rowGap: actions.gap, pushAfterFirst: false) {
                    WebButton(busy ? "Unlocking…" : mode == "passcode" ? "Unlock" : "Reset passcode and open", styleName: "phone.vault.gate.unlock", variant: .primary) { unlock() }
                        .disabled(busy || (mode == "passcode" ? passcode.isEmpty : recovery.isEmpty || next == nil))
                    WebButton(mode == "passcode" ? "Forgot your passcode?" : "Use the passcode", styleName: "phone.vault.gate.forgot", variant: .quiet) {
                        mode = mode == "passcode" ? "recovery" : "passcode"
                        error = nil
                    }
                }
                if mode == "recovery" && !summary.personal {
                    HStack(spacing: 4) {
                        Text("No recovery key?").webText(PV.style("health.body", scheme).text)
                        Button("Ask a custodian") {
                            model.run {
                                _ = try await model.client.command(.vaultRequestReset(vaultId: id))
                                model.toast("Asked. A custodian's device shares the key with you again when they next open the Vault.", tone: .success)
                            }
                        }
                        .buttonStyle(.plain)
                        .underline()
                        .webText(PV.style("health.body", scheme).text)
                    }
                }
            }
        }
        .task(id: id) {
            #if DEBUG
            // FOLEVI_VAULT_BIOMETRICS=<scratch PIN>: kept behind Face ID at launch, so the Face ID path runs without
            // taps (a Simulator with Face ID enrolled; the match sent with notifyutil). Scratch Vaults only.
            if let pin = ProcessInfo.processInfo.environment["FOLEVI_VAULT_BIOMETRICS"], !id.isEmpty, !VaultBiometrics.isOn(vaultId: id) {
                _ = await VaultBiometrics.turnOn(vaultId: id, passcode: pin)
            }
            #endif
            // Face ID straight away when it's on (once per showing; the button asks again).
            guard VaultBiometrics.isOn(vaultId: id), !askedBiometrics, !PV.noKeyboard else { return }
            askedBiometrics = true
            try? await Task.sleep(for: .milliseconds(350))
            unlockWithBiometrics()
        }
    }

    @ViewBuilder private var errorLine: some View {
        if let error {
            Text(error).webText(PV.style("health.body", scheme).text).foregroundStyle(PV.color("danger", scheme)).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func unlockWithBiometrics() {
        guard let id = summary.vaultId, !busy else { return }
        Task { @MainActor in
            guard let stored = await VaultBiometrics.passcode(vaultId: id) else { return }
            busy = true
            error = nil
            do {
                let r = try await model.client.command(.vaultUnlock(vaultId: id, passcode: stored))
                if r.status == "wrong" || r.status == "oldPasscode" {
                    // The passcode changed on another device: Face ID can't open it any more.
                    VaultBiometrics.turnOff(vaultId: id)
                    error = "\(VaultBiometrics.name) is off for this Vault: its passcode changed. Unlock with the passcode to turn it on again."
                } else if r.status != "ok" {
                    error = r.message
                }
            } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }

    private func unlock() {
        guard let id = summary.vaultId else { return }
        if mode == "passcode" {
            guard !passcode.isEmpty else { return }
            let p = passcode
            go(passcode: p) {
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
            go(passcode: next) { try await model.client.command(.vaultReset(vaultId: id, recoveryKey: key, passcode: next)) }
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

    /// Runs an unlock; once it opens with `passcode`, Face ID is offered (or its stored passcode follows the change).
    private func go(passcode: String, _ work: @escaping @MainActor () async throws -> VaultUnlockResult) {
        busy = true
        error = nil
        let id = summary.vaultId
        Task { @MainActor in
            do {
                let r = try await work()
                if r.status == "ok", let id {
                    if VaultBiometrics.isOn(vaultId: id) {
                        _ = await VaultBiometrics.turnOn(vaultId: id, passcode: passcode)
                    } else if VaultBiometrics.shouldOffer(vaultId: id) {
                        state.faceIdOffer = (id, passcode)
                    }
                } else if r.status != "oldPasscode" {
                    error = r.message
                }
            } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }
}

/// The ways to unlock this iPhone's encryption, in the Vault's card (VaultEncryptionStep.tsx): approve from another
/// device first, the passphrase, the recovery key. The device keeps the key once unlocked; the Vault then asks for
/// its passcode.
private struct PhoneVaultEncryptionStep: View {
    @Bindable var model: VaultModel
    @State private var step = "choose"
    @State private var secret = ""
    @State private var busy = false
    @State private var error: String?
    @Environment(\.colorScheme) private var scheme

    private var value: E2eeStateValue? { model.e2ee.value }

    var body: some View {
        switch step {
        case "passphrase", "recovery": secretForm
        case "approve": approving
        default: choices
        }
    }

    private var choices: some View {
        VStack(alignment: .leading, spacing: 8) {
            wide("Approve from another device", icon: .smartphone, primary: true) { approve() }
            wide("Enter passphrase", icon: .lockKeyhole) { start("passphrase") }
            wide("Enter recovery key", icon: .scrollText) { start("recovery") }
            PhoneGateText("To use your passkey, open Folevi in your browser and approve \(value?.device ?? "this \(VaultBiometrics.device)") from there.").padding(.top, 4)
        }
    }

    private func wide(_ title: String, icon: WebIcon, primary: Bool = false, action: @escaping () -> Void) -> some View {
        let pair = WebStyles.named(primary ? "button.primary.md" : "button.secondary.md")
        let s = pair.resolve(scheme)
        return Button(action: action) {
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

    private var secretForm: some View {
        let l = PV.style("gate.label", scheme)
        let input = PV.style("gate.input", scheme)
        let recovery = step == "recovery"
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: l.margin.bottom) {
                Text(recovery ? "Recovery key" : "Encryption passphrase").webText(l.text).foregroundStyle(l.color.color)
                Group {
                    if recovery {
                        TextField("XXXX-XXXX-XXXX-…", text: $secret)
                            .font(.system(size: input.fontSize, design: .monospaced))
                            .textInputAutocapitalization(.characters)
                    } else {
                        SecureField("", text: $secret).webText(input.text)
                    }
                }
                .autocorrectionDisabled()
                .onSubmit { unlock() }
                .padding(input.padding.edgeInsets)
                .frame(height: input.height)
                .foregroundStyle(input.color.color)
                .webBox(PV.pair("gate.input"))
                .onChange(of: secret) { error = nil }
            }
            if let error { Text(error).webText(PV.style("gate.body", scheme).text).foregroundStyle(PV.color("danger", scheme)) }
            PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: true) {
                WebButton("Other ways to unlock", icon: .arrowLeft, iconSize: 14, variant: .quiet) { back() }
                WebButton(busy ? "Unlocking…" : "Unlock", variant: .primary) { unlock() }
                    .disabled(busy || secret.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private var approving: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Waiting for approval").webText(PV.style("gate.label", scheme).text).foregroundStyle(PV.style("gate.title", scheme).color.color)
            switch value?.approval {
            case .failed?: Text("Approval didn't finish. Try again, or use another way to unlock.").webText(PV.style("gate.body", scheme).text).foregroundStyle(PV.color("danger", scheme))
            case .compare?:
                PhoneGateText("Check that your other device shows this code:")
                Text(value?.approvalCode ?? "")
                    .font(.system(size: 22, weight: .semibold, design: .monospaced))
                    .foregroundStyle(PV.style("gate.title", scheme).color.color)
                    .textSelection(.enabled)
            default: PhoneGateText("Open Folevi on a device you've already unlocked. It will ask you to approve this one.")
            }
            PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: true) {
                WebButton("Other ways to unlock", icon: .arrowLeft, iconSize: 14, variant: .quiet) { back() }
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
                let r = try await model.client.command(.e2eeUnlock(method: method, secret: value))
                if r.status != .ok { error = r.message ?? "That didn't unlock this \(VaultBiometrics.device). Check it and try again." }
            } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }
}

/// The recovery key, once, right after setting up or making a new one, until it's confirmed as saved.
private struct PhoneVaultRecoveryCard: View {
    @Bindable var model: VaultModel
    let vaultId: String
    let key: String
    @State private var copied = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PhoneGateCard(icon: .keyRound, title: "Save your Vault recovery key") {
            PhoneGateText("If you forget your passcode, this key opens the Vault. Folevi can't. Keep it somewhere safe, away from this device.")
            Text(key)
                .font(.system(size: 15, weight: .medium, design: .monospaced))
                .foregroundStyle(PV.style("gate.title", scheme).color.color)
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .webBox(PV.pair("gate.input"))
            PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false) {
                WebButton(copied ? "Copied" : "Copy", icon: .copy) {
                    VaultModel.copySecret(key)
                    copied = true
                }
                ShareLink(item: "Folevi Vault recovery key\n\n\(key)\n\nIf you forget your Vault passcode, this key opens the Vault. Keep it somewhere safe.\n") {
                    WebButtonLabel("Save or print…", icon: .download)
                }
            }
            WebButton("I've saved it", variant: .primary) {
                model.run { _ = try await model.client.command(.vaultRecoverySaved(vaultId: vaultId)) }
            }
        }
    }
}

/// A secondary button's look for a control that isn't a WebButton (a ShareLink).
struct WebButtonLabel: View {
    let title: String
    let icon: WebIcon?
    @Environment(\.colorScheme) private var scheme
    init(_ title: String, icon: WebIcon? = nil) {
        self.title = title
        self.icon = icon
    }
    var body: some View {
        let pair = WebStyles.named("button.secondary.md")
        let s = pair.resolve(scheme)
        HStack(spacing: s.gap) {
            if let icon { WebIconView(icon, size: 15) }
            Text(title).webText(s.text).lineLimit(1)
        }
        .foregroundStyle(s.color.color)
        .padding(s.padding.edgeInsets)
        .frame(height: s.height)
        .webBox(pair)
    }
}

// MARK: Face ID

/// Face ID (or Touch ID) to open the Vault on this iPhone or iPad: the passcode kept in this device's Keychain,
/// readable only after Face ID with the faces enrolled when it was turned on (`biometryCurrentSet`), never synced
/// or backed up (`WhenPasscodeSetThisDeviceOnly`). Offered once after a passcode unlock; off in the Vault's
/// Settings. The Vault still locks itself after its idle minutes; Face ID only stands in for typing the passcode.
@MainActor
enum VaultBiometrics {
    private static let service = "com.folevi.ios.vault-unlock"

    private static var type: LABiometryType {
        let c = LAContext()
        _ = c.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return c.biometryType
    }

    static var available: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) }
    static var name: String {
        switch type {
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Face ID"
        }
    }
    /// (The web's icons have no face or fingerprint: the keyhole lock.)
    static var icon: WebIcon { .lockKeyhole }
    static var device: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    private static func query(_ vaultId: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: vaultId]
    }

    /// Whether a passcode is kept for this Vault (asked without Face ID: the item's existence only).
    static func isOn(vaultId: String) -> Bool {
        guard !vaultId.isEmpty, available else { return false }
        let context = LAContext()
        context.interactionNotAllowed = true
        var q = query(vaultId)
        q[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(q as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    static func shouldOffer(vaultId: String) -> Bool {
        available && !UserDefaults.standard.bool(forKey: "folevi.vault.biometrics.declined.\(vaultId)")
    }

    static func decline(vaultId: String) { UserDefaults.standard.set(true, forKey: "folevi.vault.biometrics.declined.\(vaultId)") }

    /// Keeps `passcode` behind Face ID (replacing one kept before). False if the device refused.
    static func turnOn(vaultId: String, passcode: String) async -> Bool {
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil) else { return false }
        SecItemDelete(query(vaultId) as CFDictionary)
        var add = query(vaultId)
        add[kSecAttrAccessControl as String] = access
        add[kSecValueData as String] = Data(passcode.utf8)
        let ok = SecItemAdd(add as CFDictionary, nil) == errSecSuccess
        if ok { UserDefaults.standard.removeObject(forKey: "folevi.vault.biometrics.declined.\(vaultId)") }
        return ok
    }

    static func turnOff(vaultId: String) { SecItemDelete(query(vaultId) as CFDictionary) }

    /// The kept passcode, after Face ID; nil when cancelled, failed or not kept.
    static func passcode(vaultId: String) async -> String? {
        let context = LAContext()
        context.localizedCancelTitle = "Use Passcode"
        var q = query(vaultId)
        q[kSecReturnData as String] = true
        q[kSecUseAuthenticationContext as String] = context
        q[kSecUseOperationPrompt as String] = "Open the Vault"
        let request = q
        return await withCheckedContinuation { done in
            DispatchQueue.global(qos: .userInitiated).async {
                var out: CFTypeRef?
                let status = SecItemCopyMatching(request as CFDictionary, &out)
                done.resume(returning: status == errSecSuccess ? (out as? Data).flatMap { String(data: $0, encoding: .utf8) } : nil)
            }
        }
    }
}
#endif
