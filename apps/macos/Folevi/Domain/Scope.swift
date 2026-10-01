import Foundation

/// Where content lives (convex/lib/scope.ts `vScopeArg`): the person's own Personal, or a team workspace
/// they belong to. Personal is not a workspace. On the wire it is `{kind: "personal"}` or
/// `{kind: "workspace", workspaceId}`.
public enum Scope: Sendable, Hashable, Codable {
    case personal
    case workspace(String)

    /// `scopeIdKey` in packages/editor-schema/src/ids.ts: "personal", or the workspace's public id.
    /// Deterministic page ids (Inbox) hash `profileId:key`.
    public var key: String {
        switch self {
        case .personal: return "personal"
        case .workspace(let id): return id
        }
    }

    public var workspaceId: String? {
        if case .workspace(let id) = self { return id }
        return nil
    }

    public var isPersonal: Bool { self == .personal }

    /// The `scope` argument for Convex functions.
    public var arg: JSONValue {
        switch self {
        case .personal: return .object(["kind": .string("personal")])
        case .workspace(let id): return .object(["kind": .string("workspace"), "workspaceId": .string(id)])
        }
    }

    /// The key the local library files a scope's pages under. Personal is keyed by its owner, so pages
    /// shared from someone else's Personal never land in yours.
    public func storeKey(profileId: String) -> String {
        switch self {
        case .personal: return "p:\(profileId)"
        case .workspace(let id): return id
        }
    }

    /// Persisted form: "personal" or the workspace id.
    public init(key: String) {
        self = key == "personal" ? .personal : .workspace(key)
    }

    private enum CodingKeys: String, CodingKey { case kind, workspaceId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        if kind == "workspace" {
            self = .workspace(try c.decode(String.self, forKey: .workspaceId))
        } else {
            self = .personal
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .personal:
            try c.encode("personal", forKey: .kind)
        case .workspace(let id):
            try c.encode("workspace", forKey: .kind)
            try c.encode(id, forKey: .workspaceId)
        }
    }
}

extension DocumentSummary {
    /// The local library key for this page (`Scope.storeKey`): its workspace, or its owner's Personal.
    public var storeKey: String {
        workspaceId.isEmpty ? "p:\(ownerProfileId ?? "")" : workspaceId
    }
}
