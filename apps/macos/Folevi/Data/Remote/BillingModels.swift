import Foundation

// Plan & billing, Personal and workspace: what convex/billing.ts and convex/workspaceBilling.ts return, and
// the words and choices the web's BillingSection.tsx, WorkspaceBillingSection.tsx and BuyCreditsDialog.tsx
// show for them. Pure: compiled into the unit tests too.

// MARK: - Catalog additions (convex/lib/plans.ts)

/// A one-time AI credit pack (Pro and Pro AI only): valid 12 months, used after the monthly credits.
struct CreditPack: Identifiable, Sendable, Equatable {
    var id: String
    var credits: Int
    var priceCents: Int
}

extension PlanCatalog {
    /// `CREDIT_PACK_ORDER`.
    static let creditPacks: [CreditPack] = [
        CreditPack(id: "credits_500", credits: 500, priceCents: 799),
        CreditPack(id: "credits_1000", credits: 1000, priceCents: 1499),
    ]

    /// The four Team (workspace) plans, as cards (`WORKSPACE_PLANS`). Prices are per member seat.
    static let workspace: [PlanCard] = [
        PlanCard(tier: "free", name: PlanTier.name("free"), monthlyCents: 0, yearlyCents: 0, monthlyCredits: 0,
                 blurb: String(localized: "For simple collaboration."),
                 features: [String(localized: "Uses the owner's free 1 GB"), String(localized: "Each member uses their own personal AI credits"),
                            String(localized: "Unlimited members and guests"), String(localized: "Shared notes, folders and tasks")]),
        PlanCard(tier: "core", name: PlanTier.name("core"), monthlyCents: 199, yearlyCents: 1900, monthlyCredits: 0,
                 blurb: String(localized: "More room for every member, and no AI."),
                 features: [String(localized: "20 GB per member"), String(localized: "No AI for anyone in the workspace: nothing is sent to an AI model"),
                            String(localized: "Unlimited members, each billed; guests are free"), String(localized: "Everything in Free, without AI")]),
        PlanCard(tier: "pro", name: PlanTier.name("pro"), monthlyCents: 499, yearlyCents: 4900, monthlyCredits: 180,
                 blurb: String(localized: "More room and AI for every member."),
                 features: [String(localized: "20 GB per member"), String(localized: "180 AI credits per member a month"),
                            String(localized: "Unlimited members, each billed; guests are free"), String(localized: "Everything in Core, with AI")]),
        PlanCard(tier: "pro_ai", name: PlanTier.name("pro_ai"), monthlyCents: 1299, yearlyCents: 14900, monthlyCredits: 550,
                 blurb: String(localized: "AI as much as your team needs."),
                 features: [String(localized: "50 GB per member"), String(localized: "Unlimited AI, fair use (550 credits per member a month)"),
                            String(localized: "Unlimited members, each billed; guests are free"), String(localized: "Everything in Pro")]),
    ]

    static func workspaceCard(_ tier: String) -> PlanCard { workspace.first { $0.tier == tier } ?? workspace[0] }

    /// The catalog id for a workspace tier and interval ("workspace_pro_yearly"; Free has no interval).
    static func workspacePlanId(_ tier: String, yearly: Bool) -> String {
        tier == "free" ? "workspace_free" : "workspace_\(tier)_\(yearly ? "yearly" : "monthly")"
    }

    /// The quantity a paid per-seat plan is billed for: never fewer than one.
    static func billedQuantity(_ seats: Int) -> Int { max(1, seats) }

    /// What a per-seat plan charges per interval for `seats` billable seats.
    static func seatChargeCents(_ seatPriceCents: Int, seats: Int) -> Int { seatPriceCents * billedQuantity(seats) }

    static func rank(_ tier: String) -> Int { order.firstIndex(of: tier) ?? 0 }
}

// MARK: - Shared words

enum BillingCopy {
    /// "1 device", "3 free workspaces": `n.toLocaleString()` and the right noun.
    static func plural(_ n: Int, _ one: String, _ many: String) -> String {
        "\(AiCreditCopy.grouped(n)) \(n == 1 ? one : many)"
    }

