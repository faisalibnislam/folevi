import Foundation

/// Convex (and JavaScript) send integers as JSON numbers that may arrive as `3` or `3.0`.
/// These helpers accept either, but reject non-integral values.
enum FlexibleIntError: Error {
    case notIntegral(Double)
}

private func integral(_ value: Double) -> Int? {
    guard value.isFinite, value.rounded() == value, abs(value) <= 9_007_199_254_740_991 else { return nil }
    return Int(value)
}

extension KeyedDecodingContainer {
    public func decodeFlexibleInt(forKey key: Key) throws -> Int {
        if let i = try? decode(Int.self, forKey: key) { return i }
        let d = try decode(Double.self, forKey: key)
        guard let i = integral(d) else {
            throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Expected an integer, got \(d)")
        }
        return i
    }

    public func decodeFlexibleIntIfPresent(forKey key: Key) throws -> Int? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        return try decodeFlexibleInt(forKey: key)
    }
}

extension SingleValueDecodingContainer {
    public func decodeFlexibleInt() throws -> Int {
        if let i = try? decode(Int.self) { return i }
        let d = try decode(Double.self)
        guard let i = integral(d) else {
            throw DecodingError.dataCorruptedError(in: self, debugDescription: "Expected an integer, got \(d)")
        }
        return i
    }
}
