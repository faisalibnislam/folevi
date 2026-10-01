import Foundation

/// A page with changes waiting on this device: how many, any files to upload, and whether the page itself
/// hasn't reached the server yet (the sync details list them, as the web's usePendingDocs).
struct PendingDocument: Sendable, Equatable, Identifiable {
    var documentId: String
    var changes: Int
    var uploads: Int
    var isNew: Bool
    var id: String { documentId }

    /// Groups queued ops and unfinished uploads by page, in the order they were queued.
    static func from(ops: [SyncOp], uploads: [UploadRecord]) -> [PendingDocument] {
        var order: [String] = []
        var byDoc: [String: PendingDocument] = [:]
        func entry(_ id: String) -> PendingDocument {
            if byDoc[id] == nil { order.append(id) }
            return byDoc[id] ?? PendingDocument(documentId: id, changes: 0, uploads: 0, isNew: false)
        }
        for op in ops {
            guard let id = op.documentId ?? op.document?.id else { continue }
            var e = entry(id)
            e.changes += 1
            if op.kind == .documentCreate { e.isNew = true }
            byDoc[id] = e
        }
        for u in uploads where u.state != .done {
            var e = entry(u.documentId)
            e.uploads += 1
            byDoc[u.documentId] = e
        }
        return order.compactMap { byDoc[$0] }
    }
}

/// The sync status copy, word for word as the web's SyncStatus.tsx (and its en.ts messages).
enum SyncCopy {
    static func label(_ s: SyncStatus) -> String {
        switch s {
        case .saved: return String(localized: "Saved")
        case .saving: return String(localized: "Saving…")
        case .syncing: return String(localized: "Syncing…")
        case .offline: return String(localized: "Offline")
        case .conflict: return String(localized: "Conflict")
        case .error: return String(localized: "Not saved")
        }
    }

    /// What the state means (the details panel).
    static func detail(_ status: SyncStatus, pending: Int, conflicts: Int, authRequired: Bool) -> String {
        switch status {
        case .saved: return String(localized: "Every change has been saved to Folevi.")
        case .saving: return String(localized: "Sending your latest changes.")
        case .syncing: return String(localized: "Waiting for the server to confirm your changes.")
        case .offline:
            switch pending {
            case 0: return String(localized: "You can keep writing. Changes are stored on this device and will sync when you reconnect.")
            case 1: return String(localized: "You can keep writing. 1 change is stored on this device and will sync when you reconnect.")
            default: return String(localized: "You can keep writing. \(pending) changes are stored on this device and will sync when you reconnect.")
            }
        case .conflict:
            return conflicts == 1
                ? String(localized: "1 block changed in two places. Both versions are kept. Choose which to keep in the document.")
                : String(localized: "\(conflicts) blocks changed in two places. Both versions are kept. Choose which to keep in the document.")
        case .error:
            return authRequired
                ? String(localized: "Your session needs to be refreshed. Sign in again; your changes are kept on this device.")
                : String(localized: "Some changes were rejected by the server and were not saved.")
        }
    }

    /// "Sync status: Offline, 3 changes waiting" (the button's accessibility label).
    static func accessibilityLabel(_ status: SyncStatus, pending: Int) -> String {
        let l = label(status)
        switch pending {
        case 0: return String(localized: "Sync status: \(l)")
        case 1: return String(localized: "Sync status: \(l), 1 change waiting")
        default: return String(localized: "Sync status: \(l), \(pending) changes waiting")
        }
    }

    static func describeError(_ code: String) -> String {
        switch code {
        case "invalid_block": return String(localized: "A block had content Folevi couldn't store.")
        case "forbidden": return String(localized: "You no longer have permission to edit this document.")
        case "not_found": return String(localized: "The document was deleted.")
        case "limit_exceeded": return String(localized: "The document reached its size limit.")
        case "device_limit": return String(localized: "This device is over your plan's device limit.")
        default: return String(localized: "The server rejected a change (\(code)).")
        }
    }
}
