// Pure helpers for the week grid and event words (web views/calendarLayout.ts, CalendarSubscriptions.tsx
// `eventWhen`): where things sit on the hour grid, how overlapping items share a day's width, which slot a drop lands
// in, and an event's time in words.
import Foundation
import SwiftUI
import FoleviDesign
import FoleviEngine

public enum CalendarMath {
    /// Height of one hour on the grid, in points.
    public static let hourHeight: CGFloat = 44
    /// Drops snap to this many minutes.
    public static let slotMinutes = 30
    /// A task with a time shows as a block this long.
    public static let taskMinutes = 30
    /// The hour the grid scrolls to when it opens.
    public static let firstVisibleHour = 6

    public struct Span: Hashable, Sendable {
        public var id: String
        public var start: Int
        public var end: Int
        public init(id: String, start: Int, end: Int) {
            self.id = id
            self.start = start
            self.end = end
        }
    }

    public struct Placed: Hashable, Sendable {
        public var id: String
        public var start: Int
        public var end: Int
        /// Column within its overlap group, from 0.
        public var col: Int
        /// Columns in its overlap group.
        public var cols: Int
    }

    /// Side by side for items that overlap (directly or through a chain): each group gets as many columns as it
    /// needs at its busiest, and each item takes the first column free at its start. Touching items don't overlap.
    public static func layoutOverlaps(_ items: [Span]) -> [Placed] {
        let sorted = items.sorted { ($0.start, -$0.end, $0.id) < ($1.start, -$1.end, $1.id) }
        var out: [Placed] = []
        var group: [Placed] = []
        var columnsEnd: [Int] = []
        var groupEnd = -1
        func close() {
            for var p in group {
                p.cols = columnsEnd.count
                out.append(p)
            }
            group = []
            columnsEnd = []
        }
        for item in sorted {
            let end = max(item.end, item.start + 1)
            if !group.isEmpty && item.start >= groupEnd { close() }
            var col = columnsEnd.firstIndex { $0 <= item.start } ?? -1
            if col == -1 {
                col = columnsEnd.count
                columnsEnd.append(end)
            } else {
                columnsEnd[col] = end
            }
            group.append(Placed(id: item.id, start: item.start, end: end, col: col, cols: 1))
            groupEnd = group.count == 1 ? end : max(groupEnd, end)
        }
        if !group.isEmpty { close() }
        return out
    }

    /// The slot a point `y` points below midnight lands in: snapped down to 30 minutes, never past 23:30.
    public static func slot(atY y: CGFloat, hourHeight: CGFloat = hourHeight) -> Int {
        let minutes = Double(y / hourHeight) * 60
        let snapped = Int((minutes / Double(slotMinutes)).rounded(.down)) * slotMinutes
        return min(max(0, snapped), 24 * 60 - slotMinutes)
    }

    public static func y(minutes: Int, hourHeight: CGFloat = hourHeight) -> CGFloat { CGFloat(minutes) / 60 * hourHeight }

    /// "Sat, Oct 24, 09:00 to 10:30", "Sat, Oct 24, all day" or a range of days, in the person's time zone.
    public static func eventWhen(_ e: CalendarEvent, timeZone: TimeZone, locale: Locale = .current) -> String {
        let utc = TimeZone(identifier: "UTC")!
        let fmt: (String) -> String = { TaskDates.format($0, "EEEMMMd", locale: locale) }
        if e.allDay {
            let first = TaskDates.day(ms: e.start, timeZone: utc)
            let last = TaskDates.day(ms: max(e.start, e.end - 86_400_000), timeZone: utc)
            return first == last ? "\(fmt(first)), all day" : "\(fmt(first)) to \(fmt(last))"
        }
        let sDay = TaskDates.day(ms: e.start, timeZone: timeZone), sMin = TaskDates.minuteOfDay(ms: e.start, timeZone: timeZone)
        let tDay = TaskDates.day(ms: e.end, timeZone: timeZone), tMin = TaskDates.minuteOfDay(ms: e.end, timeZone: timeZone)
        let s = TaskDates.timeLabel(TaskDates.time(sMin), locale: locale), t = TaskDates.timeLabel(TaskDates.time(tMin), locale: locale)
        if e.end <= e.start { return "\(fmt(sDay)), \(s)" }
        if sDay == tDay { return "\(fmt(sDay)), \(s) to \(t)" }
        return "\(fmt(sDay)), \(s) to \(fmt(tDay)), \(t)"
    }

    /// An event's time on its day in a list: "09:00 to 10:30" or "All day".
    public static func eventTimeOnDay(_ p: PlacedEvent, locale: Locale = .current) -> String {
        if p.allDay { return "All day" }
        return "\(TaskDates.timeLabel(TaskDates.time(p.startMinute), locale: locale)) to \(TaskDates.timeLabel(TaskDates.time(min(p.endMinute, 24 * 60 - 1)), locale: locale))"
    }

    /// A subscribed calendar's colour key as a colour ("muted" is gray).
    public static func color(_ key: String) -> Color {
        switch key {
        case "moss": Folevi.color.moss
        case "marigold": Folevi.color.marigold
        case "plum": FoleviTokens.Chrome.plum.color
        case "coral": Folevi.color.coral
        case "muted": Folevi.color.inkMuted
        case "ember": Folevi.color.ember
        default: Folevi.color.accent
        }
    }
}
