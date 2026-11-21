// Folevi Core's unit tests: routing (Folevi's paths), window history, the Quick Add shortcut, desktop settings,
// card mapping, Core's own data names, and the screens' live values against the scripted demo engine.
import FoleviDesign
import FoleviEngine
import FoleviEngineDemo
import Foundation
import Testing
@testable import FoleviCore

struct DestinationTests {
    @Test(arguments: [
        "/documents", "/search", "/notes", "/d/01M7Z5KSV1H3KAXB1272J3SNED", "/ai", "/ai/abc123", "/inbox", "/notifications",
        "/tasks/today", "/tasks/upcoming", "/calendar", "/calendar/2026-11", "/daily/2026-11-21", "/shared", "/shared/F1",
        "/vault", "/review", "/graph", "/changes", "/templates", "/starred", "/archive", "/trash", "/unsorted",
        "/folders", "/folders/F2", "/tags", "/tags/T1", "/invite/tok", "/share-invite/tok", "/share-invite/folder/tok",
    ])
    func pathsRoundTrip(_ path: String) throws {
        let d = try #require(Destination(path: path))
        #expect(Destination(path: d.path) == d)
    }

    @Test func searchQueryIsKept() {
        #expect(Destination(path: "/documents?q=garden%20plan") == .search("garden plan"))
    }

    @Test func unknownTaskViewIsToday() {
        #expect(Destination(path: "/tasks/whatever") == .tasks(.today))
    }

    @Test func settingsAndEnginePagesAreNotWindowPlaces() {
        #expect(Destination(path: "/settings/ai") == nil)
        #expect(Destination.settingsSection(path: "/settings/ai") == "ai")
        #expect(Destination.settingsSection(path: "/settings") == "account")
        #expect(Destination(path: "/native") == nil)
        #expect(Destination(path: "/place-sync") == nil)
    }

    @Test func noteIdsAreChecked() {
        #expect(Destination(path: "/d/") == nil)
        #expect(Destination(path: "/d/bad id!") == nil)
    }

    @Test func drafts() {
        #expect(Destination(path: "/drafts") == .drafts)
        #expect(Destination.drafts.path == "/unsorted")
    }
}

struct ShortcutTests {
    @Test func validShortcutsNeedAModifierBesidesShift() {
        #expect(HotKey.isValidShortcut("Alt+Space"))
        #expect(HotKey.isValidShortcut("Command+Shift+K"))
        #expect(HotKey.isValidShortcut(""))
        #expect(!HotKey.isValidShortcut("K"))
        #expect(!HotKey.isValidShortcut("Shift+K"))
        #expect(!HotKey.isValidShortcut("Alt+Alt+K"))
        #expect(!HotKey.isValidShortcut("Hyper+K"))
    }

    @Test func carbonCodes() throws {
        let (code, mods) = try #require(HotKey.carbon("Alt+Space"))
        #expect(code == 49)
        #expect(mods != 0)
        #expect(HotKey.carbon("Alt+Nope") == nil)
    }

    @Test func display() {
        #expect(HotKey.display("Alt+Space") == "⌥Space")
        #expect(HotKey.display("Command+Shift+K") == "⌘⇧K")
    }
}

struct SettingsModelTests {
    @Test func cleanKeepsKnownKeysOfTheRightType() {
        let base = DesktopSettings()
        let out = DesktopSettings.clean(["quickAddShortcut": "K", "menuBarIcon": false, "spotlight": "yes", "other": 1], base: base)
        #expect(out.quickAddShortcut == base.quickAddShortcut)
        #expect(out.menuBarIcon == false)
        #expect(out.spotlight == base.spotlight)
    }

    @Test func settingsSectionsFromPaths() {
        #expect(SettingsSection(path: "ai") == .ai)
        #expect(SettingsSection(path: "members") == .workspace)
        #expect(SettingsSection(path: "nope") == nil)
    }
}

struct PathsAndCardsTests {
    @Test func keychainNamesAreCoresOwn() {
        #expect(Paths.keychainService("com.folevi.e2ee").hasPrefix("app.folevicore."))
        #expect(!Paths.keychainService("com.folevi.e2ee").hasPrefix("com.folevi."))
        #expect(Paths.keychainService("library-key").hasPrefix("app.folevicore."))
    }

    @Test func coreNeverUsesTodaysFolders() {
        #expect(!Paths.supportFolder.path.hasSuffix("/Folevi"))
        #expect(!Paths.documentsFolder.path.hasSuffix("Folevi Library"))
        #expect(Paths.urlScheme.hasPrefix("folevi-core"))
    }

    @Test func covers() {
        #expect(Cards.cover(CardCover(kind: "image", value: "f1")) == .file("f1"))
        #expect(Cards.cover(CardCover(kind: "image", value: "f1"), images: false) == .plain)
        #expect(Cards.cover(CardCover(kind: "nope", value: nil)) == .plain)
    }

