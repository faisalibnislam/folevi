// The redesigned Home's own pieces, drawn as the web's (HomeBlocks.tsx, HomeStats.tsx; the owner's design version
// 19): the top line (the date, Customize), the greeting, a section's head (a black tile with a white icon, the serif
// title, See all), the capture field, At a glance, the Today card, Foli DNA of the week, and Customize mode's frame
// and Add-a-block tile. Shared by the Mac and iPad Home (FoleviMac WebHomeScreen) and the iPhone's (FoleviPhone).
import SwiftUI
import FoleviDesign
import FoleviEngine

private extension View {
    func ink(_ pair: ColorPair, _ scheme: ColorScheme) -> some View { foregroundStyle(pair.resolve(scheme).color) }
}

private typealias C = FoleviTokens.Chrome

public extension View {
    /// Home's serif (Spectral), kept under the Mac's native look, which sets interface text in the system font: the
    /// greeting, the section titles and the figures are the design's serif on every platform.
    func homeSerif(_ size: CGFloat, weight: Font.Weight = .medium, tracking: CGFloat = 0) -> some View {
        font(FoleviFonts.font(.display, size: size, weight: weight)).tracking(tracking * size)
    }
}

/// A card's fill and hairline edge with the resting shadow (`rounded-container border bg-surface shadow-resting`).
struct HomeCardBackground: ViewModifier {
    var shadow = true
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
        content
            .background(shape.fill(C.surface.resolve(scheme).color))
            .overlay(shape.strokeBorder(C.line.resolve(scheme).color, lineWidth: 1))
            .clipShape(shape)
            .background { if shadow { shape.fill(C.surface.resolve(scheme).color).foleviShadow(.resting, in: shape) } }
    }
}

public extension View {
    /// Home's card: the surface, a hairline and (by default) the resting shadow.
    func homeCard(shadow: Bool = true) -> some View { modifier(HomeCardBackground(shadow: shadow)) }
}

// MARK: Top line, greeting, section head

/// Home's top line: the date at the left (faint), Customize at the right; in Customize mode Done, with Reset.
public struct HomeTopLine: View {
    let now: Date
    let editing: Bool
    let toggle: () -> Void
    let reset: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(now: Date, editing: Bool, toggle: @escaping () -> Void, reset: @escaping () -> Void) {
        self.now = now
        self.editing = editing
        self.toggle = toggle
        self.reset = reset
    }

    public static func date(_ now: Date) -> String { now.formatted(.dateTime.weekday(.wide).month(.wide).day()) }

    public var body: some View {
        HStack(spacing: 12) {
            Text(Self.date(now)).webText(.role(.subheadline)).lineLimit(1).ink(C.inkFaint, scheme)
            Spacer(minLength: 0)
            if editing {
                HomeQuietButton("Reset", icon: .rotateCcw, action: reset)
                    .foleviTooltip("Put Home back to its default sections and order")
            }
            HomeQuietButton(editing ? "Done" : "Customize", icon: editing ? .check : .pencilLine, primary: editing, action: toggle)
                .accessibilityAddTraits(editing ? .isSelected : [])
        }
        .frame(minHeight: 36)
        .accessibilityElement(children: .contain)
    }
}

/// A small quiet button (`ui-btn ui-btn-quiet h-control-sm`), or the primary one (Done, Save).
public struct HomeQuietButton: View {
    let title: String
    let icon: WebIcon?
    var primary = false
    var disabled = false
    let action: () -> Void
    @State private var hovered = false
    @Environment(\.colorScheme) private var scheme

    public init(_ title: String, icon: WebIcon? = nil, primary: Bool = false, disabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.primary = primary
        self.disabled = disabled
        self.action = action
    }

