import Foundation

// The pure parts of the browse views (Home, note lists, folders and tags pages, Tasks, Calendar), ported from
// apps/web/src/lib/format.ts, components/views/DocumentCard.tsx, OrganizeIndex.tsx, TasksView.tsx,
// CalendarView.tsx and convex/tasks.ts. No UI here, so the unit tests cover it.

/// One line of the derived documents.preview (the page's first blocks), as the card draws it.
public struct PreviewLine: Codable, Sendable, Hashable {
    /// Block type ("paragraph", "bulleted", "numbered", "todo", "table", ...).
    public var t: String
    /// Plain text.
    public var x: String
    public var l: Double?
    /// A to-do's checked state.
    public var c: Bool?
    public var d: Double?
    /// A table's cells.
    public var rows: [[String]]?

    public init(t: String, x: String, l: Double? = nil, c: Bool? = nil, d: Double? = nil, rows: [[String]]? = nil) {
        self.t = t
        self.x = x
        self.l = l
        self.c = c
        self.d = d
        self.rows = rows
    }
}

public enum BrowseFormat {
    /// A short, plain age (the web's `ageText`): "Just now", "23 mins ago", "1 hour ago", "12 days ago",
    /// "3 months ago", "2 years ago". With `title` each word is capitalised ("12 Days Ago").
    public static func ageText(_ ms: Double, title: Bool = false, now: Date = Date()) -> String {
        let mins = max(0, Int(((now.timeIntervalSince1970 * 1000 - ms) / 60_000).rounded()))
        func unit(_ n: Int, _ u: String) -> String { "\(n) \(u)\(n == 1 ? "" : "s") ago" }
        let out: String
        if mins < 1 { out = "just now" }
        else if mins < 60 { out = unit(mins, "min") }
        else if mins < 60 * 24 { out = unit(Int((Double(mins) / 60).rounded()), "hour") }
        else if mins < 60 * 24 * 30 { out = unit(Int((Double(mins) / 1440).rounded()), "day") }
        else if mins < 60 * 24 * 365 { out = unit(max(1, Int((Double(mins) / 43_200).rounded())), "month") }
        else { out = unit(max(1, Int((Double(mins) / 525_600).rounded())), "year") }
        if title {
            return out.split(separator: " ", omittingEmptySubsequences: false).map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
        }
        return out.prefix(1).uppercased() + out.dropFirst()
    }

    /// "23 mins ago" / "1 hour ago" / "Sep 10": the short age on folder covers.
    public static func shortAge(_ ms: Double, now: Date = Date(), locale: Locale = .current) -> String {
        let mins = max(0, Int(((now.timeIntervalSince1970 * 1000 - ms) / 60_000).rounded()))
        if mins < 1 { return "just now" }
        if mins < 60 { return "\(mins) min\(mins == 1 ? "" : "s") ago" }
        let hours = Int((Double(mins) / 60).rounded())
        if hours < 24 { return "\(hours) hour\(hours == 1 ? "" : "s") ago" }
        let days = Int((Double(hours) / 24).rounded())
        if days < 7 { return "\(days) day\(days == 1 ? "" : "s") ago" }
        return Date(timeIntervalSince1970: ms / 1000).formatted(Date.FormatStyle().month(.abbreviated).day().locale(locale))
    }

    /// A due date relative to today: "Today", "Tomorrow", "Yesterday", a weekday this week, else "Oct 3".
    public static func dueLabel(_ dueDate: String, today: String, locale: Locale = .current) -> String {
        if dueDate == today { return "Today" }
        guard let t = TaskLogic.parseDate(today), let d = TaskLogic.parseDate(dueDate) else { return dueDate }
        let days = Int((d.timeIntervalSince(t) / 86_400).rounded())
        if days == 1 { return "Tomorrow" }
        if days == -1 { return "Yesterday" }
        if days > 1 && days < 7 { return calendarDate(dueDate, .weekdayLong, locale: locale) }
        return calendarDate(dueDate, .monthDay, locale: locale)
    }

