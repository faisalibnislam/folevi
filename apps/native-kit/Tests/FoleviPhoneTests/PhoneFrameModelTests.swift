// The iPhone's tab stacks behave as the web's (apps/web/src/components/iphone/tabStacks.ts).
import Foundation
import Testing
import FoleviDesign
import FoleviScreens
@testable import FoleviPhone

@Suite("Tab stacks") @MainActor
struct PhoneFrameModelTests {
    @Test func eachTabKeepsItsOwnStack() {
        let m = PhoneFrameModel()
        m.open(.folder("f1"))
        m.open(.note("n1"))
        m.pick(.tasks)
        #expect(m.current == .tasks)
        #expect(m.top == FrameRoute(path: "/tasks/today"))
        m.pick(.home)
        #expect(m.top == .note("n1"))
        #expect(m.stack.map(\.route) == [.home, .folder("f1"), .note("n1")])
    }

    @Test func openingAnotherTabsFirstScreenSwitchesToIt() {
        let m = PhoneFrameModel()
        m.open(.note("n1"))
        m.open(FrameRoute(path: "/calendar"))
        #expect(m.current == .calendar)
        #expect(m.stack.count == 1)
        // Home's own stack is kept.
        #expect(m.stacks[.home]?.map(\.route) == [.home, .note("n1")])
    }

    @Test func homeFromDeeperInHomeGoesBackToItsStart() {
        let m = PhoneFrameModel()
        m.open(.folder("f1"))
        m.open(.home)
        #expect(m.stack.map(\.route) == [.home])
    }

    @Test func tasksViewsArePushedInTheirOwnTab() {
        let m = PhoneFrameModel()
        m.pick(.tasks)
        m.open(.note("n1"))
        m.open(FrameRoute(path: "/tasks/completed"))
        #expect(m.current == .tasks)
        #expect(m.stack.count == 3)
    }

    @Test func tappingTheTabOnShowPopsToRootThenScrollsToTop() {
        let m = PhoneFrameModel()
        m.open(.folder("f1"))
        m.pick(.home)
        #expect(m.stack.map(\.route) == [.home])
        let before = m.scrollToTop
        m.pick(.home)
        #expect(m.scrollToTop == before + 1)
    }

    @Test func backStaysInTheTabAndRemembersScroll() {
        let m = PhoneFrameModel()
        m.rememberScroll(320)
        m.open(.folder("f1"))
        m.back()
        #expect(m.top == .home)
        #expect(m.stack.last?.scroll == 320)
        m.back()
        #expect(m.stack.count == 1)
    }

    @Test func aSavedFrameComesBackWhereItWas() {
        let m = PhoneFrameModel()
        m.open(FrameRoute(path: "/folders/f1"))
        m.open(FrameRoute(path: "/d/n1"))
        m.rememberScroll(240)
        m.pick(.tasks)
        m.open(FrameRoute(path: "/tasks/completed"))
        let data = m.snapshotData!
        let back = PhoneFrameModel()
        #expect(back.restore(data: data))
        #expect(back.current == .tasks)
        #expect(back.stacks[.home]?.map(\.route) == [.home, .folder("f1"), .note("n1")])
        #expect(back.stacks[.home]?.last?.scroll == 240)
        #expect(back.stack.map(\.route.path) == ["/tasks/completed"])
    }

    @Test func aDamagedSnapshotStartsTheTabsAgain() {
        let m = PhoneFrameModel()
        m.restore(PhoneFrameModel.Snapshot(current: "nowhere", stacks: ["home": [.init(path: "/d/n1", scroll: 0)]]))
        #expect(m.current == .home)
        #expect(m.stacks[.home]?.map(\.route) == [.home])
        #expect(!m.restore(data: Data("not json".utf8)))
    }
}
