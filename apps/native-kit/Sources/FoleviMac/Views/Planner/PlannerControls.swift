// Folevi's own form controls for the task dialogs, drawn as the web's (ui/DateField.tsx, ui/Select.tsx): the date
// field and its month calendar (WAI-ARIA date grid keys: arrows by day and week, Page Up and Down by month, with
// Shift by year, Home and End, Return picks), the time list in 15-minute steps, and the select. Never the system's
// date picker or pop-up button.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// A select (ui/Select.tsx): the chosen label and a chevron in an input well; a Folevi menu of the options.
struct PlannerSelect: View {
    struct Option: Hashable {
        var id: String
        var title: String
    }

    let options: [Option]
    @Binding var value: String
    var fill = false
    var label: String
    @Environment(\.colorScheme) private var scheme
    @State private var anchor = PlannerAnchor()

    var body: some View {
        let pair = PS("edit.select")
        let s = pair.resolve(scheme)
        let chevron = PS("edit.select.chevron").resolve(scheme)
        let title = options.first { $0.id == value }?.title ?? options.first?.title ?? ""
        Button {
            guard let v = anchor.view else { return }
            let entries = options.map { o in
                WebMenuEntry(.item(o.title, checked: o.id == value, id: "opt:\(o.id)")) { value = o.id }
            }
            WebMenuWindow.show(entries, width: max(v.bounds.width, 160), below: v)
        } label: {
            HStack(spacing: s.gap) {
                Text(title).webText(s.text).lineLimit(1)
                if fill { Spacer(minLength: 0) }
                WebIconView(.chevronDown, size: 14).opacity(chevron.opacity)
            }
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: fill ? .infinity : nil, alignment: .leading)
            .frame(height: s.height)
            .foregroundStyle(s.color.color)
            .webBox(pair)
            .contentShape(Rectangle())
            .plannerAnchor(anchor)
        }
        .buttonStyle(PlainPress())
        .accessibilityLabel("\(label): \(title)")
    }
}

/// A field's label over it (`text-subheadline`, the label muted, 4 pt to the control).
struct FieldLabel<Control: View>: View {
    let title: String
    @ViewBuilder let control: () -> Control
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let l = PS("edit.label").resolve(scheme)
        VStack(alignment: .leading, spacing: 4) {
            Text(title).webText(l.text).lineLimit(1).foregroundStyle(l.color.color)
            control()
        }
    }
}

/// The date field: the date on a button that opens the month calendar; `""` is no date.
struct PlannerDateField: View {
    @Binding var value: String
    var label = "Due date"
    var placeholder = "No date"
    var clearable = true
    var width: CGFloat = 176
    @Environment(\.colorScheme) private var scheme
    @State private var anchor = PlannerAnchor()

    var body: some View {
        let pair = PS("edit.datefield")
        let s = pair.resolve(scheme)
        let has = TaskDates.isDay(value)
        ZStack(alignment: .trailing) {
            Button { open() } label: {
                HStack(spacing: s.gap) {
                    WebIconView(.calendarDays, size: 14).foregroundStyle(PS("edit.datefield.icon").resolve(scheme).color.color)
                    Text(has ? PlannerDates.fieldLabel(value) : placeholder).webText(s.text).lineLimit(1)
                        .foregroundStyle(has ? PV("color-ink").c(scheme) : PV("color-ink-faint").c(scheme))
                    Spacer(minLength: 0)
                }
                .padding(s.padding.edgeInsets)
                .frame(width: width, height: s.height)
                .webBox(pair)
                .contentShape(Rectangle())
                .plannerAnchor(anchor)
            }
            .buttonStyle(PlainPress())
            .accessibilityLabel("\(label): \(has ? PlannerDates.fieldLabel(value) : placeholder)")
            if clearable && has {
                ClearButton { value = "" }.padding(.trailing, 6).accessibilityLabel("Clear \(label)")
            }
        }
    }

