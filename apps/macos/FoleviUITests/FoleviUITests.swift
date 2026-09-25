import Network
import XCTest

/// End-to-end UI tests against the local Convex backend.
///
/// Requirements (the tests skip with a clear message otherwise):
/// - the local backend at http://127.0.0.1:3210 is reachable;
/// - a development token is provided in `FOLEVI_UITEST_TOKEN` (xcodebuild: prefix with `TEST_RUNNER_`),
///   e.g. `TEST_RUNNER_FOLEVI_UITEST_TOKEN=$(node scripts/dev-token.mjs --email uitest@example.com)`.
final class FoleviUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard Self.backendReachable() else {
            throw XCTSkip("Local Convex backend (127.0.0.1:3210) isn't reachable; start `npx convex dev` to run UI tests.")
        }
        guard let token = ProcessInfo.processInfo.environment["FOLEVI_UITEST_TOKEN"], !token.isEmpty else {
            throw XCTSkip("Set TEST_RUNNER_FOLEVI_UITEST_TOKEN to a dev token (node scripts/dev-token.mjs) to run UI tests.")
        }
        app = XCUIApplication()
        app.launchArguments = ["-FoleviDevToken", token, "-FoleviUITestReset", "YES", "-FoleviAppearance", "light"]
    }

    override func tearDownWithError() throws {
        app?.terminate()
    }

    static func backendReachable() -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        let box = ReachBox()
        let connection = NWConnection(host: "127.0.0.1", port: 3210, using: .tcp)
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                box.ok = true
                semaphore.signal()
            case .failed, .cancelled:
                semaphore.signal()
            default:
                break
            }
        }
        connection.start(queue: .global())
        _ = semaphore.wait(timeout: .now() + 3)
        connection.cancel()
        return box.ok
    }

    final class ReachBox: @unchecked Sendable { var ok = false }

    // MARK: Helpers

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    /// Launches, finishes onboarding if this is a fresh test account, and waits for the library.
    private func launchToLibrary(extraArgs: [String] = []) {
        app.launchArguments += extraArgs
        app.launch()
        let library = element("sidebar.all")
        let onboarding = element("onboarding.workspace")
        let deadline = Date().addingTimeInterval(40)
        while Date() < deadline {
            if library.exists { return }
            if onboarding.exists {
                onboarding.click()
                onboarding.typeText("UI Test Folio")
                element("onboarding.continue").click()
                _ = element("onboarding.continue").waitForExistence(timeout: 5)
                element("onboarding.continue").click()
                _ = element("onboarding.continue").waitForExistence(timeout: 5)
                element("onboarding.continue").click()
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertTrue(library.waitForExistence(timeout: 5), "library sidebar should appear after sign-in")
    }

    private func newDocument(title: String) {
        app.typeKey("n", modifierFlags: .command)
        let titleField = element("documentTitle")
        XCTAssertTrue(titleField.waitForExistence(timeout: 10), "new document opens with a title field")
        Thread.sleep(forTimeInterval: 0.6)
        app.typeText(title)
        app.typeKey(.return, modifierFlags: [])
        Thread.sleep(forTimeInterval: 0.4)
    }

    // MARK: Tests

    func testSidebarNavigation() {
        launchToLibrary()
        element("sidebar.tasks").click()
        XCTAssertTrue(element("tasks.viewPicker").waitForExistence(timeout: 5))
        element("sidebar.calendar").click()
        XCTAssertTrue(app.buttons["Today"].waitForExistence(timeout: 5))
        element("sidebar.templates").click()
        XCTAssertTrue(element("browser.title").waitForExistence(timeout: 5))
        element("sidebar.all").click()
        XCTAssertTrue(element("browser.title").waitForExistence(timeout: 5))
    }

    func testCreateDocumentTypeAndMarkdownShortcuts() {
        launchToLibrary()
        newDocument(title: "UI Test Document")
        // "# " turns the block into a heading.
        app.typeText("# Plans")
        app.typeKey(.return, modifierFlags: [])
        let heading = app.textViews.matching(NSPredicate(format: "label == %@", "Heading 1")).firstMatch
        XCTAssertTrue(heading.waitForExistence(timeout: 5), "# + space makes a Heading 1")
        // "[] " turns the next block into a to-do with a checkbox.
        app.typeText("[] Buy stamps")
        let checkbox = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'todo.checkbox.'")).firstMatch
        XCTAssertTrue(checkbox.waitForExistence(timeout: 5), "[] + space makes a to-do")
        checkbox.click()
        XCTAssertEqual(checkbox.value as? String, "Done")
    }

    func testMoveBlockWithKeyboard() {
        launchToLibrary()
        newDocument(title: "Reorder Test")
        app.typeText("Alpha")
        app.typeKey(.return, modifierFlags: [])
        app.typeText("Beta")
        let alpha = app.textViews.matching(NSPredicate(format: "value == 'Alpha'")).firstMatch
        let beta = app.textViews.matching(NSPredicate(format: "value == 'Beta'")).firstMatch
        XCTAssertTrue(beta.waitForExistence(timeout: 5))
        XCTAssertLessThan(alpha.frame.minY, beta.frame.minY)
        app.typeKey(.upArrow, modifierFlags: [.option, .shift])
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertLessThan(beta.frame.minY, alpha.frame.minY, "⌥⇧↑ moves the block above its previous sibling")
        app.typeKey(.downArrow, modifierFlags: [.option, .shift])
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertLessThan(alpha.frame.minY, beta.frame.minY, "⌥⇧↓ moves it back")
    }

    func testDragBlockWithGrip() {
        launchToLibrary()
        newDocument(title: "Drag Test")
        app.typeText("Alpha")
        app.typeKey(.return, modifierFlags: [])
        app.typeText("Beta")
        app.typeKey(.return, modifierFlags: [])
        app.typeText("Gamma")
        let alpha = app.textViews.matching(NSPredicate(format: "value == 'Alpha'")).firstMatch
        let gamma = app.textViews.matching(NSPredicate(format: "value == 'Gamma'")).firstMatch
        XCTAssertTrue(gamma.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        // Hover Alpha's row so its gutter shows, then drag its grip below Gamma.
        alpha.hover()
        let handle = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Block handle'")).element(boundBy: 0)
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = gamma.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 1.2))
        start.press(forDuration: 0.2, thenDragTo: end, withVelocity: 300, thenHoldForDuration: 0.4)
        Thread.sleep(forTimeInterval: 1.0)
        XCTAssertLessThan(gamma.frame.minY, alpha.frame.minY, "dragging the grip moves Alpha below Gamma")
        // One undo step puts it back (Escape first, so ⌘Z isn't a typing undo in the focused block).
        app.typeKey(.escape, modifierFlags: [])
        app.typeKey("z", modifierFlags: .command)
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertLessThan(alpha.frame.minY, gamma.frame.minY, "⌘Z undoes the move in one step")
    }

    func testMenusExist() {
        launchToLibrary()
        let menuBar = app.menuBars
        for title in ["File", "Edit", "Format", "Block", "View", "Window", "Help"] {
            XCTAssertTrue(menuBar.menuBarItems[title].exists, "\(title) menu exists")
        }
        menuBar.menuBarItems["Format"].click()
        XCTAssertTrue(menuBar.menuItems["Bold"].waitForExistence(timeout: 3))
        XCTAssertTrue(menuBar.menuItems["Turn Into"].exists)
        app.typeKey(.escape, modifierFlags: [])
        menuBar.menuBarItems["Block"].click()
        XCTAssertTrue(menuBar.menuItems["Move Up"].waitForExistence(timeout: 3))
        app.typeKey(.escape, modifierFlags: [])
        menuBar.menuBarItems["File"].click()
        XCTAssertTrue(menuBar.menuItems["New Document"].exists)
        XCTAssertTrue(menuBar.menuItems["Import Markdown…"].exists)
        app.typeKey(.escape, modifierFlags: [])
    }

    func testAppearanceSwitch() {
        launchToLibrary()
        app.menuBars.menuBarItems["View"].click()
        app.menuBars.menuItems["Appearance"].hover()
        let dark = app.menuBars.menuItems["Dark"]
        XCTAssertTrue(dark.waitForExistence(timeout: 3))
        dark.click()
        Thread.sleep(forTimeInterval: 0.5)
        app.menuBars.menuBarItems["View"].click()
        app.menuBars.menuItems["Appearance"].hover()
        XCTAssertTrue(app.menuBars.menuItems["Dark"].waitForExistence(timeout: 3))
        app.menuBars.menuItems["System"].click()
    }

    func testOfflineBannerWhenForcedOffline() {
        launchToLibrary(extraArgs: ["-FoleviForceOffline", "YES"])
        XCTAssertTrue(element("offlineBanner").waitForExistence(timeout: 10), "offline banner is shown")
        XCTAssertEqual(element("syncStatusPill").value as? String, "Offline")
    }
}
