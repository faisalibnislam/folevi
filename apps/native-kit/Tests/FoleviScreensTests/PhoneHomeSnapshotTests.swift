// The iPhone layout's Home (FoleviPhone's PhoneHomeContent, as the rebuild frame shows it on iPhone and on an
// iPad under 700 pt), in the native look (the owner, 2026-11-19: the system font; search is the tab bar's): recent notes, Catch me up as its own card, the places as tiles two by
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
                    PhoneHomeContent(model: model, actions: PhoneHomeActions(open: { _ in }, openNote: { _ in }, foldersMenu: { _ in }))
                }
                .padding(.bottom, 24)
            }
            .defaultScrollAnchor(anchor)
            .phoneNativeChrome()
            .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            let host = ScreenHost(view, size: .iphone, scheme: scheme)
            await eventually("phone home", timeout: .seconds(8)) { model.value != nil && model.session.value != nil }
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
                PhoneHomeContent(model: model, actions: PhoneHomeActions(open: { _ in }, openNote: { _ in }, foldersMenu: { _ in }))
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
