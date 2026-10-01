import XCTest

/// Comments, notifications and sharing: the server's shapes (convex/comments.ts, convex/notifications.ts,
/// convex/sharing.ts) and the web's comment text rules (apps/web/src/components/doc/MentionInput.tsx).
final class CollaborationTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private let threadsJSON = #"""
    {
      "threads": [
        {
          "id": "t1", "blockId": "b1", "blockExists": true, "blockText": "Plan the launch", "status": "open",
          "createdAt": 1000, "lastActivityAt": 3000, "resolvedBy": null, "resolvedAt": null, "unread": true,
          "canResolve": true, "canDelete": false,
          "comments": [
            {"id": "c1", "authorId": "p1", "authorName": "Ana", "authorAvatarUrl": "https://x/a.png",
             "body": [{"type": "text", "text": "Hi "}, {"type": "mention", "userId": "p2", "label": "Ben"}],
             "deleted": false, "createdAt": 1000, "editedAt": null, "mine": false, "canEdit": false, "canDelete": true},
            {"id": "c2", "authorId": "p2", "authorName": "Ben", "authorAvatarUrl": null, "body": [],
             "deleted": true, "createdAt": 3000, "editedAt": 3500, "mine": true, "canEdit": false, "canDelete": false}
          ]
        },
        {
          "id": "t2", "blockId": null, "blockExists": null, "blockText": null, "status": "resolved",
          "createdAt": 500, "lastActivityAt": 900, "resolvedBy": "Ana", "resolvedAt": 950, "unread": false,
          "canResolve": true, "canDelete": true,
          "comments": [{"id": "c3", "authorId": "p1", "authorName": "Ana", "authorAvatarUrl": null,
                        "body": [{"type": "text", "text": "Done"}], "deleted": false, "createdAt": 500,
                        "editedAt": null, "mine": true, "canEdit": true, "canDelete": true}]
        }
      ],
      "blocks": [{"blockId": "b1", "threads": 1, "comments": 1, "lastActivityAt": 3000, "unread": true,
                  "authors": [{"name": "Ana", "avatarUrl": "https://x/a.png"}]}],
      "canComment": true,
      "canManage": false
    }
    """#

    func testDecodesThreads() throws {
        let d = try decode(CommentsData.self, threadsJSON)
        XCTAssertEqual(d.threads.count, 2)
        XCTAssertTrue(d.canComment)
        XCTAssertFalse(d.canManage)
        let t = try XCTUnwrap(d.thread("t1"))
        XCTAssertEqual(t.blockId, "b1")
        XCTAssertEqual(t.blockExists, true)
        XCTAssertEqual(t.blockText, "Plan the launch")
        XCTAssertTrue(t.unread)
        XCTAssertFalse(t.canDelete)
        XCTAssertEqual(t.comments[0].authorAvatarUrl, "https://x/a.png")
        XCTAssertEqual(t.comments[0].body, [.text(text: "Hi ", marks: nil), .mention(userId: "p2", label: "Ben")])
        XCTAssertTrue(t.comments[1].deleted)
        XCTAssertEqual(t.comments[1].editedAt, 3500)
        let whole = try XCTUnwrap(d.thread("t2"))
        XCTAssertNil(whole.blockId)
        XCTAssertNil(whole.blockExists)
        XCTAssertTrue(whole.isResolved)
        XCTAssertEqual(whole.resolvedBy, "Ana")
        XCTAssertEqual(d.summary(for: "b1")?.comments, 1)
        XCTAssertEqual(d.summary(for: "b1")?.authors.first?.name, "Ana")
        XCTAssertTrue(d.hasUnreadOpen)
        XCTAssertEqual(d.openThreads.map(\.id), ["t1"])
        XCTAssertEqual(d.resolvedThreads.map(\.id), ["t2"])
    }

    func testEmptyWhenThePageIsntOnTheServer() throws {
        let d = try decode(CommentsData.self, #"{"threads": [], "blocks": [], "canComment": false, "canManage": false}"#)
        XCTAssertTrue(d.threads.isEmpty)
        XCTAssertFalse(d.hasUnreadOpen)
    }

    func testThreadToShowAndSiblings() throws {
        var d = try decode(CommentsData.self, threadsJSON)
        XCTAssertEqual(d.threadToShow(onBlock: "b1", chosen: nil)?.id, "t1")
        XCTAssertNil(d.threadToShow(onBlock: "b9", chosen: nil))
        d = d.creatingThread(blockId: "b1", body: [.text(text: "Second", marks: nil)], me: PersonFace(name: "Cy"), meId: "p3", now: 4000)
        let siblings = d.siblings(onBlock: "b1", showing: d.thread("t1"))
        XCTAssertEqual(siblings.count, 2)
        XCTAssertEqual(siblings.first?.id, "t1", "oldest first")
    }

    func testOptimisticCreateAndReplyBumpTheBlockLine() throws {
        let me = PersonFace(name: "Cy", avatarUrl: nil)
        var d = try decode(CommentsData.self, threadsJSON)
        d = d.creatingThread(blockId: "b2", body: [.text(text: "New", marks: nil)], me: me, meId: "p3", now: 5000)
        XCTAssertTrue(d.threads[0].isPending)
        XCTAssertTrue(d.threads[0].comments[0].isPending)
        XCTAssertEqual(d.summary(for: "b2")?.threads, 1)
        d = d.replying(threadId: "t1", body: [.text(text: "Reply", marks: nil)], me: me, meId: "p3", now: 6000)
        XCTAssertEqual(d.thread("t1")?.comments.count, 3)
        XCTAssertEqual(d.summary(for: "b1")?.comments, 2)
        XCTAssertEqual(d.summary(for: "b1")?.authors.first?.name, "Cy")
        XCTAssertEqual(d.summary(for: "b1")?.lastActivityAt, 6000)
    }

    func testOptimisticResolveDeleteAndRead() throws {
        var d = try decode(CommentsData.self, threadsJSON)
        d = d.resolving(threadId: "t1", resolved: true, by: "Ana", now: 7000)
        XCTAssertTrue(d.thread("t1")?.isResolved == true)
        XCTAssertEqual(d.thread("t1")?.resolvedBy, "Ana")
        XCTAssertNil(d.summary(for: "b1"), "a resolved thread leaves the block's line")
        d = d.resolving(threadId: "t1", resolved: false, by: "Ana", now: 7100)
        XCTAssertFalse(d.thread("t1")?.isResolved ?? true)
        d = d.markingThread("t1", unread: false)
        XCTAssertFalse(d.thread("t1")?.unread ?? true)
        d = d.deletingThread("t2")
        XCTAssertNil(d.thread("t2"))
    }

    func testDeletingTheLastCommentDeletesTheThread() throws {
        var d = try decode(CommentsData.self, threadsJSON)
        d = d.removing(commentId: "c3")
        XCTAssertNil(d.thread("t2"))
        d = d.removing(commentId: "c1")
        XCTAssertNil(d.thread("t1"), "c2 was already deleted, so t1 has nothing left")
        XCTAssertNil(d.summary(for: "b1"))
    }

    func testEditKeepsTheThread() throws {
        var d = try decode(CommentsData.self, threadsJSON)
        d = d.editing(commentId: "c3", body: [.text(text: "Done!", marks: nil)], now: 8000)
        XCTAssertEqual(d.thread("t2")?.comments[0].body, [.text(text: "Done!", marks: nil)])
        XCTAssertEqual(d.thread("t2")?.comments[0].editedAt, 8000)
    }

    // MARK: Comment text

    private let people = [
        MentionPerson(profileId: "p1", displayName: "Ana", isYou: false, guest: false),
        MentionPerson(profileId: "p2", displayName: "Ana Lima", isYou: false, guest: true),
        MentionPerson(profileId: "p3", displayName: "Bo", isYou: true, guest: false),
    ]

    func testBodyTurnsAtNamesIntoMentions() {
        let body = CommentText.body(from: "Hey @ana lima and @Bo, see this", picked: [], people: people)
        XCTAssertEqual(body, [
            .text(text: "Hey ", marks: nil),
            .mention(userId: "p2", label: "Ana Lima"),
            .text(text: " and ", marks: nil),
            .mention(userId: "p3", label: "Bo"),
            .text(text: ", see this", marks: nil),
        ])
    }

    func testPickedPersonWinsAndWordsMustEnd() {
        let picked = [people[0]]
        XCTAssertEqual(CommentText.body(from: "@Ana Lima", picked: picked, people: people),
                       [.mention(userId: "p1", label: "Ana"), .text(text: " Lima", marks: nil)])
        XCTAssertEqual(CommentText.body(from: "@Bob", picked: [], people: people), [.text(text: "@Bob", marks: nil)])
        XCTAssertEqual(CommentText.body(from: "mail@Bo", picked: [], people: people), [.text(text: "mail@Bo", marks: nil)])
    }

    func testEditableTextRoundTrips() {
        let body: [InlineNode] = [.text(text: "Hi ", marks: nil), .mention(userId: "p3", label: "Bo"), .text(text: "!", marks: nil)]
        let text = CommentText.editableText(body)
        XCTAssertEqual(text, "Hi @Bo!")
        XCTAssertEqual(CommentText.body(from: text, picked: [], people: people), body)
    }

    func testMentionQueryAndInsert() throws {
        XCTAssertNil(CommentText.mentionQuery(in: "hello", caret: 5))
        let q = try XCTUnwrap(CommentText.mentionQuery(in: "Hi @an", caret: 6))
        XCTAssertEqual(q.start, 3)
        XCTAssertEqual(q.query, "an")
        XCTAssertEqual(CommentText.mentionQuery(in: "Hi @", caret: 4)?.query, "")
        XCTAssertNil(CommentText.mentionQuery(in: "a@b", caret: 3), "only after a space or at the start")
        let inserted = CommentText.insertMention("Ana Lima", into: "Hi @an!", start: 3, caret: 6)
        XCTAssertEqual(inserted.text, "Hi @Ana Lima !")
        XCTAssertEqual(inserted.caret, 13)
        XCTAssertEqual(CommentText.matches("an", in: people).map(\.profileId), ["p1", "p2"])
        XCTAssertEqual(CommentText.matches("", in: people).count, 3)
    }

    func testCommentLineLabel() {
        XCTAssertTrue(CollabTime.commentLineLabel(count: 1, lastActivityAt: 0).hasPrefix("1 comment · "))
        XCTAssertTrue(CollabTime.commentLineLabel(count: 2, lastActivityAt: 0).hasPrefix("2 comments · "))
    }

    // MARK: Notifications

    func testDecodesNotifications() throws {
        let list = try decode([AppNotification].self, #"""
        [
          {"id": "n1", "kind": "comment", "title": "Ana commented on Plan", "body": "Looks good", "fileId": null,
           "actorName": "Ana", "actorAvatarUrl": null, "documentId": "d1", "documentTitle": "Plan", "threadId": "t1",
           "blockId": "b1", "commentId": "c1", "count": 3, "inviteId": null, "pageInviteId": null,
           "createdAt": 1700000000000, "read": false},
          {"id": "n2", "kind": "share", "title": "Ben shared Notes with you", "body": null, "fileId": null,
           "actorName": "Ben", "actorAvatarUrl": "https://x/b.png", "documentId": null, "documentTitle": null,
           "threadId": null, "blockId": null, "commentId": null, "count": 1, "inviteId": null, "pageInviteId": "pi1",
           "createdAt": 1700000000000, "read": true},
          {"id": "n3", "kind": "system", "title": "Your export is ready", "body": null, "fileId": "f1",
           "actorName": null, "actorAvatarUrl": null, "documentId": null, "documentTitle": null, "threadId": null,
           "blockId": null, "commentId": null, "count": 1, "inviteId": null, "pageInviteId": null,
           "createdAt": 1700000000000, "read": false}
        ]
        """#)
        XCTAssertEqual(list.count, 3)
        XCTAssertEqual(list[0].plainSentence, "Ana left 3 comments on Plan")
        XCTAssertEqual(list[0].threadId, "t1")
        XCTAssertEqual(list[0].count, 3)
        XCTAssertNil(list[1].sentence, "no readable note: the stored title")
        XCTAssertEqual(list[1].plainSentence, "Ben shared Notes with you")
        XCTAssertEqual(list[1].pageInviteId, "pi1")
        XCTAssertEqual(list[2].fileId, "f1")
        XCTAssertEqual(list[2].plainSentence, "Your export is ready")
    }

    func testNotificationSentences() throws {
        func item(_ kind: String, count: Int = 1) throws -> AppNotification {
            try decode(AppNotification.self, #"{"id":"n","kind":"\#(kind)","title":"T","actorName":"Ana","documentTitle":"Plan","count":\#(count),"createdAt":0,"read":false}"#)
        }
        XCTAssertEqual(try item("comment").plainSentence, "Ana commented on Plan")
        XCTAssertEqual(try item("reply").plainSentence, "Ana replied in Plan")
        XCTAssertEqual(try item("reply", count: 2).plainSentence, "Ana replied 2 times in Plan")
        XCTAssertEqual(try item("mention").plainSentence, "Ana mentioned you in Plan")
        XCTAssertEqual(try item("share").plainSentence, "Ana shared Plan with you")
        XCTAssertEqual(try item("share_change").plainSentence, "T")
    }

    func testNotificationGroups() throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let now = Date(timeIntervalSince1970: 1_700_000_000) // 2023-11-14 22:13 UTC
        let startOfToday = cal.startOfDay(for: now).timeIntervalSince1970 * 1000
        func item(_ id: String, _ at: Double) throws -> AppNotification {
            try decode(AppNotification.self, #"{"id":"\#(id)","kind":"system","title":"T","createdAt":\#(at),"read":false}"#)
        }
        let groups = NotificationGroups.group([try item("a", startOfToday + 1000), try item("b", startOfToday - 1000), try item("c", startOfToday - 90_000_000)],
                                              now: now, calendar: cal)
        XCTAssertEqual(groups.map(\.label), ["Today", "Yesterday", "Earlier"])
        XCTAssertEqual(groups.map { $0.rows.map(\.id) }, [["a"], ["b"], ["c"]])
        XCTAssertTrue(NotificationGroups.group([], now: now, calendar: cal).isEmpty)
    }

    func testDecodesNoteSubscription() throws {
        let sub = try decode(NoteSubscription.self, #"{"mode": "follow", "isAuthor": false}"#)
        XCTAssertEqual(sub.mode, "follow")
        XCTAssertNil(try decode(NoteSubscription?.self, "null"))
    }

    // MARK: Sharing

    func testDecodesShareInfoForAManager() throws {
        let info = try decode(ShareInfo.self, #"""
        {
          "accessMode": "restricted", "yourAccess": "manage", "canManage": true, "canShare": true, "maxRole": "editor",
          "youAreGuest": false, "ownerName": "Ana", "sharedBy": null,
          "people": [{"profileId": "p2", "displayName": "Ben", "email": "ben@example.com", "role": "commenter",
                      "guest": true, "isYou": false, "canChange": true}],
          "pendingInvites": [{"id": "i1", "email": "cy@example.com", "role": "viewer", "expiresAt": 1, "expired": true}],
          "links": [{"id": "l1", "tokenHint": "ab12", "expiresAt": null, "expired": false, "hasPassword": true,
                     "allowIndexing": false, "viewCount": 4, "createdAt": 1}],
          "publicLinksAvailable": true
        }
        """#)
        XCTAssertEqual(info.accessMode, "restricted")
        XCTAssertTrue(info.canManage)
        XCTAssertEqual(info.people.first?.email, "ben@example.com")
        XCTAssertTrue(info.people.first?.guest == true)
        XCTAssertEqual(info.pendingInvites.first?.expired, true)
        XCTAssertEqual(info.links.first?.viewCount, 4)
        XCTAssertEqual(info.assignableRoles, [.viewer, .commenter, .editor])
    }

    func testMembersShareUpToTheirRoleAndGuestsNever() throws {
        let member = try decode(ShareInfo.self, #"{"accessMode":"workspace","yourAccess":"comment","canManage":false,"canShare":true,"maxRole":"commenter","youAreGuest":false,"people":[],"pendingInvites":[],"links":[],"publicLinksAvailable":false}"#)
        XCTAssertEqual(member.assignableRoles, [.viewer, .commenter])
        let guest = try decode(ShareInfo.self, #"{"accessMode":"workspace","yourAccess":"read","canManage":false,"canShare":false,"maxRole":null,"youAreGuest":true,"ownerName":"Ana","sharedBy":"Ben","people":[{"profileId":"me","displayName":"Me","email":null,"role":"viewer","guest":true,"isYou":true,"canChange":false}],"pendingInvites":[],"links":[],"publicLinksAvailable":true}"#)
        XCTAssertTrue(guest.assignableRoles.isEmpty)
        XCTAssertTrue(guest.youAreGuest)
        XCTAssertEqual(guest.sharedBy, "Ben")
        XCTAssertNil(guest.people.first?.email)
        XCTAssertEqual(ShareRole.label("editor"), "Can edit")
        XCTAssertEqual(ShareRole.label("commenter"), "Can comment")
        XCTAssertEqual(ShareRole.label("viewer"), "Can view")
    }

    func testDecodesMutationResults() throws {
        XCTAssertEqual(try decode(GrantResult.self, #"{"status":"invited"}"#).status, "invited")
        XCTAssertEqual(try decode(PublicLinkCreated.self, #"{"id":"l1","token":"tok"}"#).token, "tok")
        XCTAssertEqual(try decode(AcceptedPageInvite.self, #"{"documentId":"d9"}"#).documentId, "d9")
        XCTAssertTrue(try decode(CommentRemoved.self, #"{"threadDeleted":true}"#).threadDeleted)
        XCTAssertEqual(try decode([MentionPerson].self, #"[{"profileId":"p1","displayName":"Ana","isYou":true,"guest":false}]"#).first?.isYou, true)
    }

    func testCommentBodyEncodesForTheServer() throws {
        let body = CommentText.body(from: "Hi @Bo", picked: [], people: people)
        let json = try JSONValue(encoding: body)
        XCTAssertEqual(json.canonicalString, #"[{"text":"Hi ","type":"text"},{"label":"Bo","type":"mention","userId":"p3"}]"#)
    }
}
