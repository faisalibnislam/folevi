// The iPhone's native look (docs/IOS_REBUILD_PLAN.md, "The iPhone's native look"): Apple's text sizes for the web's,
// menus built by the code that built Folevi's drawn ones, and search as a tab of its own.
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
import FoleviScreens
@testable import FoleviPhone

@Suite("iPhone native look") @MainActor
struct PhoneNativeLookTests {
    @Test func webSizesBecomeApplesTextSizes() {
        #expect(NativeChrome.appleSize(17) == 17)
        #expect(NativeChrome.appleSize(14) == 15)
        #expect(NativeChrome.appleSize(18) == 17)
        #expect(NativeChrome.appleSize(24) == 22)
        #expect(NativeChrome.appleSize(38) == 34)
        #expect(NativeChrome.appleSize(9) == 11)
        // Every one of them is a text style, so it follows Dynamic Type.
        for size: CGFloat in [11, 12, 13, 15, 16, 17, 20, 22, 28, 34] {
            #expect(NativeChrome.textStyle(size) != nil, "\(size)")
        }
    }

    @Test func interfaceTextIsTheSystemFontAtAppleSizesNotesKeepTheirs() {
        let chrome = PhoneNativeLook.chrome
        let ui = chrome.text(WebTextStyle(size: 14, leading: 20, weight: 500))
        #expect(ui.family == .system)
        #expect(ui.size == 15)
        #expect(ui.weight == 500)
        // Code keeps its own face.
        #expect(chrome.text(WebTextStyle(family: .mono, size: 13, leading: 18)).family == .mono)
        // The Mac's chrome keeps its four fixed sizes.
        let mac = NativeChrome(title: 22, title3: 15, body: 13, small: 11, accent: .black, onAccent: .white, hover: .gray)
        #expect(mac.text(WebTextStyle(size: 14, leading: 20)).size == 13)
    }

    @Test func aMenuBuiltForTheDrawnMenusFillsANativeOne() {
        let menus = PhoneMenus()
        var ran = false
        let rows = menus.entries {
            menus.show([
                PhoneMenuEntry(.item("Rename", icon: .pencil)) { ran = true },
                PhoneMenuEntry(.separator(1)),
                PhoneMenuEntry(.item("Delete", icon: .trash, danger: true)),
            ], from: .zero)
        }
        #expect(rows.map(\.id) == ["Rename", "sep:1", "Delete"])
        // Nothing was shown while the rows were taken.
        #expect(menus.open == nil)
        rows[0].action()
        #expect(ran)
        // Outside `entries` it shows Folevi's menu as before.
        menus.show(rows, from: .zero)
        #expect(menus.open != nil)
    }

    @Test func searchIsATabOfItsOwnOverTheTabItCameFrom() {
        let m = PhoneFrameModel()
        m.open(.folder("f1"))
        m.open(.search("trip"))
        #expect(m.searching)
        #expect(m.top == .search("trip"))
        // Home's stack is untouched under it.
        #expect(m.stack.map(\.route) == [.home, .folder("f1")])
        // A note opened from search opens in that tab, and search closes.
        m.open(.note("n1"))
        #expect(!m.searching)
        #expect(m.stack.map(\.route) == [.home, .folder("f1"), .note("n1")])
        // Back from search goes to where it was opened.
        m.openSearch()
        m.back()
        #expect(!m.searching)
        #expect(m.top == .note("n1"))
        // Another tab tapped while searching shows that tab.
        m.openSearch()
        m.pick(.tasks)
        #expect(!m.searching)
        #expect(m.current == .tasks)
    }
}
