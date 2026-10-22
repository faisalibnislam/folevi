// What Folevi's widgets draw (Widgets/FoleviWidgets.swift has the widgets themselves): Today, Recent notes,
// Quick add and the Lock Screen's. Compiled into the app too, so a Debug build can draw them outside the
// Home Screen (DebugHooks' "widgets"): each view takes the family from WidgetKit, or one it's given.
import AppIntents
import SwiftUI
import WidgetKit

struct TodayView: View {
    let entry: FoleviEntry
    /// The family to draw: WidgetKit's, or the one the Debug harness gives.
    var family: WidgetFamily?
    @Environment(\.widgetFamily) private var widgetFamily
    private var size: WidgetFamily { family ?? widgetFamily }

    private var tasks: [TaskItem] { entry.snapshot.openTasks }
    private var today: String { DayFormat.string(entry.date) }
    private var roomy: Bool { size == .systemLarge || size == .systemExtraLarge }

    private var rows: Int {
        switch size {
        case .systemSmall: return 3
        case .systemMedium: return 3
        case .systemLarge: return 7
        default: return 10
        }
    }

    var body: some View {
        Group {
            if entry.snapshot.state == .signedOut {
                SignedOutView(compact: size == .systemSmall)
            } else if roomy {
                TodayLargeView(entry: entry, extraLarge: size == .systemExtraLarge)
            } else {
                VStack(alignment: .leading, spacing: size == .systemSmall ? 6 : 8) {
                    header
                    if tasks.isEmpty {
                        Spacer(minLength: 0)
                        empty
                        Spacer(minLength: 0)
                    } else {
                        RowColumns(items: Array(tasks.prefix(rows)), spacing: size == .systemSmall ? 5 : 8) { task in
                            TaskRow(task: task, today: today, style: RowStyle(size))
                        }
                        Spacer(minLength: 0)
                        if tasks.count > rows {
                            Text("\(tasks.count - rows) more")
                                .font(Typeface.meta)
                                .foregroundStyle(Palette.faint)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .widgetURL(DeepLink.todayURL)
        .foleviBackground()
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Today")
                .font(Typeface.title(size == .systemSmall ? 17 : 19))
                .foregroundStyle(Palette.heading)
            Spacer(minLength: 4)
            if !tasks.isEmpty {
                Text("\(tasks.count)")
                    .font(Typeface.meta.monospacedDigit())
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(Palette.faint)
            Text("Nothing due today")
                .font(Typeface.row)
                .foregroundStyle(Palette.muted)
        }
    }
}

/// Today in the large widgets: the date under the title, what's overdue in a group of its own, today's
/// tasks, and, when that leaves room, tomorrow's and a row that opens Quick add. On the iPad's extra large
/// widget, tomorrow and Add task take the second column.
struct TodayLargeView: View {
    let entry: FoleviEntry
    var extraLarge = false

    private var snapshot: WidgetSnapshot { entry.snapshot }
    private var today: String { DayFormat.string(entry.date) }

    /// Rows a column holds (a group's label counts as half of one, Add task as one).
    private var capacity: Double { extraLarge ? 6.5 : 7 }

    private struct Group: Identifiable {
        let id: String
        let title: String?
        var tasks: [TaskItem]
        var danger = false
        var cost: Double { Double(tasks.count) + (title == nil ? 0 : 0.6) }
    }

    /// The groups in each column, and whether Add task fits under them.
    private var layout: (columns: [[Group]], more: Int, add: Bool) {
        let overdue = snapshot.overdueTasks
        let due = snapshot.todayTasks
        let tomorrow = snapshot.tomorrowTasks
        var first: [Group] = []
        var room = capacity
        var hidden = 0
        func take(_ group: Group, into column: inout [Group], room: inout Double) {
            guard !group.tasks.isEmpty else { return }
            let label = group.title == nil ? 0 : 0.6
            let fit = max(0, Int((room - label).rounded(.down)))
            guard fit > 0 else {
                hidden += group.tasks.count
                return
            }
            var g = group
            g.tasks = Array(group.tasks.prefix(fit))
            hidden += group.tasks.count - g.tasks.count
            column.append(g)
            room -= g.cost
        }
        take(Group(id: "overdue", title: "Overdue", tasks: overdue, danger: true), into: &first, room: &room)
        // Today's own label only when something else is labelled above or beside it.
        take(Group(id: "today", title: overdue.isEmpty ? nil : "Today", tasks: due), into: &first, room: &room)
        let todayHidden = hidden
        if extraLarge {
            var second: [Group] = []
            var room2 = capacity
            take(Group(id: "tomorrow", title: "Tomorrow", tasks: tomorrow), into: &second, room: &room2)
            return ([first, second], todayHidden, room2 >= 1)
        }
        // Tomorrow only fills room that today left, and never pushes today's out.
        if todayHidden == 0 && room >= 2.6 {
            take(Group(id: "tomorrow", title: "Tomorrow", tasks: tomorrow), into: &first, room: &room)
        }
        return ([first], todayHidden, todayHidden == 0 && room >= 1)
    }

    var body: some View {
        let layout = layout
        VStack(alignment: .leading, spacing: 10) {
            header
            if snapshot.openTasks.isEmpty {
                Label("Nothing due today", systemImage: "checkmark.circle")
                    .font(Typeface.row)
                    .foregroundStyle(Palette.muted)
                    .labelStyle(QuietLabel())
            }
            HStack(alignment: .top, spacing: 20) {
                ForEach(Array(layout.columns.enumerated()), id: \.offset) { index, groups in
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(groups) { group in
                            VStack(alignment: .leading, spacing: 7) {
                                if let title = group.title {
                                    Text(title)
                                        .font(Typeface.meta.weight(.semibold))
                                        .foregroundStyle(group.danger ? Palette.danger : Palette.muted)
                                        .textCase(nil)
                                }
                                ForEach(group.tasks) { task in
                                    TaskRow(task: task, today: today, style: .stacked, inGroup: group.title != nil)
                                }
                            }
                        }
                        if index == layout.columns.count - 1 {
                            if layout.more > 0 && index == 0 {
                                Text("\(layout.more) more")
                                    .font(Typeface.meta)
                                    .foregroundStyle(Palette.faint)
                            }
                            if layout.add { AddTaskRow() }
                        } else if layout.more > 0 {
                            Text("\(layout.more) more")
                                .font(Typeface.meta)
                                .foregroundStyle(Palette.faint)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Today")
                    .font(Typeface.title(19))
                    .foregroundStyle(Palette.heading)
                Text(entry.date.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                    .font(Typeface.meta)
                    .foregroundStyle(Palette.muted)
            }
            Spacer(minLength: 4)
            if !snapshot.openTasks.isEmpty {
                Text("\(snapshot.openTasks.count)")
                    .font(Typeface.meta.monospacedDigit())
                    .foregroundStyle(Palette.muted)
            }
        }
    }
}

/// "+ Add task": opens Quick add task.
struct AddTaskRow: View {
    var body: some View {
        Link(destination: DeepLink.quickAddURL) {
            HStack(spacing: 8) {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 15)
                Text("Add task")
                    .font(Typeface.row)
            }
            .foregroundStyle(Palette.muted)
        }
        .accessibilityLabel("Add a task")
    }
}

/// An icon and text a little apart, both quiet.
struct QuietLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.icon.foregroundStyle(Palette.faint)
            configuration.title
        }
    }
}

struct TaskRow: View {
    let task: TaskItem
    let today: String
    var style = RowStyle.stacked
    /// Under a group's label (Overdue, Tomorrow): the day alone, without saying "Overdue" again.
    var inGroup = false

    private var overdue: Bool { (task.dueDate ?? today) < today }
    private var compact: Bool { style == .compact }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Button(intent: ToggleTaskIntent(taskId: task.id)) {
                Image(systemName: "circle")
                    .font(.system(size: compact ? 14 : 15, weight: .regular))
                    .foregroundStyle(task.priority == "high" ? Palette.heading : Palette.faint)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Check off \(task.text)")
            Link(destination: DeepLink.forNote(task.note.id) ?? DeepLink.todayURL) {
                RowText(style: style) {
                    Text(task.text)
                        .font(compact ? Typeface.rowSmall : Typeface.row)
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                } meta: {
                    // Under Tomorrow the day goes without saying: only a time.
                    if let due = inGroup && (task.dueDate ?? today) > today ? task.dueTime : DueLabel.text(for: task.dueDate, time: task.dueTime, today: today) {
                        Text(overdue && !inGroup ? "Overdue · \(due)" : due)
                            .font(Typeface.meta)
                            .foregroundStyle(overdue ? Palette.danger : Palette.muted)
                            .lineLimit(1)
                    }
                }
            }
        }
    }
}

struct RecentNotesView: View {
    let entry: FoleviEntry
    /// The family to draw: WidgetKit's, or the one the Debug harness gives.
    var family: WidgetFamily?
    @Environment(\.widgetFamily) private var widgetFamily
    private var size: WidgetFamily { family ?? widgetFamily }

    private var rows: Int {
        switch size {
        case .systemSmall: return 3
        case .systemMedium: return 4
        case .systemLarge: return 7
        default: return 10
        }
    }

    var body: some View {
        Group {
            if entry.snapshot.state == .signedOut {
                SignedOutView(compact: size == .systemSmall)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Recent notes")
                        .font(Typeface.title(size == .systemSmall ? 16 : 19))
                        .foregroundStyle(Palette.heading)
                        .lineLimit(1)
                    if entry.snapshot.notes.isEmpty {
                        Spacer(minLength: 0)
                        Text("No notes yet")
                            .font(Typeface.row)
                            .foregroundStyle(Palette.muted)
                        Spacer(minLength: 0)
                    } else {
                        RowColumns(items: Array(entry.snapshot.notes.prefix(rows)), columns: size == .systemExtraLarge && entry.snapshot.notes.count > 5 ? 2 : 1, spacing: size == .systemSmall ? 6 : 8) { note in
                            Link(destination: DeepLink.forNote(note.id) ?? URL(string: "folevi://documents")!) {
                                NoteRow(note: note, style: RowStyle(size))
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .widgetURL(entry.snapshot.notes.first.flatMap { DeepLink.forNote($0.id) } ?? URL(string: "folevi://documents")!)
        .foleviBackground()
    }
}

struct NoteRow: View {
    let note: NoteSummary
    var style = RowStyle.stacked

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "doc.text")
                .font(.system(size: style == .compact ? 11 : 12))
                .foregroundStyle(Palette.faint)
            RowText(style: style) {
                Text(note.title)
                    .font(style == .compact ? Typeface.rowSmall : Typeface.row)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
            } meta: {
                Text(style == .inline ? when : "\(note.place.name) · \(when)")
                    .font(Typeface.meta)
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
            }
        }
    }

    private var when: String {
        DayFormat.instant(note.updatedAt).map { $0.formatted(.relative(presentation: .named)) } ?? ""
    }
}

/// How a row lays out its text and its line under it (a task's due day, a note's place and time): one line
/// and no more in a small widget, the line at the end of the row in a medium one, under it in larger ones.
/// One line of text each, so a widget never runs out of room whatever the titles are.
enum RowStyle {
    case compact
    case inline
    case stacked

    init(_ family: WidgetFamily) {
        switch family {
        case .systemSmall: self = .compact
        case .systemMedium: self = .inline
        default: self = .stacked
        }
    }
}

struct RowText<Title: View, Meta: View>: View {
    let style: RowStyle
    @ViewBuilder let title: Title
    @ViewBuilder let meta: Meta

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            switch style {
            case .compact:
                title
                Spacer(minLength: 0)
            case .inline:
                title
                Spacer(minLength: 8)
                meta.layoutPriority(1)
            case .stacked:
                VStack(alignment: .leading, spacing: 1) {
                    title
                    meta
                }
                Spacer(minLength: 0)
            }
        }
    }
}

/// Rows in one column, or side by side in two (the iPad's extra large widgets, past five rows), filled
/// down first.
struct RowColumns<Item: Identifiable, Row: View>: View {
    let items: [Item]
    var columns = 1
    var spacing: CGFloat = 8
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        let perColumn = max(1, Int((Double(items.count) / Double(columns)).rounded(.up)))
        HStack(alignment: .top, spacing: 20) {
            ForEach(0 ..< columns, id: \.self) { c in
                VStack(alignment: .leading, spacing: spacing) {
                    ForEach(items.dropFirst(c * perColumn).prefix(perColumn)) { row($0) }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
    }
}

struct QuickAddView: View {
    let entry: FoleviEntry
    /// With several places on this device: where it adds to (named under the button; the app opens there).
    var place: SaveTarget? = nil

    var body: some View {
        VStack(alignment: .leading) {
            WidgetMark()
            Spacer(minLength: 0)
            ZStack {
                Circle().fill(Palette.accent)
                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Palette.accentInk)
            }
            .frame(width: 44, height: 44)
            Text("Quick add")
                .font(Typeface.title(17))
                .foregroundStyle(Palette.heading)
                .padding(.top, 6)
            if let place {
                Text(place.name)
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(DeepLink.inPlace(DeepLink.quickAddURL, place?.id))
        .foleviBackground()
    }
}

struct LockScreenView: View {
    let entry: FoleviEntry
    /// The family to draw: WidgetKit's, or the one the Debug harness gives.
    var family: WidgetFamily?
    @Environment(\.widgetFamily) private var widgetFamily
    private var size: WidgetFamily { family ?? widgetFamily }

    private var tasks: [TaskItem] { entry.snapshot.openTasks }
    private var signedOut: Bool { entry.snapshot.state == .signedOut }

    var body: some View {
        content
            .widgetURL(DeepLink.todayURL)
            .containerBackground(for: .widget) { Color.clear }
    }

    @ViewBuilder
    private var content: some View {
        switch size {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text(signedOut ? "–" : "\(tasks.count)")
                        .font(.system(size: 22, weight: .semibold, design: .rounded).monospacedDigit())
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 10, weight: .semibold))
                }
            }
            .accessibilityLabel(signedOut ? SignedOutView.prompt : "\(tasks.count) tasks today")
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(signedOut ? "Folevi" : (tasks.isEmpty ? "Today" : "Next"))
                    .font(.system(size: 13, weight: .semibold))
                    .widgetAccentable()
                if signedOut {
                    Text(SignedOutView.prompt).font(.system(size: 13)).lineLimit(2)
                } else if let next = tasks.first {
                    Text(next.text).font(.system(size: 13)).lineLimit(2)
                    if let due = DueLabel.text(for: next.dueDate, time: next.dueTime, today: DayFormat.string(entry.date)) {
                        Text(due).font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                } else {
                    Text("Nothing due today").font(.system(size: 13))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            if signedOut {
                Text(SignedOutView.prompt)
            } else if tasks.isEmpty {
                Text("Nothing due today")
            } else {
                Label(tasks.count == 1 ? "1 task today" : "\(tasks.count) tasks today", systemImage: "checkmark.circle")
            }
        }
    }
}