    private func open() {
        guard let v = anchor.view else { return }
        let binding = $value
        let clearable = self.clearable
        PlannerPanel.popover(below: v) { close in
            CalendarPopover(value: binding.wrappedValue, clearable: clearable) { picked in
                binding.wrappedValue = picked
                close()
            }
        }
    }
}

/// The small x in a field or chip.
struct ClearButton: View {
    var size: CGFloat = 20
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        Button(action: action) {
            WebIconView(.x, size: 12)
                .frame(width: size, height: size)
                .foregroundStyle(over ? PV("color-heading").c(scheme) : PV("color-ink-faint").c(scheme))
                .background { if over { RoundedRectangle(cornerRadius: 4, style: .circular).fill(PV("color-accent-soft").c(scheme)) } }
                .contentShape(Rectangle())
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
    }
}

/// The date field's popover: the month calendar and, when it can be cleared, Clear.
struct CalendarPopover: View {
    let value: String
    let clearable: Bool
    let pick: (String) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let pop = PS("date.pop")
        let p = pop.resolve(scheme)
        VStack(spacing: 0) {
            MonthPicker(value: TaskDates.isDay(value) ? value : nil, onPick: pick)
            if clearable && TaskDates.isDay(value) {
                VStack(spacing: 0) {
                    Rectangle().fill(PV("color-line").c(scheme)).frame(height: 1)
                    HStack {
                        Spacer()
                        PlannerButton("Clear", style: "edit.clear") { pick("") }
                            .environment(\.plannerSmall, true)
                    }
                    .padding(.top, 6)
                }
                .padding(.top, 6)
            }
        }
        .padding(p.padding.edgeInsets)
        .background(WebMaterial(radius: p.radius))
        .webBox(pop)
    }
}

private struct PlannerSmallKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var plannerSmall: Bool {
        get { self[PlannerSmallKey.self] }
        set { self[PlannerSmallKey.self] = newValue }
    }
}

/// ui/DateField.tsx Calendar: the month, Previous and Next, the weekday letters and six weeks of days.
struct MonthPicker: View {
    let value: String?
    let onPick: (String) -> Void
    @State private var focus: String
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    init(value: String?, onPick: @escaping (String) -> Void) {
        self.value = value
        self.onPick = onPick
        _focus = State(initialValue: value ?? TaskDates.today())
    }

    /// The locale's first day of the week (0 = Sunday).
    static var firstDay: Int { (Calendar.current.firstWeekday - 1) % 7 }

