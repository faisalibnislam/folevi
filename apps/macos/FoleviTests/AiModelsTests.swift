import XCTest

final class AiCreditsDecodingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testDecodesCreditsSummary() throws {
        let c = try decode(AiCredits.self, #"""
        {"aiIncluded":true,"blockedReason":null,"account":"seat","plan":"Pro","tier":"pro","trialing":false,"canBuy":true,
         "allowance":180,"used":150,"monthlyLeft":30,"packCredits":0,"held":2,"available":28,"resetsAt":1790812800000,
         "periodStart":1788220800000,"nextPackExpiry":null,"monthlyShareLeft":0.1666}
        """#)
        XCTAssertTrue(c.aiIncluded)
        XCTAssertEqual(c.account, "seat")
        XCTAssertEqual(c.available, 28)
        XCTAssertEqual(c.allowance, 180)
        XCTAssertTrue(c.canBuy)
        XCTAssertNil(c.nextPackExpiry)
        XCTAssertEqual(c.monthlyShareLeft, 0.1666, accuracy: 0.0001)
    }

    func testCreditsToleratesMissingFields() throws {
        let c = try decode(AiCredits.self, #"{"aiIncluded":false,"allowance":0}"#)
        XCTAssertFalse(c.aiIncluded)
        XCTAssertEqual(c.account, "personal")
        XCTAssertEqual(c.monthlyShareLeft, 1)
    }

    func testDecodesBillingMine() throws {
        let b = try decode(BillingSummary.self, #"""
        {"entitlements":{"scope":"personal","planId":"personal_pro_ai_monthly","paidPlanId":"personal_free","plan":"pro_ai","paidPlan":"free",
          "paid":false,"trialing":true,"trialEndsAt":1790000000000,"ai":true,"aiSource":"trial","aiFairUse":"high","monthlyCredits":100,
          "creditPacks":true,"storageBytes":53687091200,"storageRule":"per_person","devices":null},
         "subscription":{"planId":"personal_free","plan":"free","interval":null,"status":"active","provider":"none","currentPeriodEnd":null,"cancelAtPeriodEnd":false},
         "storageUsedBytes":1024,"storageLimitBytes":53687091200,"storageRule":"per_person","poolWorkspaces":0,"devicesActive":1,
         "credits":{"allowance":100,"used":10,"monthlyLeft":90,"packCredits":0,"held":0,"available":90,"resetsAt":1790000000000,"periodStart":1,
           "nextPackExpiry":null,"trialing":true,"canBuy":false,"aiIncluded":true},
         "aiRequestsThisMonth":3,
         "payments":[{"id":"p1","amountCents":799,"currency":"usd","plan":"credits","interval":null,"credits":500,"status":"paid","createdAt":1}],
         "checkoutAvailable":false,"creditsCheckoutAvailable":false,"testPurchases":true}
        """#)
        XCTAssertEqual(b.entitlements.paidPlanId, "personal_free")
        XCTAssertTrue(b.entitlements.trialing)
        XCTAssertNil(b.entitlements.deviceLimit)
        XCTAssertEqual(b.credits?.available, 90)
        XCTAssertEqual(b.credits?.trialing, true)
        XCTAssertEqual(b.payments?.first?.credits, 500)
        XCTAssertEqual(b.storageLimitBytes, 53687091200)
        XCTAssertEqual(b.subscription?.planId, "personal_free")
    }

    func testOlderBillingMineStillDecodes() throws {
        let b = try decode(BillingSummary.self, #"""
        {"entitlements":{"plan":"free","paidPlan":"free","trialing":false,"ai":true,"storageBytes":1073741824,"devices":2},
         "subscription":null,"storageUsedBytes":0,"devicesActive":1,"aiRequestsThisMonth":0}
        """#)
        XCTAssertNil(b.credits)
        XCTAssertNil(b.payments)
        XCTAssertEqual(b.entitlements.deviceLimit, 2)
    }

    func testDecodesCreditAccounts() throws {
        let r = try decode(CreditAccountsResponse.self, #"""
        {"accounts":[
          {"kind":"personal","workspaceId":null,"name":"Personal","plan":"Free","aiIncluded":true,"canBuy":false,"trialing":false,
           "allowance":25,"used":5,"monthlyLeft":20,"packCredits":0,"held":0,"available":20,"resetsAt":1,"periodStart":0,"nextPackExpiry":null},
          {"kind":"seat","workspaceId":"w_1","name":"Acme","plan":"Pro","aiIncluded":true,"canBuy":true,"trialing":false,
           "allowance":180,"used":0,"monthlyLeft":180,"packCredits":500,"held":0,"available":680,"resetsAt":1,"periodStart":0,"nextPackExpiry":5}
        ],"checkoutAvailable":true,"testPurchases":false}
        """#)
        XCTAssertEqual(r.accounts.map(\.id), ["personal", "w_1"])
        XCTAssertEqual(r.accounts[1].packCredits, 500)
        XCTAssertEqual(r.accounts[1].nextPackExpiry, 5)
    }
}

final class AiProblemTests: XCTestCase {
    func testOutOfCredits() throws {
        let data = try JSONValue(jsonString: #"{"code":"out_of_credits","message":"You've used this month's AI credits. They reset on October 1. Buy more in Settings → Plan & billing.","resetsAt":1790812800000,"available":0,"needed":2,"action":"buy"}"#)
        let p = try XCTUnwrap(AiProblem(convexError: data))
        XCTAssertEqual(p.kind, .outOfCredits)
        XCTAssertEqual(p.action, .buy)
        XCTAssertEqual(p.needed, 2)
        XCTAssertEqual(p.resetsAt, 1790812800000)
        XCTAssertTrue(p.message.hasPrefix("You've used"))
        XCTAssertEqual(p.action.title, "Buy more")
    }

    func testUpgradeAndSeat() throws {
        let up = try XCTUnwrap(AiProblem(convexError: try JSONValue(jsonString: #"{"code":"out_of_credits","message":"m","action":"upgrade"}"#)))
        XCTAssertEqual(up.action, .upgrade)
        XCTAssertEqual(up.action.title, "Upgrade")
        let seat = try XCTUnwrap(AiProblem(convexError: try JSONValue(jsonString: #"{"code":"out_of_credits","message":"m","action":"none"}"#)))
        XCTAssertEqual(seat.action, .none)
        XCTAssertNil(seat.action.title)
    }

    func testNotIncluded() throws {
        let p = try XCTUnwrap(AiProblem(convexError: try JSONValue(jsonString: #"{"code":"forbidden","message":"Core doesn't include AI.","reason":"ai_not_included"}"#)))
        XCTAssertEqual(p.kind, .notIncluded)
        XCTAssertEqual(p.action, .none)
    }

    func testOtherErrorsAreNotAiProblems() throws {
        XCTAssertNil(AiProblem(convexError: try JSONValue(jsonString: #"{"code":"forbidden","message":"The AI Assistant is turned off in your settings."}"#)))
        XCTAssertNil(AiProblem(convexError: try JSONValue(jsonString: #"{"code":"rate_limited","message":"Busy"}"#)))
    }
}

final class AiCreditCopyTests: XCTestCase {
    /// 2026-10-01T00:00:00Z
    let oct1: Double = 1_790_812_800_000
    var now: Date { Date(timeIntervalSince1970: 1_789_000_000) }

    func testCounts() {
        XCTAssertEqual(AiCreditCopy.count(1), "1 AI credit")
        XCTAssertEqual(AiCreditCopy.count(12), "12 AI credits")
        XCTAssertEqual(AiCreditCopy.count(1250), "1,250 AI credits")
    }

    func testDates() {
        XCTAssertEqual(AiCreditCopy.date(oct1, now: now), "October 1")
        XCTAssertEqual(AiCreditCopy.date(oct1, now: Date(timeIntervalSince1970: 1_700_000_000)), "October 1, 2026")
    }

    func testLowNoteOnlyWhenLow() {
        let plenty = AiCredits(allowance: 180, monthlyLeft: 150, available: 150, resetsAt: oct1)
        XCTAssertNil(AiCreditCopy.lowNote(plenty, now: now))
        // Under 20% of the month, no packs: low.
        let low = AiCredits(canBuy: true, allowance: 180, monthlyLeft: 30, available: 30, resetsAt: oct1)
        let note = try? XCTUnwrap(AiCreditCopy.lowNote(low, now: now))
        XCTAssertEqual(note?.text, "30 AI credits left. Resets October 1.")
        XCTAssertEqual(note?.action, .buy)
        // Packs to fall back on: not low unless only a handful are left.
        let packs = AiCredits(allowance: 180, monthlyLeft: 30, packCredits: 500, available: 530, resetsAt: oct1)
        XCTAssertNil(AiCreditCopy.lowNote(packs, now: now))
        // Not included: nothing.
        XCTAssertNil(AiCreditCopy.lowNote(AiCredits(aiIncluded: false, available: 0), now: now))
    }

    func testLowNoteWordsForSeatTrialAndEmpty() {
        let seat = AiCredits(account: "seat", allowance: 180, monthlyLeft: 0, available: 0, resetsAt: oct1)
        let s = AiCreditCopy.lowNote(seat, now: now)
        XCTAssertEqual(s?.text, "No AI credits left in this workspace. Resets October 1.")
        XCTAssertEqual(s?.action, AiCreditAction.none)
        let trial = AiCredits(trialing: true, allowance: 100, monthlyLeft: 5, available: 5, resetsAt: oct1)
        let t = AiCreditCopy.lowNote(trial, now: now)
        XCTAssertEqual(t?.text, "5 AI credits left. Your trial ends on October 1.")
        XCTAssertEqual(t?.action, .upgrade)
    }

    func testDetailLine() {
        XCTAssertEqual(AiCreditCopy.detail(available: 40, allowance: 180, monthlyLeft: 40, packCredits: 0, resetsAt: oct1, nextPackExpiry: nil, trialing: false, now: now),
                       "40 of 180 monthly credits left. Resets on October 1.")
        XCTAssertEqual(AiCreditCopy.detail(available: 540, allowance: 180, monthlyLeft: 40, packCredits: 500, resetsAt: oct1, nextPackExpiry: oct1, trialing: false, now: now),
                       "40 of 180 monthly credits left. Resets on October 1. Plus 500 extra credits, the first expiring on October 1.")
    }
}

final class AiCatalogTests: XCTestCase {
    func testComposerOptions() {
        XCTAssertEqual(AiCatalog.options(input: "", hasTarget: true, languages: false).map(\.id).first, "improve")
        XCTAssertEqual(AiCatalog.options(input: "", hasTarget: false, languages: false).map(\.id),
                       ["continue", "summarize", "actions", "outline", "brainstorm"])
        // What you type comes first, then the matching actions.
        let typed = AiCatalog.options(input: "short", hasTarget: true, languages: false)
        XCTAssertEqual(typed.map(\.id), ["custom", "shorter"])
        XCTAssertEqual(typed.first?.label, "short")
        // Languages filter by prefix.
        XCTAssertEqual(AiCatalog.options(input: "Fr", hasTarget: true, languages: true).map(\.label), ["French"])
        XCTAssertEqual(AiCatalog.options(input: "", hasTarget: true, languages: true).count, 15)
    }

    func testLabelsAndReplace() {
        XCTAssertEqual(AiCatalog.label(task: "improve"), "Improve writing")
        XCTAssertEqual(AiCatalog.label(task: "translate", language: "French"), "Translate to French")
        XCTAssertEqual(AiCatalog.label(task: "continue"), "Continue writing")
        XCTAssertFalse(AiCatalog.replaces(task: "explain"))
        XCTAssertFalse(AiCatalog.replaces(task: "summarizeText"))
        XCTAssertTrue(AiCatalog.replaces(task: "fix"))
    }

    func testSlashCommands() {
        XCTAssertEqual(AiCatalog.slash.map(\.label), ["Ask AI…", "AI · Continue writing", "AI · Summarize note", "AI · Find action items", "AI · Make an outline", "AI · Brainstorm ideas"])
        XCTAssertEqual(AiCatalog.slashTask("ai-outline"), .some("outline"))
        XCTAssertEqual(AiCatalog.slashTask("ai"), .some(nil))
        XCTAssertTrue(AiCatalog.slashTask("heading1") == nil)
    }

    func testCleanTitle() {
        XCTAssertEqual(AiCatalog.cleanTitle("“Quarterly Plan.”"), "Quarterly Plan")
        XCTAssertEqual(AiCatalog.cleanTitle("\"Trip notes\"\n"), "Trip notes")
        XCTAssertEqual(AiCatalog.cleanTitle("Line one\nline two."), "Line one line two")
    }

    func testApplyTitle() {
        XCTAssertEqual(AiCatalog.applyTitle("Better", to: "My plan for today", range: NSRange(location: 3, length: 4)), "My Better for today")
        XCTAssertEqual(AiCatalog.applyTitle("New title.", to: "Old", range: NSRange(location: 0, length: 0)), "New title")
        XCTAssertNil(AiCatalog.applyTitle("  \n ", to: "Old", range: NSRange(location: 0, length: 0)))
    }

    func testMarkdownToPlain() {
        XCTAssertEqual(AiCatalog.markdownToPlain("## This week\n- **Ship** the `app` [1]"), "This week\n- Ship the app [1]")
    }

    func testTypewriterEndsOnWordBoundaries() {
        let target = "The quick brown fox jumps over the lazy dog"
        var shown = 0
        var steps = 0
        while shown < target.count {
            let next = Typewriter.next(shown: shown, target: target)
            XCTAssertGreaterThan(next, shown)
            if next < target.count {
                XCTAssertTrue(Array(target)[next].isWhitespace, "stopped mid-word at \(next)")
            }
            shown = next
            steps += 1
        }
        XCTAssertEqual(shown, target.count)
        XCTAssertGreaterThan(steps, 2)
        XCTAssertEqual(Typewriter.next(shown: 50, target: "short"), 5)
    }
}

final class PlanCatalogTests: XCTestCase {
    func testPrices() {
        XCTAssertEqual(PlanCatalog.formatPrice(1299), "$12.99")
        XCTAssertEqual(PlanCatalog.formatPrice(4900), "$49")
        XCTAssertEqual(PlanCatalog.monthlyEquivalent(4900), "$4.08")
        XCTAssertEqual(PlanCatalog.yearlySavingPercent("pro_ai"), 4)
        XCTAssertEqual(PlanCatalog.yearlySavingPercent("pro"), 18)
        XCTAssertEqual(PlanCatalog.bestYearlySaving, 20)
        XCTAssertEqual(PlanCatalog.personal.map(\.monthlyCredits), [25, 0, 180, 550])
    }

    func testPlanIdsAndLabels() {
        XCTAssertEqual(PlanCatalog.personalPlanId("pro", yearly: true), "personal_pro_yearly")
        XCTAssertEqual(PlanCatalog.personalPlanId("free", yearly: true), "personal_free")
        XCTAssertEqual(PlanCatalog.actionLabel(tier: "pro", yearly: true, paid: false, paidPlan: "free", trialing: false), "Upgrade to Pro")
        XCTAssertEqual(PlanCatalog.actionLabel(tier: "pro", yearly: true, paid: false, paidPlan: "free", trialing: true), "Choose Pro")
        XCTAssertEqual(PlanCatalog.actionLabel(tier: "core", yearly: false, paid: true, paidPlan: "pro", trialing: false), "Change to Core")
        XCTAssertEqual(PlanCatalog.actionLabel(tier: "pro", yearly: true, paid: true, paidPlan: "pro", trialing: false), "Switch to yearly")
    }

    func testFormatBytes() {
        XCTAssertEqual(PlanCatalog.formatBytes(1024 * 1024 * 1024), "1 GB")
        XCTAssertEqual(PlanCatalog.formatBytes(1.5 * 1024 * 1024 * 1024), "1.5 GB")
        XCTAssertEqual(PlanCatalog.formatBytes(20 * 1024 * 1024 * 1024), "20 GB")
        XCTAssertEqual(PlanCatalog.formatBytes(340 * 1024 * 1024), "340 MB")
        XCTAssertEqual(PlanCatalog.formatBytes(2048), "2 KB")
    }
}

final class AiPanelTests: XCTestCase {
    func testResultLabels() {
        XCTAssertEqual(AiPanelCatalog.label(task: "refine"), "Revised")
        XCTAssertEqual(AiPanelCatalog.label(task: "translate"), "Translate")
        XCTAssertEqual(AiPanelCatalog.label(task: "summarizeText"), "Summarize")
        XCTAssertEqual(AiPanelCatalog.label(task: "actions"), "Action items")
        XCTAssertEqual(AiPanelCatalog.label(task: "draft"), "Written for you")
        XCTAssertEqual(AiPanelCatalog.label(task: "anything"), "Answer")
    }

    func testQuickActions() {
        XCTAssertEqual(AiPanelCatalog.noteActions.map(\.task), ["summarize", "continue", "actions", "outline", "brainstorm", "title"])
        XCTAssertTrue(AiPanelCatalog.availableReadOnly(task: "summarize"))
        XCTAssertFalse(AiPanelCatalog.availableReadOnly(task: "continue"))
        XCTAssertTrue(AiPanelCatalog.placesAtEnd(task: "continue"))
        XCTAssertFalse(AiPanelCatalog.placesAtEnd(task: "outline"))
    }

    func testComposerSitsUnderTheText() {
        let f = InlineAiPlacement.place(caretTop: 100, caretBottom: 120, columnLeft: 200, columnWidth: 700,
                                        viewportWidth: 1200, viewportHeight: 800, height: 260)
        XCTAssertEqual(f, InlineAiPlacement.Frame(left: 200, top: 130, width: 640, up: false))
    }

    func testComposerGoesAboveWithoutRoomBelow() {
        let f = InlineAiPlacement.place(caretTop: 700, caretBottom: 720, columnLeft: 4, columnWidth: 200,
                                        viewportWidth: 1000, viewportHeight: 800, height: 260)
        XCTAssertTrue(f.up)
        XCTAssertEqual(f.top, 430)
        XCTAssertEqual(f.width, 320)
        XCTAssertEqual(f.left, 8)
    }

    func testComposerStaysInsideNarrowViewports() {
        let f = InlineAiPlacement.place(caretTop: 50, caretBottom: 70, columnLeft: 400, columnWidth: 600,
                                        viewportWidth: 900, viewportHeight: 800, height: 200)
        XCTAssertEqual(f.left, 900 - 600 - 8)
    }

    func testTitleMenuPosition() {
        let at = InlineAiPlacement.belowTitle(titleLeft: 120, titleBottom: 200.4, viewportWidth: 1000)
        XCTAssertEqual(at.left, 120)
        XCTAssertEqual(at.top, 208)
        XCTAssertEqual(InlineAiPlacement.belowTitle(titleLeft: 900, titleBottom: 0, viewportWidth: 1000).left, 624)
        XCTAssertEqual(InlineAiPlacement.belowTitle(titleLeft: 2, titleBottom: 0, viewportWidth: 1000).left, 16)
    }

    func testAnswerBlocks() {
        let items = AiMarkdownLayout.items("""
        ## Plan

        Some **bold** text.

        1. First
        2. Second
        - [x] Done
        - [ ] Open
        - Bullet
        """)
        XCTAssertEqual(items.map(\.kind), [.heading(2), .paragraph, .numbered(1), .numbered(2), .todo(checked: true), .todo(checked: false), .bullet])
        XCTAssertEqual(items[1].text, [.text(text: "Some ", marks: nil), .text(text: "bold", marks: [.bold]), .text(text: " text.", marks: nil)])
    }
}
