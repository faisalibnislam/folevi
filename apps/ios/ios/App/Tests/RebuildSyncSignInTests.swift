// The native sync sheet's words (RebuildSync: the web's SyncStatusTouch.tsx) and the native "Your own server"
// sheet's QR code reading (RebuildOwnServer: the web's addressFromCode).
import XCTest
@testable import App

@MainActor
final class RebuildSyncSignInTests: XCTestCase {
    func testAgeReadsAsTheWebsAgeText() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(RebuildSync.age(now.addingTimeInterval(-10), now: now), "Just now")
        XCTAssertEqual(RebuildSync.age(now.addingTimeInterval(-60), now: now), "1 min ago")
        XCTAssertEqual(RebuildSync.age(now.addingTimeInterval(-5 * 60), now: now), "5 mins ago")
        XCTAssertEqual(RebuildSync.age(now.addingTimeInterval(-3600), now: now), "1 hour ago")
        XCTAssertEqual(RebuildSync.age(now.addingTimeInterval(-3 * 3600), now: now), "3 hours ago")
        XCTAssertEqual(RebuildSync.age(now.addingTimeInterval(-2 * 86400), now: now), "2 days ago")
    }

    func testTitlesAreTheWebAndMacButtonsWords() {
        XCTAssertEqual(RebuildSync.title(.saved), "Saved")
        XCTAssertEqual(RebuildSync.title(.syncing), "Syncing\u{2026}")
        XCTAssertEqual(RebuildSync.title(.offline), "Offline")
        XCTAssertEqual(RebuildSync.title(.conflict), "Conflict")
        XCTAssertEqual(RebuildSync.title(.error), "Not saved")
    }

    func testAQRCodesLinkGivesItsOrigin() {
        XCTAssertEqual(RebuildOwnServerSheet.address(fromCode: " https://notes.example.com/join/abc?x=1 "), "https://notes.example.com")
        XCTAssertEqual(RebuildOwnServerSheet.address(fromCode: "http://192.168.1.20:8460/signin"), "http://192.168.1.20:8460")
        XCTAssertEqual(RebuildOwnServerSheet.address(fromCode: "notes.example.com"), "notes.example.com")
    }
}
