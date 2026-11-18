// The native look's window frame (docs/MAC_NATIVE_LOOK.md): the sidebar at the window's leading edge with the card
// beside it, the card's margins, Focus mode's no-sidebar profile, and the note tools inspector's width kept out of
// the note page's.
#if os(macOS)
import Foundation
import Testing
@testable import FoleviMac

@Suite("Native shell geometry") @MainActor
struct NativeShellTests {
    @Test func sidebarAndCard() {
        let b = CGRect(x: 0, y: 0, width: 1280, height: 820)
        let f = FrameSplitViewController.layout(bounds: b, sidebarHidden: false)
        // The sidebar from the window's edge, full height; the card from its edge (no gap, no divider).
        #expect(f.sidebar == CGRect(x: 0, y: 0, width: MacLook.sidebarWidth, height: 820))
        #expect(f.card.minX == MacLook.sidebarWidth)
        // Equal margins on the card's top, trailing and bottom edges (AppKit's origin is the bottom left).
        #expect(f.card.minY == MacLook.containerMargin)
        #expect(b.maxX - f.card.maxX == MacLook.containerMargin)
        #expect(b.maxY - f.card.maxY == MacLook.containerMargin)
        // The drag strip is the room above the card.
        #expect(f.strip.minY == f.card.maxY && f.strip.maxY == b.maxY)
    }

    @Test func focusModeHidesTheSidebar() {
        let b = CGRect(x: 0, y: 0, width: 1280, height: 820)
        let f = FrameSplitViewController.layout(bounds: b, sidebarHidden: true)
        #expect(f.card.minX == MacLook.containerMargin)
        #expect(b.maxY - f.card.maxY == MacLook.titlebarStrip)
        #expect(f.strip.height == MacLook.titlebarStrip)
    }

    @Test func inspectorKeepsItsWidthOutOfThePage() {
        let card = CGSize(width: 1040, height: 796)
        let f = ContentViewController.pageLayout(card: card, wanted: true)
        let panel = try! #require(f.inspector)
        #expect(panel.width == MacLook.inspectorWidth)
        // Inset by the gutter on the right and bottom, below the top bar.
        #expect(card.width - panel.maxX == MacLook.panelGutter)
        #expect(panel.minY == MacLook.panelGutter)
        #expect(card.height - panel.maxY == MacLook.barHeight)
        // The page ends a gutter before the panel: it never runs under it.
        #expect(panel.minX - f.page.maxX == MacLook.panelGutter)
        #expect(f.page.height == card.height)
        // Not asked for: the page has the whole card.
        #expect(ContentViewController.pageLayout(card: card, wanted: false).inspector == nil)
        #expect(ContentViewController.pageLayout(card: card, wanted: false).page.width == card.width)
    }

    @Test func narrowCardsLetTheInspectorStepAside() {
        // The narrowest window: 820 wide leaves the card 580, too little for a note beside the inspector.
        let narrow = CGSize(width: MacLook.minWindowSize.width - MacLook.sidebarWidth - MacLook.containerMargin, height: 496)
        let f = ContentViewController.pageLayout(card: narrow, wanted: true)
        #expect(f.inspector == nil)
        #expect(f.page.width == narrow.width)
    }

    @Test func theNotePageLeavesTheBarsRoom() {
        #expect(ContentViewController.barHeight == MacLook.barPaddingTop + MacLook.barControlHeight + MacLook.barPaddingBottom)
        #expect(ContentViewController.barHeight == 60)
    }

    @Test func focusModeOnANoteHidesTheSidebar() async {
        let model = FrameModel(client: DemoEngine().client())
        #expect(!model.sidebarHidden)
        model.sidebarCollapsed = true
        #expect(model.sidebarHidden)
    }
}
#endif
