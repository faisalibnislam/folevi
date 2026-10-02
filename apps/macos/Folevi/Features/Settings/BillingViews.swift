import AppKit
import SwiftUI

// The pieces Plan & billing (Personal and workspace) share, as on the web (BillingSection.tsx exports Tile,
// UsageMeter and CreditLines; the plan cards, the Monthly/Yearly switch and the history table are the same
// markup in both sections).

/// The web's plan colours that aren't tokens.
enum BillingColor {
    /// #2f9e62: the feature ticks.
    static let check = Color(red: 0.184, green: 0.620, blue: 0.384)
    /// The "Save up to N%" pill: #2f9e62 at 14%, text #1f7a4a (dark #6fd39b).
    static let saveFill = check.opacity(0.14)
    static let saveInk = Color(nsColor: .folevi(light: (0.122, 0.478, 0.290, 1), dark: (0.435, 0.827, 0.608, 1), name: "folevi.billing.save"))
    /// Pro AI's card: a 160° violet to pink wash and a violet ring.
    static let highlightFrom = Color(red: 0.545, green: 0.486, blue: 0.965).opacity(0.12)
    static let highlightTo = Color(red: 0.961, green: 0.541, blue: 0.722).opacity(0.10)
    static let highlightRing = Color(red: 0.486, green: 0.424, blue: 0.941).opacity(0.35)
}

/// Opens a page from Polar (checkout, the billing portal) in the browser.
@MainActor
func openBillingPage(_ url: URL?) {
    guard let url else { return }
    NSWorkspace.shared.open(url)
}

/// A rounded pill beside the plan's name ("Annual", "Active", "Past due").
struct BillingPill: View {
    var text: String
    var danger = false

    var body: some View {
        Text(text)
            .font(.ui(12))
            .foregroundStyle(danger ? FoleviColor.destructive : FoleviColor.inkMuted)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(danger ? FoleviColor.destructiveSoft : FoleviGlass.hover, in: Capsule())
    }
}

/// The plan's name (24 pt display) with its interval and status pills.
struct PlanHeading: View {
    var name: String
    var interval: String?
    var status: String?
    var pastDue: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Text(name)
                .font(FoleviType.display(24))
                .tracking(FoleviType.displayTracking(24))
                .foregroundStyle(FoleviColor.heading)
            if let interval { BillingPill(text: interval) }
            if let status { BillingPill(text: status, danger: pastDue) }
        }
    }
}

/// A tile in a plan card's grid (the web's Tile): a grey rounded box with an icon and a title.
struct BillingTile<Icon: View, Content: View>: View {
    var title: String
    @ViewBuilder var icon: Icon
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                icon.frame(width: 15, height: 15)
                Text(title).font(.ui(13, .semibold))
            }
            .foregroundStyle(FoleviColor.heading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// An SF Symbol at the web's 15 px icon size.
struct BillingIcon: View {
    var systemName: String
    var body: some View {
        Image(systemName: systemName).font(.system(size: 13, weight: .regular)).accessibilityHidden(true)
    }
}

/// Text in a tile: text-sm muted, 4 pt under what's above.
struct TileText: View {
    var text: String
    var body: some View {
        Text(text).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true).padding(.top, 4)
    }
}

/// The faint 12.5 pt note in a tile.
struct TileNote: View {
    var text: String
    var top: CGFloat = 8
    var body: some View {
        Text(text).font(.ui(12.5)).foregroundStyle(FoleviColor.inkFaint).fixedSize(horizontal: false, vertical: true).padding(.top, top)
    }
}

/// A used-of-total line, its meter and a note (the Storage tiles).
struct StorageTileBody: View {
    var used: String
    var fraction: Double
    var meterLabel: String
    var note: String

    var body: some View {
        TileText(text: used)
        UsageMeter(fraction: fraction, label: meterLabel).padding(.top, 10)
        TileNote(text: note)
    }
}

/// One place's AI credits (the web's CreditLines): what's left, the monthly meter, and the reset line.
struct CreditLinesView: View {
    var credits: PersonalCredits

    var body: some View {
        TileText(text: String(localized: "\(AiCreditCopy.count(credits.available)) left"))
        if credits.allowance > 0 {
            UsageMeter(fraction: credits.monthlyLeft / credits.allowance, label: String(localized: "Monthly AI credits left"), invert: true)
                .padding(.top, 10)
        }
        TileNote(text: BillingCopy.creditLine(credits))
    }
}

/// Monthly / Yearly (the web's `.ui-seg .ui-well`), Yearly with its green "Save up to N%".
struct BillingPeriodToggle: View {
    @Binding var yearly: Bool
    var saving: Int

