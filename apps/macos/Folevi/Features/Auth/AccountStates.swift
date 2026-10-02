import SwiftUI

// The account states the server reports before the app opens (the web's AccountGate and DeviceLimit):
// each a full-page message, as on the web.

/// The web's FullPageMessage: a 448 pt card (6 pt corners, a line, a soft drop) on the canvas, with a
/// 30 pt serif title, an optional body, a progress bar while busy, and actions.
struct FullPageMessage<Actions: View>: View {
    var title: String
    var message: String? = nil
    var busy = false
    @ViewBuilder var actions: Actions

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(FoleviType.display(30))
                    .tracking(FoleviType.displayTracking(30))
                    .foregroundStyle(FoleviColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let message {
                    Text(message)
                        .font(.ui(16))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                }
                if busy { BusyBar().padding(.top, 24) }
                if !(Actions.self == EmptyView.self) {
                    actions.padding(.top, 24)
                }
            }
            .padding(32)
            .frame(maxWidth: 448, alignment: .leading)
            .background {
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                shape.fill(FoleviColor.surface)
                    .overlay(shape.strokeBorder(FoleviColor.line))
                    .shadow(color: Color(red: 24 / 255, green: 32 / 255, blue: 28 / 255).opacity(0.35), radius: 20, y: 12)
            }
            .padding(24)
            .frame(maxWidth: .infinity, minHeight: 520)
        }
        .scrollBounceBehavior(.basedOnSize)
        .defaultScrollAnchor(.center)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(FoleviColor.canvas)
        .background(WindowChrome())
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .ignoresSafeArea()
        .accessibilityElement(children: .contain)
    }
}

extension FullPageMessage where Actions == EmptyView {
    init(title: String, message: String? = nil, busy: Bool = false) {
        self.init(title: title, message: message, busy: busy) { EmptyView() }
    }
}

/// The web's busy bar: a 4 pt track with a third of it sliding across in accent.
private struct BusyBar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -0.4

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(FoleviColor.surfaceSunken)
                Capsule().fill(FoleviColor.accent)
                    .frame(width: geo.size.width / 3)
                    .offset(x: reduceMotion ? 0 : geo.size.width * phase)
            }
            .clipShape(Capsule())
        }
        .frame(height: 4)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: false)) { phase = 1.05 }
        }
        .accessibilityLabel(Text("Loading"))
    }
}

/// The states before the app: confirm your email, suspended, checking your session, setting up, offline.
struct AccountStateView: View {
    let phase: AppModel.Phase
    @Environment(AppModel.self) private var app

    var body: some View {
        switch phase {
        case .emailUnverified:
            FullPageMessage(title: String(localized: "Confirm your email to continue"),
                            message: String(localized: "Open the confirmation link we emailed you. It expires in 24 hours and works once.")) {
                HStack(spacing: 8) {
                    // The web's /verify-email: resending is a signed-out form on the web.
                    Button("Send a new link") { openWebApp("verify-email", config: app.config) }
                        .buttonStyle(.folevi(.primary, .medium))
                    SafeSignOutButton()
                }
            }
        case .suspended:
            FullPageMessage(title: String(localized: "This account is suspended"),
                            message: String(localized: "If you think this is a mistake, write to support@folevi.com from the address on your account.")) {
                SafeSignOutButton()
            }
        case .sessionRevoked:
            FullPageMessage(title: String(localized: "Checking your session…"), busy: true)
        case .settingUp:
            FullPageMessage(title: String(localized: "Setting up your folio…"),
                            message: String(localized: "Setting up your Personal space with a few pages to start from."), busy: true)
        case .setupFailed(let message):
            FullPageMessage(title: String(localized: "We couldn't finish setting up"), message: message) {
                Button("Try again") { Task { await app.signIn(interactive: false) } }
                    .buttonStyle(.folevi(.primary, .medium))
            }
        case .offline:
            FullPageMessage(title: String(localized: "You're offline"),
                            message: String(localized: "Folevi can't reach the server right now. Anything you wrote on this device is safe and will sync when you're back online.")) {
                Button("Try again") { Task { await app.signIn(interactive: false) } }
                    .buttonStyle(.folevi(.primary, .medium))
            }
        default:
            // Two-step verification required by a workspace: set it up on the web, then come back.
            FullPageMessage(title: String(localized: "Turn on two-step verification"),
                            message: String(localized: "Your account needs two-step verification. Turn it on, then try again.")) {
                HStack(spacing: 8) {
                    Button("Try again") { Task { await app.signIn(interactive: false) } }
                        .buttonStyle(.folevi(.primary, .medium))
                    SafeSignOutButton()
                }
            }
        }
    }
}

