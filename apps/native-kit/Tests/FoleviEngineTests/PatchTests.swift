// `x?: T | null` fields (protocol.ts) as three states in Swift (R10.1): left out, null, or a value, both ways.
import Foundation
import Testing
@testable import FoleviEngine

struct PatchTests {
    private func json(_ args: some Encodable) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(args)) as! [String: Any]
    }

    @Test func leftOutClearedOrSet() throws {
        var args = TaskUpdateArgs(id: "t1", dueDate: "2026-10-25")
        args.dueTime = .clear
        args.assigneeId = .clear
        let out = try json(args)
        #expect(out["id"] as? String == "t1")
        #expect(out["dueDate"] as? String == "2026-10-25")
        #expect(out["dueTime"] is NSNull)
        #expect(out["assigneeId"] is NSNull)
        #expect(out["reminderAt"] == nil)
        #expect(out["checked"] == nil)
    }

    @Test func theInitializerStillTakesOptionals() throws {
        let unset: String? = nil
        let args = TaskCreateArgs(text: "Pack", dueDate: unset, dueTime: "09:00")
        #expect(args.dueDate == .keep)
        #expect(args.dueTime == .set("09:00"))
        #expect(args.dueTime.value == "09:00")
    }

    @Test func readsBackTheThreeStates() throws {
        let data = Data(#"{"id":"t1","dueDate":null,"reminderAt":1730000000000}"#.utf8)
        let args = try JSONDecoder().decode(TaskUpdateArgs.self, from: data)
        #expect(args.dueDate == .clear)
        #expect(args.dueTime == .keep)
        #expect(args.reminderAt == .set(1_730_000_000_000))
    }
}
