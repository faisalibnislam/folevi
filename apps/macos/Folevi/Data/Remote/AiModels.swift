import Foundation

// AI and AI credits, as the server reports them (convex/ai.ts, convex/billing.ts, convex/lib/credits.ts)
// and as the web shows them (apps/web/src/components/ai). Pure: compiled into the unit tests too.

// MARK: - Credits

/// billing:credits: the AI credits that apply where the person is working (a scope, or a note's own scope).
struct AiCredits: Decodable, Sendable, Equatable {
    /// Whether AI can be used here at all (false in Core scopes).
    var aiIncluded: Bool
    var blockedReason: String?
    /// "personal" or "seat" (a member's seat in a paid workspace).
    var account: String
    var plan: String
    var tier: String?
    var trialing: Bool
    var canBuy: Bool
    var allowance: Double
    var used: Double
    var monthlyLeft: Double
    var packCredits: Double
    var held: Double
    var available: Double
    var resetsAt: Double
    var nextPackExpiry: Double?
    /// Share of this period's monthly credits left (0 to 1); 1 when the plan has none.
    var monthlyShareLeft: Double

    enum CodingKeys: String, CodingKey {
        case aiIncluded, blockedReason, account, plan, tier, trialing, canBuy, allowance, used, monthlyLeft, packCredits, held,
             available, resetsAt, nextPackExpiry, monthlyShareLeft
    }

    init(aiIncluded: Bool = true, account: String = "personal", plan: String = "Free", trialing: Bool = false, canBuy: Bool = false,
         allowance: Double = 0, monthlyLeft: Double = 0, packCredits: Double = 0, available: Double = 0, resetsAt: Double = 0) {
        self.aiIncluded = aiIncluded
        self.account = account
        self.plan = plan
        self.trialing = trialing
        self.canBuy = canBuy
        self.allowance = allowance
        self.used = max(0, allowance - monthlyLeft)
        self.monthlyLeft = monthlyLeft
        self.packCredits = packCredits
        self.held = 0
        self.available = available
        self.resetsAt = resetsAt
        self.monthlyShareLeft = allowance > 0 ? monthlyLeft / allowance : 1
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        aiIncluded = try c.decodeIfPresent(Bool.self, forKey: .aiIncluded) ?? true
        blockedReason = try c.decodeIfPresent(String.self, forKey: .blockedReason)
        account = try c.decodeIfPresent(String.self, forKey: .account) ?? "personal"
        plan = try c.decodeIfPresent(String.self, forKey: .plan) ?? ""
        tier = try c.decodeIfPresent(String.self, forKey: .tier)
        trialing = try c.decodeIfPresent(Bool.self, forKey: .trialing) ?? false
        canBuy = try c.decodeIfPresent(Bool.self, forKey: .canBuy) ?? false
        allowance = try c.decodeIfPresent(Double.self, forKey: .allowance) ?? 0
        used = try c.decodeIfPresent(Double.self, forKey: .used) ?? 0
        monthlyLeft = try c.decodeIfPresent(Double.self, forKey: .monthlyLeft) ?? 0
        packCredits = try c.decodeIfPresent(Double.self, forKey: .packCredits) ?? 0
        held = try c.decodeIfPresent(Double.self, forKey: .held) ?? 0
        available = try c.decodeIfPresent(Double.self, forKey: .available) ?? 0
        resetsAt = try c.decodeIfPresent(Double.self, forKey: .resetsAt) ?? 0
        nextPackExpiry = try c.decodeIfPresent(Double.self, forKey: .nextPackExpiry)
        monthlyShareLeft = try c.decodeIfPresent(Double.self, forKey: .monthlyShareLeft) ?? (allowance > 0 ? monthlyLeft / allowance : 1)
    }
}

/// What helps when AI is refused: buying a credit pack, a bigger plan, or nothing (a workspace seat).
enum AiCreditAction: String, Sendable, Equatable {
    case buy, upgrade, none

    /// The button's title ("Buy more" / "Upgrade"); nil when nothing helps.
    var title: String? {
        switch self {
        case .buy: return String(localized: "Buy more")
        case .upgrade: return String(localized: "Upgrade")
        case .none: return nil
        }
    }
}

/// A refused AI request, from the server's ConvexError data (the web's `aiProblem`).
struct AiProblem: Sendable, Equatable {
    enum Kind: String, Sendable { case outOfCredits, notIncluded, other }
    var kind: Kind
    var action: AiCreditAction
    var message: String
    /// When the monthly credits reset (out of credits only).
    var resetsAt: Double?
    var available: Double?
    var needed: Double?

