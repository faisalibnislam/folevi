import Foundation
import CryptoKit
import UniformTypeIdentifiers

/// Account, profile, sessions and workspaces.
struct AccountRepository: Sendable {
    let convex: ConvexService

    func me() async throws -> MeResponse { try await convex.query("users:me") }
    func meUpdates() -> AsyncThrowingStream<MeResponse, Error> { convex.subscribe("users:me") }

    func bootstrap() async throws {
        let _: JSONValue = try await convex.mutation("users:bootstrap", [
            "timeZone": .string(TimeZone.current.identifier),
            "locale": .string(Locale.current.language.languageCode.map { $0.identifier } ?? "en"),
        ])
    }

    func registerSession() async throws {
        let _: JSONValue = try await convex.mutation("users:registerSession", [
            "client": "mac", "label": .string(DeviceIdentity.label), "deviceId": .string(DeviceIdentity.deviceId),
        ])
    }

    func completeOnboarding(step: String, workspaceName: String? = nil, appearance: String? = nil) async throws {
        var args: [String: JSONValue] = ["step": .string(step)]
        if let workspaceName { args["workspaceName"] = .string(workspaceName) }
        if let appearance { args["appearance"] = .string(appearance) }
        try await convex.mutationVoid("users:completeOnboardingStep", args)
    }

    func updateProfile(displayName: String? = nil, appearance: String? = nil, notificationPrefs: NotificationPrefs? = nil) async throws {
        var args: [String: JSONValue] = [:]
        if let displayName { args["displayName"] = .string(displayName) }
        if let appearance { args["appearance"] = .string(appearance) }
        if let notificationPrefs { args["notificationPrefs"] = try JSONValue(encoding: notificationPrefs) }
        try await convex.mutationVoid("users:updateProfile", args)
    }

    func sessions() async throws -> [SessionInfo] { try await convex.query("users:listSessions") }
    func billing() async throws -> BillingSummary { try await convex.query("billing:mine") }
    func revokeSession(_ id: String) async throws { try await convex.mutationVoid("users:revokeSession", ["sessionId": .string(id)]) }
    func revokeOtherSessions() async throws { try await convex.mutationVoid("users:revokeOtherSessions") }
    func workspaces() async throws -> [WorkspaceInfo] { try await convex.query("workspaces:mine") }
    func settingsStatus() async throws -> SettingsStatus { try await convex.query("settings:status") }
}

/// Server-side document operations that are online-only (stars, trash, snapshots, metadata).
/// Content edits never go through here — they are sync ops (see SyncEngine).
struct DocumentsRepository: Sendable {
    let convex: ConvexService

    func list(workspaceId: String, view: String, folderId: String? = nil, tagId: String? = nil, sort: String = "updated") async throws -> [DocumentSummary] {
        var args: [String: JSONValue] = [
            "workspaceId": .string(workspaceId), "view": .string(view), "sort": .string(sort),
            "paginationOpts": ["numItems": 200, "cursor": nil],
        ]
        if let folderId { args["folderId"] = .string(folderId) }
        if let tagId { args["tagId"] = .string(tagId) }
        let page: DocumentPage = try await convex.query("documents:list", args)
        return page.page
    }