    public enum DateStyle {
        /// "Friday"
        case weekdayLong
        /// "Oct 3"
        case monthDay
        /// "Friday, October 3"
        case weekdayMonthDay
        /// "October 2026"
        case monthYear
        /// "Fri"
        case weekdayShort
    }

    /// A YYYY-MM-DD day formatted in UTC (the web's `formatCalendarDate`), so it never shifts a day.
    public static func calendarDate(_ iso: String, _ style: DateStyle, locale: Locale = .current) -> String {
        guard let date = TaskLogic.parseDate(iso) else { return iso }
        var f = Date.FormatStyle(locale: locale, timeZone: TimeZone(identifier: "UTC") ?? .gmt)
        switch style {
        case .weekdayLong: f = f.weekday(.wide)
        case .monthDay: f = f.month(.abbreviated).day()
        case .weekdayMonthDay: f = f.weekday(.wide).month(.wide).day()
        case .monthYear: f = f.month(.wide).year()
        case .weekdayShort: f = f.weekday(.abbreviated)
        }
        return date.formatted(f)
    }

    /// The page's first blocks as plain text (the card body): paragraphs apart, list items on their own lines.
    public static func previewText(_ lines: [PreviewLine]?, excerpt: String) -> String {
        guard let lines, !lines.isEmpty else { return excerpt }
        let list: Set<String> = ["bulleted", "numbered", "todo"]
        var out = ""
        var n = 0
        var prev: String?
        for l in lines {
            var x: String
            n = l.t == "numbered" ? n + 1 : 0
            switch l.t {
            case "table": x = (l.rows ?? []).map { $0.filter { !$0.isEmpty }.joined(separator: "  ") }.filter { !$0.isEmpty }.joined(separator: "\n")
            case "bulleted": x = "• \(l.x)"
            case "numbered": x = "\(n). \(l.x)"
            case "todo": x = "\(l.c == true ? "☑" : "☐") \(l.x)"
            default: x = l.x
            }
            x = x.trimmingCharacters(in: .whitespacesAndNewlines)
            if x.isEmpty { continue }
            if !out.isEmpty { out += (prev.map { list.contains($0) } ?? false) && list.contains(l.t) ? "\n" : "\n\n" }
            out += x
            prev = l.t
        }
        return out.isEmpty ? excerpt : out
    }

    /// "1 page" / "1,204 pages".
    public static func pages(_ n: Int) -> String { n == 1 ? "1 page" : "\(n.formatted()) pages" }

    /// The note list's status line: "12 notes", "48+ notes · saved on this device · drag to arrange".
    public static func listStatus(count: Int, more: Bool = false, templates: Bool, savedOnDevice: Bool = false, arranging: Bool = false) -> String {
        let noun = templates ? (count == 1 ? "template" : "templates") : (count == 1 ? "note" : "notes")
        var s = "\(count)\(more ? "+" : "") \(noun)"
        if savedOnDevice { s += " · saved on this device" }
        if arranging { s += " · drag to arrange" }
        return s
    }