    static func other(_ message: String) -> AiProblem { AiProblem(kind: .other, action: .none, message: message) }

    /// Out of credits (`{code: "out_of_credits", action, resetsAt, available, needed}`) or AI not included
    /// (`{code: "forbidden", reason: "ai_not_included"}`); nil for anything else.
    init?(convexError data: JSONValue) {
        let code = data["code"]?.stringValue
        let message = data["message"]?.stringValue ?? String(localized: "Something went wrong.")
        if code == "out_of_credits" {
            let action = AiCreditAction(rawValue: data["action"]?.stringValue ?? "") ?? .none
            self.init(kind: .outOfCredits, action: action, message: message,
                      resetsAt: data["resetsAt"]?.doubleValue, available: data["available"]?.doubleValue, needed: data["needed"]?.doubleValue)
        } else if code == "forbidden", data["reason"]?.stringValue == "ai_not_included" {
            self.init(kind: .notIncluded, action: .none, message: message)
        } else {
            return nil
        }
    }

    init(kind: Kind, action: AiCreditAction, message: String, resetsAt: Double? = nil, available: Double? = nil, needed: Double? = nil) {
        self.kind = kind
        self.action = action
        self.message = message
        self.resetsAt = resetsAt
        self.available = available
        self.needed = needed
    }
}

/// The words the AI panels and Plan & billing use for credits (the web's AiCredits.tsx and BillingSection.tsx).
enum AiCreditCopy {
    /// Below this many credits, the panels say how many are left (whatever the plan).
    static let lowCredits: Double = 10

    /// "12 AI credits", "1 AI credit".
    static func count(_ n: Double) -> String {
        let value = Int(n.rounded())
        return value == 1 ? String(localized: "1 AI credit") : String(localized: "\(grouped(value)) AI credits")
    }

    /// "1,250": whole numbers with grouping, as `toLocaleString()` writes them.
    static func grouped(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    static func grouped(_ n: Double) -> String { grouped(Int(n.rounded())) }

    /// "October 1" (UTC, like the server's messages), with the year when it isn't this year.
    static func date(_ ms: Double, now: Date = Date()) -> String {
        let d = Date(timeIntervalSince1970: ms / 1000)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = cal.component(.year, from: d) != cal.component(.year, from: now) ? "MMMM d, yyyy" : "MMMM d"
        return f.string(from: d)
    }

    /// The quiet line in an AI panel when credits run low (fewer than 20% of this period's monthly credits
    /// left and no bought credits, or only a handful left in total), with what helps. Nil otherwise.
    static func lowNote(_ c: AiCredits, now: Date = Date()) -> (text: String, action: AiCreditAction)? {
        guard c.aiIncluded else { return nil }
        let low = c.available <= lowCredits || (c.allowance > 0 && c.monthlyShareLeft < 0.2 && c.packCredits == 0)
        guard low else { return nil }
        let seat = c.account == "seat"
        let left: String
        if c.available > 0 {
            left = seat ? String(localized: "\(count(c.available)) left in this workspace.") : String(localized: "\(count(c.available)) left.")
        } else {
            left = seat ? String(localized: "No AI credits left in this workspace.") : String(localized: "No AI credits left.")
        }
        let when = c.trialing ? String(localized: "Your trial ends on \(date(c.resetsAt, now: now)).") : String(localized: "Resets \(date(c.resetsAt, now: now)).")
        let action: AiCreditAction = c.canBuy ? .buy : seat ? .none : .upgrade
        return ("\(left) \(when)", action)
    }

    /// Plan & billing's line under the credits meter ("40 of 180 monthly credits left. Resets on …").
    static func detail(available: Double, allowance: Double, monthlyLeft: Double, packCredits: Double, resetsAt: Double,
                       nextPackExpiry: Double?, trialing: Bool, now: Date = Date()) -> String {
        var out = trialing
            ? String(localized: "\(grouped(monthlyLeft)) of \(grouped(allowance)) trial credits left. Your trial ends on \(date(resetsAt, now: now)).")
            : String(localized: "\(grouped(monthlyLeft)) of \(grouped(allowance)) monthly credits left. Resets on \(date(resetsAt, now: now)).")
        if packCredits > 0 {
            let extra = packCredits == 1 ? String(localized: "1 extra credit") : String(localized: "\(grouped(packCredits)) extra credits")
            if let next = nextPackExpiry {
                out += " " + String(localized: "Plus \(extra), the first expiring on \(date(next, now: now)).")
            } else {
                out += " " + String(localized: "Plus \(extra).")
            }
        }
        return out
    }
}

// MARK: - Writing help

/// One row of the AI composer: a task, the language list, or what you typed.
struct AiSuggestion: Identifiable, Equatable, Sendable {
    var id: String
    var label: String
    /// SF Symbol; nil draws the AI mark.
    var systemImage: String?
    var task: String?
    /// Opens the language list instead of running.
    var languages = false
}

/// The AI composer's tasks, labels and languages (the web's InlineAi.tsx, TitleAi.tsx, EditorMenus.tsx).
enum AiCatalog {
    /// Rewrites of the selected text.
    static let edit: [AiSuggestion] = [
        AiSuggestion(id: "improve", label: String(localized: "Improve writing"), systemImage: "wand.and.stars", task: "improve"),
        AiSuggestion(id: "fix", label: String(localized: "Fix spelling & grammar"), systemImage: "textformat.abc.dottedunderline", task: "fix"),
        AiSuggestion(id: "shorter", label: String(localized: "Make shorter"), systemImage: "arrow.down.right.and.arrow.up.left", task: "shorter"),
        AiSuggestion(id: "longer", label: String(localized: "Make longer"), systemImage: "arrow.up.left.and.arrow.down.right", task: "longer"),
        AiSuggestion(id: "simplify", label: String(localized: "Simplify language"), systemImage: "book", task: "simplify"),
        AiSuggestion(id: "professional", label: String(localized: "Sound professional"), systemImage: "pencil.line", task: "professional"),
        AiSuggestion(id: "casual", label: String(localized: "Sound casual"), systemImage: "pencil.line", task: "casual"),
        AiSuggestion(id: "translate", label: String(localized: "Translate to…"), systemImage: "character.bubble", languages: true),
        AiSuggestion(id: "explain", label: String(localized: "Explain this"), systemImage: "lightbulb", task: "explain"),
        AiSuggestion(id: "summarizeText", label: String(localized: "Summarize this"), systemImage: "doc.text", task: "summarizeText"),
    ]

