// The pieces of the task screens (web iphone/Tasks.tsx): Folevi's rounded-square task box, a task as a row (its
// box, its words and a quieter line with when it's due and what else it carries), a group's header that folds,
// the view chips, and Quick Add's field with the date the engine read.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// The task box at the phone's size (22 pt, a 1.5 pt edge): checking it fills the box and draws the tick.
public struct TaskBox: View {
    let status: String
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    public init(status: String, size: CGFloat = 22) {
        self.status = status
        self.size = size
    }

    public var body: some View {
        let done = status == "done"
        let canceled = status == "canceled"
        ZStack {
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous)
                .fill(done ? Folevi.color.heading : canceled ? Folevi.color.surfaceSunken : Color.clear)
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous)
                .strokeBorder(done ? Color.clear : canceled ? Folevi.color.lineStrong : Folevi.color.ink.opacity(0.34), lineWidth: 1.5)
            if canceled {
                Capsule().fill(Folevi.color.inkFaint).frame(width: size * 0.45, height: 1.5)
            } else {
                TickShape()
                    .trim(from: 0, to: done ? 1 : 0)
                    .stroke(Folevi.color.canvas, style: StrokeStyle(lineWidth: 2.3, lineCap: .round, lineJoin: .round))
                    .frame(width: size, height: size)
            }
        }
        .frame(width: size, height: size)
        .animation(reduceMotion ? nil : .folevi(0.18), value: status)
    }
}

/// The tick inside the box (the web's path "M6.4 11.6 9.6 14.7 15.8 7.9" in a 22 pt box).
struct TickShape: Shape {
    func path(in r: CGRect) -> Path {
        let s = r.width / 22
        var p = Path()
        p.move(to: CGPoint(x: 6.4 * s, y: 11.6 * s))
        p.addLine(to: CGPoint(x: 9.6 * s, y: 14.7 * s))
        p.addLine(to: CGPoint(x: 15.8 * s, y: 7.9 * s))
        return p
    }
}

/// What a task row says under its words: "Overdue · Yesterday", "15:00", the note, the assignee, "High priority".
public enum TaskFacts {
    public static func line(_ t: TaskRow, today: String, showNote: Bool, onDay: Bool) -> String {
        let overdue = t.status == "open" && (t.dueDate.map { $0 < today } ?? false)
        var parts: [String] = []
        if let d = t.dueDate, !onDay || overdue {
            parts.append("\(overdue ? "Overdue · " : "")\(TaskDates.dueLabel(d, today: today))\(t.dueTime.map { " \(TaskDates.timeLabel($0))" } ?? "")")
        } else if onDay, let time = t.dueTime {
            parts.append(TaskDates.timeLabel(time))
        }
        if showNote { parts.append(t.noteTitle.isEmpty ? "Untitled" : t.noteTitle) }
        if let a = t.assigneeName, !a.isEmpty { parts.append(a) }
        if let p = t.priority, p != "none", !p.isEmpty { parts.append("\(p.prefix(1).uppercased())\(p.dropFirst()) priority") }
        return parts.joined(separator: " · ")
    }

    /// What VoiceOver reads for a task.
    public static func accessibility(_ t: TaskRow, today: String) -> String {
        var parts = [t.title.isEmpty ? "Untitled task" : t.title]
        let facts = line(t, today: today, showNote: true, onDay: false)
        if !facts.isEmpty { parts.append(facts) }
        if let r = t.repeat { parts.append("repeats \(r)") }
        if t.status == "done" { parts.append("done") }
        if t.status == "canceled" { parts.append("canceled") }
        return parts.joined(separator: ", ")
    }
}

/// A task as a row: its box (44 pt target), its words, and a quieter second line.
public struct TaskLineView: View {
    let task: TaskRow
    let today: String
    let showNote: Bool
    let onDay: Bool
    let onToggle: () -> Void
    let onOpen: () -> Void

