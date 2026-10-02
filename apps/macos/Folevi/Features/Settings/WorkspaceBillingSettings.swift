import SwiftUI

/// Settings → (workspace) Plan & billing (the web's WorkspaceBillingSection): the open workspace's own plan
/// (Free, Core, Pro or Pro AI), billed per member seat. Only its owner and the admins the owner allowed see
/// it; the server refuses everyone else. Nothing here touches anyone's Personal plan. Same Convex functions
/// as the web; paying opens Polar's page in the browser. Live: a change on the web shows up here.
struct WorkspaceBillingSettings: View {
    @Environment(AppModel.self) private var app
    @State private var data: WorkspaceBillingSummary?
    @State private var failure: String?
    @State private var yearly = false
    @State private var busy: String?
    @State private var buyFor: CreditPurchase?

    var body: some View {
        SettingsPage {
            if let w = app.workspace {
                if let data {
                    let b = WorkspaceBilling(s: data, name: w.name)
                    planCard(b, workspaceId: w.id)
                    choosePlanCard(b, workspaceId: w.id)
                    historyCard(b)
                } else if let failure {
                    OfflineNote(text: failure)
                } else if !app.sync.isOnline {
                    OfflineNote(text: String(localized: "The workspace plan is shown when you're online."))
                } else {
                    Text("Loading the workspace plan…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                }
            }
        }
        .task(id: "\(app.workspace?.id ?? "")-\(app.sync.isOnline)") { await watch() }
        .foleviDialog(item: $buyFor) { purchase in BuyCreditsSheet(purchase: purchase).environment(app) }
    }

    // MARK: Workspace plan

    private func planCard(_ b: WorkspaceBilling, workspaceId: String) -> some View {
        SettingsCard(title: String(localized: "Workspace plan")) {
            BillingCardBody {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        PlanHeading(name: b.current.name, interval: b.intervalPill, status: b.status, pastDue: b.status == String(localized: "Past due"))
                        muted(b.description)
                        if let line = b.priceLine { muted(line) }
                        if b.someoneElsePays {
                            Text("The person who started this subscription pays for it, and only they can open the billing portal for invoices and the payment method. You can still change, cancel or resume the plan here.")
                                .font(.ui(12.5))
                                .foregroundStyle(FoleviColor.inkFaint)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 8) {
                        if b.canOpenPortal {
                            Button {
                                run("portal") { openBillingPage(try await $0.workspacePortal(workspaceId)) }
                            } label: {
                                HStack(spacing: 7) {
                                    Image(systemName: "creditcard").font(.system(size: 13)).accessibilityHidden(true)
                                    Text("Manage billing")
                                }
                            }
                            .buttonStyle(.folevi(.secondary, .medium))
                        }
                        if b.canCancelOrResume {
                            if b.cancelScheduled {
                                Button("Resume subscription") {
                                    run("resume", done: String(localized: "The plan will keep renewing.")) { try await $0.workspaceResume(workspaceId) }
                                }
                                .buttonStyle(.folevi(.secondary, .medium))
                            } else {
                                Button("Cancel plan") { endPlan(b, workspaceId: workspaceId) }
                                    .buttonStyle(.folevi(.ghost, .medium))
                            }
                        }
                    }
                    .fixedSize()
                }

                Grid(horizontalSpacing: 16, verticalSpacing: 16) {
                    GridRow {
                        BillingTile(title: b.seatsTitle) {
                            BillingIcon(systemName: "person.2")
                        } content: {
                            TileText(text: b.guestsLine)
                            if let pending = b.pendingLine { TileNote(text: pending, top: 4) }
                        }
                        BillingTile(title: String(localized: "Estimated charge")) {
                            BillingIcon(systemName: "creditcard")
                        } content: {
                            TileText(text: b.chargeLine)
                            if let note = b.quantityNote { TileNote(text: note, top: 4) }
                        }
                    }
                    GridRow {
                        BillingTile(title: b.storageTitle) {
                            BillingIcon(systemName: "internaldrive")
                        } content: {
                            StorageTileBody(used: b.storageUsedLine, fraction: b.storageFraction, meterLabel: b.storageMeterLabel, note: b.storageNote)
                        }
                        BillingTile(title: String(localized: "AI credits")) {
                            AiIcon(size: 15)
                        } content: {
                            switch b.aiTile {
                            case .text(let text):
                                TileText(text: text)
                            case .credits(let credits, let canBuy):
                                TileNote(text: String(localized: "Yours in this workspace. Every member has their own."), top: 4)
                                CreditLinesView(credits: credits)
                                if canBuy {
                                    Button("Buy credits") { buyFor = CreditPurchase(target: .workspace(workspaceId), name: b.name) }
                                        .buttonStyle(.folevi(.secondary, .small))
                                        .padding(.top, 12)
                                }
                            }
                        }
                    }
                }
                .padding(.top, 20)

                if b.overLimit {
                    Text("\(Text("Over the storage limit.").fontWeight(.semibold)) \(Text("Everything already stored stays available, but new uploads are paused until space is freed or the plan is upgraded."))")
                        .font(.ui(13))
                        .foregroundStyle(FoleviColor.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(FoleviColor.destructiveSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .padding(.top, 16)
                }
            }
        }
    }

    // MARK: Choose a plan

    private func choosePlanCard(_ b: WorkspaceBilling, workspaceId: String) -> some View {
        SettingsCard(title: String(localized: "Choose a workspace plan"),
                     description: String(localized: "Workspace plans are billed per member. Guests are free.")) {
            BillingCardBody {
                BillingPeriodToggle(yearly: $yearly, saving: PlanCatalog.bestYearlySaving)
                    .padding(.bottom, 16)
                PlanCardsGrid(plans: PlanCatalog.workspace) { plan in
                    PlanCardView(plan: plan, yearly: yearly, isCurrent: b.isCurrent(plan.tier, yearly: yearly),
                                 priceNote: b.priceNote(plan, yearly: yearly), noteMinHeight: 36,
                                 action: b.action(for: plan.tier, yearly: yearly, busy: busy),
                                 onChoose: { choose(plan.tier, b, workspaceId: workspaceId) },
                                 onSwitchToFree: { endPlan(b, workspaceId: workspaceId) })
                }
                BillingFootnote(text: b.footnote)
            }
        }
    }

    // MARK: History

    private func historyCard(_ b: WorkspaceBilling) -> some View {
        SettingsCard(title: String(localized: "Billing history"), description: b.historyDescription) {
            BillingCardBody {
                BillingHistoryTable(rows: b.s.payments.map { p in
                    .init(id: p.id, date: BillingCopy.dateTime(p.createdAt), plan: WorkspaceBilling.paymentPlan(p),
                          amount: BillingCopy.amount(p.amountCents, currency: p.currency), status: BillingCopy.status(p.status), failed: p.status == "failed")
                })
            }
        }
    }

    private func muted(_ text: String) -> some View {
        Text(text).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
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

    private func endPlan(_ b: WorkspaceBilling, workspaceId: String) {
        run("cancel", done: b.endPlanToast) { try await $0.workspaceCancel(workspaceId) }
    }

    private func choose(_ tier: String, _ b: WorkspaceBilling, workspaceId: String) {
        let planId = PlanCatalog.workspacePlanId(tier, yearly: yearly)
        if b.polarLive {
            run(tier, done: b.changeToast(tier)) { try await $0.workspaceChangePlan(workspaceId, planId: planId) }
        } else if b.s.checkoutAvailable {
            run(tier) { openBillingPage(try await $0.workspaceCheckout(workspaceId, planId: planId)) }
        } else if b.s.testPurchases {
            run(tier, done: b.testToast(tier)) { try await $0.workspaceTestPurchase(workspaceId, planId: planId) }
        }
    }

    // MARK: Loading

    private func watch() async {
        guard let session = app.session, let w = app.workspace, app.sync.isOnline else { return }
        do {
            for try await value in BillingRepository(convex: session.convex).workspaceUpdates(w.id) {
                data = value
                failure = nil
            }
        } catch {
            if data == nil { failure = ConvexService.mapError(error).localizedDescription }
        }
    }
}
