// The Vault on a Mac without the account's encryption keys, on the demo engine: e2ee.state and vault.summary as the
// screen watches them, a wrong passphrase and a recovery key of the wrong shape answered in the web's words, approval
// from another device, and the right passphrase unlocking this Mac and moving the Vault on to its passcode.
#if os(macOS)
import Foundation
import Testing
import FoleviEngine
@testable import FoleviMac

@Suite("Vault unlock") @MainActor
struct VaultUnlockTests {
    private func demo() -> (DemoEngine, EngineClient) {
        let d = DemoEngine()
        d.vaultState = .encryptionLocked
        d.e2eeLock = .locked
        return (d, d.client())
    }

    @Test func wrongThenRightPassphrase() async throws {
        let (d, client) = demo()
        let wrong = try await client.command(.e2eeUnlock(method: .passphrase, secret: "not it"))
        #expect(wrong.status == .wrong)
        #expect(wrong.message == "That passphrase didn't unlock your notes. Check it and try again.")
        #expect(d.vaultState == .encryptionLocked)
        let ok = try await client.command(.e2eeUnlock(method: .passphrase, secret: DemoEngine.passphrase))
        #expect(ok.status == .ok)
        #expect(d.e2eeLock == .unlocked)
        // Straight on to the passcode, in the same screen.
        #expect(d.vaultState == .locked)
    }

    @Test func recoveryKey() async throws {
        let (d, client) = demo()
        #expect(try await client.command(.e2eeUnlock(method: .recovery, secret: "ABCD")).status == .badFormat)
        #expect(try await client.command(.e2eeUnlock(method: .recovery, secret: DemoEngine.recoveryKey.lowercased())).status == .ok)
        #expect(d.vaultState == .locked)
    }

    @Test func approvalStartsAndCancels() async throws {
        let (d, client) = demo()
        _ = try await client.command(.e2eeApprovalStart)
        #expect(d.approval == .waiting)
        _ = try await client.command(.e2eeApprovalCancel)
        #expect(d.approval == .idle)
    }

    @Test func theScreenSeesTheLockedState() async throws {
        let (_, client) = demo()
        let state = try await client.query(.e2eeState)
        #expect(state.state == .locked)
        #expect(state.methods.first == .approve)
        let summary = try await client.query(.vaultSummary())
        #expect(summary.state == .encryptionLocked)
    }
}
#endif