    /// Normalises a typed time to HH:MM (24-hour): "9:30", "09:30", "9:30 pm", "21:05". Nil when it isn't one.
    public static func parseTime(_ value: String) -> String? {
        var s = value.trimmingCharacters(in: .whitespaces).lowercased()
        guard !s.isEmpty else { return nil }
        var pm: Bool?
        for (suffix, isPM) in [("pm", true), ("p.m.", true), ("p", true), ("am", false), ("a.m.", false), ("a", false)] where s.hasSuffix(suffix) {
            pm = isPM
            s = String(s.dropLast(suffix.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        let parts = s.split(separator: ":", omittingEmptySubsequences: false)
        let h: Int?, m: Int?
        if parts.count == 2 {
            h = Int(parts[0])
            m = parts[1].count == 2 ? Int(parts[1]) : nil
        } else if parts.count == 1, (1...2).contains(s.count) {
            h = Int(s)
            m = 0
        } else {
            return nil
        }
        guard var hour = h, let minute = m, (0...59).contains(minute) else { return nil }
        if let pm {
            guard (1...12).contains(hour) else { return nil }
            hour = pm ? (hour % 12) + 12 : hour % 12
        }
        guard (0...23).contains(hour) else { return nil }
        return String(format: "%02d:%02d", hour, minute)
    }
}

// MARK: - Sorting and arranging

public enum BrowseSort: String, CaseIterable, Sendable {
    case updated, created, title, manual
}

public enum BrowseOrder {
    /// The server's sort for a note list (convex/documents.ts `sorter`).
    public static func sorted(_ docs: [DocumentSummary], by sort: BrowseSort) -> [DocumentSummary] {
        switch sort {
        case .updated: return docs.sorted { $0.updatedAt > $1.updatedAt }
        case .created: return docs.sorted { $0.createdAt > $1.createdAt }
        case .title: return docs.sorted { $0.title.compare($1.title, options: [.caseInsensitive, .diacriticInsensitive], locale: .current) == .orderedAscending }
        case .manual: return docs.sorted { $0.rank < $1.rank }
        }
    }

    /// Moving `dragged` onto `target`'s slot (the web's `place`): after it when moving down, before it when
    /// moving up. The neighbours documents:reorder takes; nil when nothing would move.
    public static func placement(dragged: String, target: String, in ids: [String]) -> (after: String?, before: String?)? {
        guard dragged != target, let to = ids.firstIndex(of: target) else { return nil }
        let from = ids.firstIndex(of: dragged)
        let down = from.map { $0 < to } ?? false
        if down { return (target, to + 1 < ids.count ? ids[to + 1] : nil) }
        return (to > 0 ? ids[to - 1] : nil, target)
    }

    /// The neighbour one step up or down (Move up / Move down), as the target of `placement`.
    public static func nudgeTarget(_ id: String, _ delta: Int, in ids: [String]) -> String? {
        guard let i = ids.firstIndex(of: id), ids.indices.contains(i + delta) else { return nil }
        return ids[i + delta]
    }
}

// MARK: - Folders and tags pages (organization:index)

public struct OrganizationIndex: Codable, Sendable, Hashable {
    public struct Folder: Codable, Sendable, Hashable, Identifiable {
        public struct Preview: Codable, Sendable, Hashable {
            public var cover: DocumentCover
            public var title: String?
            public var excerpt: String?
        }
        public var id: String
        public var name: String
        public var color: String?
        public var parentFolderId: String?
        public var rank: String?
        public var createdAt: Double
        public var updatedAt: Double
        public var documentCount: Int
        public var previews: [Preview]?

        enum CodingKeys: String, CodingKey { case id, name, color, parentFolderId, rank, createdAt, updatedAt, documentCount, previews }

        public init(id: String, name: String, color: String? = nil, parentFolderId: String? = nil, createdAt: Double = 0, updatedAt: Double = 0, documentCount: Int = 0) {
            self.id = id
            self.name = name
            self.color = color
            self.parentFolderId = parentFolderId
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.documentCount = documentCount
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
            color = try c.decodeIfPresent(String.self, forKey: .color)
            parentFolderId = try c.decodeIfPresent(String.self, forKey: .parentFolderId)
            rank = try c.decodeIfPresent(String.self, forKey: .rank)
            createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
            updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
            documentCount = try c.decodeFlexibleIntIfPresent(forKey: .documentCount) ?? 0
            previews = try? c.decodeIfPresent([Preview].self, forKey: .previews)
        }
    }

    public struct Tag: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var color: String
        public var createdAt: Double
        public var documentCount: Int

        enum CodingKeys: String, CodingKey { case id, name, color, createdAt, documentCount }

        public init(id: String, name: String, color: String = "muted", createdAt: Double = 0, documentCount: Int = 0) {
            self.id = id
            self.name = name
            self.color = color
            self.createdAt = createdAt
            self.documentCount = documentCount
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
            color = try c.decodeIfPresent(String.self, forKey: .color) ?? "muted"
            createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0
            documentCount = try c.decodeFlexibleIntIfPresent(forKey: .documentCount) ?? 0
        }
    }

    public var folders: [Folder]
    public var tags: [Tag]

    public init(folders: [Folder], tags: [Tag]) {
        self.folders = folders
        self.tags = tags
    }

    public enum FolderSort: String, CaseIterable, Sendable { case name, updated, count, created }
    public enum TagSort: String, CaseIterable, Sendable { case name, count, created }

    private static func byName(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive], locale: .current) == .orderedAscending
    }