    /// "Oct 1, 2026": billing dates are UTC, like the server and Polar.
    static func dateOnly(_ ms: Double, locale: Locale = Locale(identifier: "en_US")) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate("MMMdyyyy")
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    /// The web's formatDateTime (`dateStyle: "medium", timeStyle: "short"`): "Oct 1, 2026, 3:45 PM", local time.
    static func dateTime(_ ms: Double, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let d = Date(timeIntervalSince1970: ms / 1000)
        let date = DateFormatter()
        date.locale = locale
        date.timeZone = timeZone
        date.dateStyle = .medium
        date.timeStyle = .none
        let time = DateFormatter()
        time.locale = locale
        time.timeZone = timeZone
        time.dateStyle = .none
        time.timeStyle = .short
        return "\(date.string(from: d)), \(time.string(from: d))"
    }

    /// "Annual" / "Monthly" (the pill beside the plan's name).
    static func intervalPill(_ interval: String?) -> String? {
        guard let interval else { return nil }
        return interval == "year" ? String(localized: "Annual") : String(localized: "Monthly")
    }

    /// "year" / "month".
    static func per(yearly: Bool) -> String { yearly ? String(localized: "year") : String(localized: "month") }

    /// A payment's status as the web capitalizes it ("Paid", "Failed", "Refunded").
    static func status(_ status: String) -> String { status.prefix(1).uppercased() + status.dropFirst() }

    /// "$7.99 USD".
    static func amount(_ cents: Double, currency: String) -> String {
        "\(PlanCatalog.formatPrice(Int(cents.rounded()))) \(currency.uppercased())"
    }

    /// The web's CreditLines: the line under the meter.
    static func creditLine(_ c: PersonalCredits, now: Date = Date()) -> String {
        AiCreditCopy.detail(available: c.available, allowance: c.allowance, monthlyLeft: c.monthlyLeft, packCredits: c.packCredits,
                            resetsAt: c.resetsAt, nextPackExpiry: c.nextPackExpiry, trialing: c.trialing, now: now)
    }

    /// One credit account in the "AI credits" card.
    static func accountLine(_ a: CreditAccountsResponse.Account, now: Date = Date()) -> String {
        guard a.aiIncluded else { return String(localized: "Not included in Core. Nothing is sent to an AI model.") }
        let left = AiCreditCopy.count(a.available)
        let of = String(localized: "\(AiCreditCopy.grouped(a.monthlyLeft)) of \(AiCreditCopy.grouped(a.allowance))")
        var line = a.trialing
            ? String(localized: "\(left) left · \(of) trial credits, trial ends on \(AiCreditCopy.date(a.resetsAt, now: now))")
            : String(localized: "\(left) left · \(of) monthly credits, resets on \(AiCreditCopy.date(a.resetsAt, now: now))")
        if a.packCredits > 0 {
            let extra = plural(Int(a.packCredits.rounded()), String(localized: "extra credit"), String(localized: "extra credits"))
            if let next = a.nextPackExpiry {
                line += " · " + String(localized: "\(extra), the first expiring on \(AiCreditCopy.date(next, now: now))")
            } else {
                line += " · \(extra)"
            }
        }
        return line
    }

    /// "Added 500 AI credits to Personal (test purchase)."
    static func testCreditsAdded(_ pack: CreditPack, name: String) -> String {
        String(localized: "Added \(AiCreditCopy.grouped(pack.credits)) AI credits to \(name) (test purchase).")
    }

    /// The pack's button: "Buy", "Buy (test)", or busy.
    static func packButton(test: Bool, busy: Bool) -> String {
        if busy { return test ? String(localized: "Adding…") : String(localized: "Opening checkout…") }
        return test ? String(localized: "Buy (test)") : String(localized: "Buy")
    }
}

/// What a plan card's bottom shows.
enum PlanCardAction: Equatable {
    /// A disabled button: "Your plan" / "Current plan".
    case current(String)
    /// The ghost "Switch to Free" (cancels at period end).
    case switchToFree
    /// "To switch to Free, cancel in Manage billing."
    case note(String)
    /// A button that chooses the plan: its title (busy or not), primary (Pro AI) or secondary, and whether
    /// another choice is running.
    case choose(title: String, primary: Bool, disabled: Bool)
    /// A disabled "Coming soon".
    case comingSoon
    case nothing
}

// MARK: - Personal (billing:mine)

/// Settings → Plan & billing, Personal: everything the web's BillingSection works out from billing:mine.
struct PersonalBilling {
    var b: BillingSummary
    var now: Date = Date()

