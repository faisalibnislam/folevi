// The extensions as someone uses them, driven through the Simulator's own apps: Save to Folevi from
// Safari's share sheet, and Folevi's widgets on the Home Screen. Needs Folevi installed and signed in on the
// Simulator (a Debug build pointed at the dev server), so it has its own scheme and isn't part of `pnpm test`:
//
//   TEST_RUNNER_FOLEVI_SHOTS=/path/for/screenshots xcodebuild test -project ios/App/App.xcodeproj \
//     -scheme FoleviUITests -destination 'platform=iOS Simulator,name=Folevi iPhone 18 Pro'
//
// With FOLEVI_SHOTS set, each step's screenshot is written there as a PNG (and attached to the result).
import XCTest

final class ExtensionsUITests: XCTestCase {
    private let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUp() {
        continueAfterFailure = false
    }

    /// Saves a screenshot of the whole screen as `<name>.png` in FOLEVI_SHOTS, and attaches it.
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

    private func dump(_ app: XCUIApplication, _ name: String) {
        if let dir = ProcessInfo.processInfo.environment["FOLEVI_SHOTS"] {
            try? app.debugDescription.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).txt"), atomically: true, encoding: .utf8)
        }
    }

    func testSaveToFoleviFromSafari() throws {
        let page = ProcessInfo.processInfo.environment["FOLEVI_SHARE_URL"] ?? "https://example.com/"
        XCUIDevice.shared.system.open(URL(string: page)!)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))
        sleep(4)
        // Share is in the toolbar, or (iOS 26 and later) in the page menu.
        var share = safari.buttons["ShareButton"].firstMatch
        if !share.waitForExistence(timeout: 5) {
            let menu = safari.buttons["MoreMenuButton"].firstMatch
            XCTAssertTrue(menu.waitForExistence(timeout: 10))
            menu.tap()
            sleep(1)
            share = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Share' OR identifier == 'ShareButton'")).firstMatch
            if !share.waitForExistence(timeout: 5) {
                dump(safari, "safari-menu")
                shot("share-0-menu")
            }
        }
        share.tap()
        sleep(2)
        shot("share-1-sheet")
        var folevi = safari.collectionViews.cells.matching(NSPredicate(format: "label == 'Folevi'")).firstMatch
        if !folevi.waitForExistence(timeout: 5) {
            // Not in the first row: More lists every app that takes what's shared.
            let more = safari.collectionViews.cells.matching(NSPredicate(format: "label == 'More'")).firstMatch
            if more.exists { more.tap() }
            sleep(2)
            dump(safari, "share-sheet")
            folevi = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Folevi'")).firstMatch
        }
        XCTAssertTrue(folevi.waitForExistence(timeout: 10), "Folevi is in the share sheet")
        folevi.tap()
        let save = safari.buttons["Save"].firstMatch
        if !save.waitForExistence(timeout: 15) { dump(safari, "share-extension") }
        XCTAssertTrue(save.exists)
        sleep(2)
        shot("share-2-folevi")
        save.tap()
        // "Saved to your Inbox" (or "Saved, it will sync when Folevi opens") shows for a moment, then the
        // sheet closes by itself.
        let saved = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Saved'")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 15), "the sheet says it's saved")
        shot("share-3-saved")
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: save)
        waitForExpectations(timeout: 15)
        shot("share-4-closed")
    }

    /// Opens the widget gallery at Folevi's widgets (the Home Screen in edit mode, Edit, Add Widget, search).
    private func openFoleviGallery() {
        XCUIDevice.shared.press(.home)
        sleep(1)
        let edit = springboard.buttons.matching(NSPredicate(format: "label == 'Edit'")).firstMatch
        // A long press on an empty spot of the Home Screen (one with a widget or an app opens its menu instead).
        for dy in [0.62, 0.78, 0.45, 0.3] where !edit.exists {
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: dy)).press(forDuration: 1.6)
            if edit.waitForExistence(timeout: 2) { break }
            XCUIDevice.shared.press(.home)
            sleep(1)
        }
        if !edit.exists { dump(springboard, "home-edit") }
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        edit.tap()
        let add = springboard.descendants(matching: .any).matching(NSPredicate(format: "label == 'Add Widget'")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        let search = springboard.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText("Folevi")
        let folevi = springboard.cells.matching(NSPredicate(format: "label == 'Folevi'")).firstMatch
        XCTAssertTrue(folevi.waitForExistence(timeout: 10))
        folevi.tap()
        sleep(2)
    }

    /// The widget preview in the middle of the gallery (the one on show).
    private func centredPreview() -> XCUIElement? {
        let previews = springboard.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Folevi,'")).allElementsBoundByIndex
        let middle = springboard.frame.midX
        return previews.min { abs($0.frame.midX - middle) < abs($1.frame.midX - middle) }
    }

    /// Adds the gallery's widget on page `page` (0: Today small, 1: Today medium, 2: Today large, 3 to 5:
    /// Recent notes small to large, 6: Quick add).
    private func addWidget(page: Int, shotName: String) {
        openFoleviGallery()
        let preview = springboard.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Folevi,'")).firstMatch
        XCTAssertTrue(preview.waitForExistence(timeout: 10))
        for _ in 0 ..< page {
            centredPreview()?.swipeLeft()
            sleep(1)
        }
        sleep(1)
        shot(shotName)
        springboard.buttons.matching(NSPredicate(format: "label CONTAINS 'Add Widget'")).firstMatch.tap()
        sleep(2)
    }

    /// Takes Folevi's widgets off the Home Screen (from earlier runs).
    private func removeFoleviWidgets() {
        XCUIDevice.shared.press(.home)
        sleep(1)
        let widgets = springboard.icons.matching(NSPredicate(format: "identifier == 'Folevi' AND value == 'Widget'"))
        for _ in 0 ..< 8 where widgets.count > 0 {
            widgets.element(boundBy: 0).press(forDuration: 1.3)
            let remove = springboard.buttons.matching(NSPredicate(format: "label == 'Remove Widget'")).firstMatch
            guard remove.waitForExistence(timeout: 3) else { break }
            remove.tap()
            let confirm = springboard.alerts.buttons.matching(NSPredicate(format: "label == 'Remove'")).firstMatch
            if confirm.waitForExistence(timeout: 3) { confirm.tap() }
            sleep(1)
        }
        XCUIDevice.shared.press(.home)
        sleep(1)
    }

    /// Folevi's widgets on the Home Screen through the widget gallery: Today (medium), Recent notes (medium)
    /// and Quick add, then a task checked off right in the Today widget.
    func testAddWidgetsToTheHomeScreen() throws {
        removeFoleviWidgets()
        addWidget(page: 1, shotName: "widgets-1-gallery-today")
        addWidget(page: 4, shotName: "widgets-2-gallery-notes")
        addWidget(page: 6, shotName: "widgets-3-gallery-quick-add")
        let done = springboard.buttons.matching(NSPredicate(format: "label == 'Done'")).firstMatch
        if done.exists { done.tap() }
        sleep(4)
        shot("widgets-4-home")
        dump(springboard, "springboard-home")
        // Checked off in the widget: gone from it, without opening the app.
        let check = springboard.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Check off'")).element(boundBy: 0)
        XCTAssertTrue(check.waitForExistence(timeout: 10))
        let label = check.label
        check.tap()
        let gone = springboard.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: gone)
        waitForExpectations(timeout: 20)
        XCTAssertEqual(XCUIApplication(bundleIdentifier: "com.folevi.ios").state == .runningForeground, false)
        sleep(2)
        shot("widgets-5-checked-off")
    }

    /// A note found in Spotlight (indexed when the app came and went) opens in Folevi.
    func testSpotlightFindsANote() throws {
        let query = ProcessInfo.processInfo.environment["FOLEVI_SPOTLIGHT_QUERY"] ?? "Coastal Weekend"
        XCUIDevice.shared.press(.home)
        sleep(1)
        // Spotlight: the Home Screen's Search button (or a swipe down).
        let pill = springboard.otherElements.matching(identifier: "spotlight-pill").firstMatch
        let button = pill.exists ? pill : springboard.buttons.matching(NSPredicate(format: "label == 'Search'")).firstMatch
        if button.waitForExistence(timeout: 3) { button.tap() }
        let search = springboard.searchFields.firstMatch
        if !search.waitForExistence(timeout: 4) {
            // Or a swipe down from the middle of the Home Screen.
            let middle = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
            middle.press(forDuration: 0.05, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)))
        }
        if !search.waitForExistence(timeout: 10) { dump(springboard, "spotlight") }
        XCTAssertTrue(search.exists)
        search.typeText(query)
        sleep(3)
        shot("spotlight-1-results")
        let result = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", query)).allElementsBoundByIndex.first { $0.isHittable && $0.elementType != .searchField }
        XCTAssertNotNil(result, "Spotlight lists the note")
        result?.tap()
        let folevi = XCUIApplication(bundleIdentifier: "com.folevi.ios")
        XCTAssertTrue(folevi.wait(for: .runningForeground, timeout: 15))
        sleep(4)
        shot("spotlight-2-opened")
    }

    /// Scan from photos: a page picked in the photo picker goes into the note with its text.
    func testScanFromPhotos() throws {
        let folevi = XCUIApplication(bundleIdentifier: "com.folevi.ios")
        XCUIDevice.shared.system.open(URL(string: "folevi://new")!)
        let open = springboard.buttons["Open"]
        if open.waitForExistence(timeout: 3) { open.tap() }
        XCTAssertTrue(folevi.wait(for: .runningForeground, timeout: 15))
        sleep(4)
        folevi.typeText("Hardware receipt\n")
        sleep(1)
        folevi.typeText("/scan")
        let option = folevi.descendants(matching: .any).matching(NSPredicate(format: "label == 'Scan from photos'")).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 10))
        shot("scan-1-slash-menu")
        folevi.typeText("\n")
        sleep(3)
        shot("scan-2-picker")
        dump(folevi, "scan-picker")
        // The newest photo (the receipt added with simctl addmedia) comes first.
        let photo = folevi.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 10), "the picker shows photos")
        photo.tap()
        sleep(1)
        folevi.buttons["Done"].firstMatch.tap()
        let toggle = folevi.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Text from the scan'")).firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 30), "the scan's text is in the note")
        sleep(2)
        shot("scan-3-inserted")
    }
}
