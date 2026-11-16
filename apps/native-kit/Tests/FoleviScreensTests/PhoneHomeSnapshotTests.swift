// The iPhone layout's Home (FoleviPhone's PhoneHomeContent, as the rebuild frame shows it on iPhone and on an
// iPad under 700 pt): the search field, recent notes, Catch me up as its own card, the places as tiles two by
// two (Reviews, the odd fifth, across the row), Bookmarks and the More rows in rounded cards. Light and dark
// against the contract's home fixture.
#if os(iOS)
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens
import FoleviPhone

extension Rendering {
@Suite("Phone Home snapshots", .serialized) @MainActor
struct PhoneHomeSnapshotTests {
    init() { ScreenClock.fixed = fixedNow }

    @Test func phoneHome() async {
        let engine = FakeEngine()
        let model = HomeModel(client: engine.client())
        // The top (recents, Catch me up, the tiles) and the end (Bookmarks, Folders, Tags, the More card).
        for (part, anchor) in [("", UnitPoint.top), ("-end", .bottom)] {
        for scheme in [ColorScheme.light, .dark] {
            let view = ScrollView {
                VStack(spacing: 0) {
                    PhoneSearchButton(model.searchPrompt) {}
                    PhoneHomeContent(model: model, actions: PhoneHomeActions(open: { _ in }, openNote: { _ in }, foldersMenu: { _ in }))
                }
                .padding(.bottom, 24)
            }
            .defaultScrollAnchor(anchor)
            .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            let host = ScreenHost(view, size: .iphone, scheme: scheme)
            await eventually("phone home", timeout: .seconds(8)) { model.value != nil && model.session.value != nil }
            await host.settle(0.6)
            checkScreen(host, named: "phone-home\(part)-iphone-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)")
            host.close()
        }
        }
    }
}
}
#endif
