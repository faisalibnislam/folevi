import XCTest

/// Organizing notes (convex/documents.ts bulkUpdate, the web's noteActions.ts and useCardSelection.ts).
final class OrganizeTests: XCTestCase {
    func testBulkActionArguments() {
        XCTAssertEqual(BulkAction.move(folderId: "f1").arg.canonicalString, #"{"folderId":"f1","kind":"move"}"#)
        XCTAssertEqual(BulkAction.move(folderId: nil).arg.canonicalString, #"{"folderId":null,"kind":"move"}"#)
        XCTAssertEqual(BulkAction.star(true).arg.canonicalString, #"{"kind":"star","starred":true}"#)
        XCTAssertEqual(BulkAction.archive(false).arg.canonicalString, #"{"archived":false,"kind":"archive"}"#)
        XCTAssertEqual(BulkAction.trash.arg.canonicalString, #"{"kind":"trash"}"#)
        XCTAssertEqual(BulkAction.restore.arg.canonicalString, #"{"kind":"restore"}"#)
        XCTAssertEqual(BulkAction.delete.arg.canonicalString, #"{"kind":"delete"}"#)
    }

    func testChunksOfFifty() {
        let ids = (0..<120).map { "d\($0)" }
        let chunks = Organize.chunks(ids)
        XCTAssertEqual(chunks.map(\.count), [50, 50, 20])
        XCTAssertEqual(chunks.flatMap { $0 }, ids)
        XCTAssertEqual(Organize.chunks([]).count, 0)
    }

    func testMessagesMatchTheWeb() {
        XCTAssertEqual(Organize.message(for: .move(folderId: "f"), count: 1, folderName: "Work"), "Moved to Work")
        XCTAssertEqual(Organize.message(for: .move(folderId: nil), count: 3), "Moved 3 notes to Drafts")
        XCTAssertEqual(Organize.message(for: .star(true), count: 1), "Starred")
        XCTAssertEqual(Organize.message(for: .star(false), count: 2), "Unstarred 2 notes")
        XCTAssertEqual(Organize.message(for: .archive(false), count: 1), "Moved out of Archive")
        XCTAssertEqual(Organize.message(for: .trash, count: 4), "Moved 4 notes to Trash")
        XCTAssertEqual(Organize.message(for: .restore, count: 1), "Restored")
        XCTAssertEqual(Organize.message(for: .delete, count: 1), "1 note will be permanently deleted.")
        XCTAssertEqual(Organize.skippedMessage(2), "2 notes couldn’t be changed. You may not have permission.")
    }

    func testInverses() {
        XCTAssertEqual(Organize.inverse(of: .star(true)), .star(false))
        XCTAssertEqual(Organize.inverse(of: .archive(true)), .archive(false))
        XCTAssertEqual(Organize.inverse(of: .trash), .restore)
        XCTAssertEqual(Organize.inverse(of: .restore), .trash)
        XCTAssertNil(Organize.inverse(of: .delete))
        XCTAssertNil(Organize.inverse(of: .move(folderId: nil)))
    }

    func testMoveBackGroupsByPreviousFolder() {
        let groups = Organize.moveBack(done: ["a", "b", "c", "d"], previousFolders: ["a": "f1", "b": nil, "c": "f1", "d": "f2"])
        XCTAssertEqual(groups.map(\.folderId), ["f1", nil, "f2"])
        XCTAssertEqual(groups.map(\.ids), [["a", "c"], ["b"], ["d"]])
    }

    func testEmptyTrashText() {
        XCTAssertEqual(Organize.emptyTrashText(total: 3, deletable: 3, more: false),
                       "3 notes will be permanently deleted, including attachments and version history. This can’t be undone.")
        XCTAssertEqual(Organize.emptyTrashText(total: 5, deletable: 1, more: false),
                       "1 note will be permanently deleted, including attachments and version history. This can’t be undone. 4 you don’t have permission to delete will stay in Trash.")
        XCTAssertTrue(Organize.emptyTrashText(total: 500, deletable: 500, more: true).hasPrefix("500+ notes"))
        XCTAssertEqual(Organize.trashScheduled(1), "1 document will be permanently deleted.")
    }

    func testSelection() {
        let shown = ["a", "b", "c", "d", "e"]
        var s = NoteSelectionState()
        XCTAssertTrue(s.isEmpty)
        s.toggle("b")
        s.selectRange(to: "d", in: shown)
        XCTAssertEqual(s.selectedIds(in: shown), ["b", "c", "d"])
        s.toggle("c")
        XCTAssertEqual(s.selectedIds(in: shown), ["b", "d"])
        // Only notes still shown count.
        XCTAssertEqual(s.selectedIds(in: ["a", "d"]), ["d"])
        s.selectAll(shown)
        XCTAssertEqual(s.selectedIds(in: shown), shown)
        s.clear()
        XCTAssertTrue(s.isEmpty)
        // A range with no anchor selects just that note, and anchors there.
        s.selectRange(to: "c", in: shown)
        s.selectRange(to: "a", in: shown)
        XCTAssertEqual(s.selectedIds(in: shown), ["a", "b", "c"])
    }

    // MARK: DTOs

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    func testBulkResultDecodesNullFolders() throws {
        let r = try decode(BulkUpdateResult.self, #"{"done":["a","b"],"skipped":1,"previousFolders":{"a":"f1","b":null}}"#)
        XCTAssertEqual(r.done, ["a", "b"])
        XCTAssertEqual(r.skipped, 1)
        XCTAssertEqual(r.previousFolders["a"], .some("f1"))
        XCTAssertEqual(r.previousFolders["b"], .some(nil))
        XCTAssertEqual(try decode(TrashSummary.self, #"{"total":12,"deletable":10,"more":false}"#), TrashSummary(total: 12, deletable: 10, more: false))
        XCTAssertEqual(try decode(EmptyTrashResult.self, #"{"scheduled":4,"continuing":true}"#), EmptyTrashResult(scheduled: 4, continuing: true))
    }

    func testWorkspaceMembersDecode() throws {
        let json = #"""
        {"members":[{"profileId":"p1","displayName":"Ada","email":"ada@x.com","role":"owner","memberAccess":"edit","canManageBilling":true,"joinedAt":1,"isYou":true,"canManage":false},
                    {"profileId":"p2","displayName":"Bo","email":"bo@x.com","role":"member","memberAccess":"view","canManageBilling":false,"joinedAt":2,"isYou":false,"canManage":true}],
         "invites":[{"id":"i1","email":"c@x.com","role":"member","memberAccess":"comment","expiresAt":5,"expired":false}],
         "yourRole":"owner","yourMemberAccess":"edit","yourCanManageBilling":true,"canManage":true,
         "seats":{"billable":2,"paid":true,"planName":"Pro","seatPriceCents":800,"interval":"month"},"guests":3}
        """#
        let m = try decode(WorkspaceMembers.self, json)
        XCTAssertEqual(m.members.count, 2)
        XCTAssertEqual(m.members[1].memberAccess, .view)
        XCTAssertTrue(m.members[1].canManage)
        XCTAssertEqual(m.invites.first?.memberAccess, .comment)
        XCTAssertEqual(m.seats?.seatPriceCents, 800)
        XCTAssertEqual(m.guests, 3)
        // A member's view: no seats or guests.
        let member = try decode(WorkspaceMembers.self, #"{"members":[],"invites":[],"yourRole":"member","yourMemberAccess":"comment","yourCanManageBilling":false,"canManage":false,"seats":null,"guests":null}"#)
        XCTAssertNil(member.seats)
        XCTAssertNil(member.guests)
    }

    func testRoleChoices() {
        XCTAssertEqual(MemberRoleChoice(role: "admin", access: .view), .admin)
        XCTAssertEqual(MemberRoleChoice(role: "member", access: .comment), .memberComment)
        XCTAssertEqual(JSONValue.object(MemberRoleChoice.memberView.args).canonicalString, #"{"memberAccess":"view","role":"member"}"#)
        XCTAssertEqual(JSONValue.object(MemberRoleChoice.admin.args).canonicalString, #"{"role":"admin"}"#)
        XCTAssertEqual(MemberRoleChoice.memberComment.title, "Member · can comment")
        XCTAssertEqual(PlanPrice.format(cents: 800), "$8")
        XCTAssertEqual(PlanPrice.format(cents: 450), "$4.50")
    }

    func testGuestsExportSupportAndBlockersDecode() throws {
        let g = try decode(WorkspaceGuests.self, #"""
        {"guests":[{"profileId":"p9","displayName":"Gus","email":"g@x.com","pages":[{"documentId":"d1","title":"Plan","icon":null,"inTrash":false,"role":"commenter","grantedAt":1}]}],
         "pendingInvites":[{"id":"pi1","email":"n@x.com","documentId":"d1","title":"Plan","role":"viewer","expiresAt":9,"expired":true}]}
        """#)
        XCTAssertEqual(g.guests.first?.pages.first?.role, "commenter")
        XCTAssertTrue(g.pendingInvites.first?.expired ?? false)

        let e = try decode(ExportResult.self, #"{"url":"https://x/files/1","filename":"Personal-folevi-export-2026-10-01.zip","documents":3,"assets":2,"skippedAssets":[],"skippedReason":null}"#)
        XCTAssertEqual(e.documents, 3)
        XCTAssertNil(e.skippedReason)

        let s = try decode([SupportRequest].self, #"""
        [{"number":42,"subject":"Sync","topic":"bug","topicLabel":"Something's broken","status":"pending","createdAt":1,"lastMessageAt":2,
          "messages":[{"id":"m1","from":"you","body":"Hi","createdAt":1},{"id":"m2","from":"support","body":"Hello","createdAt":2}]}]
        """#)
        XCTAssertEqual(s.first?.id, 42)
        XCTAssertEqual(s.first?.replyCount, 1)
        XCTAssertEqual(s.first?.statusLabel, "Replied")

        let b = try decode(DeletionBlockers.self, #"{"workspaces":[{"id":"w1","name":"Team","otherMembers":2}]}"#)
        XCTAssertEqual(b.workspaces.first?.otherMembers, 2)
    }

    func testProfileKeepsDeletionDate() throws {
        let p = try decode(Profile.self, #"""
        {"id":"p1","email":"a@x.com","displayName":"A","appearance":"system","locale":"en","timeZone":"UTC","onboardingStep":"done",
         "status":"pending_deletion","createdAt":1,"deletionScheduledFor":1700000000000}
        """#)
        XCTAssertEqual(p.deletionScheduledFor, 1_700_000_000_000)
    }
}

/// Notification preferences (the web's NotificationsSection): replies and access follow comments and shares
/// until set; in-app switches default on.
final class NotificationPrefsTests: XCTestCase {
    private let base = NotificationPrefs(mentions: true, comments: false, shares: true, invites: true, digest: "off", productEmail: false)

    func testEmailFollowsParentsUntilSet() {
        XCTAssertFalse(base.email(.replies))
        XCTAssertTrue(base.email(.access))
        var p = base
        p.replies = true
        XCTAssertTrue(p.email(.replies))
        p.invites = false
        XCTAssertFalse(p.email(.shares))
    }

    func testSettingSharesSetsInvites() {
        let p = base.settingEmail(.shares, false)
        XCTAssertFalse(p.shares)
        XCTAssertFalse(p.invites)
        XCTAssertTrue(base.settingEmail(.comments, true).comments)
    }

    func testInAppDefaultsOnAndWritesEveryKind() throws {
        XCTAssertTrue(NotificationTopic.allCases.allSatisfy { base.inAppOn($0) })
        let p = base.settingInApp(.mentions, false)
        XCTAssertFalse(p.inAppOn(.mentions))
        XCTAssertEqual(p.inApp, NotificationPrefs.InApp(comments: true, replies: true, mentions: false, shares: true, access: true))
        // Sent whole, as vNotificationPrefs expects (unset optional fields are left out).
        let json = try JSONValue(encoding: p)
        XCTAssertNil(json["replies"])
        XCTAssertEqual(json["inApp"]?["mentions"], .bool(false))
        XCTAssertEqual(NotificationTopic.shares.label, "Shares and invitations")
    }
}

/// Find and replace inside a note (the web's findReplace.ts).
final class FindReplaceTests: XCTestCase {
    private func para(_ text: [InlineNode]) -> Block {
        Block(id: "b1", parentId: nil, rank: "V", text: text, content: .paragraph(ParagraphProps()))
    }

    func testReplacesEveryOccurrenceIgnoringCase() {
        let r = FindReplace.replace(in: [.text(text: "Cat cat CAT", marks: nil)], query: "cat", with: "dog")
        XCTAssertEqual(r.count, 3)
        XCTAssertEqual(RichText.plainText(r.nodes), "dog dog dog")
    }

    func testLimitReplacesOnlyTheFirst() {
        let r = FindReplace.replace(in: [.text(text: "a-a-a", marks: nil)], query: "a", with: "b", limit: 1)
        XCTAssertEqual(r.count, 1)
        XCTAssertEqual(RichText.plainText(r.nodes), "b-a-a")
    }

    func testKeepsMarksAndMatchesAcrossRuns() {
        let nodes: [InlineNode] = [.text(text: "hel", marks: [.bold]), .text(text: "lo world", marks: nil)]
        let r = FindReplace.replace(in: nodes, query: "hello", with: "bye")
        XCTAssertEqual(r.count, 1)
        // The replacement carries the marks where the match started; the rest keeps its own.
        XCTAssertEqual(r.nodes, [.text(text: "bye", marks: [.bold]), .text(text: " world", marks: nil)])
    }

    func testNeverMatchesAcrossAtoms() {
        let nodes: [InlineNode] = [.text(text: "say ", marks: nil), .mention(userId: "u", label: "hi"), .text(text: " hi", marks: nil)]
        let r = FindReplace.replace(in: nodes, query: "hi", with: "yo")
        XCTAssertEqual(r.count, 1)
        XCTAssertEqual(r.nodes, [.text(text: "say ", marks: nil), .mention(userId: "u", label: "hi"), .text(text: " yo", marks: nil)])
    }

    func testEmptyReplacementDeletes() {
        let r = FindReplace.replace(in: [.text(text: "remove me please", marks: nil)], query: " me", with: "")
        XCTAssertEqual(RichText.plainText(r.nodes), "remove please")
    }

    func testBlocks() throws {
        let block = para([.text(text: "Find the thing, then the other thing", marks: nil)])
        XCTAssertEqual(FindReplace.count(of: "thing", in: block), 2)
        let replaced = try XCTUnwrap(FindReplace.replace(in: block, query: "thing", with: "item"))
        XCTAssertEqual(replaced.count, 2)
        XCTAssertEqual(RichText.plainText(replaced.block.text), "Find the item, then the other item")
        XCTAssertNil(FindReplace.replace(in: block, query: "absent", with: "x"))

        let code = Block(id: "c", parentId: nil, rank: "W", content: .code(CodeProps(language: "js", code: "let x = 1; x = 2")))
        let c = try XCTUnwrap(FindReplace.replace(in: code, query: "x", with: "y", limit: 1))
        guard case .code(let p) = c.block.content else { return XCTFail("still code") }
        XCTAssertEqual(p.code, "let y = 1; x = 2")

        let divider = Block(id: "d", parentId: nil, rank: "X", content: .divider(DividerProps()))
        XCTAssertNil(FindReplace.replace(in: divider, query: "x", with: "y"))
    }
}
