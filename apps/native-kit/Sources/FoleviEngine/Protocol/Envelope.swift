// The envelope (protocol.ts "The envelope"), hand-written because its payloads are typed per call and per
// subscription. Outgoing messages are encoded to one JSON string each; replies are decoded straight into the
// caller's type; a batch from the engine (updates and events) is decoded in one pass, with each update's payload
// decoded as its subscription's type (looked up in `SubscriptionDecoders`, passed through `userInfo`).
import Foundation

/// A message to the engine.
struct OutgoingMessage: Encodable, Sendable {
    let v = EngineContract.protocolVersion
    let id: String
    let kind: Kind
    var app: AppInfo?
    var sub: String?
    var place: String?
    var name: String?
    var args: AnyArgs?
    var window: ListWindow?

    enum Kind: String, Encodable, Sendable { case hello, watch, unwatch, window, query, command, editor }

    enum CodingKeys: String, CodingKey { case v, id, kind, app, sub, place, name, args, window }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(v, forKey: .v)
        try c.encode(id, forKey: .id)
        try c.encode(kind, forKey: .kind)
        try c.encodeIfPresent(app, forKey: .app)
        try c.encodeIfPresent(sub, forKey: .sub)
        try c.encodeIfPresent(place, forKey: .place)
        try c.encodeIfPresent(name, forKey: .name)
        try c.encodeIfPresent(args, forKey: .args)
        try c.encodeIfPresent(window, forKey: .window)
    }

    func json() throws -> String {
        let data = try JSONEncoder().encode(self)
        return String(decoding: data, as: UTF8.self)
    }
}

/// Type-erased arguments (each spec's `Args`).
struct AnyArgs: Encodable, Sendable {
    private let encodeArgs: @Sendable (any Encoder) throws -> Void
    init<T: Encodable & Sendable>(_ value: T) { encodeArgs = { try value.encode(to: $0) } }
    func encode(to encoder: any Encoder) throws { try encodeArgs(encoder) }
}

/// A reply to one message, decoded as `Value`.
struct ReplyEnvelope<Value: Decodable>: Decodable {
    let id: String
    let ok: Bool
    let value: Value?
    let error: EngineError?

    enum CodingKeys: String, CodingKey { case kind, id, ok, value, error }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        ok = try c.decode(Bool.self, forKey: .ok)
        error = try c.decodeIfPresent(EngineError.self, forKey: .error)
        value = ok ? try c.decodeIfPresent(Value.self, forKey: .value) : nil
    }
}

extension ReplyEnvelope: Sendable where Value: Sendable {}

/// An empty value for replies whose value native ignores (unwatch, window).
struct Ignored: Decodable, Sendable {
    init(from decoder: any Decoder) throws {}
}

/// What a subscription's update payload decodes to.
enum UpdatePayload: Sendable {
    case value(any Sendable)
    case diff(any Sendable)
}

/// One subscription's payload decoder: reads `value` (value views) or `diff` (list views).
struct PayloadDecoder: Sendable {
    let decode: @Sendable (KeyedDecodingContainer<InboundItem.Key>) throws -> UpdatePayload?

    static func value<V: Decodable & Sendable>(_: V.Type) -> PayloadDecoder {
        PayloadDecoder { c in try c.decodeIfPresent(V.self, forKey: .value).map { .value($0) } }
    }

    static func list<R: EngineRow>(_: R.Type) -> PayloadDecoder {
        PayloadDecoder { c in try c.decodeIfPresent(RowDiff<R>.self, forKey: .diff).map { .diff($0) } }
    }
}

/// Subscriptions live when a batch was handed to the decoder: sub to its payload decoder.
struct SubscriptionDecoders: Sendable {
    var bySub: [String: PayloadDecoder] = [:]
    static let key = CodingUserInfoKey(rawValue: "folevi.subscriptions")!
}

/// One item of a batch (`EngineBatch`).
enum InboundItem: Decodable, Sendable {
    case update(sub: String, rev: Int, payload: UpdatePayload?, stale: Bool, error: EngineError?)
    case event(EngineEvent)
    /// A reply posted by mistake, or an update for a subscription native no longer has.
    case ignored

    enum Key: String, CodingKey { case kind, sub, rev, value, diff, stale, error, name, data }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "update":
            let sub = try c.decode(String.self, forKey: .sub)
            let rev = try c.decode(Int.self, forKey: .rev)
            let decoders = decoder.userInfo[SubscriptionDecoders.key] as? SubscriptionDecoders
            guard let payloadDecoder = decoders?.bySub[sub] else { self = .ignored; return }
            self = .update(
                sub: sub,
                rev: rev,
                payload: try payloadDecoder.decode(c),
                stale: try c.decodeIfPresent(Bool.self, forKey: .stale) ?? false,
                error: try c.decodeIfPresent(EngineError.self, forKey: .error)
            )
        case "event":
            let name = try c.decode(String.self, forKey: .name)
            self = .event(try EngineEvent.decode(name: name, from: c, key: .data))
        default:
            self = .ignored
        }
    }

    /// Decodes a batch (a JSON array) with the subscriptions' types. Runs off the main thread.
    static func decodeBatch(_ data: Data, decoders: SubscriptionDecoders) throws -> [InboundItem] {
        let decoder = JSONDecoder()
        decoder.userInfo[SubscriptionDecoders.key] = decoders
        if data.first == UInt8(ascii: "{") { return [try decoder.decode(InboundItem.self, from: data)] }
        return try decoder.decode([InboundItem].self, from: data)
    }
}