    var e: Entitlements { b.entitlements }
    var sub: BillingSummary.Subscription? { b.subscription }
    var paid: Bool { e.paid ?? (e.paidPlan != "free") }
    var current: PlanCard { PlanCatalog.card(e.paidPlan) }
    var planLabel: String { e.trialing ? String(localized: "Pro AI trial") : current.name }
    var cancelScheduled: Bool { paid && sub?.cancelAtPeriodEnd == true && sub?.currentPeriodEnd != nil }
    var polar: Bool { sub?.provider == "polar" }
    var polarLive: Bool { polar && paid && sub?.status != "canceled" }
    /// Test and hand-set plans are canceled and resumed here.
    var selfServe: Bool { paid && (sub?.provider == "test" || sub?.provider == "manual") }
    var checkoutAvailable: Bool { b.checkoutAvailable == true }
    var testPurchases: Bool { b.testPurchases == true }
    var canChoose: Bool { checkoutAvailable || testPurchases }
    var paidPlanId: String { e.paidPlanId ?? PlanCatalog.personalPlanId(e.paidPlan, yearly: sub?.interval == "year") }

    var trialDaysLeft: Int {
        guard e.trialing, let end = e.trialEndsAt else { return 0 }
        return max(1, Int(ceil((end - now.timeIntervalSince1970 * 1000) / 86_400_000)))
    }

    /// The plan's state: trial, active, past due, or cancel scheduled (Free has none).
    var status: String? {
        if e.trialing { return String(localized: "Trial") }
        guard paid else { return nil }
        if sub?.status == "past_due" { return String(localized: "Past due") }
        return cancelScheduled ? String(localized: "Cancel scheduled") : String(localized: "Active")
    }

    var pastDue: Bool { !e.trialing && paid && sub?.status == "past_due" }

    /// "Annual" / "Monthly" for a paid plan.
    var intervalPill: String? { paid ? BillingCopy.intervalPill(sub?.interval) : nil }

    var description: String {
        if e.trialing, let end = e.trialEndsAt {
            let days = trialDaysLeft
            let unit = days == 1 ? String(localized: "day") : String(localized: "days")
            return String(localized: "\(days) \(unit) of Pro AI left (until \(BillingCopy.dateOnly(end))). Then you'll move to Free unless you choose a plan.")
        }
        if paid, sub?.status == "past_due" {
            return polar ? String(localized: "Your last payment failed. Update your payment method in Manage billing to keep your plan.")
                : String(localized: "Your last payment failed.")
        }
        if paid, let end = sub?.currentPeriodEnd {
            if sub?.cancelAtPeriodEnd == true {
                return String(localized: "Ends \(BillingCopy.dateOnly(end)). Your \(current.name) features remain available until then.")
            }
            return sub?.provider == "manual" ? String(localized: "Set by the Folevi team until \(BillingCopy.dateOnly(end)).")
                : String(localized: "Renews \(BillingCopy.dateOnly(end)).")
        }
        if paid, sub?.provider == "manual" { return String(localized: "Set by the Folevi team.") }
        return current.blurb
    }

    var storageLimit: Double { b.storageLimitBytes ?? e.storageBytes }
    var storageUsedLine: String {
        String(localized: "\(PlanCatalog.formatBytes(b.storageUsedBytes)) of \(PlanCatalog.formatBytes(storageLimit)) used")
    }
    var storageFraction: Double { b.storageUsedBytes / max(1, storageLimit) }

    var storageNote: String {
        switch b.storageRule ?? e.storageRule {
        case "shared_free":
            let pool = Int(b.poolWorkspaces ?? 0)
            return pool > 0
                ? String(localized: "Shared by your Personal and the \(BillingCopy.plural(pool, String(localized: "free workspace"), String(localized: "free workspaces"))) you own.")
                : String(localized: "Shared with any free workspaces you create.")
        case "override":
            return String(localized: "A limit set by the Folevi team.")
        default:
            let limit = PlanCatalog.formatBytes(storageLimit)
            return e.trialing ? String(localized: "Your own \(limit) during your trial.") : String(localized: "Your own \(limit) on \(current.name).")
        }
    }

