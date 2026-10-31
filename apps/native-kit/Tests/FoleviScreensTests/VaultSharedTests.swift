// The Vault's shared pieces (FoleviScreens/Vault), as the Mac and the iPhone use them: CSV previews, times in the
// web's words, and /vault/<section> links.
import Foundation
import Testing
import FoleviEngine
import FoleviScreens

@Suite("Vault shared")
struct VaultSharedTests {
    @Test func csvKeepsQuotedCommasQuotesAndLineBreaks() {
        let rows = VaultCSV.parse("name,note\n\"Smith, Jo\",\"said \"\"hi\"\"\"\nA,\"two\nlines\"")
        #expect(rows == [["name", "note"], ["Smith, Jo", "said \"hi\""], ["A", "two\nlines"]])
        #expect(VaultCSV.parse("a\nb\nc", max: 2).count == 2)
    }

    @Test func relativeTimesAsTheWeb() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let ms = now.timeIntervalSince1970 * 1000
        #expect(VaultTime.relative(ms - 10_000, now: now) == "just now")
        #expect(VaultTime.relative(ms - 60_000, now: now) == "1 min ago")
        #expect(VaultTime.relative(ms - 5 * 60_000, now: now) == "5 mins ago")
        #expect(VaultTime.relative(ms - 2 * 3_600_000, now: now) == "2 hours ago")
        #expect(VaultTime.relative(ms - 3 * 86_400_000, now: now) == "3 days ago")
        #expect(VaultTime.relative(ms + 3_600_000, now: now) == "in 1 hour")
    }

    @Test func sectionLinks() {
        #expect(VaultSection(path: "/vault/passwords") == .passwords)
        #expect(VaultSection(path: "/vault/health") == .health)
        #expect(VaultSection(path: "/vault") == nil)
        #expect(VaultSection(path: "/vault/nonsense") == nil)
        #expect(VaultSection.trash.label == "Trash")
    }
}
