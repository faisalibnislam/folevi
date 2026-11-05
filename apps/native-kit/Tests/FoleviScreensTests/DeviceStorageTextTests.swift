// QA F19: Offline & sync's Notes kept and Space used on the Mac, iPad and iPhone: a number once measured, "…"
// only while measuring, and "Unavailable" with Retry when a reading couldn't be had. Never "…" for good.
import Foundation
import Testing
@testable import FoleviEngine
@testable import FoleviScreens

@Suite("Offline & sync readings")
struct DeviceStorageTextTests {
    func value(notes: Int?, used: Int?) -> DeviceStorageValue {
        DeviceStorageValue(keepAll: true, available: true, spaces: [], notesKept: notes, usedBytes: used, waiting: 0)
    }

    @Test func measuringShowsTheEllipsis() {
        #expect(DeviceStorageText.notesKept(nil, stale: false, failed: false) == "…")
        #expect(DeviceStorageText.spaceUsed(value(notes: nil, used: nil), stale: true, failed: false) == "…")
        #expect(!DeviceStorageText.canRetry(nil, stale: false, failed: false))
    }

    @Test func measuredShowsNumbers() {
        let v = value(notes: 1530, used: 5 * 1024 * 1024)
        #expect(DeviceStorageText.notesKept(v, stale: false, failed: false) == 1530.formatted())
        #expect(DeviceStorageText.spaceUsed(v, stale: false, failed: false) == ByteCountFormatter.string(fromByteCount: 5 * 1024 * 1024, countStyle: .file))
        #expect(!DeviceStorageText.canRetry(v, stale: false, failed: false))
    }

    @Test func missingReadingsAreUnavailableWithRetry() {
        let v = value(notes: 12, used: nil)
        #expect(DeviceStorageText.notesKept(v, stale: false, failed: false) == "12")
        #expect(DeviceStorageText.spaceUsed(v, stale: false, failed: false) == "Unavailable")
        #expect(DeviceStorageText.canRetry(v, stale: false, failed: false))
        // A view that failed is unavailable too, never measuring.
        #expect(DeviceStorageText.notesKept(nil, stale: false, failed: true) == "Unavailable")
        #expect(DeviceStorageText.canRetry(nil, stale: false, failed: true))
    }
}
