// Calendar on the iPhone, as the web draws it (apps/web/src/components/iphone/Agenda.tsx and WeekStrip.tsx): the
// week strip under the large title (pull it down, or tap its grabber, for the whole month), then the picked day and
// the days after it, each with its tasks and the events from subscribed calendars. Days with nothing on them are
// left out, except the picked one; overdue tasks come first when the picked day is today. Everything comes from
// CalendarModel; the frame draws the bar (the month as the title, Today, the "…" menu).
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

private func C(_ pair: ColorPair, _ scheme: ColorScheme) -> Color { pair.resolve(scheme).color }

/// iOS's sheet-like settle (WeekStrip.tsx SETTLE): no overshoot, quick to start, soft to land.
private let settle = Animation.timingCurve(0.32, 0.72, 0, 1, duration: 0.32)

// MARK: The week strip

/// The seven days of the week, today and the picked day filled, a dot under each day that has tasks or events.
/// Swipe sideways for other weeks (the same weekday stays picked); pull it down, or tap the grabber, for the whole
/// month, which pages sideways by month and folds back up when a day is picked or it's pushed up again.
public struct PhoneWeekStrip: View {
    let today: String
    let selected: String
    let marked: (String) -> Bool
    let select: (String) -> Void
    let feel: () -> Void
    @State private var open = false
    /// 0 (the week) to 1 (the month) while a finger pulls it; nil at rest.
    @State private var pull: CGFloat?
    @State private var dragFrom: CGFloat?
    @State private var axis: Axis?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// One row of days: the date's circle (34) and the dot under it, in a 48 pt tall cell.
    static let rowHeight: CGFloat = 48

    public init(today: String, selected: String, marked: @escaping (String) -> Bool, select: @escaping (String) -> Void, feel: @escaping () -> Void = {}) {
        self.today = today
        self.selected = selected
        self.marked = marked
        self.select = select
        self.feel = feel
    }

    public var body: some View {
        let rows = TaskDates.monthRows(selected)
        let selRow = CGFloat(max(0, rows.firstIndex { $0.contains(selected) } ?? 0))
        let progress = pull ?? (open ? 1 : 0)
        let fullHeight = CGFloat(rows.count) * Self.rowHeight
        let height = Self.rowHeight + (fullHeight - Self.rowHeight) * progress
        let showMonth = open || pull != nil
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    let d = TaskDates.add("2024-01-01", days: i)
                    Text(TaskDates.format(d, "EEEEE"))
                        .webText(WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: 18, weight: FoleviTokens.FontWeight.semibold))
                        .lineLimit(1)
                        .foregroundStyle(C(i >= 5 ? FoleviTokens.Chrome.inkFaint : FoleviTokens.Chrome.inkMuted, scheme))
                        .frame(maxWidth: .infinity)
                }
            }
            .accessibilityHidden(true)
            ZStack(alignment: .top) {
                PhoneWeekPager(today: today, selected: selected, day: { day($0, inMonth: true, fade: 0) }) { date in
                    feel()
                    select(date)
                }
                .frame(height: Self.rowHeight)
                .opacity(showMonth ? 0 : 1)
                .allowsHitTesting(!showMonth)
                if showMonth {
                    PhoneMonthPager(today: today, selected: selected, rows: rows, selRow: selRow, progress: progress, paging: open && pull == nil, day: day) { month in
                        feel()
                        select(month == String(today.prefix(7)) ? today : "\(month)-01")
                    }
                    .background(C(FoleviTokens.Chrome.canvas, scheme))
                }
            }
            .frame(height: max(0, height), alignment: .top)
            .clipped()
            // The grabber: tap for the month (or back to the week); the whole strip drags too.
            Button {
                feel()
                withAnimation(reduceMotion ? nil : settle) { open.toggle() }
            } label: {
                Capsule().fill(inkMix(0.20, scheme)).frame(width: 36, height: 5)
                    .frame(width: 64, height: 20)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(open ? "Show the week" : "Show the whole month")
        }
        .padding(.horizontal, 10)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .background(C(FoleviTokens.Chrome.canvas, scheme))
        .contentShape(Rectangle())
        .simultaneousGesture(pullGesture(travel: max(1, fullHeight - Self.rowHeight)))
    }

    /// The pull: a vertical drag anywhere on the strip (sideways drags page it), 1:1 with the finger and
    /// rubber-banding past either end; it lands where the release's speed would carry it.
    private func pullGesture(travel: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { v in
                if axis == nil { axis = abs(v.translation.height) > abs(v.translation.width) ? .vertical : .horizontal }
                guard axis == .vertical else { return }
                let from = dragFrom ?? (open ? 1 : 0)
                dragFrom = from
                var next = from + v.translation.height / travel
                if next > 1 { next = 1 + (1 - 1 / ((next - 1) * 0.55 + 1)) * 0.25 }
                if next < 0 { next = -(1 - 1 / (-next * 0.55 + 1)) * 0.15 }
                pull = next
            }
            .onEnded { v in
                defer {
                    axis = nil
                    dragFrom = nil
                }
                guard axis == .vertical, let from = dragFrom else { return }
                let projected = from + v.predictedEndTranslation.height / travel
                let next = projected > 0.5
                if next != open { feel() }
                withAnimation(reduceMotion ? nil : settle) {
                    pull = nil
                    open = next
                }
            }
    }

    private func pick(_ date: String) {
        if date != selected { feel() }
        select(date)
        if open { withAnimation(reduceMotion ? nil : settle) { open = false } }
    }

    /// A day: the circle (the picked day filled in the heading's ink, today in the ink at 9%) and the dot.
    private func day(_ date: String, inMonth: Bool, fade: CGFloat) -> some View {
        let isToday = date == today
        let isSelected = date == selected
        let has = marked(date)
        let dim = !inMonth ? 1 - 0.6 * fade : 1
        return Button { pick(date) } label: {
            VStack(spacing: 0) {
                Text("\(Int(date.suffix(2)) ?? 0)")
                    .webText(WebTextStyle(size: WebTypeRole.body.metrics.size, leading: WebTypeRole.body.metrics.size, weight: isSelected || isToday ? FoleviTokens.FontWeight.semibold : FoleviTokens.FontWeight.regular))
                    .lineLimit(1)
                    .monospacedDigit()
                    .foregroundStyle(C(isSelected ? FoleviTokens.Chrome.canvas : isToday ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.ink, scheme))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(isSelected ? C(FoleviTokens.Chrome.heading, scheme) : isToday ? inkMix(0.09, scheme) : .clear))
                    .opacity(isSelected ? 1 : dim)
                Circle().fill(inkMix(0.38, scheme)).frame(width: 5, height: 5)
                    .opacity(has ? dim : 0)
                    .padding(.top, 6)
            }
            .padding(.top, 2)
            .frame(maxWidth: .infinity, minHeight: Self.rowHeight, maxHeight: Self.rowHeight, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(PhoneDayPressStyle())
        .accessibilityLabel("\(isToday ? "Today, " : "")\(TaskDates.format(date, "EEEEMMMMd"))\(has ? ", has tasks or events" : "")")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// `group-active:scale-90` on the day's circle.
private struct PhoneDayPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.easeOut(duration: 0.2), value: configuration.isPressed)
    }
}

