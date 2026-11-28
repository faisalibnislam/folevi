// The menu bar's quick notes, headless: a dot as a Folevi note (title, body, images), Save to note and its Undo
// against a scripted host, the destination (remembered per place, falling back when it's gone), the panel's keys,
// and the store (seeding, the cap, images kept with the dot).
import AppKit
import Foundation
import Testing
@testable import FoleviQuickNotes

@MainActor
final class FakeHost: QuickNotesHost {
    var placeID = "acct:test"
    var placeName: String?
    var shortcutLabel: String? = "⌥Space"
    var spaces: [QuickNoteSpace] = [
        QuickNoteSpace(id: "personal", name: "Personal", kind: "personal", canEdit: true, folders: [QuickNoteFolder(id: "fld_a", name: "Ideas", depth: 0), QuickNoteFolder(id: "fld_b", name: "Later", depth: 1)]),
        QuickNoteSpace(id: "ws_1", name: "Studio", kind: "workspace", canEdit: true, folders: [QuickNoteFolder(id: "fld_s", name: "Projects", depth: 0)]),
        QuickNoteSpace(id: "ws_2", name: "Read only", kind: "workspace", canEdit: false, folders: []),
    ]
    var saved: [QuickNotePayload] = []
    var undone: [String] = []
    var failSave: String?
    var opened: [String] = []

    func destinations() async throws -> [QuickNoteSpace] { spaces }
    func save(_ payload: QuickNotePayload) async throws -> String {
        if let failSave { throw QuickNotesHostError(failSave) }
        saved.append(payload)
        return "note_\(saved.count)"
    }
    func undoSave(noteID: String) async throws { undone.append(noteID) }
    func openNote(_ id: String) { opened.append(id) }
    func appMenuItems() -> [NSMenuItem] { [NSMenuItem(title: "Open Folevi", action: nil, keyEquivalent: "")] }
}

@MainActor
func makeModel(host: FakeHost = FakeHost(), defaults: UserDefaults? = nil) -> (QuickNotesModel, FakeHost, PanelController) {
    let d = defaults ?? UserDefaults(suiteName: "quicknotes-tests-\(UUID().uuidString)")!
    let model = QuickNotesModel(settings: QuickNotesSettings(defaults: d), folder: nil)
    model.host = host
    model.start()
    keptHosts.append(host)
    let panel = PanelController(model: model)
    model.panel = panel
    return (model, host, panel)
}

/// The model holds its host weakly (the app's lives for the whole run); the tests keep theirs here.
@MainActor var keptHosts: [FakeHost] = []

@MainActor
func until(_ what: String, timeout: Duration = .seconds(5), _ condition: () -> Bool) async {
    let end = ContinuousClock.now + timeout
    while !condition() {
        if ContinuousClock.now > end { Issue.record("Timed out: \(what)"); return }
        try? await Task.sleep(for: .milliseconds(20))
    }
}

@Suite("Quick notes: a dot as a note")
struct ExportTests {
    @Test func firstLineIsTheTitle() {
        #expect(QuickNoteExport.split("Groceries\n- milk\n- eggs") == .init(title: "Groceries", body: "- milk\n- eggs"))
        #expect(QuickNoteExport.split("\n\n# Plan for **Monday**\n\nCall Sam") == .init(title: "Plan for Monday", body: "Call Sam"))
        #expect(QuickNoteExport.split("- [ ] Book the [venue](https://example.com)\n- [x] Done") == .init(title: "Book the venue", body: "- [x] Done"))
        #expect(QuickNoteExport.split("Only a title") == .init(title: "Only a title", body: ""))
    }

    @Test func noTitleForAnImageOrAParagraph() {
        let image = "![Screenshot](\(QuickNoteLink.attachmentURL(UUID())))\nafter"
        #expect(QuickNoteExport.split(image).title == "")
        #expect(QuickNoteExport.split(image).body.hasPrefix("![Screenshot]"))
        let long = String(repeating: "word ", count: 40)
        #expect(QuickNoteExport.split(long + "\nnext").title == "")
        #expect(QuickNoteExport.split("   \n").title == "")
    }

    @Test func imagesAreRenamedOnceEach() {
        let a = UUID(), b = UUID()
        let md = "![one](\(QuickNoteLink.attachmentURL(a)))\ntext\n![two](\(QuickNoteLink.attachmentURL(b)))\n![again](\(QuickNoteLink.attachmentURL(a)))"
        let r = QuickNoteExport.renameImages(md)
        #expect(r.markdown == "![one](quick-note-image-1)\ntext\n![two](quick-note-image-2)\n![again](quick-note-image-1)")
        #expect(r.ids.map(\.ref) == ["quick-note-image-1", "quick-note-image-2"])
        #expect(r.ids.map(\.id) == [a, b])
    }
}

