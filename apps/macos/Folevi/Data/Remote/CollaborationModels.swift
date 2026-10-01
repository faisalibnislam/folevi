import Foundation

// DTOs and pure helpers for comments, notifications and sharing (convex/comments.ts,
// convex/notifications.ts, convex/sharing.ts). Compiled into the unit tests too, so it only uses the
// Domain types and Foundation.

// MARK: - Comments (comments:threads)

/// Someone who can be @mentioned on a note (comments:mentionable). No emails.
struct MentionPerson: Codable, Sendable, Hashable, Identifiable {
    var profileId: String
    var displayName: String
    var isYou: Bool?
    var guest: Bool?
    var id: String { profileId }
}

/// A person's name and picture, as comment and notification rows show them.
struct PersonFace: Codable, Sendable, Hashable {
    var name: String
    var avatarUrl: String?
}

/// Every comment thread on a note, newest activity first, plus a summary per commented block.
struct CommentsData: Decodable, Sendable, Hashable {
    struct Comment: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var authorId: String
        var authorName: String
        var authorAvatarUrl: String?
        var body: [InlineNode]
        var deleted: Bool
        var createdAt: Double
        var editedAt: Double?
        var mine: Bool
        var canEdit: Bool
        var canDelete: Bool

        /// Not on the server yet (sent from this Mac a moment ago).
        var isPending: Bool { id.hasPrefix("pending-") }

        enum CodingKeys: String, CodingKey {
            case id, authorId, authorName, authorAvatarUrl, body, deleted, createdAt, editedAt, mine, canEdit, canDelete
        }

        init(id: String, authorId: String, authorName: String, authorAvatarUrl: String?, body: [InlineNode], deleted: Bool,
             createdAt: Double, editedAt: Double?, mine: Bool, canEdit: Bool, canDelete: Bool) {
            self.id = id
            self.authorId = authorId
            self.authorName = authorName
            self.authorAvatarUrl = authorAvatarUrl
            self.body = body
            self.deleted = deleted
            self.createdAt = createdAt
            self.editedAt = editedAt
            self.mine = mine
            self.canEdit = canEdit
            self.canDelete = canDelete
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            authorId = try c.decodeIfPresent(String.self, forKey: .authorId) ?? ""
            authorName = try c.decodeIfPresent(String.self, forKey: .authorName) ?? ""
            authorAvatarUrl = try c.decodeIfPresent(String.self, forKey: .authorAvatarUrl)
            // A node this app doesn't know yet shouldn't hide the whole thread list.
            body = (try? c.decodeIfPresent([InlineNode].self, forKey: .body)) ?? []
            deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
            createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
            editedAt = try c.decodeIfPresent(Double.self, forKey: .editedAt)
            mine = try c.decodeIfPresent(Bool.self, forKey: .mine) ?? false
            canEdit = try c.decodeIfPresent(Bool.self, forKey: .canEdit) ?? false
            canDelete = try c.decodeIfPresent(Bool.self, forKey: .canDelete) ?? false
        }
    }

    struct Thread: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var blockId: String?
        /// False when the block this thread was on has been deleted (the thread stays readable); nil on the whole note.
        var blockExists: Bool?
        var blockText: String?
        /// "open" | "resolved"
        var status: String
        var createdAt: Double
        var lastActivityAt: Double
        var resolvedBy: String?
        var resolvedAt: Double?
        var unread: Bool
        var canResolve: Bool
        var canDelete: Bool
        var comments: [Comment]

        var isResolved: Bool { status == "resolved" }
        var isPending: Bool { id.hasPrefix("pending-") }
    }

    /// The "2 comments · 8:18 AM" line under a block: its open threads.
    struct BlockSummary: Decodable, Sendable, Hashable, Identifiable {
        var blockId: String
        var threads: Int
        var comments: Int
        var lastActivityAt: Double
        var unread: Bool
        var authors: [PersonFace]
        var id: String { blockId }

        enum CodingKeys: String, CodingKey { case blockId, threads, comments, lastActivityAt, unread, authors }

        init(blockId: String, threads: Int, comments: Int, lastActivityAt: Double, unread: Bool, authors: [PersonFace]) {
            self.blockId = blockId
            self.threads = threads
            self.comments = comments
            self.lastActivityAt = lastActivityAt
            self.unread = unread
            self.authors = authors
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            blockId = try c.decode(String.self, forKey: .blockId)
            threads = Int(try c.decodeIfPresent(Double.self, forKey: .threads) ?? 0)
            comments = Int(try c.decodeIfPresent(Double.self, forKey: .comments) ?? 0)
            lastActivityAt = try c.decodeIfPresent(Double.self, forKey: .lastActivityAt) ?? 0
            unread = try c.decodeIfPresent(Bool.self, forKey: .unread) ?? false
            authors = try c.decodeIfPresent([PersonFace].self, forKey: .authors) ?? []
        }
    }

    var threads: [Thread]
    var blocks: [BlockSummary]
    var canComment: Bool
    var canManage: Bool

    enum CodingKeys: String, CodingKey { case threads, blocks, canComment, canManage }

    init(threads: [Thread], blocks: [BlockSummary], canComment: Bool, canManage: Bool) {
        self.threads = threads
        self.blocks = blocks
        self.canComment = canComment
        self.canManage = canManage
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        threads = try c.decodeIfPresent([Thread].self, forKey: .threads) ?? []
        blocks = try c.decodeIfPresent([BlockSummary].self, forKey: .blocks) ?? []
        canComment = try c.decodeIfPresent(Bool.self, forKey: .canComment) ?? false
        canManage = try c.decodeIfPresent(Bool.self, forKey: .canManage) ?? false
    }

    static let empty = CommentsData(threads: [], blocks: [], canComment: false, canManage: false)

    var openThreads: [Thread] { threads.filter { !$0.isResolved } }
    var resolvedThreads: [Thread] { threads.filter(\.isResolved) }
    /// An open thread you haven't read (the dot on the dock's Comments button).
    var hasUnreadOpen: Bool { threads.contains { $0.unread && !$0.isResolved } }

    func summary(for blockId: String) -> BlockSummary? { blocks.first { $0.blockId == blockId } }
    func thread(_ id: String) -> Thread? { threads.first { $0.id == id } }

    /// The threads on one block, oldest first: the open ones, or all of them while a resolved one is shown
    /// (for the "1 of 2" switcher).
    func siblings(onBlock blockId: String, showing thread: Thread?) -> [Thread] {
        let onBlock = threads.filter { $0.blockId == blockId }
        let list = thread?.isResolved == true ? onBlock : onBlock.filter { !$0.isResolved }
        return list.sorted { $0.createdAt < $1.createdAt }
    }

    /// The thread a block's card shows: the chosen one, else the block's latest open thread (nil: a new one).
    func threadToShow(onBlock blockId: String, chosen: String?) -> Thread? {
        let onBlock = threads.filter { $0.blockId == blockId }
        if let chosen, let t = onBlock.first(where: { $0.id == chosen }) { return t }
        return onBlock.first { !$0.isResolved }
    }
}

