// Folevi's REST API (/api/v1, convex/restApiServer.ts) as native code uses it, with this device's token:
// places, notes (recent, starred, search, one note, create in the Inbox), tasks (today's, add, check off).
// Answers decode into the small models below; errors come back as FoleviAPI.Failure. Writes send an
// Idempotency-Key, so a retry never makes a second note or task. The API's rate limits apply as to any
// token (a 429 says when to try again).
import Foundation

struct Place: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NoteSummary: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let place: PlaceRef
    let updatedAt: String
    let url: String?

    struct PlaceRef: Codable, Hashable {
        let id: String?
        let name: String
    }
}

struct NoteDetail: Codable, Hashable {
    let id: String
    let title: String
    let folder: Folder?
    let place: NoteSummary.PlaceRef
    let updatedAt: String
    let markdown: String

    struct Folder: Codable, Hashable {
        let id: String
        let name: String
        let path: String
    }
}

struct TaskItem: Codable, Hashable, Identifiable {
    let id: String
    let text: String
    let status: String
    let dueDate: String?
    let dueTime: String?
    let priority: String?
    let note: NoteRef
    let place: Place?

    struct NoteRef: Codable, Hashable {
        let id: String
        let title: String
    }

    var done: Bool { status == "done" || status == "completed" }
}

struct CreatedNote: Codable, Hashable {
    let id: String
    let title: String
    let url: String?
}

struct CreatedTask: Codable, Hashable {
    let id: String
    let url: String?
}

struct FoleviAPI {
    let base: URL
    let token: String
    var session: URLSession = .shared

    enum Failure: Error, Equatable {
        /// 401: the token was revoked (or the account can't be used): signed out, as far as native code goes.
        case signedOut
        /// 429, with how long to wait.
        case rateLimited(retryAfter: TimeInterval)
        /// No connection (or no answer in time): worth trying again later.
        case offline
        /// Anything else the API refused, with its message.
        case refused(status: Int, code: String, message: String)
        case malformed
    }

    // MARK: Reads

    func places() async throws -> [Place] {
        try await get("places", as: Page<Place>.self).data
    }

    func recentNotes(limit: Int = 20) async throws -> [NoteSummary] {
        try await get("notes", query: ["limit": String(limit)], as: Page<NoteSummary>.self).data
    }

    func starredNotes(limit: Int = 20) async throws -> [NoteSummary] {
        try await get("notes", query: ["starred": "true", "limit": String(limit)], as: Page<NoteSummary>.self).data
    }

    func searchNotes(_ text: String, limit: Int = 10) async throws -> [NoteSummary] {
        try await get("notes", query: ["q": String(text.prefix(200)), "limit": String(limit)], as: Page<NoteSummary>.self).data
    }

    func note(_ id: String) async throws -> NoteDetail {
        try await get("notes/\(id)", as: NoteDetail.self)
    }

    /// Open tasks due on or before `dueBefore` (YYYY-MM-DD): today's and overdue ones.
    func openTasks(dueBefore: String) async throws -> [TaskItem] {
        try await get("tasks", query: ["status": "open", "due_before": dueBefore, "limit": "200"], as: Page<TaskItem>.self).data
    }

    // MARK: Writes

    /// A new note in the Inbox of `place` ("personal" or a workspace's id; nil: Personal).
    func createNote(title: String, markdown: String, place: String?, inInbox: Bool = true, key: String = UUID().uuidString) async throws -> CreatedNote {
        var body: [String: Any] = ["title": String(title.prefix(200)), "markdown": markdown]
        if inInbox { body["inInbox"] = true }
        if let place { body["place"] = place }
        return try await send("POST", "notes", body: body, key: key, as: CreatedNote.self)
    }

    /// A task in the Inbox (or at the end of a note), due on a day (YYYY-MM-DD) if given.
    func createTask(text: String, dueDate: String?, noteId: String?, key: String = UUID().uuidString) async throws -> CreatedTask {
        var body: [String: Any] = ["text": String(text.prefix(500))]
        if let dueDate { body["dueDate"] = dueDate }
        if let noteId { body["noteId"] = noteId }
        return try await send("POST", "tasks", body: body, key: key, as: CreatedTask.self)
    }

    func setTask(_ id: String, completed: Bool) async throws {
        _ = try await send("PATCH", "tasks/\(id)", body: ["completed": completed], key: "complete-\(id)-\(completed)-\(Int(Date().timeIntervalSince1970 / 60))", as: Ignored.self)
    }

    // MARK: Transport

    private struct Page<T: Decodable>: Decodable {
        let data: [T]
    }

    private struct Ignored: Decodable {}

    private struct ErrorBody: Decodable {
        struct Inner: Decodable {
            let code: String
            let message: String
        }

        let error: Inner
    }

    private func url(_ path: String, query: [String: String] = [:]) -> URL {
        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        return components.url!
    }

    private func request(_ method: String, _ url: URL) -> URLRequest {
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:], as: T.Type) async throws -> T {
        try await run(request("GET", url(path, query: query)), as: T.self)
    }

    private func send<T: Decodable>(_ method: String, _ path: String, body: [String: Any], key: String, as: T.Type) async throws -> T {
        var r = request(method, url(path))
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await run(r, as: T.self)
    }

    private func run<T: Decodable>(_ request: URLRequest, as: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Failure.offline
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.malformed }
        return try Self.decode(status: http.statusCode, retryAfter: http.value(forHTTPHeaderField: "Retry-After"), data: data, as: T.self)
    }

    /// An answer as a value or a Failure (separate from the network, for tests).
    static func decode<T: Decodable>(status: Int, retryAfter: String? = nil, data: Data, as: T.Type) throws -> T {
        switch status {
        case 200 ..< 300:
            guard let value = try? JSONDecoder().decode(T.self, from: data) else { throw Failure.malformed }
            return value
        case 401:
            throw Failure.signedOut
        case 429:
            throw Failure.rateLimited(retryAfter: retryAfter.flatMap(TimeInterval.init) ?? 60)
        default:
            let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw Failure.refused(status: status, code: body?.error.code ?? "error", message: body?.error.message ?? "Folevi couldn't do that.")
        }
    }
}

extension FoleviAPI.Failure {
    /// Worth keeping the work for later (no connection, too many requests, the server having a moment).
    var isTemporary: Bool {
        switch self {
        case .offline, .rateLimited: return true
        case .refused(let status, _, _): return status >= 500
        case .signedOut, .malformed: return false
        }
    }
}

/// Dates as the API writes them: days as YYYY-MM-DD (in the device's time zone), times as ISO 8601.
enum DayFormat {
    static func string(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    private static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// "2026-10-15T09:30:00.000Z" (an updatedAt) as a date.
    static func instant(_ value: String) -> Date? {
        withFractions.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
