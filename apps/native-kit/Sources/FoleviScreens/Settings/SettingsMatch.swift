// Settings' search on every native app, as the web's (apps/web/src/lib/app/settingsSearch.ts): most words of what's
// typed must start a word of the setting (its title, its section, its keywords), with filler words ("how", "do",
// "i", "my") ignored, so a question finds what a keyword does ("how do I turn on dark mode" finds Theme). And Ask
// Foli AI (SettingsView.tsx SettingsSearch, `ai.settingsSearch`): the words and the settings this person has go to
// Foli AI, which picks the ones that do it and says in one sentence what to change.
import Foundation
import Observation
import FoleviEngine

public enum SettingsMatch {
    /// Words a question has that no setting uses (the web's FILLER).
    public static let filler: Set<String> = ["a", "an", "the", "how", "do", "i", "can", "to", "my", "me", "where", "is", "of", "in", "on", "for", "what", "turn", "set", "change", "find", "make", "want", "about", "stop", "get", "getting", "please", "too", "much", "any", "all", "some", "there", "way"]

    /// A text's words, lower-case (letters, digits, "&" and "-" kept together).
    public static func words(_ text: String) -> [String] {
        text.lowercased().split(whereSeparator: { !($0.isLetter || $0.isNumber || $0 == "&" || $0 == "-") }).map(String.init)
    }

    /// The query's words without filler (kept when the query is nothing but filler).
    public static func terms(_ query: String) -> [String] {
        let all = words(query)
        let kept = all.filter { !filler.contains($0) }
        return kept.isEmpty ? all : kept
    }

    /// Whether a typed word finds a setting's word: it starts it ("spell" finds "spellcheck"), or it's a plural
    /// whose singular does ("emails" finds "email").
    public static func finds(_ term: String, _ word: String) -> Bool {
        word.hasPrefix(term) || (term.count > 3 && term.hasSuffix("s") && word.hasPrefix(String(term.dropLast())))
    }

    /// How well `terms` find a setting with these title words and other words (its section's name, keywords): nil
    /// when fewer than half of them match, else a score (title matches count a little more).
    public static func score(_ terms: [String], title: [String], other: [String]) -> Int? {
        guard !terms.isEmpty else { return nil }
        let all = title + other
        let matched = terms.filter { t in all.contains { finds(t, $0) } }.count
        guard matched >= max(1, (terms.count + 1) / 2) else { return nil }
        let inTitle = terms.filter { t in title.contains { $0.hasPrefix(t) } }.count
        return matched * 10 + inTitle
    }

    /// Whether every term finds a word of `text` (a category's own name).
    public static func all(_ terms: [String], in text: String) -> Bool {
        let w = words(text)
        return !terms.isEmpty && terms.allSatisfy { t in w.contains { finds(t, $0) } }
    }

    /// Foli AI's row in the results: whether it's offered for `query` (Foli AI on, two letters or more).
    public static func canAsk(_ query: String, aiOn: Bool) -> Bool {
        aiOn && query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }
}

/// Foli AI's answer to a Settings question: what was asked, while it's thinking, its sentence and picks (keys from
/// the settings offered), or what went wrong, said plainly.
@MainActor
@Observable
public final class SettingsAsk {
    public private(set) var query = ""
    public private(set) var busy = false
    public private(set) var answer = ""
    public private(set) var keys: [String] = []
    public private(set) var error: String?

    public init() {}

    /// Whether there's an answer (or a question on its way) for `query` as typed now.
    public func shows(_ query: String) -> Bool {
        !self.query.isEmpty && self.query == query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The sentence to show: thinking, the answer, or that nothing was found.
    public var line: String {
        if busy { return "Looking through your settings…" }
        return answer.isEmpty ? "Foli AI couldn’t find a setting for that." : answer
    }

    public func clear() {
        query = ""
        busy = false
        answer = ""
        keys = []
        error = nil
    }

    /// Asks Foli AI (`ai.settingsSearch`) through `send`, the engine's command.
    public func ask(_ text: String, options: [SettingsAskOption], send: @escaping @MainActor (String, [SettingsAskOption]) async throws -> SettingsAskResult) async {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !(busy && query == q) else { return }
        query = q
        busy = true
        answer = ""
        keys = []
        self.error = nil
        do {
            let r = try await send(q, options)
            guard query == q else { return }
            let offered = Set(options.map(\.key))
            keys = r.keys.filter { offered.contains($0) }
            answer = r.answer
        } catch {
            guard query == q else { return }
            self.error = Self.message(error)
        }
        busy = false
    }

    /// Asks through an engine client.
    public func ask(_ text: String, options: [SettingsAskOption], client: EngineClient) async {
        await ask(text, options: options) { q, o in try await client.command(.aiSettingsSearch(query: q, options: o)) }
    }

    static func message(_ error: any Error) -> String {
        if case EngineFailure.engine(let e) = error { return e.message }
        return "Foli AI couldn’t answer just now. Try again."
    }
}