    var body: some View {
        HStack(spacing: 2) {
            item(false, padding: 16)
            item(true, padding: 14)
        }
        .padding(3)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviGlass.border))
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Billing period"))
    }

    private func item(_ value: Bool, padding: CGFloat) -> some View {
        SegmentItem(active: yearly == value, padding: padding) {
            yearly = value
        } label: {
            HStack(spacing: 6) {
                Text(value ? String(localized: "Yearly") : String(localized: "Monthly"))
                if value {
                    Text("Save up to \(saving)%")
                        .font(.ui(11, .semibold))
                        .foregroundStyle(BillingColor.saveInk)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(BillingColor.saveFill, in: Capsule())
                        .fixedSize()
                }
            }
        }
    }

    private struct SegmentItem<Label: View>: View {
        var active: Bool
        var padding: CGFloat
        var action: () -> Void
        @ViewBuilder var label: Label
        @State private var hovering = false

        var body: some View {
            Button(action: action) {
                label
                    .font(.ui(12.5, active ? .semibold : .medium))
                    .foregroundStyle(active || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                    .lineLimit(1)
                    .padding(.horizontal, padding)
                    .frame(height: 32)
                    .background {
                        if active {
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(FoleviGlass.active)
                                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(FoleviGlass.border))
                                .shadow(color: .black.opacity(0.08), radius: 1.5, y: 1)
                        }
                    }
                    .contentShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .accessibilityAddTraits(active ? [.isSelected] : [])
        }
    }
}

/// One plan in the "Choose a plan" grid.
struct PlanCardView: View {
    var plan: PlanCard
    var yearly: Bool
    var isCurrent: Bool
    /// The line under the price ("No card required", "Per member. 3 members × $4.99 = …").
    var priceNote: String
    var noteMinHeight: CGFloat = 20
    var action: PlanCardAction
    var onChoose: () -> Void
    var onSwitchToFree: () -> Void

    private var highlight: Bool { plan.tier == "pro_ai" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(plan.name)
                    .font(FoleviType.display(19))
                    .tracking(FoleviType.displayTracking(19))
                    .foregroundStyle(FoleviColor.heading)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if isCurrent {
                    Text("Current")
                        .font(.ui(11, .semibold))
                        .foregroundStyle(FoleviColor.canvas)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(FoleviColor.heading, in: Capsule())
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                let price = yearly ? plan.yearlyCents : plan.monthlyCents
                Text(PlanCatalog.formatPrice(price))
                    .font(.ui(30, .semibold))
                    .tracking(-0.75)
                    .foregroundStyle(FoleviColor.heading)
                Text(" / \(BillingCopy.per(yearly: yearly))").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            }
            .padding(.top, 8)
            Text(priceNote)
                .font(.ui(12.5))
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: noteMinHeight, alignment: .topLeading)
            Text(plan.blurb)
                .font(.ui(13))
                .foregroundStyle(FoleviColor.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(plan.features, id: \.self) { f in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(BillingColor.check)
                            .frame(width: 15, height: 15)
                            .padding(.top, 1)
                            .accessibilityHidden(true)
                        Text(f).font(.ui(13)).foregroundStyle(FoleviColor.ink).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(.top, 12)
            Spacer(minLength: 0)
            bottom.padding(.top, 16)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(highlight
                      ? AnyShapeStyle(LinearGradient(colors: [BillingColor.highlightFrom, BillingColor.highlightTo],
                                                     startPoint: UnitPoint(x: 0.33, y: 0), endPoint: UnitPoint(x: 0.67, y: 1)))
                      : AnyShapeStyle(FoleviGlass.hover))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(highlight ? BillingColor.highlightRing : FoleviGlass.border, lineWidth: highlight ? 1.5 : 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("\(plan.name) plan"))
    }

    @ViewBuilder private var bottom: some View {
        switch action {
        case .current(let title):
            Button(title) {}.buttonStyle(.folevi(.secondary, .medium, fullWidth: true)).disabled(true)
        case .switchToFree:
            Button("Switch to Free", action: onSwitchToFree).buttonStyle(.folevi(.ghost, .medium, fullWidth: true))
        case .note(let text):
            Text(text).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity).fixedSize(horizontal: false, vertical: true)
        case .choose(let title, let primary, let disabled):
            Button(title, action: onChoose)
                .buttonStyle(.folevi(primary ? .primary : .secondary, .medium, fullWidth: true))
                .disabled(disabled)
        case .comingSoon:
            Button("Coming soon") {}.buttonStyle(.folevi(.secondary, .medium, fullWidth: true)).disabled(true)
        case .nothing:
            EmptyView()
        }
    }
}

/// The four plans in a two-column grid (the web's `sm:grid-cols-2` at a Settings window's width), rows of equal height.
struct PlanCardsGrid<Card: View>: View {
    var plans: [PlanCard]
    @ViewBuilder var card: (PlanCard) -> Card

    var body: some View {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            ForEach(Array(stride(from: 0, to: plans.count, by: 2)), id: \.self) { i in
                GridRow {
                    card(plans[i])
                    if i + 1 < plans.count { card(plans[i + 1]) } else { Color.clear }
                }
            }
        }
    }
}

/// The small faint paragraph under a card's content.
struct BillingFootnote: View {
    var text: String
    var top: CGFloat = 12
    var body: some View {
        Text(text).font(.ui(12.5)).foregroundStyle(FoleviColor.inkFaint).fixedSize(horizontal: false, vertical: true).padding(.top, top)
    }
}