    var devicesLine: String {
        let active = Int(b.devicesActive)
        guard let limit = e.deviceLimit else {
            let devices = BillingCopy.plural(active, String(localized: "device"), String(localized: "devices"))
            return e.trialing ? String(localized: "Unlimited during your trial · signed in on \(devices)")
                : String(localized: "Unlimited · signed in on \(devices)")
        }
        let used = String(localized: "\(min(active, limit)) of \(limit) devices in use")
        return active > limit ? used + " · " + String(localized: "\(active - limit) waiting") : used
    }

    /// The bottom of a plan card for `tier` with the Monthly/Yearly choice; `busy` is the running choice's key.
    func action(for tier: String, yearly: Bool, busy: String?) -> PlanCardAction {
        let paidTier = tier != "free"
        let isCurrent = paidTier ? paidPlanId == PlanCatalog.personalPlanId(tier, yearly: yearly) : !paid
        if isCurrent { return .current(String(localized: "Your plan")) }
        if !paidTier {
            if selfServe && !cancelScheduled { return .switchToFree }
            if polarLive && sub?.cancelAtPeriodEnd != true { return .note(String(localized: "To switch to Free, cancel in Manage billing.")) }
            return .nothing
        }
        guard canChoose else { return .comingSoon }
        let title: String
        if busy == tier {
            title = !checkoutAvailable ? String(localized: "Switching…") : polarLive ? String(localized: "Changing…") : String(localized: "Opening checkout…")
        } else {
            let label = PlanCatalog.actionLabel(tier: tier, yearly: yearly, paid: paid, paidPlan: e.paidPlan, trialing: e.trialing)
            title = checkoutAvailable ? label : label + " " + String(localized: "(test)")
        }
        return .choose(title: title, primary: tier == "pro_ai", disabled: busy != nil && busy != tier)
    }

    /// Whether the plan card is your exact plan (the "Current" pill).
    func isCurrent(_ tier: String, yearly: Bool) -> Bool {
        tier == "free" ? !paid : paidPlanId == PlanCatalog.personalPlanId(tier, yearly: yearly)
    }

    /// The small line under a plan card's price.
    static func priceNote(_ plan: PlanCard, yearly: Bool) -> String {
        if !plan.paid { return String(localized: "No card required") }
        return yearly ? String(localized: "\(PlanCatalog.monthlyEquivalent(plan.yearlyCents))/month, billed yearly") : String(localized: "Billed monthly")
    }

    var footnote: String {
        let lead = checkoutAvailable ? String(localized: "Payments are handled by Polar. Any tax is added at checkout.")
            : testPurchases ? String(localized: "Payments aren't connected yet, so upgrades here are test purchases (development only), and nothing is charged.")
            : String(localized: "Online payments are coming soon.")
        return lead + " " + String(localized: "AI credits: a rewrite uses about 1, Ask AI about 2, a flowchart 3 to 5.")
    }

    /// A Personal payment's plan cell: "500 AI credits" or "Pro · yearly".
    static func paymentPlan(_ p: BillingPayment) -> String {
        if p.plan == "credits" { return AiCreditCopy.count(p.credits ?? 0) }
        return "\(PlanTier.name(p.plan)) · \(p.interval == "year" ? String(localized: "yearly") : String(localized: "monthly"))"
    }
}

// MARK: - Workspace (workspaceBilling:summary)

/// workspaceBilling:summary: a workspace's plan, seats, storage, your AI credits there, and its payments.
struct WorkspaceBillingSummary: Decodable, Sendable {
    struct WorkspaceRef: Decodable, Sendable { var id: String; var name: String }
    struct Ents: Decodable, Sendable {
        var planId: String
        var paid: Bool
        var ai: Bool
        var monthlyCredits: Double
        var storageBytes: Double?
        var storageRule: String?
    }
    struct Plan: Decodable, Sendable {
        var id: String
        var tier: String
        var name: String?
        var interval: String?
        var seatPriceCents: Double
    }
    struct Subscription: Decodable, Sendable {
        var planId: String?
        var provider: String
        var status: String
        var cancelAtPeriodEnd: Bool
        var currentPeriodStart: Double?
        var currentPeriodEnd: Double?
        var trialEndsAt: Double?
        var quantity: Double?
        var paymentMethod: String?
        var youPay: Bool