// MARK: Optimistic updates (the server's answer replaces these a moment later, as on the web)

extension CommentsData {
    static func pendingComment(body: [InlineNode], me: PersonFace, meId: String, now: Double) -> Comment {
        Comment(id: "pending-\(UUID().uuidString)", authorId: meId, authorName: me.name, authorAvatarUrl: me.avatarUrl, body: body,
                deleted: false, createdAt: now, editedAt: nil, mine: true, canEdit: false, canDelete: false)
    }

    func creatingThread(blockId: String?, body: [InlineNode], me: PersonFace, meId: String, now: Double) -> CommentsData {
        var d = self
        let thread = Thread(id: "pending-\(Int(now))", blockId: blockId, blockExists: blockId == nil ? nil : true, blockText: nil,
                            status: "open", createdAt: now, lastActivityAt: now, resolvedBy: nil, resolvedAt: nil, unread: false,
                            canResolve: true, canDelete: false,
                            comments: [Self.pendingComment(body: body, me: me, meId: meId, now: now)])
        d.threads.insert(thread, at: 0)
        if let blockId { d.blocks = Self.bump(d.blocks, blockId: blockId, at: now, me: me, newThread: true) }
        return d
    }

    func replying(threadId: String, body: [InlineNode], me: PersonFace, meId: String, now: Double) -> CommentsData {
        var d = self
        guard let i = d.threads.firstIndex(where: { $0.id == threadId }) else { return d }
        if let blockId = d.threads[i].blockId, !d.threads[i].isResolved {
            d.blocks = Self.bump(d.blocks, blockId: blockId, at: now, me: me, newThread: false)
        }
        d.threads[i].status = "open"
        d.threads[i].resolvedBy = nil
        d.threads[i].resolvedAt = nil
        d.threads[i].lastActivityAt = now
        d.threads[i].comments.append(Self.pendingComment(body: body, me: me, meId: meId, now: now))
        return d
    }