/// The weeks, paged sideways (a page at a time, two years either side of today). Paging to another week picks the
/// same weekday there.
private struct PhoneWeekPager<Day: View>: View {
    let today: String
    let selected: String
    let day: (String) -> Day
    let week: (String) -> Void
    @State private var page: Int?

    static var back: Int { 104 }
    static var ahead: Int { 104 }

    private var origin: String { TaskDates.add(TaskDates.startOfWeek(today), days: -7 * Self.back) }
    private var index: Int { min(Self.back + Self.ahead, max(0, TaskDates.between(origin, selected) / 7)) }

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(0...(Self.back + Self.ahead), id: \.self) { i in
                    HStack(spacing: 0) {
                        ForEach(0..<7, id: \.self) { d in day(TaskDates.add(origin, days: i * 7 + d)) }
                    }
                    .containerRelativeFrame(.horizontal)
                    .id(i)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $page)
        .onAppear { page = index }
        .onChange(of: index) { _, i in
            guard page != i else { return }
            withAnimation(.easeOut(duration: 0.3)) { page = i }
        }
        .onScrollPhaseChange { _, phase in
            guard phase == .idle, let page, page != index else { return }
            let weekday = TaskDates.weekdayIndex(selected)
            week(TaskDates.add(origin, days: page * 7 + weekday))
        }
        .accessibilityLabel("Week")
    }
}

/// The whole month. While it's pulled it shows the picked day's month only, its rows sliding out from the picked
/// week; open and at rest it pages sideways by month.
private struct PhoneMonthPager<Day: View>: View {
    let today: String
    let selected: String
    let rows: [[String]]
    let selRow: CGFloat
    let progress: CGFloat
    let paging: Bool
    let day: (String, Bool, CGFloat) -> Day
    let month: (String) -> Void
    @State private var page: Int?

    static var eachWay: Int { 24 }

    private var origin: String { TaskDates.addMonths(TaskDates.startOfMonth(today), -Self.eachWay) }
    private var index: Int {
        let a = origin.split(separator: "-").compactMap { Int($0) }, b = selected.split(separator: "-").compactMap { Int($0) }
        guard a.count >= 2, b.count >= 2 else { return Self.eachWay }
        return min(Self.eachWay * 2, max(0, (b[0] - a[0]) * 12 + (b[1] - a[1])))
    }

