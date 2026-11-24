// Several places on the Mac (App/Places.swift, Electron's main.ts and places.ts): the list with the library's
// counts, what a page says of its own place (never another's), every call bound to the sender's place, the mode
// switch, signing out of an account that isn't open, Quick Add's place, the library's network rules; and the
// Touch ID lock's rules (Services/MacAppLock.swift, the cases of the Electron Mac app's lock.test.ts).
import WebKit
import XCTest
@testable import Folevi

final class PlacesTests: XCTestCase {
    private final class Sink: BridgeEvents {
        func emit(_ plugin: String, _ event: String, _ data: [String: Any]) {}
    }

    private let users = ["placesMacAna", "placesMacBen"]

    override func setUp() {
        ShellPlaces.resetForTests()
        Paths.defaults.removeObject(forKey: "folevi.places.libraryCounts")
    }

    override func tearDown() {
        for id in users {
            ShellAuth.shared.setToken(nil, for: id)
            E2eeKeys.forget(userId: id)
        }
        ShellPlaces.resetForTests()
        Paths.defaults.removeObject(forKey: "folevi.places.libraryCounts")
    }

    @MainActor
    private func call(_ method: String, _ options: [String: Any] = [:], place: String?) async throws -> [String: Any] {
        try await ShellRouter(place: { place }, window: { nil }, events: Sink()).handle(method, options)
    }

    @MainActor
    func testTheListAndWhatEachPageSaysOfItsOwnPlace() async throws {
        ShellPlaces.setLibrary(true)
        let ana = Places.shared.addAccount((userId: "placesMacAna", name: "Ana", email: "ana@example.com", avatarUrl: nil))!
        let ben = Places.shared.addAccount((userId: "placesMacBen", name: "Ben", email: "ben@example.com", avatarUrl: nil))!
        ShellPlaces.setCurrent(ana.id)
        // Ben's runner says Ben's counts; the library's page its own; neither can name another place.
        _ = try await call("placesDescribe", ["unread": 4, "name": "Benjamin"], place: ben.id)
        _ = try await call("placesDescribe", ["reminders": 2, "waiting": 1, "unread": 9], place: ShellPlaces.library)
        let list = try await call("placesList", place: ana.id)["places"] as! [[String: Any]]
        XCTAssertEqual(list.map { $0["id"] as? String }, ["library", ana.id, ben.id])
        let library = list[0]
        XCTAssertEqual(library["kind"] as? String, "library")
        XCTAssertEqual(library["reminders"] as? Int, 2)
        XCTAssertEqual(library["waiting"] as? Int, 1)
        XCTAssertEqual(library["unread"] as? Int, 0, "the library has no unread count")
        XCTAssertEqual(list[2]["unread"] as? Int, 4)
        XCTAssertEqual(list[2]["name"] as? String, "Benjamin")
        XCTAssertEqual(list[1]["unread"] as? Int, 0, "Ana's page said nothing")
        XCTAssertEqual(Set(list[1].keys), ["kind", "id", "userId", "profileId", "name", "email", "avatarUrl", "workspaces", "unread", "reminders", "waiting"])
    }

    @MainActor
    func testCallsUseTheSendersPlace() async throws {
        let ana = Places.shared.addAccount((userId: "placesMacAna", name: "Ana", email: "a@example.com", avatarUrl: nil))!
        let ben = Places.shared.addAccount((userId: "placesMacBen", name: "Ben", email: "b@example.com", avatarUrl: nil))!
        ShellAuth.shared.setToken("Anasessiontoken0123456789abcdefA", for: "placesMacAna")
        ShellAuth.shared.setToken("Bensessiontoken0123456789abcdefB", for: "placesMacBen")
        ShellPlaces.setCurrent(ana.id)
        XCTAssertEqual(ShellAuth.shared.token, "Anasessiontoken0123456789abcdefA")
        ShellPlaces.$acting.withValue(ben.id) {
            XCTAssertEqual(ShellAuth.shared.token, "Bensessiontoken0123456789abcdefB", "Ben's runner uses Ben's session")
            XCTAssertEqual(ShellPlaces.currentUserId, "placesMacBen")
        }
        ShellPlaces.$acting.withValue(ShellPlaces.library) { XCTAssertNil(ShellPlaces.currentUserId, "the library has no account") }
        // Through the router: Ben's page gets Ben's keys while Ana is open.
        let benKeys = try await call("e2eeDeviceKeys", place: ben.id)["deviceId"] as? String
        let anaKeys = try await call("e2eeDeviceKeys", place: ana.id)["deviceId"] as? String
        XCTAssertNotEqual(benKeys, anaKeys)
        let viaActing: String? = ShellPlaces.$acting.withValue(ben.id) { (try? E2eeKeys.shared.deviceKeys())?.deviceId }
        XCTAssertEqual(viaActing, benKeys)
        // Only a signed-in page asks for another account's token (here: no network, so none comes back).
        let got1 = try await call("placesConvexToken", ["id": ben.id], place: ShellPlaces.library)
        XCTAssertTrue(got1["value"] is NSNull)
    }

