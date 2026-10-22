// The native UI layer (Native/UI, docs/IOS_POLISH_PLAN.md §4): alerts and action sheets built from what the
// page sends, the pickers' values, haptic kinds, the lift's spring and rectangles, and the keyboard's frames.
import UIKit
import WebKit
import XCTest
@testable import App

@MainActor
final class NativeUITests: XCTestCase {
    // MARK: Alerts and action sheets

    func testActionsKeepTheirOrderStylesAndOneCancel() throws {
        let actions = try XCTUnwrap(NativeAlerts.actions([
            ["id": "cancel", "title": "Cancel", "style": "cancel"],
            ["id": "delete", "title": "Delete", "style": "destructive"],
            ["id": "other", "title": "Keep", "style": "cancel"],
            ["id": "plain", "title": "Archive"],
        ]))
        XCTAssertEqual(actions.map(\.id), ["cancel", "delete", "other", "plain"])
        XCTAssertEqual(actions.map(\.style), [.cancel, .destructive, .default, .default])
        // Nothing usable: no alert.
        XCTAssertNil(NativeAlerts.actions([]))
        XCTAssertNil(NativeAlerts.actions([["id": "", "title": "X"]]))
        XCTAssertNil(NativeAlerts.actions([["id": "a"]]))
        XCTAssertNil(NativeAlerts.actions(nil))
    }

    func testAlertWithAFieldAnswersTheChoiceAndTheText() throws {
        let actions = try XCTUnwrap(NativeAlerts.actions([["id": "cancel", "title": "Cancel", "style": "cancel"], ["id": "confirm", "title": "Save"]]))
        let field = try XCTUnwrap(NativeAlerts.field(["value": "Ideas", "placeholder": "Folder name", "capitalize": "words"]))
        var answers: [(String?, String?)] = []
        let alert = NativeAlerts.make(style: .alert, title: "Rename folder", message: "", actions: actions, field: field) { answers.append(($0, $1)) }
        XCTAssertEqual(alert.title, "Rename folder")
        XCTAssertNil(alert.message)
        XCTAssertEqual(alert.textFields?.count, 1)
        XCTAssertEqual(alert.textFields?.first?.text, "Ideas")
        XCTAssertEqual(alert.textFields?.first?.placeholder, "Folder name")
        XCTAssertEqual(alert.textFields?.first?.autocapitalizationType, .words)
        XCTAssertEqual(alert.actions.map(\.title), ["Cancel", "Save"])
        // The confirming button is the bold one.
        XCTAssertEqual(alert.preferredAction?.title, "Save")
    }

    func testActionSheetAlwaysHasAWayOut() throws {
        let actions = try XCTUnwrap(NativeAlerts.actions([["id": "trash", "title": "Move to Trash", "style": "destructive"]]))
        let sheet = NativeAlerts.make(style: .actionSheet, title: nil, message: nil, actions: actions, field: nil) { _, _ in }
        XCTAssertEqual(sheet.actions.map(\.title), ["Move to Trash", "Cancel"])
        XCTAssertEqual(sheet.actions.last?.style, .cancel)
        // An action sheet takes no text field, even if one is sent.
        let withField = NativeAlerts.make(style: .actionSheet, title: "T", message: nil, actions: actions, field: .init(value: "x", placeholder: "", capitalize: .none)) { _, _ in }
        XCTAssertNil(withField.textFields)
    }

    // MARK: Pickers

    func testDatesTravelInTheModesShapesInLocalTime() throws {
        let zone = try XCTUnwrap(TimeZone(identifier: "Europe/London"))
        let day = try XCTUnwrap(NativeDates.parse("2026-10-22", .date, timeZone: zone))
        XCTAssertEqual(NativeDates.format(day, .date, timeZone: zone), "2026-10-22")
        let moment = try XCTUnwrap(NativeDates.parse("2026-10-22T14:30", .dateAndTime, timeZone: zone))
        XCTAssertEqual(NativeDates.format(moment, .dateAndTime, timeZone: zone), "2026-10-22T14:30")
        let time = try XCTUnwrap(NativeDates.parse("09:05", .time, timeZone: zone, now: day))
        XCTAssertEqual(NativeDates.format(time, .time, timeZone: zone), "09:05")
        XCTAssertEqual(NativeDates.format(time, .date, timeZone: zone), "2026-10-22")
        // The wrong shape for the mode, or not a date at all.
        XCTAssertNil(NativeDates.parse("2026-10-22", .time, timeZone: zone))
        XCTAssertNil(NativeDates.parse("14:30", .date, timeZone: zone))
        XCTAssertNil(NativeDates.parse("2026-13-40", .date, timeZone: zone))
        XCTAssertNil(NativeDates.parse("", .date))
        XCTAssertNil(NativeDates.Mode(rawValue: "week"))
    }

