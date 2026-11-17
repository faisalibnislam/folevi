// The iPad's wide layout keeps its tabs between launches (DeskTabs), as the Mac's windows do; and the Mac's Settings
// never lists This device (the iPad's lock).
#if os(macOS)
import Foundation
import Testing
import FoleviEngine
import FoleviScreens
@testable import FoleviMac

@Suite("Desk tabs", .serialized)
@MainActor
struct DeskTabsTests {
    /// Settings of the test's own, gone again when it ends.
    private func scratch() -> (UserDefaults, String) {
        let name = "folevi.tests.desk.\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    @Test func savedTabsComeBack() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        let frame = FrameModel(client: DemoEngine().client())
        frame.open(.note("doc_kyoto"), .newTab)
        frame.open(.folder("fld_launch"), .newTab)
        frame.open(.tasks(.upcoming), .newTab)
        DeskTabs.save(frame, to: defaults)

        let saved = try! #require(DeskTabs.saved(in: defaults))
        let again = FrameModel(client: DemoEngine().client())
        again.restore(saved)
        #expect(again.tabs.tabs.map(\.route) == frame.tabs.tabs.map(\.route))
        #expect(again.route == .tasks(.upcoming))
    }

    @Test func nothingSavedOrUnreadable() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        #expect(DeskTabs.saved(in: defaults) == nil)
        defaults.set(Data("not json".utf8), forKey: DeskTabs.defaultsKey)
        #expect(DeskTabs.saved(in: defaults) == nil)
    }

    @Test func changesAreSavedAMomentLater() async {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        let frame = FrameModel(client: DemoEngine().client())
        frame.open(.note("doc_kyoto"), .newTab)
        DeskTabs.changed(frame, defaults: defaults)
        DeskTabs.changed(frame, defaults: defaults)
        #expect(DeskTabs.saved(in: defaults) == nil)
        await eventually("saved") { DeskTabs.saved(in: defaults) != nil }
        #expect(DeskTabs.saved(in: defaults)?.tabs.contains { $0.route == .note("doc_kyoto") } == true)
    }

    @Test func theMacListsNoThisDevice() {
        let frame = FrameModel(client: DemoEngine().client())
        let settings = MacSettingsModel(frame: frame)
        #expect(!settings.groups.flatMap(\.items).contains(.thisDevice))
        #expect(settings.shown(.thisDevice) != .thisDevice)
    }
}
#endif
