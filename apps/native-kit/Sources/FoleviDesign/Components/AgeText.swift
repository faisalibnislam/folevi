// Relative times in the web's one wording (apps/web/src/lib/format.ts `formatRelative` / `ageText`):
// "just now", "1 min ago", "5 mins ago", "1 hour ago", "3 days ago", then a short date ("Sep 10", or
// "Sep 10, 2025" in another year). Times ahead read "in 5 mins". Keep the two in step.
import Foundation

public enum AgeText {
    /// Lower case, for inside a sentence ("Edited 5 mins ago").
    public static func relative(_ date: Date, now: Date = Date(), locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let ahead = date > now
        func unit(_ n: Int, _ u: String) -> String {
            let words = "\(n) \(u)\(n == 1 ? "" : "s")"
            return ahead ? "in \(words)" : "\(words) ago"
        }
        let exact = abs(now.timeIntervalSince(date)) / 60
        let mins = ahead ? max(1, Int(exact.rounded())) : Int(exact.rounded())
        if mins < 1 { return "just now" }
        if mins < 60 { return unit(mins, "min") }
        let hours = Int((Double(mins) / 60).rounded())
        if hours < 24 { return unit(hours, "hour") }
        let days = Int((Double(hours) / 24).rounded())
        if days < 7 { return unit(days, "day") }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        var style = Date.FormatStyle(locale: locale, timeZone: timeZone).month(.abbreviated).day()
        if !sameYear { style = style.year() }
        return date.formatted(style)
    }

    /// Sentence case, for a label on its own (cards, folder covers): only the first letter is capitalised.
    public static func age(_ date: Date, now: Date = Date(), locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let s = relative(date, now: now, locale: locale, timeZone: timeZone)
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// From a Convex timestamp (milliseconds since 1970).
    public static func age(ms: Double, now: Date = Date()) -> String { age(Date(timeIntervalSince1970: ms / 1000), now: now) }
}
