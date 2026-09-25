import Foundation

/// A lossless, Sendable JSON value used for block props, unknown payloads and wire interop.
///
/// Numbers are stored as `Double` (like JavaScript). `canonicalString` prints JSON with recursively
/// sorted keys, no whitespace and JavaScript number formatting, so it matches the TypeScript
/// `canonicalJson` byte for byte.
public enum JSONValue: Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public static let emptyObject: JSONValue = .object([:])

    /// Round-trips any `Encodable` through JSON into a `JSONValue`.
    public init(encoding value: Encodable) throws {
        let data = try JSONEncoder().encode(AnyEncodable(value))
        self = try JSONDecoder().decode(JSONValue.self, from: data)
    }

    /// Parses JSON text.
    public init(jsonString: String) throws {
        self = try JSONDecoder().decode(JSONValue.self, from: Data(jsonString.utf8))
    }

    public init(jsonData: Data) throws {
        self = try JSONDecoder().decode(JSONValue.self, from: jsonData)
    }

    /// Decodes this value into a `Decodable` type.
    public func decode<T: Decodable>(_ type: T.Type) throws -> T {
        let data = try JSONEncoder().encode(self)
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: Accessors

    public subscript(key: String) -> JSONValue? {
        get {
            if case .object(let dict) = self { return dict[key] }
            return nil
        }
        set {
            guard case .object(var dict) = self else { return }
            dict[key] = newValue
            self = .object(dict)
        }
    }

    public var objectValue: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var doubleValue: Double? {
        if case .number(let n) = self { return n }
        return nil
    }

    public var intValue: Int? {
        if case .number(let n) = self, n.rounded() == n, abs(n) < 9.0e15 { return Int(n) }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    public var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    /// JavaScript-style truthiness (used where the TS reference relies on it).
    public var isTruthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0 && !n.isNaN
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }

    // MARK: Canonical output

    /// JSON with recursively sorted keys and no whitespace (identical to TS `canonicalJson`).
    public var canonicalString: String {
        var out = ""
        writeCanonical(into: &out)
        return out
    }

    private func writeCanonical(into out: inout String) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let n): out += JSONValue.formatNumber(n)
        case .string(let s): JSONValue.writeString(s, into: &out)
        case .array(let items):
            out += "["
            for (i, item) in items.enumerated() {
                if i > 0 { out += "," }
                item.writeCanonical(into: &out)
            }
            out += "]"
        case .object(let dict):
            out += "{"
            // JS sorts keys by UTF-16 code units; for our (ASCII) keys this equals byte order.
            let keys = dict.keys.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
            for (i, key) in keys.enumerated() {
                if i > 0 { out += "," }
                JSONValue.writeString(key, into: &out)
                out += ":"
                dict[key]?.writeCanonical(into: &out)
            }
            out += "}"
        }
    }

    /// Escapes like `JSON.stringify`.
    static func writeString(_ s: String, into out: inout String) {
        out += "\""
        for unit in s.unicodeScalars {
            switch unit {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if unit.value < 0x20 {
                    out += String(format: "\\u%04x", unit.value)
                } else {
                    out.unicodeScalars.append(unit)
                }
            }
        }
        out += "\""
    }

    /// Formats a double exactly like JavaScript's `Number.prototype.toString()`.
    public static func formatNumber(_ value: Double) -> String {
        if value.isNaN || value.isInfinite { return "null" }
        if value == 0 { return "0" }
        let negative = value < 0
        let magnitude = abs(value)
        // Swift's description yields the shortest round-tripping digits, like JS.
        let (digits, exponent) = shortestDigits(magnitude)
        let k = digits.count
        let n = exponent // position of the decimal point relative to the digit string
        var result: String
        if k <= n && n <= 21 {
            result = digits + String(repeating: "0", count: n - k)
        } else if 0 < n && n <= 21 {
            let idx = digits.index(digits.startIndex, offsetBy: n)
            result = String(digits[..<idx]) + "." + String(digits[idx...])
        } else if -6 < n && n <= 0 {
            result = "0." + String(repeating: "0", count: -n) + digits
        } else {
            let e = n - 1
            let sign = e >= 0 ? "+" : "-"
            if k == 1 {
                result = digits + "e" + sign + String(abs(e))
            } else {
                result = String(digits.prefix(1)) + "." + String(digits.dropFirst()) + "e" + sign + String(abs(e))
            }
        }
        return negative ? "-" + result : result
    }

    /// Returns (significant digits without leading/trailing zeros, decimal exponent n) such that
    /// value = 0.digits × 10^n.
    private static func shortestDigits(_ value: Double) -> (String, Int) {
        let text = "\(value)" // e.g. "1.5", "1e-07", "1.2345e+16", "1790000000000.0"
        var mantissa = text
        var exp = 0
        if let eIdx = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = String(text[..<eIdx])
            exp = Int(text[text.index(after: eIdx)...]) ?? 0
        }
        var intPart = mantissa
        var fracPart = ""
        if let dot = mantissa.firstIndex(of: ".") {
            intPart = String(mantissa[..<dot])
            fracPart = String(mantissa[mantissa.index(after: dot)...])
        }
        var all = intPart + fracPart
        var pointPos = intPart.count + exp
        // Strip leading zeros.
        while all.hasPrefix("0") && all.count > 1 {
            all.removeFirst()
            pointPos -= 1
        }
        // Strip trailing zeros.
        while all.hasSuffix("0") && all.count > 1 {
            all.removeLast()
        }
        return (all, pointPos)
    }
}

// MARK: - Codable

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? c.decode(Double.self) {
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if let a = try? c.decode([JSONValue].self) {
            self = .array(a)
        } else if let o = try? c.decode([String: JSONValue].self) {
            self = .object(o)
        } else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByBooleanLiteral, ExpressibleByFloatLiteral,
    ExpressibleByIntegerLiteral, ExpressibleByNilLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(nilLiteral: ()) { self = .null }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        var dict: [String: JSONValue] = [:]
        for (k, v) in elements { dict[k] = v }
        self = .object(dict)
    }
}

/// Type-erasing wrapper so `JSONEncoder` can encode an existential `Encodable`.
struct AnyEncodable: Encodable {
    let value: Encodable
    init(_ value: Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

/// Canonical JSON (sorted keys, JS formatting) for any Encodable value.
public func canonicalJSON(_ value: Encodable) throws -> String {
    try JSONValue(encoding: value).canonicalString
}
