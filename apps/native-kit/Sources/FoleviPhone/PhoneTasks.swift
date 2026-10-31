// Tasks on the iPhone, as the web draws them (apps/web/src/components/iphone/Tasks.tsx): the views as a scrolling
// row of capsules (icon, name and count; the chosen one filled), the filter field, and the tasks grouped by the
// note they live in under headers that fold away (Upcoming groups by day). A tap opens a task's sheet, the box
// checks it off (it fills and ticks, then the task leaves), a swipe right completes it, left moves it to tomorrow
// or opens its date. Everything comes from TasksModel; the frame draws the bar and the large title.
#if os(iOS)
import CoreText
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

private func C(_ pair: ColorPair, _ scheme: ColorScheme) -> Color { pair.resolve(scheme).color }

/// `color-mix(in oklab, var(--color-ink) N%, transparent)`: the ink at that alpha.
func inkMix(_ p: Double, _ scheme: ColorScheme) -> Color {
    var c = FoleviTokens.Chrome.ink.resolve(scheme)
    c.a = p
    return c.color
}

// MARK: The box and a task's row

/// TaskBox: Folevi's rounded-square task box at the iPhone's size (22 pt, a 1.5 pt edge); checking it fills the box
/// and draws the tick in 180 ms.
public struct PhoneTaskBox: View {
    let status: String
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(status: String) { self.status = status }

    public var body: some View {
        let done = status == "done"
        let canceled = status == "canceled"
        ZStack {
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular)
                .fill(done ? C(FoleviTokens.Chrome.heading, scheme) : canceled ? C(FoleviTokens.Chrome.surfaceSunken, scheme) : .clear)
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular)
                .strokeBorder(done ? .clear : canceled ? C(FoleviTokens.Chrome.lineStrong, scheme) : inkMix(0.34, scheme), lineWidth: 1.5)
            if canceled {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(C(FoleviTokens.Chrome.inkFaint, scheme)).frame(width: 10, height: 1.5)
            } else {
                TickShape()
                    .trim(from: 0, to: done ? 1 : 0)
                    .stroke(C(FoleviTokens.Chrome.canvas, scheme), style: StrokeStyle(lineWidth: 2.3, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: 22, height: 22)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: status)
        .accessibilityHidden(true)
    }

    /// `M6.4 11.6 9.6 14.7 15.8 7.9` on the 22 pt box.
    struct TickShape: Shape {
        func path(in rect: CGRect) -> Path {
            let s = rect.width / 22
            var p = Path()
            p.move(to: CGPoint(x: 6.4 * s, y: 11.6 * s))
            p.addLine(to: CGPoint(x: 9.6 * s, y: 14.7 * s))
            p.addLine(to: CGPoint(x: 15.8 * s, y: 7.9 * s))
            return p
        }
    }
}

/// TaskLine: a task as a row: its box, its words, and a quieter line with when it's due and what else it carries.
public struct PhoneTaskLine: View {
    let task: TaskRow
    let today: String
    /// The note's name in the second line (Upcoming, the agenda).
    let showNote: Bool
    /// Listed under its day (Today, Upcoming, the agenda): only its time, and its date only when overdue.
    let onDay: Bool
    let toggle: () -> Void
    let open: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(task: TaskRow, today: String, showNote: Bool = false, onDay: Bool = false, toggle: @escaping () -> Void, open: @escaping () -> Void) {
        self.task = task
        self.today = today
        self.showNote = showNote
        self.onDay = onDay
        self.toggle = toggle
        self.open = open
    }

    /// The second line's facts, as the web joins them.
    static func facts(_ t: TaskRow, today: String, showNote: Bool, onDay: Bool) -> [String] {
        let overdue = t.status == "open" && (t.dueDate.map { $0 < today } ?? false)
        var out: [String] = []
        if let due = t.dueDate, !onDay || overdue {
            out.append("\(overdue ? "Overdue · " : "")\(TaskDates.dueLabel(due, today: today))\(t.dueTime.map { " \($0)" } ?? "")")
        } else if onDay, let time = t.dueTime {
            out.append(time)
        }
        if showNote { out.append(t.noteTitle.isEmpty ? "Untitled" : t.noteTitle) }
        if let a = t.assigneeName, !a.isEmpty { out.append(a) }
        if let p = t.priority, p != "none", let first = p.first { out.append("\(first.uppercased())\(p.dropFirst()) priority") }
        return out
    }

