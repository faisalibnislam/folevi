import XCTest

final class SQLiteStoreTests: XCTestCase {
    private var dir: URL!

    override func setUp() {
        dir = temporaryDirectory()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
    }

    private func sampleBlock(_ id: String, _ text: String) -> WireBlock {
        WireBlock(id: id, type: "paragraph", parentId: nil, rank: "V", text: [["type": "text", "text": .string(text)]], props: .emptyObject)
    }

    func testMigrationsApplied() async throws {
        let store = try SQLiteStore(url: dir.appendingPathComponent("a.sqlite"))
        let applied = try await store.appliedMigrations()
        XCTAssertEqual(applied, [1, 2])
    }

    func testKeyValueAndDocumentsCRUD() async throws {
        let store = try SQLiteStore(url: dir.appendingPathComponent("b.sqlite"))
        try await store.setValue("hello", forKey: "k")
        let v = try await store.value(forKey: "k")
        XCTAssertEqual(v, "hello")
        try await store.setValue(nil, forKey: "k")
        let gone = try await store.value(forKey: "k")
        XCTAssertNil(gone)

        let doc = DocumentSummary(id: "d1", workspaceId: "w1", title: "First", createdAt: 1, updatedAt: 2)
        var doc2 = DocumentSummary(id: "d2", workspaceId: "w1", title: "Second", createdAt: 1, updatedAt: 5)
        try await store.upsertDocuments([doc, doc2])
        var list = try await store.documents(workspaceId: "w1")
        XCTAssertEqual(list.map(\.id), ["d2", "d1"])
        doc2.title = "Renamed"
        try await store.upsertDocuments([doc2])
        let fetched = try await store.document(id: "d2")
        XCTAssertEqual(fetched?.title, "Renamed")
        try await store.deleteDocument(id: "d1")
        list = try await store.documents(workspaceId: "w1")
        XCTAssertEqual(list.map(\.id), ["d2"])

        try await store.setCursor(42, workspaceId: "w1")
        let cursor = try await store.cursor(workspaceId: "w1")
        XCTAssertEqual(cursor, 42)
    }

    func testOpLogSurvivesReopen() async throws {
        let url = dir.appendingPathComponent("c.sqlite")
        var state = SyncState()
        state.remoteUpdate(documentId: "d1", block: WireBlock(id: "b0", type: "paragraph", parentId: nil, rank: "G", revision: 3), deleted: false)
        state.setConnection(.offline)
        state.localUpsert(opId: "op1", documentId: "d1", block: sampleBlock("b1", "Written offline"), fields: [.content, .position])
        state.localUpsert(opId: "op2", documentId: "d1", block: sampleBlock("b2", "Second"), fields: [.content, .position])
        state.localDelete(opId: "op3", documentId: "d1", blockId: "b0")
        state.queueUpload(uploadId: "up1", documentId: "d1", blockId: "b9")
        state.errors.append(SyncErrorRecord(opId: "old", code: "invalid_block"))
        state.enqueueDocumentCreate(opId: "op4", document: WireDocumentCreate(id: "d9", title: "Offline doc"))
        do {
            let store = try SQLiteStore(url: url)
            try await store.persist(state, touchedBlockIds: nil)
            await store.close()
        }
        let reopened = try SQLiteStore(url: url)
        let loaded = try await reopened.loadSyncState()
        XCTAssertEqual(loaded.pending.map(\.opId), ["op1", "op2", "op3", "op4"])
        XCTAssertEqual(loaded.blocks.count, 3)
        XCTAssertEqual(loaded.blocks["b0"]?.deleted, true)
        XCTAssertEqual(loaded.blocks["b0"]?.serverRevision, 3)
        XCTAssertEqual(loaded.blocks["b1"]?.block.inlineText, [.text(text: "Written offline", marks: nil)])
        XCTAssertEqual(loaded.uploads.map(\.uploadId), ["up1"])
        XCTAssertEqual(loaded.errors, state.errors)
        XCTAssertEqual(loaded.pending[3].document?.title, "Offline doc")
        let count = try await reopened.pendingOpCount()
        XCTAssertEqual(count, 4)
    }

    func testInflightOpsReturnToFrontOfQueueOnReload() async throws {
        let url = dir.appendingPathComponent("d.sqlite")
        var state = SyncState()
        state.localUpsert(opId: "op1", documentId: "d1", block: sampleBlock("b1", "a"), fields: [.content])
        state.localUpsert(opId: "op2", documentId: "d1", block: sampleBlock("b2", "b"), fields: [.content])
        state.takeBatch(max: 1)
        XCTAssertEqual(state.inflight.map(\.opId), ["op1"])
        let store = try SQLiteStore(url: url)
        try await store.persist(state, touchedBlockIds: ["b1", "b2"])
        let loaded = try await store.loadSyncState()
        XCTAssertTrue(loaded.inflight.isEmpty)
        XCTAssertEqual(loaded.pending.map(\.opId), ["op1", "op2"])
    }

    func testIncrementalPersistDeletesForgottenBlocks() async throws {
        let store = try SQLiteStore(url: dir.appendingPathComponent("e.sqlite"))
        var state = SyncState()
        state.localUpsert(opId: "op1", documentId: "d1", block: sampleBlock("b1", "a"), fields: [.content])
        try await store.persist(state, touchedBlockIds: ["b1"])
        state.localDelete(opId: "op2", documentId: "d1", blockId: "b1")
        try await store.persist(state, touchedBlockIds: ["b1"])
        let loaded = try await store.loadSyncState()
        XCTAssertNil(loaded.blocks["b1"])
        XCTAssertTrue(loaded.pending.isEmpty)
    }

    func testResetAllWipesEverything() async throws {
        let store = try SQLiteStore(url: dir.appendingPathComponent("f.sqlite"))
        var state = SyncState()
        state.localUpsert(opId: "op1", documentId: "d1", block: sampleBlock("b1", "a"), fields: [.content])
        try await store.persist(state, touchedBlockIds: nil)
        try await store.upsertDocuments([DocumentSummary(id: "d1", workspaceId: "w", title: "x", createdAt: 0, updatedAt: 0)])
        try await store.resetAll()
        let loaded = try await store.loadSyncState()
        XCTAssertTrue(loaded.blocks.isEmpty && loaded.pending.isEmpty)
        let docs = try await store.documents(workspaceId: "w")
        XCTAssertTrue(docs.isEmpty)
    }

    func testFileCache() async throws {
        let store = try SQLiteStore(url: dir.appendingPathComponent("g.sqlite"))
        try await store.cacheFile(.init(fileId: "f1", localPath: "/tmp/x.png", mimeType: "image/png", name: "x.png", size: 10))
        let f = try await store.cachedFile("f1")
        XCTAssertEqual(f?.size, 10)
        let none = try await store.cachedFile("nope")
        XCTAssertNil(none)
    }
}
