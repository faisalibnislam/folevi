import Foundation
import Security

/// Crockford base32 ULIDs, identical in shape to `packages/editor-schema/src/ids.ts`.
public enum ULID {
    static let alphabet: [Character] = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    public static func make(now: Date = Date()) -> String {
        var time = ""
        var t = UInt64(max(0, (now.timeIntervalSince1970 * 1000).rounded(.down)))
        for _ in 0..<10 {
            time = String(alphabet[Int(t % 32)]) + time
            t /= 32
        }
        var bytes = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
        }
        var rand = ""
        for b in bytes { rand.append(alphabet[Int(b % 32)]) }
        return time + rand
    }

    public static func isULID(_ value: String) -> Bool {
        guard value.count == 26 else { return false }
        let allowed = Set(alphabet)
        return value.allSatisfy { allowed.contains($0) }
    }

    /// Ids are ULIDs for new content; legacy/imported ids may be any url-safe string up to 64 chars.
    public static func isValidId(_ value: String) -> Bool {
        guard (1...64).contains(value.count) else { return false }
        return value.unicodeScalars.allSatisfy { s in
            (s >= "A" && s <= "Z") || (s >= "a" && s <= "z") || (s >= "0" && s <= "9") || s == "_" || s == "-"
        }
    }
}

/// Deterministic Daily Note ids (packages/editor-schema/src/ids.ts `dailyDocumentId`), so every device
/// — even offline — creates or opens the same document instead of racing to create duplicates.
public enum DailyNote {
    /// 64-bit FNV-1a over UTF-16 code units, 16 lowercase hex chars.
    static func fnv1a64(_ input: String) -> String {
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        let prime: UInt64 = 0x0000_0100_0000_01b3
        for unit in input.utf16 {
            h ^= UInt64(unit)
            h = h &* prime
        }
        let hex = String(h, radix: 16)
        return String(repeating: "0", count: max(0, 16 - hex.count)) + hex
    }

    /// `dailyDocumentId`: hashes `profileId:scopeKey` (`Scope.key`).
    public static func documentId(profileId: String, scopeKey: String, date: String) -> String {
        "daily-\(date)-\(fnv1a64("\(profileId):\(scopeKey)"))"
    }

    /// "Friday, September 25, 2026" (matches convex/tasks.ts `dailyTitle`).
    public static func title(for date: String) -> String {
        guard let d = TaskLogic.parseDate(date) else { return date }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEEE, MMMM d, yyyy"
        return f.string(from: d)
    }
}

/// The person's Inbox page (Quick Add target): `inbox-<fnv1a64("profileId:scopeKey")>`, identical to
/// packages/editor-schema `inboxDocumentId`, so offline devices converge on one page.
public enum InboxPage {
    public static let title = "Inbox"
    public static let icon = "📥"

    public static func documentId(profileId: String, scopeKey: String) -> String {
        "inbox-\(DailyNote.fnv1a64("\(profileId):\(scopeKey)"))"
    }
}
