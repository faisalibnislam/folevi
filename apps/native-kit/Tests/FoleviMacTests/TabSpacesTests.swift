// Each space's own tabs (the web's tabsStorageKeys in apps/web/src/lib/app/tabs.tsx): switching Personal or a
// workspace puts the strip away, pinned and screen tabs too, and brings back the other space's (just Home the first
// time); a window's save keeps every space's tabs, so they come back after a relaunch.
#if os(macOS)
import Foundation
import Testing
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@MainActor
@Suite("Tabs per space")
struct TabSpacesTests {
    static func ids(_ m: TabsModel) -> [String] { m.tabs.map(\.id) }

    @Test func eachSpaceKeepsItsOwnTabs() {
        let m = TabsModel()
        m.show(.note("a"))
        // The first space named adopts the tabs open before it.
        #expect(!m.enter(space: "personal"))
        m.show(.note("b"))
        m.show(.calendar(nil))
        m.setPinned("a", true)
        m.select(id: "b")
        #expect(m.enter(space: "ws_airly"))
        #expect(Self.ids(m) == ["home"])
        #expect(m.activeID == "home")
        #expect(m.closed.isEmpty)
        m.show(.note("w1"))
        m.close("w1")
        // Back to Personal: its tabs as they were, the pinned one first, the same one on screen.
        #expect(m.enter(space: "personal"))
        #expect(Self.ids(m) == ["home", "a", "b", FrameRoute.calendar(nil).tabKey])
        #expect(m.tabs[1].pinned)
        #expect(m.activeID == "b")
        // The workspace's closed tab didn't come along (⇧⌘T stays in its space).
        #expect(m.reopenClosed() == nil)
        #expect(m.enter(space: "ws_airly"))
        #expect(m.reopenClosed() == .note("w1"))
        #expect(!m.enter(space: "ws_airly"))
    }

    @Test func aWindowsSaveKeepsEverySpace() throws {
        let m = TabsModel()
        m.enter(space: "personal")
        m.show(.note("a"))
        m.enter(space: "ws_airly")
        m.show(.note("w1"))
        m.show(.note("w2"))
        m.select(id: "w1")
        let data = try JSONEncoder().encode(m.saved)
        let back = TabsModel()
        back.restore(try JSONDecoder().decode(TabsModel.Saved.self, from: data))
        #expect(back.space == "ws_airly")
        #expect(Self.ids(back) == ["home", "w1", "w2"])
        #expect(back.activeID == "w1")
        back.enter(space: "personal")
        #expect(Self.ids(back) == ["home", "a"])
        #expect(back.activeID == "a")
    }

    @Test func aSaveFromBeforeSpacesStillRestores() throws {
        let old = #"{"tabs":[{"id":"a","path":"/d/a","title":"A"}],"active":"a"}"#
        let m = TabsModel()
        m.restore(try JSONDecoder().decode(TabsModel.Saved.self, from: Data(old.utf8)))
        #expect(m.space == nil)
        #expect(!m.enter(space: "personal"))
        #expect(Self.ids(m) == ["home", "a"])
    }

    @Test func switchingSpaceInTheAppSwapsTheStrip() async {
        let demo = DemoEngine()
        let model = FrameModel(client: demo.client())
        await eventually("ready") { model.isEngineReady && model.session.value != nil }
        await eventually("space known") { model.tabs.space == "personal" }
        model.open(.note("doc_kyoto"))
        model.open(.tasks(.today))
        model.switchSpace("ws_airly")
        await eventually("workspace tabs") { model.tabs.space == "ws_airly" }
        #expect(Self.ids(model.tabs) == ["home"])
        #expect(model.route == .home)
        #expect(!model.history.canGoBack)
        model.open(.note("doc_lisbon"))
        model.switchSpace("personal")
        await eventually("personal tabs") { model.tabs.space == "personal" }
        #expect(Self.ids(model.tabs) == ["home", "doc_kyoto", FrameRoute.tasks(.today).tabKey])
        #expect(model.route == .tasks(.today))
        model.stop()
    }
}
#endif
