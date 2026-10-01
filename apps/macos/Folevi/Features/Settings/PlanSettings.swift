import SwiftUI

/// Opens a page of the web app (security and a few other pages are managed there, as on the web).
@MainActor
func openWebApp(_ path: String, config: AppConfig) {
    guard let origin = config.appOrigin else { return }
    NSWorkspace.shared.open(origin.appending(path: path))
}

/// Settings → Plan & billing (the web's BillingSection): your Personal plan (Free, Core, Pro or Pro AI),
/// storage, AI credits and devices; choosing a plan; AI credits everywhere you have them (buying more); and
/// your payment history. Everything runs through the same Convex functions as the web; paying opens
/// Polar's page in the browser. Live: a purchase on the web shows up here.
struct PlanSettings: View {
    @Environment(AppModel.self) private var app
    @State private var billing: BillingSummary?
    @State private var accounts: CreditAccountsResponse?
    @State private var failure: String?
    @State private var yearly = true
    @State private var busy: String?
    @State private var buyFor: CreditPurchase?

    var body: some View {
        SettingsPage {
            if let billing {
                let p = PersonalBilling(b: billing)
                planCard(p)
                choosePlanCard(p)
                creditsCard
                historyCard(billing)
            } else if let failure {
                OfflineNote(text: failure)
            } else if !app.sync.isOnline {
                OfflineNote(text: String(localized: "Your plan is shown when you're online."))
            } else {
                Text("Loading your plan…").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .task(id: app.sync.isOnline) { await watchBilling() }
        .task(id: "credits-\(app.sync.isOnline)") { await watchAccounts() }
        .sheet(item: $buyFor) { purchase in BuyCreditsSheet(purchase: purchase).environment(app) }
    }

    // MARK: Your plan

    private func planCard(_ p: PersonalBilling) -> some View {
        SettingsCard(title: String(localized: "Your plan")) {
            BillingCardBody {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        PlanHeading(name: p.planLabel, interval: p.intervalPill, status: p.status, pastDue: p.status == String(localized: "Past due"))
                        Text(p.description)
                            .font(.ui(14))
                            .foregroundStyle(FoleviColor.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 8) {
                        if p.polar {
                            Button { openPortal() } label: {
                                HStack(spacing: 7) {
                                    Image(systemName: "creditcard").font(.system(size: 13)).accessibilityHidden(true)
                                    Text("Manage billing")
                                }
                            }
                            .buttonStyle(.folevi(.secondary, .medium))
                        }
                        if p.selfServe {
                            if p.cancelScheduled {
                                Button("Resume subscription") {
                                    run("resume", done: String(localized: "Your plan will keep renewing.")) { try await $0.resumePlan() }
                                }
                                .buttonStyle(.folevi(.secondary, .medium))
                            } else {
                                Button("Cancel plan") { switchToFree() }
                                    .buttonStyle(.folevi(.ghost, .medium))
                            }
                        }
                    }
                    .fixedSize()
                }

                Grid(horizontalSpacing: 16, verticalSpacing: 16) {
                    GridRow {
                        BillingTile(title: String(localized: "Storage")) {
                            BillingIcon(systemName: "internaldrive")
                        } content: {
                            StorageTileBody(used: p.storageUsedLine, fraction: p.storageFraction, meterLabel: String(localized: "Storage used"), note: p.storageNote)
                        }
                        BillingTile(title: String(localized: "AI credits")) {
                            AiIcon(size: 15)
                        } content: {
                            if let c = p.b.credits, c.aiIncluded {
                                CreditLinesView(credits: c)
                            } else {
                                TileText(text: String(localized: "Core doesn't include AI, so nothing in your notes is sent to an AI model. Pro and Pro AI come with AI credits every month."))
                            }
                        }
                    }
                    GridRow {
                        devicesRow(p).gridCellColumns(2)
                    }
                }
                .padding(.top, 20)
            }
        }
    }

    private func devicesRow(_ p: PersonalBilling) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    BillingIcon(systemName: "laptopcomputer.and.iphone").frame(width: 15, height: 15)
                    Text("Devices").font(.ui(13, .semibold))
                }
                .foregroundStyle(FoleviColor.heading)
                .accessibilityAddTraits(.isHeader)
                TileText(text: p.devicesLine)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ManageDevicesLink()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: Choose a plan

    private func choosePlanCard(_ p: PersonalBilling) -> some View {
        SettingsCard(title: String(localized: "Choose a personal plan"),
                     description: String(localized: "Your plan applies to your personal account. Workspaces have their own plans, members, limits and billing.")) {
            BillingCardBody {
                BillingPeriodToggle(yearly: $yearly, saving: PlanCatalog.bestYearlySaving)
                    .padding(.bottom, 16)
                PlanCardsGrid(plans: PlanCatalog.personal) { plan in
                    PlanCardView(plan: plan, yearly: yearly, isCurrent: p.isCurrent(plan.tier, yearly: yearly),
                                 priceNote: PersonalBilling.priceNote(plan, yearly: yearly),
                                 action: p.action(for: plan.tier, yearly: yearly, busy: busy),
                                 onChoose: { choose(plan.tier, p) },
                                 onSwitchToFree: switchToFree)
                }
                BillingFootnote(text: p.footnote)
            }
        }
    }

