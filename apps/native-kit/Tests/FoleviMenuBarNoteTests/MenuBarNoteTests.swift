// The menu bar note, headless: the pages it shows (the empty page that makes a note in the destination, then the
// note), New, the note remembered per place, the destination (Drafts by default, remembered per place, falling back
// when it's gone), the menus, the keys and pin, against a scripted host.
import AppKit
import Foundation
import Testing
@testable import FoleviMenuBarNote

@MainActor
final class FakeHost: MenuBarNoteHost {
    var placeID = "acct:test"
    var shortcutLabel: String? = "⌥Space"
    let noteView: NSView = NSView()
    var loaded: [String] = []
    var currentPath: String? { loaded.last }
    var spaces: [NoteSpace] = [
        NoteSpace(id: "personal", name: "Personal", kind: "personal", canEdit: true, folders: [NoteFolder(id: "fld_a", name: "Ideas", depth: 0), NoteFolder(id: "fld_b", name: "Later", depth: 1)]),
        NoteSpace(id: "ws_1", name: "Studio", kind: "workspace", canEdit: true, folders: [NoteFolder(id: "fld_s", name: "Projects", depth: 0)]),
        NoteSpace(id: "ws_2", name: "Read only", kind: "workspace", canEdit: false, folders: []),
    ]
    var images: [(Data, String, String)] = []
    var opened: [String] = []
    var focused = 0

    func load(path: String) { loaded.append(path) }
    func destinations() async throws -> [NoteSpace] { spaces }
    func insertImage(_ data: Data, mime: String, name: String) async throws { images.append((data, mime, name)) }
    func focusNote() { focused += 1 }
    func flush() {}
    func openInFolevi(path: String) { opened.append(path) }
    func appMenuItems() -> [NSMenuItem] { [NSMenuItem(title: "Open Folevi", action: nil, keyEquivalent: "")] }
}

/// The model holds its host weakly (the app's lives for the whole run); the tests keep theirs here.
@MainActor var keptHosts: [FakeHost] = []

@MainActor
func makeNote(host: FakeHost = FakeHost(), defaults: UserDefaults? = nil) -> (MenuBarNoteModel, FakeHost, PanelController) {
    let d = defaults ?? UserDefaults(suiteName: "menubarnote-tests-\(UUID().uuidString)")!
    let model = MenuBarNoteModel(settings: MenuBarNoteSettings(defaults: d))
    model.host = host
    keptHosts.append(host)
    let panel = PanelController(model: model)
    model.panel = panel
    return (model, host, panel)
}

@MainActor
func until(_ what: String, timeout: Duration = .seconds(5), _ condition: () -> Bool) async {
    let end = ContinuousClock.now + timeout
    while !condition() {
        if ContinuousClock.now > end { Issue.record("Timed out: \(what)"); return }
        try? await Task.sleep(for: .milliseconds(20))
    }
}

@Suite("Menu bar note: pages")
struct PathTests {
    @Test func composerPathCarriesTheDestination() {
        #expect(MenuBarNoteModel.composerPath(.personalDrafts) == "/float/new?panel=1&space=personal")
        #expect(MenuBarNoteModel.composerPath(NoteDestination(space: "ws_1", spaceName: "Studio", folderId: "fld_s", folderName: "Projects")) == "/float/new?panel=1&space=ws_1&folder=fld_s")
    }

    @Test func notePathsAndBack() {
        #expect(MenuBarNoteModel.notePath("01JABC") == "/float/01JABC?panel=1")
        #expect(MenuBarNoteModel.noteID(inPath: "/float/01JABC?panel=1&new=typed") == "01JABC")
        #expect(MenuBarNoteModel.noteID(inPath: "/float/new?panel=1&space=personal") == nil)
        #expect(MenuBarNoteModel.noteID(inPath: "/d/01JABC") == nil)
        #expect(MenuBarNoteModel.noteID(inPath: "/float/") == nil)
    }
}

@Suite("Menu bar note: the note", .serialized) @MainActor
struct NoteTests {
    @Test func startsOnTheEmptyPageInDrafts() {
        let (model, host, _) = makeNote()
        model.prepareNote()
        #expect(host.loaded == ["/float/new?panel=1&space=personal"])
        // Shown again: nothing reloads.
        model.prepareNote()
        #expect(host.loaded.count == 1)
    }

    @Test func typingMakesTheNoteItKeeps() {
        let d = UserDefaults(suiteName: "menubarnote-tests-\(UUID().uuidString)")!
        let (model, host, _) = makeNote(defaults: d)
        model.prepareNote()
        // The page made a note on the first keystroke and moved to it.
        host.loaded.append("/float/01NOTE?panel=1&new=typed")
        model.pathChanged("/float/01NOTE?panel=1&new=typed")
        #expect(model.noteID == "01NOTE")
        model.prepareNote()
        #expect(host.loaded.count == 2, "the note is showing already")
        // Next launch: the same note.
        let (again, host2, _) = makeNote(defaults: d)
        again.prepareNote()
        #expect(host2.loaded == ["/float/01NOTE?panel=1"])
    }

    @Test func newStartsAnotherInTheDestination() {
        let (model, host, _) = makeNote()
        model.pathChanged("/float/01NOTE?panel=1")
        model.choose(NoteDestination(space: "ws_1", spaceName: "Studio", folderId: "fld_s", folderName: "Projects"))
        model.perform(.newNote)
        #expect(model.noteID == nil)
        #expect(host.loaded.last == "/float/new?panel=1&space=ws_1&folder=fld_s")
        #expect(host.focused > 0)
    }

