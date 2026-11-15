import XCTest

/// Run only on a disposable simulator seeded in local mode (see CROSS_PLATFORM_AUDIT_2026-11-15.md).
final class CaptureAuditUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["FOLEVI_AUDIT_LOCAL"] == "1", "Requires the disposable audit library")
        continueAfterFailure = false
        app.launchEnvironment["FOLEVI_REBUILD"] = "1"
        app.launchEnvironment["FOLEVI_REBUILD_OPEN"] = "/"
        app.launch()
        XCTAssertTrue(app.buttons["Create"].firstMatch.waitForExistence(timeout: 45))
    }

    func testCreateMenuOpensFolderAndCapture() {
        app.buttons["Create"].firstMatch.tap()
        let folder = app.buttons["New folder"].firstMatch
        XCTAssertTrue(folder.waitForExistence(timeout: 5))
        folder.tap()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 5))
        app.buttons["Close"].firstMatch.tap()
        app.buttons["Create"].firstMatch.tap()
        app.buttons["Quick task"].firstMatch.tap()
        let field = app.textFields["Task"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Audit capture from the menu")
        app.buttons["Add task"].firstMatch.tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 15), "Saving closes capture only after success")
        app.buttons["Tasks"].firstMatch.tap()
        let quick = app.buttons["Quick task"].firstMatch
        XCTAssertTrue(quick.waitForExistence(timeout: 5))
        quick.tap()
        XCTAssertTrue(app.textFields["Task"].firstMatch.waitForExistence(timeout: 5))
    }

    func testNoteReturnsAfterSwitchingTabs() {
        app.buttons["Create"].firstMatch.tap()
        let newNote = app.buttons["New note"].firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 5))
        let hittable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: newNote)
        XCTAssertEqual(XCTWaiter.wait(for: [hittable], timeout: 5), .completed)
        newNote.tap()
        let body = app.descendants(matching: .any).matching(identifier: "Document body").firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 20), app.debugDescription)
        // XCUIApplication.open relaunches the app. Send an OS deep link to preserve the live tab stacks.
        XCUIDevice.shared.system.open(URL(string: "folevi://tasks")!)
        let open = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if open.waitForExistence(timeout: 3) { open.tap() }
        XCTAssertTrue(app.buttons["Quick task"].firstMatch.waitForExistence(timeout: 10))
        let home = app.buttons["Home"].firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        home.tap()
        XCTAssertTrue(body.waitForExistence(timeout: 15), "Returning to a retained tab restores its editor. \(app.debugDescription)")
    }
}

final class IPadCaptureAuditUITests: XCTestCase {
    func testQuickAddDeepLink() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["FOLEVI_AUDIT_LOCAL"] == "1", "Requires the disposable audit library")
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["FOLEVI_REBUILD"] = "1"
        app.launchEnvironment["FOLEVI_REBUILD_OPEN"] = "/"
        app.launch()
        app.open(URL(string: "folevi://quick-add")!)
        let field = app.textFields["Task"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 45), app.debugDescription)
        field.tap()
        field.typeText("Audit iPad capture")
        app.buttons["Add task"].firstMatch.tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 15))
    }
}