    var body: some View {
        let today = TaskDates.today()
        let month = String(focus.prefix(7))
        let first = Self.firstDay
        let monthStart = "\(month)-01"
        let dow = (TaskDates.weekdayIndex(monthStart) + 1) % 7 // 0 = Sunday
        let lead = (dow - first + 7) % 7
        let start = TaskDates.add(monthStart, days: -lead)
        let days = (0..<42).map { TaskDates.add(start, days: $0) }
        let grid = PS("date.grid").resolve(scheme)
        let wd = PS("date.weekday").resolve(scheme)
        VStack(spacing: 0) {
            HStack {
                StyledText(PlannerDates.format(monthStart, "MMMMyyyy"), "date.month")
                Spacer()
                HStack(spacing: 2) {
                    navButton(.chevronLeft, "Previous month") { focus = shift(focus, -1) }
                    navButton(.chevronRight, "Next month") { focus = shift(focus, 1) }
                }
            }
            .padding(.horizontal, 2)
            .padding(.bottom, 6)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: grid.gap), count: 7), spacing: grid.gap) {
                ForEach(0..<7, id: \.self) { i in
                    Text(Self.weekdayLetter((first + i) % 7)).webText(wd.text).foregroundStyle(wd.color.color).frame(height: wd.height)
                }
                ForEach(days, id: \.self) { d in dayCell(d, month: month, today: today) }
            }
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .onKeyPress(phases: .down) { press in key(press) }
        }
        .frame(width: 244)
        .onAppear { focused = true }
    }

    static func weekdayLetter(_ sundayBased: Int) -> String {
        ["S", "M", "T", "W", "T", "F", "S"][sundayBased]
    }

    private func dayCell(_ d: String, month: String, today: String) -> some View {
        DayCell(day: d, outside: !d.hasPrefix(month), selected: d == value, today: d == today, focused: focused && d == focus) { onPick(d) }
    }

    private func navButton(_ icon: WebIcon, _ label: String, _ action: @escaping () -> Void) -> some View {
        let n = PS("date.nav").resolve(scheme)
        return HoverTile(radius: n.radius, hover: PV("color-accent-soft")) {
            WebIconView(icon, size: 15).frame(width: n.width, height: n.height).foregroundStyle(n.color.color)
        } action: { action() }
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }

    private func shift(_ day: String, _ months: Int) -> String {
        let p = day.split(separator: "-").compactMap { Int($0) }
        let target = TaskDates.addMonths("\(day.prefix(7))-01", months)
        let last = TaskDates.add(TaskDates.addMonths(target, 1), days: -1)
        let lastDay = Int(last.suffix(2)) ?? 28
        return "\(target.prefix(8))\(String(format: "%02d", min(p.count == 3 ? p[2] : 1, lastDay)))"
    }

    private func key(_ press: KeyPress) -> KeyPress.Result {
        let first = Self.firstDay
        let dow = ((TaskDates.weekdayIndex(focus) + 1) % 7 - first + 7) % 7
        let next: String?
        switch press.key {
        case .leftArrow: next = TaskDates.add(focus, days: -1)
        case .rightArrow: next = TaskDates.add(focus, days: 1)
        case .upArrow: next = TaskDates.add(focus, days: -7)
        case .downArrow: next = TaskDates.add(focus, days: 7)
        case .pageUp: next = shift(focus, press.modifiers.contains(.shift) ? -12 : -1)
        case .pageDown: next = shift(focus, press.modifiers.contains(.shift) ? 12 : 1)
        case .home: next = TaskDates.add(focus, days: -dow)
        case .end: next = TaskDates.add(focus, days: 6 - dow)
        case .return, .space:
            onPick(focus)
            return .handled
        default: next = nil
        }
        guard let next else { return .ignored }
        focus = next
        return .handled
    }
}