    public var body: some View {
        let shape = RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous)
        Button(action: action) {
            HStack(spacing: 7) {
                if let icon { WebIconView(icon, size: 14) }
                Text(title).webText(.role(.subheadline, weight: primary ? 600 : 500)).lineLimit(1)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 30)
            .foregroundStyle(primary ? C.canvas.resolve(scheme).color : C.ink.resolve(scheme).color)
            .background(shape.fill(primary ? C.heading.resolve(scheme).color : hovered ? FoleviTokens.Glass.hover.resolve(scheme).color : .clear))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .onHover { hovered = $0 }
    }
}

/// "Good morning, Faisal" in the serif display face.
public struct HomeGreeting: View {
    let text: String
    let size: CGFloat
    @Environment(\.colorScheme) private var scheme

    public init(_ text: String, size: CGFloat) {
        self.text = text
        self.size = size
    }

    public var body: some View {
        Text(text)
            .homeSerif(size, weight: .medium, tracking: -0.012)
            .lineSpacing(size * 0.08)
            .ink(C.heading, scheme)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A section's head: a 28 pt tile in the heading colour with a white 14 pt icon, the serif title (title 3), and
/// "See all →" (or another link) at the right. No hairline under it.
public struct HomeSectionHead: View {
    let title: String
    let icon: WebIcon
    let link: String?
    let action: (() -> Void)?
    @State private var hovered = false
    @Environment(\.colorScheme) private var scheme

    public init(_ title: String, icon: WebIcon, link: String? = "See all", action: (() -> Void)? = nil) {
        self.title = title
        self.icon = icon
        self.link = link
        self.action = action
    }

    public var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                WebIconView(icon, size: 14)
                    .frame(width: 28, height: 28)
                    .ink(C.canvas, scheme)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).fill(C.heading.resolve(scheme).color))
                    .accessibilityHidden(true)
                Text(title).homeSerif(WebTypeRole.title3.metrics.size, weight: .semibold).lineLimit(1).ink(C.heading, scheme)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if let link, let action {
                Button(action: action) {
                    HStack(spacing: 2) {
                        Text(link).webText(.role(.subheadline)).lineLimit(1)
                        WebIconView(.arrowRight, size: 13).offset(x: hovered ? 2 : 0)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .ink(hovered ? C.heading : C.inkMuted, scheme)
                    .background(Capsule().fill(hovered ? C.accentSoft.resolve(scheme).color : .clear))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .onHover { h in withAnimation(.easeOut(duration: 0.2)) { hovered = h } }
                .padding(.trailing, -8)
                .accessibilityLabel("\(link) \(title.lowercased())")
            }
        }
        .frame(minHeight: 28)
    }
}

// MARK: Capture

/// The capture field: "What's on your mind?", where it saves (the picker is the screen's own menu), Add as a task,
/// Template, and Save (⌘↩).
public struct HomeCaptureField<Destination: View>: View {
    let model: HomeDashboardModel
    let templates: () -> Void
    @ViewBuilder let destination: () -> Destination
    @State private var text = ""
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    public init(model: HomeDashboardModel, templates: @escaping () -> Void, @ViewBuilder destination: @escaping () -> Destination) {
        self.model = model
        self.templates = templates
        self.destination = destination
    }