    @Test func dayKeysAreLocal() {
        var c = DateComponents()
        c.year = 2026; c.month = 11; c.day = 21; c.hour = 23; c.minute = 30
        let late = Calendar.current.date(from: c)!
        #expect(late.formatted(CoreDates.dayFormat) == "2026-11-21")
    }
}

@MainActor
struct WindowHistoryTests {
    @Test func backAndForward() {
        let w = WindowModel(app: .shared, start: .home)
        w.start()
        w.go(.allNotes)
        w.go(.starred)
        #expect(w.current == .starred)
        #expect(w.canGoBack)
        w.back()
        #expect(w.current == .allNotes)
        #expect(w.canGoForward)
        w.forward()
        #expect(w.current == .starred)
        w.go(.trash)
        #expect(!w.canGoForward)
        w.closed()
    }

    @Test func replaceKeepsHistory() {
        let w = WindowModel(app: .shared, start: .home)
        w.start()
        w.go(.foliAI(nil))
        w.replace(with: .foliAI("c1"))
        #expect(w.current == .foliAI("c1"))
        w.back()
        #expect(w.current == .home)
        w.closed()
    }

    @Test func sidebarFollowsPlacesButNotNotes() {
        let w = WindowModel(app: .shared, start: .home)
        w.start()
        w.select(.allNotes)
        #expect(w.sidebarSelection == .allNotes)
        w.reset()
        #expect(w.current == .home)
        #expect(!w.canGoBack)
        w.closed()
    }
}

@MainActor
struct DemoEngineTests {
    @Test func liveValuesFillFromTheEngine() async throws {
        let demo = DemoEngine()
        let client = demo.client()
        client.start()
        let home = Live<Views.Home>()
        home.bind(client, Views.Home(SpaceArgs()))
        for _ in 0..<50 where home.value == nil { try await Task.sleep(for: .milliseconds(20)) }
        let value = try #require(home.value)
        #expect(!value.recents.isEmpty)

        let tree = Live<Views.FoldersTree>()
        tree.bind(client, Views.FoldersTree(SpaceArgs()))
        for _ in 0..<100 where (tree.value?.folders ?? []).isEmpty { try await Task.sleep(for: .milliseconds(20)) }
        let folders = tree.value?.folders.count ?? 0
        #expect(folders > 0)
    }

    @Test func bindingTwiceKeepsOneSubscription() async throws {
        let demo = DemoEngine()
        let client = demo.client()
        client.start()
        let live = Live<Views.Session>()
        live.bind(client, Views.Session())
        live.bind(client, Views.Session())
        try await Task.sleep(for: .milliseconds(50))
        #expect(client.subscriptionCount == 1)
        live.cancel()
    }

    @Test func commandsReachTheEngine() async throws {
        let demo = DemoEngine()
        let client = demo.client()
        client.start()
        let r = try await client.command(Commands.NoteCreate(NoteCreateArgs(title: "From a test")))
        #expect(!r.id.isEmpty)
        #expect(demo.commandLog.contains("note.create"))
    }
}

@MainActor
struct SpotlightAndLinksTests {
    @Test func spotlightIdentifiersCarryPlaceAndNote() throws {
        let hit = try #require(Spotlight.parse("acct:u1|01M7Z5KSV1H3KAXB1272J3SNED"))
        #expect(hit.place == "acct:u1")
        #expect(hit.note == "01M7Z5KSV1H3KAXB1272J3SNED")
        #expect(Spotlight.parse("nonote") == nil)
        #expect(Spotlight.parse("library|") == nil)
    }

    @Test func everyPlaceHasATitleAndAnIcon() {
        let all: [Destination] = [.home, .search(""), .foliAI(nil), .inbox, .notifications, .tasks(.today), .calendar(nil), .daily(nil), .allNotes, .recent, .starred, .shared, .drafts, .changes, .templates, .folders, .tags, .archive, .trash, .vault, .reviews, .graph]
        for d in all {
            #expect(!d.title.isEmpty)
            #expect(!d.symbol.isEmpty)
        }
        #expect(Destination.graph.title == "Foli DNA")
    }
}

@MainActor
struct PoolTests {
    @Test func aWindowKeepsItsPageAndGivesItBack() {
        // Without a started engine page the pool lends nothing (launch hasn't finished): no crash, no page.
        let pool = PagePool()
        let w = UUID()
        #expect(pool.editor(for: w) == nil)
        pool.giveBack(from: w)
        #expect(pool.page(of: w) == nil)
    }
}

@MainActor
@Suite("Foli AI answers")
struct AnswerPartsTests {
    @Test func splitsCodeBlocksFromProse() {
        let parts = AnswerText.parts("Here it is:\n```swift\nlet a = 1\n```\nDone.")
        #expect(parts == [.prose("Here it is:"), .code("swift", "let a = 1"), .prose("Done.")])
    }

    @Test func keepsAnUnclosedBlockWhileItStreams() {
        #expect(AnswerText.parts("```\nprint(1)") == [.code("", "print(1)")])
    }
}
