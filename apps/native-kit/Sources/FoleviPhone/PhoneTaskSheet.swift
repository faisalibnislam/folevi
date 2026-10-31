// A task's details on the iPhone, as the web's sheet draws them (apps/web/src/components/iphone/TaskSheet.tsx,
// Reminders' details in Folevi's look): the task with its box, its status as a segmented control, its date and time
// (iOS's own pickers, as the web asks the app for them), the days people pick most a tap away, priority and assignee
// as menus, how it repeats, and the note it lives in. Every change is saved as it's made; the sheet closes with its
// button or a drag down. Tasks and Calendar both open it (TaskSheetHost).
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

private func C(_ pair: ColorPair, _ scheme: ColorScheme) -> Color { pair.resolve(scheme).color }

public struct PhoneTaskSheet: View {
    let host: any TaskSheetHost
    let initial: TaskRow
    let close: () -> Void
    let openNote: (TaskRow) -> Void
    @State private var picking: Picking?
    @Environment(\.colorScheme) private var scheme

    enum Picking { case date, time }

    public init(host: any TaskSheetHost, task: TaskRow, close: @escaping () -> Void, openNote: @escaping (TaskRow) -> Void) {
        self.host = host
        self.initial = task
        self.close = close
        self.openNote = openNote
    }

    /// The task as it is now: the engine's latest row with this sheet's changes over it.
    private var task: TaskRow { host.edits.shown(host.latest(initial.id) ?? initial) }

    public var body: some View {
        PhoneSheetPanel(title: "Task", close: close) {
            content.padding(.bottom, 12)
        }
    }

    private var content: some View {
        let t = task
        let today = host.today
        return VStack(alignment: .leading, spacing: 20) {
            // The task itself, with its box (it checks off from here too).
            HStack(alignment: .top, spacing: 12) {
                Button { setStatus(t.status == "open" ? "done" : "open") } label: {
                    PhoneTaskBox(status: t.status).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.leading, -11)
                .padding(.top, -11)
                .accessibilityLabel(t.status == "done" ? "Mark as not done" : "Mark as done")
                Text(t.title.isEmpty ? "Untitled task" : t.title)
                    .webText(PhoneType.body(weight: FoleviTokens.FontWeight.medium))
                    .foregroundStyle(C(t.status == "open" ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.inkMuted, scheme))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, -11)
            }
            .padding(.horizontal, 4)

            PhoneCapsuleSegmented(label: "Status", value: t.status, options: [("open", "Open"), ("done", "Done"), ("canceled", "Canceled")]) { setStatus($0) }
                .disabled(!host.canEdit)

            PhoneSheetGroup {
                let overdue = t.status == "open" && (t.dueDate.map { $0 < today } ?? false)
                PhoneSheetRow(icon: .calendarDays, label: "Date", value: t.dueDate.map { whenLabel($0, today: today) } ?? "None", danger: overdue) {
                    withAnimation(.easeOut(duration: 0.2)) { picking = picking == .date ? nil : .date }
                }
                if picking == .date { datePicker(t, today: today) }
                if t.dueDate != nil {
                    PhoneSheetRow(icon: .clock, label: "Time", value: t.dueTime ?? "All day") {
                        withAnimation(.easeOut(duration: 0.2)) { picking = picking == .time ? nil : .time }
                    }
                    if picking == .time { timePicker(t, today: today) }
                }
                quickDates(t, today: today)
            }
            .disabled(!host.canEdit)

            PhoneSheetGroup {
                priorityRow(t)
                if host.inWorkspace || t.assigneeId != nil { assigneeRow(t) }
                if let r = t.repeat {
                    PhoneSheetRow(icon: .repeat, label: "Repeats", value: r, chevron: nil)
                }
            }
            .disabled(!host.canEdit)

            PhoneSheetGroup {
                Button {
                    close()
                    openNote(t)
                } label: {
                    HStack(spacing: 12) {
                        PhoneSheetRowIcon(.fileText)
                        VStack(alignment: .leading, spacing: 0) {
                            Text("In the note").webText(WebTextStyle(size: WebTypeRole.footnote.metrics.size, leading: 18))
                                .foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme))
                            Text(t.noteTitle.isEmpty ? "Untitled" : t.noteTitle).webText(PhoneType.body()).lineLimit(1)
                                .foregroundStyle(C(FoleviTokens.Chrome.ink, scheme))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        PhoneSheetChevron(turned: false)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 52)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PhoneRowPressStyle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }

    /// "Today, Sat Oct 31", "Mon, Nov 2", with the year when it isn't this one (TaskSheet.tsx whenLabel).
    private func whenLabel(_ day: String, today: String) -> String {
        let full = TaskDates.format(day, day.prefix(4) == today.prefix(4) ? "EEEMMMd" : "EEEyMMMd")
        let near = TaskDates.dueLabel(day, today: today)
        return near == "Today" || near == "Tomorrow" || near == "Yesterday" ? "\(near), \(full)" : full
    }

    private func datePicker(_ t: TaskRow, today: String) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            DatePicker("Due date", selection: Binding(
                get: { TaskDates.pickerDate(day: t.dueDate ?? today, time: nil, timeZone: host.timeZone) },
                set: { d in
                    let day = TaskDates.fromPicker(d, timeZone: host.timeZone).day
                    if day != t.dueDate { save(TaskPatchArgs(id: t.id, dueDate: .set(day))) }
                }
            ), displayedComponents: .date)
            .datePickerStyle(.graphical)
            .environment(\.timeZone, host.timeZone)
            .labelsHidden()
            .tint(C(FoleviTokens.Chrome.heading, scheme))
            if t.dueDate != nil {
                Button("Remove date") {
                    save(TaskPatchArgs(id: t.id, dueDate: .clear, dueTime: .clear))
                    picking = nil
                }
                .webText(PhoneType.body())
                .foregroundStyle(C(FoleviTokens.Chrome.destructive, scheme))
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 8)
    }

