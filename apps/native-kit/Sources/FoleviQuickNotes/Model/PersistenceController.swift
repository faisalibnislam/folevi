// The quick notes' SwiftData store: local to this Mac, in the build's own support folder (Folevi Dev keeps its own),
// never iCloud. Notlet mirrors the same models to CloudKit; Folevi's Developer ID build carries no iCloud container,
// so sync between Macs is not on here (the models keep CloudKit's rules so it can be turned on later).
import Foundation
import OSLog
import SwiftData

@MainActor
final class PersistenceController {
    let container: ModelContainer
    /// Set when the store could not be opened and was moved aside (see `recoverCorruptStore`).
    private(set) var recoveredStoreURL: URL?

    nonisolated static let logger = Logger(subsystem: "com.folevi.mac", category: "QuickNotes")

    /// `folder` nil: in memory only (tests, previews).
    init(folder: URL?) {
        let schema = Schema([Dot.self, Note.self, Attachment.self])
        let storeURL = folder.map { $0.appendingPathComponent("QuickNotes.store") }
        if let folder { try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
        func configuration() -> ModelConfiguration {
            guard let storeURL else {
                return ModelConfiguration("QuickNotes", schema: schema, isStoredInMemoryOnly: true, allowsSave: true, groupContainer: .none, cloudKitDatabase: .none)
            }
            return ModelConfiguration("QuickNotes", schema: schema, url: storeURL, allowsSave: true, cloudKitDatabase: .none)
        }
        do {
            container = try ModelContainer(for: schema, configurations: [configuration()])
        } catch {
            Self.logger.error("Quick notes store failed to open: \(error.localizedDescription, privacy: .public). Moving it aside.")
            if let storeURL, let folder { recoveredStoreURL = Self.recoverCorruptStore(storeURL, in: folder) }
            do {
                container = try ModelContainer(for: schema, configurations: [configuration()])
            } catch {
                Self.logger.fault("Fresh quick notes store failed too; using memory: \(error.localizedDescription, privacy: .public)")
                let memory = ModelConfiguration("QuickNotes", schema: schema, isStoredInMemoryOnly: true)
                container = try! ModelContainer(for: schema, configurations: [memory])
            }
        }
        container.mainContext.autosaveEnabled = false
    }

    /// Moves the store and its sidecar files into `Recovered-<timestamp>/`. Nothing is deleted.
    private static func recoverCorruptStore(_ storeURL: URL, in folder: URL) -> URL? {
        let fm = FileManager.default
        let stamp = ISO8601DateFormatter().string(from: .now).replacingOccurrences(of: ":", with: "-")
        let dest = folder.appendingPathComponent("Recovered-\(stamp)", isDirectory: true)
        try? fm.createDirectory(at: dest, withIntermediateDirectories: true)
        for suffix in ["", "-shm", "-wal"] {
            let src = URL(fileURLWithPath: storeURL.path + suffix)
            if fm.fileExists(atPath: src.path) { try? fm.moveItem(at: src, to: dest.appendingPathComponent(src.lastPathComponent)) }
        }
        return dest
    }
}