    public init(task: TaskRow, today: String, showNote: Bool = false, onDay: Bool = false, onToggle: @escaping () -> Void, onOpen: @escaping () -> Void) {
        self.task = task
        self.today = today
        self.showNote = showNote
        self.onDay = onDay
        self.onToggle = onToggle
        self.onOpen = onOpen
    }

    public var body: some View {
        let facts = TaskFacts.line(task, today: today, showNote: showNote, onDay: onDay)
        let overdue = task.status == "open" && (task.dueDate.map { $0 < today } ?? false)
        let closed = task.status != "open"
        HStack(alignment: .top, spacing: 2) {
            Button(action: onToggle) {
                TaskBox(status: task.status)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, facts.isEmpty && task.repeat == nil ? 4 : 0)
            .accessibilityLabel(task.status == "done" ? "Mark \(task.title) as not done" : task.status == "canceled" ? "Reopen canceled task \(task.title)" : "Mark \(task.title) as done")
            .accessibilityAddTraits(.isToggle)
            .accessibilityIdentifier("task-box-\(task.id)")

            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title.isEmpty ? "Untitled task" : task.title)
                        .foleviFont(.body)
                        .foregroundStyle(closed ? Folevi.color.inkMuted : Folevi.color.ink)
                        .strikethrough(closed, color: Folevi.color.ink.opacity(0.3))
                        .multilineTextAlignment(.leading)
                    if !facts.isEmpty || task.repeat != nil {
                        HStack(spacing: 4) {
                            if task.repeat != nil {
                                Image(systemName: "repeat").font(.system(size: 11, weight: .semibold))
                            }
                            Text(facts).lineLimit(1)
                        }
                        .foleviFont(.footnote)
                        .foregroundStyle(overdue ? Folevi.color.destructive : Folevi.color.inkMuted)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: facts.isEmpty && task.repeat == nil ? 52 : 60, alignment: .leading)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TaskFacts.accessibility(task, today: today))
            .accessibilityHint("Opens the task's details")
            .accessibilityIdentifier("task-row-\(task.id)")
        }
        .padding(.leading, 9)
        .padding(.trailing, 16)
    }
}

/// A group's header: the note (a link to it) or the day, and a chevron that folds the group.
struct TaskSectionHeader: View {
    let section: TaskSection
    let onOpenNote: (() -> Void)?
    let onFold: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 6) {
            if let onOpenNote, section.kind == .note {
                Button(action: onOpenNote) {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text").font(.system(size: 14, weight: .medium)).foregroundStyle(Folevi.color.inkMuted)
                        title
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Folevi.color.inkFaint)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(section.title)")
            } else {
                title.accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            if section.folded {
                Text("\(section.count)").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).monospacedDigit()
            }
            Button(action: onFold) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Folevi.color.inkFaint)
                    .rotationEffect(.degrees(section.folded ? -90 : 0))
                    .animation(reduceMotion ? nil : .folevi(0.2), value: section.folded)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(section.folded ? "Show \(section.title)" : "Fold \(section.title)")
            .accessibilityIdentifier("task-fold-\(section.id)")
        }
        .padding(.leading, 20)
        .padding(.trailing, 6)
    }

    private var title: some View {
        (Text(section.title).foregroundColor(Folevi.color.heading).fontWeight(.semibold)
            + Text(section.detail.map { " · \($0)" } ?? "").foregroundColor(Folevi.color.inkMuted))
            .foleviFont(.headline)
            .lineLimit(1)
    }
}

