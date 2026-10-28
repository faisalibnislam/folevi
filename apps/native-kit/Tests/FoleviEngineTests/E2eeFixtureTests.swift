// Revision 19's fixtures (apps/web/src/lib/engine/fixtures/e2ee.ts) as the Mac's Vault reads them: this device's
// encryption, an approval's code, and an unlock's outcome in the web's words.
import Foundation
import Testing
@testable import FoleviEngine

@Suite("Encryption unlock fixtures")
struct E2eeFixtureTests {
    private func load<T: Decodable>(_ name: String, _ key: String, as: T.Type) throws -> T {
        let f = try Fixtures.load(Fixtures.dir.appendingPathComponent("\(name).json"))
        return try JSONDecoder().decode(T.self, from: Fixtures.data(try #require(f[key])))
    }

    @Test func stateAndApproval() throws {
        let locked = try load("view.e2ee.state", "value", as: E2eeStateValue.self)
        #expect(locked.state == .locked)
        #expect(locked.methods == [.approve, .passphrase, .recovery])
        #expect(locked.device == "this Mac")
        let compare = try load("view.e2ee.state.compare", "value", as: E2eeStateValue.self)
        #expect(compare.approval == .compare)
        #expect(compare.approvalCode == "482 913")
    }

    @Test func unlockResults() throws {
        #expect(try load("command.e2ee.unlock", "result", as: E2eeUnlockResult.self).status == .ok)
        let bad = try load("command.e2ee.unlock.badFormat", "result", as: E2eeUnlockResult.self)
        #expect(bad.status == .badFormat)
        #expect(bad.message == "A recovery key has 36 letters and numbers in 9 groups of 4. Check it and try again.")
    }
}
