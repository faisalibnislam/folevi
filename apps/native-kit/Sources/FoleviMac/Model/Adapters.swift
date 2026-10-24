// The sync status as the frame's button and popover show it (the web's SyncStatus.tsx words).
import Foundation
import FoleviDesign
import FoleviEngine

public extension SyncStatusValue {
    /// The sync button's state, as the web's SyncStatus.tsx: Synced, Syncing, Waiting/Offline, Not saved.
    var indicator: SyncIndicator {
        switch state {
        case .saved: return .saved
        case .saving: return .saving
        case .syncing:
            if let s = spaces.first(where: { $0.state == .downloading }), let total = s.total, total > 0 {
                return .syncing(progress: "Syncing \(s.have.formatted()) of \(total.formatted())")
            }
            return .syncing()
        case .offline: return .offline(waiting: pending)
        case .conflict: return .conflict
        case .error: return .error(label)
        }
    }

    /// The popover's headline (the web's words).
    var headline: String {
        switch state {
        case .saved: return "Synced"
        case .saving: return "Saving…"
        case .syncing: return "Syncing…"
        case .offline: return pending > 0 ? "Waiting to sync" : "Offline"
        case .conflict: return "Conflict"
        case .error: return "Not saved"
        }
    }

    /// The popover's explanation.
    var detail: String {
        switch state {
        case .saved: return "Everything on this Mac is saved to Folevi."
        case .saving, .syncing: return pending > 0 ? "\(pending) \(pending == 1 ? "change" : "changes") on the way to Folevi." : "Bringing your notes up to date."
        case .offline: return pending > 0 ? "\(pending) \(pending == 1 ? "change is" : "changes are") saved on this Mac and will sync when you're back online." : "You're offline. Changes are saved on this Mac and sync when you're back online."
        case .conflict: return conflicts == 1 ? "A note was changed in two places. Open it to choose what to keep." : "\(conflicts) notes were changed in two places. Open them to choose what to keep."
        case .error: return authRequired ? "Sign in again to keep syncing. Your changes are kept on this Mac." : "Some changes couldn't be saved to Folevi. They're kept on this Mac."
        }
    }

    /// Whether the popover offers Retry.
    var canRetry: Bool { state == .error || state == .conflict || (state == .offline && online) }
}
