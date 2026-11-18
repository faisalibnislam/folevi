// The native look's window frame (docs/MAC_NATIVE_LOOK.md; the owner's layout, 2026-11-18): the title bar strip at
// the top, the sidebar under it, the content card beside it, the note's inspector in a column at the right (or the
// page's own panel in that column), and the room the card's floating controls take.
#if os(macOS)
import Foundation
import Testing
@testable import FoleviMac

@Suite("Native shell geometry") @MainActor
struct NativeShellTests {
    let b = CGRect(x: 0, y: 0, width: 1280, height: 820)

    @Test func stripSidebarAndCard() {
        let f = FrameSplitViewController.layout(bounds: b, sidebarHidden: false)
        // The strip across the window's top (AppKit's origin is the bottom left).
        #expect(f.strip == CGRect(x: 0, y: 820 - MacLook.titleBarHeight, width: 1280, height: MacLook.titleBarHeight))
        // The sidebar under it, from the window's edge; the card from the sidebar's edge (no gap, no divider).
        #expect(f.sidebar == CGRect(x: 0, y: 0, width: MacLook.sidebarWidth, height: 820 - MacLook.titleBarHeight))
        #expect(f.card.minX == MacLook.sidebarWidth)
        // The card from the strip's bottom, the margin on its trailing and bottom edges.
        #expect(f.card.maxY == f.strip.minY)
        #expect(f.card.minY == MacLook.containerMargin)
        #expect(b.maxX - f.card.maxX == MacLook.containerMargin)
        #expect(f.inspector == nil)
    }

    @Test func hiddenSidebarKeepsTheMargin() {
        let f = FrameSplitViewController.layout(bounds: b, sidebarHidden: true)
        #expect(f.card.minX == MacLook.containerMargin)
        #expect(f.card.maxY == f.strip.minY)
    }

    @Test func inspectorIsAColumnBesideTheCard() {
        let f = FrameSplitViewController.layout(bounds: b, sidebarHidden: false, inspector: true)
        let column = try! #require(f.inspector)
        #expect(column == CGRect(x: 1280 - MacLook.inspectorWidth, y: 0, width: MacLook.inspectorWidth, height: 820 - MacLook.titleBarHeight))
        // The card ends where the column starts: the page never runs under the inspector.
        #expect(f.card.maxX == column.minX)
        #expect(f.card.width >= MacLook.inspectorMinContent)
    }

    @Test func thePagesOwnPanelTakesTheColumn() {
        let f = FrameSplitViewController.layout(bounds: b, sidebarHidden: false, inspector: true, pagePanel: true)
        // No native inspector; the page (its card and its panel) reaches the window's trailing edge.
        #expect(f.inspector == nil)
        #expect(f.card.maxX == b.maxX)
        #expect(f.card.minX == MacLook.sidebarWidth)
    }

    @Test func narrowWindowsLetTheInspectorStepAside() {
        let narrow = CGRect(origin: .zero, size: MacLook.minWindowSize)
        let f = FrameSplitViewController.layout(bounds: narrow, sidebarHidden: false, inspector: true)
        #expect(f.inspector == nil)
        #expect(narrow.maxX - f.card.maxX == MacLook.containerMargin)
        // The page's own panel too: the card keeps its margin, the page lays the panel over the note.
        let p = FrameSplitViewController.layout(bounds: narrow, sidebarHidden: false, pagePanel: true)
        #expect(narrow.maxX - p.card.maxX == MacLook.containerMargin)
    }

    /// The card's floating controls: 12 pt from its top, 36 pt tall, 12 pt under them.
    @Test func theControlsRoom() async {
        #expect(MacLook.barHeight == 60)
        let model = FrameModel(client: DemoEngine().client())
        await eventually("ready") { model.isEngineReady }
        #expect(model.barHeight == MacLook.barHeight)
        model.open(.notes(.all), .newTab)
        #expect(model.barHeight == MacLook.barHeight)
        #expect(!CardControls.title(model).isEmpty)
    }

    @Test func theSidebarHides() async {
        let model = FrameModel(client: DemoEngine().client())
        #expect(!model.sidebarHidden)
        model.sidebarCollapsed = true
        #expect(model.sidebarHidden)
    }
}
#endif
