import Foundation
import Testing
@testable import FoleviEngine

struct Row: EngineRow {
    let id: String
    let h: String
}

@Suite("ListState")
struct ListStateTests {
    @Test func resetRemoveUpsertOrder() {
        var s = ListState<Row>()
        s.apply(RowDiff(reset: true, total: 3, complete: true, start: 0, order: ["a", "b", "c"], upsert: ["a": Row(id: "a", h: "1"), "b": Row(id: "b", h: "1"), "c": Row(id: "c", h: "1")]))
        #expect(s.rows.map(\.id) == ["a", "b", "c"])
        s.apply(RowDiff(total: 3, complete: true, start: 0, upsert: ["b": Row(id: "b", h: "2")]))
        #expect(s.rows[1].h == "2")
        s.apply(RowDiff(total: 2, complete: true, start: 0, order: ["c", "a"], remove: ["b"]))
        #expect(s.rows.map(\.id) == ["c", "a"])
        #expect(s.rowsById.count == 2)
        #expect(s.row(at: 0)?.id == "c")
        #expect(s.row(at: 5) == nil)
    }

    @Test func windowing() {
        let w = ListWindowing(overscan: 100)
        #expect(w.window(for: 0 ..< 20) == ListWindow(start: 0, count: 220))
        #expect(w.window(for: 500 ..< 520) == ListWindow(start: 400, count: 220))
        let current = ListWindow(start: 0, count: 220)
        #expect(!w.needsMove(current: current, visible: 0 ..< 20, total: 5000, complete: true))
        #expect(w.needsMove(current: current, visible: 190 ..< 210, total: 5000, complete: true))
        #expect(!w.needsMove(current: current, visible: 190 ..< 210, total: 210, complete: true))
    }
}
