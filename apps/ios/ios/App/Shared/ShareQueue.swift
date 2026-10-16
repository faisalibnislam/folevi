// Shares the share extension couldn't send straight to Folevi (offline, signed out, or carrying images and
// PDFs, which the REST API can't upload), kept in the App Group container until the app opens: the page
// takes them (FoleviNativePlugin.takeShares) and saves each through the web app's share flow, which uploads
// the files, then removes it (finishShare). A share is written in full before the extension says it's saved,
// so nothing shared is ever lost.
//
//   <container>/Shares/<id>/share.json   title, text, link, place, files
//   <container>/Shares/<id>/<n>          each file's bytes
import Foundation

struct QueuedShare: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let text: String
    let url: String
    /// "personal" or a workspace's id; nil for Personal.
    let place: String?
    /// The account signed in when it was shared (nil: none); the app only saves it into that account.
    let accountId: String?
    let files: [File]
    /// When it was shared, in microseconds since 1970 (the queue's order).
    let createdAt: Int64

    struct File: Codable, Equatable {
        let name: String
        let type: String
        /// The file's name inside the share's folder.
        let stored: String
    }
}

final class ShareQueue {
    static let shared = ShareQueue(root: Folevi.container.appendingPathComponent("Shares", isDirectory: true))

    /// Files a share keeps, and the size of each (the web app's own limits for shares).
    static let maxFiles = 10
    static let maxFileBytes = 20 * 1024 * 1024

    private let root: URL
    private let fm = FileManager.default

    init(root: URL) {
        self.root = root
    }

    /// Keeps a share. Files beyond the limits are left out and their names returned.
    @discardableResult
    func add(title: String, text: String, url: String, place: String?, accountId: String?, files: [(name: String, type: String, data: Data)]) throws -> (share: QueuedShare, skipped: [String]) {
        let now = Int64(Date().timeIntervalSince1970 * 1_000_000)
        let id = "\(now)-\(UUID().uuidString.prefix(8).lowercased())"
        let folder = root.appendingPathComponent(id, isDirectory: true)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var kept: [QueuedShare.File] = []
        var skipped: [String] = []
        for file in files {
            guard kept.count < Self.maxFiles, !file.data.isEmpty, file.data.count <= Self.maxFileBytes else {
                skipped.append(file.name)
                continue
            }
            let stored = String(kept.count)
            try file.data.write(to: folder.appendingPathComponent(stored), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            kept.append(.init(name: file.name, type: file.type, stored: stored))
        }
        let share = QueuedShare(id: id, title: title, text: text, url: url, place: place, accountId: accountId, files: kept, createdAt: now)
        let encoder = JSONEncoder()
        // Written last: a share without its share.json (the extension was stopped halfway) isn't one yet.
        try encoder.encode(share).write(to: folder.appendingPathComponent("share.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return (share, skipped)
    }

    /// Every kept share, oldest first.
    func all() -> [QueuedShare] {
        guard let folders = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return [] }
        let decoder = JSONDecoder()
        return folders
            .compactMap { folder in (try? Data(contentsOf: folder.appendingPathComponent("share.json"))).flatMap { try? decoder.decode(QueuedShare.self, from: $0) } }
            .sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
    }

    func data(of file: QueuedShare.File, in share: QueuedShare) -> Data? {
        try? Data(contentsOf: root.appendingPathComponent(share.id, isDirectory: true).appendingPathComponent(file.stored))
    }

    /// Done with a share (saved by the app): its folder goes.
    func remove(_ id: String) {
        guard !id.isEmpty, !id.contains("/"), !id.contains("..") else { return }
        try? fm.removeItem(at: root.appendingPathComponent(id, isDirectory: true))
    }

    func removeAll() {
        try? fm.removeItem(at: root)
    }
}
