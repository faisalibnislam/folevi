// Views and commands the screens need that the bridge contract (apps/web/src/lib/engine/protocol.ts) doesn't
// have yet, filed in docs/NATIVE_CONTRACT_REQUESTS.md (R9.1 to R9.4) with the same names and shapes. Until the web
// bridge adds them the engine answers `unknown_view` / `unknown_command`: the screens then hide the item (a view
// with an error) or show the engine's message (a command). When `pnpm engine:gen` produces a spec with the same
// name, delete the one here and use the generated one.
import Foundation
import FoleviEngine

// MARK: R9.1 Always fully encrypted folders

public struct FolderLocksValue: Codable, Hashable, Sendable {
    /** "Always fully encrypted" is offered in this space's menus. */
    public var canLock: Bool
    /** "standard" or "encrypted". */
    public var level: String
    /** The locked folders' ids. */
    public var locked: [String]
    public init(canLock: Bool, level: String, locked: [String]) {
        self.canLock = canLock
        self.level = level
        self.locked = locked
    }
}

public struct FolderLockArgs: Codable, Hashable, Sendable {
    public var id: String
    public var locked: Bool
    public init(id: String, locked: Bool) {
        self.id = id
        self.locked = locked
    }
}

// MARK: R9.2 A note's changes

public struct ChangeDiffArgs: Codable, Hashable, Sendable {
    public var id: String
    public init(id: String) { self.id = id }
}

public struct ChangeDiffBlock: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    /// "added", "removed", "changed" or "same".
    public var change: String
    public var t: String
    public var x: String
    public var l: Int?
    public var c: Bool?
    public var before: String?
    public var who: String?
    public init(id: String, change: String, t: String, x: String, l: Int? = nil, c: Bool? = nil, before: String? = nil, who: String? = nil) {
        self.id = id
        self.change = change
        self.t = t
        self.x = x
        self.l = l
        self.c = c
        self.before = before
        self.who = who
    }
}

public struct ChangeDiffValue: Codable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var blocks: [ChangeDiffBlock]
    public var truncated: Bool
    public init(id: String, title: String, blocks: [ChangeDiffBlock], truncated: Bool) {
        self.id = id
        self.title = title
        self.blocks = blocks
        self.truncated = truncated
    }
}

// MARK: R9.4 Generate with Foli AI

public struct AiGenerateArgs: Codable, Hashable, Sendable {
    /// "template" or "note".
    public var kind: String
    public var instruction: String
    public var space: SpaceRef?
    public init(kind: String, instruction: String, space: SpaceRef? = nil) {
        self.kind = kind
        self.instruction = instruction
        self.space = space
    }
}

public struct AiGenerateResult: Codable, Hashable, Sendable {
    public var title: String
    /// Markdown.
    public var text: String
    public init(title: String, text: String) {
        self.title = title
        self.text = text
    }
}

public struct AiSaveDraftArgs: Codable, Hashable, Sendable {
    public var kind: String
    public var title: String
    public var text: String
    public var space: SpaceRef?
    public init(kind: String, title: String, text: String, space: SpaceRef? = nil) {
        self.kind = kind
        self.title = title
        self.text = text
        self.space = space
    }
}

// MARK: Specs

public enum PendingN7Views {
    public struct FolderLocks: EngineViewSpec {
        public static let name = "folders.locks"
        public var args: SpaceArgs
        public init(_ args: SpaceArgs) { self.args = args }
        public typealias Value = FolderLocksValue
    }
    public struct ChangeDiff: EngineViewSpec {
        public static let name = "changes.diff"
        public var args: ChangeDiffArgs
        public init(_ args: ChangeDiffArgs) { self.args = args }
        public typealias Value = ChangeDiffValue
    }
}

public enum PendingN7Commands {
    public struct FolderLock: EngineCommandSpec {
        public static let name = "folder.lock"
        public var args: FolderLockArgs
        public init(_ args: FolderLockArgs) { self.args = args }
        public typealias Result = OkResult
    }
    public struct AiGenerate: EngineCommandSpec {
        public static let name = "ai.generate"
        public var args: AiGenerateArgs
        public init(_ args: AiGenerateArgs) { self.args = args }
        public typealias Result = AiGenerateResult
    }
    public struct AiSaveDraft: EngineCommandSpec {
        public static let name = "ai.saveDraft"
        public var args: AiSaveDraftArgs
        public init(_ args: AiSaveDraftArgs) { self.args = args }
        public typealias Result = NoteCreateResult
    }
}
