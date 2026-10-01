import Foundation

/// New notes start Plain (no cover) and wide, as the web (editor-schema DEFAULT_DOCUMENT_STYLE).
public let defaultDocumentStyle = DocumentStyle(font: .sans, width: .wide, background: .paper, accent: .accent, card: .folio)
public let defaultDocumentCover = DocumentCover(kind: .none)

/// Server document summary (convex/lib/documents.ts `toSummary`), also used for locally created documents.
public struct DocumentSummary: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    /// The page's workspace, or "" for a Personal page (the server sends null).
    public var workspaceId: String
    /// The owner of a Personal page; nil for workspace pages.
    public var ownerProfileId: String?
    public var parentDocumentId: String?
    public var folderId: String?
    public var kind: DocumentKind
    public var title: String
    public var icon: String?
    public var cover: DocumentCover
    public var style: DocumentStyle
    public var dailyDate: String?
    public var rank: String
    public var createdAt: Double
    public var updatedAt: Double
    public var createdBy: String
    public var archivedAt: Double?
    public var deletedAt: Double?
    public var revision: Int
    public var titleRev: Int
    public var seq: Double
    public var excerpt: String
    public var wordCount: Int
    public var blockCount: Int
    /// Present in `documents:list` results only.
    public var starred: Bool?
    public var tags: [TagRef]?

    public struct TagRef: Codable, Sendable, Hashable {
        public var id: String
        public var name: String
        public var color: String
    }

    public init(id: String, workspaceId: String, ownerProfileId: String? = nil, parentDocumentId: String? = nil, folderId: String? = nil, kind: DocumentKind = .document,
                title: String, icon: String? = nil, cover: DocumentCover = defaultDocumentCover, style: DocumentStyle = defaultDocumentStyle,
                dailyDate: String? = nil, rank: String = "V", createdAt: Double, updatedAt: Double, createdBy: String = "",
                archivedAt: Double? = nil, deletedAt: Double? = nil, revision: Int = 0, titleRev: Int = 0, seq: Double = 0,
                excerpt: String = "", wordCount: Int = 0, blockCount: Int = 0) {
        self.id = id
        self.workspaceId = workspaceId
        self.ownerProfileId = ownerProfileId
        self.parentDocumentId = parentDocumentId
        self.folderId = folderId
        self.kind = kind
        self.title = title
        self.icon = icon
        self.cover = cover
        self.style = style
        self.dailyDate = dailyDate
        self.rank = rank
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.createdBy = createdBy
        self.archivedAt = archivedAt
        self.deletedAt = deletedAt
        self.revision = revision
        self.titleRev = titleRev
        self.seq = seq
        self.excerpt = excerpt
        self.wordCount = wordCount
        self.blockCount = blockCount
    }

    enum CodingKeys: String, CodingKey {
        case id, workspaceId, ownerProfileId, parentDocumentId, folderId, kind, title, icon, cover, style, dailyDate, rank, createdAt, updatedAt,
             createdBy, archivedAt, deletedAt, revision, titleRev, seq, excerpt, wordCount, blockCount, starred, tags
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        workspaceId = try c.decodeIfPresent(String.self, forKey: .workspaceId) ?? ""
        ownerProfileId = try c.decodeIfPresent(String.self, forKey: .ownerProfileId)
        parentDocumentId = try c.decodeIfPresent(String.self, forKey: .parentDocumentId)
        folderId = try c.decodeIfPresent(String.self, forKey: .folderId)
        kind = (try? c.decode(DocumentKind.self, forKey: .kind)) ?? .document
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        cover = (try? c.decode(DocumentCover.self, forKey: .cover)) ?? defaultDocumentCover
        style = (try? c.decode(DocumentStyle.self, forKey: .style)) ?? defaultDocumentStyle
        dailyDate = try c.decodeIfPresent(String.self, forKey: .dailyDate)
        rank = try c.decodeIfPresent(String.self, forKey: .rank) ?? "V"
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy) ?? ""
        archivedAt = try c.decodeIfPresent(Double.self, forKey: .archivedAt)
        deletedAt = try c.decodeIfPresent(Double.self, forKey: .deletedAt)
        revision = try c.decodeFlexibleIntIfPresent(forKey: .revision) ?? 0
        titleRev = try c.decodeFlexibleIntIfPresent(forKey: .titleRev) ?? 0
        seq = try c.decodeIfPresent(Double.self, forKey: .seq) ?? 0
        excerpt = try c.decodeIfPresent(String.self, forKey: .excerpt) ?? ""
        wordCount = try c.decodeFlexibleIntIfPresent(forKey: .wordCount) ?? 0
        blockCount = try c.decodeFlexibleIntIfPresent(forKey: .blockCount) ?? 0
        starred = try c.decodeIfPresent(Bool.self, forKey: .starred)
        tags = try c.decodeIfPresent([TagRef].self, forKey: .tags)
    }

    public var displayTitle: String {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? String(localized: "Untitled") : t
    }

    public var isArchived: Bool { archivedAt != nil }
    public var isTrashed: Bool { deletedAt != nil }
}

