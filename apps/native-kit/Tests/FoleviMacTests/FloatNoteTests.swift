// Float Note (the Mac): the frame asks its host to float a note, the host says whether notes float at all (the
// iPad's doesn't), and the model keeps which notes float for their tabs.
#if os(macOS)
import Foundation
import Testing
@testable import FoleviMac
import FoleviScreens

@MainActor
private final class FloatHost: FrameHost {
    var floated: [String] = []
    let floats: Bool
    init(floats: Bool) { self.floats = floats }
    func frameOpenSettings(section: String?) {}
    func frameSwitchPlace(_ place: String, space: String?) {}
    func frameSignInAnotherAccount() {}
    func frameSignOut(place: String) {}
    func frameSignOutConfirmed(place: String) {}
    func frameDownloadFile(_ id: String) {}
    func frameMoveOrCopy() {}
    func frameOpenHelp() {}
    func frameOpenExternal(_ url: URL) {}
    func frameOpenInNewWindow(_ route: FrameRoute) {}
    func frameStateChanged() {}
    var frameCanFloatNotes: Bool { floats }
    func frameFloatNote(_ id: String) { floated.append(id) }
}

/// A host that leaves floating to the protocol's defaults (the iPad's).
@MainActor
private final class PlainHost: FrameHost {
    func frameOpenSettings(section: String?) {}
    func frameSwitchPlace(_ place: String, space: String?) {}
    func frameSignInAnotherAccount() {}
    func frameSignOut(place: String) {}
    func frameSignOutConfirmed(place: String) {}
    func frameDownloadFile(_ id: String) {}
    func frameMoveOrCopy() {}
    func frameOpenHelp() {}
    func frameOpenExternal(_ url: URL) {}
    func frameOpenInNewWindow(_ route: FrameRoute) {}
    func frameStateChanged() {}
}

@MainActor
@Suite("Float note")
struct FloatNoteTests {
    @Test func floatAsksTheHost() {
        let model = FrameModel(client: DemoEngine().client())
        defer { model.stop() }
        let host = FloatHost(floats: true)
        model.host = host
        model.open(.note("doc_1"))
        model.floatNote("doc_1")
        #expect(host.floated == ["doc_1"])
        #expect(model.host?.frameCanFloatNotes == true)
        model.floatingNotes = ["doc_1"]
        #expect(model.floatingNotes.contains("doc_1"))
    }

    @Test func plainHostsDontFloat() {
        let model = FrameModel(client: DemoEngine().client())
        defer { model.stop() }
        let host = PlainHost()
        model.host = host
        #expect(model.host?.frameCanFloatNotes == false)
        model.floatNote("doc_1")
    }
}
#endif