    private var value: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    public var body: some View {
        let field = WebTextStyle(family: .display, size: WebTypeRole.title3.metrics.size, leading: (WebTypeRole.title3.metrics.size * 1.6).rounded(), weight: 400, letterSpacing: 0)
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text("What\u{2019}s on your mind?").homeSerif(field.size, weight: .regular).ink(C.inkFaint, scheme).allowsHitTesting(false).accessibilityHidden(true)
                }
                TextEditor(text: $text)
                    .homeSerif(field.size, weight: .regular)
                    .lineSpacing(field.leading - field.size * 1.2)
                    .ink(C.ink, scheme)
                    .scrollContentBackground(.hidden)
                    .focused($focused)
                    .frame(minHeight: field.leading * 3, maxHeight: field.leading * 6)
                    #if os(macOS)
                    .padding(.leading, -5)
                    #else
                    .padding(.horizontal, -5)
                    .padding(.top, -8)
                    #endif
                    .accessibilityLabel("New note")
            }
            HStack(spacing: 8) {
                Text("Saves to").webText(.role(.footnote)).lineLimit(1).fixedSize().ink(C.inkFaint, scheme)
                destination().layoutPriority(1)
                Spacer(minLength: 0)
                #if os(macOS)
                if !value.isEmpty { Text("⌘↩ to save").webText(.role(.caption1)).ink(C.inkFaint, scheme) }
                #endif
                tool(.squareCheckBig, "Add as a task", disabled: value.isEmpty || model.saving) {
                    let t = text
                    Task { if await model.addTask(t) { text = "" } }
                }
                tool(.layoutTemplate, "Start from a template", disabled: false, action: templates)
                HomeQuietButton("Save", primary: true, disabled: value.isEmpty || model.saving) { save() }
                    .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .padding(EdgeInsets(top: 16, leading: 20, bottom: 12, trailing: 20))
        .homeCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.capture")
    }

    private func save() {
        let t = text
        Task { if await model.capture(t) { text = "" } }
    }

    private func tool(_ icon: WebIcon, _ label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WebIconView(icon, size: 16).frame(width: 32, height: 32).ink(C.inkMuted, scheme).contentShape(Rectangle())
        }
        .buttonStyle(.webHover(radius: FoleviTokens.Radius.control))
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }
}

/// The capture field's "Drafts ▾" (its menu is the screen's).
public struct HomeDestinationLabel: View {
    let text: String
    let inFolder: Bool
    let color: Color?
    @Environment(\.colorScheme) private var scheme

    public init(_ text: String, folderColor: Color?) {
        self.text = text
        self.inFolder = folderColor != nil
        self.color = folderColor
    }

    public var body: some View {
        HStack(spacing: 6) {
            if let color {
                RoundedRectangle(cornerRadius: 2, style: .continuous).fill(color).frame(width: 11, height: 9)
            } else {
                WebIconView(.notebookText, size: 12).ink(C.inkMuted, scheme)
            }
            Text(text).webText(.role(.footnote, weight: 500)).lineLimit(1).ink(C.ink, scheme)
            WebIconView(.chevronDown, size: 12).ink(C.inkMuted, scheme)
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 28)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Saves to \(text)")
    }
}

// MARK: At a glance

/// At a glance (HomeStats.tsx): six read-only cells two by two (Notes, Words, Images, Folders, Tasks done, This week).
public struct HomeStatsGrid: View {
    let stats: HomeStatsValue?
    let now: Date
    var height: CGFloat = 288
    @Environment(\.colorScheme) private var scheme

    public init(stats: HomeStatsValue?, now: Date, height: CGFloat = 288) {
        self.stats = stats
        self.now = now
        self.height = height
    }