/// `document.create` payload (types.ts `WireDocumentCreate`).
public struct WireDocumentCreate: Codable, Sendable, Hashable {
    public var id: String
    public var parentDocumentId: String?
    public var folderId: String?
    public var kind: DocumentKind
    public var title: String
    public var icon: String?
    public var style: DocumentStyle?
    public var cover: DocumentCover?
    public var dailyDate: String?
    public var templateId: String?
    /// Where a top-level page is created (a nested page always lives in its parent's scope). Stamped when
    /// the op is queued, so switching scope before it syncs can't move it.
    public var scope: Scope?

    public init(id: String, parentDocumentId: String? = nil, folderId: String? = nil, kind: DocumentKind = .document, title: String,
                icon: String? = nil, style: DocumentStyle? = nil, cover: DocumentCover? = nil, dailyDate: String? = nil, templateId: String? = nil,
                scope: Scope? = nil) {
        self.id = id
        self.scope = scope
        self.parentDocumentId = parentDocumentId
        self.folderId = folderId
        self.kind = kind
        self.title = title
        self.icon = icon
        self.style = style
        self.cover = cover
        self.dailyDate = dailyDate
        self.templateId = templateId
    }

    enum CodingKeys: String, CodingKey { case id, parentDocumentId, folderId, kind, title, icon, style, cover, dailyDate, templateId, scope }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        if let parentDocumentId { try c.encode(parentDocumentId, forKey: .parentDocumentId) } else { try c.encodeNil(forKey: .parentDocumentId) }
        if let folderId { try c.encode(folderId, forKey: .folderId) } else { try c.encodeNil(forKey: .folderId) }
        try c.encode(kind, forKey: .kind)
        try c.encode(title, forKey: .title)
        if let icon { try c.encode(icon, forKey: .icon) } else { try c.encodeNil(forKey: .icon) }
        try c.encodeIfPresent(style, forKey: .style)
        try c.encodeIfPresent(cover, forKey: .cover)
        try c.encodeIfPresent(dailyDate, forKey: .dailyDate)
        try c.encodeIfPresent(templateId, forKey: .templateId)
        try c.encodeIfPresent(scope, forKey: .scope)
    }
}

/// `document.update` patch. A double optional distinguishes "unchanged" (nil) from "cleared" (.some(nil)).
public struct WireDocumentPatch: Codable, Sendable, Hashable {
    public var title: String?
    public var icon: String??
    public var cover: DocumentCover?
    public var style: DocumentStyle?
    public var folderId: String??
    public var parentDocumentId: String??

    public init(title: String? = nil, icon: String?? = nil, cover: DocumentCover? = nil, style: DocumentStyle? = nil,
                folderId: String?? = nil, parentDocumentId: String?? = nil) {
        self.title = title
        self.icon = icon
        self.cover = cover
        self.style = style
        self.folderId = folderId
        self.parentDocumentId = parentDocumentId
    }

    enum CodingKeys: String, CodingKey { case title, icon, cover, style, folderId, parentDocumentId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        cover = try c.decodeIfPresent(DocumentCover.self, forKey: .cover)
        style = try c.decodeIfPresent(DocumentStyle.self, forKey: .style)
        func dbl(_ key: CodingKeys) throws -> String?? {
            guard c.contains(key) else { return nil }
            if try c.decodeNil(forKey: key) { return .some(nil) }
            return .some(try c.decode(String.self, forKey: key))
        }
        icon = try dbl(.icon)
        folderId = try dbl(.folderId)
        parentDocumentId = try dbl(.parentDocumentId)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(cover, forKey: .cover)
        try c.encodeIfPresent(style, forKey: .style)
        func dbl(_ value: String??, _ key: CodingKeys) throws {
            switch value {
            case .none: break
            case .some(.none): try c.encodeNil(forKey: key)
            case .some(.some(let v)): try c.encode(v, forKey: key)
            }
        }
        try dbl(icon, .icon)
        try dbl(folderId, .folderId)
        try dbl(parentDocumentId, .parentDocumentId)
    }

    /// Later patch wins field by field.
    public func merged(with later: WireDocumentPatch) -> WireDocumentPatch {
        var out = self
        if let t = later.title { out.title = t }
        if let i = later.icon { out.icon = i }
        if let c = later.cover { out.cover = c }
        if let s = later.style { out.style = s }
        if let f = later.folderId { out.folderId = f }
        if let p = later.parentDocumentId { out.parentDocumentId = p }
        return out
    }

    public var isEmpty: Bool {
        title == nil && icon == nil && cover == nil && style == nil && folderId == nil && parentDocumentId == nil
    }
}

extension DocumentSummary {
    /// Applies a local patch optimistically.
    public mutating func apply(_ patch: WireDocumentPatch, now: Double) {
        if let t = patch.title { title = t }
        if let i = patch.icon { icon = i }
        if let c = patch.cover { cover = c }
        if let s = patch.style { style = s }
        if let f = patch.folderId { folderId = f }
        if let p = patch.parentDocumentId { parentDocumentId = p }
        updatedAt = now
    }
}
