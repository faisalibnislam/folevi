// The list beside the open note in a wide window (iPhone Duo open; PhoneColumns): one stack per tab with the open
// note last, so folding shows the note with Back to its list and unfolding puts the list back beside it.
import Foundation
import Testing
import FoleviDesign
import FoleviScreens
@testable import FoleviPhone

@Suite("List beside the note") @MainActor
struct PhoneColumnsTests {
    @Test func theNotesOnTopOfAStackStartAfterTheScreensUnderThem() {
        let home = PhoneStackEntry(.home)
        let folder = PhoneStackEntry(.folder("f1"))
        let a = PhoneStackEntry(.note("a"))
        let b = PhoneStackEntry(.note("b"))
        #expect(PhoneFrameModel.noteRunStart([home]) == 1)
        #expect(PhoneFrameModel.noteRunStart([home, folder]) == 2)
        #expect(PhoneFrameModel.noteRunStart([home, folder, a]) == 2)
        #expect(PhoneFrameModel.noteRunStart([home, a, folder, a, b]) == 3)
    }

    @Test func inOneColumnScreensAreStackedAsOnTheIPhone() {
        let m = PhoneFrameModel()
        m.open(.note("a"))
        m.open(.note("b"))
        m.open(.folder("f1"))
        #expect(m.stack.map(\.route) == [.home, .note("a"), .note("b"), .folder("f1")])
    }

    @Test func inTwoColumnsANoteTakesTheOpenNotesPlace() {
        let m = PhoneFrameModel()
        m.columns = true
        m.open(.folder("f1"))
        m.open(.note("a"))
        m.open(.note("b"))
        #expect(m.stack.map(\.route) == [.home, .folder("f1"), .note("b")])
    }

    @Test func inTwoColumnsTheListMovesWhileTheNoteStaysOpen() {
        let m = PhoneFrameModel()
        m.columns = true
        m.open(.note("a"))
        m.open(.folder("f1"))
        // The note stays last: folded, it shows with Back to the folder.
        #expect(m.stack.map(\.route) == [.home, .folder("f1"), .note("a")])
        #expect(m.top == .note("a"))
        m.back()
        #expect(m.stack.map(\.route) == [.home, .folder("f1")])
    }

    @Test func theListsBackKeepsTheNoteOpen() {
        let m = PhoneFrameModel()
        m.columns = true
        m.open(.folder("f1"))
        m.open(.note("a"))
        m.setListPath([], in: .home)
        #expect(m.stack.map(\.route) == [.home, .note("a")])
    }

    @Test func theNoteColumnsOwnPathKeepsTheListUnderIt() {
        let m = PhoneFrameModel()
        // Opened in one column (a link from note a to note b), then unfolded: both notes in the note's column.
        m.open(.folder("f1"))
        m.open(.note("a"))
        m.open(.note("b"))
        m.columns = true
        m.setNotePath([], in: .home)
        #expect(m.stack.map(\.route) == [.home, .folder("f1"), .note("a")])
        // Nothing to do without a note open.
        m.back()
        m.setNotePath([PhoneStackEntry(.note("c"))], in: .home)
        #expect(m.stack.map(\.route) == [.home, .folder("f1")])
    }

    @Test func aTabsFirstScreenStillOpensItsTab() {
        let m = PhoneFrameModel()
        m.columns = true
        m.open(.note("a"))
        m.open(FrameRoute(path: "/calendar"))
        #expect(m.current == .calendar)
        #expect(m.stacks[.home]?.map(\.route) == [.home, .note("a")])
    }

    @Test func theEmptyDetailColumnShowsTheLastNoteOpened() {
        UserDefaults.standard.removeObject(forKey: PhoneFrameModel.lastNoteKey)
        let m = PhoneFrameModel()
        // Nothing opened yet: the most recent note.
        #expect(m.noteToShow(recents: ["a", "b", "c"]) == "a")
        m.open(.note("b"))
        m.back()
        #expect(m.noteToShow(recents: ["a", "b", "c"]) == "b")
        // Kept between launches.
        #expect(PhoneFrameModel().noteToShow(recents: ["a", "b", "c"]) == "b")
        // Gone from the recent notes (deleted, another place): the most recent again.
        #expect(m.noteToShow(recents: ["a", "c"]) == "a")
        #expect(m.noteToShow(recents: []) == nil)
        UserDefaults.standard.removeObject(forKey: PhoneFrameModel.lastNoteKey)
    }
}
