// Finder-style multi-select (ListSelection, the web's lib/app/multiSelect.ts): toggle, range, select all, clear, which
// clicks select, the actions a mixed selection offers, and moving several folders at once.
import Foundation
import Testing
import FoleviEngine
@testable import FoleviScreens

@Suite("Multi-select")
struct ListSelectionTests {
    let order = ["f1", "f2", "n1", "n2", "n3", "n4"]

    @Test func commandClickTogglesAndMovesTheAnchor() {
        var s = ListSelection()
        s.toggle("n2")
        s.toggle("f1")
        #expect(s.ordered(order) == ["f1", "n2"])
        #expect(s.anchor == "f1")
        s.toggle("n2")
        #expect(s.ordered(order) == ["f1"])
        #expect(s.anchor == "n2")
    }

    @Test func shiftClickSelectsTheRunEitherWay() {
        var s = ListSelection()
        s.toggle("f2")
        s.extend(to: "n3", in: order)
        #expect(s.ordered(order) == ["f2", "n1", "n2", "n3"])
        var t = ListSelection()
        t.toggle("n4")
        t.extend(to: "n1", in: order)
        #expect(t.ordered(order) == ["n1", "n2", "n3", "n4"])
    }

    @Test func aRangeAddsAndKeepsItsAnchor() {
        var s = ListSelection()
        s.toggle("f1")
        s.toggle("n3")
        s.extend(to: "n4", in: order)
        #expect(s.ordered(order) == ["f1", "n3", "n4"])
        #expect(s.anchor == "n3")
    }

    @Test func shiftClickWithNothingPickedSelectsThatItem() {
        var s = ListSelection()
        s.extend(to: "n2", in: order)
        #expect(s.ordered(order) == ["n2"])
        #expect(s.anchor == "n2")
        let before = s
        s.extend(to: "gone", in: order)
        #expect(s == before)
    }

    @Test func selectAllAndClear() {
        var s = ListSelection()
        s.selectAll(order)
        #expect(s.ordered(order) == order)
        s.clear()
        #expect(s.isEmpty)
        #expect(s.anchor == nil)
    }

    @Test func whichClicksSelect() {
        #expect(ListSelection.click(command: false, shift: false) == nil)
        #expect(ListSelection.click(command: true, shift: false) == .toggle)
        #expect(ListSelection.click(command: false, shift: true) == .range)
        #expect(ListSelection.click(command: true, shift: false, option: true) == nil)
    }

    @Test func mixedSelectionsOfferWhatEveryItemTakes() {
        let note = SelectedItem(.note)
        #expect(ListSelection.actions([note, note], canEdit: true, canCopy: true, tabs: true) == [.openTabs, .move, .copy, .star, .archive, .trash])
        #expect(ListSelection.actions([.folder, .folder], canEdit: true, tabs: true) == [.openTabs, .move, .color, .deleteFolders])
        #expect(ListSelection.actions([.folder, note], canEdit: true, canCopy: true, tabs: true) == [.openTabs, .move])
        #expect(ListSelection.actions([SelectedItem(.note, starred: true, archived: true)], canEdit: true) == [.move, .unstar, .unarchive, .trash])
        #expect(ListSelection.actions([SelectedItem(.note, template: true), note], canEdit: true).contains(.move) == false)
        #expect(ListSelection.actions([.folder], canEdit: false, tabs: true) == [.openTabs])
        #expect(ListSelection.actions([note], trash: true, canEdit: true) == [.restore, .deleteForever])
        #expect(ListSelection.actions([], canEdit: true).isEmpty)
    }

    @Test func movingSeveralFolders() {
        let links = [
            FolderRules.Link(id: "a", parentId: nil), FolderRules.Link(id: "a1", parentId: "a"), FolderRules.Link(id: "b", parentId: nil),
            FolderRules.Link(id: "c", parentId: "t"), FolderRules.Link(id: "t", parentId: nil),
        ]
        let plan = ListSelection.planFolderMoves(links, ids: ["a", "a1", "b", "c"], into: "t")
        #expect(plan.move == ["a", "b"])
        #expect(plan.unchanged == ["c"])
        #expect(plan.refused.isEmpty)
        let refused = ListSelection.planFolderMoves(links, ids: ["a", "b"], into: "a1")
        #expect(refused.move == ["b"])
        #expect(refused.refused.map(\.id) == ["a"])
        #expect(refused.refused.first?.problem == .descendant)
    }

    @Test func whatIsSelectedInWords() {
        #expect(ListSelection.noun(notes: 1, folders: 0) == "1 note")
        #expect(ListSelection.noun(notes: 0, folders: 2) == "2 folders")
        #expect(ListSelection.noun(notes: 3, folders: 1) == "1 folder and 3 notes")
    }

    @Test func aDragFromAnOlderBuildCarriesNoFolders() throws {
        let old = #"{"notes":[{"id":"n1","title":"A","folderId":null}]}"#.data(using: .utf8)!
        let item = try JSONDecoder().decode(NoteDragItem.self, from: old)
        #expect(item.ids == ["n1"])
        #expect(item.folders.isEmpty)
        let both = NoteDragItem(notes: [NoteRef(id: "n1", title: "A", folderId: nil)], folders: [FolderRef(id: "f1", name: "F", parentId: nil)])
        let back = try JSONDecoder().decode(NoteDragItem.self, from: JSONEncoder().encode(both))
        #expect(back == both)
    }

    @MainActor
    @Test func aListSelectsWithClicksAndKeys() async {
        let engine = FakeEngine()
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: UserDefaults(suiteName: "multiselect.\(UUID().uuidString)")!)
        await eventually { model.total == 25 }
        let ids = model.slots.compactMap(\.row?.id)
        model.select(ids[1], range: false)
        model.select(ids[4], range: true)
        #expect(model.selectedIds == Array(ids[1...4]))
        #expect(model.bulkActions(tabs: true).first == .openTabs)
        #expect(!model.bulkActions.contains(.openTabs), "the iPhone has no tabs")
        model.selectAll()
        #expect(model.selection.count == ids.count)
        model.selection.removeAll()
        #expect(model.selectedIds.isEmpty)
    }
}