    /// The Folders page: filtered by name (case-insensitive) and sorted (the web's FoldersIndex).
    public static func folders(_ all: [Folder], query: String, sort: FolderSort) -> [Folder] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let rows = all.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
        return rows.sorted { a, b in
            switch sort {
            case .updated: return a.updatedAt > b.updatedAt
            case .count: return a.documentCount != b.documentCount ? a.documentCount > b.documentCount : byName(a.name, b.name)
            case .created: return a.createdAt > b.createdAt
            case .name: return byName(a.name, b.name)
            }
        }
    }

    /// The Tags page: a leading "#" in the search is ignored.
    public static func tags(_ all: [Tag], query: String, sort: TagSort) -> [Tag] {
        var needle = query.trimmingCharacters(in: .whitespaces)
        if needle.hasPrefix("#") { needle.removeFirst() }
        needle = needle.lowercased()
        let rows = all.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
        return rows.sorted { a, b in
            switch sort {
            case .count: return a.documentCount != b.documentCount ? a.documentCount > b.documentCount : byName(a.name, b.name)
            case .created: return a.createdAt > b.createdAt
            case .name: return byName(a.name, b.name)
            }
        }
    }

    /// "3 folders", or "2 of 9 folders" while searching.
    public static func countText(shown: Int, total: Int, searching: Bool, noun: String) -> String {
        searching ? "\(shown) of \(total) \(noun)s" : "\(total) \(total == 1 ? noun : noun + "s")"
    }
}

// MARK: - Tasks

/// A task edit, with the server's rules (convex/tasks.ts `update`), so an offline edit lands exactly as an
/// online one would. Double optionals: `.some(nil)` clears the field, nil leaves it.
public struct TaskEdit: Equatable, Sendable {
    public var checked: Bool?
    public var canceled: Bool?
    public var dueDate: String??
    public var dueTime: String??
    public var priority: TaskPriority?
    public var assigneeId: String??

    public init(checked: Bool? = nil, canceled: Bool? = nil, dueDate: String?? = nil, dueTime: String?? = nil, priority: TaskPriority? = nil, assigneeId: String?? = nil) {
        self.checked = checked
        self.canceled = canceled
        self.dueDate = dueDate
        self.dueTime = dueTime
        self.priority = priority
        self.assigneeId = assigneeId
    }

    public var isEmpty: Bool { self == TaskEdit() }

    /// `now` in milliseconds.
    public func apply(to p: inout TodoProps, now: Double) {
        if let checked {
            p.checked = checked
            if checked {
                p.completedAt = now
                p.canceled = nil
            } else {
                p.completedAt = nil
            }
        }
        if let canceled {
            if canceled {
                p.canceled = true
                p.checked = false
                p.completedAt = now
            } else {
                p.canceled = nil
                if !p.checked { p.completedAt = nil }
            }
        }
        if let dueDate {
            if let d = dueDate { p.dueDate = d } else {
                p.dueDate = nil
                p.dueTime = nil
            }
        }
        if let dueTime { p.dueTime = dueTime }
        if let priority { p.priority = priority == .none ? nil : priority }
        if let assigneeId { p.assigneeId = assigneeId }
    }

