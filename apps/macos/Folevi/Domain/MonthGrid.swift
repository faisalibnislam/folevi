import Foundation

/// A month as a calendar grid of YYYY-MM-DD days (the date pickers' month view).
public enum MonthGrid {
    /// The (year, month) of a YYYY-MM-DD date.
    public static func month(of date: String) -> (year: Int, month: Int)? {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]) else { return nil }
        return (parts[0], parts[1])
    }

    /// The month `delta` months away.
    public static func adding(_ delta: Int, to ym: (year: Int, month: Int)) -> (year: Int, month: Int) {
        let index = ym.year * 12 + (ym.month - 1) + delta
        return (Int((Double(index) / 12).rounded(.down)), ((index % 12) + 12) % 12 + 1)
    }

    public static func daysIn(year: Int, month: Int) -> Int {
        switch month {
        case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    /// Weekday of the 1st (1 = Sunday … 7 = Saturday, Gregorian).
    public static func weekdayOfFirst(year: Int, month: Int) -> Int {
        // Zeller-style (Sakamoto) for the proleptic Gregorian calendar.
        let t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
        let y = month < 3 ? year - 1 : year
        let dow = (y + y / 4 - y / 100 + y / 400 + t[month - 1] + 1) % 7 // 0 = Sunday
        return dow + 1
    }

    /// The month's days in weeks starting on `firstWeekday` (1 = Sunday); blanks are nil. Whole weeks only.
    public static func cells(year: Int, month: Int, firstWeekday: Int = 1) -> [String?] {
        let lead = (weekdayOfFirst(year: year, month: month) - firstWeekday + 7) % 7
        let count = daysIn(year: year, month: month)
        var out: [String?] = Array(repeating: nil, count: lead)
        for d in 1...count { out.append(String(format: "%04d-%02d-%02d", year, month, d)) }
        while out.count % 7 != 0 { out.append(nil) }
        return out
    }
}
