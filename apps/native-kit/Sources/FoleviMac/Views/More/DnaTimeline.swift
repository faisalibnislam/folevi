// Foli DNA's time-lapse bar on the Mac and iPad (GraphScreen.swift, "Play how it grew"), as the web's
// components/views/DnaTimeline.tsx and lib/graph/timeline.ts: a floating bar at the bottom of the map with play or
// pause, a track that fills as time passes (ticks for the weeks, months or years in it), the date in a pill over
// the playhead, the first and last dates under the ends, how many notes there are so far, and an x that stops and
// goes back to now. Drag or click the track to jump; Space plays or pauses, the arrow keys step, Home and End go to
// the ends, Escape closes.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine

enum DnaTimelineMath {
    enum Unit: Equatable { case day, week, month, year }
    struct Tick: Equatable {
        var at: Double
        /// Where on the track, 0 to 1.
        var pos: Double
        /// Starts a new year (months, years) or a new month (weeks, days): drawn taller.
        var major: Bool
    }

    static let day: Double = 86_400_000
    /// How long a whole play takes, from the first note to the last (milliseconds).
    static let playMs: Double = 8000

    /// Months up to about two years, years past that, weeks or days for a short span.
    static func unit(_ start: Double, _ end: Double) -> Unit {
        let days = (end - start) / day
        if days > 730 { return .year }
        if days > 62 { return .month }
        if days > 14 { return .week }
        return .day
    }

    /// The first moment of the next unit after `t` (local time; weeks start on Monday).
    static func next(_ t: Double, _ u: Unit, calendar: Calendar = .current) -> Double {
        let d = Date(timeIntervalSince1970: t / 1000)
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        let out: Date?
        switch u {
        case .year: out = calendar.date(from: DateComponents(year: (c.year ?? 1970) + 1, month: 1, day: 1))
        case .month: out = calendar.date(from: DateComponents(year: c.year, month: (c.month ?? 1) + 1, day: 1))
        case .day: out = calendar.date(from: DateComponents(year: c.year, month: c.month, day: (c.day ?? 1) + 1))
        case .week:
            let nextDay = calendar.date(from: DateComponents(year: c.year, month: c.month, day: (c.day ?? 1) + 1)) ?? d
            let weekday = calendar.component(.weekday, from: nextDay) // 1 Sunday … 7 Saturday
            let toMonday = (9 - weekday) % 7
            out = calendar.date(byAdding: .day, value: toMonday, to: nextDay)
        }
        return (out ?? d.addingTimeInterval(86_400)).timeIntervalSince1970 * 1000
    }

    /// Ticks strictly inside the span; past `max` of them the major ones and every n-th stay.
    static func ticks(_ start: Double, _ end: Double, max: Int = 36, calendar: Calendar = .current) -> (unit: Unit, ticks: [Tick]) {
        let u = unit(start, end)
        guard end > start else { return (u, []) }
        var all: [Tick] = []
        var t = next(start, u, calendar: calendar)
        while t < end && all.count < 2000 {
            let c = calendar.dateComponents([.month, .day], from: Date(timeIntervalSince1970: t / 1000))
            let major = u == .year ? true : u == .month ? c.month == 1 : c.day == 1
            all.append(Tick(at: t, pos: (t - start) / (end - start), major: major))
            t = next(t, u, calendar: calendar)
        }
        guard all.count > max else { return (u, all) }
        let every = Int((Double(all.count) / Double(max)).rounded(.up))
        return (u, all.enumerated().filter { (u != .year && $0.element.major) || $0.offset % every == 0 }.map(\.element))
    }

    /// One arrow key's step: a tick's unit, or a fiftieth of the span when that is bigger; never past the ends.
    static func step(_ start: Double, _ end: Double, at: Double, by dir: Double) -> Double {
        let size: Double = switch unit(start, end) {
        case .day: day
        case .week: 7 * day
        case .month: 30.44 * day
        case .year: 365.25 * day
        }
        return min(end, Swift.max(start, at + dir * Swift.max(size, (end - start) / 50)))
    }

    /// How many notes existed at `at`, of the notes on the map that have a date.
    static func notesSoFar(_ nodes: [GraphNode], at: Double) -> (shown: Int, total: Int) {
        let dated = nodes.filter { $0.kind == "note" && ($0.createdAt ?? 0) > 0 }
        return (dated.filter { ($0.createdAt ?? 0) <= at }.count, dated.count)
    }

    static func label(_ t: Double) -> String {
        Date(timeIntervalSince1970: t / 1000).formatted(.dateTime.day().month(.abbreviated).year())
    }
}

struct DnaTimelineBar: View {
    let start: Double
    let end: Double
    let at: Double
    let playing: Bool
    let count: (shown: Int, total: Int)
    let onPlay: () -> Void
    let onSeek: (Double) -> Void
    let onClose: () -> Void
    @Environment(\.colorScheme) private var scheme
    @FocusState private var focused: Bool
    @State private var scrubbing = false
    @State private var overTrack = false
    @State private var trackW: CGFloat = 0