/// "Billing history": Date, Plan, Amount and Status, hairlines between rows; "No payments yet." when empty.
struct BillingHistoryTable: View {
    struct Row: Identifiable {
        var id: String
        var date: String
        var plan: String
        var amount: String
        var status: String
        var failed: Bool
    }
    var rows: [Row]

    var body: some View {
        if rows.isEmpty {
            Text("No payments yet.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
        } else {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 0) {
                GridRow {
                    Text("Date")
                    Text("Plan").frame(maxWidth: .infinity, alignment: .leading)
                    Text("Amount").gridColumnAlignment(.trailing)
                    Text("Status").gridColumnAlignment(.trailing)
                }
                .font(.ui(12, .medium))
                .foregroundStyle(FoleviColor.inkMuted)
                .padding(.bottom, 8)
                ForEach(rows) { r in
                    FoleviColor.line.opacity(0.7).frame(height: 1)
                    GridRow {
                        Text(r.date).foregroundStyle(FoleviColor.ink)
                        Text(r.plan).foregroundStyle(FoleviColor.ink)
                        Text(r.amount).monospacedDigit().foregroundStyle(FoleviColor.ink)
                        Text(r.status).foregroundStyle(r.failed ? FoleviColor.destructive : FoleviColor.inkMuted)
                    }
                    .font(.ui(13))
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

// MARK: - Buying AI credits

/// Who a credit pack is for (a sheet's item).
struct CreditPurchase: Identifiable {
    var target: BillingRepository.CreditTarget
    var name: String
    var id: String {
        switch target {
        case .personal: return "personal"
        case .workspace(let w): return w
        }
    }
}

/// Buying an AI credit pack (the web's BuyCreditsDialog): 500 or 1,000 credits, one time, valid 12 months,
/// used after the monthly credits. Opens Polar Checkout in the browser; in development without payments it
/// adds a test pack here.
struct BuyCreditsSheet: View {
    var purchase: CreditPurchase
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var status: CreditAccountsResponse?
    @State private var busy: String?

    private var test: Bool { status.map { $0.checkoutAvailable != true && $0.testPurchases == true } ?? false }
    private var canBuy: Bool { status.map { $0.checkoutAvailable == true || $0.testPurchases == true } ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Buy AI credits")
                        .font(FoleviType.display(21))
                        .tracking(FoleviType.displayTracking(21))
                        .foregroundStyle(FoleviColor.heading)
                        .accessibilityAddTraits(.isHeader)
                    Text("For \(purchase.name). Bought credits last \(PlanCatalog.packValidMonths) months and are used after your monthly credits run out.")
                        .font(.ui(13))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                IconButton(systemImage: "xmark", label: "Close", size: 32) { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 8)

            VStack(alignment: .leading, spacing: 0) {
                VStack(spacing: 8) {
                    ForEach(PlanCatalog.creditPacks) { pack in packRow(pack) }
                }
                if status != nil && !canBuy {
                    BillingFootnote(text: String(localized: "Buying credits isn't available yet."))
                }
                if test {
                    BillingFootnote(text: String(localized: "Payments aren't connected, so this adds a test pack (development only). Nothing is charged."))
                }
                if status?.checkoutAvailable == true {
                    BillingFootnote(text: String(localized: "Any tax is added at checkout."))
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .frame(width: 384)
        .background(FoleviColor.surface)
        .task(id: app.sync.isOnline) { await watch() }
    }

    private func packRow(_ pack: CreditPack) -> some View {
        let price = PlanCatalog.formatPrice(pack.priceCents)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(AiCreditCopy.grouped(pack.credits)) AI credits").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading)
                Text("\(price), one time").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            }
            Spacer(minLength: 0)
            Button(BillingCopy.packButton(test: test, busy: busy == pack.id)) { buy(pack) }
                .buttonStyle(.folevi(pack.id == "credits_1000" ? .primary : .secondary, .small))
                .disabled(!canBuy || busy != nil)
                .accessibilityLabel(Text("Buy \(AiCreditCopy.grouped(pack.credits)) AI credits for \(price)\(test ? " " + String(localized: "(test)") : "")"))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(FoleviGlass.border))
    }

    private func buy(_ pack: CreditPack) {
        guard busy == nil, let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        let repo = BillingRepository(convex: session.convex)
        let target = purchase.target
        let checkout = status?.checkoutAvailable == true
        busy = pack.id
        Task {
            defer { busy = nil }
            do {
                if checkout {
                    openBillingPage(try await repo.buyCredits(pack: pack.id, for: target))
                    dismiss()
                    return
                }
                try await repo.testBuyCredits(pack: pack.id, for: target)
                app.showToast(BillingCopy.testCreditsAdded(pack, name: purchase.name))
                dismiss()
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func watch() async {
        guard let session = app.session, app.sync.isOnline else { return }
        do {
            for try await r in BillingRepository(convex: session.convex).creditAccountsUpdates() { status = r }
        } catch {}
    }
}

/// A card's content as one column (the web's `mt-4` block): its pieces keep their own spacing.
struct BillingCardBody<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