    public var body: some View {
        let overdue = task.status == "open" && (task.dueDate.map { $0 < today } ?? false)
        let closed = task.status != "open"
        let facts = Self.facts(task, today: today, showNote: showNote, onDay: onDay)
        let twoLines = !facts.isEmpty || task.repeat != nil
        HStack(alignment: .top, spacing: 12) {
            Button(action: toggle) {
                PhoneTaskBox(status: task.status).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, -11)
            .padding(.top, twoLines ? 0 : 4)
            .accessibilityLabel(task.status == "done" ? "Mark “\(task.title)” as not done" : task.status == "canceled" ? "Reopen canceled task “\(task.title)”" : "Mark “\(task.title)” as done")
            .accessibilityAddTraits(task.status == "done" ? .isSelected : [])
            Button(action: open) {
                VStack(alignment: .leading, spacing: 0) {
                    // (On exact CSS line boxes; a closed task's words struck through, on one line.)
                    if closed {
                        let title = task.title.isEmpty ? "Untitled task" : task.title
                        Text(title)
                            .webText(PhoneType.body())
                            .lineLimit(1)
                            .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                            .overlay(alignment: .topLeading) { Strike(text: title, color: inkMix(0.30, scheme)) }
                    } else {
                        WebFittedLines(task.title.isEmpty ? "Untitled task" : task.title, style: PhoneType.body(), maxLines: 12)
                            .foregroundStyle(C(FoleviTokens.Chrome.ink, scheme))
                    }
                    if twoLines {
                        HStack(spacing: 4) {
                            if task.repeat != nil {
                                WebIconView(.repeat, size: 13, strokeWidth: 2.2)
                            }
                            Text(facts.joined(separator: " · "))
                                .webText(PhoneType.subheadline(leading: 20))
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                        .foregroundStyle(C(overdue ? FoleviTokens.Chrome.destructive : FoleviTokens.Chrome.inkMuted, scheme))
                        .padding(.top, 2)
                    }
                }
                .padding(.vertical, twoLines ? 10 : 15)
                .frame(maxWidth: .infinity, minHeight: twoLines ? 64 : 52, alignment: .leading)
                .contentShape(Rectangle())
                .overlay(alignment: .bottom) { PhoneRowHairlineView() }
            }
            .buttonStyle(.plain)
            .padding(.leading, -11)
        }
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .animation(.easeOut(duration: 0.25), value: closed)
    }
}

/// `line-through` in the ink at 30%: the font's own strikeout line across the words, on the CSS line box.
private struct Strike: View {
    let text: String
    let color: Color

    var body: some View {
        let style = PhoneType.body()
        let font = style.ctFont
        let ascent = CTFontGetAscent(font), descent = CTFontGetDescent(font)
        let baseline = (style.leading - ascent - descent) / 2 + ascent
        let thickness = max(1, CTFontGetUnderlineThickness(font))
        let width = PhoneTaskChips.textWidth(text, style)
        Rectangle().fill(color)
            .frame(width: width, height: thickness)
            .offset(y: baseline - CTFontGetXHeight(font) / 2 - thickness / 2)
            .allowsHitTesting(false)
    }
}

// MARK: Group headers

/// GroupHeader: the note's name (a link to it) or the day, and a chevron that folds the group (it turns as it
/// folds; a folded group shows how many tasks it holds).
struct PhoneTaskGroupHeader: View {
    let label: String
    let detail: String?
    /// The note's link; nil for a day.
    let open: (() -> Void)?
    let count: Int?
    let folded: Bool
    let fold: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 0) {
            if let open {
                Button(action: open) {
                    HStack(spacing: 6) {
                        WebIconView(.fileText, size: 17, strokeWidth: 2).foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                        PhoneDayTitle(name: label, detail: detail)
                        WebIconView(.chevronRight, size: 15, strokeWidth: 2.4).foregroundStyle(C(FoleviTokens.Chrome.inkFaint, scheme))
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PhoneDimPressStyle())
                .accessibilityLabel("Open \(label)")
            } else {
                PhoneDayTitle(name: label, detail: detail)
            }
            Spacer(minLength: 0)
            if let count {
                Text("\(count)").webText(PhoneType.subheadline(leading: 20)).monospacedDigit()
                    .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                    .padding(.trailing, 2)
            }
            Button(action: fold) {
                WebIconView(.chevronDown, size: 18, strokeWidth: 2.4)
                    .rotationEffect(.degrees(folded ? -90 : 0))
                    .foregroundStyle(C(FoleviTokens.Chrome.inkFaint, scheme))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(folded ? "Show \(label)" : "Fold \(label)")
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .frame(minHeight: 44)
        .animation(.easeOut(duration: 0.2), value: folded)
    }
}

/// A day's or note's title: the name in the heading's weight, its date muted beside it (`text-body leading-[22px]`).
struct PhoneDayTitle: View {
    let name: String
    let detail: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 0) {
            Text(name).webText(PhoneType.body(weight: FoleviTokens.FontWeight.semibold))
                .foregroundStyle(C(FoleviTokens.Chrome.heading, scheme))
            if let detail {
                Text(" · \(detail)").webText(PhoneType.body())
                    .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
            }
        }
        .lineLimit(1)
        .truncationMode(.tail)
    }
}

