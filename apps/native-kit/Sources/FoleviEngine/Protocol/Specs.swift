// The typed handles the generated specs (Generated/EngineAPI.swift) conform to: one per view, list view,
// command and editor command, each carrying its arguments, so calls are typed end to end.
import Foundation

public protocol EngineRequestSpec: Sendable {
    associatedtype Args: Codable & Hashable & Sendable
    static var name: String { get }
    var args: Args { get }
    init(_ args: Args)
}

public protocol EngineViewSpec: EngineRequestSpec {
    associatedtype Value: Codable & Sendable
}

public protocol EngineListSpec: EngineRequestSpec {
    associatedtype Row: EngineRow
}

public protocol EngineCommandSpec: EngineRequestSpec {
    associatedtype Result: Decodable & Sendable
}

public protocol EngineEditorSpec: EngineRequestSpec {
    associatedtype Result: Decodable & Sendable
}

/// A row of a windowed list: an id and a content hash (equal hashes mean equal rows).
public protocol EngineRow: Codable, Hashable, Sendable, Identifiable where ID == String {
    var id: String { get }
    var h: String { get }
}

extension NoteRow: EngineRow {}

/// A list diff for any row type (the contract's `ListDiff`, generic). Apply: reset, remove, upsert, then order.
public struct RowDiff<Row: EngineRow>: Codable, Hashable, Sendable {
    public var reset: Bool?
    public var total: Int
    public var complete: Bool
    public var start: Int
    public var order: [String]?
    public var upsert: [String: Row]?
    public var remove: [String]?

    public init(reset: Bool? = nil, total: Int, complete: Bool, start: Int, order: [String]? = nil, upsert: [String: Row]? = nil, remove: [String]? = nil) {
        self.reset = reset
        self.total = total
        self.complete = complete
        self.start = start
        self.order = order
        self.upsert = upsert
        self.remove = remove
    }
}

/// FNV-1a 32-bit over UTF-16 code units, as 8 hex digits (protocol.ts `fnv1a`: row hashes, the schema hash).
public func fnv1a(_ text: String) -> String {
    var h: UInt32 = 0x811c_9dc5
    for unit in text.utf16 {
        h ^= UInt32(unit)
        h = h &* 0x0100_0193
    }
    let hex = String(h, radix: 16)
    return String(repeating: "0", count: 8 - hex.count) + hex
}
