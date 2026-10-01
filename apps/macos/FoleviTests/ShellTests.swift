import XCTest

/// The app shell's sync status, word for word as the web's SyncStatus.tsx (and en.ts), and the pages
/// waiting to sync (the web's usePendingDocs).
final class ShellTests: XCTestCase {
    func testSyncLabelsMatchTheWeb() {
        XCTAssertEqual(SyncCopy.label(.saved), "Saved")
        XCTAssertEqual(SyncCopy.label(.saving), "Saving…")
        XCTAssertEqual(SyncCopy.label(.syncing), "Syncing…")
        XCTAssertEqual(SyncCopy.label(.offline), "Offline")
        XCTAssertEqual(SyncCopy.label(.conflict), "Conflict")
        XCTAssertEqual(SyncCopy.label(.error), "Not saved")
    }

    func testSyncButtonLabel() {
        XCTAssertEqual(SyncCopy.accessibilityLabel(.saved, pending: 0), "Sync status: Saved")
        XCTAssertEqual(SyncCopy.accessibilityLabel(.offline, pending: 1), "Sync status: Offline, 1 change waiting")
        XCTAssertEqual(SyncCopy.accessibilityLabel(.offline, pending: 3), "Sync status: Offline, 3 changes waiting")
    }

    func testSyncDetailCopy() {
        XCTAssertEqual(SyncCopy.detail(.saved, pending: 0, conflicts: 0, authRequired: false), "Every change has been saved to Folevi.")
        XCTAssertEqual(SyncCopy.detail(.offline, pending: 0, conflicts: 0, authRequired: false),
                       "You can keep writing. Changes are stored on this device and will sync when you reconnect.")
        XCTAssertEqual(SyncCopy.detail(.offline, pending: 1, conflicts: 0, authRequired: false),
                       "You can keep writing. 1 change is stored on this device and will sync when you reconnect.")
        XCTAssertEqual(SyncCopy.detail(.offline, pending: 4, conflicts: 0, authRequired: false),
                       "You can keep writing. 4 changes are stored on this device and will sync when you reconnect.")
        XCTAssertEqual(SyncCopy.detail(.conflict, pending: 0, conflicts: 2, authRequired: false),
                       "2 blocks changed in two places. Both versions are kept. Choose which to keep in the document.")
        XCTAssertEqual(SyncCopy.detail(.conflict, pending: 0, conflicts: 1, authRequired: false),
                       "1 block changed in two places. Both versions are kept. Choose which to keep in the document.")
        XCTAssertTrue(SyncCopy.detail(.error, pending: 0, conflicts: 0, authRequired: true).hasPrefix("Your session needs to be refreshed."))
        XCTAssertEqual(SyncCopy.detail(.error, pending: 0, conflicts: 0, authRequired: false),
                       "Some changes were rejected by the server and were not saved.")
        XCTAssertEqual(SyncCopy.describeError("forbidden"), "You no longer have permission to edit this document.")
        XCTAssertEqual(SyncCopy.describeError("weird"), "The server rejected a change (weird).")
    }

    func testPendingDocumentsGroupOpsAndUploadsByPage() {
        let ops = [
            SyncOp(opId: "1", kind: .documentCreate, documentId: "a"),
            SyncOp(opId: "2", kind: .blockUpsert, documentId: "a"),
            SyncOp(opId: "3", kind: .blockUpsert, documentId: "b"),
        ]
        let uploads = [
            UploadRecord(uploadId: "u1", documentId: "b", blockId: "x", attempts: 0, state: .queued),
            UploadRecord(uploadId: "u2", documentId: "c", blockId: "y", attempts: 0, state: .done),
        ]
        let pending = PendingDocument.from(ops: ops, uploads: uploads)
        XCTAssertEqual(pending.map(\.documentId), ["a", "b"])
        XCTAssertEqual(pending[0].changes, 2)
        XCTAssertTrue(pending[0].isNew)
        XCTAssertEqual(pending[1].changes, 1)
        XCTAssertEqual(pending[1].uploads, 1)
        XCTAssertFalse(pending[1].isNew)
        XCTAssertTrue(PendingDocument.from(ops: [], uploads: []).isEmpty)
    }
}