/// `active:opacity-60`.
struct PhoneDimPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
    }
}

// MARK: The views' capsules

/// The views as a row of capsules: 44 pt links around 34 pt capsules, 8 apart, 16 in, 6 under the title.
struct PhoneTaskChips: View {
    let current: TaskViewName
    let count: (TaskViewName) -> Int?
    let select: (TaskViewName) -> Void
    @Environment(\.colorScheme) private var scheme

    static func icon(_ v: TaskViewName) -> WebIcon {
        switch v {
        case .today: .sunMedium
        case .inbox: .inbox
        case .upcoming: .calendarDays
        case .all: .listTodo
        case .mine: .userRound
        case .completed: .circleCheckBig
        }
    }

    static func textWidth(_ s: String, _ style: WebTextStyle) -> CGFloat {
        let attrs: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): style.ctFont, NSAttributedString.Key(kCTKernAttributeName as String): style.letterSpacing]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
        return ceil(CTLineGetTypographicBounds(line, nil, nil, nil) * 64) / 64
    }

    /// Where the row sits scrolled: the chosen capsule kept in sight 16 in from the edge (Tasks.tsx's effect).
    private func offset(_ v: TaskViewName) -> CGFloat? {
        guard width > 0, let f = frames[v] else { return nil }
        return min(max(0, contentWidth - width), max(0, f.maxX + 16 - width))
    }

    @State private var frames: [TaskViewName: CGRect] = [:]
    @State private var contentWidth: CGFloat = 0
    @State private var position = ScrollPosition(edge: .leading)
    @State private var width: CGFloat = 0

    var body: some View {
        ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(TaskViewChip.all) { chip in
                        let on = chip.id == current
                        let n = chip.id == .completed ? nil : count(chip.id)
                        Button { select(chip.id) } label: {
                            HStack(spacing: 6) {
                                WebIconView(Self.icon(chip.id), size: 17, strokeWidth: 2)
                                    .foregroundStyle(on ? C(FoleviTokens.Chrome.canvas, scheme) : C(FoleviTokens.Chrome.inkMuted, scheme))
                                Text(chip.short)
                                if let n, n > 0 {
                                    Text("\(n)").monospacedDigit()
                                        .foregroundStyle(on ? C(FoleviTokens.Chrome.canvas, scheme).opacity(0.7) : C(FoleviTokens.Chrome.inkMuted, scheme))
                                }
                            }
                            .webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 20, weight: FoleviTokens.FontWeight.medium))
                            .lineLimit(1)
                            .foregroundStyle(on ? C(FoleviTokens.Chrome.canvas, scheme) : C(FoleviTokens.Chrome.ink, scheme))
                            .padding(.leading, 12)
                            .padding(.trailing, 14)
                            .padding(.vertical, 4)
                            .frame(minHeight: 34)
                            .background(Capsule().fill(on ? C(FoleviTokens.Chrome.heading, scheme) : inkMix(0.065, scheme)))
                            .frame(height: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PhoneChipPressStyle())
                        .id(chip.id)
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("chips")) } action: { frames[chip.id] = $0 }
                        .accessibilityLabel(n.map { "\(chip.title), \($0)" } ?? chip.title)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .coordinateSpace(name: "chips")
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
            }
            .scrollIndicators(.hidden)
            .scrollPosition($position)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            // (Placed again as the counts arrive and widen the capsules.)
            .onChange(of: [width, contentWidth] + TaskViewChip.all.map { frames[$0.id]?.maxX ?? 0 }) { _, _ in
                if let x = offset(current) { position.scrollTo(x: x) }
            }
            .onChange(of: current) { _, v in
                if let x = offset(v) { withAnimation(.easeOut(duration: 0.2)) { position.scrollTo(x: x) } }
            }
    }
}

