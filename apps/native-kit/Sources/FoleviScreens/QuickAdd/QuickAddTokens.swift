// The words Folevi for Mac's Quick Add reads as it's typed (web lib/desktop/quickAddTokens.ts, docs/MAC_POLISH_PLAN.md
// 3.8), besides dates and repeats (`task.parse`): "!high" (or !!!, !med, !!, !low, !) is a priority and "#Project"
// (or #"Two words") a page to add the task to. Each comes out of the task's words; a token the person said to keep
// as text (the chip's ×) stays in them.
import Foundation

public struct QuickAddTokens: Equatable, Sendable {
    public enum Level: String, Sendable { case low, medium, high }

    /// The task's words without the tokens read.
    public var rest: String
    public var priority: (level: Level, text: String)?
    public var page: (query: String, text: String)?

    public static func == (a: QuickAddTokens, b: QuickAddTokens) -> Bool {
        a.rest == b.rest && a.priority?.level == b.priority?.level && a.priority?.text == b.priority?.text && a.page?.query == b.page?.query && a.page?.text == b.page?.text
    }

    // (The web's regular expressions, as NSRegularExpression writes them.)
    private static let priorityPattern = try! NSRegularExpression(pattern: #"(^|\s)(!{1,3}|!(?:high|hi|h|medium|med|m|low|lo|l))(?=\s|$)"#, options: [.caseInsensitive])
    private static let pagePattern = try! NSRegularExpression(pattern: #"(^|\s)(#(?:"([^"]+)"|([\p{L}\p{N}][\p{L}\p{N}_\-./]*)))(?=\s|$)"#)

    static func level(_ token: String) -> Level {
        let t = token.lowercased()
        if t == "!!!" || t.hasPrefix("!h") { return .high }
        if t == "!!" || t.hasPrefix("!m") { return .medium }
        return .low
    }

    private static func tidy(_ s: String) -> String {
        s.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }

    /// Reads the priority and page tokens in `text`, leaving those in `kept` as words.
    public static func read(_ text: String, kept: Set<String> = []) -> QuickAddTokens {
        var rest = text
        var priority: (Level, String)?
        var page: (String, String)?
        func group(_ m: NSTextCheckingResult, _ i: Int, in s: String) -> String? {
            Range(m.range(at: i), in: s).map { String(s[$0]) }
        }
        if let m = priorityPattern.firstMatch(in: rest, range: NSRange(rest.startIndex..., in: rest)), let token = group(m, 2, in: rest), !kept.contains(token) {
            priority = (level(token), token)
            let lead = group(m, 1, in: rest) ?? ""
            rest.replaceSubrange(Range(m.range, in: rest)!, with: lead)
        }
        if let m = pagePattern.firstMatch(in: rest, range: NSRange(rest.startIndex..., in: rest)), let token = group(m, 2, in: rest), !kept.contains(token) {
            let query = (group(m, 3, in: rest) ?? group(m, 4, in: rest) ?? "").trimmingCharacters(in: .whitespaces)
            page = (query, token)
            let lead = group(m, 1, in: rest) ?? ""
            rest.replaceSubrange(Range(m.range, in: rest)!, with: lead)
        }
        let read = priority != nil || page != nil
        return QuickAddTokens(rest: read ? tidy(rest) : text, priority: priority, page: page.flatMap { $0.0.isEmpty ? nil : $0 })
    }

    /// The page a "#query" names among search results: one whose title is it, else starts with it, else contains it.
    public static func page<T>(for query: String, in docs: [T], title: (T) -> String) -> T? {
        let q = query.lowercased()
        return docs.first { title($0).lowercased() == q } ?? docs.first { title($0).lowercased().hasPrefix(q) } ?? docs.first { title($0).lowercased().contains(q) }
    }
}