    public var body: some View {
        let line = C.line.resolve(scheme).color
        VStack(spacing: 0) {
            Grid(horizontalSpacing: 1, verticalSpacing: 1) {
                if let s = stats {
                    GridRow {
                        cell("Notes", HomeWords.stat(s.notes), s.week.last.flatMap { $0 > 0 ? "\($0) today" : nil })
                        cell("Words", HomeWords.stat(s.words), s.words > 0 ? HomeWords.readingTime(s.words) : nil)
                    }
                    GridRow {
                        cell("Images", HomeWords.stat(s.images), s.notes > 0 && s.images > 0 ? "in your \(s.notes == 1 ? "note" : "notes")" : nil)
                        cell("Folders", HomeWords.stat(s.folders), nil)
                    }
                    GridRow {
                        cell("Tasks done", HomeWords.stat(s.tasksDone), s.tasksOpen > 0 ? "\(s.tasksOpen.formatted()) still open" : "Nothing open")
                        week(s.week)
                    }
                } else {
                    ForEach(0..<3, id: \.self) { _ in
                        GridRow { placeholder; placeholder }
                    }
                }
            }
            if stats?.capped == true {
                Text("Counted up to 5,000 of each.").webText(.role(.caption2)).ink(C.inkFaint, scheme)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 6)
                    .background(C.surface.resolve(scheme).color)
            }
        }
        .background(line)
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).strokeBorder(line, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your workspace in numbers")
        .accessibilityIdentifier("home.stats")
    }

    private var placeholder: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: 4).fill(FoleviTokens.Glass.hover.resolve(scheme).color).frame(width: 48, height: 12)
            RoundedRectangle(cornerRadius: 4).fill(FoleviTokens.Glass.hover.resolve(scheme).color).frame(width: 64, height: 24)
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(C.surface.resolve(scheme).color)
    }

    private func cell(_ label: String, _ value: String, _ note: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).webText(.role(.caption1, weight: 500)).ink(C.inkMuted, scheme)
            Text(value)
                .homeSerif(WebTypeRole.title1.metrics.size, weight: .medium, tracking: -0.01)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .ink(C.heading, scheme)
            Text(note ?? " ").webText(.role(.caption1)).lineLimit(1).ink(C.inkFaint, scheme)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(C.surface.resolve(scheme).color)
        .accessibilityElement(children: .combine)
    }

    private func week(_ week: [Int]) -> some View {
        let max = Swift.max(1, week.max() ?? 1)
        let total = week.reduce(0, +)
        let days: [String] = (0..<7).map { i in
            let d = Calendar.current.date(byAdding: .day, value: i - 6, to: now) ?? now
            return d.formatted(.dateTime.weekday(.narrow))
        }
        return VStack(alignment: .leading, spacing: 4) {
            Text("This week").webText(.role(.caption1, weight: 500)).ink(C.inkMuted, scheme)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(Array(week.prefix(7).enumerated()), id: \.offset) { i, n in
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(i == 6 ? C.heading.resolve(scheme).color : C.ink.resolve(scheme).color.opacity(0.22))
                        .frame(maxWidth: .infinity)
                        .frame(height: 24 * (n > 0 ? Swift.max(0.16, Double(n) / Double(max)) : 0.08))
                }
            }
            .frame(height: 24, alignment: .bottom)
            .accessibilityElement()
            .accessibilityLabel("New notes on each of the last 7 days: " + zip(days, week).map { "\($0) \($1)" }.joined(separator: ", "))
            Text(total > 0 ? HomeWords.plural(total, "new note", "new notes") : "No new notes yet").webText(.role(.caption1)).lineLimit(1).ink(C.inkFaint, scheme)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(C.surface.resolve(scheme).color)
    }
}

// MARK: Today

/// The Today card: the date on a tile at the left (the weekday in red, the day, the month), today's events as time
/// rows with their calendar's colour, the next one tagged "Up next · in 25 min", and a line for the tasks due.
public struct HomeTodayCard: View {
    let now: Date
    let agenda: [HomeAgendaItem]?
    let due: Int
    let color: (String) -> Color
    let openCalendar: () -> Void
    let openTasks: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(now: Date, agenda: [HomeAgendaItem]?, due: Int, color: @escaping (String) -> Color, openCalendar: @escaping () -> Void, openTasks: @escaping () -> Void) {
        self.now = now
        self.agenda = agenda
        self.due = due
        self.color = color
        self.openCalendar = openCalendar
        self.openTasks = openTasks
    }