    /// Writing from the note, at the cursor.
    static let write: [AiSuggestion] = [
        AiSuggestion(id: "continue", label: String(localized: "Continue writing"), systemImage: "pencil.line", task: "continue"),
        AiSuggestion(id: "summarize", label: String(localized: "Summarize this note"), systemImage: "doc.text", task: "summarize"),
        AiSuggestion(id: "actions", label: String(localized: "Find action items"), systemImage: "checklist", task: "actions"),
        AiSuggestion(id: "outline", label: String(localized: "Make an outline"), systemImage: "list.bullet.indent", task: "outline"),
        AiSuggestion(id: "brainstorm", label: String(localized: "Brainstorm ideas"), systemImage: "lightbulb", task: "brainstorm"),
    ]

    /// Quick changes to a result.
    static let refines = [String(localized: "Shorter"), String(localized: "Longer"), String(localized: "Simpler"),
                          String(localized: "More formal"), String(localized: "More casual")]

    /// The languages under "Translate to…" (apps/web/src/components/ai/languages.ts).
    static let languages = ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Bengali", "Hindi", "Arabic",
                            "Chinese", "Japanese", "Korean", "Turkish", "Russian"]

    /// The title's rewrites (TitleAi.tsx).
    static let titleActions: [(task: String, label: String)] = [
        ("improve", String(localized: "Improve writing")), ("fix", String(localized: "Fix spelling & grammar")),
        ("shorter", String(localized: "Make shorter")), ("simplify", String(localized: "Simplify language")),
        ("professional", String(localized: "Sound professional")), ("casual", String(localized: "Sound casual")),
    ]

    /// The "/" commands (EditorMenus.tsx): id, label, search words, and the task they run at once (nil opens the composer).
    static let slash: [(id: String, label: String, keywords: String, task: String?)] = [
        ("ai", String(localized: "Ask AI…"), "ai assistant write generate gemini ask", nil),
        ("ai-continue", String(localized: "AI · Continue writing"), "ai continue write more next", "continue"),
        ("ai-summarize", String(localized: "AI · Summarize note"), "ai summary summarize tldr", "summarize"),
        ("ai-actions", String(localized: "AI · Find action items"), "ai tasks todo action items follow ups", "actions"),
        ("ai-outline", String(localized: "AI · Make an outline"), "ai outline structure plan", "outline"),
        ("ai-brainstorm", String(localized: "AI · Brainstorm ideas"), "ai ideas brainstorm", "brainstorm"),
    ]

