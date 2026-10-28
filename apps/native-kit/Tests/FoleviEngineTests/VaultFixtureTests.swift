// The Vault's bridge fixtures (revision 18, apps/web/src/lib/engine/fixtures/vault.ts) as the Mac's Vault screen
// reads them: the summary's states and sections, rows, an opened item's fields, a file's bytes.
import Foundation
import Testing
@testable import FoleviEngine

@Suite("Vault fixtures")
struct VaultFixtureTests {
    private func load<T: Decodable>(_ name: String, _ key: String, as: T.Type) throws -> T {
        let f = try Fixtures.load(Fixtures.dir.appendingPathComponent("\(name).json"))
        return try JSONDecoder().decode(T.self, from: Fixtures.data(try #require(f[key])))
    }

    @Test func summaryStates() throws {
        let open = try load("view.vault.summary", "value", as: VaultSummaryValue.self)
        #expect(open.state == .open)
        #expect(open.local)
        #expect(open.moreSections == [.health, .trash, .settings])
        #expect(open.locksAt != nil)
        let locked = try load("view.vault.summary.locked", "value", as: VaultSummaryValue.self)
        #expect(locked.state == .locked)
        #expect(locked.moreSections.contains(.people) && locked.moreSections.contains(.activity))
        #expect(try load("view.vault.summary.none", "value", as: VaultSummaryValue.self).state == .none)
    }

    @Test func rowsAndItems() throws {
        let items = try load("view.vault.items", "value", as: VaultItemsValue.self)
        #expect(items.items.first?.detail == "Login · sam@example.com")
        #expect(items.kinds.contains { $0.kind == "login" && $0.fields.contains { $0.type == "totp" } })
        let item = try load("command.vault.item.open", "result", as: VaultItemValue.self)
        #expect(item.fields.first { $0.key == "password" }?.type == "secret")
        let file = try load("command.vault.file.open", "result", as: VaultFileValue.self)
        #expect(Data(base64Encoded: file.data) == Data("Hello".utf8))
        #expect(file.kind == "text")
    }

    @Test func unlockResults() throws {
        let wrong = try load("command.vault.unlock.wrong", "result", as: VaultUnlockResult.self)
        #expect(wrong.status == "wrong")
        #expect(wrong.message == "That isn't right. Try again.")
    }
}
