// The iPhone note's "…" menu (NoteMenuPlan, the web's DocumentView useDocumentActions in noteMenu.tsx's groups):
// what a note in Trash, a template, a page shared to read and a note with everything offer, and an older page
// without `editor.state`'s `menu`; then Select mode's Add tag, and Reviews of one note.
import Foundation
import Testing
@testable import FoleviEngine
@testable import FoleviScreens

@Suite("Note menu")
struct NoteMenuPlanTests {
    func meta(kind: String = "document", access: String = "full", canEdit: Bool = true, inTrash: Bool = false, archived: Bool = false, starred: Bool = false, mine: Bool = true) -> NoteMeta {
        var m = Fixtures.decode(NoteMeta.self, "view.note.meta.json")
        m.found = true
        m.kind = kind
        m.access = access
        m.canEdit = canEdit
        m.inTrash = inTrash
        m.archived = archived
        m.starred = starred
        m.space = mine ? "personal" : nil
        return m
    }

    func menu(_ actions: [NoteMenuAction], related: Bool = false, editors: Bool = false, images: Int = 0, reading: Bool = false) -> NoteMenuState {
        NoteMenuState(actions: actions, related: related, showingEditors: editors, readImages: images, readingImages: reading)
    }

    /// Each row as its words, a submenu as "Name: item, item".
    func words(_ sections: [[NoteMenuRow]]) -> [[String]] {
        sections.map { rows in
            rows.map { row in
                switch row {
                case .item(let i): i.title
                case .submenu(let g, let items): "\(g.rawValue): \(items.map(\.title).joined(separator: ", "))"
                }
            }
        }
    }

    @Test func aNoteInTrashOffersRestoreAndDeletePermanently() {
        let sections = NoteMenuPlan.sections(.init(meta: meta(inTrash: true), menu: menu([.delete, .history, .move]), reviewCards: 3, graph: true))
        #expect(words(sections) == [["Restore from Trash", "Delete permanently…"]])
        #expect(NoteMenuItem.deleteForever.danger)
    }

