// The iPhone's search tab on iOS 26 (the owner, 21 November 2026, iOS 26's direction): iOS's own search field and
// its close button at the screen's foot, where the tab bar was, the scope chips just above it, and Recent and
// Actions filling the screen from the top. Drawn in a TabView with a `Tab(role: .search)`, as PhoneFrameView hosts
// it, light and dark.
#if os(iOS)
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens
import FoleviPhone

extension Rendering {
@Suite("Phone search snapshots", .serialized) @MainActor
struct PhoneSearchSnapshotTests {
    init() { ScreenClock.fixed = fixedNow }

    @Test func theFieldSitsAtTheFoot() async {
        guard #available(iOS 26, *) else { return }
        for scheme in [ColorScheme.light, .dark] {
            let engine = FakeEngine()
            let model = SearchModel(client: engine.client(), defaults: testDefaults())
            let actions = [
                PhoneSearchAction(id: "new", label: "New document", icon: .plus) {},
                PhoneSearchAction(id: "tasks", label: "Go to Tasks · Today", icon: .squareCheck) {},
            ]
            let view = TabView(selection: .constant(1)) {
                Tab("Home", systemImage: "house", value: 0) { Color.clear }
                Tab(value: 1, role: .search) {
                    PhoneSearchScreen(model: model, aiOn: true, actions: actions, askAI: { _ in }, openNote: { _ in }, close: {}, scopeMenu: { _, _ in })
                }
            }
            .phoneNativeChrome()
            let host = ScreenHost(view, size: .iphone, scheme: scheme)
            await host.settle(1.2)
            checkScreen(host, named: "phone-search-iphone-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)")
            host.close()
        }
    }
}
}
#endif