    private func timePicker(_ t: TaskRow, today: String) -> some View {
        HStack {
            DatePicker("Time", selection: Binding(
                get: { TaskDates.pickerDate(day: t.dueDate ?? today, time: t.dueTime ?? "09:00", timeZone: host.timeZone) },
                set: { d in
                    let time = TaskDates.fromPicker(d, timeZone: host.timeZone).time
                    if time != t.dueTime { save(TaskPatchArgs(id: t.id, dueTime: .set(time))) }
                }
            ), displayedComponents: .hourAndMinute)
            .datePickerStyle(.wheel)
            .environment(\.timeZone, host.timeZone)
            .labelsHidden()
            .frame(maxWidth: .infinity)
            if t.dueTime != nil {
                Button("All day") {
                    save(TaskPatchArgs(id: t.id, dueTime: .clear))
                    picking = nil
                }
                .webText(PhoneType.body())
                .foregroundStyle(C(FoleviTokens.Chrome.heading, scheme))
                .padding(.trailing, 16)
            }
        }
    }

    /// The days people pick most, a tap away (the picker has the rest).
    private func quickDates(_ t: TaskRow, today: String) -> some View {
        let days = [("Today", today), ("Tomorrow", TaskDates.add(today, days: 1)), ("Next week", TaskDates.nextWeek(today))]
        return HStack(spacing: 8) {
            ForEach(days, id: \.0) { label, day in
                let on = t.dueDate == day
                Button {
                    host.edits.feedback.haptic(.selection)
                    save(TaskPatchArgs(id: t.id, dueDate: .set(day)))
                } label: {
                    Text(label)
                        .webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 20, weight: FoleviTokens.FontWeight.medium))
                        .lineLimit(1)
                        .foregroundStyle(on ? C(FoleviTokens.Chrome.canvas, scheme) : C(FoleviTokens.Chrome.ink, scheme))
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(Capsule().fill(on ? C(FoleviTokens.Chrome.heading, scheme) : inkMix(0.07, scheme)))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    private static let priorities: [(TaskUpdateArgs.Priority, String)] = [(.none, "None"), (.low, "Low"), (.medium, "Medium"), (.high, "High")]

    private func priorityRow(_ t: TaskRow) -> some View {
        let current = TaskUpdateArgs.Priority(rawValue: t.priority ?? "none") ?? .none
        return Menu {
            Picker("Priority", selection: Binding(get: { current }, set: { p in
                guard p != current else { return }
                host.edits.feedback.haptic(.selection)
                save(TaskPatchArgs(id: t.id, priority: p))
            })) {
                ForEach(Self.priorities, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.inline)
        } label: {
            PhoneSheetRowLabel(icon: .flag, label: "Priority", value: Self.priorities.first { $0.0 == current }?.1 ?? "None", chevron: true)
        }
        .menuStyle(.button)
        .buttonStyle(PhoneRowPressStyle())
        .menuIndicator(.hidden)
    }

    private func assigneeRow(_ t: TaskRow) -> some View {
        let people = host.assignees
        let name = t.assigneeId.map { id in people.first { $0.id == id }?.name ?? t.assigneeName ?? "Someone" } ?? "Nobody"
        return Menu {
            Picker("Assignee", selection: Binding(get: { t.assigneeId ?? "" }, set: { id in
                guard id != (t.assigneeId ?? "") else { return }
                host.edits.feedback.haptic(.selection)
                save(TaskPatchArgs(id: t.id, assigneeId: id.isEmpty ? .clear : .set(id)))
            })) {
                Text("Nobody").tag("")
                Divider()
                ForEach(people, id: \.id) { m in Text(m.isYou ? "\(m.name) (you)" : m.name).tag(m.id) }
            }
            .pickerStyle(.inline)
        } label: {
            PhoneSheetRowLabel(icon: .userRound, label: "Assignee", value: name, chevron: true)
        }
        .menuStyle(.button)
        .buttonStyle(PhoneRowPressStyle())
        .menuIndicator(.hidden)
    }

    // MARK: Saving

    private func setStatus(_ status: String) {
        let t = task
        guard status != t.status else { return }
        host.edits.feedback.haptic(status == "done" ? .success : .selection)
        let patch: TaskPatchArgs
        switch status {
        case "canceled": patch = TaskPatchArgs(id: t.id, canceled: true)
        case "done": patch = TaskPatchArgs(id: t.id, checked: true)
        default: patch = t.status == "canceled" ? TaskPatchArgs(id: t.id, canceled: false) : TaskPatchArgs(id: t.id, checked: false)
        }
        save(patch)
    }

    private func save(_ patch: TaskPatchArgs) {
        let t = task
        Task { _ = await host.edits.update(t, patch) }
    }
}

// MARK: The sheet's parts

/// Group: rows on a quiet fill (the ink at 5%) with the container radius, a hairline over every row after the first.
struct PhoneSheetGroup<Content: View>: View {
    let content: Content
    @Environment(\.colorScheme) private var scheme

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content) { rows in
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                    row.overlay(alignment: .top) {
                        if i > 0 { PhoneSurface.separator.resolve(scheme).color.frame(height: 0.5).allowsHitTesting(false) }
                    }
                }
            }
        }
        .background(inkMix(0.05, scheme))
        .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .circular))
    }
}

