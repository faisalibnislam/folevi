import Foundation

// The document page's pure rules (the web's DocumentView.tsx menu, DocumentSidebar.tsx find, export.ts,
// MovePageDialog.tsx and commands.ts), kept here so they can be tested on their own.

/// The page's "…" menu: which actions show, in the web's order.
public enum PageMenu {
    /// What decides which actions show and which are off.
    public struct Context: Equatable {
        public var inTrash: Bool
        public var starred: Bool
        public var archived: Bool
        public var isTemplate: Bool
        public var canManage: Bool
        public var readOnly: Bool
        public var canMoveToFolder: Bool

        public init(inTrash: Bool, starred: Bool, archived: Bool, isTemplate: Bool, canManage: Bool, readOnly: Bool, canMoveToFolder: Bool) {
            self.inTrash = inTrash
            self.starred = starred
            self.archived = archived
            self.isTemplate = isTemplate
            self.canManage = canManage
            self.readOnly = readOnly
            self.canMoveToFolder = canMoveToFolder
        }
    }

    /// Labels in order ("-" for a separator).
    public static func labels(_ c: Context) -> [String] {
        if c.inTrash { return ["Restore from Trash", "Delete permanently…"] }
        var out = [c.starred ? "Unstar" : "Star", "Share…", "Version history…", c.canManage ? "Find and replace…" : "Find in note…"]
        if c.canMoveToFolder { out.append("Move to folder…") }
        out += ["Move to page…", "-", "Export as Markdown", "Export as HTML", "Export as PDF (print)", "-", "Duplicate"]
        if !c.isTemplate { out.append("Save as template") }
        out += [c.archived ? "Unarchive" : "Archive", "Move to Trash"]
        return out
    }
}

/// A short excerpt around a match that starts and ends on word boundaries (the web's snippetAround).
public enum FindSnippet {
    public static func around(_ text: String, at: Int, length: Int) -> (before: String, hit: String, after: String) {
        let ns = text as NSString
        let start = max(0, at - 32)
        var before = ns.substring(with: NSRange(location: start, length: at - start))
        if at > 32 {
            if let space = before.firstIndex(of: " ") { before = "…" + before[before.index(after: space)...] } else { before = "…" + before }
        }
        let afterStart = at + length
        let afterLength = max(0, min(48, ns.length - afterStart))
        var after = ns.substring(with: NSRange(location: afterStart, length: afterLength))
        if afterStart + 48 < ns.length {
            let cut = after.lastIndex(of: " ").map { String(after[..<$0]) } ?? ""
            after = cut + "…"
        }
        return (before, ns.substring(with: NSRange(location: at, length: length)), after)
    }
}

/// Nested-page cards kept in step with a move (syncPageCards on the web).
public enum PageCards {
    public static func isCard(_ b: WireBlock, for documentId: String) -> Bool {
        b.type == "page" && b.props["documentId"]?.stringValue == documentId
    }

    /// The card to add at the end of `blocks` (nil when the parent already has one).
    public static func card(for documentId: String, title: String, in blocks: [WireBlock]) -> WireBlock? {
        guard !blocks.contains(where: { isCard($0, for: documentId) }) else { return nil }
        let last = blocks.filter { $0.parentId == nil }.map(\.rank).max()
        return WireBlock(id: ULID.make(), type: "page", parentId: nil, rank: Rank.betweenOrAfter(last, nil),
                         props: ["documentId": .string(documentId), "display": "card", "titleCache": .string(title.isEmpty ? "Untitled" : title)])
    }
}

extension BlockLook {
    /// The block types that carry a look (FORMATTABLE in commands.ts).
    public static let formattable: Set<String> = ["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote"]

    /// `content` with this look written into its props (text style only on paragraphs). Other blocks are
    /// returned as they are.
    public func applied(to content: BlockContent) -> BlockContent {
        switch content {
        case .paragraph(var p):
            p.textStyle = textStyle; p.decoration = decoration; p.color = color; p.align = align; p.font = font; p.group = group
            return .paragraph(p)
        case .heading(var p):
            p.decoration = decoration; p.color = color; p.align = align; p.font = font; p.group = group
            return .heading(p)
        case .bulleted(var p):
            p.decoration = decoration; p.color = color; p.align = align; p.font = font; p.group = group
            return .bulleted(p)
        case .numbered(var p):
            p.decoration = decoration; p.color = color; p.align = align; p.font = font; p.group = group
            return .numbered(p)
        case .todo(var p):
            p.decoration = decoration; p.color = color; p.align = align; p.font = font; p.group = group
            return .todo(p)
        case .toggle(var p):
            p.decoration = decoration; p.color = color; p.align = align; p.font = font; p.group = group
            return .toggle(p)
        case .quote(var p):
            p.decoration = decoration; p.color = color; p.align = align; p.font = font; p.group = group
            return .quote(p)
        default:
            return content
        }
    }
}