    func testPickerSheetStartsWhereThePageSaysAndAnswersOnce() throws {
        let zone = TimeZone.current
        let start = try XCTUnwrap(NativeDates.parse("2026-10-22", .date, timeZone: zone))
        var answers: [(Date?, Bool)] = []
        let sheet = DatePickerSheet(mode: .date, value: start, min: nil, max: nil, title: nil, clearable: true) { answers.append(($0, $1)) }
        XCTAssertEqual(sheet.picker.date, start)
        XCTAssertEqual(sheet.picker.datePickerMode, .date)
        XCTAssertEqual(sheet.title, "Date")
        let nav = sheet.presentable()
        XCTAssertEqual(nav.sheetPresentationController?.prefersGrabberVisible, true)
        // Dragged away twice (it can't be): one answer, no date, not cleared.
        sheet.presentationControllerDidDismiss(nav.presentationController!)
        sheet.presentationControllerDidDismiss(nav.presentationController!)
        XCTAssertEqual(answers.count, 1)
        XCTAssertNil(answers.first?.0)
        XCTAssertEqual(answers.first?.1, false)
        // A new time starts at 9:00.
        let nine = DatePickerSheet.defaultValue(.time, now: start)
        XCTAssertEqual(Calendar.current.component(.hour, from: nine), 9)
        XCTAssertGreaterThan(NativeDates.sheetHeight(.dateAndTime, clearable: true), NativeDates.sheetHeight(.time, clearable: false))
    }

    func testColoursAsHex() {
        XCTAssertEqual(NativeColors.hex(UIColor(red: 1, green: 0.5, blue: 0, alpha: 1)), "#ff8000")
        XCTAssertEqual(NativeColors.color("#336699").map(NativeColors.hex), "#336699")
        XCTAssertNil(NativeColors.color("336699"))
        XCTAssertNil(NativeColors.color("#zzzzzz"))
    }

    // MARK: Haptics

    func testEveryHapticKindHasAGenerator() {
        for kind in NativeHaptics.Kind.allCases {
            XCTAssertTrue(NativeHaptics.impactStyle(kind) != nil || NativeHaptics.noticeType(kind) != nil || kind == .selection, "\(kind)")
        }
        XCTAssertEqual(NativeHaptics.impactStyle(.rigid), .rigid)
        XCTAssertEqual(NativeHaptics.noticeType(.warning), .warning)
        XCTAssertNil(NativeHaptics.kind("buzz"))
        XCTAssertEqual(NativeHaptics.kind("selection"), .selection)
    }

    // MARK: The lifted preview

    func testLiftSpringIsTheResponseAndDampingThePageUses() {
        let p = LiftPreview.springParameters(response: 0.25, damping: 0.7)
        XCTAssertEqual(p.mass, 1)
        XCTAssertEqual(Double(p.stiffness), pow(2 * .pi / 0.25, 2), accuracy: 0.001)
        // Damping ratio = c / (2 sqrt(k m)).
        XCTAssertEqual(Double(p.damping) / (2 * sqrt(Double(p.stiffness))), 0.7, accuracy: 0.0001)
    }

    func testLiftRectanglesFromThePage() {
        XCTAssertEqual(LiftPreview.rect(["x": 16, "y": 100.5, "width": 180, "height": 120]), CGRect(x: 16, y: 100.5, width: 180, height: 120))
        XCTAssertNil(LiftPreview.rect(["x": 16, "y": 100, "width": 2, "height": 120]))
        XCTAssertNil(LiftPreview.rect(["x": 16, "y": 100, "width": 180]))
        XCTAssertNil(LiftPreview.rect(["x": "16", "y": 100, "width": 180, "height": 120]))
        XCTAssertNil(LiftPreview.rect(nil))
    }

    func testLiftWithoutAPictureShowsNothing() async {
        let webView = WKWebViewStandIn.make()
        let shown = await LiftPreview.shared.lift(id: "never-armed", from: 0.97, in: webView)
        XCTAssertFalse(shown)
        await LiftPreview.shared.drop(id: "never-armed", to: "back")
        XCTAssertFalse(LiftPreview.shared.isArmed("never-armed"))
    }

    // MARK: The keyboard

    func testKeyboardFramesForThePage() {
        let screen = CGRect(x: 0, y: 0, width: 402, height: 874)
        let info: [AnyHashable: Any] = [
            UIResponder.keyboardFrameEndUserInfoKey: NSValue(cgRect: CGRect(x: 0, y: 538, width: 402, height: 336)),
            UIResponder.keyboardAnimationDurationUserInfoKey: NSNumber(value: 0.25),
            UIResponder.keyboardAnimationCurveUserInfoKey: NSNumber(value: 7),
        ]
        let shown = KeyboardBridge.frame(userInfo: info, bounds: screen, hiding: false)
        XCTAssertEqual(shown["height"] as? Double, 336)
        XCTAssertEqual(shown["duration"] as? Double, 250)
        XCTAssertEqual(shown["curve"] as? String, "keyboard")
        XCTAssertEqual(shown["visible"] as? Bool, true)
        let hidden = KeyboardBridge.frame(userInfo: info, bounds: screen, hiding: true)
        XCTAssertEqual(hidden["height"] as? Double, 0)
        XCTAssertEqual(hidden["visible"] as? Bool, false)
        // iPad's floating keyboard (it doesn't reach the bottom) covers nothing the page must clear.
        XCTAssertEqual(KeyboardBridge.coveredHeight(keyboard: CGRect(x: 100, y: 300, width: 320, height: 260), bounds: CGRect(x: 0, y: 0, width: 1032, height: 1376)), 0)
        // A hardware keyboard's bar only.
        XCTAssertEqual(KeyboardBridge.coveredHeight(keyboard: CGRect(x: 0, y: 1321, width: 1032, height: 55), bounds: CGRect(x: 0, y: 0, width: 1032, height: 1376)), 55)
    }
}

/// A web view for the lift's calls (nothing is loaded in it).
enum WKWebViewStandIn {
    @MainActor static func make() -> WKWebView {
        WKWebView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
    }
}