    /// The task a "/" command runs (nil: just open the composer), or nil when the id isn't an AI command.
    static func slashTask(_ id: String) -> String?? {
        guard let item = slash.first(where: { $0.id == id }) else { return nil }
        return .some(item.task)
    }

    /// The label a running task shows ("Improve writing", "Translate to French").
    static func label(task: String, language: String? = nil) -> String {
        if task == "translate" { return String(localized: "Translate to \(language ?? "English")") }
        return (edit + write).first { $0.task == task }?.label ?? String(localized: "Writing")
    }

    /// Explain and Summarize answer about the text rather than rewrite it: they insert below, never replace.
    static func replaces(task: String) -> Bool { task != "explain" && task != "summarizeText" }

    /// The composer's rows: what you typed first (as an instruction), then the matching actions; or the
    /// languages that start with what you typed.
    static func options(input: String, hasTarget: Bool, languages showLanguages: Bool) -> [AiSuggestion] {
        let typed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let q = typed.lowercased()
        if showLanguages {
            return languages.filter { q.isEmpty || $0.lowercased().hasPrefix(q) }
                .map { AiSuggestion(id: "lang-\($0)", label: $0, systemImage: "character.bubble", task: "translate") }
        }
        let base = hasTarget ? edit : write
        let matches = base.filter { q.isEmpty || $0.label.lowercased().contains(q) }
        return typed.isEmpty ? matches : [AiSuggestion(id: "custom", label: typed, systemImage: nil)] + matches
    }