    func get(_ id: String) async throws -> DocumentDetail? { try await convex.query("documents:get", ["documentId": .string(id)]) }
    func backlinks(_ id: String) async throws -> Backlinks { try await convex.query("documents:backlinks", ["documentId": .string(id)]) }
    func info(_ id: String) async throws -> DocumentInfo { try await convex.query("documents:info", ["documentId": .string(id)]) }
    func setStarred(_ id: String, _ starred: Bool) async throws {
        try await convex.mutationVoid("documents:setStarred", ["documentId": .string(id), "starred": .bool(starred)])
    }
    func setArchived(_ id: String, _ archived: Bool) async throws {
        try await convex.mutationVoid("documents:setArchived", ["documentId": .string(id), "archived": .bool(archived)])
    }
    func moveToTrash(_ id: String) async throws { try await convex.mutationVoid("documents:moveToTrash", ["documentId": .string(id)]) }
    func restoreFromTrash(_ id: String) async throws { try await convex.mutationVoid("documents:restoreFromTrash", ["documentId": .string(id)]) }
    func move(_ id: String, folderId: String?) async throws {
        try await convex.mutationVoid("documents:move", ["documentId": .string(id), "folderId": folderId.map { .string($0) } ?? .null])
    }
    func duplicate(_ id: String) async throws -> DocumentSummary {
        try await convex.mutation("documents:duplicate", ["documentId": .string(id)])
    }
    func createSnapshot(_ id: String, reason: String) async throws {
        let _: JSONValue = try await convex.mutation("documents:createSnapshot", ["documentId": .string(id), "reason": .string(reason)])
    }
    func snapshots(_ id: String) async throws -> [SnapshotInfo] { try await convex.query("documents:snapshots", ["documentId": .string(id)]) }
    func snapshotContent(_ id: String) async throws -> SnapshotContent? { try await convex.query("documents:snapshotContent", ["snapshotId": .string(id)]) }
    func restoreSnapshot(_ id: String) async throws { try await convex.mutationVoid("documents:restoreSnapshot", ["snapshotId": .string(id)]) }
    func recordView(_ id: String) async throws { try await convex.mutationVoid("documents:recordView", ["documentId": .string(id)]) }
    func sharedWithMe() async throws -> [SharedDocument] { try await convex.query("sharing:sharedWithMe") }
    func comments(_ id: String) async throws -> CommentThreadList { try await convex.query("comments:threads", ["documentId": .string(id)]) }
    func addComment(documentId: String, blockId: String?, text: String) async throws {
        var args: [String: JSONValue] = ["documentId": .string(documentId), "body": [["type": "text", "text": .string(text)]]]
        if let blockId { args["blockId"] = .string(blockId) }
        let _: JSONValue = try await convex.mutation("comments:create", args)
    }
    func collection(_ id: String) async throws -> CollectionData { try await convex.query("collections:get", ["collectionId": .string(id)]) }
    func importText(workspaceId: String, filename: String, content: String, markdown: Bool) async throws -> ImportTextResult {
        try await convex.mutation("imports:importText", [
            "workspaceId": .string(workspaceId), "filename": .string(filename), "content": .string(content),
            "format": .string(markdown ? "markdown" : "text"),
        ], timeout: 60)
    }
}

struct OrganizationRepository: Sendable {
    let convex: ConvexService
    func sidebar(workspaceId: String) async throws -> SidebarData { try await convex.query("organization:sidebar", ["workspaceId": .string(workspaceId)]) }
    func sidebarUpdates(workspaceId: String) -> AsyncThrowingStream<SidebarData, Error> {
        convex.subscribe("organization:sidebar", ["workspaceId": .string(workspaceId)])
    }
    func createFolder(workspaceId: String, name: String) async throws {
        let _: JSONValue = try await convex.mutation("organization:createFolder", ["workspaceId": .string(workspaceId), "name": .string(name)])
    }
}

struct TasksRepository: Sendable {
    let convex: ConvexService
    func list(workspaceId: String, view: String, today: String) async throws -> [TaskItem] {
        try await convex.query("tasks:list", ["workspaceId": .string(workspaceId), "view": .string(view), "today": .string(today)])
    }
    func counts(workspaceId: String, today: String) async throws -> TaskCounts {
        try await convex.query("tasks:counts", ["workspaceId": .string(workspaceId), "today": .string(today)])
    }
    func range(workspaceId: String, from: String, to: String) async throws -> [TaskItem] {
        try await convex.query("tasks:range", ["workspaceId": .string(workspaceId), "from": .string(from), "to": .string(to), "includeCompleted": true])
    }
    /// Server-side task edit (calendar drag). Returns the props before the change for Undo.
    func update(blockId: String, fields: [String: JSONValue]) async throws -> TaskUpdateResult {
        var args = fields
        args["blockId"] = .string(blockId)
        args["deviceId"] = .string(DeviceIdentity.deviceId)
        return try await convex.mutation("tasks:update", args)
    }
    func quickAdd(workspaceId: String, title: String, today: String, dueDate: String?) async throws {
        var args: [String: JSONValue] = ["workspaceId": .string(workspaceId), "title": .string(title), "today": .string(today),
                                         "deviceId": .string(DeviceIdentity.deviceId)]
        if let dueDate { args["dueDate"] = .string(dueDate) }
        let _: JSONValue = try await convex.mutation("tasks:quickAdd", args)
    }
}