    func editing(commentId: String, body: [InlineNode], now: Double) -> CommentsData {
        var d = self
        for t in d.threads.indices {
            for c in d.threads[t].comments.indices where d.threads[t].comments[c].id == commentId {
                d.threads[t].comments[c].body = body
                d.threads[t].comments[c].editedAt = now
            }
        }
        return d
    }

    /// Deletes one comment; a thread left with no live comment goes with it (as the server does).
    func removing(commentId: String) -> CommentsData {
        var d = self
        for t in d.threads.indices {
            for c in d.threads[t].comments.indices where d.threads[t].comments[c].id == commentId {
                d.threads[t].comments[c].deleted = true
                d.threads[t].comments[c].body = []
            }
        }
        let gone = d.threads.filter { t in !t.comments.contains { !$0.deleted } }
        for t in gone { d.blocks = d.droppingThread(t) }
        d.threads.removeAll { t in !t.comments.contains { !$0.deleted } }
        return d
    }

    func resolving(threadId: String, resolved: Bool, by name: String, now: Double) -> CommentsData {
        var d = self
        guard let i = d.threads.firstIndex(where: { $0.id == threadId }) else { return d }
        if resolved { d.blocks = d.droppingThread(d.threads[i]) }
        d.threads[i].status = resolved ? "resolved" : "open"
        d.threads[i].resolvedBy = resolved ? name : nil
        d.threads[i].resolvedAt = resolved ? now : nil
        return d
    }

    func deletingThread(_ threadId: String) -> CommentsData {
        var d = self
        guard let t = d.threads.first(where: { $0.id == threadId }) else { return d }
        d.blocks = d.droppingThread(t)
        d.threads.removeAll { $0.id == threadId }
        return d
    }

    func markingThread(_ threadId: String, unread: Bool) -> CommentsData {
        var d = self
        for i in d.threads.indices where d.threads[i].id == threadId { d.threads[i].unread = unread }
        return d
    }

    /// The per-block summaries without one open thread.
    private func droppingThread(_ t: Thread) -> [BlockSummary] {
        guard let blockId = t.blockId, !t.isResolved else { return blocks }
        let live = t.comments.filter { !$0.deleted }.count
        return blocks.compactMap { b in
            guard b.blockId == blockId else { return b }
            if b.threads <= 1 { return nil }
            var b = b
            b.threads -= 1
            b.comments = max(0, b.comments - live)
            return b
        }
    }

    private static func bump(_ blocks: [BlockSummary], blockId: String, at: Double, me: PersonFace, newThread: Bool) -> [BlockSummary] {
        guard blocks.contains(where: { $0.blockId == blockId }) else {
            return blocks + [BlockSummary(blockId: blockId, threads: 1, comments: 1, lastActivityAt: at, unread: false, authors: [me])]
        }
        return blocks.map { b in
            guard b.blockId == blockId else { return b }
            var b = b
            b.threads += newThread ? 1 : 0
            b.comments += 1
            b.lastActivityAt = at
            b.authors = Array(([me] + b.authors.filter { $0.name != me.name }).prefix(3))
            return b
        }
    }
}

// MARK: - Comment text (the web's MentionInput.tsx)

enum CommentText {
    /// The comment as the composer shows it for editing: text, with mentions as "@Name".
    static func editableText(_ body: [InlineNode]) -> String {
        body.map { node -> String in
            switch node {
            case .text(let text, _): return text
            case .mention(_, let label): return "@" + label
            case .pageLink(_, let label): return label
            case .date(let date): return date
            }
        }.joined()
    }