@Suite("Quick notes: Save to note", .serialized) @MainActor
struct SaveTests {
    @Test func savesClearsAndUndoes() async throws {
        let (model, host, _) = makeModel()
        let id = try #require(model.activeDotID)
        model.append("Trip ideas\n- Lisbon\n- **Porto**", to: id)
        model.choose(QuickNoteDestination(space: "ws_1", spaceName: "Studio", folderId: "fld_s", folderName: "Projects"))
        model.saveToNote()
        await until("saved") { !model.saving && !host.saved.isEmpty }
        let p = try #require(host.saved.first)
        #expect(p.title == "Trip ideas")
        #expect(p.markdown.contains("Lisbon"))
        #expect(p.markdown.contains("**Porto**"))
        #expect(p.destination.space == "ws_1")
        #expect(p.destination.folderId == "fld_s")
        #expect(model.editor.markdown(of: id).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        #expect(model.toast?.message == "Saved to Studio › Projects")
        // Undo: the text comes back and the note goes to the Trash.
        let undo = try #require(model.toast?.actions.first { $0.title == "Undo" })
        model.performToastAction(undo)
        await until("undone") { host.undone == ["note_1"] }
        #expect(model.editor.markdown(of: id).contains("Lisbon"))
    }

    @Test func openGoesToTheNote() async throws {
        let (model, host, _) = makeModel()
        model.append("A thought", to: model.activeDotID)
        model.saveToNote()
        await until("saved") { model.toast?.actions.isEmpty == false }
        let open = try #require(model.toast?.actions.first { $0.title == "Open" })
        model.performToastAction(open)
        #expect(host.opened == ["note_1"])
    }

    @Test func aFailedSaveKeepsTheText() async throws {
        let host = FakeHost()
        host.failSave = "You're offline."
        let (model, _, _) = makeModel(host: host)
        let id = try #require(model.activeDotID)
        model.append("Keep me", to: id)
        model.saveToNote()
        await until("failed") { !model.saving && model.toast != nil }
        #expect(model.toast?.message == "You're offline.")
        #expect(model.editor.markdown(of: id).contains("Keep me"))
    }

    @Test func anEmptyDotIsNotSaved() async throws {
        let (model, host, _) = makeModel()
        model.saveToNote()
        #expect(model.toast?.message == "Write something first.")
        #expect(host.saved.isEmpty)
    }

    @Test func imagesGoWithTheNote() async throws {
        let (model, host, _) = makeModel()
        let id = try #require(model.activeDotID)
        let png = try #require(Self.png())
        model.editor.show(dotID: id, animated: false, focus: false)
        let fragment = try #require(model.editor.imageFragment(data: png, suggestedName: "Shot", rich: true, dotID: id))
        model.append("Bug report", to: id)
        model.editor.insert(fragment: fragment, into: id, atEnd: true)
        model.editor.flushAll()
        model.saveToNote()
        await until("saved") { !host.saved.isEmpty }
        let p = try #require(host.saved.first)
        #expect(p.title == "Bug report")
        #expect(p.markdown.contains("](quick-note-image-1)"))
        #expect(!p.markdown.contains("folevi-quicknote-image"))
        #expect(p.images.count == 1)
        #expect(p.images.first?.mime == "image/png")
        #expect(p.images.first?.data == png)
    }

    static func png() -> Data? {
        let image = NSImage(size: NSSize(width: 40, height: 30), flipped: false) { r in
            NSColor.systemTeal.setFill()
            r.fill()
            return true
        }
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }
}

@Suite("Quick notes: where a save goes", .serialized) @MainActor
struct DestinationTests {
    @Test func personalDraftsFirst() {
        let (model, _, _) = makeModel()
        #expect(model.destination == .personalDrafts)
        #expect(model.destination.label == "Personal › Drafts")
    }

    @Test func rememberedPerPlace() async {
        let d = UserDefaults(suiteName: "quicknotes-tests-\(UUID().uuidString)")!
        let host = FakeHost()
        let (model, _, _) = makeModel(host: host, defaults: d)
        model.choose(QuickNoteDestination(space: "personal", spaceName: "Personal", folderId: "fld_b", folderName: "Later"))
        #expect(model.destination.label == "Personal › Later")
        // Another place has its own.
        host.placeID = "library"
        #expect(model.destination == .personalDrafts)
        host.placeID = "acct:test"
        // A new launch reads it back.
        let (again, _, _) = makeModel(host: host, defaults: d)
        #expect(again.destination.folderId == "fld_b")
    }