    @MainActor
    func testTheModeSwitchAndSigningOutOfAnotherAccount() async throws {
        _ = try await call("setMode", ["mode": "local"], place: nil)
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(ShellPlaces.state.current, ShellPlaces.library)
        XCTAssertTrue(ShellPlaces.state.library)
        XCTAssertEqual(ShellMode.current, "local")
        // From the library, "account" with no account yet: the sign-in screen.
        _ = try await call("setMode", ["mode": "account"], place: ShellPlaces.library)
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertNil(ShellPlaces.state.current)
        XCTAssertTrue(ShellPlaces.pendingAccount)
        XCTAssertEqual(ShellPlaces.modeOf(nil), "account")
        // Two accounts, Ana open; signing out of Ben leaves Ana open.
        let ana = Places.shared.addAccount((userId: "placesMacAna", name: "Ana", email: "a@example.com", avatarUrl: nil))!
        let ben = Places.shared.addAccount((userId: "placesMacBen", name: "Ben", email: "b@example.com", avatarUrl: nil))!
        _ = try await call("placesSwitch", ["id": ana.id, "path": "//evil"], place: nil)
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(ShellPlaces.state.current, ana.id)
        XCTAssertEqual(Places.safePath("//evil"), "/documents")
        XCTAssertEqual(Places.safePath("/tasks"), "/tasks")
        _ = try await call("e2eeDeviceKeys", place: ben.id)
        _ = try await call("placesSignOut", ["id": ben.id], place: ana.id)
        XCTAssertEqual(ShellPlaces.state.accounts.map(\.id), [ana.id])
        XCTAssertEqual(ShellPlaces.state.current, ana.id)
        XCTAssertNil(Keychain.get("com.folevi.e2ee", "device.placesMacBen"), "Ben's keys went with him")
        // Quick Add: the open place until one is picked there.
        let got2 = try await call("placesQuickAdd", place: ana.id)
        XCTAssertEqual(got2["value"] as? String, ana.id)
        _ = try await call("placesSetQuickAdd", ["id": ShellPlaces.library], place: ana.id)
        let got3 = try await call("placesQuickAdd", place: ana.id)
        XCTAssertEqual(got3["value"] as? String, ShellPlaces.library)
        _ = try await call("placesSetQuickAdd", ["id": "acct:nobody"], place: ana.id)
        XCTAssertEqual(Places.shared.quickAddPlace, ShellPlaces.library, "an unknown place changes nothing")
    }

