// The iPad's menu bar (Native/Rebuild/RebuildMenuBar.swift) driven by real hardware keyboard presses: its keys open
// what the Mac's do. Opt-in (TEST_RUNNER_FOLEVI_IPAD_MENU=1) on a disposable iPad Simulator seeded with a scratch
// local library (apps/ios/scripts/gates.mjs, "library-ready"); with FOLEVI_SHOTS set, screenshots go there.
import XCTest

final class IPadMenuBarUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["FOLEVI_IPAD_MENU"] == "1", "Needs a disposable iPad Simulator with a scratch library")
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "The menu bar is the iPad's")
        continueAfterFailure = false
        app.launchEnvironment["FOLEVI_REBUILD"] = "1"
        app.launchEnvironment["FOLEVI_REBUILD_OPEN"] = "/"
        app.launch()
        // (The desk is up once the sidebar's Home row is there.)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Home'")).firstMatch.waitForExistence(timeout: 60), app.debugDescription)
        sleep(3)
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

    private func label(_ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    func testMenuKeysOpenTheirScreens() {
        // ⌥⌘C: Calendar (new on the iPad).
        app.typeKey("c", modifierFlags: [.command, .option])
        sleep(3)
        shot("menu-1-calendar")
        XCTAssertTrue(label("Today").waitForExistence(timeout: 10), app.debugDescription)
        // ⌘T: New Tab (Home, with the palette).
        app.typeKey("t", modifierFlags: .command)
        sleep(2)
        shot("menu-2-new-tab")
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        // ⌘/: Keyboard Shortcuts (Help).
        app.typeKey("/", modifierFlags: .command)
        sleep(3)
        shot("menu-3-shortcuts")
        XCTAssertTrue(label("Keyboard shortcuts").waitForExistence(timeout: 10), app.debugDescription)
    }
}