    @Test func aGoneFolderFallsBack() async {
        let (model, host, _) = makeModel()
        model.choose(QuickNoteDestination(space: "personal", spaceName: "Personal", folderId: "fld_gone", folderName: "Old"))
        model.refreshDestinations()
        await until("listed") { model.spaces != nil }
        #expect(model.destination == .personalDrafts)
        // A read-only workspace can't be the destination either.
        model.choose(QuickNoteDestination(space: "ws_2", spaceName: "Read only"))
        #expect(model.destination == .personalDrafts)
        // Renamed folders show their new name.
        host.spaces[0].folders[0].name = "Ideas 2"
        model.choose(QuickNoteDestination(space: "personal", spaceName: "Personal", folderId: "fld_a", folderName: "Ideas"))
        model.refreshDestinations()
        await until("relisted") { model.destination.folderName == "Ideas 2" }
    }

    @Test func theMenuListsSpacesAndFolders() async {
        let (model, _, _) = makeModel()
        model.refreshDestinations()
        await until("listed") { model.spaces != nil }
        let menu = model.destinationMenu()
        let titles = menu.items.map(\.title)
        #expect(titles.contains("Ideas"))
        #expect(titles.contains("Projects"))
        #expect(menu.items.first { $0.title == "Later" }?.indentationLevel == 1)
        #expect(menu.items.first { $0.title == "Drafts" }?.state == .on)
        let readOnlyDrafts = menu.items.last { $0.title == "Drafts" }
        #expect(readOnlyDrafts?.isEnabled == false)
    }

    @Test func thePanelMenuEndsWithFolevisItems() {
        let (model, _, _) = makeModel()
        let titles = model.panelMenu().items.map(\.title)
        #expect(titles.first == "Save to Note")
        #expect(titles.last == "Open Folevi")
        #expect(titles.contains("Open as a Window"))
        #expect(titles.contains("Pin on Top"))
    }
}

@Suite("Quick notes: keys and dots", .serialized) @MainActor
struct KeysAndDotsTests {
    typealias S = QuickNotesModel.Shortcut

    @Test func shortcuts() {
        let a = QuickNotesModel.action(for:)
        #expect(a(S(key: "1", command: true)) == .dot(0))
        #expect(a(S(key: "9", command: true)) == .dot(8))
        #expect(a(S(key: "t", command: true, shift: true)) == .toggleRich)
        #expect(a(S(key: "5", command: true, shift: true)) == .screenshot)
        #expect(a(S(key: "p", command: true, shift: true)) == .pin)
        #expect(a(S(key: "d", command: true, option: true)) == .window)
        #expect(a(S(key: "s", command: true)) == .save)
        #expect(a(S(key: "]", command: true, option: true)) == .moveDotRight)
        #expect(a(S(key: "1")) == nil)
        #expect(a(S(key: "c", command: true)) == nil, "⌘C stays Folevi's Copy")
        #expect(a(S(key: "v", command: true)) == nil)
        #expect(a(S(key: "z", command: true)) == nil)
    }

    @Test func sevenDotsAtFirstAndSwitching() {
        let (model, _, _) = makeModel()
        #expect(model.dots.count == 7)
        model.perform(.dot(2))
        #expect(model.activeIndex == 2)
        model.perform(.nextDot)
        #expect(model.activeIndex == 3)
        model.perform(.dot(20))
        #expect(model.activeIndex == 3)
    }

    @Test func addRenameMoveDelete() async throws {
        let (model, _, _) = makeModel()
        model.addDot()
        #expect(model.dots.count == 8)
        let id = try #require(model.activeDotID)
        model.renameDot(id, to: "  Groceries  ")
        #expect(model.activeDot?.displayName == "Groceries")
        model.moveActiveDot(by: -1)
        #expect(model.activeIndex == 6)
        model.deleteDot(id)
        #expect(model.dots.count == 7)
        let undo = try #require(model.toast?.actions.first)
        model.performToastAction(undo)
        #expect(model.dots.count == 8)
        #expect(model.dots.contains { $0.name == "Groceries" })
    }

    @Test func capAtTwenty() {
        let (model, _, _) = makeModel()
        for _ in 0..<30 { model.addDot() }
        #expect(model.dots.count == NoteStore.hardCap)
    }

    @Test func richAndMarkdownKeepTheText() throws {
        let (model, _, _) = makeModel()
        let id = try #require(model.activeDotID)
        model.append("**bold** and - [ ] task", to: id)
        model.toggleRichText(id)
        #expect(model.activeDot?.isRichText == false)
        #expect(model.editor.markdown(of: id).contains("**bold**"))
        model.toggleRichText(id)
        #expect(model.activeDot?.isRichText == true)
        #expect(model.editor.markdown(of: id).contains("**bold**"))
    }

    @Test func pinAndWindowState() {
        let (model, _, panel) = makeModel()
        #expect(model.settings.isPinned == false)
        panel.togglePin()
        #expect(model.settings.isPinned)
        panel.togglePin()
        #expect(model.settings.isPinned == false)
    }

    @Test func shortcutLabelFromTheHost() {
        let (model, _, _) = makeModel()
        #expect(model.host?.shortcutLabel == "⌥Space")
    }
}
