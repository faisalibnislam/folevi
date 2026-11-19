// The iPhone's Shared with Me with the folders shared with this person (SharedView.tsx: Folders, then Pages) and
// the Move or copy notes sheet (MovePlaces.tsx as a phone sheet), light and dark, against the contract's fixtures.
// In the iPhone's native look (the owner, 2026-11-19): the system font, iOS's navigation bar and large title.
#if os(iOS)
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens
import FoleviPhone

extension Rendering {
@Suite("Phone sharing and places snapshots", .serialized) @MainActor
struct PhoneSharingSnapshotTests {
    init() { ScreenClock.fixed = fixedNow }

    @Test func sharedWithMeFolders() async {
        let engine = FakeEngine()
        engine.values["shared.list"] = Fixtures.value("view.shared.list.json")
        engine.values["shared.folders"] = Fixtures.value("view.shared.folders.json")
        let model = SharedListModel(client: engine.client())
        for scheme in [ColorScheme.light, .dark] {
            // (In a navigation stack in the native look, as the frame shows it: iOS's bar and large title.)
            let view = NavigationStack { PhoneSharedScreen(model: model, openNote: { _ in }, back: {}) }
                .phoneNativeChrome()
                .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            let host = ScreenHost(view, size: .iphone, scheme: scheme)
            await eventually("shared", timeout: .seconds(8)) { !model.isLoading }
            await host.settle(0.6)
            checkScreen(host, named: "phone-shared-folders-iphone-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)")
            host.close()
        }
    }

    @Test func tagsIndex() async {
        let engine = FakeEngine()
        engine.values["tags.index"] = Fixtures.value("view.tags.index.json")
        let model = TagsIndexModel(client: engine.client(), defaults: UserDefaults(suiteName: "folevi.tags.\(UUID().uuidString)")!)
        for scheme in [ColorScheme.light, .dark] {
            let view = NavigationStack { PhoneTagsScreen(model: model, open: { _ in }, back: {}, menu: { _ in }) }
                .phoneNativeChrome()
                .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            let host = ScreenHost(view, size: .iphone, scheme: scheme)
            await eventually("tags", timeout: .seconds(8)) { !model.isLoading }
            await host.settle(0.6)
            checkScreen(host, named: "phone-tags-iphone-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)")
            host.close()
        }
    }

    @Test func moveOrCopyAFolder() async {
        let engine = FakeEngine()
        engine.queryAnswers["places.move.preview"] = { args in
            guard case .object(var v) = Fixtures.value("view.places.move.preview.json") else { return .null }
            v["everything"] = .bool(false)
            v["folders"] = .number(1)
            v["notes"] = .number(0)
            return .object(v)
        }
        for scheme in [ColorScheme.light, .dark] {
            let model = MovePlacesModel(client: engine.client(), request: MovePlacesRequest(folders: ["fld_trips"]))
            let view = VStack(spacing: 0) {
                PhoneMovePlacesSheet(model: model, close: {})
                Spacer(minLength: 0)
            }
            .phoneNativeChrome()
            .background(PhoneSurface.solid.resolve(scheme).color)
            let host = ScreenHost(view, size: .iphone, scheme: scheme)
            await eventually("move preview", timeout: .seconds(8)) { model.loaded }
            await host.settle(0.6)
            checkScreen(host, named: "phone-move-places-iphone-\(scheme == .dark ? "dark" : "light")-\(hostPlatform)")
            host.close()
        }
    }
}
}
#endif
