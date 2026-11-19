// Lines as the page's WebKit breaks them (the engine's `text.layout`, revision 24), for small web text drawn
// natively whose breaks no model matches closely enough: iOS WebKit's `text-wrap: pretty` in a card's
// line-clamped preview, a folder card's papers. A view asks for a text's lines in a style; the first time it gets
// nil (and draws its own breaks), the request goes out with others asked for in the same moment, and the answer
// redraws it. Answers are kept for the run. The app sets `requester` (the engine); without one, always nil.
import Foundation
import Observation

@MainActor
@Observable
public final class WebLineLayout {
    public static let shared = WebLineLayout()

    public struct Style: Hashable, Sendable {
        public enum Family: String, Sendable { case sans, display }
        public enum Wrap: String, Sendable { case pretty, wrap, balance }
        public var family: Family
        public var size: CGFloat
        public var lineHeight: CGFloat
        public var weight: CGFloat
        public var letterSpacing: CGFloat
        public var width: CGFloat
        public var wrap: Wrap
        /// `white-space: pre-line`.
        public var pre: Bool
        /// A `-webkit-line-clamp` box of this many lines.
        public var clamp: Int?

        public init(family: Family, size: CGFloat, lineHeight: CGFloat, weight: CGFloat = 400, letterSpacing: CGFloat, width: CGFloat, wrap: Wrap, pre: Bool, clamp: Int? = nil) {
            self.family = family
            // (Rounded so a width a hair different from layout to layout asks once.)
            self.size = (size * 1000).rounded() / 1000
            self.lineHeight = (lineHeight * 1000).rounded() / 1000
            self.weight = weight
            self.letterSpacing = (letterSpacing * 1000).rounded() / 1000
            self.width = (width * 100).rounded() / 100
            self.wrap = wrap
            self.pre = pre
            self.clamp = clamp
        }
    }

    private struct Key: Hashable {
        let text: String
        let style: Style
    }

    public typealias Requester = @MainActor (Style, [String]) async throws -> [[String]]

    /// What asks the page (set by the app).
    @ObservationIgnored public var requester: Requester?
    private var answered: [Key: [String]] = [:]
    @ObservationIgnored private var asked: Set<Key> = []
    @ObservationIgnored private var queue: [Style: [String]] = [:]
    @ObservationIgnored private var flushing = false

    public init() {}

    /// The most answers kept (a card's preview is a few short lines: a few MB at most).
    public static let cap = 6000
    /// How many answers are kept now (tests, and the Debug memory report).
    public var count: Int { answered.count }

    /// Lets go of every answer (memory is short, or the cap was reached); what shows asks again.
    public func relieve() {
        answered.removeAll()
        asked.removeAll()
    }

    /// The text's lines as WebKit breaks them, or nil until they've come (asked for now if not yet).
    public func lines(_ text: String, style: Style) -> [String]? {
        let key = Key(text: text, style: style)
        if let l = answered[key] { return l }
        guard requester != nil, !asked.contains(key) else { return nil }
        asked.insert(key)
        queue[style, default: []].append(text)
        if !flushing {
            flushing = true
            // (Everything asked for while this layout pass runs goes in one request per style.)
            DispatchQueue.main.async { [weak self] in self?.flush() }
        }
        return nil
    }

    private func flush() {
        flushing = false
        let batches = queue
        queue = [:]
        guard let requester else { return }
        for (style, texts) in batches {
            for chunk in stride(from: 0, to: texts.count, by: 64).map({ Array(texts[$0..<min($0 + 64, texts.count)]) }) {
                Task { @MainActor in
                    guard let lines = try? await requester(style, chunk), lines.count == chunk.count else {
                        // (Asked again the next time a card wants it: it used to keep its rough breaks for good.)
                        for text in chunk { asked.remove(Key(text: text, style: style)) }
                        return
                    }
                    // (A width is part of the key, so a window dragged through many widths adds a set of lines
                    // for each: past the cap everything goes, and what is on screen asks again.)
                    if answered.count + chunk.count > Self.cap { relieve() }
                    for (text, l) in zip(chunk, lines) { answered[Key(text: text, style: style)] = l }
                }
            }
        }
    }
}