    /// Turns comment text into inline nodes: "@Name" becomes a mention when it matches someone picked from
    /// the suggestions (exact id) or, failing that, anyone who can be mentioned (longest name first).
    static func body(from text: String, picked: [MentionPerson], people: [MentionPerson]) -> [InlineNode] {
        var seen = Set<String>()
        let candidates = (picked + people.sorted { $0.displayName.count > $1.displayName.count }).filter { p in
            seen.insert("\(p.profileId):\(p.displayName.lowercased())").inserted && !p.displayName.isEmpty
        }
        var out: [InlineNode] = []
        var buf = ""
        let chars = Array(text)
        var i = 0
        while i < chars.count {
            if chars[i] == "@", i == 0 || chars[i - 1].isWhitespace {
                let rest = chars[(i + 1)...]
                let hit = candidates.first { m in
                    let name = Array(m.displayName)
                    guard rest.count >= name.count else { return false }
                    let head = String(rest.prefix(name.count))
                    guard head.compare(m.displayName, options: [.caseInsensitive]) == .orderedSame else { return false }
                    let next = rest.dropFirst(name.count).first
                    return !(next.map { $0.isLetter || $0.isNumber } ?? false)
                }
                if let hit {
                    if !buf.isEmpty { out.append(.text(text: buf, marks: nil)) }
                    buf = ""
                    out.append(.mention(userId: hit.profileId, label: hit.displayName))
                    i += 1 + hit.displayName.count
                    continue
                }
            }
            buf.append(chars[i])
            i += 1
        }
        if !buf.isEmpty { out.append(.text(text: buf, marks: nil)) }
        return out
    }

    private static let queryPattern = try? NSRegularExpression(pattern: #"(?:^|\s)@([\p{L}\p{N}][\p{L}\p{N} .'-]{0,30})?$"#)

    /// The "@query" being typed right before the caret, if any. `caret` and `start` (the "@") are UTF-16 offsets.
    static func mentionQuery(in text: String, caret: Int) -> (start: Int, query: String)? {
        let ns = text as NSString
        guard caret >= 0, caret <= ns.length, let re = queryPattern else { return nil }
        let before = ns.substring(to: caret)
        let range = NSRange(location: 0, length: (before as NSString).length)
        guard let m = re.firstMatch(in: before, range: range) else { return nil }
        let q = m.range(at: 1).location == NSNotFound ? "" : (before as NSString).substring(with: m.range(at: 1))
        return (caret - (q as NSString).length - 1, q)
    }

    /// Replaces the "@query" at `start…caret` with "@Name "; returns the new text and caret (UTF-16).
    static func insertMention(_ name: String, into text: String, start: Int, caret: Int) -> (text: String, caret: Int) {
        let ns = text as NSString
        let insert = "@\(name) "
        let next = ns.replacingCharacters(in: NSRange(location: start, length: caret - start), with: insert)
        return (next, start + (insert as NSString).length)
    }

    /// Who matches what's typed after "@" (up to six).
    static func matches(_ query: String, in people: [MentionPerson]) -> [MentionPerson] {
        let needle = query.lowercased()
        return Array(people.filter { needle.isEmpty || $0.displayName.lowercased().contains(needle) }.prefix(6))
    }
}

// MARK: - Notifications (notifications:list)

struct AppNotification: Decodable, Sendable, Hashable, Identifiable {
    /// invite, mention, comment, reply, share, share_change, system (and export, with a file)
    var id: String
    var kind: String
    var title: String
    var body: String?
    var fileId: String?
    var actorName: String?
    var actorAvatarUrl: String?
    var documentId: String?
    var documentTitle: String?
    var threadId: String?
    var blockId: String?
    var commentId: String?
    var count: Int
    var inviteId: String?
    var pageInviteId: String?
    var createdAt: Double
    var read: Bool

    enum CodingKeys: String, CodingKey {
        case id, kind, title, body, fileId, actorName, actorAvatarUrl, documentId, documentTitle, threadId, blockId, commentId,
             count, inviteId, pageInviteId, createdAt, read
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "system"
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        body = try c.decodeIfPresent(String.self, forKey: .body)
        fileId = try c.decodeIfPresent(String.self, forKey: .fileId)
        actorName = try c.decodeIfPresent(String.self, forKey: .actorName)
        actorAvatarUrl = try c.decodeIfPresent(String.self, forKey: .actorAvatarUrl)
        documentId = try c.decodeIfPresent(String.self, forKey: .documentId)
        documentTitle = try c.decodeIfPresent(String.self, forKey: .documentTitle)
        threadId = try c.decodeIfPresent(String.self, forKey: .threadId)
        blockId = try c.decodeIfPresent(String.self, forKey: .blockId)
        commentId = try c.decodeIfPresent(String.self, forKey: .commentId)
        count = Int(try c.decodeIfPresent(Double.self, forKey: .count) ?? 1)
        inviteId = try c.decodeIfPresent(String.self, forKey: .inviteId)
        pageInviteId = try c.decodeIfPresent(String.self, forKey: .pageInviteId)
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
        read = try c.decodeIfPresent(Bool.self, forKey: .read) ?? false
    }

