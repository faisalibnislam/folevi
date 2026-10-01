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
