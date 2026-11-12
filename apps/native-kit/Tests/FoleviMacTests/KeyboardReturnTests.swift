// The keyboard after a dialog (FrameSheets): what had it before the dialog gets it back when the dialog closes, so
// ⌘K over a note and then Escape leaves the typing in the note; on another route by then the note's page takes it
// when a note is on screen; and a dialog that replaces another hands on where the first one took it from. Also
// Help > Keyboard Shortcuts (the Help page, at its shortcuts table).
#if os(macOS)
import AppKit
import SwiftUI
import Testing
import FoleviEngine
@testable import FoleviMac
@testable import FoleviScreens

/// A view that takes the keyboard (the note's page, a list).
private final class KeyView: NSView {
    override var acceptsFirstResponder: Bool { true }
}

@Suite("The keyboard after a dialog", .serialized) @MainActor
struct KeyboardReturnTests {
    private func setUp() -> (FrameModel, NSWindow, KeyView, KeyView) {
        let model = FrameModel(client: DemoEngine().client())
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        let page = KeyView(frame: NSRect(x: 0, y: 0, width: 300, height: 400))
        let list = KeyView(frame: NSRect(x: 300, y: 0, width: 300, height: 400))
        window.contentView?.addSubview(page)
        window.contentView?.addSubview(list)
        FrameSheets.attach(model, window: window)
        FrameSheets.attach(model, page: page)
        return (model, window, page, list)
    }

    @Test func backToWhatHadIt() {
        let (model, window, _, list) = setUp()
        window.makeFirstResponder(list)
        FrameSheets.present(model) { _ in Text("Dialog") }
        #expect(FrameSheets.isShowing(model))
        #expect(window.firstResponder !== list)
        FrameSheets.dismiss(model)
        #expect(window.firstResponder === list)
        model.stop()
    }

    @Test func aDialogInPlaceOfAnotherKeepsTheFirstOnesPlace() {
        let (model, window, _, list) = setUp()
        window.makeFirstResponder(list)
        FrameSheets.present(model) { _ in Text("First") }
        FrameSheets.present(model) { _ in Text("Second") }
        FrameSheets.dismiss(model)
        #expect(window.firstResponder === list)
        model.stop()
    }

    @Test func onAnotherRouteTheNotesPageTakesIt() {
        let (model, window, page, list) = setUp()
        window.makeFirstResponder(list)
        FrameSheets.present(model) { _ in Text("Palette") }
        // (The palette opened a note: the list it was opened over isn't where the keyboard belongs any more.)
        model.open(.note("doc_kyoto"))
        FrameSheets.dismiss(model)
        #expect(window.firstResponder === page)
        model.stop()
    }

    @Test func whatTookTheKeyboardMeanwhileKeepsIt() {
        let (model, window, page, list) = setUp()
        window.makeFirstResponder(list)
        FrameSheets.present(model) { _ in Text("Dialog") }
        window.makeFirstResponder(page)
        FrameSheets.dismiss(model)
        #expect(window.firstResponder === page)
        model.stop()
    }

    @Test func helpOpensAtItsShortcuts() {
        let model = FrameModel(client: DemoEngine().client())
        model.openHelpShortcuts()
        #expect(model.helpAtShortcuts)
        #expect(model.route == .web("/help"))
        model.stop()
    }
}
#endif
