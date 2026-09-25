import Foundation

/// Fractional ranks: base-62 strings ordered by plain byte comparison. Never end with "0".
/// Exact port of packages/editor-schema/src/rank.ts (verified by fixtures/ranks.json).
public enum Rank {
    public static let digits: [UInt8] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".utf8)
    static let base = 62

    public struct RankError: Error, CustomStringConvertible {
        public let description: String
    }

    private static let digitIndex: [UInt8: Int] = {
        var map: [UInt8: Int] = [:]
        for (i, d) in digits.enumerated() { map[d] = i }
        return map
    }()

    public static func isValid(_ rank: String) -> Bool {
        let bytes = Array(rank.utf8)
        guard let last = bytes.last, last != UInt8(ascii: "0") else { return false }
        return bytes.allSatisfy { digitIndex[$0] != nil }
    }

    /// Byte-wise comparison, identical to JS `<` for this alphabet.
    public static func compare(_ a: String, _ b: String) -> Int {
        if a == b { return 0 }
        return Array(a.utf8).lexicographicallyPrecedes(Array(b.utf8)) ? -1 : 1
    }

    private static func digit(_ byte: UInt8?) -> Int {
        guard let byte else { return 0 }
        return digitIndex[byte] ?? -1
    }

    private static func midpoint(_ a: [UInt8], _ b: [UInt8]?) throws -> [UInt8] {
        if let b {
            if !a.lexicographicallyPrecedes(b) {
                throw RankError(description: "\(String(decoding: a, as: UTF8.self)) >= \(String(decoding: b, as: UTF8.self))")
            }
            // Shared prefix (treating a as padded with zeros).
            var n = 0
            while n < b.count && (n < a.count ? a[n] : UInt8(ascii: "0")) == b[n] { n += 1 }
            if n > 0 {
                let restA = n < a.count ? Array(a[n...]) : []
                return Array(b[0..<n]) + (try midpoint(restA, Array(b[n...])))
            }
        }
        let da = a.isEmpty ? 0 : digit(a[0])
        let db = b.map { $0.isEmpty ? 0 : digit($0[0]) } ?? base
        // In JS, b[0] of an empty string is undefined → indexOf(undefined) = -1; b is never empty here
        // because a < b and the shared-prefix recursion only passes non-empty suffixes of b.
        if db - da > 1 {
            // Math.round((da + db) / 2) — halves round up.
            let mid = Int((Double(da + db) / 2).rounded(.toNearestOrAwayFromZero))
            return [digits[mid]]
        }
        if let b, b.count > 1 { return [b[0]] }
        return [digits[da]] + (try midpoint(a.count > 1 ? Array(a[1...]) : [], nil))
    }

    /// A rank strictly between `before` and `after`. `nil` means open-ended.
    public static func between(_ before: String?, _ after: String?) throws -> String {
        if let before, !isValid(before) { throw RankError(description: "invalid rank \(before)") }
        if let after, !isValid(after) { throw RankError(description: "invalid rank \(after)") }
        let result = try midpoint(Array((before ?? "").utf8), after.map { Array($0.utf8) })
        return String(decoding: result, as: UTF8.self)
    }

    /// Non-throwing variant for UI paths: falls back to appending "V" to `before` (always > before).
    public static func betweenOrAfter(_ before: String?, _ after: String?) -> String {
        if let r = try? between(before, after) { return r }
        if let before, isValid(before) { return before + "V" }
        return "V"
    }

    /// `count` evenly spread ranks between two bounds — used for imports and rebalancing.
    public static func sequence(_ count: Int, before: String? = nil, after: String? = nil) throws -> [String] {
        if count <= 0 { return [] }
        if count == 1 { return [try between(before, after)] }
        let mid = try between(before, after)
        let left = (count - 1) / 2
        return try sequence(left, before: before, after: mid) + [mid] + sequence(count - 1 - left, before: mid, after: after)
    }

    public static func needsRebalance(_ rank: String, maxLength: Int = FoleviLimits.maxRankLength) -> Bool {
        rank.utf8.count > maxLength
    }
}
