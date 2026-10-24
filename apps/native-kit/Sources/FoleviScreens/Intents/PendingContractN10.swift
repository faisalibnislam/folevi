// Stand-ins for the contract pieces N10 and N11 asked for in docs/NATIVE_CONTRACT_REQUESTS.md (R10.x, R11.x).
// Same names and shapes as the requests; delete each once `pnpm engine:gen` generates it.
import Foundation
import FoleviEngine

/// A field a patch either leaves alone, clears (sends `null`) or sets.
public enum PatchField<T: Codable & Hashable & Sendable>: Hashable, Sendable {
    case keep
    case clear
    case set(T)

    var isKept: Bool { if case .keep = self { true } else { false } }
}

/// R10.1: `task.update` with fields that can be cleared. The generated `TaskUpdateArgs` encodes a nil optional
/// by leaving it out (`encodeIfPresent`), so "no date", "no time", "nobody" and "no reminder" can't be sent.
public struct TaskPatchArgs: Codable, Hashable, Sendable {
    public var id: String
    public var checked: Bool?
    public var canceled: Bool?
    public var dueDate: PatchField<String> = .keep
    public var dueTime: PatchField<String> = .keep
    public var priority: TaskUpdateArgs.Priority?
    public var assigneeId: PatchField<String> = .keep
    public var reminderAt: PatchField<Double> = .keep

    public init(id: String, checked: Bool? = nil, canceled: Bool? = nil, dueDate: PatchField<String> = .keep, dueTime: PatchField<String> = .keep, priority: TaskUpdateArgs.Priority? = nil, assigneeId: PatchField<String> = .keep, reminderAt: PatchField<Double> = .keep) {
        self.id = id
        self.checked = checked
        self.canceled = canceled
        self.dueDate = dueDate
        self.dueTime = dueTime
        self.priority = priority
        self.assigneeId = assigneeId
        self.reminderAt = reminderAt
    }

    enum CodingKeys: String, CodingKey { case id, checked, canceled, dueDate, dueTime, priority, assigneeId, reminderAt }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(checked, forKey: .checked)
        try c.encodeIfPresent(canceled, forKey: .canceled)
        try c.encodeIfPresent(priority, forKey: .priority)
        func put<T: Encodable>(_ f: PatchField<T>, _ key: CodingKeys) throws {
            switch f {
            case .keep: break
            case .clear: try c.encodeNil(forKey: key)
            case .set(let v): try c.encode(v, forKey: key)
            }
        }
        try put(dueDate, .dueDate)
        try put(dueTime, .dueTime)
        try put(assigneeId, .assigneeId)
        try put(reminderAt, .reminderAt)
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        checked = try c.decodeIfPresent(Bool.self, forKey: .checked)
        canceled = try c.decodeIfPresent(Bool.self, forKey: .canceled)
        priority = try c.decodeIfPresent(TaskUpdateArgs.Priority.self, forKey: .priority)
        func get<T: Decodable>(_ key: CodingKeys, _ t: T.Type) throws -> PatchField<T> {
            guard c.contains(key) else { return .keep }
            if try c.decodeNil(forKey: key) { return .clear }
            return .set(try c.decode(T.self, forKey: key))
        }
        dueDate = try get(.dueDate, String.self)
        dueTime = try get(.dueTime, String.self)
        assigneeId = try get(.assigneeId, String.self)
        reminderAt = try get(.reminderAt, Double.self)
    }
}

/// R11.2: declining a workspace or page invitation from the bell.
public struct InviteDeclineArgs: Codable, Hashable, Sendable {
    public var inviteId: String
    /// "workspace" or "page".
    public var kind: String
    public init(inviteId: String, kind: String) {
        self.inviteId = inviteId
        self.kind = kind
    }
}

public enum PendingN10Commands {
    /// `task.update` sent with `TaskPatchArgs` (R10.1), so cleared fields go as `null`.
    public struct TaskPatch: EngineCommandSpec {
        public static let name = "task.update"
        public typealias Args = TaskPatchArgs
        public typealias Result = OkResult
        public var args: Args
        public init(_ args: Args) { self.args = args }
    }

    /// `invite.decline` (R11.2). Until the engine has it, the bell removes the notification instead.
    public struct InviteDecline: EngineCommandSpec {
        public static let name = "invite.decline"
        public typealias Args = InviteDeclineArgs
        public typealias Result = OkResult
        public var args: Args
        public init(_ args: Args) { self.args = args }
    }
}

public extension EngineCommandSpec where Self == PendingN10Commands.TaskPatch {
    static func taskPatch(_ args: TaskPatchArgs) -> Self { Self(args) }
}

public extension EngineCommandSpec where Self == PendingN10Commands.InviteDecline {
    static func inviteDecline(inviteId: String, kind: String) -> Self { Self(InviteDeclineArgs(inviteId: inviteId, kind: kind)) }
}