    @Test func everythingTheWebOffersInItsOrderAndGroups() {
        let all: [NoteMenuAction] = [.share, .move, .copyTo, .duplicate, .export, .history, .present, .print, .find, .delete, .moveToVault, .saveAsTemplate, .showEditors, .readImages]
        let sections = NoteMenuPlan.sections(.init(meta: meta(starred: true), menu: menu(all, related: true, images: 2), reviewCards: 3, graph: true))
        #expect(words(sections) == [
            ["Remove bookmark", "Info", "Find and replace…", "Review 3 cards in this note", "Make text in images searchable"],
            ["Connections: Related notes, Foli DNA", "History: Version history…, Show editors", "Move and copy: Move…, Copy to…, Duplicate, Move to the Vault…", "Share and export: Export…, Present, Print…, Save as template"],
            ["Archive", "Move to Trash"],
        ])
        #expect(NoteMenuItem.readImages(count: 2, busy: false).description == "Foli AI reads 2 images. Uses AI credits.")
        #expect(NoteMenuItem.readImages(count: 1, busy: true).disabled)
        #expect(NoteMenuItem.review(cards: 0).title == "Review this note’s cards")
        #expect(NoteMenuItem.review(cards: 1).title == "Review 1 card in this note")
        #expect(NoteMenuItem.showEditors(on: true).title == "Hide editors")
    }

    @Test func aTemplateHasNoFoliDnaOrSaveAsTemplate() {
        // (The page leaves Save as template and Move out for a template; the plan leaves Foli DNA out itself.)
        let sections = NoteMenuPlan.sections(.init(meta: meta(kind: "template"), menu: menu([.copyTo, .duplicate, .export, .history, .present, .print, .find, .delete]), reviewCards: nil, graph: true))
        let flat = words(sections).flatMap { $0 }.joined(separator: " | ")
        #expect(!flat.contains("Foli DNA"))
        #expect(!flat.contains("Save as template"))
        #expect(flat.contains("Move to Trash"))
        // Move… is shown but not offered, as the web's.
        #expect(sections[1].contains(.submenu(.moveCopy, [.move(enabled: false), .copyTo, .duplicate])))
    }

    @Test func aPageSharedToReadOffersWhatItCan() {
        let sections = NoteMenuPlan.sections(.init(meta: meta(access: "read", canEdit: false, mine: false), menu: menu([.export, .present, .print, .find, .saveAsTemplate]), reviewCards: nil, graph: false))
        #expect(words(sections) == [["Info", "Find in note…"], ["Share and export: Export…, Present, Print…, Save as template"]])
    }

    @Test func aGroupOfOneShowsItsItemInItsPlace() {
        let sections = NoteMenuPlan.sections(.init(meta: meta(), menu: menu([.history, .export, .find, .move]), reviewCards: nil, graph: false))
        #expect(words(sections) == [["Bookmark", "Info", "Find and replace…"], ["Version history…", "Move…", "Export…"], ["Archive", "Move to Trash"]])
    }

    @Test func anOlderPageGetsWhatEveryNoteHadBefore() {
        let sections = NoteMenuPlan.sections(.init(meta: meta(archived: true), menu: nil, reviewCards: nil, graph: true))
        #expect(words(sections) == [
            ["Bookmark", "Info", "Find and replace…"],
            ["Foli DNA", "Version history…", "Move and copy: Move…, Copy to…, Duplicate", "Share and export: Export…, Present, Print…"],
            ["Unarchive", "Move to Trash"],
        ])
    }

    // MARK: Add tag, Reviews of one note

    /// How many items a JSON array holds (0 for anything else).
    static func count(_ v: JSONValue?) -> Int {
        if case .array(let a)? = v { return a.count }
        return 0
    }

    @MainActor
    @Test func selectModeAddsATagToTheNotesWithoutIt() async {
        #expect(ListSelection.actions([SelectedItem(.note)], canEdit: true, tags: true) == [.move, .star, .tags, .archive, .trash])
        #expect(!ListSelection.actions([SelectedItem(.note)], canEdit: false, tags: true).contains(.tags))
        #expect(!ListSelection.actions([.folder], canEdit: true, tags: true).contains(.tags))
        #expect(ListSelection.actions([SelectedItem(.note)], trash: true, canEdit: true, tags: true) == [.restore, .deleteForever])

        let engine = FakeEngine()
        engine.onCommand = { name, args in
            name == "graph.tag" ? .object(["tagged": .number(Double(Self.count(args["notes"])))]) : .object(["ok": .bool(true)])
        }
        let log = FeedbackLog()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), feedback: log.feedback, defaults: UserDefaults(suiteName: "tags.\(UUID().uuidString)")!)
        await eventually { model.total == 25 && model.tree.value != nil && model.session.value != nil }
        #expect(model.bulkActions.contains(.tags), "the iPhone's bar")
        #expect(!model.bulkActions(tabs: true).contains(.tags), "the Mac's and iPad's bars are as they were")
        #expect(model.tagChoices.map(\.name) == ["ideas"])

        let ids = Array(model.loadedRows.prefix(2).map(\.id))
        model.selecting = true
        model.selection = Set(ids)
        await model.runBulk(.tags)
        #expect(model.tagging?.map(\.id).sorted() == ids.sorted())

        let ideas = model.tagChoices[0]
        await model.addTag(ideas, to: [TagTarget(id: ids[0], tagIds: []), TagTarget(id: ids[1], tagIds: [ideas.id])])
        #expect(model.tagging == nil)
        let sent = engine.commands(named: "graph.tag").last
        #expect(sent?["tagId"]?.string == ideas.id)
        #expect(Self.count(sent?["notes"]) == 1, "a note that has the tag is left as it is")
        #expect(log.toasts.last?.message == "Tagged 1 note #ideas")

        await model.addTag(ideas, to: [TagTarget(id: ids[1], tagIds: [ideas.id])])
        #expect(engine.commands(named: "graph.tag").count == 1)
        #expect(log.toasts.last?.message == "Already tagged #ideas")
    }

    @Test func reviewsKeepsTheNoteItReviews() {
        #expect(FrameRoute(path: "/review?note=doc_1") == .web("/review?note=doc_1"))
        #expect(FrameRoute(path: "/review?other=1") == .web("/review"))
        #expect(FrameRoute(path: "/review").fallbackTitle == "Reviews")
    }
}
