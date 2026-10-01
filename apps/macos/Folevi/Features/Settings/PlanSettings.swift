import SwiftUI

/// Opens a page of the web app (plans, billing and security are managed there, as on the web).
@MainActor
func openWebApp(_ path: String, config: AppConfig) {
    guard let origin = config.appOrigin else { return }
    NSWorkspace.shared.open(origin.appending(path: path))
}

/// Plan & billing (the web's Settings → Plan & billing, read-only here): your Personal plan, storage, AI
/// credits and devices; the plans; AI credits everywhere you have them; and payment history. Choosing a
/// plan, buying credits and payment happen on the web. Live: a purchase on the web shows up here.
struct PlanSettings: View {
    @Environment(AppModel.self) private var app
    @State private var billing: BillingSummary?
    @State private var accounts: [CreditAccountsResponse.Account]?
    @State private var failed = false
    @State private var yearly = true

    var body: some View {
        Form {
            if let billing {
                planSection(billing)
                choosePlanSection(billing)
                creditsSection
                historySection(billing)
            } else if failed || !app.sync.isOnline {
                Text("Your plan is shown when you're online.").foregroundStyle(FoleviColor.inkMuted)
            } else {
                Text("Loading your plan…").foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(CanvasBackground())
        .task(id: app.sync.isOnline) { await watchBilling() }
        .task(id: "credits-\(app.sync.isOnline)") { await watchAccounts() }
    }

    // MARK: Your plan

    @ViewBuilder private func planSection(_ b: BillingSummary) -> some View {
        let e = b.entitlements
        let current = PlanCatalog.card(e.paidPlan)
        let sub = b.subscription
        let paid = e.paid ?? (e.paidPlan != "free")
        let cancelScheduled = paid && sub?.cancelAtPeriodEnd == true && sub?.currentPeriodEnd != nil
        let status: String? = e.trialing ? String(localized: "Trial") : !paid ? nil
            : sub?.status == "past_due" ? String(localized: "Past due") : cancelScheduled ? String(localized: "Cancel scheduled") : String(localized: "Active")
        let polar = sub?.provider == "polar"
        Section("Your plan") {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(e.trialing ? String(localized: "Pro AI trial") : current.name)
                            .font(FoleviType.display(24))
                            .foregroundStyle(FoleviColor.heading)
                        if paid, let interval = sub?.interval {
                            pill(interval == "year" ? String(localized: "Annual") : String(localized: "Monthly"))
                        }
                        if let status { pill(status, danger: status == String(localized: "Past due")) }
                    }
                    Text(planDescription(b, current: current, paid: paid, polar: polar))
                        .font(.ui(13))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Button(polar ? "Manage billing" : "Open on the web") { openBilling(app) }
                    .buttonStyle(.folevi(.secondary, .small))
            }
            .padding(.vertical, 4)

            tile(systemImage: "internaldrive", title: String(localized: "Storage")) {
                let limit = b.storageLimitBytes ?? e.storageBytes
                Text("\(PlanCatalog.formatBytes(b.storageUsedBytes)) of \(PlanCatalog.formatBytes(limit)) used")
                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                UsageMeter(fraction: b.storageUsedBytes / max(1, limit), label: String(localized: "Storage used"))
                Text(storageNote(b, current: current)).font(.ui(12.5)).foregroundStyle(FoleviColor.inkFaint)
            }

            tile(ai: true, title: String(localized: "AI credits")) {
                if let c = b.credits, c.aiIncluded {
                    Text("\(AiCreditCopy.count(c.available)) left").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    if c.allowance > 0 {
                        UsageMeter(fraction: c.monthlyLeft / c.allowance, label: String(localized: "Monthly AI credits left"), invert: true)
                    }
                    Text(AiCreditCopy.detail(available: c.available, allowance: c.allowance, monthlyLeft: c.monthlyLeft, packCredits: c.packCredits,
                                             resetsAt: c.resetsAt, nextPackExpiry: c.nextPackExpiry, trialing: c.trialing))
                        .font(.ui(12.5)).foregroundStyle(FoleviColor.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                    if c.canBuy {
                        Button("Buy AI credits…") { openBilling(app) }
                            .buttonStyle(.folevi(.secondary, .small))
                            .padding(.top, 2)
                    }
                } else {
                    Text("Core doesn't include AI, so nothing in your notes is sent to an AI model. Pro and Pro AI come with AI credits every month.")
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            tile(systemImage: "laptopcomputer.and.iphone", title: String(localized: "Devices")) {
                let active = Int(b.devicesActive)
                if let limit = e.deviceLimit {
                    Text(active > limit ? String(localized: "\(min(active, limit)) of \(limit) devices in use · \(active - limit) waiting")
                         : String(localized: "\(min(active, limit)) of \(limit) devices in use"))
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                } else {
                    Text(e.trialing ? String(localized: "Unlimited during your trial · signed in on \(plural(active, String(localized: "device"), String(localized: "devices")))")
                         : String(localized: "Unlimited · signed in on \(plural(active, String(localized: "device"), String(localized: "devices")))"))
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                }
            }
        }
    }

    private func planDescription(_ b: BillingSummary, current: PlanCard, paid: Bool, polar: Bool) -> String {
        let e = b.entitlements
        let sub = b.subscription
        if e.trialing, let end = e.trialEndsAt {
            let days = e.trialDaysLeft
            return String(localized: "\(days) \(days == 1 ? String(localized: "day") : String(localized: "days")) of Pro AI left (until \(Self.dateOnly(end))). Then you'll move to Free unless you choose a plan.")
        }
        if paid, sub?.status == "past_due" {
            return polar ? String(localized: "Your last payment failed. Update your payment method in Manage billing to keep your plan.")
                : String(localized: "Your last payment failed.")
        }
        if paid, let end = sub?.currentPeriodEnd {
            if sub?.cancelAtPeriodEnd == true {
                return String(localized: "Ends \(Self.dateOnly(end)). Your \(current.name) features remain available until then.")
            }
            return sub?.provider == "manual" ? String(localized: "Set by the Folevi team until \(Self.dateOnly(end)).") : String(localized: "Renews \(Self.dateOnly(end)).")
        }
        if paid, sub?.provider == "manual" { return String(localized: "Set by the Folevi team.") }
        return current.blurb
    }

    private func storageNote(_ b: BillingSummary, current: PlanCard) -> String {
        let limit = PlanCatalog.formatBytes(b.storageLimitBytes ?? b.entitlements.storageBytes)
        switch b.storageRule ?? b.entitlements.storageRule {
        case "shared_free":
            let pool = Int(b.poolWorkspaces ?? 0)
            return pool > 0 ? String(localized: "Shared by your Personal and the \(plural(pool, String(localized: "free workspace"), String(localized: "free workspaces"))) you own.")
                : String(localized: "Shared with any free workspaces you create.")
        case "override":
            return String(localized: "A limit set by the Folevi team.")
        default:
            return b.entitlements.trialing ? String(localized: "Your own \(limit) during your trial.") : String(localized: "Your own \(limit) on \(current.name).")
        }
    }

    // MARK: Plans

    @ViewBuilder private func choosePlanSection(_ b: BillingSummary) -> some View {
        let e = b.entitlements
        let paid = e.paid ?? (e.paidPlan != "free")
        Section {
            FoleviSegmented(selection: $yearly, items: [
                .init(value: false, title: "Monthly"),
                .init(value: true, title: "Yearly · Save up to \(PlanCatalog.bestYearlySaving)%"),
            ], accessibilityLabel: "Billing period")
            .frame(width: 300)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(PlanCatalog.personal) { plan in
                    planCard(plan, e: e, paid: paid)
                }
            }
            Text("Plans and payment are managed on the web. AI credits: a rewrite uses about 1, Ask AI about 2, a flowchart 3 to 5.")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
        } header: {
            Text("Choose a personal plan")
        } footer: {
            Text("Your plan applies to your personal account. Workspaces have their own plans, members, limits and billing.")
                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
        }
    }

    private func planCard(_ plan: PlanCard, e: Entitlements, paid: Bool) -> some View {
        let price = yearly ? plan.yearlyCents : plan.monthlyCents
        let isCurrent = plan.paid ? e.paidPlanId == PlanCatalog.personalPlanId(plan.tier, yearly: yearly) : !paid
        let highlight = plan.tier == "pro_ai"
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(plan.name).font(FoleviType.display(19)).foregroundStyle(FoleviColor.heading)
                Spacer()
                if isCurrent {
                    Text("Current")
                        .font(.ui(11, .semibold))
                        .foregroundStyle(FoleviColor.canvas)
                        .padding(.horizontal, 8)
                        .frame(height: 20)
                        .background(FoleviColor.heading, in: Capsule())
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(PlanCatalog.formatPrice(price)).font(.ui(26, .semibold)).foregroundStyle(FoleviColor.heading)
                Text(yearly ? "/ year" : "/ month").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            }
            Text(!plan.paid ? String(localized: "No card required")
                 : yearly ? String(localized: "\(PlanCatalog.monthlyEquivalent(plan.yearlyCents))/month, billed yearly") : String(localized: "Billed monthly"))
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            Text(plan.blurb).font(.ui(13)).foregroundStyle(FoleviColor.ink).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 5) {
                ForEach(plan.features, id: \.self) { f in
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(FoleviColor.moss).accessibilityHidden(true)
                        Text(f).font(.ui(12.5)).foregroundStyle(FoleviColor.ink).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(.top, 2)
            Spacer(minLength: 6)
            if isCurrent {
                Button("Your plan") {}
                    .buttonStyle(.folevi(.secondary, .small, fullWidth: true))
                    .disabled(true)
            } else if plan.paid {
                Button(PlanCatalog.actionLabel(tier: plan.tier, yearly: yearly, paid: paid, paidPlan: e.paidPlan, trialing: e.trialing)) { openBilling(app) }
                    .buttonStyle(.folevi(highlight ? .primary : .secondary, .small, fullWidth: true))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(highlight
                      ? AnyShapeStyle(LinearGradient(colors: [Color(red: 0.545, green: 0.486, blue: 0.965).opacity(0.12), Color(red: 0.961, green: 0.541, blue: 0.722).opacity(0.10)],
                                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                      : AnyShapeStyle(FoleviGlass.hover))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(highlight ? Color(red: 0.486, green: 0.424, blue: 0.941).opacity(0.35) : FoleviGlass.border, lineWidth: highlight ? 1.5 : 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("\(plan.name) plan"))
    }

    // MARK: AI credits

    private var creditsSection: some View {
        Section {
            if let accounts {
                ForEach(accounts) { a in
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            (Text(a.name == "Personal" ? String(localized: "Personal") : a.name).fontWeight(.semibold).foregroundColor(FoleviColor.heading)
                             + Text(" · \(a.plan)").foregroundColor(FoleviColor.inkMuted))
                                .font(.ui(14))
                            Text(accountLine(a)).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        if a.canBuy {
                            Button("Buy credits") { openBilling(app) }
                                .buttonStyle(.folevi(.secondary, .small))
                        } else if a.kind == "personal" && a.aiIncluded {
                            Text("Extra credits come with Pro and Pro AI.").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            } else {
                Text("Loading your AI credits…").foregroundStyle(FoleviColor.inkMuted)
            }
        } header: {
            Text("AI credits")
        } footer: {
            Text("Monthly credits reset each billing period. Extra credits you buy last \(PlanCatalog.packValidMonths) months and are used after the monthly ones. In free workspaces, and on pages shared with you as a guest, AI uses your Personal credits.")
                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
        }
    }

    private func accountLine(_ a: CreditAccountsResponse.Account) -> String {
        guard a.aiIncluded else { return String(localized: "Not included in Core. Nothing is sent to an AI model.") }
        var line = a.trialing
            ? String(localized: "\(AiCreditCopy.count(a.available)) left · \(AiCreditCopy.grouped(a.monthlyLeft)) of \(AiCreditCopy.grouped(a.allowance)) trial credits, trial ends on \(AiCreditCopy.date(a.resetsAt))")
            : String(localized: "\(AiCreditCopy.count(a.available)) left · \(AiCreditCopy.grouped(a.monthlyLeft)) of \(AiCreditCopy.grouped(a.allowance)) monthly credits, resets on \(AiCreditCopy.date(a.resetsAt))")
        if a.packCredits > 0 {
            let extra = plural(Int(a.packCredits), String(localized: "extra credit"), String(localized: "extra credits"))
            line += a.nextPackExpiry.map { " · " + String(localized: "\(extra), the first expiring on \(AiCreditCopy.date($0))") } ?? " · \(extra)"
        }
        return line
    }

    // MARK: History

    private func historySection(_ b: BillingSummary) -> some View {
        Section("Billing history") {
            let payments = b.payments ?? []
            if payments.isEmpty {
                Text("No payments yet.").foregroundStyle(FoleviColor.inkMuted)
            } else {
                ForEach(payments) { p in
                    HStack(spacing: 12) {
                        Text(Date(timeIntervalSince1970: p.createdAt / 1000).formatted(date: .abbreviated, time: .shortened))
                            .frame(width: 170, alignment: .leading)
                        Text(p.plan == "credits" ? AiCreditCopy.count(p.credits ?? 0)
                             : "\(PlanTier.name(p.plan)) · \(p.interval == "year" ? String(localized: "yearly") : String(localized: "monthly"))")
                        Spacer()
                        Text("\(PlanCatalog.formatPrice(Int(p.amountCents))) \(p.currency.uppercased())").monospacedDigit()
                        Text(p.status.capitalized)
                            .foregroundStyle(p.status == "failed" ? FoleviColor.destructive : FoleviColor.inkMuted)
                            .frame(width: 70, alignment: .trailing)
                    }
                    .font(.ui(13))
                }
            }
        }
    }

    // MARK: Pieces

    private func pill(_ text: String, danger: Bool = false) -> some View {
        Text(text)
            .font(.ui(12))
            .foregroundStyle(danger ? FoleviColor.destructive : FoleviColor.inkMuted)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(danger ? FoleviColor.destructiveSoft : FoleviGlass.hover, in: Capsule())
    }

    private func tile<Content: View>(systemImage: String? = nil, ai: Bool = false, title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                if ai { AiIcon(size: 15) } else if let systemImage { Image(systemName: systemImage).font(.system(size: 13)).accessibilityHidden(true) }
                Text(title).font(.ui(13, .semibold))
            }
            .foregroundStyle(FoleviColor.heading)
            content()
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func plural(_ n: Int, _ one: String, _ many: String) -> String {
        "\(AiCreditCopy.grouped(n)) \(n == 1 ? one : many)"
    }

    /// "Oct 1, 2026" (UTC, like the server and Polar).
    static func dateOnly(_ ms: Double) -> String {
        let f = DateFormatter()
        f.dateFormat = "MMM d, yyyy"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    // MARK: Loading

    private func watchBilling() async {
        guard let session = app.session, app.sync.isOnline else { return }
        let stream: AsyncThrowingStream<BillingSummary, Error> = session.convex.subscribe("billing:mine")
        do {
            for try await b in stream { billing = b }
        } catch {
            if billing == nil { failed = true }
        }
    }

    private func watchAccounts() async {
        guard let session = app.session, app.sync.isOnline else { return }
        let stream: AsyncThrowingStream<CreditAccountsResponse, Error> = session.convex.subscribe("billing:creditAccounts")
        do {
            for try await r in stream { accounts = r.accounts }
        } catch {}
    }
}

/// A used-of-total bar (storage, credits); `invert` shows what's left and turns red when little is.
struct UsageMeter: View {
    var fraction: Double
    var label: String
    var invert = false

    var body: some View {
        let shown = min(1, max(0, fraction.isFinite ? fraction : 0))
        let alarm = invert ? shown < 0.1 : shown > 0.9
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(FoleviColor.ink.opacity(0.12))
                Capsule().fill(alarm ? FoleviColor.destructive : FoleviColor.heading)
                    .frame(width: geo.size.width * max(shown, 0.015))
            }
        }
        .frame(height: 8)
        .accessibilityElement()
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text("\(Int((shown * 100).rounded())) percent"))
    }
}