    public var body: some View {
        let line = C.line.resolve(scheme).color
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        let tagged = agenda?.first { HomeWords.upNextTag(at: $0.at, end: $0.end, now: nowMs) != nil }
        HStack(spacing: 0) {
            VStack(spacing: 2) {
                Text(now.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .webText(WebTextStyle(size: WebTypeRole.caption1.metrics.size, leading: WebTypeRole.caption1.metrics.leading, weight: 600, letterSpacing: 0.08 * WebTypeRole.caption1.metrics.size))
                    .ink(C.destructive, scheme)
                Text("\(Calendar.current.component(.day, from: now))")
                    .homeSerif(WebTypeRole.largeTitle.metrics.size, weight: .medium)
                    .monospacedDigit()
                    .ink(C.heading, scheme)
                Text(now.formatted(.dateTime.month(.wide))).webText(.role(.footnote)).ink(C.inkMuted, scheme)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 20)
            .frame(width: 112)
            .frame(maxHeight: .infinity)
            .overlay(alignment: .trailing) { line.frame(width: 1) }
            .accessibilityElement(children: .combine)
            VStack(spacing: 0) {
                if let agenda {
                    if agenda.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("No more events today").webText(.role(.subheadline, weight: 500)).ink(C.ink, scheme)
                            Text("Your calendars are clear for the rest of the day.").webText(.role(.footnote)).ink(C.inkMuted, scheme)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 20)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(agenda.enumerated()), id: \.element.id) { i, item in
                                row(item, tag: item == tagged ? HomeWords.upNextTag(at: item.at, end: item.end, now: nowMs) : nil)
                                if i < agenda.count - 1 { line.frame(height: 1) }
                            }
                        }
                        .frame(maxHeight: .infinity, alignment: .top)
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel("Today\u{2019}s events")
                    }
                } else {
                    Text("Loading…").webText(.role(.subheadline)).ink(C.inkMuted, scheme)
                        .padding(.horizontal, 16).padding(.vertical, 20)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                }
                if due > 0 {
                    line.frame(height: 1)
                    Button(action: openTasks) {
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 2).fill(C.destructive.resolve(scheme).color).frame(width: 6, height: 6)
                            Text(due == 1 ? "1 task due today or overdue" : "\(due) tasks due today or overdue").webText(.role(.footnote)).ink(C.inkMuted, scheme)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.webHover(radius: 0))
                }
            }
            .frame(maxWidth: .infinity)
        }
        .fixedSize(horizontal: false, vertical: true)
        .homeCard(shadow: false)
        .accessibilityIdentifier("home.today")
    }

    private func row(_ item: HomeAgendaItem, tag: String?) -> some View {
        Button(action: openCalendar) {
            HStack(spacing: 12) {
                Text(item.time).webText(.role(.footnote, weight: 500)).monospacedDigit().lineLimit(1).ink(C.inkMuted, scheme).frame(width: 56, alignment: .leading)
                RoundedRectangle(cornerRadius: 2).fill(color(item.color)).frame(width: 3, height: 32)
                VStack(alignment: .leading, spacing: 0) {
                    Text(item.title).webText(.role(.subheadline)).lineLimit(1).ink(C.heading, scheme)
                    if !item.meta.isEmpty { Text(item.meta).webText(.role(.footnote)).lineLimit(1).ink(C.inkMuted, scheme) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let tag {
                    Text(tag).webText(.role(.caption1, weight: 600)).lineLimit(1).ink(C.heading, scheme)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Capsule().fill(FoleviTokens.Glass.hover.resolve(scheme).color))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: Foli DNA of the week

/// Foli DNA of the week: the week's most linked note in the middle on a dark chip, the notes it's linked with around
/// it (their folder's colour on each), curves between them, on a dotted card.
public struct HomeDnaMap: View {
    let week: HomeDnaWeek?
    let folderColor: (String?) -> Color
    let open: (String) -> Void
    var height: CGFloat = 288
    @Environment(\.colorScheme) private var scheme

    public init(week: HomeDnaWeek?, height: CGFloat = 288, folderColor: @escaping (String?) -> Color, open: @escaping (String) -> Void) {
        self.week = week
        self.height = height
        self.folderColor = folderColor
        self.open = open
    }

    public var body: some View {
        if let week {
            if let hub = week.hub {
                map(week, hub: hub)
            } else {
                Text("No links between your notes yet. Link one note to another with [[ and it shows here.")
                    .webText(.role(.subheadline))
                    .multilineTextAlignment(.center)
                    .ink(C.inkMuted, scheme)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 32)
                    .frame(maxWidth: .infinity)
                    .homeCard(shadow: false)
            }
        } else {
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
                .fill(FoleviTokens.Glass.hover.resolve(scheme).color)
                .frame(height: height)
                .accessibilityLabel("Loading Foli DNA")
        }
    }

    private func map(_ week: HomeDnaWeek, hub: GraphNode) -> some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let faint = C.inkFaint.resolve(scheme).color
            ZStack(alignment: .topLeading) {
                Canvas { ctx, size in
                    // The dots, 16 pt apart.
                    let dot = C.ink.resolve(scheme).color.opacity(0.14)
                    var y: CGFloat = 8
                    while y < size.height {
                        var x: CGFloat = 8
                        while x < size.width {
                            ctx.fill(Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)), with: .color(dot))
                            x += 16
                        }
                        y += 16
                    }
                    for i in week.around.indices {
                        let (rx, ry) = HomeDnaWeek.ring[i]
                        let p = CGPoint(x: rx * size.width, y: ry * size.height)
                        var path = Path()
                        path.move(to: CGPoint(x: size.width / 2, y: size.height / 2))
                        path.addCurve(to: p, control1: CGPoint(x: (size.width / 2 + p.x) / 2, y: size.height / 2 + (p.y - size.height / 2) * 0.2),
                                      control2: CGPoint(x: p.x, y: ry < 0.5 ? p.y + 0.12 * size.height : p.y - 0.12 * size.height))
                        ctx.stroke(path, with: .color(faint.opacity(0.45)), lineWidth: 1)
                    }
                }
                chip(hub, hubStyle: true, maxWidth: w * 0.4).position(x: w / 2, y: h / 2)
                ForEach(Array(week.around.enumerated()), id: \.element.id) { i, n in
                    chip(n, hubStyle: false, maxWidth: w * 0.4).position(x: HomeDnaWeek.ring[i].0 * w, y: HomeDnaWeek.ring[i].1 * h)
                }
            }
        }
        .frame(height: height)
        .overlay(alignment: .bottomLeading) {
            Text(week.count > 0 ? "\(week.count) new \(week.count == 1 ? "link" : "links") between your notes this week" : "No new links this week: your most linked notes")
                .webText(.role(.footnote))
                .lineLimit(1)
                .ink(C.inkMuted, scheme)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(Capsule().fill(C.surface.resolve(scheme).color.opacity(0.9)))
                .padding(.leading, 12)
                .padding(.bottom, 10)
        }
        .homeCard()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Foli DNA of the week")
        .accessibilityIdentifier("home.dna")
    }

    private func chip(_ n: GraphNode, hubStyle: Bool, maxWidth: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous)
        return Button { open(n.id) } label: {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2).fill(folderColor(n.folderId)).frame(width: 7, height: 7)
                Text(n.label.isEmpty ? "Untitled" : n.label).webText(.role(.footnote, weight: 500)).lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .ink(hubStyle ? C.canvas : C.ink, scheme)
            .background(shape.fill(hubStyle ? C.heading.resolve(scheme).color : C.surface.resolve(scheme).color))
            .overlay { if !hubStyle { shape.strokeBorder(C.line.resolve(scheme).color, lineWidth: 1) } }
            .background { if hubStyle { shape.fill(C.heading.resolve(scheme).color).foleviShadow(.raised, in: shape) } }
            .frame(maxWidth: maxWidth)
            .fixedSize()
            .contentShape(shape)
        }
        .buttonStyle(.webHover(radius: FoleviTokens.Radius.panel))
        .accessibilityLabel(n.label)
    }
}

