// Unit tests for the native parts' logic, run in the app (its entitlements give them the App Group and the
// Keychain group): the REST API client's answers, folevi:// links (the same cases as the web's
// test/native-app.test.tsx), what a share becomes, the share queue, the device token in the Keychain, the
// widgets' copy and their timeline, and Spotlight's excerpts.
//
//   xcodebuild test -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=Folevi iPhone 18 Pro'
import CoreSpotlight
import UserNotifications
import WidgetKit
import XCTest
@testable import App

/// Answers the API client's requests from a table, and remembers what was asked.
final class StubAPI: URLProtocol {
    nonisolated(unsafe) static var answers: [String: (Int, String)] = [:]
    nonisolated(unsafe) static var requests: [URLRequest] = []
    nonisolated(unsafe) static var offline = false

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubAPI.self]
        return URLSession(configuration: config)
    }

    static func reset() {
        answers = [:]
        requests = []
        offline = false
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var seen = request
        if let stream = request.httpBodyStream {
            stream.open()
            var body = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                body.append(buffer, count: n)
            }
            stream.close()
            seen.httpBody = body
        }
        Self.requests.append(seen)
        if Self.offline {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        let (status, body) = Self.answers[key] ?? (404, #"{"error":{"code":"not_found","message":"There's no such endpoint."}}"#)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json", "Retry-After": "12"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private let base = URL(string: "https://app.folevi.test/api/v1")!
private func api() -> FoleviAPI { FoleviAPI(base: base, token: "fvpat_test", session: StubAPI.session()) }

private let tasksJSON = """
{"data":[
 {"id":"t1","text":"Later today","status":"open","dueDate":"2026-10-15","dueTime":"17:00","priority":"none","assigneeId":null,"note":{"id":"01J9ZQ4K8W2M3N4P5Q6R7S8T9V","title":"Inbox","url":"x"},"place":{"id":"personal","name":"Personal"},"url":"x"},
 {"id":"t2","text":"Overdue","status":"open","dueDate":"2026-10-12","dueTime":null,"priority":"low","assigneeId":null,"note":{"id":"01J9ZQ4K8W2M3N4P5Q6R7S8T9V","title":"Inbox","url":"x"},"place":{"id":"personal","name":"Personal"},"url":"x"},
 {"id":"t3","text":"Morning","status":"open","dueDate":"2026-10-15","dueTime":"08:00","priority":"high","assigneeId":null,"note":{"id":"01J9ZQ4K8W2M3N4P5Q6R7S8T9V","title":"Inbox","url":"x"},"place":{"id":"personal","name":"Personal"},"url":"x"},
 {"id":"t4","text":"Anytime","status":"open","dueDate":"2026-10-15","dueTime":null,"priority":"high","assigneeId":null,"note":{"id":"01J9ZQ4K8W2M3N4P5Q6R7S8T9V","title":"Inbox","url":"x"},"place":{"id":"personal","name":"Personal"},"url":"x"}
],"nextCursor":null}
"""
private let notesJSON = #"{"data":[{"id":"01J9ZQ4K8W2M3N4P5Q6R7S8T9V","title":"Weekly review","place":{"id":"personal","name":"Personal"},"updatedAt":"2026-10-15T09:30:00.000Z","url":"https://app.folevi.com/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V"}],"nextCursor":null}"#

final class APIClientTests: XCTestCase {
    override func setUp() { StubAPI.reset() }

    func testDecodesPlacesNotesAndTasks() async throws {
        StubAPI.answers["GET /api/v1/places"] = (200, #"{"data":[{"id":"personal","name":"Personal"},{"id":"w1","name":"Studio"}]}"#)
        StubAPI.answers["GET /api/v1/notes"] = (200, notesJSON)
        StubAPI.answers["GET /api/v1/tasks"] = (200, tasksJSON)
        let places = try await api().places()
        XCTAssertEqual(places, [Place(id: "personal", name: "Personal"), Place(id: "w1", name: "Studio")])
        let notes = try await api().recentNotes(limit: 5)
        XCTAssertEqual(notes.first?.title, "Weekly review")
        XCTAssertEqual(notes.first?.place.name, "Personal")
        XCTAssertNotNil(DayFormat.instant(notes[0].updatedAt))
        let tasks = try await api().openTasks(dueBefore: "2026-10-15")
        XCTAssertEqual(tasks.map(\.id), ["t1", "t2", "t3", "t4"])
        // The token goes in the header, and the query says what's wanted.
        let asked = StubAPI.requests.last!
        XCTAssertEqual(asked.value(forHTTPHeaderField: "Authorization"), "Bearer fvpat_test")
        XCTAssertEqual(asked.url?.query, "due_before=2026-10-15&limit=200&status=open")
    }

    func testWritesSendJSONWithAnIdempotencyKey() async throws {
        StubAPI.answers["POST /api/v1/notes"] = (201, #"{"id":"01J9ZQ4K8W2M3N4P5Q6R7S8T9V","title":"Shelf","place":{"id":"personal","name":"Personal"},"inInbox":true,"url":"u"}"#)
        StubAPI.answers["PATCH /api/v1/tasks/t1"] = (200, #"{"id":"t1","completed":true,"dueDate":null,"dueTime":null,"priority":"none"}"#)
        let note = try await api().createNote(title: "Shelf", markdown: "<https://example.com>", place: "w1", key: "k1")
        XCTAssertEqual(note.id, "01J9ZQ4K8W2M3N4P5Q6R7S8T9V")
        let sent = StubAPI.requests.last!
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Idempotency-Key"), "k1")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try JSONSerialization.jsonObject(with: sent.httpBody!) as! [String: Any]
        XCTAssertEqual(body["inInbox"] as? Bool, true)
        XCTAssertEqual(body["place"] as? String, "w1")
        try await api().setTask("t1", completed: true)
        XCTAssertEqual(StubAPI.requests.last?.httpMethod, "PATCH")
    }

    func testFailures() async {
        StubAPI.answers["GET /api/v1/places"] = (401, #"{"error":{"code":"unauthorized","message":"This token isn't valid."}}"#)
        await XCTAssertThrowsFailure(try await api().places(), .signedOut)
        StubAPI.answers["GET /api/v1/places"] = (429, #"{"error":{"code":"rate_limited","message":"Too many"}}"#)
        await XCTAssertThrowsFailure(try await api().places(), .rateLimited(retryAfter: 12))
        StubAPI.answers["GET /api/v1/places"] = (422, #"{"error":{"code":"validation_failed","message":"Say what the task is."}}"#)
        await XCTAssertThrowsFailure(try await api().places(), .refused(status: 422, code: "validation_failed", message: "Say what the task is."))
        StubAPI.answers["GET /api/v1/places"] = (200, "not json")
        await XCTAssertThrowsFailure(try await api().places(), .malformed)
        StubAPI.offline = true
        await XCTAssertThrowsFailure(try await api().places(), .offline)
        XCTAssertTrue(FoleviAPI.Failure.offline.isTemporary)
        XCTAssertTrue(FoleviAPI.Failure.refused(status: 503, code: "unavailable", message: "").isTemporary)
        XCTAssertFalse(FoleviAPI.Failure.signedOut.isTemporary)
    }
}

func XCTAssertThrowsFailure<T>(_ expression: @autoclosure () async throws -> T, _ expected: FoleviAPI.Failure, file: StaticString = #filePath, line: UInt = #line) async {
    do {
        _ = try await expression()
        XCTFail("No error", file: file, line: line)
    } catch {
        XCTAssertEqual(error as? FoleviAPI.Failure, expected, file: file, line: line)
    }
}

final class DeepLinkTests: XCTestCase {
    /// The web's cases (test/native-app.test.tsx), with what apps/web/src/lib/deepLink.ts makes of them.
    func testReadsLinksAsThePageDoes() {
        let expected: [(String, DeepLink?)] = [
            ("folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V", .open(path: "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V")),
            ("folevi://d/01j9zq4k8w2m3n4p5q6r7s8t9v#blockA1", .open(path: "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#blockA1")),
            ("folevi:///d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V", .open(path: "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V")),
            ("folevi://d/inbox-2d0a97ae3b345608", .open(path: "/d/inbox-2d0a97ae3b345608")),
            ("folevi://d/INBOX-2D0A97AE3B345608", nil),
            ("folevi://d/inbox-../x", nil),
            ("folevi://tasks/today", .open(path: "/tasks/today")),
            ("folevi://settings/this-device", .open(path: "/settings/this-device")),
            ("folevi://foli-ai", .open(path: "/foli-ai")),
            ("folevi://new", .newNote),
            ("folevi://quick-add", .quickAdd),
            ("folevi://", .open(path: "/documents")),
            ("folevi://inbox", .open(path: "/inbox")),
            ("folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#block-01J9ZQ4K8W2M3N4P5Q6R7S8T9W", .open(path: "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#block-01J9ZQ4K8W2M3N4P5Q6R7S8T9W")),
            ("folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#comment-k57abc", .open(path: "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#comment-k57abc")),
            ("folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#other-01J9", .open(path: "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V")),
            ("folevi://d/not-an-id", nil),
            ("folevi://admin", nil),
            ("folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V/extra", nil),
            ("folevi://tasks/a/b/c", nil),
            ("folevi://new/x", nil),
            ("folevi://..%2F..%2Fetc", nil),
            ("folevi://tasks/%E0%A4", nil),
            ("https://app.folevi.com/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V", nil),
            ("javascript:alert(1)", nil),
            ("folevi://tasks/" + String(repeating: "a", count: 700), nil),
        ]
        for (link, want) in expected { XCTAssertEqual(DeepLink.parse(link), want, link) }
    }

    func testWhatNativeCodeOpens() {
        for url in [DeepLink.note("01J9ZQ4K8W2M3N4P5Q6R7S8T9V"), DeepLink.newNoteURL, DeepLink.quickAddURL, DeepLink.todayURL, DeepLink.tasksURL] {
            XCTAssertNotNil(DeepLink.parse(url.absoluteString), url.absoluteString)
        }
        XCTAssertEqual(DeepLink.fromWeb(URL(string: "https://app.folevi.com/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V")!)?.absoluteString, "folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V")
        XCTAssertNil(DeepLink.fromWeb(URL(string: "https://app.folevi.com/settings")!))
    }

    @MainActor
    func testSpotlightResultsAndIntentsBecomeLinks() {
        let activity = NSUserActivity(activityType: CSSearchableItemActionType)
        activity.userInfo = [CSSearchableItemActivityIdentifier: "01J9ZQ4K8W2M3N4P5Q6R7S8T9V"]
        XCTAssertEqual(DeepLinkRouter.link(for: activity)?.absoluteString, "folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V")
        activity.userInfo = [CSSearchableItemActivityIdentifier: "inbox-2d0a97ae3b345608"]
        XCTAssertEqual(DeepLinkRouter.link(for: activity)?.absoluteString, "folevi://d/inbox-2d0a97ae3b345608")
        activity.userInfo = [CSSearchableItemActivityIdentifier: "../settings"]
        XCTAssertNil(DeepLinkRouter.link(for: activity))
        XCTAssertNil(DeepLinkRouter.link(for: NSUserActivity(activityType: "com.example.other")))

        // An intent run where the page can't be reached leaves its link for the app.
        let handler = PendingLink.handler
        PendingLink.handler = nil
        PendingLink.open(DeepLink.todayURL)
        XCTAssertEqual(PendingLink.take(), DeepLink.todayURL)
        XCTAssertNil(PendingLink.take())
        PendingLink.handler = handler
    }
}

final class ShareTests: XCTestCase {
    private var root: URL!

    override func setUp() {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("shares-\(UUID().uuidString)")
        StubAPI.reset()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
    }

    func testTidiesWhatWasSharedLikeTheWebApp() {
        let safari = ShareContent.tidy(title: "Field notes", text: "Look here https://example.com/field", url: nil)
        XCTAssertEqual(safari, ShareContent(title: "Field notes", text: "Look here", url: "https://example.com/field"))
        XCTAssertEqual(safari.markdown, "<https://example.com/field>\n\nLook here")
        let linkOnly = ShareContent.tidy(title: "https://www.example.com/a/", text: nil, url: "https://www.example.com/a/")
        XCTAssertEqual(linkOnly.title, "example.com/a")
        XCTAssertEqual(linkOnly.markdown, "<https://www.example.com/a/>")
        let text = ShareContent.tidy(title: nil, text: "Groceries\nEggs\nMilk", url: nil)
        XCTAssertEqual(text.title, "Groceries")
        XCTAssertEqual(text.markdown, "Groceries\n\nEggs\n\nMilk")
        XCTAssertNil(text.url)
        XCTAssertNil(ShareContent.webLink("javascript:alert(1)"))
        XCTAssertEqual(ShareContent.webLink("https://example.com/x)."), "https://example.com/x")
    }

    func testTheQueueKeepsSharesWithTheirFilesUntilTheyreSaved() throws {
        let queue = ShareQueue(root: root)
        let big = Data(count: ShareQueue.maxFileBytes + 1)
        let (share, skipped) = try queue.add(title: "Receipt", text: "", url: "", place: "w1", accountId: "acct", files: [(name: "r.jpg", type: "image/jpeg", data: Data([1, 2, 3])), (name: "huge.pdf", type: "application/pdf", data: big)])
        XCTAssertEqual(skipped, ["huge.pdf"])
        let all = queue.all()
        XCTAssertEqual(all, [share])
        XCTAssertEqual(all[0].place, "w1")
        XCTAssertEqual(queue.data(of: all[0].files[0], in: all[0]), Data([1, 2, 3]))
        // Protected until the device is first unlocked, like the token (the Simulator has no data protection).
        let attributes = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent(share.id).appendingPathComponent("0").path)
        #if !targetEnvironment(simulator)
        XCTAssertEqual(attributes[.protectionKey] as? FileProtectionType, .completeUntilFirstUserAuthentication)
        #endif
        XCTAssertNotNil(attributes[.size])
        queue.remove("../\(share.id)")
        XCTAssertEqual(queue.all().count, 1)
        queue.remove(share.id)
        XCTAssertEqual(queue.all(), [])
    }

    func testSavingGoesStraightToFolevi_orIsKeptForTheApp() async throws {
        let queue = ShareQueue(root: root)
        let content = ShareContent.tidy(title: "Shelf ideas", text: "Oak", url: "https://example.com/shelf")
        StubAPI.answers["POST /api/v1/notes"] = (201, #"{"id":"01J9ZQ4K8W2M3N4P5Q6R7S8T9V","title":"Shelf ideas","place":null,"inInbox":true,"url":"u"}"#)
        let online = ShareSaver(queue: queue, api: api(), accountId: "acct")
        var outcome = try await online.save(content, place: nil, files: [])
        XCTAssertEqual(outcome, .sent(noteId: "01J9ZQ4K8W2M3N4P5Q6R7S8T9V"))
        XCTAssertEqual(queue.all(), [])
        // Images and PDFs go through the app (the REST API can't upload them).
        outcome = try await online.save(content, place: nil, files: [(name: "a.png", type: "image/png", data: Data([9]))])
        XCTAssertEqual(outcome, .queued)
        // Offline, signed out, or refused: kept, never lost.
        StubAPI.offline = true
        outcome = try await online.save(content, place: "w1", files: [])
        XCTAssertEqual(outcome, .queued)
        outcome = try await ShareSaver(queue: queue, api: nil, accountId: nil).save(content, place: nil, files: [])
        XCTAssertEqual(outcome, .queued)
        StubAPI.offline = false
        StubAPI.answers["POST /api/v1/notes"] = (403, #"{"error":{"code":"forbidden","message":"This token can't use the place."}}"#)
        outcome = try await online.save(content, place: "gone", files: [])
        XCTAssertEqual(outcome, .queued)
        XCTAssertEqual(queue.all().map(\.title), ["Shelf ideas", "Shelf ideas", "Shelf ideas", "Shelf ideas"])
        XCTAssertEqual(queue.all().map(\.place), [nil, "w1", nil, "gone"])
        XCTAssertEqual(queue.all().map(\.accountId), ["acct", "acct", nil, "acct"])
    }
}

final class CredentialTests: XCTestCase {
    func testTheTokenIsKeptInTheSharedKeychainGroup() {
        XCTAssertNotNil(Folevi.keychainGroup, "Info.plist names the Keychain group")
        let credential = DeviceCredential(service: "com.folevi.tests.\(UUID().uuidString)", accessGroup: Folevi.keychainGroup)
        XCTAssertNil(credential.token)
        XCTAssertTrue(credential.store("fvpat_first"))
        XCTAssertEqual(credential.token, "fvpat_first")
        credential.token = "fvpat_second"
        XCTAssertEqual(credential.token, "fvpat_second")
        credential.token = nil
        XCTAssertNil(credential.token)
    }

    func testTheAppGroupIsThere() {
        XCTAssertNotNil(FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Folevi.appGroup), "the App Group entitlement")
        XCTAssertFalse(SharedAccount.deviceId.isEmpty)
        XCTAssertEqual(SharedAccount.deviceId, SharedAccount.deviceId)
    }
}

final class WidgetTests: XCTestCase {
    private var store: WidgetStore!
    private var file: URL!

    override func setUp() {
        StubAPI.reset()
        file = FileManager.default.temporaryDirectory.appendingPathComponent("widgets-\(UUID().uuidString).json")
        store = WidgetStore(file: file)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: file)
    }

    private static let day: Date = {
        var c = DateComponents()
        (c.year, c.month, c.day, c.hour) = (2026, 10, 15, 12)
        return Calendar.current.date(from: c)!
    }()

    func testOrdersOverdueFirstThenByTimeThenPriority() async throws {
        StubAPI.answers["GET /api/v1/tasks"] = (200, tasksJSON)
        StubAPI.answers["GET /api/v1/notes"] = (200, notesJSON)
        let snapshot = await store.refresh(api: api(), now: Self.day)
        XCTAssertEqual(snapshot.state, .ready)
        XCTAssertEqual(snapshot.day, "2026-10-15")
        XCTAssertEqual(snapshot.openTasks.map(\.text), ["Overdue", "Morning", "Later today", "Anytime"])
        XCTAssertTrue(snapshot.isOverdue(snapshot.tasks[0], now: Self.day))
        XCTAssertEqual(store.load(), snapshot)
    }

    func testACheckShowsAtOnceAndWaitsWhileOffline() async throws {
        StubAPI.answers["GET /api/v1/tasks"] = (200, tasksJSON)
        StubAPI.answers["GET /api/v1/notes"] = (200, notesJSON)
        await store.refresh(api: api(), now: Self.day)
        StubAPI.offline = true
        await store.setTask("t3", completed: true, api: api())
        XCTAssertEqual(store.load().pending, ["t3": true])
        XCTAssertFalse(store.load().openTasks.contains { $0.id == "t3" })
        // Back online: the check is sent first, then everything is fetched again.
        StubAPI.offline = false
        StubAPI.answers["PATCH /api/v1/tasks/t3"] = (200, #"{"id":"t3","completed":true}"#)
        StubAPI.answers["GET /api/v1/tasks"] = (200, tasksJSON.replacingOccurrences(of: #"{"id":"t3","#, with: #"{"id":"t3x","#))
        let after = await store.refresh(api: api(), now: Self.day)
        XCTAssertEqual(after.pending, [:])
        XCTAssertTrue(StubAPI.requests.contains { $0.httpMethod == "PATCH" && $0.url?.path == "/api/v1/tasks/t3" })
    }

    func testOfflineKeepsTheCopy_andARevokedTokenSignsOut() async {
        StubAPI.answers["GET /api/v1/tasks"] = (200, tasksJSON)
        StubAPI.answers["GET /api/v1/notes"] = (200, notesJSON)
        let first = await store.refresh(api: api(), now: Self.day)
        StubAPI.offline = true
        let offline = await store.refresh(api: api(), now: Self.day.addingTimeInterval(3600))
        XCTAssertEqual(offline.tasks, first.tasks)
        XCTAssertEqual(offline.state, .ready)
        StubAPI.offline = false
        let signedOut = await store.refresh(api: nil)
        XCTAssertEqual(signedOut.state, .signedOut)
    }

    func testTheTimelineProviderServesTheCopyAndLooksAgainSoon() async {
        StubAPI.answers["GET /api/v1/tasks"] = (200, tasksJSON)
        StubAPI.answers["GET /api/v1/notes"] = (200, notesJSON)
        let provider = FoleviTimelineProvider(store: store, api: { api() }, now: { Self.day })
        let timeline = await provider.timeline()
        XCTAssertEqual(timeline.entries.count, 1)
        XCTAssertEqual(timeline.entries[0].snapshot.openTasks.count, 4)
        XCTAssertEqual(timeline.entries[0].snapshot.notes.map(\.title), ["Weekly review"])
        XCTAssertEqual(timeline.policy, .after(Self.day.addingTimeInterval(20 * 60)))
        // Fresh: served from the copy, no request.
        let asked = StubAPI.requests.count
        _ = await provider.timeline()
        XCTAssertEqual(StubAPI.requests.count, asked)
        // Signed out: the widgets say so.
        let signedOut = await FoleviTimelineProvider(store: store, api: { nil }, now: { Self.day }).timeline()
        XCTAssertEqual(signedOut.entries[0].snapshot.state, .signedOut)
    }
}

final class SpotlightTests: XCTestCase {
    func testExcerptsAreTheNotesFirstLinesAsPlainText() {
        let markdown = "# Plan\n\n- [ ] Call **Sam** about [the venue](https://example.com)\n![photo](x.png)\n| a | b |\n> Keep it *small*.\n"
        XCTAssertEqual(SpotlightIndex.excerpt(markdown), "Plan Call Sam about the venue Keep it small.")
        XCTAssertLessThanOrEqual(SpotlightIndex.excerpt(String(repeating: "word ", count: 200)).count, 300)
    }

    func testAnItemSaysWhereTheNoteIs() {
        let note = NoteDetail(id: "01J9ZQ4K8W2M3N4P5Q6R7S8T9V", title: "Acme brief", folder: .init(id: "f", name: "Clients", path: "Work / Clients"), place: .init(id: "personal", name: "Personal"), updatedAt: "2026-10-15T09:30:00.000Z", markdown: "Kick-off on Monday.")
        let item = SpotlightIndex.item(note, starred: true)
        XCTAssertEqual(item.uniqueIdentifier, note.id)
        XCTAssertEqual(item.domainIdentifier, SpotlightIndex.domain)
        XCTAssertEqual(item.attributeSet.title, "Acme brief")
        XCTAssertEqual(item.attributeSet.contentDescription, "Kick-off on Monday.")
        XCTAssertEqual(item.attributeSet.containerDisplayName, "Work / Clients")
        XCTAssertEqual(item.attributeSet.keywords, ["Personal", "Clients", "starred"])
    }
}

/// Notifications from Folevi (Native/PushNotifications.swift): the payload as convex/lib/apns.ts sends it.
final class NotificationTests: XCTestCase {
    private let reminder: [AnyHashable: Any] = [
        "aps": ["alert": ["title": "Reminder: Take the bins out", "body": "In House jobs"], "category": "REMINDER", "thread-id": "01J9ZQ4K8W2M3N4P5Q6R7S8T9V"],
        "kind": "reminder",
        "path": "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#block-01J9ZQ4K8W2M3N4P5Q6R7S8T9W",
        "taskId": "01J9ZQ4K8W2M3N4P5Q6R7S8T9W",
    ]

    func testTheCategoriesAndTheirButtons() {
        let categories = Dictionary(uniqueKeysWithValues: PushPayload.categories.map { ($0.identifier, $0) })
        XCTAssertEqual(Set(categories.keys), ["REMINDER", "MENTION"])
        XCTAssertEqual(categories["REMINDER"]?.actions.map(\.identifier), [PushPayload.doneAction, PushPayload.snoozeAction])
        XCTAssertEqual(categories["REMINDER"]?.actions.map(\.title), ["Done", "Snooze 1 hour"])
        // Done and Snooze work without opening the app; Open brings it up.
        XCTAssertFalse(categories["REMINDER"]!.actions.contains { $0.options.contains(.foreground) })
        XCTAssertEqual(categories["MENTION"]?.actions.map(\.title), ["Open"])
        XCTAssertTrue(categories["MENTION"]!.actions[0].options.contains(.foreground))
    }

    func testTappingOpensTheNoteAtTheBlock_aColdLaunchToo() {
        let route = NotificationRoute.from(userInfo: reminder, action: UNNotificationDefaultActionIdentifier)
        XCTAssertEqual(route, .open(URL(string: "folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#block-01J9ZQ4K8W2M3N4P5Q6R7S8T9W")!))
        // The link is one the page opens (the same parser as every folevi:// link).
        if case .open(let url) = route {
            XCTAssertEqual(DeepLink.parse(url.absoluteString), .open(path: "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#block-01J9ZQ4K8W2M3N4P5Q6R7S8T9W"))
        }
        let mention: [AnyHashable: Any] = ["kind": "mention", "path": "/d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V"]
        XCTAssertEqual(NotificationRoute.from(userInfo: mention, action: PushPayload.openAction), .open(URL(string: "folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V")!))
        XCTAssertEqual(NotificationRoute.from(userInfo: ["path": "/tasks/today"], action: UNNotificationDefaultActionIdentifier), .open(URL(string: "folevi://tasks/today")!))
    }

    func testDoneAndSnoozeChangeTheTask() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(NotificationRoute.from(userInfo: reminder, action: PushPayload.doneAction), .complete(taskId: "01J9ZQ4K8W2M3N4P5Q6R7S8T9W"))
        XCTAssertEqual(NotificationRoute.from(userInfo: reminder, action: PushPayload.snoozeAction, now: now), .snooze(taskId: "01J9ZQ4K8W2M3N4P5Q6R7S8T9W", until: now.addingTimeInterval(3600)))
        XCTAssertEqual(NotificationRoute.from(userInfo: reminder, action: UNNotificationDismissActionIdentifier), .nothing)
        // Without a task (or with one that isn't an id), Done just opens what it's about.
        var odd = reminder
        odd["taskId"] = "../../admin"
        XCTAssertEqual(NotificationRoute.from(userInfo: odd, action: PushPayload.doneAction), .open(URL(string: "folevi://d/01J9ZQ4K8W2M3N4P5Q6R7S8T9V#block-01J9ZQ4K8W2M3N4P5Q6R7S8T9W")!))
    }

    func testPathsThatArentFolevisOpenTheNotesList() {
        for path in [nil, "", "https://evil.example.com", "//evil.example.com", "/admin", "/d/not-an-id", "javascript:alert(1)"] as [String?] {
            XCTAssertEqual(NotificationRoute.link(forPath: path).absoluteString, "folevi://documents", path ?? "nil")
        }
        XCTAssertEqual(DeepLink.fromPath("/d/inbox-2d0a97ae3b345608")?.absoluteString, "folevi://d/inbox-2d0a97ae3b345608")
    }

    func testSnoozeSendsTheNewReminderTime() async throws {
        StubAPI.reset()
        StubAPI.answers["PATCH /api/v1/tasks/t1"] = (200, #"{"id":"t1","completed":false,"remindAt":"2027-01-15T08:00:00Z"}"#)
        try await api().snoozeTask("t1", until: Date(timeIntervalSince1970: 1_800_000_000))
        let body = try JSONSerialization.jsonObject(with: StubAPI.requests.last!.httpBody!) as! [String: Any]
        XCTAssertEqual(body["remindAt"] as? String, "2027-01-15T08:00:00Z")
        XCTAssertNotNil(StubAPI.requests.last?.value(forHTTPHeaderField: "Idempotency-Key"))
    }

    func testTheSimulatorsStandInTokenLooksLikeOne() {
        let token = PushNotifications.simulatorToken("5D3A1C2E-0000-4F00-9ABC-1234567890AB")
        XCTAssertEqual(token.count, 64)
        XCTAssertNotNil(token.range(of: "^[0-9a-f]{64}$", options: .regularExpression))
    }
}