        enum CodingKeys: String, CodingKey {
            case planId, provider, status, cancelAtPeriodEnd, currentPeriodStart, currentPeriodEnd, trialEndsAt, quantity, paymentMethod, youPay
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            planId = try c.decodeIfPresent(String.self, forKey: .planId)
            provider = try c.decodeIfPresent(String.self, forKey: .provider) ?? "none"
            status = try c.decodeIfPresent(String.self, forKey: .status) ?? "active"
            cancelAtPeriodEnd = try c.decodeIfPresent(Bool.self, forKey: .cancelAtPeriodEnd) ?? false
            currentPeriodStart = try c.decodeIfPresent(Double.self, forKey: .currentPeriodStart)
            currentPeriodEnd = try c.decodeIfPresent(Double.self, forKey: .currentPeriodEnd)
            trialEndsAt = try c.decodeIfPresent(Double.self, forKey: .trialEndsAt)
            quantity = try c.decodeIfPresent(Double.self, forKey: .quantity)
            paymentMethod = try c.decodeIfPresent(String.self, forKey: .paymentMethod)
            youPay = try c.decodeIfPresent(Bool.self, forKey: .youPay) ?? false
        }
    }
    struct Pool: Decodable, Sendable { var workspaces: Double; var includesPersonal: Bool }
    /// Your own AI credits in the workspace (paid plans with AI).
    struct SeatCredits: Decodable, Sendable {
        var allowance: Double
        var monthlyLeft: Double
        var packCredits: Double
        var available: Double
        var resetsAt: Double
        var nextPackExpiry: Double?
        var canBuy: Bool

        enum CodingKeys: String, CodingKey { case allowance, monthlyLeft, packCredits, available, resetsAt, nextPackExpiry, canBuy }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            allowance = try c.decodeIfPresent(Double.self, forKey: .allowance) ?? 0
            monthlyLeft = try c.decodeIfPresent(Double.self, forKey: .monthlyLeft) ?? 0
            packCredits = try c.decodeIfPresent(Double.self, forKey: .packCredits) ?? 0
            available = try c.decodeIfPresent(Double.self, forKey: .available) ?? 0
            resetsAt = try c.decodeIfPresent(Double.self, forKey: .resetsAt) ?? 0
            nextPackExpiry = try c.decodeIfPresent(Double.self, forKey: .nextPackExpiry)
            canBuy = try c.decodeIfPresent(Bool.self, forKey: .canBuy) ?? false
        }
    }
    struct Payment: Decodable, Sendable, Identifiable {
        var id: String
        var amountCents: Double
        var currency: String
        var planId: String?
        var plan: String?
        var interval: String?
        var quantity: Double?
        var status: String
        var createdAt: Double
    }

    var workspace: WorkspaceRef?
    var yourRole: String?
    var entitlements: Ents
    var plan: Plan
    var subscription: Subscription?
    var seats: Double
    var guests: Double
    var pendingInvites: Double
    var estimatedChargeCents: Double
    var storageUsedBytes: Double
    var storageLimitBytes: Double
    var storageRule: String?
    var storagePerMemberBytes: Double?
    var yourStorageUsedBytes: Double?
    var pool: Pool?
    var overLimit: Bool?
    var credits: SeatCredits?
    var payments: [Payment]
    var checkoutAvailable: Bool
    var testPurchases: Bool

    enum CodingKeys: String, CodingKey {
        case workspace, yourRole, entitlements, plan, subscription, seats, guests, pendingInvites, estimatedChargeCents, storageUsedBytes,
             storageLimitBytes, storageRule, storagePerMemberBytes, yourStorageUsedBytes, pool, overLimit, credits, payments, checkoutAvailable,
             testPurchases
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workspace = try c.decodeIfPresent(WorkspaceRef.self, forKey: .workspace)
        yourRole = try c.decodeIfPresent(String.self, forKey: .yourRole)
        entitlements = try c.decode(Ents.self, forKey: .entitlements)
        plan = try c.decode(Plan.self, forKey: .plan)
        subscription = try c.decodeIfPresent(Subscription.self, forKey: .subscription)
        seats = try c.decodeIfPresent(Double.self, forKey: .seats) ?? 0
        guests = try c.decodeIfPresent(Double.self, forKey: .guests) ?? 0
        pendingInvites = try c.decodeIfPresent(Double.self, forKey: .pendingInvites) ?? 0
        estimatedChargeCents = try c.decodeIfPresent(Double.self, forKey: .estimatedChargeCents) ?? 0
        storageUsedBytes = try c.decodeIfPresent(Double.self, forKey: .storageUsedBytes) ?? 0
        storageLimitBytes = try c.decodeIfPresent(Double.self, forKey: .storageLimitBytes) ?? 0
        storageRule = try c.decodeIfPresent(String.self, forKey: .storageRule)
        storagePerMemberBytes = try c.decodeIfPresent(Double.self, forKey: .storagePerMemberBytes)
        yourStorageUsedBytes = try c.decodeIfPresent(Double.self, forKey: .yourStorageUsedBytes)
        pool = try c.decodeIfPresent(Pool.self, forKey: .pool)
        overLimit = try c.decodeIfPresent(Bool.self, forKey: .overLimit)
        credits = try c.decodeIfPresent(SeatCredits.self, forKey: .credits)
        payments = try c.decodeIfPresent([Payment].self, forKey: .payments) ?? []
        checkoutAvailable = try c.decodeIfPresent(Bool.self, forKey: .checkoutAvailable) ?? false
        testPurchases = try c.decodeIfPresent(Bool.self, forKey: .testPurchases) ?? false
    }
}