    /// The fields tasks:update takes for this edit.
    public var serverFields: [String: JSONValue] {
        var out: [String: JSONValue] = [:]
        if let checked { out["checked"] = .bool(checked) }
        if let canceled { out["canceled"] = .bool(canceled) }
        if let dueDate { out["dueDate"] = dueDate.map { .string($0) } ?? .null }
        if let dueTime { out["dueTime"] = dueTime.map { .string($0) } ?? .null }
        if let priority { out["priority"] = .string(priority.rawValue) }
        if let assigneeId { out["assigneeId"] = assigneeId.map { .string($0) } ?? .null }
        return out
    }

    /// What the Edit task form changed (the web's TaskEditForm submit): only fields that differ are sent.
    public static func fromForm(status old: TaskLogic.Status, dueDate oldDue: String?, dueTime oldTime: String?, priority oldPriority: TaskPriority, assigneeId oldAssignee: String?,
                                status: TaskLogic.Status, dueDate: String, dueTime: String, priority: TaskPriority, assigneeId: String) -> TaskEdit {
        var e = TaskEdit()
        if status != old {
            if status == .canceled { e.canceled = true }
            else if status == .done { e.checked = true }
            else if old == .canceled { e.canceled = false }
            else { e.checked = false }
        }
        let due: String? = dueDate.isEmpty ? nil : dueDate
        if due != oldDue { e.dueDate = .some(due) }
        let time: String? = due != nil && !dueTime.isEmpty ? dueTime : nil
        if time != oldTime { e.dueTime = .some(time) }
        if priority != oldPriority { e.priority = priority }
        let who: String? = assigneeId.isEmpty ? nil : assigneeId
        if who != oldAssignee { e.assigneeId = .some(who) }
        return e
    }
}

public enum TaskBrowse {
    /// A task's status from its block (canceled wins over checked).
    public static func status(_ p: TodoProps) -> TaskLogic.Status {
        p.canceled == true ? .canceled : p.checked ? .done : .open
    }

    /// The views a task shows in (packages/editor-schema `taskViews`): in your own Personal, unassigned tasks
    /// are yours too ("My Tasks").
    public static func views(status: TaskLogic.Status, dueDate: String?, assigneeId: String?, today: String, viewerId: String, personal: Bool) -> [TaskLogic.View] {
        if status == .done || status == .canceled { return [.completed] }
        var views: [TaskLogic.View] = [.all]
        if dueDate == nil && (assigneeId == nil || assigneeId == viewerId) { views.append(.inbox) }
        if let d = dueDate, d <= today { views.append(.today) }
        if let d = dueDate, d > today { views.append(.upcoming) }
        if assigneeId == viewerId || (personal && assigneeId == nil) { views.append(.mine) }
        return views
    }

    /// Open tasks in order (the server's list order): by due date (undated last), then time, then most recent.
    public static func openOrder(_ a: (dueDate: String?, dueTime: String?, updatedAt: Double), _ b: (dueDate: String?, dueTime: String?, updatedAt: Double)) -> Bool {
        let da = a.dueDate ?? "9999", db = b.dueDate ?? "9999"
        if da != db { return da < db }
        let ta = a.dueTime ?? "99", tb = b.dueTime ?? "99"
        if ta != tb { return ta < tb }
        return a.updatedAt > b.updatedAt
    }

    /// Upcoming's groups: one per due date, in order, labelled "Friday, October 3" (or "No date").
    public static func groupByDate<T>(_ items: [T], dueDate: (T) -> String?, locale: Locale = .current) -> [(key: String, label: String, items: [T])] {
        var order: [String] = []
        var groups: [String: [T]] = [:]
        for item in items {
            let key = dueDate(item) ?? "none"
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(item)
        }
        return order.map { key in
            (key, key == "none" ? "No date" : BrowseFormat.calendarDate(key, .weekdayMonthDay, locale: locale), groups[key] ?? [])
        }
    }

