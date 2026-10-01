import XCTest

/// Personal vs team workspaces (convex/lib/scope.ts, packages/editor-schema/src/ids.ts `scopeIdKey`).
final class ScopeTests: XCTestCase {
    func testKeysAndArgs() throws {
        XCTAssertEqual(Scope.personal.key, "personal")
        XCTAssertEqual(Scope.workspace("01M3BEZPKC").key, "01M3BEZPKC")
        XCTAssertEqual(Scope.personal.arg.canonicalString, #"{"kind":"personal"}"#)
        XCTAssertEqual(Scope.workspace("w1").arg.canonicalString, #"{"kind":"workspace","workspaceId":"w1"}"#)
        XCTAssertEqual(Scope(key: "personal"), .personal)
        XCTAssertEqual(Scope(key: "w1"), .workspace("w1"))
        XCTAssertEqual(Scope.personal.storeKey(profileId: "p1"), "p:p1")
        XCTAssertEqual(Scope.workspace("w1").storeKey(profileId: "p1"), "w1")
    }

    func testCodableRoundTrip() throws {
        for scope in [Scope.personal, .workspace("w9")] {
            let data = try JSONEncoder().encode(scope)
            XCTAssertEqual(try JSONDecoder().decode(Scope.self, from: data), scope)
            XCTAssertEqual(try JSONValue(jsonData: data), scope.arg)
        }
    }

    func testInboxIdHashesScopeKey() {
        // packages/editor-schema inboxDocumentId("k57abc", scopeIdKey({kind: "personal"})).
        XCTAssertEqual(InboxPage.documentId(profileId: "k57abc", scopeKey: Scope.personal.key), "inbox-405a8c136a6402d0")
    }

    func testCreateCarriesScopeOnTheWire() throws {
        let create = WireDocumentCreate(id: "d1", title: "Hi", scope: .workspace("w1"))
        let json = try JSONValue(encoding: create)
        XCTAssertEqual(json["scope"], Scope.workspace("w1").arg)
        let nested = WireDocumentCreate(id: "d2", parentDocumentId: "d1", title: "Child")
        XCTAssertNil(try JSONValue(encoding: nested)["scope"])
    }

    func testSummaryFilesPersonalPagesUnderTheirOwner() throws {
        let personal = try JSONDecoder().decode(DocumentSummary.self, from: Data(#"{"id":"d1","workspaceId":null,"ownerProfileId":"p1","title":"A"}"#.utf8))
        XCTAssertEqual(personal.workspaceId, "")
        XCTAssertEqual(personal.storeKey, Scope.personal.storeKey(profileId: "p1"))
        let team = try JSONDecoder().decode(DocumentSummary.self, from: Data(#"{"id":"d2","workspaceId":"w1","ownerProfileId":null,"title":"B"}"#.utf8))
        XCTAssertEqual(team.storeKey, "w1")
    }

    func testStoreListsEachScopeSeparately() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = try SQLiteStore(url: dir.appendingPathComponent("s.sqlite"))
        try await store.upsertDocuments([
            DocumentSummary(id: "a", workspaceId: "", ownerProfileId: "me", title: "Mine", createdAt: 0, updatedAt: 1),
            DocumentSummary(id: "b", workspaceId: "", ownerProfileId: "someone", title: "Shared with me", createdAt: 0, updatedAt: 2),
            DocumentSummary(id: "c", workspaceId: "w1", title: "Team", createdAt: 0, updatedAt: 3),
        ])
        let mine = try await store.documents(storeKey: Scope.personal.storeKey(profileId: "me"))
        XCTAssertEqual(mine.map(\.id), ["a"])
        let team = try await store.documents(storeKey: Scope.workspace("w1").storeKey(profileId: "me"))
        XCTAssertEqual(team.map(\.id), ["c"])
        try await store.setCursor(7, scopeKey: "p:me")
        let other = try await store.cursor(scopeKey: "w1")
        XCTAssertEqual(other, 0)
    }

    func testWorkspaceDecodesTheServerShape() throws {
        let json = #"""
        {"id":"w1","name":"Acme","icon":null,"logoUrl":null,"role":"member","memberAccess":"view","canEdit":false,"canManage":false,
         "status":"active","deletionScheduledFor":null,"storageUsedBytes":10,"storageQuotaBytes":100,"storageRule":"per_member",
         "plan":{"scope":"workspace","id":"workspace_pro_month","name":"Pro","tier":"pro","shortName":"Pro"},"canManageBilling":false,"aiIncluded":true}
        """#
        let w = try JSONDecoder().decode(WorkspaceInfo.self, from: Data(json.utf8))
        XCTAssertFalse(w.canEdit)
        XCTAssertEqual(w.plan?.tier, "pro")
        XCTAssertEqual(w.roleAndPlan, "Can view · Pro")
    }

    func testPlanNames() {
        XCTAssertEqual(PlanTier.name("core"), "Core")
        XCTAssertEqual(PlanTier.name("pro_ai"), "Pro AI")
        XCTAssertEqual(PlanTier.name("free"), "Free")
    }

    func testNotificationPrefsKeepNewFields() throws {
        let json = #"{"mentions":true,"comments":true,"shares":true,"invites":true,"digest":"off","productEmail":false,"replies":false,"access":true,"inApp":{"comments":false}}"#
        let prefs = try JSONDecoder().decode(NotificationPrefs.self, from: Data(json.utf8))
        let back = try JSONValue(encoding: prefs)
        XCTAssertEqual(back["replies"], .bool(false))
        XCTAssertEqual(back["inApp"]?["comments"], .bool(false))
    }
}

final class AudioPropsTests: XCTestCase {
    func testRoundTripAndHelpers() {
        let p = AudioProps(fileId: "f1", name: "Recording 2026-10-01 14.03.m4a", size: 2048, mimeType: "audio/mp4", duration: 65.27)
        let back = AudioProps(p.json)
        XCTAssertEqual(back?.fileId, "f1")
        XCTAssertEqual(back?.duration, 65.3)
        XCTAssertEqual(AudioProps.format(65.3), "1:05")
        XCTAssertEqual(AudioProps.format(3729), "1:02:09")
        XCTAssertTrue(AudioProps.fileName(at: Date(timeIntervalSince1970: 0)).hasPrefix("Recording 19"))
        XCTAssertTrue(AudioProps.fileName().hasSuffix(".m4a"))
        let block = WireBlock(id: ULID.make(), type: "audio", parentId: nil, rank: "V", props: p.json)
        XCTAssertEqual(SearchText.blockText(block), "Recording 2026-10-01 14.03.m4a")
    }
}
