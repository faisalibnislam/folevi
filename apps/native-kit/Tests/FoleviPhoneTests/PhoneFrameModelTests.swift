// The iPhone's tab stacks behave as the web's (apps/web/src/components/iphone/tabStacks.ts).
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
}
