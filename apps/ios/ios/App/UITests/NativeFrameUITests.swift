// The native iPhone frame as someone uses it (docs/NATIVE_APP_PLAN.md N5, N6): launch to Home, a new note typed
// with the software keyboard and its toolbar, Done, Back, the note opened again from its card (the zoom), and the
// account sheet; plus the launch and open timings. Needs a Debug build on the Simulator signed in to a scratch
// account on the development deployment: scripts/native-smoke.mjs makes the account, signs the app in and runs
// these with the screenshots folder in TEST_RUNNER_FOLEVI_SHOTS.
import XCTest

final class NativeFrameUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["FOLEVI_SHOTS"] {
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    private func dump(_ name: String) {
        if let dir = ProcessInfo.processInfo.environment["FOLEVI_SHOTS"] {
            try? app.debugDescription.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).txt"), atomically: true, encoding: .utf8)
        }
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func waitHome(_ timeout: TimeInterval = 90) {
        let home = element("home-screen")
        if !home.waitForExistence(timeout: timeout) {
            dump("no-home")
            shot("no-home")
            XCTFail("Home didn't show")
        }
    }

    private func waitKeyboard(_ shown: Bool, timeout: TimeInterval = 8) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if (app.keyboards.count > 0) == shown { return true }
            usleep(200_000)
        }
        return false
    }

    private func back() {
        let bar = app.navigationBars.firstMatch
        let button = bar.buttons.element(boundBy: 0)
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
    }

    func testSmoke() throws {
        app.launch()
        waitHome()
        sleep(2)
        shot("01-home")
        XCTAssertTrue(element("tab-bar").exists, "the floating tab bar")
        XCTAssertTrue(element("root-avatar").exists, "the avatar")

        // A new note from "+", ready to type in.
        element("tab-new").tap()
        let newNote = app.buttons["New Note"].firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 5))
        shot("02-plus-menu")
        newNote.tap()
        XCTAssertTrue(element("note-screen").waitForExistence(timeout: 15), "the note screen")
        XCTAssertFalse(element("tab-bar").isHittable, "the tab bar steps away on a note")
        if !waitKeyboard(true, timeout: 10) {
            // The editor didn't take focus by itself: a tap in the page.
            app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
            XCTAssertTrue(waitKeyboard(true), "the software keyboard")
        }
        app.typeText("Native smoke note")
        app.typeText("\n")
        app.typeText("Typed with the software keyboard.")
        XCTAssertTrue(element("keyboard-toolbar").waitForExistence(timeout: 5), "the keyboard toolbar")
        XCTAssertTrue(element("note-done").waitForExistence(timeout: 5), "Done while writing")
        shot("03-writing")
        element("kb-bold").tap()
        app.typeText(" Bold")
        sleep(1)
        shot("04-bold")

        // Done puts the keyboard away; the bottom buttons come back.
        element("note-done").tap()
        XCTAssertTrue(waitKeyboard(false), "Done hides the keyboard")
        XCTAssertTrue(element("note-comments").waitForExistence(timeout: 5))
        shot("05-done")

        // Back to Home: the note is the first recent card.
        back()
        waitHome(10)
        sleep(2)
        shot("06-home-after")
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'note-card-' AND label CONTAINS 'Native smoke note'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 15), "the note's card on Home")
        card.tap()
        XCTAssertTrue(element("note-screen").waitForExistence(timeout: 10))
        sleep(1)
        shot("07-reopened")
        let typed = app.webViews.firstMatch.staticTexts.containing(NSPredicate(format: "label CONTAINS 'software keyboard'")).firstMatch
        XCTAssertTrue(typed.waitForExistence(timeout: 10), "what was typed is in the note")

        // The note's menu is a native UIMenu.
        element("note-more").tap()
        XCTAssertTrue(app.buttons["Version History"].waitForExistence(timeout: 5))
        shot("08-note-menu")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.6)).tap()
        sleep(1)
        back()
        waitHome(10)

        // The account sheet.
        element("root-avatar").tap()
        XCTAssertTrue(element("account-sheet").waitForExistence(timeout: 5), "the account sheet")
        sleep(1)
        shot("09-account-sheet")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sign out'")).firstMatch.exists, "the places menu's Sign out")
        element("account-sheet").swipeDown(velocity: .fast)
        sleep(1)

        // The sync sheet from the pill.
        element("root-sync").tap()
        XCTAssertTrue(element("sync-sheet").waitForExistence(timeout: 5), "the sync sheet")
        sleep(1)
        shot("10-sync-sheet")
        element("sheet-close").tap()

        // Tasks and Calendar tabs (FoleviScreens' screens).
        element("tab-tasks").tap()
        sleep(2)
        shot("12-tasks")
        element("tab-calendar").tap()
        sleep(2)
        shot("13-calendar")
        element("tab-home").tap()
        sleep(1)

        // Scrolled Home: the title collapses into the bar and never runs under the avatar or the pill.
        app.swipeUp()
        sleep(1)
        shot("11-home-scrolled")
    }

    func testLaunchPerformance() throws {
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: Self.options(5)) {
            app.launch()
        }
    }

    func testOpenNotePerformance() throws {
        app.launch()
        waitHome()
        sleep(3)
        let metric = XCTOSSignpostMetric(subsystem: "com.folevi.ios", category: "frame", name: "note.open")
        measure(metrics: [metric], options: Self.options(5)) {
            // The first recent card (a new account has its Welcome page).
            let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'note-card-'")).firstMatch
            XCTAssertTrue(card.waitForExistence(timeout: 15), "a note card on Home")
            card.tap()
            _ = element("note-screen").waitForExistence(timeout: 10)
            sleep(2)
            back()
            _ = element("home-screen").waitForExistence(timeout: 10)
            sleep(1)
        }
    }

    private static func options(_ n: Int) -> XCTMeasureOptions {
        let o = XCTMeasureOptions()
        o.iterationCount = n
        return o
    }
}