// MARK: Customize

/// A block in Customize mode: a dashed outline and, over its top, buttons to move it and take it off Home.
public struct HomeBlockFrame<Content: View>: View {
    let block: HomeBlockId
    let editing: Bool
    let first: Bool
    let last: Bool
    let move: (Int) -> Void
    let hide: () -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    public init(block: HomeBlockId, editing: Bool, first: Bool, last: Bool, move: @escaping (Int) -> Void, hide: @escaping () -> Void, @ViewBuilder content: @escaping () -> Content) {
        self.block = block
        self.editing = editing
        self.first = first
        self.last = last
        self.move = move
        self.hide = hide
        self.content = content
    }

    public var body: some View {
        content()
            .overlay {
                if editing {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous)
                        .strokeBorder(C.inkFaint.resolve(scheme).color, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                        .padding(-10)
                        .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .top) {
                if editing {
                    HStack(spacing: 4) {
                        tool(.arrowUp, "Move \(block.label) earlier", disabled: first) { move(-1) }
                        tool(.arrowDown, "Move \(block.label) later", disabled: last) { move(1) }
                        tool(.eyeOff, "Take \(block.label) off Home", disabled: false, action: hide)
                    }
                    .padding(.horizontal, 4)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(C.surface.resolve(scheme).color)
                        .foleviShadow(.floating, radius: FoleviTokens.Radius.control))
                    .offset(y: -26)
                }
            }
            .animation(.easeOut(duration: 0.18), value: editing)
    }