struct SearchRepository: Sendable {
    let convex: ConvexService
    func search(workspaceId: String, query: String) async throws -> [SearchHit] {
        try await convex.query("search:documents", ["workspaceId": .string(workspaceId), "query": .string(query), "limit": 30], timeout: 10)
    }
}

/// Attachments: two-phase upload (generateUploadUrl → POST → finalize), signed URLs, local cache.
struct FilesRepository: Sendable {
    let convex: ConvexService
    let store: SQLiteStore

    static var cacheDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("Folevi/Attachments", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func mimeType(for url: URL) -> String {
        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }

    func upload(fileURL: URL, workspaceId: String, documentId: String, kind: String,
                progress: (@Sendable (Double) -> Void)? = nil) async throws -> FinalizeResult {
        let data = try Data(contentsOf: fileURL)
        let mime = FilesRepository.mimeType(for: fileURL)
        let ticket: UploadTicket = try await convex.mutation("files:generateUploadUrl", [
            "workspaceId": .string(workspaceId), "documentId": .string(documentId), "filename": .string(fileURL.lastPathComponent),
            "size": .number(Double(data.count)), "mimeType": .string(mime), "kind": .string(kind),
        ])
        guard let uploadURL = URL(string: ticket.uploadUrl) else { throw FoleviError.invalidResponse("upload url") }
        var request = URLRequest(url: uploadURL, timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        progress?(0.1)
        let (body, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let json = try? JSONValue(jsonData: body), let storageId = json["storageId"]?.stringValue else {
            throw FoleviError.server(code: "upload_failed", message: String(localized: "The upload didn't finish. It will be retried."))
        }
        progress?(0.8)
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let result: FinalizeResult = try await convex.action("files:finalize", [
            "intentId": .string(ticket.intentId), "storageId": .string(storageId), "sha256": .string(hash),
        ])
        // Keep a local copy so the attachment is available offline immediately.
        let dest = FilesRepository.cacheDirectory.appendingPathComponent(result.fileId + "-" + fileURL.lastPathComponent)
        try? data.write(to: dest)
        try? await store.cacheFile(.init(fileId: result.fileId, localPath: dest.path, mimeType: result.mimeType,
                                         name: fileURL.lastPathComponent, size: data.count))
        progress?(1)
        return result
    }

    func urls(_ fileIds: [String]) async throws -> [String: FileURLInfo] {
        try await convex.query("files:urls", ["fileIds": .array(fileIds.map { .string($0) }),
                                              "now": .number((Date().timeIntervalSince1970 * 1000).rounded())])
    }

    /// Returns a local file URL for an attachment, downloading (and caching) it when needed.
    func localFile(fileId: String) async throws -> URL {
        if let cached = try await store.cachedFile(fileId), FileManager.default.fileExists(atPath: cached.localPath) {
            return URL(fileURLWithPath: cached.localPath)
        }
        let infos = try await urls([fileId])
        guard let info = infos[fileId], let remote = URL(string: info.url) else { throw FoleviError.server(code: "not_found", message: String(localized: "That file isn't available.")) }
        let (tmp, response) = try await URLSession.shared.download(from: remote)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw FoleviError.server(code: "download_failed", message: String(localized: "The file couldn't be downloaded."))
        }
        let safeName = info.filename.replacingOccurrences(of: "/", with: "_")
        let dest = FilesRepository.cacheDirectory.appendingPathComponent(fileId + "-" + safeName)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        try await store.cacheFile(.init(fileId: fileId, localPath: dest.path, mimeType: info.mimeType, name: info.filename, size: Int(info.size)))
        return dest
    }
}
