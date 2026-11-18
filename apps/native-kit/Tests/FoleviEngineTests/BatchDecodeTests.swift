// A batch with one item this build can't read still delivers the rest (InboundItem.decodeBatch): decoding the
// array whole dropped every item with the bad one, `engine.ready` and `note.ready` too.
import Foundation
import Testing
@testable import FoleviEngine

struct BatchDecodeTests {
    private let ready: [String: Any] = ["kind": "event", "name": "engine.ready", "data": ["place": "acct:user_1", "protocol": 1, "revision": 32]]

    @Test func oneBadItemKeepsTheRest() throws {
        let bad: [String: Any] = ["kind": "event", "name": "engine.ready", "data": ["place": 7, "protocol": "one"]]
        let noKind: [String: Any] = ["name": "engine.ready"]
        let batch = try JSONSerialization.data(withJSONObject: [ready, bad, noKind, ready])
        let items = try InboundItem.decodeBatch(batch, decoders: SubscriptionDecoders())
        #expect(items.count == 2)
        for item in items {
            guard case .event(let e) = item else { Issue.record("not an event"); continue }
            #expect(e.name == "engine.ready")
        }
    }

    @Test func aWholeBatchThatIsntAnArrayStillFails() {
        #expect(throws: (any Error).self) { try InboundItem.decodeBatch(Data("[1,".utf8), decoders: SubscriptionDecoders()) }
    }
}
