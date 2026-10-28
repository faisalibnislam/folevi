// Reviews (apps/web/src/components/views/ReviewView.tsx as Folevi for Mac shows it): the cards due today, one at
// a time. Show the answer (Space), then say how well you knew it (1 to 4); each rating button says when the
// card comes back. Data from the bridge's `reviews` view (study.queue), ratings through `review.rate`.
#if os(macOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
@Observable
final class ReviewModel {
    let client: EngineClient
    let feedback: ScreenFeedback
    private(set) var store: ValueStore<ReviewsValue>
    /// Cards answered this session ("block:lastReview"); one rated Again comes back with a newer review.
    private(set) var done: Set<String> = []
    private(set) var reviewed = 0
    var revealed = false

    static let ratings: [(id: String, label: String, key: Character)] = [("again", "Again", "1"), ("hard", "Hard", "2"), ("good", "Good", "3"), ("easy", "Easy", "4")]
    static let newPerDayOptions = [0, 10, 20, 30, 50, 100]

    init(client: EngineClient, feedback: ScreenFeedback) {
        self.client = client
        self.feedback = feedback
        store = client.watch(.reviews())
    }

    /// A fresh session with the queue as of now (the day by this Mac's clock).
    func restart() {
        store = client.watch(.reviews())
        done = []
        reviewed = 0
        revealed = false
    }

    var value: ReviewsValue? { store.value }
    private func key(_ c: ReviewCard) -> String { "\(c.blockId):\(c.lastReview.map(String.init) ?? "new")" }
    var card: ReviewCard? { value?.cards.first { !done.contains(key($0)) } }
    var left: Int {
        guard let v = value else { return 0 }
        let answered = v.cards.filter { done.contains(key($0)) }.count
        return max(0, v.due + v.new - answered)
    }

    func reveal() { if card != nil { revealed = true } }

    func rate(_ rating: String) {
        guard let card, revealed else { return }
        done.insert(key(card))
        revealed = false
        reviewed += 1
        Task {
            do { _ = try await client.command(.reviewRate(blockId: card.blockId, rating: rating, lastReview: card.lastReview)) } catch { feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error)) }
        }
    }

    func setNewPerDay(_ n: Int) {
        Task {
            do { _ = try await client.command(.reviewSetNewPerDay(value: n)) } catch { feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error)) }
        }
    }

    static func cardCount(_ n: Int) -> String { "\(n) card\(n == 1 ? "" : "s")" }

    /// How long until a card comes back, short, for a button: "1m", "10m", "3h", "4d", "2mo", "1.5y".
    static func intervalLabel(_ ms: Int) -> String {
        let minute = 60_000.0, hour = 60 * minute, day = 24 * hour, v = Double(ms)
        if v < hour { return "\(max(1, Int((v / minute).rounded())))m" }
        if v < day { return "\(Int((v / hour).rounded()))h" }
        let days = Int((v / day).rounded())
        if days < 30 { return "\(days)d" }
        if days < 365 { return "\(Int((Double(days) / 30).rounded()))mo" }
        let years = (Double(days) / 365 * 10).rounded() / 10
        return years == years.rounded() ? "\(Int(years))y" : "\(years)y"
    }
}

struct ReviewScreen: View {
    let model: ReviewModel
    let frame: FrameModel
    @Environment(\.colorScheme) private var scheme
    @FocusState private var focused: Bool

    var body: some View {
        let v = model.value
        let region = moreStyle("more.review.region", scheme)
        VStack(spacing: 0) {
            WebFactsRow(subtitle: v.map { _ in model.left > 0 ? "\(ReviewModel.cardCount(model.left)) to review" : "All caught up" }) {
                if let v {
                    WebBareSelect(label: v.newPerDay == 0 ? "No new cards" : "\(v.newPerDay) new cards a day",
                                  options: ReviewModel.newPerDayOptions.map { (String($0), $0 == 0 ? "No new cards" : "\($0) new cards a day") },
                                  selected: String(v.newPerDay)) { model.setNewPerDay(Int($0) ?? 20) }
                }
            }
            ScrollView(.vertical) {
                content(v)
                    .padding(region.padding.edgeInsets)
                    .frame(width: region.width, alignment: .top)
                    .frame(maxWidth: .infinity)
            }
        }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onAppear { focused = true }
        .onKeyPress(phases: .down) { press in
            guard press.modifiers.isDisjoint(with: [.command, .control, .option]) else { return .ignored }
            if !model.revealed {
                if press.key == .space || press.key == .return { model.reveal(); return .handled }
                return .ignored
            }
            if let r = ReviewModel.ratings.first(where: { String($0.key) == press.characters }) { model.rate(r.id); return .handled }
            return .ignored
        }
        .accessibilityIdentifier("screen.review")
    }