    @MainActor
    func testTheLibrarysViewsCantReachFoleviOrConvex() async throws {
        let json = Places.localRulesJSON(serviceHost: "app.localhost")
        let rules = try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [[String: Any]]
        let filters = rules.map { (($0["trigger"] as! [String: Any])["url-filter"] as! String) }
        let matches = { (url: String) in filters.contains { url.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil } }
        for blocked in ["https://folevi.com/", "https://app.folevi.com/api/auth/x", "wss://peaceful-mockingbird-196.convex.cloud/api/sync", "https://x.convex.site/h", "http://app.localhost:3002/api"] {
            XCTAssertTrue(matches(blocked), blocked)
        }
        for allowed in ["https://api.openai.com/v1", "https://example.com/folevi.com", "https://notfolevi.com/", "app://folevi/documents", "https://www.googleapis.com/drive/v3"] {
            XCTAssertFalse(matches(allowed), allowed)
        }
        // WebKit takes the list as it is.
        let list = try await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "folevi-library-test", encodedContentRuleList: json)
        XCTAssertNotNil(list)
        try? await WKContentRuleListStore.default().removeContentRuleList(forIdentifier: "folevi-library-test")
    }

    // MARK: the lock (lock.test.ts)

    private final class Clock {
        var now = Date(timeIntervalSince1970: 1_000_000)
    }

    @MainActor
    private func lock(touchID: Bool = true, file: URL? = nil, allow: @escaping () -> Bool = { true }) -> (LockLogic, URL, () -> [String], Clock) {
        let f = file ?? FileManager.default.temporaryDirectory.appendingPathComponent("lock-\(UUID().uuidString)/lock.json")
        var log: [String] = []
        let clock = Clock()
        let logic = LockLogic(.init(file: f, canPrompt: { touchID }, prompt: { reason in
            log.append("prompt:\(reason)")
            return allow()
        }, show: { log.append("show") }, hide: { log.append("hide") }, now: { clock.now }))
        return (logic, f, { log }, clock)
    }

    @MainActor
    func testTheLockIsOffUntilTouchIDTurnsItOn() async throws {
        let (l, file, log, _) = lock()
        XCTAssertEqual(l.settings["lock"] as? Bool, false)
        XCTAssertEqual(l.settings["method"] as? String, "touchID")
        let s = try await l.setSettings(lock: true, lockAfter: 300)
        XCTAssertEqual(s["lock"] as? Bool, true)
        XCTAssertEqual(s["lockAfter"] as? Int, 300)
        XCTAssertEqual(log(), ["prompt:turn on the Touch ID lock"])
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        XCTAssertEqual(saved["lock"] as? Bool, true)
        XCTAssertEqual(saved["lockAfter"] as? Int, 300)
        // The next launch opens covered.
        let (again, _, againLog, _) = lock(file: file)
        XCTAssertTrue(again.locked)
        XCTAssertEqual(againLog(), ["show"])
    }

    @MainActor
    func testACancelledTouchIDChangesNothingAndAMacWithoutItCantTurnItOn() async throws {
        let (l, _, _, _) = lock(allow: { false })
        do {
            _ = try await l.setSettings(lock: true, lockAfter: nil)
            XCTFail("cancelled")
        } catch let e as LockError {
            XCTAssertEqual(e.code, "cancelled")
        }
        XCTAssertEqual(l.settings["lock"] as? Bool, false)
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("lock-\(UUID().uuidString)/lock.json")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"lock":true,"lockAfter":60}"#.utf8).write(to: file)
        let (none, _, log, _) = lock(touchID: false, file: file)
        XCTAssertFalse(none.locked, "an old setting doesn't shut anyone out")
        XCTAssertEqual(log(), [])
        XCTAssertEqual(none.settings["method"] as? String, "none")
        XCTAssertEqual(none.settings["lock"] as? Bool, false)
        do {
            _ = try await none.setSettings(lock: false, lockAfter: nil)
            XCTFail("no Touch ID")
        } catch let e as LockError {
            XCTAssertEqual(e.code, "unavailable")
        }
    }

    @MainActor
    func testItLocksAfterBeingAwayThenTouchIDUncovers() async throws {
        var allow = true
        let (l, _, log, clock) = lock(allow: { allow })
        _ = try await l.setSettings(lock: true, lockAfter: 60)
        l.away()
        clock.now += 30
        l.back()
        XCTAssertFalse(l.locked)
        l.away()
        clock.now += 61
        allow = false
        l.back()
        XCTAssertTrue(l.locked)
        let got4 = await l.unlock().value
        XCTAssertFalse(got4, "a failed Touch ID stays covered")
        XCTAssertTrue(l.locked)
        allow = true
        let got5 = await l.unlock().value
        XCTAssertTrue(got5)
        XCTAssertFalse(l.locked)
        XCTAssertEqual(log().filter { $0 == "show" }.count, 1)
        XCTAssertEqual(log().last, "hide")
        XCTAssertTrue(log().contains("prompt:unlock your notes"))
        // The Mac locking covers at once.
        l.lockNow()
        XCTAssertTrue(l.locked)
    }

    @MainActor
    func testOddValuesAreRefusedOrRoundedDown() async throws {
        let (l, _, _, _) = lock()
        let cases: [(Any?, Any?)] = [("yes", nil), (nil, -1), (nil, "soon")]
        for (lockValue, after) in cases {
            do {
                _ = try await l.setSettings(lock: lockValue, lockAfter: after)
                XCTFail("\(String(describing: lockValue)) \(String(describing: after))")
            } catch let e as LockError {
                XCTAssertEqual(e.code, "invalid_argument")
            }
        }
        let got6 = try await l.setSettings(lock: nil, lockAfter: 1000)
        XCTAssertEqual(got6["lockAfter"] as? Int, 900)
        let got7 = try await l.setSettings(lock: nil, lockAfter: 7200)
        XCTAssertEqual(got7["lockAfter"] as? Int, 3600)
        XCTAssertEqual(LockLogic.validAfter(true as NSNumber), nil, "a boolean isn't seconds")
    }
}
