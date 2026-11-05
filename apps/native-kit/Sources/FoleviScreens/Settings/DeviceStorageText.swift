// Settings > Offline & sync's readings of this device's copy (Notes kept, Space used), on the Mac, iPad and
// iPhone (QA F19): a number once measured, "…" only while the engine is still measuring (the `device.storage`
// view is stale until its first measure, which now always finishes within seconds), and "Unavailable" with Retry
// when this device couldn't give a reading. Never "…" for good.
import Foundation
import FoleviEngine

public enum DeviceStorageText {
    public static let measuring = "…"
    public static let unavailable = "Unavailable"

    /// Still measuring: no value yet, or the first measure hasn't finished.
    public static func isMeasuring(_ value: DeviceStorageValue?, stale: Bool, failed: Bool) -> Bool {
        !failed && (value == nil || stale)
    }

    public static func notesKept(_ value: DeviceStorageValue?, stale: Bool, failed: Bool) -> String {
        if isMeasuring(value, stale: stale, failed: failed) { return measuring }
        return value?.notesKept.map { $0.formatted() } ?? unavailable
    }

    public static func spaceUsed(_ value: DeviceStorageValue?, stale: Bool, failed: Bool) -> String {
        if isMeasuring(value, stale: stale, failed: failed) { return measuring }
        return value?.usedBytes.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) } ?? unavailable
    }

    /// A reading is unavailable: the section offers Retry.
    public static func canRetry(_ value: DeviceStorageValue?, stale: Bool, failed: Bool) -> Bool {
        if isMeasuring(value, stale: stale, failed: failed) { return false }
        return failed || value?.notesKept == nil || value?.usedBytes == nil
    }
}

public extension ValueStore where Value == DeviceStorageValue {
    var notesKeptText: String { DeviceStorageText.notesKept(value, stale: isStale, failed: error != nil) }
    var spaceUsedText: String { DeviceStorageText.spaceUsed(value, stale: isStale, failed: error != nil) }
    var canRetryReadings: Bool { DeviceStorageText.canRetry(value, stale: isStale, failed: error != nil) }
}