/// RowIcon: a 24 pt column, the icon at 20 pt with a 2 pt stroke, in the muted ink.
struct PhoneSheetRowIcon: View {
    let icon: WebIcon
    @Environment(\.colorScheme) private var scheme

    init(_ icon: WebIcon) { self.icon = icon }

    var body: some View {
        WebIconView(icon, size: 20, strokeWidth: 2).foregroundStyle(C(FoleviTokens.Chrome.inkMuted, scheme)).frame(width: 24)
    }
}

/// The row's chevron: 15 pt, a 2.4 stroke, faint, 4 into the row's padding (turned down for a menu).
struct PhoneSheetChevron: View {
    let turned: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        WebIconView(.chevronRight, size: 15, strokeWidth: 2.4)
            .rotationEffect(.degrees(turned ? 90 : 0))
            .foregroundStyle(C(FoleviTokens.Chrome.inkFaint, scheme))
            .padding(.trailing, -4)
    }
}

/// ROW: 52 tall at least, 16 in, 12 between: the icon, the label, the value in muted, a chevron.
struct PhoneSheetRowLabel: View {
    let icon: WebIcon
    let label: String
    let value: String
    var danger = false
    /// nil: no chevron; true: turned (a menu).
    var chevron: Bool?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 12) {
            PhoneSheetRowIcon(icon)
            Text(label).webText(PhoneType.body()).lineLimit(1).foregroundStyle(C(FoleviTokens.Chrome.ink, scheme))
                .frame(maxWidth: .infinity, alignment: .leading)
            // (The value keeps its width, up to 55% of the row, as `max-w-[55%] flex-none`.)
            Text(value).webText(PhoneType.body()).lineLimit(1)
                .foregroundStyle(C(danger ? FoleviTokens.Chrome.destructive : FoleviTokens.Chrome.inkMuted, scheme))
                .layoutPriority(1)
            if let chevron { PhoneSheetChevron(turned: chevron) }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

struct PhoneSheetRow: View {
    let icon: WebIcon
    let label: String
    let value: String
    var danger = false
    var chevron: Bool? = false
    var action: (() -> Void)?

    init(icon: WebIcon, label: String, value: String, danger: Bool = false, chevron: Bool? = false, action: (() -> Void)? = nil) {
        self.icon = icon
        self.label = label
        self.value = value
        self.danger = danger
        self.chevron = chevron
        self.action = action
    }

    var body: some View {
        if let action {
            Button(action: action) { PhoneSheetRowLabel(icon: icon, label: label, value: value, danger: danger, chevron: chevron) }
                .buttonStyle(PhoneRowPressStyle())
        } else {
            PhoneSheetRowLabel(icon: icon, label: label, value: value, danger: danger, chevron: chevron)
        }
    }
}

/// Segmented: iOS's segmented control in Folevi's neutrals: a quiet track, the chosen segment a raised
/// canvas-coloured capsule that slides to the one picked.
public struct PhoneCapsuleSegmented: View {
    let label: String
    let value: String
    let options: [(String, String)]
    let change: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(label: String, value: String, options: [(String, String)], change: @escaping (String) -> Void) {
        self.label = label
        self.value = value
        self.options = options
        self.change = change
    }

    public var body: some View {
        let index = max(0, options.firstIndex { $0.0 == value } ?? 0)
        GeometryReader { g in
            let w = (g.size.width - 4) / CGFloat(max(1, options.count))
            ZStack(alignment: .leading) {
                Capsule().fill(inkMix(0.07, scheme))
                Capsule()
                    .fill(C(scheme == .dark ? FoleviTokens.Chrome.surfaceRaised : FoleviTokens.Chrome.canvas, scheme))
                    .shadow(color: .black.opacity(0.12), radius: 4, y: 3)
                    .overlay(Capsule().strokeBorder(.black.opacity(0.04), lineWidth: 0.5))
                    .frame(width: w, height: g.size.height - 4)
                    .offset(x: 2 + CGFloat(index) * w)
                    .animation(reduceMotion ? nil : .timingCurve(0.32, 0.72, 0, 1, duration: 0.3), value: index)
                HStack(spacing: 0) {
                    ForEach(options, id: \.0) { id, title in
                        let on = id == value
                        Button {
                            guard !on else { return }
                            change(id)
                        } label: {
                            Text(title)
                                .webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: WebTypeRole.subheadline.metrics.size * 1.25, weight: on ? FoleviTokens.FontWeight.semibold : FoleviTokens.FontWeight.medium))
                                .lineLimit(1)
                                .foregroundStyle(C(on ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.ink, scheme))
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(2)
            }
        }
        .frame(height: max(36, WebTypeRole.subheadline.metrics.size * 1.25 + 12 + 4))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}
#endif
