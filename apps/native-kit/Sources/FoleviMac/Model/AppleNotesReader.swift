// Import from Apple Notes (Mac only): reads the person's notes through Notes' scripting interface (Apple Events,
// through ScriptingBridge), never Notes' database. macOS asks once whether Folevi may control Notes
// (NSAppleEventsUsageDescription in apps/mac's Info.plist; the hardened runtime's apple-events entitlement).
//
// `scan()` finds every note: per folder, one Apple Event per property for all its notes at once (ids, names,
// dates, locked), never one per note. `read(ids:)` then reads each note's body (HTML with its images inline) and
// its attachments' names, a batch at a time, so a library of thousands moves with progress and can stop between
// batches. Locked notes can't be read: the scan counts them and leaves them out. The web's importer
// (apps/web/src/lib/import/appleNotes.ts) turns the HTML into pages.
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

    /// A note's body (HTML, images inline as data: URIs) and its attachments' names.
    public struct Body: Sendable, Codable, Equatable {
        public var id: String
        public var html: String
        public var attachments: [String]
    }

    public struct Scan: Sendable {
        public var notes: [NoteRef]
        /// Password-locked notes: Notes won't hand their text over.
        public var locked: Int
    }

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

    public func read(ids: [String]) async throws -> [Body] {
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
        return Scan(notes: notes, locked: locked)
    }

    private func readNow(_ ids: [String]) throws -> [Body] {
        let app = try application()
        let all = try elements(app, "notes")
        var out: [Body] = []
        for id in ids.prefix(100) {
            guard let note = all.object(withID: id) as? SBObject else { continue }
            do {
                guard let html = try get(note, "body", as: String.self) else { continue }
                let names = (try? get(try elements(note, "attachments"), "name", as: [String].self)) ?? []
                out.append(Body(id: id, html: Self.webImages(html), attachments: names.map { $0 }))
            } catch let f as Failure where f.code == "failed" {
                continue // deleted or locked since the scan: the importer reports it as not handed over
            }
        }
        return out
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