    private func tool(_ icon: WebIcon, _ label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WebIconView(icon, size: 14).frame(width: 32, height: 32).ink(C.ink, scheme).contentShape(Rectangle())
        }
        .buttonStyle(.webHover(radius: FoleviTokens.Radius.control))
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }
}

/// Customize mode's last tile: the blocks not on Home, each added back with a click (to the end).
public struct HomeAddBlockTile: View {
    let hidden: [HomeBlockId]
    let add: (HomeBlockId) -> Void
    @Environment(\.colorScheme) private var scheme

    public init(hidden: [HomeBlockId], add: @escaping (HomeBlockId) -> Void) {
        self.hidden = hidden
        self.add = add
    }

    public var body: some View {
        HomeFlow(spacing: 8) {
            HStack(spacing: 8) {
                WebIconView(.plus, size: 16)
                Text("Add a block").webText(.role(.callout, weight: 500))
            }
            .ink(C.inkMuted, scheme)
            .padding(.trailing, 8)
            .frame(minHeight: 30)
            if hidden.isEmpty {
                Text("Every block is on Home.").webText(.role(.subheadline)).ink(C.inkFaint, scheme).frame(minHeight: 30)
            } else {
                ForEach(hidden, id: \.self) { b in HomeQuietButton(b.label) { add(b) } }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
            .strokeBorder(C.inkFaint.resolve(scheme).color, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Add a block")
    }
}

/// Bookmarks' empty state: one compact dashed row.
public struct HomeBookmarksEmpty: View {
    @Environment(\.colorScheme) private var scheme
    public init() {}
    public var body: some View {
        HStack(spacing: 12) {
            WebIconView(.bookmark, size: 15)
                .frame(width: 32, height: 32)
                .ink(C.inkMuted, scheme)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(FoleviTokens.Glass.hover.resolve(scheme).color))
            (Text("No bookmarks yet. ").foregroundStyle(C.ink.resolve(scheme).color) + Text("Bookmark a note from its \u{201C}…\u{201D} menu and it stays here, one click away.").foregroundStyle(C.inkMuted.resolve(scheme).color))
                .webText(.role(.subheadline))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
            .strokeBorder(C.line.resolve(scheme).color, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

/// Children left to right, wrapping onto the next line.
public struct HomeFlow: Layout {
    var spacing: CGFloat = 8
    public init(spacing: CGFloat = 8) { self.spacing = spacing }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { y += line + spacing; x = 0; line = 0 }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { y += line + spacing; x = bounds.minX; line = 0 }
            s.place(at: CGPoint(x: x, y: y + (line > 0 ? 0 : 0)), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