    /// Titles are one line: drop line breaks, wrapping quotes and a trailing full stop from AI replies.
    static func cleanTitle(_ text: String) -> String {
        var t = text.replacingOccurrences(of: #"\s*\n+\s*"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let opens: Set<Character> = ["\"", "“", "'", "‘"]
        let closes: Set<Character> = ["\"", "”", "'", "’"]
        if t.count >= 2, let f = t.first, let l = t.last, opens.contains(f), closes.contains(l) {
            t = String(t.dropFirst().dropLast())
        }
        if t.hasSuffix(".") { t.removeLast() }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The title with `range` (UTF-16 offsets) replaced by a cleaned AI reply; the whole title when the
    /// range is empty or covers it all.
    static func applyTitle(_ reply: String, to title: String, range: NSRange) -> String? {
        let clean = cleanTitle(reply)
        guard !clean.isEmpty else { return nil }
        let ns = title as NSString
        let whole = range.length == 0 || (range.location == 0 && range.length >= ns.length) || NSMaxRange(range) > ns.length
        return whole ? clean : ns.replacingCharacters(in: range, with: clean)
    }

    /// Markdown as plain text, for Copy.
    static func markdownToPlain(_ markdown: String) -> String {
        markdown
            .replacingOccurrences(of: #"(?m)^#{1,6}\s+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\*\*(.+?)\*\*"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"(^|\W)[*_](.+?)[*_](?=\W|$)"#, with: "$1$2", options: .regularExpression)
            .replacingOccurrences(of: #"`([^`]+)`"#, with: "$1", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Reveals streamed text word by word: the shown part catches up with what's arrived, a few words a frame
/// (faster when it falls behind), always ending on a word boundary (the web's useTypewriter).
enum Typewriter {
    /// How many characters to show next, given `shown` of `target` (both in Characters).
    static func next(shown: Int, target: String) -> Int {
        let count = target.count
        guard shown < count else { return count }
        let behind = count - shown
        var next = shown + max(3, Int((Double(behind) / 28).rounded(.up)))
        guard next < count else { return count }
        let rest = target.dropFirst(next)
        if let space = rest.firstIndex(where: { $0.isWhitespace }) {
            next += rest.distance(from: rest.startIndex, to: space)
        } else {
            next = count
        }
        return min(next, count)
    }
}

// MARK: - Plans (convex/lib/plans.ts)

/// A Personal plan, as Settings → Plan & billing shows it.
struct PlanCard: Identifiable, Sendable, Equatable {
    var tier: String
    var name: String
    var monthlyCents: Int
    var yearlyCents: Int
    var monthlyCredits: Int
    var blurb: String
    var features: [String]
    var id: String { tier }
    var paid: Bool { tier != "free" }
}

enum PlanCatalog {
    static let order = ["free", "core", "pro", "pro_ai"]
    static let monthlyCredits: [String: Int] = ["free": 25, "core": 0, "pro": 180, "pro_ai": 550]
    static let trialCredits = 100
    static let packValidMonths = 12
    static let prices: [String: (month: Int, year: Int)] = ["core": (199, 1900), "pro": (499, 4900), "pro_ai": (1299, 14900)]

    static let personal: [PlanCard] = [
        PlanCard(tier: "free", name: PlanTier.name("free"), monthlyCents: 0, yearlyCents: 0, monthlyCredits: 25,
                 blurb: String(localized: "Everything you need to write and organize."),
                 features: [String(localized: "1 GB storage, shared with the free workspaces you own"), String(localized: "25 AI credits a month"),
                            String(localized: "Use on 2 devices"), String(localized: "Unlimited notes, folders and tasks"),
                            String(localized: "On the web · Mac app coming soon")]),
        PlanCard(tier: "core", name: PlanTier.name("core"), monthlyCents: 199, yearlyCents: 1900, monthlyCredits: 0,
                 blurb: String(localized: "More room, and no AI."),
                 features: [String(localized: "20 GB storage"), String(localized: "No AI. Your notes stay yours: nothing is sent to an AI model"),
                            String(localized: "Unlimited devices"), String(localized: "Everything in Free, without AI")]),
        PlanCard(tier: "pro", name: PlanTier.name("pro"), monthlyCents: 499, yearlyCents: 4900, monthlyCredits: 180,
                 blurb: String(localized: "More room, and AI for everyday writing."),
                 features: [String(localized: "20 GB storage"), String(localized: "180 AI credits a month"), String(localized: "Unlimited devices"),
                            String(localized: "Buy more AI credits when you need them"), String(localized: "Everything in Core, with AI")]),
        PlanCard(tier: "pro_ai", name: PlanTier.name("pro_ai"), monthlyCents: 1299, yearlyCents: 14900, monthlyCredits: 550,
                 blurb: String(localized: "AI as much as you need, with the most room."),
                 features: [String(localized: "50 GB storage"), String(localized: "Unlimited AI, fair use (550 credits a month)"), String(localized: "Unlimited devices"),
                            String(localized: "Buy more AI credits when you need them"), String(localized: "Everything in Pro")]),
    ]

    static func card(_ tier: String) -> PlanCard { personal.first { $0.tier == tier } ?? personal[0] }

    /// "$5", "$12.99".
    static func formatPrice(_ cents: Int) -> String {
        cents % 100 == 0 ? "$\(cents / 100)" : String(format: "$%.2f", Double(cents) / 100)
    }

    /// A yearly price per month, rounded down to the cent ("$4.08").
    static func monthlyEquivalent(_ yearlyCents: Int) -> String { formatPrice(yearlyCents / 12) }

    /// How much paying yearly saves on a tier, in whole percent.
    static func yearlySavingPercent(_ tier: String) -> Int {
        guard let p = prices[tier] else { return 0 }
        return Int(((1 - Double(p.year) / Double(p.month * 12)) * 100).rounded())
    }

    /// The biggest saving from paying yearly, across the paid plans.
    static var bestYearlySaving: Int { prices.keys.map(yearlySavingPercent).max() ?? 0 }

    /// The catalog id for a tier and interval ("personal_pro_yearly"; Free has no interval).
    static func personalPlanId(_ tier: String, yearly: Bool) -> String {
        tier == "free" ? "personal_free" : "personal_\(tier)_\(yearly ? "yearly" : "monthly")"
    }

    /// "1 GB", "1.5 GB", "20 GB", "340 MB": no trailing ".0" (the web's formatBytes).
    static func formatBytes(_ bytes: Double) -> String {
        func fixed(_ n: Double, _ small: Bool) -> String {
            let s = String(format: small ? "%.1f" : "%.0f", n)
            return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
        }
        let mb = 1024.0 * 1024, gb = mb * 1024
        if bytes < mb { return "\(max(0, Int((bytes / 1024).rounded()))) KB" }
        if bytes < gb { return "\(fixed(bytes / mb, bytes < 10 * mb)) MB" }
        return "\(fixed(bytes / gb, bytes < 10 * gb)) GB"
    }

    /// The label on a plan card's button, for someone on `paidPlan` (trialing or not) choosing `tier`.
    static func actionLabel(tier: String, yearly: Bool, paid: Bool, paidPlan: String, trialing: Bool) -> String {
        let name = PlanTier.name(tier)
        let sameTier = tier == "free" ? !paid : paid && paidPlan == tier
        if sameTier { return yearly ? String(localized: "Switch to yearly") : String(localized: "Switch to monthly") }
        if trialing { return String(localized: "Choose \(name)") }
        let rank = { (t: String) in order.firstIndex(of: t) ?? 0 }
        if !paid || rank(tier) > rank(paidPlan) { return String(localized: "Upgrade to \(name)") }
        return String(localized: "Change to \(name)")
    }
}

// MARK: - Billing (billing:mine, billing:creditAccounts)

/// billing:mine's AI credits in Personal.
struct PersonalCredits: Decodable, Sendable, Equatable {
    var allowance: Double
    var monthlyLeft: Double
    var packCredits: Double
    var available: Double
    var resetsAt: Double
    var nextPackExpiry: Double?
    var trialing: Bool
    var canBuy: Bool
    var aiIncluded: Bool

    enum CodingKeys: String, CodingKey { case allowance, monthlyLeft, packCredits, available, resetsAt, nextPackExpiry, trialing, canBuy, aiIncluded }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        allowance = try c.decodeIfPresent(Double.self, forKey: .allowance) ?? 0
        monthlyLeft = try c.decodeIfPresent(Double.self, forKey: .monthlyLeft) ?? 0
        packCredits = try c.decodeIfPresent(Double.self, forKey: .packCredits) ?? 0
        available = try c.decodeIfPresent(Double.self, forKey: .available) ?? 0
        resetsAt = try c.decodeIfPresent(Double.self, forKey: .resetsAt) ?? 0
        nextPackExpiry = try c.decodeIfPresent(Double.self, forKey: .nextPackExpiry)
        trialing = try c.decodeIfPresent(Bool.self, forKey: .trialing) ?? false
        canBuy = try c.decodeIfPresent(Bool.self, forKey: .canBuy) ?? false
        aiIncluded = try c.decodeIfPresent(Bool.self, forKey: .aiIncluded) ?? true
    }
}

/// One payment in Plan & billing's history.
struct BillingPayment: Decodable, Sendable, Identifiable, Equatable {
    var id: String
    var amountCents: Double
    var currency: String
    /// A tier, or "credits" for a credit pack.
    var plan: String
    var interval: String?
    var credits: Double?
    var status: String
    var createdAt: Double
}

/// billing:creditAccounts: every place the person has AI credits (Personal, and their seat in each paid workspace).
struct CreditAccountsResponse: Decodable, Sendable {
    struct Account: Decodable, Sendable, Identifiable, Equatable {
        var kind: String
        var workspaceId: String?
        var name: String
        var plan: String
        var aiIncluded: Bool
        var canBuy: Bool
        var trialing: Bool
        var allowance: Double
        var monthlyLeft: Double
        var packCredits: Double
        var available: Double
        var resetsAt: Double
        var nextPackExpiry: Double?
        var id: String { workspaceId ?? "personal" }

        enum CodingKeys: String, CodingKey {
            case kind, workspaceId, name, plan, aiIncluded, canBuy, trialing, allowance, monthlyLeft, packCredits, available, resetsAt, nextPackExpiry
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "personal"
            workspaceId = try c.decodeIfPresent(String.self, forKey: .workspaceId)
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
            plan = try c.decodeIfPresent(String.self, forKey: .plan) ?? ""
            aiIncluded = try c.decodeIfPresent(Bool.self, forKey: .aiIncluded) ?? true
            canBuy = try c.decodeIfPresent(Bool.self, forKey: .canBuy) ?? false
            trialing = try c.decodeIfPresent(Bool.self, forKey: .trialing) ?? false
            allowance = try c.decodeIfPresent(Double.self, forKey: .allowance) ?? 0
            monthlyLeft = try c.decodeIfPresent(Double.self, forKey: .monthlyLeft) ?? 0
            packCredits = try c.decodeIfPresent(Double.self, forKey: .packCredits) ?? 0
            available = try c.decodeIfPresent(Double.self, forKey: .available) ?? 0
            resetsAt = try c.decodeIfPresent(Double.self, forKey: .resetsAt) ?? 0
            nextPackExpiry = try c.decodeIfPresent(Double.self, forKey: .nextPackExpiry)
        }
    }
    var accounts: [Account]
    /// Whether credit packs can be bought through Polar Checkout, or (development) as test packs.
    var checkoutAvailable: Bool?
    var testPurchases: Bool?
}
