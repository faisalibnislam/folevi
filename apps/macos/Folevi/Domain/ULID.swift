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