    /// "Nothing due today. Enjoy the quiet." and the other empty messages of each view.
    public static func emptyMessage(_ view: TaskLogic.View, personal: Bool) -> String {
        switch view {
        case .inbox: return "No undated tasks. Tasks without a due date land here."
        case .today: return "Nothing due today. Enjoy the quiet."
        case .upcoming: return "Nothing scheduled ahead."
        case .all: return "No open tasks."
        case .completed: return "Completed and canceled tasks appear here."
        case .mine: return personal ? "No open tasks. In Personal every unassigned task is yours." : "Nothing is assigned to you."
        }
    }

    public static func label(_ view: TaskLogic.View) -> String {
        switch view {
        case .inbox: return "Inbox"
        case .today: return "Today"
        case .upcoming: return "Upcoming"
        case .all: return "All"
        case .completed: return "Completed"
        case .mine: return "My Tasks"
        }
    }
}

// MARK: - Calendar

public enum CalendarMonth {
    /// "2026-10" → the 42 days (six weeks, Monday first) the month grid shows.
    public static func days(month: String) -> [String] {
        let first = "\(month)-01"
        guard let ym = MonthGrid.month(of: first) else { return [] }
        let mondayIndex = (MonthGrid.weekdayOfFirst(year: ym.year, month: ym.month) + 5) % 7
        let start = TaskLogic.addDays(first, -mondayIndex)
        return (0..<42).map { TaskLogic.addDays(start, $0) }
    }

    /// The month `delta` months away ("2026-10", -1 → "2026-09").
    public static func shift(_ month: String, _ delta: Int) -> String {
        guard let ym = MonthGrid.month(of: "\(month)-01") else { return month }
        let m = MonthGrid.adding(delta, to: ym)
        return String(format: "%04d-%02d", m.year, m.month)
    }

    /// The day `delta` cells away in the grid, and whether it leaves the month shown.
    public static func move(_ date: String, by delta: Int, shownMonth: String) -> (date: String, month: String) {
        let next = TaskLogic.addDays(date, delta)
        return (next, String(next.prefix(7)))
    }

    /// "Moved to Oct 3": the reschedule toast.
    public static func movedMessage(_ date: String, locale: Locale = .current) -> String {
        "Moved to \(BrowseFormat.calendarDate(date, .monthDay, locale: locale))"
    }

    /// The selected day's accessibility label: "Friday, October 3, 2 tasks".
    public static func dayLabel(_ date: String, count: Int, locale: Locale = .current) -> String {
        let tasks = count == 0 ? "no tasks" : count == 1 ? "1 task" : "\(count) tasks"
        return "\(BrowseFormat.calendarDate(date, .weekdayMonthDay, locale: locale)), \(tasks)"
    }

    /// "3 more undated tasks in Tasks".
    public static func moreUnscheduled(_ count: Int) -> String {
        count == 1 ? "1 more undated task in Tasks" : "\(count) more undated tasks in Tasks"
    }
}

// MARK: - Selection rectangle

public enum Marquee {
    /// The rectangle between where a drag started and where it is now.
    public static func rect(from a: CGPoint, to b: CGPoint) -> CGRect {
        CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))
    }

    /// The cards a selection rectangle touches (edges count, as on the web), plus `base` (an additive drag).
    public static func hits(_ rect: CGRect, frames: [String: CGRect], base: Set<String> = []) -> Set<String> {
        var out = base
        for (id, r) in frames where r.maxX >= rect.minX && r.minX <= rect.maxX && r.maxY >= rect.minY && r.minY <= rect.maxY {
            out.insert(id)
        }
        return out
    }
}
