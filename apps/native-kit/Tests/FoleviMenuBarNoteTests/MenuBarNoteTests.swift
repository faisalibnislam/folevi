// The menu bar note, headless: Home's quick note under the menu bar. Save makes a note of the box (with the
// screenshots) where it says, empties the box and offers Open and Undo; Add as a task; what's written is kept per
// place; where it saves (Drafts by default, remembered per place, falling back when it's gone); the menus; the keys;
// pin. Against a scripted host.
import AppKit
import Foundation
import Testing
@testable import FoleviMenuBarNote

@MainActor
final class FakeHost: MenuBarNoteHost {
    var placeID = "acct:test"
    var shortcutLabel: String? = "⌥Space"
    var spaces: [NoteSpace] = [
        NoteSpace(id: "personal", name: "Personal", kind: "personal", canEdit: true, markName: "Sam", folders: [NoteFolder(id: "fld_a", name: "Ideas", depth: 0), NoteFolder(id: "fld_b", name: "Later", depth: 1)]),
        NoteSpace(id: "ws_1", name: "Studio", kind: "workspace", canEdit: true, imageUrl: "https://files/studio.png", markName: "Studio", folders: [NoteFolder(id: "fld_s", name: "Projects", depth: 0)]),
        NoteSpace(id: "ws_2", name: "Read only", kind: "workspace", canEdit: false, folders: []),
    ]
    var saved: [MenuNotePayload] = []
    var tasks: [(String, String)] = []
    var undone: [String] = []
    var opened: [String] = []
    var failSave: String?

    func destinations() async throws -> [NoteSpace] { spaces }
    func save(_ payload: MenuNotePayload) async throws -> String {
        if let failSave { throw MenuBarNoteError(failSave) }
        saved.append(payload)
        return "note_\(saved.count)"
    }
    func addTask(_ text: String, space: String) async throws { tasks.append((text, space)) }
    func undoSave(noteID: String) async throws { undone.append(noteID) }
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
    model.prepare()
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

@Suite("Menu bar note: Save", .serialized) @MainActor
struct SaveTests {
    @Test func savesEmptiesAndUndoes() async throws {
        let (model, host, _) = makeNote()
        model.text = "Trip ideas\nLisbon in May"
        model.images = [MenuNoteImage(mime: "image/png", name: "Shot.png", data: Data([1, 2, 3]))]
        model.choose(NoteDestination(space: "ws_1", spaceName: "Studio", folderId: "fld_s", folderName: "Projects"))
        model.perform(.save)
        await until("saved") { !model.busy && !host.saved.isEmpty }
        let p = try #require(host.saved.first)
        #expect(p.text == "Trip ideas\nLisbon in May")
        #expect(p.images.count == 1)
        #expect(p.destination.folderId == "fld_s")
        #expect(model.text.isEmpty)
        #expect(model.images.isEmpty)
        #expect(model.toast?.message == "Saved to Studio › Projects")
        let open = try #require(model.toast?.actions.first { $0.title == "Open" })
        model.perform(open)
        #expect(host.opened == ["/d/note_1"])
        model.save()
        #expect(host.saved.count == 1, "nothing to save in an empty box")
    }

    @Test func undoPutsTheWordsBack() async throws {
        let (model, host, _) = makeNote()
        model.text = "Keep this"
        model.save()
        await until("saved") { model.toast?.actions.isEmpty == false }
        let undo = try #require(model.toast?.actions.first { $0.title == "Undo" })
        model.perform(undo)
        await until("undone") { host.undone == ["note_1"] }
        #expect(model.text == "Keep this")
    }

    @Test func aFailedSaveKeepsTheWords() async {
        let host = FakeHost()
        host.failSave = "You're offline."
        let (model, _, _) = makeNote(host: host)
        model.text = "Keep me"
        model.save()
        await until("failed") { !model.busy && model.toast != nil }
        #expect(model.toast?.message == "You're offline.")
        #expect(model.text == "Keep me")
    }

    @Test func aScreenshotAloneCanBeSaved() {
        let (model, _, _) = makeNote()
        #expect(!model.canSave)
        model.images = [MenuNoteImage(mime: "image/png", name: "Shot.png", data: Data([1]))]
        #expect(model.canSave)
        #expect(!model.canAddTask)
    }

    @Test func addAsATask() async {
        let (model, host, _) = makeNote()
        model.text = "Call Sam\nabout the trip"
        model.perform(.addTask)
        await until("task") { !host.tasks.isEmpty && !model.busy }
        #expect(host.tasks.first?.0 == "Call Sam\nabout the trip")
        #expect(host.tasks.first?.1 == "personal")
        #expect(model.text.isEmpty)
        #expect(model.toast?.message == "Task added")
    }

    @Test func theWordsAreKeptPerPlace() {
        let d = UserDefaults(suiteName: "menubarnote-tests-\(UUID().uuidString)")!
        let host = FakeHost()
        let (model, _, _) = makeNote(host: host, defaults: d)
        model.text = "Half a thought"
        // The next launch finds it.
        let (again, _, _) = makeNote(host: host, defaults: d)
        #expect(again.text == "Half a thought")
        // Another place has its own box.
        host.placeID = "library"
        again.placeChanged()
        again.prepare()
        #expect(again.text.isEmpty)
    }
}

@Suite("Menu bar note: where it saves", .serialized) @MainActor
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
        #expect(model.spaces?.first { $0.id == "ws_1" }?.imageUrl == "https://files/studio.png")
    }

    @Test func thePanelMenuEndsWithFolevisItems() {
        let (model, _, _) = makeNote()
        let titles = model.panelMenu().items.map(\.title)
        #expect(titles.first == "Save Note")
        #expect(titles.contains("Add as a Task"))
        #expect(titles.last == "Open Folevi")
        #expect(titles.contains("Open as a Window"))
        #expect(titles.contains("Pin on Top"))
    }
}

@Suite("Menu bar note: keys and pin", .serialized) @MainActor
struct KeysTests {
    typealias S = MenuBarNoteModel.Shortcut

    @Test func shortcuts() {
        let a = MenuBarNoteModel.action(for:)
        #expect(a(S(key: "return", command: true)) == .save)
        #expect(a(S(key: "s", command: true)) == .save)
        #expect(a(S(key: "return", command: true, shift: true)) == .addTask)
        #expect(a(S(key: "5", command: true, shift: true)) == .screenshot)
        #expect(a(S(key: "p", command: true, shift: true)) == .pin)
        #expect(a(S(key: "d", command: true, option: true)) == .window)
        #expect(a(S(key: "c", command: true)) == nil, "⌘C is the text box's")
        #expect(a(S(key: "z", command: true)) == nil)
        #expect(a(S(key: "return")) == nil, "Return is a new line")
    }

    @Test func pin() {
        let (model, _, panel) = makeNote()
        panel.togglePin()
        #expect(model.settings.isPinned)
        panel.togglePin()
        #expect(model.settings.isPinned == false)
    }
}