    // MARK: AI credits

    private var creditsCard: some View {
        SettingsCard(title: String(localized: "AI credits"),
                     description: String(localized: "Monthly credits reset each billing period. Extra credits you buy last \(PlanCatalog.packValidMonths) months and are used after the monthly ones.")) {
            BillingCardBody {
                if let accounts {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(accounts.accounts.enumerated()), id: \.element.id) { i, a in
                            if i > 0 { FoleviColor.line.opacity(0.7).frame(height: 1) }
                            accountRow(a)
                                .padding(.top, i == 0 ? 0 : 12)
                                .padding(.bottom, i == accounts.accounts.count - 1 ? 0 : 12)
                        }
                    }
                } else if !app.sync.isOnline {
                    OfflineNote(text: String(localized: "Your AI credits are shown when you're online."))
                } else {
                    Text("Loading your AI credits…").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                }
                BillingFootnote(text: String(localized: "In free workspaces, and on pages shared with you as a guest, AI uses your Personal credits."), top: 16)
            }
        }
    }

    private func accountRow(_ a: CreditAccountsResponse.Account) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Text(a.name).fontWeight(.semibold).foregroundStyle(FoleviColor.heading)) \(Text("· \(a.plan)").foregroundStyle(FoleviColor.inkMuted))")
                    .font(.ui(14))
                Text(BillingCopy.accountLine(a))
                    .font(.ui(14))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if a.canBuy {
                Button("Buy credits") {
                    let target: BillingRepository.CreditTarget = a.kind == "seat" && a.workspaceId != nil ? .workspace(a.workspaceId!) : .personal
                    buyFor = CreditPurchase(target: target, name: a.name)
                }
                .buttonStyle(.folevi(.secondary, .small))
            } else if a.kind == "personal" && a.aiIncluded {
                Text("Extra credits come with Pro and Pro AI.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkFaint)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("AI credits: \(a.name)"))
    }

    // MARK: History

    private func historyCard(_ b: BillingSummary) -> some View {
        SettingsCard(title: String(localized: "Billing history")) {
            BillingCardBody {
                BillingHistoryTable(rows: (b.payments ?? []).map { p in
                    .init(id: p.id, date: BillingCopy.dateTime(p.createdAt), plan: PersonalBilling.paymentPlan(p),
                          amount: BillingCopy.amount(p.amountCents, currency: p.currency), status: BillingCopy.status(p.status), failed: p.status == "failed")
                })
            }
        }
    }

    // MARK: Actions

    /// Runs one billing change: `busy` names it while it runs; success shows `done`, failure the server's message.
    private func run(_ key: String, done: String? = nil, _ op: @escaping @MainActor (BillingRepository) async throws -> Void) {
        guard busy != key, let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        let repo = BillingRepository(convex: session.convex)
        busy = key
        Task {
            defer { busy = nil }
            do {
                try await op(repo)
                if let done { app.showToast(done) }
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func openPortal() {
        run("portal") { openBillingPage(try await $0.portal()) }
    }

    private func switchToFree() {
        run("free", done: String(localized: "Your plan will end at the close of this billing period.")) { try await $0.cancelPlan() }
    }

    private func choose(_ tier: String, _ p: PersonalBilling) {
        let interval = yearly
        if p.checkoutAvailable {
            run(tier) { repo in
                // No page: the running Polar subscription was switched to the new plan.
                if let url = try await repo.checkout(plan: tier, yearly: interval) {
                    openBillingPage(url)
                } else {
                    app.showToast(String(localized: "Your plan is changing. It can take a moment."))
                }
            }
        } else if p.testPurchases {
            run(tier, done: String(localized: "You're on \(PlanTier.name(tier)) (test purchase).")) { try await $0.testPurchase(plan: tier, yearly: interval) }
        }
    }

    // MARK: Loading

    private func watchBilling() async {
        guard let session = app.session, app.sync.isOnline else { return }
        do {
            for try await b in BillingRepository(convex: session.convex).mineUpdates() {
                billing = b
                failure = nil
            }
        } catch {
            if billing == nil { failure = ConvexService.mapError(error).localizedDescription }
        }
    }

    private func watchAccounts() async {
        guard let session = app.session, app.sync.isOnline else { return }
        do {
            for try await r in BillingRepository(convex: session.convex).creditAccountsUpdates() { accounts = r }
        } catch {}
    }
}

/// "Manage devices": the web's underlined link to Settings → Devices.
struct ManageDevicesLink: View {
    @State private var hovering = false

    var body: some View {
        Button { SettingsRouter.shared.section = .devices } label: {
            Text("Manage devices")
                .font(.ui(13, .medium))
                .foregroundStyle(FoleviColor.heading)
                .underline(true, color: hovering ? FoleviColor.heading : FoleviColor.lineStrong)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(.isLink)
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