/// Dates as the web shows them (lib/format.ts).
public enum PageFormat {
    /// "now", "5 minutes ago", "in 2 hours", "yesterday"…, or a short date after six days.
    public static func relative(_ ms: Double, now: Date = Date()) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        let diff = date.timeIntervalSince(now)
        let abs = Swift.abs(diff)
        let f = RelativeDateTimeFormatter()
        f.dateTimeStyle = .named
        f.unitsStyle = .full
        if abs < 45 { return f.localizedString(from: DateComponents(second: 0)) }
        if abs < 45 * 60 { return f.localizedString(from: DateComponents(minute: Int((diff / 60).rounded()))) }
        if abs < 22 * 3600 { return f.localizedString(from: DateComponents(hour: Int((diff / 3600).rounded()))) }
        if abs < 6 * 86400 { return f.localizedString(from: DateComponents(day: Int((diff / 86400).rounded()))) }
        let sameYear = Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: now)
        return date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
    }

    /// Medium date, short time.
    public static func dateTime(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .shortened)
    }
}

/// Export naming and messages (doc/export.ts).
public enum PageExportText {
    /// `name` as a file name (safeName).
    public static func fileName(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
        var out = ""
        var lastWasDash = false
        for scalar in name.unicodeScalars {
            if bad.contains(scalar) {
                if !lastWasDash { out.append("-") }
                lastWasDash = true
            } else {
                out.unicodeScalars.append(scalar)
                lastWasDash = false
            }
        }
        let trimmed = String(out.trimmingCharacters(in: .whitespaces).prefix(120))
        return trimmed.isEmpty ? "Untitled" : trimmed
    }

    /// The message once an export is ready (and what it couldn't include).
    public static func message(_ label: String, missing: [String]) -> String {
        if missing.isEmpty { return String(localized: "\(label) export ready") }
        let what = missing.count == 1
            ? String(localized: "“\(missing[0])” couldn’t be included")
            : String(localized: "\(missing.count) attachments couldn’t be included")
        return String(localized: "\(label) export ready, but \(what) (not available or not uploaded yet).")
    }
}

/// A minimal ZIP archive writer (stored entries, no compression), for exports with attachments.
public enum ZipWriter {
    private static let crcTable: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    public static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for byte in data { c = crcTable[Int((c ^ UInt32(byte)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }

    public static func archive(_ entries: [(path: String, data: Data)]) -> Data {
        var out = Data()
        var central = Data()
        for (path, data) in entries {
            let name = Data(path.utf8)
            let crc = crc32(data)
            let offset = UInt32(out.count)
            // Local file header (UTF-8 names: flag bit 11).
            out.append(le32(0x0403_4B50)); out.append(le16(20)); out.append(le16(0x0800)); out.append(le16(0))
            out.append(le16(0)); out.append(le16(0x21))
            out.append(le32(crc)); out.append(le32(UInt32(data.count))); out.append(le32(UInt32(data.count)))
            out.append(le16(UInt16(name.count))); out.append(le16(0))
            out.append(name); out.append(data)
            // Central directory entry.
            central.append(le32(0x0201_4B50)); central.append(le16(20)); central.append(le16(20)); central.append(le16(0x0800)); central.append(le16(0))
            central.append(le16(0)); central.append(le16(0x21))
            central.append(le32(crc)); central.append(le32(UInt32(data.count))); central.append(le32(UInt32(data.count)))
            central.append(le16(UInt16(name.count))); central.append(le16(0)); central.append(le16(0)); central.append(le16(0)); central.append(le16(0))
            central.append(le32(0)); central.append(le32(offset))
            central.append(name)
        }
        let centralOffset = UInt32(out.count)
        out.append(central)
        out.append(le32(0x0605_4B50)); out.append(le16(0)); out.append(le16(0))
        out.append(le16(UInt16(entries.count))); out.append(le16(UInt16(entries.count)))
        out.append(le32(UInt32(central.count))); out.append(le32(centralOffset)); out.append(le16(0))
        return out
    }

    private static func le16(_ v: UInt16) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
    private static func le32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
}