/// Settings → (workspace) Plan & billing: everything the web's WorkspaceBillingSection works out from the summary.
struct WorkspaceBilling {
    var s: WorkspaceBillingSummary
    /// The workspace's name (for toasts and the history card).
    var name: String
    var now: Date = Date()

    var e: WorkspaceBillingSummary.Ents { s.entitlements }
    var sub: WorkspaceBillingSummary.Subscription? { s.subscription }
    var current: PlanCard { PlanCatalog.workspaceCard(s.plan.tier) }
    var polar: Bool { sub?.provider == "polar" }
    var manual: Bool { sub?.provider == "manual" }
    var cancelScheduled: Bool { e.paid && sub?.cancelAtPeriodEnd == true && sub?.currentPeriodEnd != nil }
    var trialing: Bool { e.paid && (sub?.trialEndsAt ?? 0) > now.timeIntervalSince1970 * 1000 }
    /// A Polar subscription that's running: plan changes are subscription updates (Polar prorates).
    var polarLive: Bool { polar && e.paid && sub?.status != "canceled" }
    var canChoose: Bool { polarLive || s.checkoutAvailable || s.testPurchases }
    var test: Bool { !polarLive && !s.checkoutAvailable }
    var seatPrice: String { PlanCatalog.formatPrice(Int(s.plan.seatPriceCents.rounded())) }
    var seats: Int { Int(s.seats) }

    var status: String? {
        guard e.paid else { return nil }
        if sub?.status == "past_due" { return String(localized: "Past due") }
        if cancelScheduled { return String(localized: "Cancel scheduled") }
        return trialing ? String(localized: "Trial") : String(localized: "Active")
    }

    var intervalPill: String? { e.paid ? BillingCopy.intervalPill(s.plan.interval) : nil }

    var description: String {
        guard e.paid else { return current.blurb }
        if sub?.status == "past_due" {
            return polar ? String(localized: "The last payment failed. The person who pays can update the payment method in Manage billing. The plan stays on while payment is retried.")
                : String(localized: "The last payment failed.")
        }
        if cancelScheduled, let end = sub?.currentPeriodEnd {
            return String(localized: "Ends \(BillingCopy.dateOnly(end)). \(current.name) features remain available until then.")
        }
        if trialing, let end = sub?.trialEndsAt { return String(localized: "Trial until \(BillingCopy.dateOnly(end)).") }
        if let end = sub?.currentPeriodEnd {
            return manual ? String(localized: "Set by the Folevi team until \(BillingCopy.dateOnly(end)).") : String(localized: "Renews \(BillingCopy.dateOnly(end)).")
        }
        return manual ? String(localized: "Set by the Folevi team.") : current.blurb
    }

    /// "$4.99 per member / month · Paid with Visa •••• 4242" (paid plans).
    var priceLine: String? {
        guard e.paid else { return nil }
        let line = String(localized: "\(seatPrice) per member / \(BillingCopy.per(yearly: s.plan.interval == "year"))")
        if let method = sub?.paymentMethod { return line + " · " + String(localized: "Paid with \(method)") }
        return line
    }