struct DayCell: View {
    let day: String
    let outside: Bool
    let selected: Bool
    let today: Bool
    let focused: Bool
    let pick: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        let base = PS("date.day").resolve(scheme)
        let sel = PS("date.day.selected").resolve(scheme)
        let color: Color = selected ? sel.color.color : today ? PV("color-accent").c(scheme) : outside ? PS("date.day.outside").resolve(scheme).color.color : (over ? PV("color-heading").c(scheme) : base.color.color)
        Button(action: pick) {
            Text("\(Int(day.suffix(2)) ?? 0)")
                .webText(selected || today ? base.text(weight: 600) : base.text)
                .monospacedDigit()
                .foregroundStyle(color)
                .frame(maxWidth: .infinity)
                .frame(height: base.height)
                .background {
                    let shape = RoundedRectangle(cornerRadius: base.radius, style: .circular)
                    if selected { shape.fill(sel.background.color) } else if over { shape.fill(PV("color-accent-soft").c(scheme)) }
                }
                .overlay {
                    if focused { RoundedRectangle(cornerRadius: base.radius, style: .circular).strokeBorder(PV("color-focus").c(scheme), lineWidth: 2) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
        .accessibilityLabel(PlannerDates.fieldLabel(day))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A tile with a hover fill.
struct HoverTile<Label: View>: View {
    let radius: CGFloat
    let hover: ColorPair
    @ViewBuilder let label: () -> Label
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        Button(action: action) {
            label()
                .background { if over { RoundedRectangle(cornerRadius: radius, style: .circular).fill(hover.c(scheme)) } }
                .contentShape(Rectangle())
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
    }
}

/// The time field (ui/DateField.tsx TimeField): a select of the day in 15-minute steps, or none.
struct PlannerTimeField: View {
    @Binding var value: String
    var emptyLabel = "All day"
    var width: CGFloat = 128
    @Environment(\.colorScheme) private var scheme
    @State private var anchor = PlannerAnchor()

    static let times: [String] = (0..<96).map { String(format: "%02d:%02d", $0 / 4, ($0 % 4) * 15) }

    var body: some View {
        let pair = PS("edit.select")
        let s = pair.resolve(scheme)
        Button { open() } label: {
            HStack(spacing: s.gap) {
                Text(value.isEmpty ? emptyLabel : PlannerDates.timeLabel(value)).webText(s.text).lineLimit(1)
                Spacer(minLength: 0)
                WebIconView(.chevronDown, size: 14).opacity(PS("edit.select.chevron").resolve(scheme).opacity)
            }
            .padding(s.padding.edgeInsets)
            .frame(width: width, height: s.height)
            .foregroundStyle(s.color.color)
            .webBox(pair)
            .contentShape(Rectangle())
            .plannerAnchor(anchor)
        }
        .buttonStyle(PlainPress())
        .accessibilityLabel("Due time: \(value.isEmpty ? emptyLabel : PlannerDates.timeLabel(value))")
    }

    private func open() {
        guard let v = anchor.view else { return }
        var times = Self.times
        if !value.isEmpty, !times.contains(value) { times = (times + [value]).sorted() }
        let options = [("", emptyLabel)] + times.map { ($0, PlannerDates.timeLabel($0)) }
        let binding = $value
        let width = max(v.bounds.width, 160)
        PlannerPanel.popover(below: v) { close in
            OptionList(options: options, selected: binding.wrappedValue, width: width) { id in
                binding.wrappedValue = id
                close()
            }
        }
    }
}

/// A long list of options in a menu panel that scrolls (a select with many choices: the times of day).
struct OptionList: View {
    let options: [(String, String)]
    let selected: String
    let width: CGFloat
    let pick: (String) -> Void
    @State private var highlighted: String?
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let panel = WebStyles.named("menu.panel")
        let p = panel.resolve(scheme)
        ScrollViewReader { reader in
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(options, id: \.0) { o in
                        let id = o.0
                        let item = WebStyles.named(highlighted == id ? "menu.item.highlighted" : "menu.item")
                        let s = item.resolve(scheme)
                        Button { pick(id) } label: {
                            HStack(spacing: s.gap) {
                                Text(o.1).webText(s.text).lineLimit(1)
                                Spacer(minLength: 0)
                                if id == selected { WebIconView(.check, size: 14) }
                            }
                            .padding(s.padding.edgeInsets)
                            .frame(height: s.height)
                            .foregroundStyle(s.color.color)
                            .webBox(item)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PlainPress())
                        .onHover { if $0 { highlighted = id } }
                        .id(id)
                    }
                }
                .padding(p.padding.edgeInsets)
            }
            .scrollIndicators(.never)
            .frame(width: width, height: min(260, CGFloat(options.count) * 30 + 12))
            .webBox(panel)
            .onAppear {
                highlighted = selected
                reader.scrollTo(selected.isEmpty ? (options.first(where: { $0.0 == "09:00" })?.0 ?? "") : selected, anchor: .center)
                focused = true
            }
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .onKeyPress(phases: .down) { press in
                let ids = options.map(\.0)
                let i = ids.firstIndex(of: highlighted ?? selected) ?? 0
                switch press.key {
                case .downArrow: highlighted = ids[min(i + 1, ids.count - 1)]
                case .upArrow: highlighted = ids[max(i - 1, 0)]
                case .return: pick(highlighted ?? selected); return .handled
                default: return .ignored
                }
                reader.scrollTo(highlighted, anchor: .center)
                return .handled
            }
        }
    }
}

// MARK: The page picker (QuickAddTask.tsx DocumentPicker)

typealias PageTarget = (id: String, title: String)

/// "Add to": the Inbox, or a page of the space found by search (recent pages before anything is typed).
struct DocumentPicker: View {
    let client: EngineClient
    @Binding var value: PageTarget?
    var label = "Add to"
    var exclude: String?
    @State private var query = ""
    @State private var open = false
    @State private var active = 0
    @State private var found: [PageTarget] = []
    @State private var loaded = false
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let options: [PageTarget?] = [nil] + found.map { Optional($0) }
        VStack(alignment: .leading, spacing: 4) {
            StyledText(label, "edit.label")
            HStack(spacing: 8) {
                if let v = value, !open {
                    HStack(spacing: 4) {
                        Text(v.title.isEmpty ? "Untitled" : v.title).webText(.role(.footnote, weight: 500)).lineLimit(1)
                        ClearButton { value = nil }.padding(.trailing, -4).accessibilityLabel("Add to Inbox instead")
                    }
                    .foregroundStyle(PV("color-accent-soft-ink").c(scheme))
                    .padding(.leading, 8).padding(.trailing, 6)
                    .frame(height: 24)
                    .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(PV("color-accent-soft").c(scheme)))
                }
                PlannerField(placeholder: value == nil ? "Inbox, or search a page…" : "Search another page…", text: $query, style: "quick.picker.input", focused: $focused) {
                    if open, active < options.count { choose(options[active]) }
                }
                .onKeyPress(.downArrow) {
                    open = true
                    active = min(active + 1, options.count - 1)
                    return .handled
                }
                .onKeyPress(.upArrow) {
                    active = max(active - 1, 0)
                    return .handled
                }
            }
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.offset) { i, t in
                        let item = WebStyles.named(i == active ? "menu.item.highlighted" : "menu.item")
                        let s = item.resolve(scheme)
                        Button { choose(t) } label: {
                            HStack(spacing: 8) {
                                WebIconView(t == nil ? .inbox : .fileText, size: 14).foregroundStyle(PV("color-ink-muted").c(scheme))
                                Text(t.map { $0.title.isEmpty ? "Untitled" : $0.title } ?? "Inbox (your task page)").webText(s.text).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 30)
                            .foregroundStyle(s.color.color)
                            .webBox(item)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PlainPress())
                        .onHover { if $0 { active = i } }
                    }
                    if !query.trimmingCharacters(in: .whitespaces).isEmpty && loaded && found.isEmpty {
                        Text("No matching pages").webText(.role(.subheadline)).foregroundStyle(PV("color-ink-muted").c(scheme)).padding(.horizontal, 8).frame(height: 30)
                    }
                }
                .padding(6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .webBox(WebStyles.named("menu.panel"))
                .padding(.top, 4)
            }
        }
        .onChange(of: focused) { _, f in
            if f { open = true; active = 0 } else {
                Task { try? await Task.sleep(for: .milliseconds(120)); open = false }
            }
        }
        .task(id: "\(open)|\(query)") { await load() }
    }

    private func choose(_ t: PageTarget?) {
        value = t
        query = ""
        open = false
        focused = false
    }

    private func load() async {
        guard open else { return }
        let q = query.trimmingCharacters(in: .whitespaces)
        try? await Task.sleep(for: .milliseconds(150))
        guard !Task.isCancelled else { return }
        loaded = false
        if q.isEmpty {
            let rows = (try? await client.query(.recent(limit: 6)))?.rows ?? []
            found = rows.map(\.row).filter { $0.kind != "template" && $0.id != exclude }.map { ($0.id, $0.title) }
        } else {
            let hits = (try? await client.query(.search(text: q, limit: 8)))?.hits ?? []
            var seen = Set<String>()
            found = hits.filter { $0.kind != "template" && $0.id != exclude && seen.insert($0.id).inserted }.map { ($0.id, $0.title) }
        }
        loaded = true
        active = min(active, found.count)
    }
}
#endif
