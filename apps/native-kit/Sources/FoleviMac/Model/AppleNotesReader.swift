// Import from Apple Notes (Mac only): reads the person's notes through Notes' scripting interface (Apple Events,
// through ScriptingBridge), never Notes' database. macOS asks once whether Folevi may control Notes
// (NSAppleEventsUsageDescription in apps/mac's Info.plist; the hardened runtime's apple-events entitlement).
//
// `scan()` finds every folder (empty ones too) and every note: per folder, one Apple Event per property for all its
// notes at once (ids, names, dates, locked), never one per note. `read(ids:)` then reads each note's body (HTML
// with its images inline) and saves every attachment out of Notes (its `save` command, into a temporary folder that
// is removed right after), a batch at a time within a size budget, so a library of thousands moves with progress
// and can stop between batches. Locked notes can't be read: the scan counts them and leaves them out. The web's
// importer (apps/web/src/lib/import/appleNotes.ts) turns it all into pages.
//
// Every Apple Event goes out from one serial queue, off the main thread.
#if os(macOS)
import AppKit
import CoreServices
import ImageIO
import ScriptingBridge
import UniformTypeIdentifiers

public final class AppleNotesReader: @unchecked Sendable {
    public static let shared = AppleNotesReader()
    public static let bundleID = "com.apple.Notes"

    public enum Access: String, Sendable {
        case granted, denied, unavailable
        case notDetermined = "not-determined"
    }

    /// A note found by the scan: everything but its body.
    public struct NoteRef: Sendable, Codable, Equatable {
        public var id: String
        public var title: String
        /// Folder names from the top level down; the account's name first when there's more than one account.
        public var folder: [String]
        /// Milliseconds since 1970.
        public var created: Double?
        public var modified: Double?
    }

    /// One attachment, saved out of Notes: its file (base64), or a web link's address, or why Notes didn't hand it over.
    public struct Attachment: Sendable, Codable, Equatable {
        public var name: String
        public var cid: String?
        public var url: String?
        public var mime: String?
        public var data: String?
        public var error: String?

        public init(name: String, cid: String? = nil, url: String? = nil, mime: String? = nil, data: String? = nil, error: String? = nil) {
            self.name = name
            self.cid = cid
            self.url = url
            self.mime = mime
            self.data = data
            self.error = error
        }
    }

    /// A note's body (HTML, images inline as data: URIs) and every attachment.
    public struct Body: Sendable, Codable, Equatable {
        public var id: String
        public var html: String
        public var attachments: [Attachment]
    }

    /// Bodies from the start of the asked ids until the size budget is used; `missing` are gone or locked since the
    /// scan. Ids in neither are asked for again.
    public struct Read: Sendable, Codable, Equatable {
        public var notes: [Body]
        public var missing: [String]
    }

    public struct Scan: Sendable {
        public var notes: [NoteRef]
        /// Every folder (empty ones too), names from the top level down.
        public var folders: [[String]]
        /// Password-locked notes: Notes won't hand their text over.
        public var locked: Int
    }

    /// Bytes of attachments one read hands back (at least one note always comes, whatever its size).
    static let readBudget = 48 * 1024 * 1024

    public struct Failure: Error, Sendable, LocalizedError {
        public var code: String
        public var message: String
        public var errorDescription: String? { message }

        static let denied = Failure(code: "denied", message: "Folevi isn’t allowed to read Apple Notes. Turn on Notes under Folevi in System Settings > Privacy & Security > Automation, then try again.")
        static let notRunning = Failure(code: "unavailable", message: "Apple Notes closed while Folevi was reading it. Open Notes and try again.")
    }

    /// The Recently Deleted folder's names (it's a folder to Notes' scripting): its notes aren't imported.
    static let recentlyDeleted: Set<String> = ["Recently Deleted", "Zuletzt gelöscht", "Supprimés récemment", "Eliminados recientemente", "Eliminati di recente", "Recentemente apagadas", "Onlangs verwijderd", "最近删除", "最近刪除", "最近削除した項目", "최근 삭제된 항목"]

    private let queue = DispatchQueue(label: "com.folevi.apple-notes", qos: .userInitiated)
    private var app: SBApplication?
    private let errors = ErrorCatcher()