/// The view chips: capsules with an icon, the short name and the count; the chosen one filled.
struct TaskChipsRow: View {
    let model: TasksModel
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(TaskViewChip.all) { chip in
                        let on = chip.id == model.view
                        let count = model.count(for: chip.id)
                        Button { model.select(chip.id) } label: {
                            HStack(spacing: 6) {
                                Image(systemName: chip.symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(on ? Folevi.color.canvas : Folevi.color.inkMuted)
                                Text(chip.short)
                                if let count { Text("\(count)").monospacedDigit().opacity(on ? 0.7 : 1).foregroundStyle(on ? Folevi.color.canvas : Folevi.color.inkMuted) }
                            }
                            .foleviFont(.callout)
                            .fontWeight(.medium)
                            .foregroundStyle(on ? Folevi.color.canvas : Folevi.color.ink)
                            .padding(.leading, 12)
                            .padding(.trailing, 14)
                            .frame(minHeight: 34)
                            .background(Capsule().fill(on ? Folevi.color.heading : Folevi.color.ink.opacity(0.065)))
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .id(chip.id)
                        .accessibilityLabel(count.map { "\(chip.title), \($0)" } ?? chip.title)
                        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                        .accessibilityIdentifier("task-chip-\(chip.id.rawValue)")
                    }
                }
                .padding(.horizontal, 16)
            }
            .onChange(of: model.view) { _, v in withAnimation(.folevi()) { proxy.scrollTo(v, anchor: .center) } }
        }
    }
}

/// Quick Add: "Add a task" with the date and repeat the engine read as chips (x keeps those words as text).
struct QuickAddTaskField: View {
    @Bindable var model: TasksModel
    var focused: FocusState<Bool>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(Folevi.color.inkFaint)
                TextField("Add a task", text: $model.quickText)
                    .textFieldStyle(.plain)
                    .foleviFont(.body)
                    .focused(focused)
                    .submitLabel(.done)
                    .onSubmit { Task { await model.add() } }
                    .accessibilityIdentifier("task-quick-add")
                if !model.quickText.isEmpty {
                    Button { Task { await model.add() } } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.system(size: 24)).foregroundStyle(Folevi.color.heading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Add task")
                    .keyboardShortcut(.return, modifiers: .command)
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
            if model.parsedDueLabel != nil || model.parsedRepeatLabel != nil {
                HStack(spacing: 6) {
                    if let due = model.parsedDueLabel { parsedChip(due, symbol: "calendar") }
                    if let r = model.parsedRepeatLabel { parsedChip(r, symbol: "repeat") }
                }
                .transition(.opacity)
            }
        }
        .foleviAnimation(value: model.parsedDueLabel)
    }

    private func parsedChip(_ text: String, symbol: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 11, weight: .semibold))
            Text(text).foleviFont(.footnote)
            Button { model.keepText = true } label: {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 22, height: 22).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Keep \(text) as text")
        }
        .foregroundStyle(Folevi.color.ink)
        .padding(.leading, 9)
        .padding(.trailing, 2)
        .background(Capsule().fill(Folevi.color.accentSoft))
        .accessibilityElement(children: .combine)
    }
}

/// A Quick Add task the engine hasn't confirmed: sending, waiting for the engine, or failed (with retry).
struct PendingTaskRow: View {
    let item: PendingTask
    let onRetry: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            TaskBox(status: "open").opacity(0.5).frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.text).foleviFont(.body).foregroundStyle(Folevi.color.inkMuted).lineLimit(2)
                Text(stateText).foleviFont(.footnote).foregroundStyle(isFailed ? Folevi.color.destructive : Folevi.color.inkFaint)
            }
            Spacer(minLength: 0)
            if isFailed {
                Button("Retry", action: onRetry).buttonStyle(.folevi(.secondary, size: .small))
                Button(action: onDiscard) { Image(systemName: "xmark").frame(width: 32, height: 32) }.buttonStyle(.plain).accessibilityLabel("Discard")
            } else if case .sending = item.state {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.leading, 9)
        .padding(.trailing, 16)
        .accessibilityElement(children: .contain)
    }

    private var isFailed: Bool { if case .failed = item.state { true } else { false } }
    private var stateText: String {
        switch item.state {
        case .sending: "Adding…"
        case .waiting: "Waiting for Folevi to start"
        case .failed(let m): m
        }
    }
}