    @ViewBuilder
    private func content(_ v: ReviewsValue?) -> some View {
        if let v {
            if !v.found {
                MoreEmptyState(icon: .layers, title: "This note isn't available", message: "It may have been moved to Trash, or you no longer have access to it.")
            } else if let card = model.card {
                cardView(card)
            } else if model.reviewed > 0 {
                MoreEmptyState(icon: .layers, title: "Done for now", message: "You reviewed \(ReviewModel.cardCount(model.reviewed)).\(v.later > 0 ? " \(ReviewModel.cardCount(v.later)) more later today." : "")")
            } else {
                MoreEmptyState(icon: .layers, title: "Nothing to review", message: "Cards from your notes come back here when they're due.\(v.later > 0 ? " \(ReviewModel.cardCount(v.later)) later today." : "")",
                              hint: v.hasCards ? nil : "To make cards, ask Foli AI for flashcards on a note, or turn a toggle into a flashcard from its block menu.")
            }
        } else {
            RoundedRectangle(cornerRadius: 16, style: .circular).fill(moreVar("glass-hover", scheme)).frame(height: 256)
        }
    }

    private func cardView(_ card: ReviewCard) -> some View {
        let muted = moreVar("color-ink-muted", scheme), heading = moreVar("color-heading", scheme), ink = moreVar("color-ink", scheme)
        let total = model.reviewed + model.left
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(verbatim: "Card \(model.reviewed + 1) of \(total)").webText(.role(.subheadline)).lineLimit(1).foregroundStyle(muted)
                Spacer()
                if card.isNew {
                    Text(verbatim: "New").webText(.role(.footnote, weight: 500)).lineLimit(1).foregroundStyle(ink)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(moreVar("glass-hover", scheme)))
                }
            }
            .padding(.bottom, 12)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(moreVar("glass-active", scheme))
                    Capsule().fill(heading).frame(width: total > 0 ? geo.size.width * CGFloat(model.reviewed) / CGFloat(total) : 0)
                }
            }
            .frame(height: 6)
            .padding(.bottom, 20)
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: card.front.isEmpty ? "Untitled card" : card.front).webText(.display(.title2)).foregroundStyle(heading).frame(maxWidth: .infinity, alignment: .leading)
                if model.revealed {
                    Rectangle().fill(moreVar("color-line", scheme).opacity(0.7)).frame(height: 1).padding(.vertical, 20)
                    Text(verbatim: card.back.isEmpty ? "Nothing inside this card yet." : card.back).webText(.role(.body)).foregroundStyle(ink).frame(maxWidth: .infinity, alignment: .leading)
                }
                Button { frame.open(.note(card.noteId)) } label: {
                    HStack(spacing: 6) {
                        WebIconView(.fileText, size: 12)
                        Text(verbatim: card.noteTitle.isEmpty ? "Untitled" : card.noteTitle).webText(.role(.subheadline)).lineLimit(1)
                    }
                    .foregroundStyle(muted)
                }
                .buttonStyle(.plain)
                .padding(.top, 24)
            }
            .padding(32)
            .background(RoundedRectangle(cornerRadius: 16, style: .circular).fill(moreVar("glass-active", scheme)))
            VStack(spacing: 12) {
                if model.revealed {
                    HStack(spacing: 8) {
                        ForEach(ReviewModel.ratings, id: \.id) { r in
                            RatingButton(title: r.label, detail: ReviewModel.intervalLabel(interval(card, r.id)), primary: r.id == "good") { model.rate(r.id) }
                        }
                    }
                } else {
                    Button { model.reveal() } label: {
                        Text(verbatim: "Show answer").webText(WebStyles.named("button.primary.md").resolve(scheme).text).lineLimit(1)
                            .frame(maxWidth: .infinity)
                            .webElement(WebStyles.named("button.primary.md"))
                    }
                    .buttonStyle(.plain)
                }
                Text(verbatim: model.revealed ? "Keys: 1 Again, 2 Hard, 3 Good, 4 Easy." : "Key: Space shows the answer.")
                    .webText(.role(.footnote)).lineLimit(1).foregroundStyle(moreVar("color-ink-faint", scheme))
            }
            .padding(.top, 20)
        }
    }

    private func interval(_ c: ReviewCard, _ id: String) -> Int {
        switch id {
        case "again": c.intervals.again
        case "hard": c.intervals.hard
        case "good": c.intervals.good
        default: c.intervals.easy
        }
    }
}

/// A rating button: the rating and when the card comes back (ui-btn primary for Good, secondary for the rest).
private struct RatingButton: View {
    let title: String
    let detail: String
    let primary: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let style = WebStyles.named(primary ? "button.primary.md" : "button.secondary.md")
        let s = style.resolve(scheme)
        Button(action: action) {
            VStack(spacing: 2) {
                Text(verbatim: title).webText(.role(.body, weight: 600)).lineLimit(1)
                Text(verbatim: detail).webText(.role(.footnote)).lineLimit(1).opacity(0.7)
            }
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .foregroundStyle(s.color.color)
            .webBox(style)
        }
        .buttonStyle(.plain)
    }
}
#endif
