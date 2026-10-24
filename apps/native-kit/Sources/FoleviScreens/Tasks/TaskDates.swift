// Calendar days as the contract has them (YYYY-MM-DD strings in the person's time zone, `session.today`), and the
// words the web uses for them (lib/format.ts `dueLabel`, iphone/Tasks.tsx `dayLabel`). Weeks start on Monday, as
// the web's month and week grids do (views/calendarLayout.ts). Pure, so tests check the exact words.
import Foundation

public enum TaskDates {
    /// Gregorian in UTC: a YYYY-MM-DD day is a whole UTC day here, so adding days never meets a DST change.
    static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        c.firstWeekday = 2
        return c
    }()

    public static func isDay(_ s: String) -> Bool { date(s) != nil }

    /// The UTC midnight of a YYYY-MM-DD day.
    public static func date(_ day: String) -> Date? {
        let p = day.split(separator: "-")
        guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]), (1...12).contains(m), (1...31).contains(d) else { return nil }
        return utc.date(from: DateComponents(year: y, month: m, day: d))
    }

    public static func day(_ date: Date) -> String {
        let c = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// Today in a time zone (what `session.today` says, for when the session hasn't answered).
    public static func today(in timeZone: TimeZone = .current, now: Date = ScreenClock.now()) -> String {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        let parts = c.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }

    public static func add(_ day: String, days: Int) -> String {
        guard let d = date(day), let n = utc.date(byAdding: .day, value: days, to: d) else { return day }
        return Self.day(n)
    }

    public static func addMonths(_ day: String, _ months: Int) -> String {
        guard let d = date(day), let n = utc.date(byAdding: .month, value: months, to: d) else { return day }
        return Self.day(n)
    }

    /// Whole days from `a` to `b`.
    public static func between(_ a: String, _ b: String) -> Int {
        guard let x = date(a), let y = date(b) else { return 0 }
        return Int(((y.timeIntervalSince(x)) / 86_400).rounded())
    }

    /// Monday = 0.
    public static func weekdayIndex(_ day: String) -> Int {
        guard let d = date(day) else { return 0 }
        return (utc.component(.weekday, from: d) + 5) % 7
    }

    /// The Monday on or before the day.
    public static func startOfWeek(_ day: String) -> String { add(day, days: -weekdayIndex(day)) }

    public static func week(of day: String) -> [String] {
        let first = startOfWeek(day)
        return (0..<7).map { add(first, days: $0) }
    }

    /// The first of the day's month.
    public static func startOfMonth(_ day: String) -> String { String(day.prefix(7)) + "-01" }

    /// The month grid's weeks that hold at least one day of the month (four to six rows of seven).
    public static func monthRows(_ day: String) -> [[String]] {
        let first = startOfMonth(day)
        let month = String(first.prefix(7))
        var start = startOfWeek(first)
        var rows: [[String]] = []
        while rows.count < 6 {
            let row = (0..<7).map { add(start, days: $0) }
            guard row.contains(where: { $0.hasPrefix(month) }) else { break }
            rows.append(row)
            start = add(start, days: 7)
        }
        return rows
    }

    /// "Next week" in the task sheet's quick dates: the coming Monday.
    public static func nextWeek(_ today: String) -> String { add(today, days: 7 - weekdayIndex(today)) }

    static func formatter(_ template: String, locale: Locale) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = utc.timeZone
        f.setLocalizedDateFormatFromTemplate(template)
        return f
    }

    public static func format(_ day: String, _ template: String, locale: Locale = .current) -> String {
        guard let d = date(day) else { return day }
        return formatter(template, locale: locale).string(from: d)
    }

    /// "Today", "Tomorrow", "Yesterday", the weekday within the week, else "Oct 23" (web `dueLabel`).
    public static func dueLabel(_ due: String, today: String, locale: Locale = .current) -> String {
        if due == today { return "Today" }
        let days = between(today, due)
        if days == 1 { return "Tomorrow" }
        if days == -1 { return "Yesterday" }
        if days > 1 && days < 7 { return format(due, "EEEE", locale: locale) }
        return format(due, due.prefix(4) == today.prefix(4) ? "MMMd" : "yMMMd", locale: locale)
    }

    /// A day heading: "Today" and "Saturday, Oct 24"; "Monday" and "Oct 26" (web `dayLabel`).
    public static func dayHeading(_ day: String, today: String, locale: Locale = .current) -> (name: String, date: String) {
        if day == today { return ("Today", format(day, "EEEEMMMd", locale: locale)) }
        if day == add(today, days: 1) { return ("Tomorrow", format(day, "EEEEMMMd", locale: locale)) }
        if day == add(today, days: -1) { return ("Yesterday", format(day, "EEEEMMMd", locale: locale)) }
        return (format(day, "EEEE", locale: locale), format(day, day.prefix(4) == today.prefix(4) ? "MMMd" : "yMMMd", locale: locale))
    }

    /// The task sheet's date value: "Today", "Tomorrow", else "Mon, Oct 26".
    public static func whenLabel(_ day: String, today: String, locale: Locale = .current) -> String {
        let label = dueLabel(day, today: today, locale: locale)
        if label == "Today" || label == "Tomorrow" || label == "Yesterday" { return label }
        return format(day, day.prefix(4) == today.prefix(4) ? "EEEMMMd" : "yMMMd", locale: locale)
    }

    /// "October", or "October 2027" outside this year (the Calendar's title).
    public static func monthTitle(_ day: String, today: String, locale: Locale = .current) -> String {
        format(day, day.prefix(4) == today.prefix(4) ? "MMMM" : "MMMMy", locale: locale)
    }

    /// "HH:MM" as minutes after midnight.
    public static func minutes(_ time: String?) -> Int? {
        guard let time else { return nil }
        let p = time.split(separator: ":")
        guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]), (0..<24).contains(h), (0..<60).contains(m) else { return nil }
        return h * 60 + m
    }

    public static func time(_ minutes: Int) -> String {
        let m = min(max(0, minutes), 24 * 60 - 1)
        return String(format: "%02d:%02d", m / 60, m % 60)
    }

    /// "15:00" as the locale shows times ("3:00 PM").
    public static func timeLabel(_ time: String, locale: Locale = .current) -> String {
        guard let m = minutes(time), let d = utc.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: m / 60, minute: m % 60)) else { return time }
        return formatter("jmm", locale: locale).string(from: d)
    }

    /// A YYYY-MM-DD day and optional HH:MM as a `Date` in a time zone (for the system date pickers).
    public static func pickerDate(day: String, time: String?, timeZone: TimeZone) -> Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        let p = day.split(separator: "-").compactMap { Int($0) }
        let m = minutes(time) ?? 9 * 60
        return c.date(from: DateComponents(year: p.first, month: p.count > 1 ? p[1] : 1, day: p.count > 2 ? p[2] : 1, hour: m / 60, minute: m % 60)) ?? Date()
    }

    /// A picker's `Date` back to a day and a time in a time zone.
    public static func fromPicker(_ date: Date, timeZone: TimeZone) -> (day: String, time: String) {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        let p = c.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return (String(format: "%04d-%02d-%02d", p.year ?? 1970, p.month ?? 1, p.day ?? 1), String(format: "%02d:%02d", p.hour ?? 0, p.minute ?? 0))
    }

    /// The day (in a time zone) of a moment in milliseconds.
    public static func day(ms: Int, timeZone: TimeZone) -> String {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        let p = c.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: Double(ms) / 1000))
        return String(format: "%04d-%02d-%02d", p.year ?? 1970, p.month ?? 1, p.day ?? 1)
    }

    /// Minutes after that day's midnight (in a time zone) of a moment in milliseconds.
    public static func minuteOfDay(ms: Int, timeZone: TimeZone) -> Int {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        let p = c.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: Double(ms) / 1000))
        return (p.hour ?? 0) * 60 + (p.minute ?? 0)
    }

    /// Milliseconds of a day's midnight in a time zone.
    public static func ms(day: String, timeZone: TimeZone) -> Int {
        Int(pickerDate(day: day, time: "00:00", timeZone: timeZone).timeIntervalSince1970 * 1000)
    }
}
