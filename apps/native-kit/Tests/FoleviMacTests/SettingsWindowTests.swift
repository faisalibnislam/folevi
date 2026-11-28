// The Mac's Settings window in the native look (docs/MAC_NATIVE_LOOK.md, 2026-11-18): its categories, its search
// (what finds what, Return, the arrows, no results), /settings links landing in the window, and the window's
// geometry (the title bar band the traffic lights and the page title share, the search field under it). With
// FOLEVI_SETTINGS_SHOTS=<folder> it also draws every category, light and dark, at the default and the narrowest
// width, and searches with and without results, from the real window (title bar and traffic lights included) on a
// scripted engine with made-up settings.
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
import FoleviScreens
@testable import FoleviMac

/// Records where Settings was asked to open.
@MainActor
private final class SettingsHost: FrameHost {
    var opened: [String?] = []
    func frameOpenSettings(section: String?) { opened.append(section) }
    func frameSwitchPlace(_ place: String, space: String?) {}
    func frameSignInAnotherAccount() {}
    func frameSignOut(place: String) {}
    func frameSignOutConfirmed(place: String) {}
    func frameDownloadFile(_ id: String) {}
    func frameMoveOrCopy() {}
    func frameOpenHelp() {}
    func frameOpenExternal(_ url: URL) {}
    func frameOpenInNewWindow(_ route: FrameRoute) {}
    func frameStateChanged() {}
}

/// The demo engine with Settings' views answered from made-up values (nobody's real settings).
@MainActor
final class SettingsFixtureEngine {
    let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
    let local: Bool
    private(set) lazy var transport = ScriptedTransport { m in try await self.respond(m) }

    init(local: Bool) { self.local = local }

    func client() -> EngineClient {
        EngineClient(transport: transport, place: demo.place, app: AppInfo(platform: .macos, version: "1.3.44", build: "test", protocol: EngineContract.protocolVersion, schemaHash: EngineContract.schemaHash))
    }

    private func respond(_ m: JSONValue) async throws -> JSONValue {
        let kind = m["kind"]?.string ?? ""
        let name = m["name"]?.string ?? ""
        let args = m["args"] ?? .object([:])
        switch kind {
        case "watch":
            let sub = m["sub"]?.string ?? ""
            let window = try? m["window"].map { try $0.decode(ListWindow.self) }
            let value = try value(name, args: args, window: window ?? nil)
            Task { @MainActor in
                self.transport.push(.array([.object(["kind": .string("update"), "sub": .string(sub), "rev": .number(1), name == "notes.list" ? "diff" : "value": value])]))
            }
            return .object(["sub": .string(sub)])
        case "query":
            let window = try? m["window"].map { try $0.decode(ListWindow.self) }
            return try value(name, args: args, window: window ?? nil)
        case "unwatch", "window":
            return .object(["ok": .bool(true)])
        case "command":
            return .object(["ok": .bool(true)])
        default:
            return try await demo.respond(m)
        }
    }