    /// Polar, paid by someone else.
    var someoneElsePays: Bool { polar && sub?.youPay != true }
    var canOpenPortal: Bool { polar && sub?.youPay == true }
    /// Cancel or resume (not hand-set plans).
    var canCancelOrResume: Bool { e.paid && !manual }

    var seatsTitle: String { String(localized: "Billable seats: \(AiCreditCopy.grouped(seats))") }
    var guestsLine: String { String(localized: "Guests: \(AiCreditCopy.grouped(Int(s.guests))) · Not billed") }
    var pendingLine: String? {
        let n = Int(s.pendingInvites)
        guard n > 0 else { return nil }
        return String(localized: "\(BillingCopy.plural(n, String(localized: "pending invitation"), String(localized: "pending invitations"))), billed once accepted.")
    }

    var chargeLine: String {
        guard e.paid, let interval = s.plan.interval else { return String(localized: "Free. Nothing is charged.") }
        let charge = PlanCatalog.formatPrice(Int(s.estimatedChargeCents.rounded()))
        return String(localized: "\(AiCreditCopy.grouped(seats)) × \(seatPrice) = \(charge)/\(BillingCopy.per(yearly: interval == "year"))")
    }

    /// "Updating the billed seats (3) to match…" while Polar's quantity catches up.
    var quantityNote: String? {
        guard e.paid, let q = sub?.quantity else { return nil }
        let quantity = Int(q.rounded())
        guard quantity != PlanCatalog.billedQuantity(seats) else { return nil }
        return String(localized: "Updating the billed seats (\(quantity)) to match…")
    }

    // Storage: the owner's free pool on Free, each member's own quota on a paid plan, or a limit set by hand.
    var perMember: Bool { s.storageRule == "per_person" && s.storagePerMemberBytes != nil }
    var storageUsed: Double { perMember ? (s.yourStorageUsedBytes ?? 0) : s.storageUsedBytes }
    var storageLimit: Double { perMember ? (s.storagePerMemberBytes ?? 0) : s.storageLimitBytes }
    var overLimit: Bool { storageUsed > storageLimit }
    var storageTitle: String { perMember ? String(localized: "Your storage here") : String(localized: "Workspace storage") }
    var storageMeterLabel: String { perMember ? String(localized: "Your storage used here") : String(localized: "Workspace storage used") }
    var storageUsedLine: String {
        String(localized: "\(PlanCatalog.formatBytes(storageUsed)) of \(PlanCatalog.formatBytes(storageLimit)) used")
    }
    var storageFraction: Double { storageUsed / max(1, storageLimit) }

    var storageNote: String {
        if perMember {
            return String(localized: "Each member has \(PlanCatalog.formatBytes(storageLimit)) here, and their own uploads count against it. Everyone's uploads: \(PlanCatalog.formatBytes(s.storageUsedBytes)).")
        }
        if s.storageRule == "override" { return String(localized: "A limit set by the Folevi team.") }
        // The pool counts this workspace too (it's free whenever there's a pool).
        var parts: [String] = []
        if let pool = s.pool {
            if pool.includesPersonal { parts.append(String(localized: "their Personal")) }
            let otherFree = max(0, Int(pool.workspaces) - 1)
            if otherFree > 0 { parts.append(BillingCopy.plural(otherFree, String(localized: "other free workspace"), String(localized: "other free workspaces"))) }
        }
        let limit = PlanCatalog.formatBytes(s.storageLimitBytes)
        let shared = parts.isEmpty ? "" : ", " + String(localized: "shared with \(parts.joined(separator: " " + String(localized: "and") + " "))")
        return String(localized: "Uses the owner's free \(limit)") + shared + ". " + String(localized: "Everyone's uploads here count against it.")
    }

    /// The AI credits tile.
    enum AiTile: Equatable {
        case text(String)
        case credits(PersonalCredits, canBuy: Bool)
    }