/// The web's SignOutButton: sign-out that never silently deletes work. With unsynced changes on this Mac,
/// you choose to stay (and let them sync) or to sign out and delete them.
struct SafeSignOutButton: View {
    var label: String = String(localized: "Sign out")
    @Environment(AppModel.self) private var app
    @State private var pending: Int?
    @State private var busy = false

    var body: some View {
        Button(label) {
            let count = app.sync.pendingCount + app.sync.uploadCount + app.sync.conflicts.count
            if count > 0 { pending = count } else { signOut(discard: false) }
        }
        .buttonStyle(.folevi(.secondary, .medium))
        .disabled(busy)
        .foleviDialog(item: Binding(get: { pending.map(PendingCount.init) }, set: { pending = $0?.count })) { p in
            WebDialog(title: String(localized: "Some changes haven't synced yet"),
                      description: p.count == 1
                        ? String(localized: "One change on this device hasn't reached Folevi yet. If you sign out now it will be deleted from this device.")
                        : String(localized: "\(p.count) changes on this device haven't reached Folevi yet. If you sign out now they will be deleted from this device."),
                      size: .sm, onClose: { pending = nil }) {
                Text(app.sync.isOnline
                     ? String(localized: "Wait a moment for the status to show “Saved”, then sign out.")
                     : String(localized: "You're offline. Reconnect and wait for the status to show “Saved”, then sign out."))
                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            } footer: {
                Button("Stay signed in") { pending = nil }
                    .buttonStyle(.folevi(.primary, .medium))
                Button("Sign out and delete them") {
                    pending = nil
                    signOut(discard: true)
                }
                .buttonStyle(.folevi(.danger, .medium))
                .disabled(busy)
            }
        }
    }

    private struct PendingCount: Identifiable {
        var count: Int
        var id: Int { count }
    }

    private func signOut(discard: Bool) {
        busy = true
        Task {
            if discard { await app.session?.engine.resetLocalCache() }
            await app.signOut(message: String(localized: "You're signed out."))
            busy = false
        }
    }
}

// MARK: - Device limit

/// billing:mine, for what the device-limit screen offers (checkout, or test purchases in development).
private struct BillingFlags: Decodable, Sendable {
    var checkoutAvailable: Bool?
    var testPurchases: Bool?
}

/// billing:checkout: a Polar checkout page, or nil when a running subscription was switched instead.
private struct CheckoutURL: Decodable, Sendable { var url: String? }

/// Shown on a device that signed in over the plan's device limit (Free: 2). Nothing here can reach the
/// account until another device is signed out here, or the plan is upgraded (the web's DeviceLimitScreen).
struct DeviceLimitScreen: View {
    let limit: Int
    @Environment(AppModel.self) private var app
    @State private var sessions: [SessionInfo]?
    @State private var billing: BillingFlags?
    @State private var busy: String?
    @State private var error: String?

    private var others: [SessionInfo] { (sessions ?? []).filter { !$0.current } }
    private var canBuy: Bool { billing?.checkoutAvailable == true || billing?.testPurchases == true }
    private var devices: String { limit == 1 ? String(localized: "device") : String(localized: "devices") }