    /// The sentence the web writes: who (bold), what, and the note's name (emphasised): "Ana commented on
    /// *Plan*". Nil when the stored title says it best (no note, no actor, or another kind).
    var sentence: (actor: String, verb: String, documentTitle: String, trail: String)? {
        guard let doc = documentTitle, let who = actorName else { return nil }
        switch kind {
        case "comment": return (who, count > 1 ? "left \(count) comments on" : "commented on", doc, "")
        case "reply": return (who, count > 1 ? "replied \(count) times in" : "replied in", doc, "")
        case "mention": return (who, "mentioned you in", doc, "")
        case "share": return (who, "shared", doc, "with you")
        default: return nil
        }
    }

    /// The one-line text (accessibility, and kinds without a sentence).
    var plainSentence: String {
        guard let s = sentence else { return title }
        return [s.actor, s.verb, s.documentTitle, s.trail].filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// The bell's groups: Today, Yesterday, Earlier (empty ones left out).
enum NotificationGroups {
    static func group(_ items: [AppNotification], now: Date = Date(), calendar: Calendar = .current) -> [(label: String, rows: [AppNotification])] {
        let today = calendar.startOfDay(for: now).timeIntervalSince1970 * 1000
        let day = 86_400_000.0
        let groups: [(String, [AppNotification])] = [
            (String(localized: "Today"), items.filter { $0.createdAt >= today }),
            (String(localized: "Yesterday"), items.filter { $0.createdAt < today && $0.createdAt >= today - day }),
            (String(localized: "Earlier"), items.filter { $0.createdAt < today - day }),
        ]
        return groups.filter { !$0.1.isEmpty }.map { (label: $0.0, rows: $0.1) }
    }
}

/// How comments on one note reach you (notifications:noteSubscription).
struct NoteSubscription: Decodable, Sendable, Hashable {
    /// "default" | "follow" | "mute"
    var mode: String
    var isAuthor: Bool
}

// MARK: - Sharing (sharing:get)

struct ShareInfo: Decodable, Sendable, Hashable {
    struct Person: Decodable, Sendable, Hashable, Identifiable {
        var profileId: String
        var displayName: String
        var email: String?
        /// "editor" | "commenter" | "viewer"
        var role: String
        var guest: Bool
        var isYou: Bool
        var canChange: Bool
        var id: String { profileId }
    }
    struct Invite: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var email: String
        var role: String
        var expiresAt: Double
        var expired: Bool
    }
    struct Link: Decodable, Sendable, Hashable, Identifiable {
        var id: String
        var tokenHint: String
        var expiresAt: Double?
        var expired: Bool
        var hasPassword: Bool
        var allowIndexing: Bool
        var viewCount: Int
        var createdAt: Double

        enum CodingKeys: String, CodingKey { case id, tokenHint, expiresAt, expired, hasPassword, allowIndexing, viewCount, createdAt }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            tokenHint = try c.decodeIfPresent(String.self, forKey: .tokenHint) ?? ""
            expiresAt = try c.decodeIfPresent(Double.self, forKey: .expiresAt)
            expired = try c.decodeIfPresent(Bool.self, forKey: .expired) ?? false
            hasPassword = try c.decodeIfPresent(Bool.self, forKey: .hasPassword) ?? false
            allowIndexing = try c.decodeIfPresent(Bool.self, forKey: .allowIndexing) ?? false
            viewCount = Int(try c.decodeIfPresent(Double.self, forKey: .viewCount) ?? 0)
            createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
        }
    }

    /// "workspace" | "restricted"
    var accessMode: String
    var yourAccess: String
    /// Access mode, public links and anyone's grants.
    var canManage: Bool
    /// Adding people (up to `maxRole`) and changing the grants and invitations you made.
    var canShare: Bool
    var maxRole: String?
    var youAreGuest: Bool
    var ownerName: String?
    var sharedBy: String?
    var people: [Person]
    var pendingInvites: [Invite]
    var links: [Link]
    var publicLinksAvailable: Bool

