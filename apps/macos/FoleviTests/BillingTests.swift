import XCTest

/// Plan & billing (Personal and workspace): the words and choices must be the web's.
final class PersonalBillingTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000) // Sep 21, 2026

    private func summary(_ json: String) throws -> BillingSummary {
        try JSONDecoder().decode(BillingSummary.self, from: Data(json.utf8))
    }

    /// A Personal summary: `ents` and `sub` are JSON fragments.
    private func personal(ents: String, sub: String = "null", limit: Int = 1_073_741_824, extra: String = "") throws -> PersonalBilling {
        let b = try summary(#"{"entitlements":"# + ents + #","subscription":"# + sub + #","storageUsedBytes":536870912,"storageLimitBytes":\#(limit),"devicesActive":3"# + extra + "}")
        return PersonalBilling(b: b, now: now)
    }

    private let free = #"{"plan":"free","paidPlan":"free","planId":"personal_free","paidPlanId":"personal_free","paid":false,"trialing":false,"ai":true,"storageBytes":1073741824,"storageRule":"shared_free","devices":2}"#
    private let proYearly = #"{"plan":"pro","paidPlan":"pro","planId":"personal_pro_yearly","paidPlanId":"personal_pro_yearly","paid":true,"trialing":false,"ai":true,"storageBytes":21474836480,"storageRule":"per_person","devices":null}"#

    func testFreeWithCheckout() throws {
        let p = try personal(ents: free, extra: #","storageRule":"shared_free","poolWorkspaces":2,"checkoutAvailable":true,"testPurchases":false"#)
        XCTAssertEqual(p.planLabel, "Free")
        XCTAssertNil(p.status)
        XCTAssertNil(p.intervalPill)
        XCTAssertEqual(p.description, "Everything you need to write and organize.")
        XCTAssertEqual(p.storageUsedLine, "512 MB of 1 GB used")
        XCTAssertEqual(p.storageNote, "Shared by your Personal and the 2 free workspaces you own.")
        XCTAssertEqual(p.devicesLine, "2 of 2 devices in use · 1 waiting")
        XCTAssertEqual(p.action(for: "free", yearly: true, busy: nil), .current("Your plan"))
        XCTAssertEqual(p.action(for: "pro", yearly: true, busy: nil), .choose(title: "Upgrade to Pro", primary: false, disabled: false))
        XCTAssertEqual(p.action(for: "pro_ai", yearly: true, busy: nil), .choose(title: "Upgrade to Pro AI", primary: true, disabled: false))
        XCTAssertEqual(p.action(for: "pro", yearly: true, busy: "pro"), .choose(title: "Opening checkout…", primary: false, disabled: false))
        XCTAssertEqual(p.action(for: "core", yearly: true, busy: "pro"), .choose(title: "Upgrade to Core", primary: false, disabled: true))
        XCTAssertEqual(p.footnote, "Payments are handled by Polar. Any tax is added at checkout. AI credits: a rewrite uses about 1, Ask AI about 2, a flowchart 3 to 5.")
    }

    func testTestPurchasesAndComingSoon() throws {
        let test = try personal(ents: free, extra: #","checkoutAvailable":false,"testPurchases":true"#)
        XCTAssertEqual(test.action(for: "core", yearly: false, busy: nil), .choose(title: "Upgrade to Core (test)", primary: false, disabled: false))
        XCTAssertEqual(test.action(for: "core", yearly: false, busy: "core"), .choose(title: "Switching…", primary: false, disabled: false))
        XCTAssertTrue(test.footnote.hasPrefix("Payments aren't connected yet, so upgrades here are test purchases (development only), and nothing is charged. "))
        let none = try personal(ents: free)
        XCTAssertEqual(none.action(for: "pro", yearly: true, busy: nil), .comingSoon)
        XCTAssertTrue(none.footnote.hasPrefix("Online payments are coming soon. AI credits"))
        XCTAssertEqual(none.storageNote, "Shared with any free workspaces you create.")
    }

    func testPolarProYearly() throws {
        let sub = #"{"planId":"personal_pro_yearly","plan":"pro","interval":"year","status":"active","provider":"polar","currentPeriodEnd":1790812800000,"cancelAtPeriodEnd":false}"#
        let p = try personal(ents: proYearly, sub: sub, extra: #","storageRule":"per_person","checkoutAvailable":true"#)
        XCTAssertEqual(p.planLabel, "Pro")
        XCTAssertEqual(p.intervalPill, "Annual")
        XCTAssertEqual(p.status, "Active")
        XCTAssertTrue(p.polar)
        XCTAssertFalse(p.selfServe)
        XCTAssertEqual(p.description, "Renews Oct 1, 2026.")
        XCTAssertEqual(p.storageNote, "Your own 1 GB on Pro.")
        XCTAssertEqual(p.devicesLine, "Unlimited · signed in on 3 devices")
        XCTAssertEqual(p.action(for: "pro", yearly: true, busy: nil), .current("Your plan"))
        XCTAssertTrue(p.isCurrent("pro", yearly: true))
        XCTAssertFalse(p.isCurrent("pro", yearly: false))
        XCTAssertEqual(p.action(for: "pro", yearly: false, busy: nil), .choose(title: "Switch to monthly", primary: false, disabled: false))
        XCTAssertEqual(p.action(for: "core", yearly: true, busy: nil), .choose(title: "Change to Core", primary: false, disabled: false))
        XCTAssertEqual(p.action(for: "pro_ai", yearly: true, busy: "pro_ai"), .choose(title: "Changing…", primary: true, disabled: false))
        XCTAssertEqual(p.action(for: "free", yearly: true, busy: nil), .note("To switch to Free, cancel in Manage billing."))
    }

    func testPastDueAndCancelScheduled() throws {
        let pastDue = #"{"planId":"personal_pro_yearly","plan":"pro","interval":"month","status":"past_due","provider":"polar","currentPeriodEnd":1790812800000,"cancelAtPeriodEnd":false}"#
        let p = try personal(ents: proYearly, sub: pastDue)
        XCTAssertEqual(p.status, "Past due")
        XCTAssertEqual(p.intervalPill, "Monthly")
        XCTAssertEqual(p.description, "Your last payment failed. Update your payment method in Manage billing to keep your plan.")

        let canceling = #"{"planId":"personal_pro_yearly","plan":"pro","interval":"year","status":"active","provider":"test","currentPeriodEnd":1790812800000,"cancelAtPeriodEnd":true}"#
        let c = try personal(ents: proYearly, sub: canceling, extra: #","testPurchases":true"#)
        XCTAssertEqual(c.status, "Cancel scheduled")
        XCTAssertTrue(c.selfServe)
        XCTAssertTrue(c.cancelScheduled)
        XCTAssertEqual(c.description, "Ends Oct 1, 2026. Your Pro features remain available until then.")
        XCTAssertEqual(c.action(for: "free", yearly: true, busy: nil), .nothing)

        let test = #"{"planId":"personal_pro_yearly","plan":"pro","interval":"year","status":"active","provider":"test","currentPeriodEnd":1790812800000,"cancelAtPeriodEnd":false}"#
        XCTAssertEqual(try personal(ents: proYearly, sub: test).action(for: "free", yearly: true, busy: nil), .switchToFree)

        let manual = #"{"planId":"personal_pro_yearly","plan":"pro","interval":null,"status":"active","provider":"manual","currentPeriodEnd":null,"cancelAtPeriodEnd":false}"#
        XCTAssertEqual(try personal(ents: proYearly, sub: manual).description, "Set by the Folevi team.")
    }

    func testTrial() throws {
        let trial = #"{"plan":"pro_ai","paidPlan":"free","planId":"personal_pro_ai_monthly","paidPlanId":"personal_free","paid":false,"trialing":true,"trialEndsAt":1790200000000,"ai":true,"storageBytes":53687091200,"storageRule":"per_person","devices":null}"#
        let p = try personal(ents: trial, limit: 53_687_091_200, extra: #","storageRule":"per_person","testPurchases":true"#)
        XCTAssertEqual(p.planLabel, "Pro AI trial")
        XCTAssertEqual(p.status, "Trial")
        XCTAssertEqual(p.trialDaysLeft, 3)
        XCTAssertEqual(p.description, "3 days of Pro AI left (until Sep 23, 2026). Then you'll move to Free unless you choose a plan.")
        XCTAssertEqual(p.storageNote, "Your own 50 GB during your trial.")
        XCTAssertEqual(p.devicesLine, "Unlimited during your trial · signed in on 3 devices")
        XCTAssertEqual(p.action(for: "pro", yearly: true, busy: nil), .choose(title: "Choose Pro (test)", primary: false, disabled: false))
        XCTAssertEqual(p.action(for: "free", yearly: true, busy: nil), .current("Your plan"))
    }

    func testPriceNotesAndHistory() throws {
        XCTAssertEqual(PersonalBilling.priceNote(PlanCatalog.card("free"), yearly: true), "No card required")
        XCTAssertEqual(PersonalBilling.priceNote(PlanCatalog.card("pro"), yearly: true), "$4.08/month, billed yearly")
        XCTAssertEqual(PersonalBilling.priceNote(PlanCatalog.card("pro"), yearly: false), "Billed monthly")
        let credits = BillingPayment(id: "p", amountCents: 799, currency: "usd", plan: "credits", interval: nil, credits: 500, status: "paid", createdAt: 0)
        XCTAssertEqual(PersonalBilling.paymentPlan(credits), "500 AI credits")
        let plan = BillingPayment(id: "q", amountCents: 4900, currency: "usd", plan: "pro_ai", interval: "year", credits: nil, status: "failed", createdAt: 0)
        XCTAssertEqual(PersonalBilling.paymentPlan(plan), "Pro AI · yearly")
        XCTAssertEqual(BillingCopy.amount(799, currency: "usd"), "$7.99 USD")
        XCTAssertEqual(BillingCopy.status("refunded"), "Refunded")
        XCTAssertEqual(PlanCatalog.personal[0].features.last, "On the web · Mac app coming soon")
    }

    func testDates() {
        XCTAssertEqual(BillingCopy.dateOnly(1_790_812_800_000), "Oct 1, 2026")
        let t = BillingCopy.dateTime(1_790_812_800_000 + 15 * 3_600_000 + 45 * 60_000, locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "UTC")!)
        XCTAssertEqual(t.replacingOccurrences(of: "\u{202F}", with: " "), "Oct 1, 2026, 3:45 PM")
    }

    func testCreditLines() throws {
        let accounts = try JSONDecoder().decode(CreditAccountsResponse.self, from: Data(#"""
        {"accounts":[
          {"kind":"personal","workspaceId":null,"name":"Personal","plan":"Pro AI trial","aiIncluded":true,"canBuy":false,"trialing":true,
           "allowance":100,"monthlyLeft":90,"packCredits":0,"available":90,"resetsAt":1790812800000,"nextPackExpiry":null},
          {"kind":"seat","workspaceId":"w_1","name":"Acme","plan":"Workspace Pro","aiIncluded":true,"canBuy":true,"trialing":false,
           "allowance":180,"monthlyLeft":40,"packCredits":1000,"available":1040,"resetsAt":1790812800000,"nextPackExpiry":1790812800000},
          {"kind":"personal","workspaceId":null,"name":"Personal","plan":"Core","aiIncluded":false,"canBuy":false,"trialing":false,
           "allowance":0,"monthlyLeft":0,"packCredits":0,"available":0,"resetsAt":0,"nextPackExpiry":null}
        ],"checkoutAvailable":false,"testPurchases":true}
        """#.utf8))
        XCTAssertEqual(accounts.testPurchases, true)
        XCTAssertEqual(accounts.checkoutAvailable, false)
        XCTAssertEqual(BillingCopy.accountLine(accounts.accounts[0], now: now), "90 AI credits left · 90 of 100 trial credits, trial ends on October 1")
        XCTAssertEqual(BillingCopy.accountLine(accounts.accounts[1], now: now),
                       "1,040 AI credits left · 40 of 180 monthly credits, resets on October 1 · 1,000 extra credits, the first expiring on October 1")
        XCTAssertEqual(BillingCopy.accountLine(accounts.accounts[2], now: now), "Not included in Core. Nothing is sent to an AI model.")
    }

    func testCreditPacks() {
        XCTAssertEqual(PlanCatalog.creditPacks.map(\.credits), [500, 1000])
        XCTAssertEqual(PlanCatalog.creditPacks.map { PlanCatalog.formatPrice($0.priceCents) }, ["$7.99", "$14.99"])
        XCTAssertEqual(BillingCopy.packButton(test: false, busy: false), "Buy")
        XCTAssertEqual(BillingCopy.packButton(test: true, busy: false), "Buy (test)")
        XCTAssertEqual(BillingCopy.packButton(test: true, busy: true), "Adding…")
        XCTAssertEqual(BillingCopy.packButton(test: false, busy: true), "Opening checkout…")
        XCTAssertEqual(BillingCopy.testCreditsAdded(PlanCatalog.creditPacks[1], name: "Acme"), "Added 1,000 AI credits to Acme (test purchase).")
    }
}

final class WorkspaceBillingTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func billing(_ json: String) throws -> WorkspaceBilling {
        WorkspaceBilling(s: try JSONDecoder().decode(WorkspaceBillingSummary.self, from: Data(json.utf8)), name: "Acme", now: now)
    }

    private let freeJSON = #"""
    {"workspace":{"id":"w_1","name":"Acme"},"yourRole":"owner",
     "entitlements":{"scope":"workspace","planId":"workspace_free","paidPlanId":"workspace_free","paid":false,"ai":true,"aiFairUse":"standard","monthlyCredits":0,"storageBytes":1073741824,"storageRule":"shared_free"},
     "plan":{"id":"workspace_free","tier":"free","name":"Free","interval":null,"seatPriceCents":0},
     "subscription":null,"seats":3,"guests":2,"pendingInvites":1,"estimatedChargeCents":0,
     "storageUsedBytes":1288490189,"storageLimitBytes":1073741824,"storageRule":"shared_free","storagePerMemberBytes":null,"yourStorageUsedBytes":null,
     "pool":{"workspaces":3,"includesPersonal":true},"overLimit":true,"credits":null,"payments":[],"checkoutAvailable":true,"testPurchases":false}
    """#

    func testFreeWorkspace() throws {
        let b = try billing(freeJSON)
        XCTAssertNil(b.status)
        XCTAssertNil(b.priceLine)
        XCTAssertEqual(b.description, "For simple collaboration.")
        XCTAssertEqual(b.seatsTitle, "Billable seats: 3")
        XCTAssertEqual(b.guestsLine, "Guests: 2 · Not billed")
        XCTAssertEqual(b.pendingLine, "1 pending invitation, billed once accepted.")
        XCTAssertEqual(b.chargeLine, "Free. Nothing is charged.")
        XCTAssertEqual(b.storageTitle, "Workspace storage")
        XCTAssertEqual(b.storageUsedLine, "1.2 GB of 1 GB used")
        XCTAssertEqual(b.storageNote, "Uses the owner's free 1 GB, shared with their Personal and 2 other free workspaces. Everyone's uploads here count against it.")
        XCTAssertTrue(b.overLimit)
        XCTAssertEqual(b.aiTile, .text("On Free, each member uses their own personal AI credits here."))
        XCTAssertEqual(b.action(for: "free", yearly: false, busy: nil), .current("Current plan"))
        XCTAssertEqual(b.action(for: "pro", yearly: false, busy: nil), .choose(title: "Upgrade to Pro", primary: false, disabled: false))
        XCTAssertEqual(b.action(for: "pro", yearly: false, busy: "pro"), .choose(title: "Opening checkout…", primary: false, disabled: false))
        XCTAssertEqual(b.priceNote(PlanCatalog.workspaceCard("free"), yearly: false), "Nobody is billed")
        XCTAssertEqual(b.priceNote(PlanCatalog.workspaceCard("pro"), yearly: false), "Per member. 3 members × $4.99 = $14.97/month")
        XCTAssertEqual(b.priceNote(PlanCatalog.workspaceCard("core"), yearly: true), "Per member. 3 members × $19 = $57/year")
        XCTAssertEqual(b.footnote, "Payments are handled by Polar, which works out any tax. Adding or removing members changes the seats, prorated.")
        XCTAssertEqual(b.historyDescription, "Payments for Acme only.")
    }

    func testPaidPolarWorkspace() throws {
        let b = try billing(#"""
        {"entitlements":{"planId":"workspace_pro_monthly","paid":true,"ai":true,"monthlyCredits":180,"storageBytes":21474836480,"storageRule":"per_person"},
         "plan":{"id":"workspace_pro_monthly","tier":"pro","name":"Pro","interval":"month","seatPriceCents":499},
         "subscription":{"planId":"workspace_pro_monthly","provider":"polar","status":"active","cancelAtPeriodEnd":false,"currentPeriodStart":1,"currentPeriodEnd":1790812800000,
           "trialEndsAt":null,"quantity":2,"paymentMethod":"Visa 4242","youPay":false},
         "seats":3,"guests":0,"pendingInvites":0,"estimatedChargeCents":1497,"storageUsedBytes":5368709120,"storageLimitBytes":64424509440,"storageRule":"per_person",
         "storagePerMemberBytes":21474836480,"yourStorageUsedBytes":1073741824,"pool":null,"overLimit":false,
         "credits":{"allowance":180,"used":0,"monthlyLeft":180,"packCredits":0,"held":0,"available":180,"resetsAt":1790812800000,"periodStart":0,"nextPackExpiry":null,"canBuy":true},
         "payments":[{"id":"p1","amountCents":998,"currency":"usd","planId":"workspace_pro_monthly","plan":"pro","interval":"month","quantity":2,"status":"paid","createdAt":1}],
         "checkoutAvailable":true,"testPurchases":false}
        """#)
        XCTAssertEqual(b.status, "Active")
        XCTAssertEqual(b.intervalPill, "Monthly")
        XCTAssertEqual(b.description, "Renews Oct 1, 2026.")
        XCTAssertEqual(b.priceLine, "$4.99 per member / month · Paid with Visa 4242")
        XCTAssertTrue(b.someoneElsePays)
        XCTAssertFalse(b.canOpenPortal)
        XCTAssertTrue(b.canCancelOrResume)
        XCTAssertEqual(b.chargeLine, "3 × $4.99 = $14.97/month")
        XCTAssertEqual(b.quantityNote, "Updating the billed seats (2) to match…")
        XCTAssertEqual(b.storageTitle, "Your storage here")
        XCTAssertEqual(b.storageUsedLine, "1 GB of 20 GB used")
        XCTAssertEqual(b.storageNote, "Each member has 20 GB here, and their own uploads count against it. Everyone's uploads: 5 GB.")
        XCTAssertFalse(b.overLimit)
        guard case .credits(let c, let canBuy) = b.aiTile else { return XCTFail("expected credits") }
        XCTAssertTrue(canBuy)
        XCTAssertFalse(c.trialing)
        XCTAssertEqual(c.available, 180)
        XCTAssertEqual(b.action(for: "pro", yearly: false, busy: nil), .current("Current plan"))
        XCTAssertEqual(b.action(for: "pro", yearly: true, busy: nil), .choose(title: "Switch to yearly", primary: false, disabled: false))
        XCTAssertEqual(b.action(for: "core", yearly: false, busy: nil), .choose(title: "Change to Core", primary: false, disabled: false))
        XCTAssertEqual(b.action(for: "pro_ai", yearly: false, busy: "pro_ai"), .choose(title: "Changing…", primary: true, disabled: false))
        XCTAssertEqual(b.action(for: "free", yearly: false, busy: nil), .switchToFree)
        XCTAssertEqual(WorkspaceBilling.paymentPlan(b.s.payments[0]), "Pro · monthly · 2 seats")
        XCTAssertEqual(b.endPlanToast, "Pro will end at the close of this billing period.")
        XCTAssertEqual(b.changeToast("pro_ai"), "Changing to Pro AI. Polar prorates the difference.")
        XCTAssertEqual(b.testToast("core"), "Acme is on Core (test purchase).")
    }

    func testCancelScheduledTrialAndTest() throws {
        let b = try billing(#"""
        {"entitlements":{"planId":"workspace_core_yearly","paid":true,"ai":false,"monthlyCredits":0},
         "plan":{"id":"workspace_core_yearly","tier":"core","interval":"year","seatPriceCents":1900},
         "subscription":{"planId":"workspace_core_yearly","provider":"test","status":"active","cancelAtPeriodEnd":true,"currentPeriodEnd":1790812800000,"youPay":false},
         "seats":0,"guests":0,"pendingInvites":0,"estimatedChargeCents":1900,"storageUsedBytes":0,"storageLimitBytes":0,"storageRule":"override",
         "payments":[],"checkoutAvailable":false,"testPurchases":true}
        """#)
        XCTAssertEqual(b.status, "Cancel scheduled")
        XCTAssertEqual(b.description, "Ends Oct 1, 2026. Core features remain available until then.")
        XCTAssertEqual(b.storageNote, "A limit set by the Folevi team.")
        XCTAssertEqual(b.aiTile, .text("Core doesn't include AI, so nothing in this workspace is sent to an AI model."))
        XCTAssertEqual(b.action(for: "free", yearly: false, busy: nil), .nothing)
        XCTAssertEqual(b.action(for: "pro", yearly: true, busy: nil), .choose(title: "Upgrade to Pro (test)", primary: false, disabled: false))
        XCTAssertEqual(b.action(for: "pro", yearly: true, busy: "pro"), .choose(title: "Switching…", primary: false, disabled: false))
        XCTAssertEqual(b.priceNote(PlanCatalog.workspaceCard("pro"), yearly: true), "Per member. 0 members × $49 = $49/year")
        XCTAssertFalse(b.someoneElsePays)
        XCTAssertTrue(b.footnote.hasPrefix("Payments aren't connected yet"))

        let trial = try billing(#"""
        {"entitlements":{"planId":"workspace_pro_monthly","paid":true,"ai":true,"monthlyCredits":180},
         "plan":{"id":"workspace_pro_monthly","tier":"pro","interval":"month","seatPriceCents":499},
         "subscription":{"provider":"manual","status":"active","cancelAtPeriodEnd":false,"trialEndsAt":1790812800000,"youPay":false},
         "seats":1,"guests":0,"pendingInvites":0,"estimatedChargeCents":499,"storageUsedBytes":0,"storageLimitBytes":0,
         "payments":[],"checkoutAvailable":false,"testPurchases":false}
        """#)
        XCTAssertEqual(trial.status, "Trial")
        XCTAssertEqual(trial.description, "Trial until Oct 1, 2026.")
        XCTAssertFalse(trial.canCancelOrResume)
        XCTAssertEqual(trial.aiTile, .text("180 AI credits per member each month."))
        XCTAssertEqual(trial.action(for: "pro_ai", yearly: false, busy: nil), .comingSoon)
        XCTAssertEqual(trial.footnote, "Online payments for workspaces are coming soon.")
    }

    func testCatalog() {
        XCTAssertEqual(PlanCatalog.workspacePlanId("pro_ai", yearly: true), "workspace_pro_ai_yearly")
        XCTAssertEqual(PlanCatalog.workspacePlanId("free", yearly: true), "workspace_free")
        XCTAssertEqual(PlanCatalog.seatChargeCents(499, seats: 0), 499)
        XCTAssertEqual(PlanCatalog.workspace.map(\.name), ["Free", "Core", "Pro", "Pro AI"])
        XCTAssertEqual(PlanCatalog.workspaceCard("pro").features[1], "180 AI credits per member a month")
    }
}