    var aiTile: AiTile {
        if !e.ai { return .text(String(localized: "Core doesn't include AI, so nothing in this workspace is sent to an AI model.")) }
        if !e.paid { return .text(String(localized: "On Free, each member uses their own personal AI credits here.")) }
        if let c = s.credits {
            let credits = PersonalCredits(allowance: c.allowance, monthlyLeft: c.monthlyLeft, packCredits: c.packCredits, available: c.available,
                                          resetsAt: c.resetsAt, nextPackExpiry: c.nextPackExpiry, trialing: false, canBuy: c.canBuy, aiIncluded: true)
            return .credits(credits, canBuy: c.canBuy)
        }
        return .text(String(localized: "\(AiCreditCopy.grouped(e.monthlyCredits)) AI credits per member each month."))
    }

    func isCurrent(_ tier: String, yearly: Bool) -> Bool {
        tier == "free" ? !e.paid : e.planId == PlanCatalog.workspacePlanId(tier, yearly: yearly)
    }

    func action(for tier: String, yearly: Bool, busy: String?) -> PlanCardAction {
        if isCurrent(tier, yearly: yearly) { return .current(String(localized: "Current plan")) }
        if tier == "free" { return e.paid && !manual && !cancelScheduled ? .switchToFree : .nothing }
        guard canChoose else { return .comingSoon }
        let name = PlanTier.name(tier)
        let sameTier = e.paid && s.plan.tier == tier
        let title: String
        if busy == tier {
            title = polarLive ? String(localized: "Changing…") : s.checkoutAvailable ? String(localized: "Opening checkout…") : String(localized: "Switching…")
        } else {
            let label = sameTier ? (yearly ? String(localized: "Switch to yearly") : String(localized: "Switch to monthly"))
                : !e.paid || PlanCatalog.rank(tier) > PlanCatalog.rank(s.plan.tier) ? String(localized: "Upgrade to \(name)")
                : String(localized: "Change to \(name)")
            title = test ? label + " " + String(localized: "(test)") : label
        }
        return .choose(title: title, primary: tier == "pro_ai", disabled: busy != nil && busy != tier)
    }

    /// The line under a plan card's price.
    func priceNote(_ plan: PlanCard, yearly: Bool) -> String {
        guard plan.paid else { return String(localized: "Nobody is billed") }
        let price = yearly ? plan.yearlyCents : plan.monthlyCents
        let members = BillingCopy.plural(seats, String(localized: "member"), String(localized: "members"))
        let charge = PlanCatalog.formatPrice(PlanCatalog.seatChargeCents(price, seats: seats))
        return String(localized: "Per member. \(members) × \(PlanCatalog.formatPrice(price)) = \(charge)/\(BillingCopy.per(yearly: yearly))")
    }

    var footnote: String {
        if polarLive || s.checkoutAvailable {
            return String(localized: "Payments are handled by Polar, which works out any tax. Adding or removing members changes the seats, prorated.")
        }
        return s.testPurchases ? String(localized: "Payments aren't connected yet, so upgrades here are test purchases (development only), and nothing is charged.")
            : String(localized: "Online payments for workspaces are coming soon.")
    }

    var historyDescription: String { String(localized: "Payments for \(name) only.") }

    static func paymentPlan(_ p: WorkspaceBillingSummary.Payment) -> String {
        let tier = p.plan.map { PlanTier.name($0) } ?? String(localized: "Plan")
        var out = "\(tier) · \(p.interval == "year" ? String(localized: "yearly") : String(localized: "monthly"))"
        if let q = p.quantity, q > 0 { out += " · " + BillingCopy.plural(Int(q.rounded()), String(localized: "seat"), String(localized: "seats")) }
        return out
    }

    // Toasts
    var endPlanToast: String { String(localized: "\(current.name) will end at the close of this billing period.") }
    func changeToast(_ tier: String) -> String { String(localized: "Changing to \(PlanTier.name(tier)). Polar prorates the difference.") }
    func testToast(_ tier: String) -> String { String(localized: "\(name) is on \(PlanTier.name(tier)) (test purchase).") }
}

extension PersonalCredits {
    init(allowance: Double, monthlyLeft: Double, packCredits: Double, available: Double, resetsAt: Double, nextPackExpiry: Double?,
         trialing: Bool, canBuy: Bool, aiIncluded: Bool) {
        self.allowance = allowance
        self.monthlyLeft = monthlyLeft
        self.packCredits = packCredits
        self.available = available
        self.resetsAt = resetsAt
        self.nextPackExpiry = nextPackExpiry
        self.trialing = trialing
        self.canBuy = canBuy
        self.aiIncluded = aiIncluded
    }
}