    var body: some View {
        let span = max(1, end - start)
        let pos = min(1, max(0, (at - start) / span))
        let ticks = DnaTimelineMath.ticks(start, end).ticks
        // The playhead glides on a click or a key; while it plays or is dragged it follows exactly.
        let glide: Animation? = playing || scrubbing ? nil : WebMotion.change(WebMotion.viewSwitch)
        HStack(spacing: 8) {
            WebIconButton(playing ? .pause : .play, label: playing ? "Pause (Space)" : "Play (Space)") { onPlay() }
            VStack(spacing: 2) {
                GeometryReader { g in
                    let w = g.size.width, mid = g.size.height / 2
                    let x = CGFloat(pos) * w
                    ZStack(alignment: .topLeading) {
                        Capsule().fill(moreVar("glass-hover", scheme)).overlay(Capsule().fill(moreVar("color-ink", scheme).opacity(overTrack ? 0.06 : 0)))
                            .frame(width: w, height: 6).position(x: w / 2, y: mid)
                        ForEach(Array(ticks.enumerated()), id: \.offset) { _, t in
                            Rectangle().fill(moreVar("color-line-strong", scheme)).opacity(t.major ? 0.9 : 0.6)
                                .frame(width: 1, height: t.major ? 12 : 6).position(x: CGFloat(t.pos) * w, y: mid)
                        }
                        Capsule().fill(moreVar("color-heading", scheme)).frame(width: max(0, x), height: 6).position(x: x / 2, y: mid)
                        Circle().fill(moreVar("color-surface", scheme)).overlay(Circle().stroke(moreVar("color-heading", scheme), lineWidth: 2))
                            .overlay { if focused { Circle().stroke(moreVar("color-focus", scheme), lineWidth: 2).padding(-4) } }
                            .frame(width: 14, height: 14).scaleEffect(overTrack ? 1.1 : 1)
                            .shadow(color: .black.opacity(0.15), radius: 1.5, y: 0.5)
                            .position(x: x, y: mid)
                    }
                    .animation(glide, value: at)
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                        scrubbing = true
                        onSeek(start + Double(min(1, max(0, v.location.x / max(1, w)))) * span)
                    }.onEnded { _ in scrubbing = false })
                    .onHover { overTrack = $0 }
                }
                .frame(height: 24)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { trackW = $0 }
                // The date in a pill over the playhead, moving with it (kept inside the track's ends).
                .overlay(alignment: .topLeading) {
                    let px = min(max(CGFloat(pos) * trackW, 44), max(44, trackW - 44))
                    Text(verbatim: DnaTimelineMath.label(at)).webText(.role(.footnote, weight: 500)).monospacedDigit().foregroundStyle(moreVar("color-heading", scheme)).lineLimit(1).fixedSize()
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(moreVar("color-surface", scheme), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .webBox(WebStyles.named("menu.panel"))
                        .alignmentGuide(.leading) { d in d.width / 2 - px }
                        .alignmentGuide(.top) { d in d.height + 2 }
                        .animation(glide, value: at)
                        .allowsHitTesting(false)
                }
                .accessibilityElement()
                .accessibilityLabel("Date")
                .accessibilityValue(DnaTimelineMath.label(at))
                .accessibilityAdjustableAction { d in onSeek(DnaTimelineMath.step(start, end, at: at, by: d == .increment ? 1 : -1)) }
                HStack {
                    Text(verbatim: DnaTimelineMath.label(start))
                    Spacer(minLength: 8)
                    Text(verbatim: DnaTimelineMath.label(end))
                }
                .webText(.role(.caption1)).monospacedDigit().foregroundStyle(moreVar("color-ink-faint", scheme)).lineLimit(1)
                .accessibilityHidden(true)
            }
            .padding(.horizontal, 8)
            Text(verbatim: "\(count.shown) of \(count.total) \(count.total == 1 ? "note" : "notes")").webText(.role(.footnote)).monospacedDigit().foregroundStyle(moreVar("color-ink-muted", scheme)).lineLimit(1).fixedSize()
            WebIconButton(.x, label: "Close the time-lapse") { onClose() }
        }
        .padding(.leading, 8).padding(.trailing, 6).padding(.vertical, 8)
        .background(moreVar("color-surface", scheme), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .webBox(WebStyles.named("menu.panel"))
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: .down) { press in
            switch press.key {
            case .space: onPlay()
            case .rightArrow, .upArrow: onSeek(DnaTimelineMath.step(start, end, at: at, by: 1))
            case .leftArrow, .downArrow: onSeek(DnaTimelineMath.step(start, end, at: at, by: -1))
            case .home: onSeek(start)
            case .end: onSeek(end)
            case .escape: onClose()
            default: return .ignored
            }
            return .handled
        }
        // Keyboard first: the bar takes focus when it opens, so Space and the arrows work at once.
        .onAppear { focused = true }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("How it grew")
    }
}
#endif
