import Foundation

/// A block as stored on the server and exchanged on the wire. `type` may be unknown to this client.
/// `text` and `props` are kept as raw JSON so blocks written by newer clients survive untouched.
public struct WireBlock: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var type: String
    public var parentId: String?
    public var rank: String
    public var schemaVersion: Int
    public var text: JSONValue
    public var props: JSONValue
    /// Server revision; absent for never-acknowledged local blocks.
    public var revision: Int?

    public init(id: String, type: String, parentId: String?, rank: String, schemaVersion: Int = foleviSchemaVersion,
                text: JSONValue = .array([]), props: JSONValue = .emptyObject, revision: Int? = nil) {
        self.id = id
        self.type = type
        self.parentId = parentId
        self.rank = rank
        self.schemaVersion = schemaVersion
        self.text = text
        self.props = props
        self.revision = revision
    }

    enum CodingKeys: String, CodingKey { case id, type, parentId, rank, schemaVersion, text, props, revision }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decode(String.self, forKey: .type)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        rank = try c.decode(String.self, forKey: .rank)
        schemaVersion = try c.decodeFlexibleIntIfPresent(forKey: .schemaVersion) ?? foleviSchemaVersion
        text = try c.decodeIfPresent(JSONValue.self, forKey: .text) ?? .array([])
        props = try c.decodeIfPresent(JSONValue.self, forKey: .props) ?? .emptyObject
        revision = try c.decodeFlexibleIntIfPresent(forKey: .revision)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(type, forKey: .type)
        // parentId is always present on the wire (null for roots).
        if let parentId { try c.encode(parentId, forKey: .parentId) } else { try c.encodeNil(forKey: .parentId) }
        try c.encode(rank, forKey: .rank)
        try c.encode(schemaVersion, forKey: .schemaVersion)
        try c.encode(text, forKey: .text)
        try c.encode(props, forKey: .props)
        try c.encodeIfPresent(revision, forKey: .revision)
    }

    /// JSON value with the exact wire shape (parentId null, revision omitted when absent).
    public var jsonValue: JSONValue {
        var o: [String: JSONValue] = [
            "id": .string(id),
            "type": .string(type),
            "parentId": parentId.map { .string($0) } ?? .null,
            "rank": .string(rank),
            "schemaVersion": .number(Double(schemaVersion)),
            "text": text,
            "props": props,
        ]
        if let revision { o["revision"] = .number(Double(revision)) }
        return .object(o)
    }

    public init(json: JSONValue) throws {
        self = try json.decode(WireBlock.self)
    }

    public func withoutRevision() -> WireBlock {
        var b = self
        b.revision = nil
        return b
    }

    /// Typed inline text (empty when the payload is not valid for this client).
    public var inlineText: [InlineNode] {
        (try? text.decode([InlineNode].self)) ?? []
    }

    /// Content equality ignoring position and revision (TS `sameContent`).
    public func sameContent(as other: WireBlock) -> Bool {
        type == other.type && text.canonicalString == other.text.canonicalString && props.canonicalString == other.props.canonicalString
    }
}

extension WireBlock: TreeNode {}

/// Typed block. Blocks from newer schema versions or with unknown/invalid payloads become `.unknown`,
/// carrying the original payload so they can be written back untouched (TS `parseBlock`/`serializeBlock`).
public struct Block: Sendable, Hashable, Identifiable {
    public var id: String
    public var parentId: String?
    public var rank: String
    public var text: [InlineNode]
    public var content: BlockContent
    public var revision: Int?
    /// For unknown blocks only: the original schema version and raw text.
    public var originalSchemaVersion: Int
    public var rawText: JSONValue?

    public init(id: String, parentId: String?, rank: String, text: [InlineNode] = [], content: BlockContent, revision: Int? = nil) {
        self.id = id
        self.parentId = parentId
        self.rank = rank
        self.text = text
        self.content = content
        self.revision = revision
        self.originalSchemaVersion = foleviSchemaVersion
        self.rawText = nil
    }

    public var isUnknown: Bool {
        if case .unknown = content { return true }
        return false
    }

    public var typeName: String { content.typeName }