    public init() {}

    /// Opens System Settings at Privacy & Security > Automation.
    @MainActor
    public static func openAutomationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") { NSWorkspace.shared.open(url) }
    }

    // MARK: Permission

    /// Whether Folevi may control Notes. Opens Notes in the background first (macOS can only answer for a running
    /// app); with `ask`, macOS asks the person the first time.
    public func access(ask: Bool) async -> Access {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.bundleID) else { return .unavailable }
        if NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID).isEmpty {
            let config = NSWorkspace.OpenConfiguration()
            config.activates = false
            config.hides = true
            config.addsToRecentItems = false
            guard (try? await NSWorkspace.shared.openApplication(at: url, configuration: config)) != nil else { return .unavailable }
        }
        return await withCheckedContinuation { done in
            queue.async { done.resume(returning: Self.permission(ask: ask)) }
        }
    }

    /// AEDeterminePermissionToAutomateTarget blocks while macOS asks, so it runs on the queue.
    private static func permission(ask: Bool) -> Access {
        let target = NSAppleEventDescriptor(bundleIdentifier: bundleID)
        guard let desc = target.aeDesc else { return .unavailable }
        let status = AEDeterminePermissionToAutomateTarget(desc, typeWildCard, typeWildCard, ask)
        return access(for: status)
    }

    static func access(for status: OSStatus) -> Access {
        switch Int(status) {
        case Int(noErr): .granted
        case -1743: .denied // errAEEventNotPermitted
        case -1744: .notDetermined // errAEEventWouldRequireUserConsent
        default: .unavailable // procNotFound and the rest
        }
    }

    // MARK: Reading

    public func scan() async throws -> Scan {
        try await onQueue { try self.scanNow() }
    }

    public func read(ids: [String]) async throws -> Read {
        try await onQueue { try self.readNow(ids) }
    }

    private func onQueue<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { done in
            queue.async { done.resume(with: Result { try work() }) }
        }
    }

    private func application() throws -> SBApplication {
        if let app, app.isRunning { return app }
        guard let made = SBApplication(bundleIdentifier: Self.bundleID) else { throw Failure(code: "unavailable", message: "Apple Notes isn’t on this Mac.") }
        made.delegate = errors
        made.timeout = 60 * 120 // ticks: two minutes for a folder of thousands
        made.launchFlags = LSLaunchFlags(rawValue: 0x0010_0200) // kLSLaunchAndHide | kLSLaunchDontSwitch: never brought forward
        app = made
        return made
    }

    /// One Apple Event's answer, or the error it ended in.
    private func get<T>(_ object: NSObject, _ key: String, as: T.Type) throws -> T? {
        errors.last = nil
        let value = object.value(forKey: key)
        if let error = errors.last {
            errors.last = nil
            throw Self.failure(error)
        }
        return value as? T
    }

    static func failure(_ error: NSError) -> Failure {
        switch error.code {
        case -1743, -1744: .denied
        case -600, -609, -903: .notRunning
        default: Failure(code: "failed", message: "Apple Notes couldn’t answer (\(error.code)). Try again.")
        }
    }

    private func elements(_ object: NSObject, _ key: String) throws -> SBElementArray {
        guard let list = try get(object, key, as: SBElementArray.self) else { throw Failure(code: "failed", message: "Apple Notes couldn’t list its \(key).") }
        return list
    }

    private func scanNow() throws -> Scan {
        let app = try application()
        let accounts = try elements(app, "accounts")
        let accountNames = try get(accounts, "name", as: [String].self) ?? []
        let several = accountNames.count > 1
        var notes: [NoteRef] = []
        var folderPaths: [[String]] = []
        var seen = Set<String>()
        var locked = 0
        for (i, accountName) in accountNames.enumerated() where i < accounts.count {
            guard let account = accounts.object(at: i) as? SBObject else { continue }
            let folders = try elements(account, "folders")
            let ids = try get(folders, "id", as: [String].self) ?? []
            // An account may list nested folders too: the top level is the ones no other folder holds.
            var children: [String: [Int]] = [:]
            var nested = Set<String>()
            for (j, _) in ids.enumerated() {
                guard let folder = folders.object(at: j) as? SBObject else { continue }
                let inner = try get(try elements(folder, "folders"), "id", as: [String].self) ?? []
                nested.formUnion(inner)
                children[ids[j]] = inner.compactMap { ids.firstIndex(of: $0) }
            }
            var visited = Set<String>()
            func walk(_ j: Int, _ path: [String]) throws {
                guard visited.insert(ids[j]).inserted, let folder = folders.object(at: j) as? SBObject else { return }
                let name = (try get(folder, "name", as: String.self)) ?? "Notes"
                if path.isEmpty && Self.recentlyDeleted.contains(name) { return }
                let here = path + [name]
                folderPaths.append(several ? [accountName] + here : here)
                let list = try elements(folder, "notes")
                let noteIds = try get(list, "id", as: [String].self) ?? []
                if !noteIds.isEmpty {
                    let names = try get(list, "name", as: [String].self) ?? []
                    let made = try get(list, "creationDate", as: [Date].self) ?? []
                    let changed = try get(list, "modificationDate", as: [Date].self) ?? []
                    let locks = try get(list, "passwordProtected", as: [NSNumber].self) ?? []
                    for (k, id) in noteIds.enumerated() where seen.insert(id).inserted {
                        if k < locks.count, locks[k].boolValue { locked += 1; continue }
                        notes.append(NoteRef(
                            id: id,
                            title: k < names.count ? names[k] : "",
                            folder: several ? [accountName] + here : here,
                            created: k < made.count ? made[k].timeIntervalSince1970 * 1000 : nil,
                            modified: k < changed.count ? changed[k].timeIntervalSince1970 * 1000 : nil
                        ))
                    }
                }
                for c in children[ids[j]] ?? [] { try walk(c, here) }
            }
            for (j, id) in ids.enumerated() where !nested.contains(id) { try walk(j, []) }
        }
        return Scan(notes: notes, folders: folderPaths, locked: locked)
    }

    private func readNow(_ ids: [String]) throws -> Read {
        let app = try application()
        let all = try elements(app, "notes")
        var out = Read(notes: [], missing: [])
        var used = 0
        for id in ids.prefix(100) {
            guard let note = all.object(withID: id) as? SBObject else { out.missing.append(id); continue }
            let html: String
            do {
                guard let body = try get(note, "body", as: String.self) else { out.missing.append(id); continue }
                html = body
            } catch let f as Failure where f.code == "failed" {
                out.missing.append(id) // deleted or locked since the scan: reported as not handed over
                continue
            }
            let attachments = try attachments(of: note)
            let size = html.utf8.count + attachments.reduce(0) { $0 + ($1.data?.utf8.count ?? 0) }
            // Over the budget: this one waits for the next read (unless it's the first, which always comes).
            if !out.notes.isEmpty, used + size > Self.readBudget { break }
            used += size
            out.notes.append(Body(id: id, html: Self.webImages(html), attachments: attachments))
        }
        return out
    }

    /// Every attachment of a note: names, content ids and web links in one Apple Event each, then each file saved
    /// out of Notes into a temporary folder, read, and the folder removed.
    private func attachments(of note: SBObject) throws -> [Attachment] {
        let list = try elements(note, "attachments")
        let names = try get(list, "name", as: [Any].self) ?? []
        guard !names.isEmpty else { return [] }
        let cids = (try? get(list, "contentIdentifier", as: [Any].self)) ?? []
        let urls = (try? get(list, "URL", as: [Any].self)) ?? []
        var out: [Attachment] = []
        for i in 0..<names.count {
            let name = names[i] as? String ?? ""
            let cid = (i < cids.count ? cids[i] as? String : nil).flatMap { $0.isEmpty ? nil : $0 }
            let url = (i < urls.count ? urls[i] as? String : nil).flatMap { $0.isEmpty ? nil : $0 }
            var a = Attachment(name: name, cid: cid, url: url)
            if url == nil {
                if let item = list.object(at: i) as? SBObject {
                    do {
                        let (data, fileName) = try save(item, name: name)
                        let type = UTType(filenameExtension: (fileName as NSString).pathExtension)
                        var mime = type?.preferredMIMEType ?? "application/octet-stream"
                        var bytes = data
                        // Pictures in formats the web can't show (HEIC, TIFF, ...) come as JPEG, so they show.
                        if let type, type.conforms(to: .image), !["image/png", "image/jpeg", "image/gif", "image/webp"].contains(mime), let jpeg = Self.jpeg(data) {
                            bytes = jpeg
                            mime = "image/jpeg"
                            a.name = ((name.isEmpty ? fileName : name) as NSString).deletingPathExtension + ".jpg"
                        }
                        if a.name.isEmpty { a.name = fileName }
                        a.mime = mime
                        a.data = bytes.base64EncodedString()
                    } catch let f as Failure where f.code == "denied" || f.code == "unavailable" {
                        throw f
                    } catch {
                        if url == nil { a.error = (error as? Failure)?.message ?? error.localizedDescription }
                    }
                }
            }
            out.append(a)
        }
        return out
    }

    /// Biggest attachment Folevi takes out of Notes.
    static let maxAttachment = 512 * 1024 * 1024

    /// Notes' `save` command (Cocoa's standard suite) on one attachment, into a fresh temporary folder.
    private func save(_ item: SBObject, name: String) throws -> (Data, String) {
        let selector = Selector(("saveIn:as:"))
        guard item.responds(to: selector) else { throw Failure(code: "failed", message: "This version of Apple Notes can’t save its attachments") }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-apple-notes-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let target = dir.appendingPathComponent(Self.safeFileName(name))
        errors.last = nil
        _ = item.perform(selector, with: target, with: nil)
        if let error = errors.last {
            errors.last = nil
            throw Self.failure(error)
        }
        // Notes may add its own extension: take whatever it wrote.
        let written = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey])) ?? []
        guard let file = written.first else { throw Failure(code: "failed", message: "Notes didn’t save it") }
        let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        if values?.isRegularFile != true {
            // A package (a Pages or Keynote file): kept as a ZIP so nothing inside is lost.
            return (try Self.zip(file), file.lastPathComponent + ".zip")
        }
        if let size = values?.fileSize, size > Self.maxAttachment { throw Failure(code: "failed", message: "it’s over 512 MB") }
        return (try Data(contentsOf: file), file.lastPathComponent)
    }

    static func safeFileName(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty || cleaned.hasPrefix(".") ? "Attachment\(cleaned)" : String(cleaned.prefix(200))
    }

    /// A folder as a ZIP (NSFileCoordinator's forUploading read makes one).
    static func zip(_ folder: URL) throws -> Data {
        var result: Result<Data, any Error> = .failure(Failure(code: "failed", message: "it couldn’t be packed"))
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: folder, options: .forUploading, error: &coordError) { zipped in
            result = Result { try Data(contentsOf: zipped) }
        }
        if let coordError { throw coordError }
        return try result.get()
    }

    // MARK: Images

    /// Notes' images in formats the web can't show (HEIC, TIFF, ...) as JPEG, so they come along.
    static func webImages(_ html: String) -> String {
        guard html.contains("data:image/") else { return html }
        let pattern = #"data:image/(heic|heif|tiff|bmp|jp2|x-[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return html }
        let ns = html as NSString
        var result = ""
        var last = 0
        for m in regex.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let b64 = ns.substring(with: m.range(at: 2))
            if let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters), let jpeg = jpeg(data) {
                result += "data:image/jpeg;base64," + jpeg.base64EncodedString()
            } else {
                result += ns.substring(with: m.range)
            }
            last = m.range.location + m.range.length
        }
        result += ns.substring(from: last)
        return result
    }

    static func jpeg(_ data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }
}

/// ScriptingBridge reports a failed Apple Event to its delegate (and answers nil); the reader checks after each.
private final class ErrorCatcher: NSObject, SBApplicationDelegate, @unchecked Sendable {
    var last: NSError?

    func eventDidFail(_ event: UnsafePointer<AppleEvent>, withError error: any Error) -> Any? {
        last = error as NSError
        return nil
    }
}
#endif
