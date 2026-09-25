import Foundation

/// Port of packages/editor-schema/src/tasks.ts.
public enum TaskLogic {
    public enum Status: String, Codable, Sendable { case open, done, canceled }
    public enum View: String, Codable, Sendable, CaseIterable, Identifiable {
        case inbox, today, upcoming, all, completed, mine
        public var id: String { rawValue }
    }

    public struct Projection: Sendable, Hashable {
        public var blockId: String
        public var documentId: String
        public var title: String
        public var status: Status
        public var dueDate: String?
        public var dueTime: String?
        public var priority: TaskPriority
        public var assigneeId: String?
        public var reminderAt: Double?
        public var completedAt: Double?
    }

    public static func project(_ block: WireBlock, documentId: String) -> Projection? {
        guard block.type == "todo", let p = try? block.props.decode(TodoProps.self) else { return nil }
        return Projection(blockId: block.id, documentId: documentId, title: String(RichText.plainText(block.inlineText).prefix(500)),
                          status: (p.canceled ?? false) ? .canceled : p.checked ? .done : .open,
                          dueDate: p.dueDate, dueTime: p.dueTime, priority: p.priority ?? .none,
                          assigneeId: p.assigneeId, reminderAt: p.reminderAt, completedAt: p.completedAt)
    }

    /// Local calendar date (YYYY-MM-DD) for a date in a time zone.
    public static func localDate(_ date: Date = Date(), timeZone: TimeZone = .current) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    public static func addDays(_ date: String, _ days: Int) -> String {
        guard let d = parseDate(date) else { return date }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .current
        let out = cal.date(byAdding: .day, value: days, to: d) ?? d
        return localDate(out, timeZone: cal.timeZone)
    }

    /// Parses YYYY-MM-DD as UTC midnight.
    public static func parseDate(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .current
        return cal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// Parses YYYY-MM-DD into a local-time date (for display in calendars).
    public static func parseLocalDate(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    public static func views(status: Status, dueDate: String?, assigneeId: String?, today: String, viewerId: String) -> [View] {
        var views: [View] = [.all]
        if status == .done { return [.completed] }
        if status == .canceled { return [] }
        if dueDate == nil && (assigneeId == nil || assigneeId == viewerId) { views.append(.inbox) }
        if let d = dueDate, d <= today { views.append(.today) }
        if let d = dueDate, d > today { views.append(.upcoming) }
        if assigneeId == viewerId { views.append(.mine) }
        return views
    }

    public static func isOverdue(status: Status, dueDate: String?, today: String) -> Bool {
        status == .open && dueDate != nil && dueDate! < today
    }
}

/// Port of packages/editor-schema/src/search.ts.
public enum SearchText {
    public static func normalize(_ value: String) -> String {
        let decomposed = value.decomposedStringWithCompatibilityMapping
        let stripped = String(String.UnicodeScalarView(decomposed.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }))
        let lowered = stripped.lowercased()
            .replacingOccurrences(of: "\u{2018}", with: "'").replacingOccurrences(of: "\u{2019}", with: "'")
            .replacingOccurrences(of: "\u{201C}", with: "\"").replacingOccurrences(of: "\u{201D}", with: "\"")
        return lowered.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    public static func blockText(_ block: WireBlock) -> String {
        let p = block.props.objectValue ?? [:]
        var parts = [RichText.plainText(block.inlineText)]
        func s(_ key: String) -> String { p[key]?.stringValue ?? "" }
        switch block.type {
        case "code": parts.append(s("code"))
        case "image": parts += [s("alt"), s("caption")]
        case "file": parts.append(s("name"))
        case "table":
            if let rows = try? (p["rows"] ?? .array([])).decode([[[InlineNode]]].self) {
                for row in rows { for cell in row { parts.append(RichText.plainText(cell)) } }
            }
        case "bookmark": parts += [s("title"), s("description"), s("url")]
        case "page": parts.append(s("titleCache"))
        default: break
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// Case/diacritic-insensitive match ranges (in Character offsets) of each query term inside `text`.
    public static func highlightRanges(_ text: String, query: String) -> [Range<Int>] {
        let terms = normalize(query).split(separator: " ").map(String.init).filter { !$0.isEmpty }
        guard !terms.isEmpty else { return [] }
        var normChars: [Character] = []
        var origIndex: [Int] = []
        for (i, ch) in text.enumerated() {
            let n = normalize(String(ch))
            for c in (n.isEmpty ? String(ch).lowercased() : n) {
                normChars.append(c)
                origIndex.append(i)
            }
        }
        var ranges: [Range<Int>] = []
        for term in terms {
            let t = Array(term)
            var from = 0
            while from + t.count <= normChars.count {
                var found = -1
                var j = from
                while j + t.count <= normChars.count {
                    if Array(normChars[j..<(j + t.count)]) == t { found = j; break }
                    j += 1
                }
                if found < 0 { break }
                ranges.append(origIndex[found]..<(origIndex[found + t.count - 1] + 1))
                from = found + t.count
            }
        }
        ranges.sort { $0.lowerBound < $1.lowerBound }
        var merged: [Range<Int>] = []
        for r in ranges {
            if let last = merged.last, r.lowerBound <= last.upperBound {
                merged[merged.count - 1] = last.lowerBound..<max(last.upperBound, r.upperBound)
            } else {
                merged.append(r)
            }
        }
        return merged
    }
}
