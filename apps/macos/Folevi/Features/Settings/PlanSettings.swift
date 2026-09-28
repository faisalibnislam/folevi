import SwiftUI

/// Opens a page of the web app (plans, billing and security are managed there, as on the web).
@MainActor
func openWebApp(_ path: String, config: AppConfig) {
    guard let origin = config.appOrigin else { return }
    NSWorkspace.shared.open(origin.appending(path: path))
}

/// Plan & billing (the web's Settings → Plan & billing, read-only here): the plan, trial, what it
/// includes and what's used. Changing plans and payment happen on the web.
struct PlanSettings: View {
    @Environment(AppModel.self) private var app
    @State private var billing: BillingSummary?
    @State private var failed = false

    var body: some View {
        Form {
            if let billing {
                let e = billing.entitlements
                Section("Your plan") {
                    LabeledContent("Plan") {
                        HStack(spacing: 6) {
                            Text(e.planName).fontWeight(.semibold)
                            if e.trialing {
                                Text("Trial · \(e.trialDaysLeft) days left")
                                    .font(.ui(11, .semibold))
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            }
                        }
                    }
                    if let sub = billing.subscription, sub.plan != "free", let end = sub.currentPeriodEnd {
                        LabeledContent(sub.cancelAtPeriodEnd ? "Ends" : "Renews",
                                       value: Date(timeIntervalSince1970: end / 1000).formatted(date: .long, time: .omitted))
                    }
                    LabeledContent("AI Assistant", value: e.ai ? String(localized: "Included") : String(localized: "Not included"))
                    LabeledContent("Devices", value: e.deviceLimit.map { String(localized: "\(Int(billing.devicesActive)) of \($0)") } ?? String(localized: "\(Int(billing.devicesActive)) · unlimited"))
                }
                Section("Storage") {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: min(1, billing.storageUsedBytes / max(1, e.storageBytes)))
                            .tint(FoleviColor.heading)
                        Text("\(ByteCountFormatter.string(fromByteCount: Int64(billing.storageUsedBytes), countStyle: .file)) of \(ByteCountFormatter.string(fromByteCount: Int64(e.storageBytes), countStyle: .file)) used")
                            .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
                Section {
                    HStack {
                        Text(e.paidPlan == "free" ? "Plans and payment are managed on the web." : "Change plan, payment method or invoices on the web.")
                            .foregroundStyle(FoleviColor.inkMuted)
                        Spacer()
                        Button(e.trialing ? "Choose Plan…" : e.paidPlan == "free" ? "See Plans…" : "Manage Billing…") {
                            openWebApp("settings/billing", config: app.config)
                        }
                        .buttonStyle(.folevi(.primary))
                    }
                }
            } else if failed || !app.sync.isOnline {
                Text("Your plan is shown when you're online.").foregroundStyle(FoleviColor.inkMuted)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(CanvasBackground())
        .task { await load() }
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        do { billing = try await session.account.billing() } catch { failed = true }
    }
}

/// Devices (the web's Settings → Devices): how many are connected against the plan's limit, and every
/// signed-in browser and app with Sign Out.
struct DevicesSettings: View {
    @Environment(AppModel.self) private var app
    @State private var sessions: [SessionInfo] = []
    @State private var loading = false

    private var limit: Int? { app.profile?.entitlements?.deviceLimit }

    var body: some View {
        Form {
            if !app.sync.isOnline {
                Text("Devices are shown when you're online.").foregroundStyle(FoleviColor.inkMuted)
            } else {
                Section("Connected devices") {
                    let active = sessions.filter { $0.revokedAt == nil }.count
                    VStack(alignment: .leading, spacing: 6) {
                        Text(limit.map { String(localized: "\(active) of \($0) devices connected") } ?? String(localized: "\(active) devices connected · unlimited"))
                            .fontWeight(.semibold)
                        if let limit {
                            ProgressView(value: min(1, Double(active) / Double(max(1, limit))))
                                .tint(active > limit ? FoleviColor.destructive : FoleviColor.heading)
                            Text("The Free plan works on \(limit) devices at a time. Basic and Pro have no limit.")
                                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                        }
                    }
                }
                Section("Signed in") {
                    if loading && sessions.isEmpty { ProgressView().controlSize(.small) }
                    ForEach(sessions) { s in
                        HStack {
                            Image(systemName: s.client == "mac" ? "laptopcomputer" : "globe").accessibilityHidden(true)
                            VStack(alignment: .leading) {
                                Text(s.label)
                                Text("Last active \(Date(timeIntervalSince1970: s.lastSeenAt / 1000).formatted(.relative(presentation: .named)))")
                                    .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
                            }
                            Spacer()
                            if s.current {
                                Text("This Mac")
                                    .font(.ui(11, .semibold))
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            } else if s.revokedAt != nil {
                                Text("Signed out").font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint)
                            } else {
                                Button("Sign Out") { revoke(s.id) }
                            }
                        }
                    }
                }
                if limit != nil {
                    Section {
                        HStack {
                            Text("Need more devices?").foregroundStyle(FoleviColor.inkMuted)
                            Spacer()
                            Button("See Plans…") { openWebApp("settings/billing", config: app.config) }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(CanvasBackground())
        .task { await load() }
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        loading = true
        defer { loading = false }
        sessions = (try? await session.account.sessions()) ?? []
    }

    private func revoke(_ id: String) {
        app.perform(String(localized: "Signing out a device")) { try await $0.account.revokeSession(id) }
        Task {
            try? await Task.sleep(for: .milliseconds(600))
            await load()
        }
    }
}