    @Test func eachPlaceHasItsOwnNote() {
        let (model, host, _) = makeNote()
        model.pathChanged("/float/01A?panel=1")
        host.placeID = "library"
        #expect(model.noteID == nil)
        model.pathChanged("/float/01B?panel=1")
        host.placeID = "acct:test"
        #expect(model.noteID == "01A")
    }

    @Test func sendToFoleviOpensItAndStartsANewOne() {
        let (model, host, _) = makeNote()
        model.perform(.sendToFolevi)
        #expect(host.opened.isEmpty, "nothing to send before a note is made")
        model.pathChanged("/float/01A?panel=1")
        model.perform(.sendToFolevi)
        #expect(host.opened == ["/d/01A"])
        #expect(model.noteID == nil)
        #expect(host.loaded.last == "/float/new?panel=1&space=personal")
    }

    @Test func openInFolevi() {
        let (model, host, _) = makeNote()
        model.perform(.openInFolevi)
        #expect(host.opened.isEmpty, "no note yet")
        model.pathChanged("/float/01A?panel=1")
        model.perform(.openInFolevi)
        #expect(host.opened == ["/d/01A"])
    }
}

@Suite("Menu bar note: where new notes go", .serialized) @MainActor
struct DestinationTests {
    @Test func draftsByDefault() {
        let (model, _, _) = makeNote()
        #expect(model.destination == .personalDrafts)
        #expect(model.destination.label == "Personal › Drafts")
    }

    @Test func rememberedPerPlace() {
        let d = UserDefaults(suiteName: "menubarnote-tests-\(UUID().uuidString)")!
        let host = FakeHost()
        let (model, _, _) = makeNote(host: host, defaults: d)
        model.choose(NoteDestination(space: "personal", spaceName: "Personal", folderId: "fld_b", folderName: "Later"))
        #expect(model.destination.label == "Personal › Later")
        host.placeID = "library"
        #expect(model.destination == .personalDrafts)
        host.placeID = "acct:test"
        let (again, _, _) = makeNote(host: host, defaults: d)
        #expect(again.destination.folderId == "fld_b")
    }

    @Test func choosingMovesTheEmptyPageNotTheNote() {
        let (model, host, _) = makeNote()
        model.choose(NoteDestination(space: "ws_1", spaceName: "Studio"))
        #expect(host.loaded.last == "/float/new?panel=1&space=ws_1")
        model.pathChanged("/float/01A?panel=1")
        let before = host.loaded.count
        model.choose(.personalDrafts)
        #expect(host.loaded.count == before, "a note already made stays where it is")
    }

    @Test func aGoneFolderFallsBack() async {
        let (model, host, _) = makeNote()
        model.choose(NoteDestination(space: "personal", spaceName: "Personal", folderId: "fld_gone", folderName: "Old"))
        model.refreshDestinations()
        await until("listed") { model.spaces != nil }
        #expect(model.destination == .personalDrafts)
        model.choose(NoteDestination(space: "ws_2", spaceName: "Read only"))
        #expect(model.destination == .personalDrafts)
        host.spaces[0].folders[0].name = "Ideas 2"
        model.choose(NoteDestination(space: "personal", spaceName: "Personal", folderId: "fld_a", folderName: "Ideas"))
        model.refreshDestinations()
        await until("relisted") { model.destination.folderName == "Ideas 2" }
    }

    @Test func theMenuListsSpacesAndFolders() async {
        let (model, _, _) = makeNote()
        model.refreshDestinations()
        await until("listed") { model.spaces != nil }
        let menu = model.destinationMenu()
        let titles = menu.items.map(\.title)
        #expect(titles.contains("Ideas"))
        #expect(titles.contains("Projects"))
        #expect(menu.items.first { $0.title == "Later" }?.indentationLevel == 1)
        #expect(menu.items.first { $0.title == "Drafts" }?.state == .on)
        #expect(menu.items.last { $0.title == "Drafts" }?.isEnabled == false)
    }

    @Test func thePanelMenuEndsWithFolevisItems() {
        let (model, _, _) = makeNote()
        let titles = model.panelMenu().items.map(\.title)
        #expect(titles.first == "Send to Folevi")
        #expect(titles.contains("New Note Here"))
        #expect(titles.last == "Open Folevi")
        #expect(titles.contains("Open as a Window"))
        #expect(titles.contains("Pin on Top"))
        #expect(!titles.contains("Save to Note"))
    }
}

@Suite("Menu bar note: keys and pin", .serialized) @MainActor
struct KeysTests {
    typealias S = MenuBarNoteModel.Shortcut

    @Test func shortcuts() {
        let a = MenuBarNoteModel.action(for:)
        #expect(a(S(key: "n", command: true)) == .newNote)
        #expect(a(S(key: "5", command: true, shift: true)) == .screenshot)
        #expect(a(S(key: "p", command: true, shift: true)) == .pin)
        #expect(a(S(key: "d", command: true, option: true)) == .window)
        #expect(a(S(key: "o", command: true, shift: true)) == .openInFolevi)
        #expect(a(S(key: "return", command: true)) == .sendToFolevi)
        #expect(a(S(key: "b", command: true)) == nil, "⌘B is the editor's")
        #expect(a(S(key: "c", command: true)) == nil)
        #expect(a(S(key: "n")) == nil)
    }

    @Test func pin() {
        let (model, _, panel) = makeNote()
        panel.togglePin()
        #expect(model.settings.isPinned)
        panel.togglePin()
        #expect(model.settings.isPinned == false)
    }
}
