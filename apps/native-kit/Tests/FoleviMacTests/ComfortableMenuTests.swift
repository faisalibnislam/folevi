// Every pop-up and context menu is comfortable (the owner, 2026-11-18: "context menu looks too compressed"): a
// row 32 pt tall, as the note's own menu, with its icon shown, and Folevi's icon for a row built without one.
#if os(macOS)
import AppKit
import Testing
import FoleviDesign
@testable import FoleviMac

@MainActor @Suite("Comfortable menus")
struct ComfortableMenuTests {
    /// What a menu's height grows by for each row added.
    static func rowHeight(_ make: (Int) -> NSMenu) -> CGFloat { (make(10).size.height - make(5).size.height) / 5 }

    @Test func aBuiltMenusRowsAre32Points() {
        let height = Self.rowHeight { n in
            NativeMenu.build((0..<n).map { WebMenuEntry(.item("Row \($0)", icon: .archive)) })
        }
        #expect(height == NativeMenu.rowHeight)
        #expect(NativeMenu.rowHeight == 32)
    }

    @Test func aPlainSystemMenuIs24UntilItIsMadeComfortable() {
        let plain: (Int) -> NSMenu = { n in
            let menu = NSMenu()
            for i in 0..<n { menu.addItem(NSMenuItem(title: "Row \(i)", action: nil, keyEquivalent: "")) }
            return menu
        }
        #expect(Self.rowHeight(plain) == 24)
        #expect(Self.rowHeight { n in
            let menu = plain(n)
            NativeMenu.comfortable(menu)
            return menu
        } == 32)
    }

    @Test func rowsShowTheirIconsAndGetOneWhenTheyHadNone() {
        let menu = NSMenu()
        for title in ["Close Tab", "Open in New Window", "Something With No Icon"] { menu.addItem(NSMenuItem(title: title, action: nil, keyEquivalent: "")) }
        menu.addItem(.separator())
        let sub = NSMenuItem(title: "More", action: nil, keyEquivalent: "")
        sub.submenu = NSMenu()
        sub.submenu?.addItem(NSMenuItem(title: "Rename…", action: nil, keyEquivalent: ""))
        menu.addItem(sub)
        NativeMenu.comfortable(menu)
        #expect(menu.items[0].image != nil)
        #expect(menu.items[1].image != nil)
        #expect(menu.items[2].image == nil)
        // A submenu's rows too, and the words they say are kept.
        #expect(sub.submenu?.items[0].image != nil)
        #expect(sub.submenu?.items[0].title == "Rename…")
        if #available(macOS 27.0, *) {
            // (macOS 27 hides a menu's pictures unless a row asks for its own.)
            #expect(menu.items[0].preferredImageVisibility == .visible)
        }
        // The separator is left alone.
        #expect(menu.items[3].isSeparatorItem && menu.items[3].attributedTitle == nil)
    }

    @Test func aDestructiveRowKeepsItsRed() {
        let menu = NativeMenu.build([WebMenuEntry(.item("Move to Trash", icon: .trash, danger: true))])
        let title = menu.items[0].attributedTitle
        #expect(title?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor == NSColor.systemRed)
    }
}
#endif