/// `group-active:scale-[0.96]`.
struct PhoneChipPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.2), value: configuration.isPressed)
    }
}

// MARK: The screen's content

/// What Tasks asks the frame for.
public struct PhoneTasksActions {
    /// A view's capsule: the frame replaces the route (`/tasks/<view>`).
    public var select: (TaskViewName) -> Void
    /// A group's note.
    public var openNote: (String) -> Void

    public init(select: @escaping (TaskViewName) -> Void, openNote: @escaping (String) -> Void) {
        self.select = select
        self.openNote = openNote
    }
}

/// The capsules and the filter, under the large title.
public struct PhoneTasksHeader: View {
    @Bindable var model: TasksModel
    let actions: PhoneTasksActions

    public init(model: TasksModel, actions: PhoneTasksActions) {
        self.model = model
        self.actions = actions
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PhoneTaskChips(current: model.view, count: { model.count(for: $0) }) { v in
                guard v != model.view else { return }
                model.feedback.haptic(.selection)
                actions.select(v)
            }
            PhoneSearchField("Filter by task or note", text: $model.filter)
        }
    }
}

/// The groups of tasks, the loading rows, or the empty screen.
public struct PhoneTasksContent: View {
    let model: TasksModel
    let actions: PhoneTasksActions
    @State private var swipe = PhoneSwipeState()
    @Environment(\.colorScheme) private var scheme

    public init(model: TasksModel, actions: PhoneTasksActions) {
        self.model = model
        self.actions = actions
    }

    public var body: some View {
        let today = model.today
        if model.isLoading {
            VStack(spacing: 0) {
                ForEach(0..<5, id: \.self) { i in
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(C(FoleviTokens.Chrome.surfaceSunken, scheme)).frame(width: 22, height: 22)
                        GeometryReader { g in
                            RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(C(FoleviTokens.Chrome.surfaceSunken, scheme))
                                .frame(width: g.size.width * CGFloat(80 - i * 9) / 100, height: 16)
                                .frame(maxHeight: .infinity)
                        }
                    }
                    .padding(.leading, 20)
                    .padding(.trailing, 16)
                    .frame(height: 52)
                }
            }
            .padding(.top, 12)
            .accessibilityLabel("Loading tasks")
        } else if model.isEmpty {
            let empty = model.emptyText
            PhoneScreenEmpty(icon: model.view == .today && model.filter.isEmpty ? .sun : .circleCheckBig, title: empty.title, message: empty.message)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(model.sections) { section in
                    VStack(alignment: .leading, spacing: 0) {
                        PhoneTaskGroupHeader(
                            label: section.title,
                            detail: section.detail,
                            open: section.kind == .note ? { actions.openNote(section.id) } : nil,
                            count: section.folded ? section.count : nil,
                            folded: section.folded,
                            fold: { withAnimation(.easeOut(duration: 0.2)) { model.toggleFold(section.id) } }
                        )
                        ForEach(section.tasks, id: \.id) { t in
                            row(t, today: today)
                        }
                    }
                    .padding(.top, 16)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(section.detail.map { "\(section.title), \($0)" } ?? section.title)
                }
            }
        }
    }

    private func row(_ t: TaskRow, today: String) -> some View {
        let open = t.status == "open"
        let leading = [open
            ? PhoneSwipeAction("Done", icon: .check, tone: RGBA(63, 125, 88)) { model.toggle(t) }
            : PhoneSwipeAction("Reopen", icon: .rotateCcw, tone: RGBA(107, 107, 115)) { model.toggle(t) }]
        let trailing = open ? [
            PhoneSwipeAction("Tomorrow", icon: .sunMedium, tone: RGBA(197, 138, 18)) { Task { await model.moveToTomorrow(t) } },
            PhoneSwipeAction("Date", icon: .calendarClock, tone: RGBA(91, 106, 208)) { model.open(t) },
        ] : []
        return PhoneSwipeRow(id: t.id, leading: leading, trailing: trailing, state: swipe) {
            PhoneTaskLine(task: t, today: today, showNote: model.view == .upcoming, onDay: model.view == .today || model.view == .upcoming, toggle: { model.toggle(t) }, open: { model.open(t) })
        }
    }
}
#endif