    private func grid(_ m: String, _ r: [[String]], fade: CGFloat) -> some View {
        VStack(spacing: 0) {
            ForEach(r, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(row, id: \.self) { d in day(d, d.hasPrefix(m), fade) }
                }
            }
        }
    }

    var body: some View {
        let p = min(1, max(0, progress))
        let m = String(selected.prefix(7))
        if paging {
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 0) {
                    ForEach(0...(Self.eachWay * 2), id: \.self) { i in
                        let first = TaskDates.addMonths(origin, i)
                        grid(String(first.prefix(7)), i == index ? rows : TaskDates.monthRows(first), fade: 1)
                            .containerRelativeFrame(.horizontal)
                            .id(i)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $page)
            .onAppear { page = index }
            .onScrollPhaseChange { _, phase in
                guard phase == .idle, let page, page != index else { return }
                month(String(TaskDates.addMonths(origin, page).prefix(7)))
            }
            .accessibilityLabel("Month")
        } else {
            grid(m, rows, fade: p)
                .offset(y: -selRow * PhoneWeekStrip.rowHeight * (1 - p))
                .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

// MARK: The agenda

/// What the Calendar asks the frame for.
public struct PhoneAgendaActions {
    /// A day's +: Quick task on that day.
    public var add: (String) -> Void
    public var openEvent: (CalendarEvent) -> Void

    public init(add: @escaping (String) -> Void, openEvent: @escaping (CalendarEvent) -> Void) {
        self.add = add
        self.openEvent = openEvent
    }
}

/// The days of the agenda under the strip.
public struct PhoneAgendaContent: View {
    let model: CalendarModel
    let actions: PhoneAgendaActions
    @Environment(\.colorScheme) private var scheme

    public init(model: CalendarModel, actions: PhoneAgendaActions) {
        self.model = model
        self.actions = actions
    }

    public var body: some View {
        let today = model.today
        let days = model.agenda
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(days.enumerated()), id: \.element.id) { i, day in
                VStack(alignment: .leading, spacing: 0) {
                    PhoneAgendaDayHeader(date: day.day, today: today) { actions.add(day.day) }
                    if day.isEmpty {
                        Text("Nothing planned")
                            .webText(WebTextStyle(family: .display, size: WebTypeRole.subheadline.metrics.size, leading: 20))
                            .italic()
                            .foregroundStyle(C(FoleviTokens.Chrome.inkFaint, scheme))
                            .frame(minHeight: 56)
                            .padding(.horizontal, 20)
                    } else {
                        ForEach(day.overdue + day.tasks, id: \.id) { t in
                            PhoneTaskLine(task: t, today: today, showNote: true, onDay: true, toggle: { model.toggle(t) }, open: { model.open(t) })
                        }
                        ForEach(day.events) { e in event(e.event) }
                    }
                }
                .padding(.top, i == 0 ? 8 : 20)
            }
            if days.count <= 1 {
                Text("Nothing else in the next 30 days.")
                    .webText(PhoneType.subheadline(leading: 20))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.top, 32)
            }
        }
    }

    /// An event: where a task has its box, the calendar's colour; its title, and when it is and from which calendar.
    private func event(_ e: CalendarEvent) -> some View {
        let when = CalendarMath.eventWhen(e, timeZone: model.timeZone)
        return Button { actions.openEvent(e) } label: {
            HStack(alignment: .center, spacing: 12) {
                Capsule().fill(Self.color(e.color).resolve(scheme).color).frame(width: 4, height: 22).frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.title.isEmpty ? "Untitled event" : e.title).webText(PhoneType.body()).lineLimit(1)
                        .foregroundStyle(C(FoleviTokens.Chrome.ink, scheme))
                    Text("\(when) · \(e.calendarName)").webText(PhoneType.subheadline(leading: 20)).lineLimit(1)
                        .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                }
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .overlay(alignment: .bottom) { PhoneRowHairlineView() }
            }
            .padding(.leading, 20)
            .padding(.trailing, 16)
        }
        .buttonStyle(PhoneRowPressStyle())
        .accessibilityLabel("\(e.title.isEmpty ? "Untitled event" : e.title), \(when), from \(e.calendarName)")
    }

    /// A subscribed calendar's colour (CalendarSubscriptions.tsx calendarColor).
    static func color(_ key: String) -> ColorPair {
        switch key {
        case "moss": FoleviTokens.Chrome.moss
        case "marigold": FoleviTokens.Chrome.marigold
        case "plum": FoleviTokens.Chrome.plum
        case "coral": FoleviTokens.Chrome.coral
        case "muted": FoleviTokens.Chrome.inkMuted
        default: FoleviTokens.Chrome.accent
        }
    }
}

/// DayHeader: "Today", "Tomorrow" or the weekday in the heading's weight, the date muted beside it, and a 44 pt +
/// that adds a task on that day.
struct PhoneAgendaDayHeader: View {
    let date: String
    let today: String
    let add: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let near = date == today ? "Today" : date == TaskDates.add(today, days: 1) ? "Tomorrow" : date == TaskDates.add(today, days: -1) ? "Yesterday" : TaskDates.format(date, "EEEE")
        let rest = TaskDates.format(date, ["Today", "Tomorrow", "Yesterday"].contains(near) ? "EEEEMMMd" : "MMMd")
        HStack(spacing: 0) {
            PhoneDayTitle(name: near, detail: rest).frame(maxWidth: .infinity, alignment: .leading)
            Button(action: add) {
                WebIconView(.plus, size: 20, strokeWidth: 2.2)
                    .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add a task on \(TaskDates.format(date, "EEEEMMMMd"))")
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .frame(minHeight: 44)
    }
}
#endif
