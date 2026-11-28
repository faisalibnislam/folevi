// The iPhone layout's Home (FoleviPhone's PhoneHomeContent, as the rebuild frame shows it on iPhone and on an
// iPad under 700 pt): the web's redesigned Home in one column (the date and Customize, the greeting, Catch me up,
// the capture field, the blocks in their order), then the places as tiles two by two, Tags and the More card.
// Light and dark against the contract's fixtures.
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

    /// The redesigned Home's views from the contract's fixtures (At a glance, the layout, Today, My tasks, Foli DNA).
    static func dashboardValues(_ engine: FakeEngine) {
        engine.values["home.stats"] = Fixtures.value("view.home.stats.json")
        engine.values["home.prefs"] = Fixtures.value("view.home.prefs.default.json")
        engine.values["tasks.list"] = Fixtures.value("view.tasks.list.json")
        engine.values["tasks.counts"] = Fixtures.value("view.tasks.counts.json")
        engine.values["calendars.events"] = Fixtures.value("view.calendars.events.json")
        engine.values["graph"] = Fixtures.value("view.graph.json")
    }

    @Test func phoneHome() async {
        let engine = FakeEngine()
        Self.dashboardValues(engine)
        let model = HomeModel(client: engine.client())
        // The top (the greeting, Catch me up, the capture field), the middle (the blocks) and the end (the places,
        // Tags, the More card).
        for (part, anchor) in [("", UnitPoint.top), ("-mid", .center), ("-end", .bottom)] {
        for scheme in [ColorScheme.light, .dark] {
            let view = ScrollView {
                VStack(spacing: 0) {
                    PhoneHomeContent(model: model, actions: PhoneHomeActions(open: { _ in }, openNote: { _ in }))
                }
                .padding(.bottom, 24)
            }
            .defaultScrollAnchor(anchor)
            .phoneNativeChrome()
            .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            let host = ScreenHost(view, size: .iphone, scheme: scheme)
            await eventually("phone home", timeout: .seconds(8)) { model.value != nil && model.session.value != nil && model.dashboard.stats.value != nil }
            await host.settle(0.6)
            checkScreen(host, named: "phone-home\(part)-iphone-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)")
            host.close()
        }
        }
    }

    /// The More card lists the Vault only for someone with one (vault.summary not "none"), as the web's sidebar does:
    /// the phone has no sidebar, so Home is where it's found.
    @Test func theVaultRowIsForSomeoneWithAVault() async {
        for (fixture, expected) in [("view.vault.summary.json", true), ("view.vault.summary.locked.json", true), ("view.vault.summary.none.json", false)] {
            let engine = FakeEngine()
            engine.values["vault.summary"] = Fixtures.value(fixture)
            let model = HomeModel(client: engine.client())
            await eventually("vault summary", timeout: .seconds(8)) { model.vault.value != nil }
            #expect(model.hasVault == expected, "\(fixture)")
        }
        // No answer (an engine without the Vault): no row.
        let bare = HomeModel(client: FakeEngine().client())
        await eventually("home", timeout: .seconds(8)) { bare.value != nil }
        #expect(!bare.hasVault)
    }

    @Test func phoneHomeWithAVault() async {
        let engine = FakeEngine()
        engine.values["vault.summary"] = Fixtures.value("view.vault.summary.json")
        let model = HomeModel(client: engine.client())
        for scheme in [ColorScheme.light, .dark] {
            let view = ScrollView {
                PhoneHomeContent(model: model, actions: PhoneHomeActions(open: { _ in }, openNote: { _ in }))
                    .padding(.bottom, 24)
            }
            .defaultScrollAnchor(.bottom)
            .phoneNativeChrome()
            .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            let host = ScreenHost(view, size: .iphone, scheme: scheme)
            await eventually("phone home with a Vault", timeout: .seconds(8)) { model.value != nil && model.session.value != nil && model.hasVault }
            await host.settle(0.6)
            checkScreen(host, named: "phone-home-vault-iphone-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)")
            host.close()
        }
    }
}
}
#endif