    enum CodingKeys: String, CodingKey {
        case accessMode, yourAccess, canManage, canShare, maxRole, youAreGuest, ownerName, sharedBy, people, pendingInvites, links, publicLinksAvailable
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accessMode = try c.decodeIfPresent(String.self, forKey: .accessMode) ?? "workspace"
        yourAccess = try c.decodeIfPresent(String.self, forKey: .yourAccess) ?? "read"
        canManage = try c.decodeIfPresent(Bool.self, forKey: .canManage) ?? false
        canShare = try c.decodeIfPresent(Bool.self, forKey: .canShare) ?? false
        maxRole = try c.decodeIfPresent(String.self, forKey: .maxRole)
        youAreGuest = try c.decodeIfPresent(Bool.self, forKey: .youAreGuest) ?? false
        ownerName = try c.decodeIfPresent(String.self, forKey: .ownerName)
        sharedBy = try c.decodeIfPresent(String.self, forKey: .sharedBy)
        people = try c.decodeIfPresent([Person].self, forKey: .people) ?? []
        pendingInvites = try c.decodeIfPresent([Invite].self, forKey: .pendingInvites) ?? []
        links = try c.decodeIfPresent([Link].self, forKey: .links) ?? []
        publicLinksAvailable = try c.decodeIfPresent(Bool.self, forKey: .publicLinksAvailable) ?? false
    }

    /// The roles you may give: managers any; members up to `maxRole` (Can edit at most); guests none.
    var assignableRoles: [ShareRole] {
        guard canShare else { return [] }
        if canManage { return ShareRole.allCases }
        guard let max = maxRole.flatMap(ShareRole.init(rawValue:)) else { return [] }
        return ShareRole.allCases.filter { $0.rank <= max.rank }
    }
}

enum ShareRole: String, CaseIterable, Sendable, Identifiable {
    case viewer, commenter, editor
    var id: String { rawValue }
    var rank: Int { switch self { case .viewer: return 0; case .commenter: return 1; case .editor: return 2 } }
    /// The web's labels: "Can view", "Can comment", "Can edit".
    var label: String {
        switch self {
        case .viewer: return String(localized: "Can view")
        case .commenter: return String(localized: "Can comment")
        case .editor: return String(localized: "Can edit")
        }
    }
    var title: String { label }
    static func label(_ raw: String) -> String { (ShareRole(rawValue: raw) ?? .viewer).label }
}

struct GrantResult: Decodable, Sendable { var status: String }
struct PublicLinkCreated: Decodable, Sendable { var id: String; var token: String }
struct AcceptedPageInvite: Decodable, Sendable { var documentId: String }
struct CommentCreated: Decodable, Sendable { var threadId: String; var commentId: String }
struct CommentRemoved: Decodable, Sendable { var threadDeleted: Bool }

// MARK: - Times (apps/web/src/lib/format.ts `formatRelative`, the comment line's `commentTime`)

enum CollabTime {
    /// "now", "5 minutes ago", "yesterday", "Sep 3" (a year added when it isn't this year), as the web says it.
    static func relative(_ ms: Double, now: Date = Date(), locale: Locale = .current) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        let diff = date.timeIntervalSince(now)
        let abs = Swift.abs(diff)
        let f = RelativeDateTimeFormatter()
        f.locale = locale
        f.dateTimeStyle = .named
        f.unitsStyle = .full
        if abs < 45 { return f.localizedString(from: DateComponents(second: 0)) }
        if abs < 45 * 60 { return f.localizedString(from: DateComponents(minute: Int((diff / 60).rounded()))) }
        if abs < 22 * 3600 { return f.localizedString(from: DateComponents(hour: Int((diff / 3600).rounded()))) }
        if abs < 6 * 86_400 { return f.localizedString(from: DateComponents(day: Int((diff / 86_400).rounded()))) }
        let sameYear = Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: now)
        let style = sameYear ? Date.FormatStyle().month(.abbreviated).day() : Date.FormatStyle().month(.abbreviated).day().year()
        return date.formatted(style.locale(locale))
    }

    /// The time on a block's comment line: "8:18 AM" today, else "Sep 3".
    static func commentLine(_ ms: Double, now: Date = Date(), locale: Locale = .current) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        if Calendar.current.isDate(date, inSameDayAs: now) {
            return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(locale))
        }
        return date.formatted(Date.FormatStyle().month(.abbreviated).day().locale(locale))
    }

    /// "2 comments · 8:18 AM"
    static func commentLineLabel(count: Int, lastActivityAt: Double, now: Date = Date(), locale: Locale = .current) -> String {
        "\(count) \(count == 1 ? "comment" : "comments") · \(commentLine(lastActivityAt, now: now, locale: locale))"
    }
}
