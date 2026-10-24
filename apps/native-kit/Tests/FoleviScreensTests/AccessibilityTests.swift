// An accessibility audit of the screens (plan 7 and 10), in the unit tests since the package has no app for
// XCUIApplication.performAccessibilityAudit: each screen is hosted in a window and its accessibility tree walked as
// VoiceOver would. It fails on controls VoiceOver can't name (a button or link without a label), and reports touch
// targets under 44 points on iOS (each listed, so a regression shows in the log). iOS only: on macOS SwiftUI fills
// its accessibility tree in only for an attached assistive client, which a test process doesn't have.
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

struct AuditElement: CustomStringConvertible {
    var label: String
    var isControl: Bool
    var frame: CGRect
    var description: String { "\(isControl ? "control" : "element") \"\(label)\" \(Int(frame.width))x\(Int(frame.height))" }
}

@MainActor
func auditElements(_ host: ScreenHost) -> [AuditElement] {
    var out: [AuditElement] = []
    var seen = Set<ObjectIdentifier>()
    #if os(iOS)
    func walk(_ object: NSObject, depth: Int) {
        guard depth < 60, seen.insert(ObjectIdentifier(object)).inserted else { return }
        if object.isAccessibilityElement {
            let traits = object.accessibilityTraits
            let control = traits.contains(.button) || traits.contains(.link) || traits.contains(.adjustable) || traits.contains(.searchField)
            let label = [object.accessibilityLabel, object.accessibilityValue].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
            out.append(AuditElement(label: label, isControl: control, frame: object.accessibilityFrame))
            return
        }
        if let elements = object.accessibilityElements as? [NSObject], !elements.isEmpty {
            for e in elements { walk(e, depth: depth + 1) }
        } else if object.accessibilityElementCount() > 0, object.accessibilityElementCount() != NSNotFound {
            for i in 0..<object.accessibilityElementCount() { if let e = object.accessibilityElement(at: i) as? NSObject { walk(e, depth: depth + 1) } }
        } else if let view = object as? UIView {
            for v in view.subviews where !v.isHidden { walk(v, depth: depth + 1) }
        }
    }
    walk(host.window, depth: 0)
    #else
    func walk(_ object: NSObject, depth: Int) {
        guard depth < 60, seen.insert(ObjectIdentifier(object)).inserted, let a = object as? (any NSAccessibilityProtocol) else { return }
        let role = a.accessibilityRole()
        let control = role == .button || role == .link || role == .menuButton || role == .popUpButton || role == .checkBox
        let label = [a.accessibilityLabel(), a.accessibilityTitle(), a.accessibilityValue() as? String].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
        if a.isAccessibilityElement() || control {
            out.append(AuditElement(label: label, isControl: control, frame: a.accessibilityFrame()))
        }
        for child in a.accessibilityChildren() ?? [] {
            if let c = child as? NSObject { walk(c, depth: depth + 1) }
        }
    }
    // The window's tree: a hosting view fills its accessibility children in for the window's clients.
    walk(host.window, depth: 0)
    #endif
    return out
}

extension Rendering {
@Suite("Accessibility audit", .serialized) @MainActor
struct AccessibilityAuditTests {
    func audit<V: View>(_ name: String, ready: @escaping () -> Bool, _ make: () -> V) async {
        #if os(macOS)
        return
        #endif
        let host = ScreenHost(make(), size: hostSizes[0], scheme: .light)
        defer { host.close() }
        await eventually(name, timeout: .seconds(8), ready)
        await host.settle(0.6)
        let elements = auditElements(host)
        #expect(elements.count > 5, "\(name): the accessibility tree is reachable (\(elements.count) elements)")
        let unnamed = elements.filter { $0.isControl && $0.label.isEmpty }
        #expect(unnamed.isEmpty, "\(name): controls without a label: \(unnamed)")
        #if os(iOS)
        let small = elements.filter { $0.isControl && ($0.frame.width < 44 || $0.frame.height < 44) && $0.frame.width > 0 }
        if !small.isEmpty { print("A11Y \(name): \(small.count) of \(elements.filter(\.isControl).count) controls under 44 pt (their hit areas may be larger): \(small.prefix(12))") }
        #endif
        print("A11Y \(name): \(elements.count) elements, \(elements.filter(\.isControl).count) controls, \(unnamed.count) unnamed")
    }

    @Test func home() async {
        ScreenClock.fixed = fixedNow
        let engine = FakeEngine()
        let model = HomeModel(client: engine.client())
        await audit("home", ready: { model.value != nil && model.session.value != nil }) {
            Framed(title: "Home", large: true) { HomeScreen(model: model, showsHeader: true) } bar: { HomeToolbar(model: model) }
        }
    }

    @Test func listsAndFolders() async {
        let engine = FakeEngine()
        let d = UserDefaults(suiteName: "folevi.a11y.\(UUID().uuidString)")!
        let cards = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: d)
        await audit("all-notes-cards", ready: { cards.total == 25 }) {
            Framed(title: "All notes", large: true) { NotesListScreen(model: cards) } bar: { NotesListToolbar(model: cards) }
        }
        d.set("list", forKey: "folevi.layout.trash")
        let trash = NotesListModel(client: engine.client(), kind: NotesListKind(.trash), defaults: d)
        await audit("trash-list", ready: { trash.total == 25 }) {
            Framed(title: "Trash", large: true) { NotesListScreen(model: trash) } bar: { NotesListToolbar(model: trash) }
        }
        let folders = AllFoldersModel(client: engine.client(), defaults: d)
        await audit("all-folders", ready: { folders.tree.value != nil }) {
            Framed(title: "Folders", large: true) { AllFoldersScreen(model: folders) } bar: { AllFoldersToolbar(model: folders) }
        }
    }
}
}