    public init(wire input: WireBlock) {
        let wire = input.schemaVersion < foleviSchemaVersion ? BlockMigrations.migrate(input) : input
        id = wire.id
        parentId = wire.parentId
        rank = wire.rank
        revision = wire.revision
        originalSchemaVersion = wire.schemaVersion
        rawText = nil
        let known = BlockContent.knownTypes.contains(wire.type)
        if known, wire.schemaVersion <= foleviSchemaVersion,
           let typedText = try? wire.text.decode([InlineNode].self),
           let typed = try? BlockContent.decode(type: wire.type, props: wire.props),
           BlockValidation.isValid(content: typed, text: typedText) {
            text = typedText
            content = typed
            originalSchemaVersion = foleviSchemaVersion
        } else {
            text = (try? wire.text.decode([InlineNode].self)) ?? []
            content = .unknown(type: wire.type, props: wire.props)
            rawText = wire.text
        }
    }

    public var wire: WireBlock {
        if case .unknown(let type, let props) = content {
            return WireBlock(id: id, type: type, parentId: parentId, rank: rank, schemaVersion: originalSchemaVersion,
                             text: rawText ?? .array([]), props: props, revision: revision)
        }
        let props = (try? content.encodedProps()) ?? .emptyObject
        let textJSON = (try? JSONValue(encoding: text)) ?? .array([])
        return WireBlock(id: id, type: content.typeName, parentId: parentId, rank: rank, schemaVersion: foleviSchemaVersion,
                         text: textJSON, props: props, revision: revision)
    }
}

extension Block: TreeNode {}

/// Minimal structural validation mirroring the limits the server enforces (validate.ts).
enum BlockValidation {
    static func isValid(content: BlockContent, text: [InlineNode]) -> Bool {
        if RichText.textLength(text) > FoleviLimits.maxTextLength { return false }
        switch content {
        case .code(let p):
            return p.code.utf16.count <= FoleviLimits.maxCodeLength && foleviCodeLanguages.contains(p.language)
        case .table(let p):
            return p.rows.count <= FoleviLimits.maxTableRows && p.rows.allSatisfy { $0.count <= FoleviLimits.maxTableColumns }
        default:
            return true
        }
    }
}

/// Schema migrations (packages/editor-schema/src/migrations.ts). Version 0 is the alpha format.
enum BlockMigrations {
    static func migrate(_ block: WireBlock) -> WireBlock {
        var current = block
        while current.schemaVersion < foleviSchemaVersion {
            if current.schemaVersion == 0 {
                current = v0to1(current)
            } else {
                // Unknown old version: leave as-is (it will be preserved as unknown).
                return current
            }
        }
        return current
    }

    private static func v0to1(_ b: WireBlock) -> WireBlock {
        var out = b
        if case .string(let legacy) = b.text {
            out.text = legacy.isEmpty ? .array([]) : .array([["type": "text", "text": .string(legacy)]])
        }
        out.schemaVersion = 1
        switch b.type {
        case "h1", "h2", "h3":
            out.type = "heading"
            out.props = ["level": .number(Double(Int(b.type.dropFirst()) ?? 1))]
        case "checklist":
            var props = b.props.objectValue ?? [:]
            let done = props.removeValue(forKey: "done")?.boolValue ?? false
            props["checked"] = .bool(done)
            out.type = "todo"
            out.props = .object(props)
        case "bullet":
            out.type = "bulleted"
            out.props = .emptyObject
        case "text":
            out.type = "paragraph"
            out.props = .emptyObject
        default:
            break
        }
        return out
    }
}

// MARK: - Convenience constructors

extension BlockContent {
    /// Default content for a block type chosen from the slash menu / Turn Into.
    static func defaultContent(for type: String) -> BlockContent {
        switch type {
        case "heading1": return .heading(HeadingProps(level: .level1))
        case "heading2": return .heading(HeadingProps(level: .level2))
        case "heading3": return .heading(HeadingProps(level: .level3))
        case "heading": return .heading(HeadingProps(level: .level1))
        case "bulleted": return .bulleted(BulletedProps())
        case "numbered": return .numbered(NumberedProps())
        case "todo": return .todo(TodoProps(checked: false))
        case "toggle": return .toggle(ToggleProps(collapsed: false))
        case "quote": return .quote(QuoteProps())
        case "callout": return .callout(CalloutProps(tone: .note, icon: nil))
        case "divider": return .divider(DividerProps())
        case "code": return .code(CodeProps(language: "plaintext", code: ""))
        default: return InsertCatalog.content(for: type) ?? .paragraph(ParagraphProps())
        }
    }
}
