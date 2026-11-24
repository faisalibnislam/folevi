// When a place's runner wakes and goes (App/BackgroundSync.swift's BackgroundPlan): the rules, apart from the pages.
import XCTest
@testable import Folevi

final class BackgroundSyncTests: XCTestCase {
    private let plan = BackgroundPlan(interval: 600, minAwake: 15, maxAwake: 120, maxAwakeWaiting: 600, regularAtOnce: 1)
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    func testAPageStaysItsMinimumThenGoesOnceNothingWaits() {
        let a = BackgroundPlan.Awake(since: t0, waiting: 0, holdUntil: nil)
        XCTAssertEqual(plan.verdict(a, now: t0.addingTimeInterval(5)), .keep)
        XCTAssertEqual(plan.verdict(a, now: t0.addingTimeInterval(15)), .release)
    }

    func testAPageThatSaidNothingGoesAtTheMaximum() {
        let a = BackgroundPlan.Awake(since: t0, waiting: nil, holdUntil: nil)
        XCTAssertEqual(plan.verdict(a, now: t0.addingTimeInterval(60)), .keep)
        XCTAssertEqual(plan.verdict(a, now: t0.addingTimeInterval(120)), .release)
    }

    func testWorkStillWaitingKeepsThePageLonger() {
        let a = BackgroundPlan.Awake(since: t0, waiting: 3, holdUntil: nil)
        XCTAssertEqual(plan.verdict(a, now: t0.addingTimeInterval(300)), .keep)
        XCTAssertEqual(plan.verdict(a, now: t0.addingTimeInterval(600)), .release)
    }

    func testAHoldKeepsThePage() {
        let a = BackgroundPlan.Awake(since: t0, waiting: 0, holdUntil: t0.addingTimeInterval(40))
        XCTAssertEqual(plan.verdict(a, now: t0.addingTimeInterval(30)), .keep)
        XCTAssertEqual(plan.verdict(a, now: t0.addingTimeInterval(41)), .release)
    }

    func testCatchUpIsOnePlaceAtATimeOldestFirst() {
        let last = ["library": t0.addingTimeInterval(-700), "acct:b": t0.addingTimeInterval(-900), "acct:c": t0.addingTimeInterval(-100)]
        XCTAssertEqual(plan.due(wanted: ["acct:b", "acct:c", "library"], lastSync: last, awake: [], now: t0), ["acct:b"])
        // Nothing more while one is up.
        XCTAssertEqual(plan.due(wanted: ["acct:b", "acct:c", "library"], lastSync: last, awake: ["acct:b"], now: t0), [])
        // A place never synced is due at once.
        XCTAssertEqual(plan.due(wanted: ["acct:new"], lastSync: [:], awake: [], now: t0), ["acct:new"])
    }

    func testOnlyAHigherCountIsNew() {
        XCTAssertFalse(BackgroundPlan.isNew(previous: nil, now: 4))
        XCTAssertFalse(BackgroundPlan.isNew(previous: 4, now: 4))
        XCTAssertFalse(BackgroundPlan.isNew(previous: 4, now: 2))
        XCTAssertTrue(BackgroundPlan.isNew(previous: 2, now: 3))
    }

    func testTokenExpiry() {
        let payload = Data(#"{"exp":1800000600}"#.utf8).base64EncodedString().replacingOccurrences(of: "=", with: "")
        XCTAssertEqual(BackgroundSync.expiry("h.\(payload).s"), Date(timeIntervalSince1970: 1_800_000_600))
        XCTAssertNil(BackgroundSync.expiry("nope"))
    }
}