    var body: some View {
        FullPageMessage(title: String(localized: "You’re on \(limit) \(devices) already"),
                        message: String(localized: "Your plan works on \(limit) \(devices) at a time. Sign out of one below to use Folevi here, or upgrade for unlimited devices.")) {
            VStack(alignment: .leading, spacing: 0) {
                Text("SIGNED IN ON").font(.ui(11, .semibold)).tracking(0.66).foregroundStyle(FoleviColor.inkFaint).padding(.bottom, 8)
                VStack(alignment: .leading, spacing: 0) {
                    if sessions == nil {
                        Text("Loading your devices…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 12).padding(.vertical, 12)
                    } else {
                        ForEach(Array(others.enumerated()), id: \.element.id) { i, s in
                            if i > 0 { FoleviColor.line.frame(height: 1) }
                            row(s)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .foleviCard(radius: 8)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                if let error {
                    Text(error).font(.ui(13)).foregroundStyle(FoleviColor.destructive).padding(.top, 12)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if canBuy {
                    HStack(spacing: 8) {
                        Button(busy == "core" ? String(localized: "Upgrading…")
                               : String(localized: "Upgrade to \(PlanCatalog.card("core").name) · \(PlanCatalog.formatPrice(PlanCatalog.card("core").monthlyCents))/mo")) { upgrade("core") }
                            .buttonStyle(.folevi(.primary, .medium))
                        Button(busy == "pro" ? String(localized: "Upgrading…")
                               : String(localized: "\(PlanCatalog.card("pro").name) with AI · \(PlanCatalog.formatPrice(PlanCatalog.card("pro").monthlyCents))/mo")) { upgrade("pro") }
                            .buttonStyle(.folevi(.secondary, .medium))
                    }
                    .disabled(busy != nil)
                    .padding(.top, 24)
                }
                FoleviColor.line.frame(height: 1).padding(.top, 24)
                HStack(spacing: 12) {
                    Text("Not using this device?").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    Spacer(minLength: 0)
                    SafeSignOutButton(label: String(localized: "Sign out here"))
                }
                .padding(.top, 16)
            }
        }
        .task { await load() }
    }

    private func row(_ s: SessionInfo) -> some View {
        HStack(spacing: 12) {
            DeviceGlyph(client: s.client, label: s.label, size: 32)
            VStack(alignment: .leading, spacing: 0) {
                Text(s.label).font(.ui(13, .medium)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                Text("Active \(WebFormat.relative(s.lastSeenAt))").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(busy == s.id ? String(localized: "Signing out…") : String(localized: "Sign out")) {
                run(s.id) { convex in try await convex.mutationVoid("users:revokeSession", ["sessionId": .string(s.id)]) }
            }
            .buttonStyle(.folevi(.secondary, .small))
            .disabled(busy != nil)
            .accessibilityLabel(Text("Sign out \(s.label)"))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func upgrade(_ plan: String) {
        let checkout = billing?.checkoutAvailable == true
        run(plan) { convex in
            if checkout {
                let r: CheckoutURL = try await convex.action("billing:checkout", ["plan": .string(plan), "interval": .string("month")])
                if let url = r.url.flatMap(URL.init(string:)) { await MainActor.run { _ = NSWorkspace.shared.open(url) } }
            } else {
                try await convex.mutationVoid("billing:testPurchase", ["plan": .string(plan), "interval": .string("month")])
            }
        }
    }

    /// Runs one action; when it lands, ask the server again (the limit lifts once a device is out).
    private func run(_ key: String, _ action: @escaping @Sendable (ConvexService) async throws -> Void) {
        guard let convex = app.convex else { return }
        busy = key
        error = nil
        Task {
            do {
                try await action(convex)
                busy = nil
                await load()
                await app.routeAfterAuth(silent: false)
            } catch {
                busy = nil
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }

    private func load() async {
        guard let convex = app.convex else { return }
        async let list: [SessionInfo]? = try? convex.query("users:listSessions")
        async let flags: BillingFlags? = try? convex.query("billing:mine")
        sessions = await list ?? sessions ?? []
        billing = await flags ?? billing
    }
}