    private func value(_ name: String, args: JSONValue, window: ListWindow?) throws -> JSONValue {
        switch name {
        case "session":
            var s = demo.session
            if local { s.mode = .local }
            return try .from(s)
        case "settings.appearance": return Self.json(#"{"appearance":"system","editorZoom":1.1,"editorZooms":[0.85,0.9,0.95,1,1.05,1.1,1.15,1.2,1.25,1.3,1.35]}"#)
        case "settings.account": return Self.json(#"{"name":"Sam Rivera","email":"sam@example.com","avatarUrl":null,"timeZone":"Asia/Dhaka"}"#)
        case "settings.general": return Self.json(#"{"timeZone":"Asia/Dhaka","locale":"en","reviewAppEdits":true}"#)
        case "account.details":
            return Self.json(#"{"profile":{"id":"u_demo","name":"Sam Rivera","email":"sam@example.com","avatarUrl":null},"devicesActive":3,"deviceLimit":5,"spaces":[]}"#)
        case "settings.notifications":
            return Self.json(#"{"topics":[{"id":"mentions","label":"Mentions","hint":"Someone mentions you in a note or a comment.","inApp":true,"email":true},{"id":"comments","label":"Comments and replies","hint":"New comments on notes you follow.","inApp":true,"email":false},{"id":"reminders","label":"Reminders","hint":"A to-do with a reminder is due.","inApp":true,"email":false}],"digest":"daily","productEmail":false}"#)
        case "settings.ai":
            return Self.json(#"{"included":true,"enabled":true,"history":true,"memory":true,"suggestions":true,"attachments":false,"webResearch":true,"digests":false,"readImages":false,"deviceText":true}"#)
        case "settings.security":
            return Self.json(#"{"sessions":[{"id":"s1","label":"Folevi for Mac","client":"macOS 26","current":true,"lastSeenAt":1800000000000},{"id":"s2","label":"Safari","client":"iPhone","current":false,"lastSeenAt":1799990000000}],"twoFactor":true,"passkeys":[{"id":"p1","name":"MacBook Air Touch ID","createdAt":null,"lastUsedAt":null}],"methods":["password","google"]}"#)
        case "device.storage":
            return Self.json(#"{"place":null,"keepAll":false,"available":true,"spaces":[],"notesKept":412,"attachmentsKept":38,"attachmentsBytes":52000000,"usedBytes":81000000,"freeBytes":120000000000,"attachmentLimitBytes":null,"waiting":0}"#)
        case "settings.query":
            return .object(["data": settingsQuery(args)])
        default:
            return try demo.view(name, args: args, window: window)
        }
    }

    private func settingsQuery(_ args: JSONValue) -> JSONValue {
        switch args["key"]?.string {
        case "desktop":
            return Self.json(#"{"bridge":true,"loaded":true,"settings":{"quickAddShortcut":"Alt+Space","shortcutLabel":"⌥ Space","defaultShortcut":"Alt+Space","defaultLabel":"⌥ Space","error":null,"openAtLogin":true,"menuBarIcon":true,"notifications":false,"spotlight":true}}"#)
        case "library":
            return Self.json(#"""
            {"local":true,"place":{"kind":"iCloud Drive","path":"~/Library/Mobile Documents/Folevi","status":"Up to date","problem":null,"canSync":true,"canMove":true,"connection":null,"moveChoices":[{"kind":"icloud","title":"iCloud Drive","detail":"Syncs with your other Apple devices."}]},
             "devices":[{"id":"d1","phone":false,"name":"MacBook Air","here":"This Mac","detail":"macOS 26","when":"Just now"},{"id":"d2","phone":true,"name":"iPhone","here":null,"detail":"iOS 26","when":"Yesterday"}],
             "health":{"description":"Files Folevi couldn't read, or that are still on their way.","clean":false,"groups":[{"key":"conflicts","title":"Changed in two places","icon":"triangleAlert","why":"Both copies are kept; open each and keep the one you want.","count":1,"items":[{"path":"Notes/Trip.md","title":"Trip to Kyoto","since":"2 days ago","detail":null}],"more":null}]},
             "passphrase":{"encrypted":false,"description":"Encrypt the synced copy of your library so only your devices can read it.","min":12},
             "lock":{"on":true,"unavailable":false,"label":"Lock with Touch ID","description":"Folevi asks for Touch ID when it opens.","after":60,"afterLabel":"After 1 minute","choices":[{"value":0,"label":"Immediately"},{"value":60,"label":"After 1 minute"},{"value":300,"label":"After 5 minutes"}]},
             "ai":{"description":"Foli AI answers from your notes, on this Mac or with your own key.","keysWhere":". Keys stay on this Mac."},
             "forget":{"title":"Remove this library","description":"Folevi forgets this library on this Mac. The files stay where they are.","button":"Remove library…","dialogTitle":"Remove this library?","dialogDescription":"The files stay in their folder."}}
            """#)
        case "localAi":
            return Self.json(#"""
            {"hosted":true,"loaded":true,"on":true,"history":true,"onText":"Foli AI answers from your notes and helps you write. It runs on this Mac, or on your own key.","checking":"Checking…",
             "onDevice":{"title":"On this Mac","status":"ready","name":"Apple Intelligence","text":"Ready. Nothing leaves this Mac.","more":null},
             "keysDescription":"Use your own key for a larger model. Keys stay in this Mac's keychain.",
             "keys":[{"provider":"openai","label":"OpenAI","stored":true,"status":"Added","canTest":true,"canAdd":true,"keyUrl":"https://example.com/keys"},{"provider":"anthropic","label":"Anthropic","stored":false,"status":"Not added","canTest":false,"canAdd":true,"keyUrl":"https://example.com/keys"}],
             "model":{"missing":null,"description":"Which model answers.","providers":[{"value":"auto","label":"Automatic"},{"value":"openai","label":"OpenAI"}],"provider":"auto","modelLabel":"Model","models":[{"value":"gpt-5","label":"GPT-5"}],"model":"gpt-5","note":"Automatic picks the best model you have.","answering":"Answering with Apple Intelligence"},
             "historyText":"Keep your conversations so you can come back to them.","memory":true}
            """#)
        case "convex":
            switch args["args"]?["fn"]?.string {
            case "aiMemory.list": return Self.json(#"{"on":true,"items":[{"id":"m1","kind":"tone","text":"Friendly and direct"},{"id":"m2","kind":"language","text":"Use British spelling"}],"max":50}"#)
            case "billing.mine": return Self.json(#"{"storageUsedBytes":1200000000,"storageLimitBytes":100000000000,"payments":[{"id":"pay1","description":"Pro, monthly","at":1799000000000}]}"#)
            case "mcp.listGrants": return Self.json(#"[{"id":"g1","name":"Claude","canWrite":true,"connectedAt":1799000000000}]"#)
            case "apiTokens.list": return Self.json(#"[{"id":"t1","name":"Scripts","hint":"a1b2","lastUsedAt":1799500000000}]"#)
            case "webhooks.list": return Self.json(#"[{"id":"w1","url":"https://example.com/hooks/folevi","enabled":true}]"#)
            case "spelling.get": return Self.json(#"{"spellcheck":true,"predictions":null,"english":"en-GB","learnt":["Folevi","Macloving"],"ignored":["lorem"],"offNotes":[]}"#)
            default: return .null
            }
        default:
            return .null
        }
    }

    static func json(_ s: String) -> JSONValue { (try? JSONDecoder().decode(JSONValue.self, from: Data(s.utf8))) ?? .null }
}

@MainActor
@Suite("Settings window", .serialized)
struct SettingsWindowTests {
    static let out = ProcessInfo.processInfo.environment["FOLEVI_SETTINGS_SHOTS"].map { URL(fileURLWithPath: $0) }

    // MARK: categories and search

    @Test func categoriesListEveryPageWithGeneralFirst() async {
        let frame = FrameModel(client: SettingsFixtureEngine(local: false).client())
        defer { frame.stop() }
        await eventually("session") { frame.session.value != nil }
        let model = MacSettingsModel(frame: frame)
        let groups = MacSettingsCategories.groups(model)
        let ids = groups.flatMap(\.items).map(\.id)
        #expect(ids.first == "desktop")
        #expect(groups.first?.items.first?.title == "General")
        for s in ["account", "ai", "billing", "security", "privacy", "devices", "connected-apps", "appearance", "writing", "notifications", "sync", "data", "about"] {
            #expect(ids.contains(s), "\(s) is listed")
        }
        #expect(groups.last?.label == "Support")
        #expect(groups.last?.items.map(\.id) == [MacSettingsCategories.help, MacSettingsCategories.contact, "about"])
        #expect(!ids.contains("this-device"), "the Mac has no This device")
        // Every page can be found by search.
        let pages = groups.flatMap(\.items).filter { !$0.action }
        for c in pages {
            #expect(SettingsSearch.entries.contains { $0.section == c.id }, "\(c.id) has search entries")
        }
    }

    @Test func localLibraryCategories() async {
        let frame = FrameModel(client: SettingsFixtureEngine(local: true).client())
        defer { frame.stop() }
        await eventually("session") { frame.session.value?.mode == .local }
        let model = MacSettingsModel(frame: frame)
        let ids = MacSettingsCategories.groups(model).flatMap(\.items).map(\.id)
        #expect(Array(ids.prefix(6)) == ["desktop", "library", "ai", "appearance", "writing", "data"])
        #expect(!ids.contains("account"))
        #expect(MacSettingsCategories.resolve("account", model: model) == "library", "an account's section shows the library's")
    }

    @Test func searchFindsSettingsByWordsAndKeywords() {
        let cats: [(id: String, title: String)] = [("desktop", "General"), ("account", "Account"), ("ai", "Foli AI"), ("appearance", "Appearance"), ("security", "Security"), ("data", "Import & export")]
        // A keyword.
        let dark = SettingsSearch.results("dark mode", categories: cats, local: false)
        #expect(dark.first?.entry.section == "appearance")
        #expect(dark.first?.entry.anchor == SettingsAnchor.card("Theme"))
        // A label, any case.
        #expect(SettingsSearch.results("OPEN AT LOGIN", categories: cats, local: false).map(\.entry.anchor) == [SettingsAnchor.row("Open at login")])
        // A category's name lists the category (not each card in it).
        let appearance = SettingsSearch.results("appearance", categories: cats, local: false)
        #expect(appearance.count == 1)
        #expect(appearance.first?.entry.anchor == nil)
        // Most words must match (the web's rule): a stray word still finds the rest, two strays find nothing.
        #expect(SettingsSearch.results("two step", categories: cats, local: false).map(\.entry.label) == ["Two-step verification"])
        #expect(SettingsSearch.results("theme zzz", categories: cats, local: false).first?.entry.anchor == SettingsAnchor.card("Theme"))
        #expect(SettingsSearch.results("zzz qqq", categories: cats, local: false).isEmpty)
        // A question finds what its keywords do, filler words left out.
        #expect(SettingsSearch.results("how do I turn on dark mode", categories: cats, local: false).first?.entry.anchor == SettingsAnchor.card("Theme"))
        let mail = cats + [("notifications", "Notifications")]
        #expect(SettingsSearch.results("stop emails about comments", categories: mail, local: false).contains { $0.entry.label == "Email delivery" })
        // A library's Foli AI has keys; an account's doesn't.
        #expect(!SettingsSearch.results("api key", categories: cats, local: true).isEmpty)
        #expect(SettingsSearch.results("your own keys", categories: cats, local: false).isEmpty)
        // Spell check and prediction are under Writing.
        let writing = cats + [("writing", "Writing")]
        #expect(SettingsSearch.results("spell check", categories: writing, local: false).first?.entry.section == "writing")
        #expect(SettingsSearch.results("dictionary", categories: writing, local: true).first?.entry.section == "writing")
        #expect(SettingsSearch.results("next word", categories: writing, local: false).first?.entry.anchor == SettingsAnchor.card("Spelling and prediction"))
        // Nothing for nothing.
        #expect(SettingsSearch.results("   ", categories: cats, local: false).isEmpty)
        // Only the categories listed.
        #expect(SettingsSearch.results("members", categories: cats, local: false).isEmpty)
    }

    @Test func returnOpensTheFirstResultAndTheArrowsMove() {
        let state = MacSettingsState()
        state.groups = [MacSettingsGroup(label: nil, items: [
            MacSettingsCategory(id: "desktop", title: "General", symbol: "gearshape"),
            MacSettingsCategory(id: "appearance", title: "Appearance", symbol: "paintpalette"),
            MacSettingsCategory(id: "notifications", title: "Notifications", symbol: "bell"),
        ])]
        var opened: [String] = []
        state.onSelect = { opened.append($0) }
        state.selection = "desktop"
        state.query = "notifications"
        // The category its name matches first, then Mac notifications in General.
        let results = state.results
        #expect(results.map(\.entry.section) == ["notifications", "desktop"])
        state.moveActive(1)
        state.moveActive(-1)
        state.openActive()
        #expect(state.selection == "notifications")
        #expect(opened == ["notifications"])
        #expect(state.highlight == nil, "a category opens at its top")
        state.query = "dark"
        #expect(state.activeResult == 0, "a new search starts at the first result")
        state.openActive()
        #expect(state.selection == "appearance")
        #expect(state.highlight == SettingsAnchor.card("Theme"))
        #expect(state.scrollTarget == SettingsAnchor.card("Theme"))
        // The arrows in the list.
        state.moveSelection(1)
        #expect(state.selection == "notifications")
        state.moveSelection(-5)
        #expect(state.selection == "desktop")
    }

    @Test func groupsSplitYouIntoAccountSecurityAppAndData() async {
        let frame = FrameModel(client: SettingsFixtureEngine(local: false).client())
        defer { frame.stop() }
        await eventually("session") { frame.session.value != nil }
        let model = MacSettingsModel(frame: frame)
        let labels = model.groups.map(\.label)
        #expect(Array(labels.prefix(4)) == ["Account", "Security", "App", "Data"])
        #expect(!labels.contains("You"))
        #expect(model.groups.first { $0.label == "Account" }?.items == [.account, .billing, .devices])
        #expect(model.groups.first { $0.label == "Security" }?.items == [.security, .privacy])
        #expect(model.groups.first { $0.label == "App" }?.items == [.ai, .appearance, .writing, .notifications])
        #expect(model.groups.first { $0.label == "Data" }?.items == [.connectedApps, .sync, .data, .desktop])
        // The window: General alone at the top, the groups under their headings, then Support.
        let window = MacSettingsCategories.groups(model)
        #expect(window.first?.label == nil)
        #expect(window.first?.items.map(\.id) == ["desktop"])
        #expect(Array(window.dropFirst().prefix(4).map(\.label)) == ["Account", "Security", "App", "Data"])
        #expect(window.first { $0.label == "Data" }?.items.map(\.id).contains("desktop") == false)
        if model.canCreateWorkspace {
            #expect(window.first { $0.label == "Workspace" }?.items.map(\.id) == [MacSettingsCategories.createWorkspace])
        }
    }

    @Test func createWorkspaceRowOpensThePrompt() {
        let state = MacSettingsState()
        state.groups = [MacSettingsGroup(label: "Workspace", items: [MacSettingsCategory(id: MacSettingsCategories.createWorkspace, title: "Create a workspace", symbol: "plus", action: true)])]
        state.selection = "appearance"
        var created = 0
        var acted: [String] = []
        state.onCreateWorkspace = { created += 1 }
        state.onAction = { acted.append($0) }
        state.select(MacSettingsCategories.createWorkspace)
        #expect(created == 1)
        #expect(acted.isEmpty)
        #expect(state.selection == "appearance")
    }

    @Test func askFoliAIIsTheLastRowAndReturnAsksWhenNothingMatches() async {
        let state = MacSettingsState()
        state.groups = [MacSettingsGroup(label: "App", items: [
            MacSettingsCategory(id: "appearance", title: "Appearance", symbol: "paintpalette"),
            MacSettingsCategory(id: "notifications", title: "Notifications", symbol: "bell"),
        ])]
        state.selection = "appearance"
        var sent: [(String, [SettingsAskOption])] = []
        state.onAsk = { q, o in
            sent.append((q, o))
            return SettingsAskResult(keys: ["notifications/Email delivery", "nowhere/Made up"], answer: "Turn off comment emails under Email delivery.")
        }
        // Foli AI off: no row.
        state.query = "qqq zzz"
        #expect(state.askIndex == nil)
        state.aiOn = true
        // Nothing matches: Ask Foli AI is the only row, and Return asks.
        #expect(state.results.isEmpty)
        #expect(state.askIndex == 0)
        state.openActive()
        await eventually("answer") { !state.ask.busy && state.ask.shows(state.query) }
        #expect(sent.first?.0 == "qqq zzz")
        #expect(sent.first?.1.contains { $0.key == "appearance/Theme" && $0.section == "Appearance" } == true)
        #expect(state.ask.answer == "Turn off comment emails under Email delivery.")
        // Only offered keys come back, as results that open their card.
        #expect(state.askPicks.map(\.entry.label) == ["Email delivery"])
        #expect(state.askIndex == nil, "no Ask row while its answer shows")
        state.open(state.askPicks[0])
        #expect(state.selection == "notifications")
        #expect(state.highlight == SettingsAnchor.card("Email delivery"))
        // Matches: Ask Foli AI after them; the arrows reach it.
        state.query = "theme"
        #expect(state.askIndex == state.results.count)
        state.moveActive(5)
        #expect(state.activeResult == state.results.count)
    }

    @Test func askFoliAIErrorsAreSaidPlainly() async {
        let ask = SettingsAsk()
        await ask.ask("dark", options: []) { _, _ in throw EngineFailure.engine(EngineError(code: "ai_unavailable", message: "Foli AI isn't set up on this server yet.")) }
        #expect(ask.error == "Foli AI isn't set up on this server yet.")
        #expect(ask.shows("dark "))
        #expect(!ask.busy)
    }

    @Test func actionRowsActWithoutOpeningAPage() {
        let state = MacSettingsState()
        state.groups = [MacSettingsGroup(label: "Support", items: [MacSettingsCategory(id: "help", title: "Help", symbol: "questionmark.circle", action: true)])]
        state.selection = "appearance"
        var acted: [String] = []
        state.onAction = { acted.append($0) }
        state.select("help")
        #expect(acted == ["help"])
        #expect(state.selection == "appearance")
    }

    @Test func settingsLinksOpenTheWindow() async {
        let frame = FrameModel(client: DemoEngine().client())
        defer { frame.stop() }
        let host = SettingsHost()
        frame.host = host
        let tabs = frame.tabs.tabs.count
        frame.open(.web("/settings/members"))
        frame.open(.web("/settings"))
        frame.open(.web("/settings/ai?screen=ai-provider"))
        #expect(host.opened == ["members", nil, "ai"])
        #expect(frame.tabs.tabs.count == tabs, "no Settings tab in the main window")
    }

    @Test func destructiveConfirmationKeepsCancelTheDefault() {
        let alert = settingsConfirmAlert("Delete your account?", message: "Deleted after 7 days.", confirm: "Schedule deletion", destructive: true)
        #expect(alert.buttons.map(\.title) == ["Cancel", "Schedule deletion"])
        #expect(alert.buttons[1].hasDestructiveAction)
        let plain = settingsConfirmAlert("Sign out?", message: nil, confirm: "Sign out", destructive: false)
        #expect(plain.buttons.map(\.title) == ["Sign out", "Cancel"])
    }

    // MARK: the window

    /// The real window: its title bar band holds the traffic lights and the page title; the search field sits
    /// under it; the page's column and the title share their leading edge.
    @Test func windowGeometry() async throws {
        let (window, _, _, frame) = try await Self.makeWindow(local: false, section: "appearance", size: MacSettingsLook.defaultSize, scheme: .light)
        defer { window.orderOut(nil); frame.stop() }
        let band = window.frame.height - window.contentLayoutRect.height
        #expect(band >= 28, "the title bar band (\(band))")
        let close = try #require(window.standardWindowButton(.closeButton))
        let closeMid = close.convert(NSPoint(x: close.bounds.midX, y: close.bounds.midY), to: nil)
        // The traffic lights sit in the band, inside the category list.
        #expect(closeMid.x < MacSettingsLook.sidebarWidth)
        #expect(window.frame.height - closeMid.y < band)
        #expect(window.styleMask.contains(.resizable))
        #expect(window.contentMinSize.width >= MacSettingsLook.minSize.width && window.contentMinSize.height >= MacSettingsLook.minSize.height, "least size \(window.contentMinSize)")
        #expect(window.toolbar?.items.isEmpty == true, "no row of category icons")
    }

    // MARK: pictures

    static let accountPages = ["desktop", "account", "ai", "billing", "security", "privacy", "devices", "connected-apps", "appearance", "writing", "notifications", "sync", "data", "about"]
    static let libraryPages = ["desktop", "library", "ai", "appearance", "writing", "data"]
    static let narrow = CGSize(width: MacSettingsLook.minSize.width, height: 560)

    @Test func pictures() async throws {
        guard let out = Self.out else { return }
        _ = FoleviFonts.register()
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        for (local, pages) in [(false, Self.accountPages), (true, Self.libraryPages)] {
            for page in pages {
                for (sizeName, size) in [("default", MacSettingsLook.defaultSize), ("narrow", Self.narrow)] {
                    for scheme in [ColorScheme.light, .dark] {
                        let (window, _, _, frame) = try await Self.makeWindow(local: local, section: page, size: size, scheme: scheme)
                        Self.write(window, to: out.appendingPathComponent("\(local ? "library" : "account")-\(page)-\(sizeName)-\(scheme == .dark ? "dark" : "light").png"))
                        window.orderOut(nil)
                        frame.stop()
                    }
                }
            }
        }
        // Search: results (one picked and lit on its page), and none.
        for scheme in [ColorScheme.light, .dark] {
            let name = scheme == .dark ? "dark" : "light"
            var (window, state, view, frame) = try await Self.makeWindow(local: false, section: "desktop", size: MacSettingsLook.defaultSize, scheme: scheme)
            state.query = "notif"
            try await Self.settle(view, 4)
            Self.write(window, to: out.appendingPathComponent("search-results-\(name).png"))
            state.query = "email"
            state.moveActive(1)
            state.openActive()
            try await Self.settle(view, 8)
            Self.write(window, to: out.appendingPathComponent("search-picked-\(name).png"))
            state.query = "quantum"
            try await Self.settle(view, 3)
            Self.write(window, to: out.appendingPathComponent("search-none-\(name).png"))
            window.orderOut(nil)
            frame.stop()
            (window, state, view, frame) = try await Self.makeWindow(local: false, section: "desktop", size: Self.narrow, scheme: scheme)
            state.query = "dark"
            state.openActive()
            try await Self.settle(view, 8)
            Self.write(window, to: out.appendingPathComponent("search-picked-narrow-\(name).png"))
            // A card far down its page: the page scrolls to it.
            state.query = "delete account"
            state.openActive()
            try await Self.settle(view, 10)
            Self.write(window, to: out.appendingPathComponent("search-scrolled-narrow-\(name).png"))
            window.orderOut(nil)
            frame.stop()
            // A dialog's content as the Settings window's sheet shows it.
            let sheet = SettingsDialogView(title: "Encrypt with a passphrase", description: "Folevi rewrites every file in the library, encrypted. Keep Folevi open.", width: 512, close: {}) {
                VStack(alignment: .leading, spacing: 12) {
                    SettingsLabelled(label: "Passphrase") { SettingsField(placeholder: "", text: .constant("lantern orchard"), secure: true) }
                    SMuted("Use at least 12 characters.")
                    SCheckbox("I understand Folevi can't recover a lost passphrase", isOn: .constant(true))
                }
            } footer: {
                SButton("Cancel") {}
                SButton("Encrypt", variant: .primary) {}
            }
            .environment(\.settingsNative, true)
            .background(MacLook.Colors.window)
            .environment(\.colorScheme, scheme)
            let host = NSHostingView(rootView: sheet)
            host.frame = CGRect(origin: .zero, size: host.fittingSize)
            let w = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            w.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            w.contentView = host
            w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
            w.orderFrontRegardless()
            try await Self.settle(host, 3)
            if let image = DnaSnapshotTests.image(host, scale: 2), let data = DnaSnapshotTests.png(image) { try? data.write(to: out.appendingPathComponent("dialog-\(name).png")) }
            w.orderOut(nil)
        }
    }

    // MARK: helpers

    static func makeWindow(local: Bool, section: String, size: CGSize, scheme: ColorScheme) async throws -> (NSWindow, MacSettingsState, NSView, FrameModel) {
        let engine = SettingsFixtureEngine(local: local)
        let frame = FrameModel(client: engine.client())
        objc_setAssociatedObject(frame, &engineKey, engine, .OBJC_ASSOCIATION_RETAIN)
        await eventually("session", timeout: .seconds(5)) { frame.session.value != nil && (frame.session.value?.mode == .local) == local }
        let model = MacSettingsModel(frame: frame)
        let state = MacSettingsState()
        state.groups = MacSettingsCategories.groups(model)
        state.local = local
        state.selection = MacSettingsCategories.resolve(section, model: model)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        let host = NSHostingView(rootView: MacSettingsShell(state: state) { MacSettingsNativePane(model: model, state: state) }.environment(\.colorScheme, scheme))
        host.sizingOptions = [.minSize]
        window.contentView = host
        MacSettingsWindowStyle.apply(window)
        window.setContentSize(size)
        window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        window.orderFrontRegardless()
        try await settle(host, 8)
        return (window, state, host, frame)
    }

    static func settle(_ view: NSView, _ rounds: Int) async throws {
        for _ in 0..<rounds {
            view.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(120))
        }
    }

    /// The whole window, title bar and traffic lights included, at 2x.
    static func write(_ window: NSWindow, to url: URL) {
        guard let frameView = window.contentView?.superview, let image = DnaSnapshotTests.image(frameView, scale: 2), let data = DnaSnapshotTests.png(image) else { return }
        try? data.write(to: url)
    }
}

nonisolated(unsafe) private var engineKey: UInt8 = 0
#endif
