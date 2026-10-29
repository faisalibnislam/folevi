// What the Mac's Tasks and Calendar screens share, drawn from the web's computed styles ("planner.*", read from
// the live app by packages/design-tokens/match/app-styles/planner.json): the styles and colours by name, the
// web's date words (lib/format.ts dueLabel, formatRelative, i18n formatCalendarDate), the segmented control
// (.ui-seg .ui-well), the small buttons, the empty states (ui/EmptyState.tsx), and the floating panels that hold
// Folevi's dialogs and popovers above the window (ui/Dialog.tsx, ui/Popover.tsx; never a system sheet).
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

// MARK: Styles

/// A planner style by its short name ("tasks.row" is "planner.tasks.row").
func PS(_ id: String) -> WebStylePair { WebStyles.named("planner.\(id)") }

/// A CSS colour variable of the app (light and dark), or a fallback.
func PV(_ name: String) -> ColorPair {
    WebStyles.vars[name] ?? WebStyles.vars["color-ink"] ?? ColorPair(light: RGBA(24, 24, 27, 1), dark: RGBA(240, 240, 242, 1))
}

extension ColorPair {
    func c(_ scheme: ColorScheme) -> Color { resolve(scheme).color }
}

extension WebComputedStyle {
    /// The element's text with another weight.
    func text(weight: CGFloat) -> WebTextStyle { text.weight(weight) }
}

/// `.webText` and the colour of a style in one go.
struct StyledText: View {
    let text: String
    let style: String
    var color: Color?
    var lines: Int? = 1
    @Environment(\.colorScheme) private var scheme

    init(_ text: String, _ style: String, color: Color? = nil, lines: Int? = 1) {
        self.text = text
        self.style = style
        self.color = color
        self.lines = lines
    }

    var body: some View {
        let s = PS(style).resolve(scheme)
        Text(text).webText(s.text).lineLimit(lines).foregroundStyle(color ?? s.color.color)
    }
}

// MARK: Dates as the web writes them

enum PlannerDates {
    static let utc = TimeZone(identifier: "UTC")!

    static func date(_ day: String) -> Date? { TaskDates.date(day) }

    /// Intl.DateTimeFormat in UTC with a template ("EEEE MMMM d" is { weekday: "long", month: "long", day: "numeric" }).
    static func format(_ day: String, _ template: String) -> String {
        guard let d = dateUTC(day) else { return day }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate(template)
        return f.string(from: d)
    }

    static func dateUTC(_ day: String) -> Date? {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        var c = DateComponents()
        c.year = p[0]; c.month = p[1]; c.day = p[2]
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = utc
        return cal.date(from: c)
    }

    /// lib/format.ts dueLabel: Today, Tomorrow, Yesterday, the weekday within a week, else "Oct 30".
    static func dueLabel(_ due: String, today: String) -> String {
        if due == today { return "Today" }
        let days = TaskDates.between(today, due)
        if days == 1 { return "Tomorrow" }
        if days == -1 { return "Yesterday" }
        if days > 1 && days < 7 { return format(due, "EEEE") }
        return format(due, "MMMd")
    }

    /// "Tuesday, October 27".
    static func long(_ day: String) -> String { format(day, "EEEEMMMMd") }

    /// lib/format.ts formatRelative.
    static func relative(_ ms: Double, now: Date = Date()) -> String {
        let nowMs = now.timeIntervalSince1970 * 1000
        let ahead = ms > nowMs
        func unit(_ n: Int, _ u: String) -> String {
            let words = "\(n) \(u)\(n == 1 ? "" : "s")"
            return ahead ? "in \(words)" : "\(words) ago"
        }
        let exact = abs(nowMs - ms) / 60_000
        let mins = ahead ? max(1, Int(exact.rounded())) : Int(exact.rounded())
        if mins < 1 { return "just now" }
        if mins < 60 { return unit(mins, "min") }
        let hours = Int((Double(mins) / 60).rounded())
        if hours < 24 { return unit(hours, "hour") }
        let days = Int((Double(hours) / 24).rounded())
        if days < 7 { return unit(days, "day") }
        let d = Date(timeIntervalSince1970: ms / 1000)
        let same = Calendar.current.component(.year, from: d) == Calendar.current.component(.year, from: now)
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.setLocalizedDateFormatFromTemplate(same ? "MMMd" : "MMMdyyyy")
        return f.string(from: d)
    }

    /// ui/DateField.tsx dateLabel: "Tue, Oct 27" (with the year when it isn't this year).
    static func fieldLabel(_ day: String) -> String {
        let thisYear = Calendar.current.component(.year, from: Date())
        let year = Int(day.prefix(4)) ?? thisYear
        return format(day, year == thisYear ? "EEEMMMd" : "EEEMMMdyyyy")
    }

    /// ui/DateField.tsx timeLabel: "9:15 AM".
    static func timeLabel(_ time: String) -> String {
        let p = time.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return time }
        let h12 = p[0] % 12 == 0 ? 12 : p[0] % 12
        return "\(h12):\(String(format: "%02d", p[1])) \(p[0] < 12 ? "AM" : "PM")"
    }

    /// calendarLayout.ts minutesToTime.
    static func time(_ minutes: Int) -> String {
        let m = min(max(0, minutes), 24 * 60 - 1)
        return String(format: "%02d:%02d", m / 60, m % 60)
    }

    /// The 42 days a month grid shows (six weeks from Monday) for a YYYY-MM.
    static func monthGrid(_ month: String) -> [String] {
        let first = TaskDates.startOfWeek("\(month)-01")
        return (0..<42).map { TaskDates.add(first, days: $0) }
    }

    static func shiftMonth(_ month: String, _ delta: Int) -> String {
        String(TaskDates.addMonths("\(month)-01", delta).prefix(7))
    }
}

// MARK: The segmented control (.ui-seg.ui-well)

struct SegItem: Identifiable {
    var id: String
    var title: String
    var count: Int?
}

/// `.ui-seg.ui-well` from its container and item styles: items share the width (`fill`) or fit their labels.
struct WebSeg: View {
    let items: [SegItem]
    let selected: String
    let base: String
    var fill = true
    var countStyle: String?
    let pick: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var hovered: String?

    var body: some View {
        let box = PS(base).resolve(scheme)
        HStack(spacing: box.gap) {
            ForEach(items) { item in
                let on = item.id == selected
                let style = PS(on ? "\(base).item.active" : "\(base).item")
                let s = style.resolve(scheme)
                Button { pick(item.id) } label: {
                    HStack(spacing: s.gap) {
                        Text(item.title).webText(s.text).lineLimit(1).fixedSize()
                        if let n = item.count, n > 0, let countStyle {
                            let cs = PS(on ? "\(countStyle).active" : countStyle)
                            let c = cs.resolve(scheme)
                            Text("\(n)").webText(c.text).monospacedDigit().lineLimit(1).fixedSize()
                                .foregroundStyle(c.color.color)
                                .padding(c.padding.edgeInsets)
                                .frame(height: c.height)
                                .webBox(cs)
                        }
                    }
                    .padding(s.padding.edgeInsets)
                    .frame(maxWidth: fill ? .infinity : nil)
                    .frame(height: s.height)
                    .foregroundStyle(on || hovered == item.id ? PV("color-heading").c(scheme) : s.color.color)
                    .webBox(style)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PlainPress())
                .onHover { hovered = $0 ? item.id : (hovered == item.id ? nil : hovered) }
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(box.padding.edgeInsets)
        .frame(height: box.height)
        .webBox(PS(base))
    }
}

/// No system highlight.
struct PlainPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Rectangle()).opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// A web button (.ui-btn) drawn from one of the planner's computed button styles, with an optional icon.
struct PlannerButton: View {
    let title: String
    var icon: WebIcon?
    var iconSize: CGFloat = 14
    let style: String
    var hover: String? = "mac-hover"
    var titleHidden = false
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    @State private var over = false

    init(_ title: String, icon: WebIcon? = nil, iconSize: CGFloat = 14, style: String, hover: String? = "mac-hover", action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.iconSize = iconSize
        self.style = style
        self.hover = hover
        self.action = action
    }

    var body: some View {
        let pair = PS(style)
        let s = pair.resolve(scheme)
        Button(action: action) {
            HStack(spacing: s.gap) {
                if let icon { WebIconView(icon, size: iconSize) }
                if !title.isEmpty { Text(title).webText(s.text).lineLimit(1).fixedSize() }
            }
            .padding(s.padding.edgeInsets)
            .frame(height: s.height)
            .frame(minWidth: title.isEmpty ? s.width : nil)
            .foregroundStyle(s.color.color)
            .webBox(pair)
            .overlay {
                if over, enabled, let hover, let h = WebStyles.vars[hover] {
                    RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(h.c(scheme)).allowsHitTesting(false)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainPress())
        .opacity(enabled ? s.opacity : 0.4)
        .onHover { over = $0 }
        .accessibilityLabel(title)
    }
}

/// A quiet 32 pt icon button (ui/Button.tsx IconButton at the page's size: the calendar's pager, a dialog's Close).
struct PlannerIconButton: View {
    let icon: WebIcon
    let label: String
    var style = "cal.prev"
    var size: CGFloat = 16
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        let s = PS(style).resolve(scheme)
        Button(action: action) {
            WebIconView(icon, size: size)
                .frame(width: s.width, height: s.height)
                .foregroundStyle(over ? PV("color-heading").c(scheme) : s.color.color)
                .background {
                    if over { RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(PV("glass-hover").c(scheme)) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }
}

// MARK: Empty states (ui/EmptyState.tsx)

struct PlannerEmpty: View {
    var icon: WebIcon?
    let title: String
    var message: String?
    var inline = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let heading = PV("color-heading").c(scheme)
        let muted = PV("color-ink-muted").c(scheme)
        VStack(spacing: 0) {
            if let icon {
                let tile = PS("empty.icon").resolve(scheme)
                WebIconView(icon, size: inline ? 16 : 19, strokeWidth: 1.9)
                    .foregroundStyle(heading)
                    .frame(width: inline ? 36 : tile.width, height: inline ? 36 : tile.height)
                    .background(RoundedRectangle(cornerRadius: tile.radius, style: .circular).fill(PV("glass-hover").c(scheme)))
                    .padding(.bottom, inline ? 12 : tile.margin.bottom)
            }
            if inline {
                Text(title).webText(.role(.body, weight: 600)).foregroundStyle(heading).multilineTextAlignment(.center)
                if let message {
                    PrettyText(message, WebTextStyle(size: 13, leading: 13 * 1.375), center: true).foregroundStyle(muted).padding(.top, 4)
                }
            } else {
                let t = PS("empty.title").resolve(scheme)
                Text(title).webText(t.text).foregroundStyle(t.color.color).multilineTextAlignment(.center)
                if let message {
                    PrettyText(message, WebTextStyle(size: 14, leading: 14 * 1.625), center: true).foregroundStyle(muted).padding(.top, 8)
                }
            }
        }
        .frame(maxWidth: 448)
        .padding(.horizontal, inline ? 16 : 24)
        .padding(.vertical, inline ? 32 : 64)
        .frame(maxWidth: .infinity)
    }
}

// MARK: The planner's text fields

/// A one-line input (.ui-input) from one of the planner's computed input styles, with the web's placeholder (the
/// text colour at half strength, Tailwind's preflight).
struct PlannerField: View {
    let placeholder: String
    @Binding var text: String
    var style = "tasks.filter"
    var focused: FocusState<Bool>.Binding?
    var onSubmit: () -> Void = {}
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let pair = PS(style)
        let s = pair.resolve(scheme)
        ZStack(alignment: .leading) {
            if text.isEmpty {
                Text(placeholder).webText(s.text).lineLimit(1).foregroundStyle(s.color.color.opacity(0.5)).allowsHitTesting(false)
            }
            field
                .textFieldStyle(.plain)
                .webText(s.text)
                .lineLimit(1)
                // AppKit's field editor sits 1.125 pt right of and 1 pt above where CSS puts an input's text.
                .offset(x: -1.125, y: 1.035)
                .onSubmit(onSubmit)
        }
        .padding(s.padding.edgeInsets)
        .frame(height: s.height)
        .foregroundStyle(s.color.color)
        .webBox(pair)
    }

    @ViewBuilder private var field: some View {
        if let focused {
            TextField("", text: $text).focused(focused)
        } else {
            TextField("", text: $text)
        }
    }
}

// MARK: Floating panels (dialogs and popovers above the window)

/// A borderless panel above a window holding a Folevi dialog or popover: Escape closes the top one, a click
/// outside it closes it (a dialog's backdrop is transparent on the Mac, as on the web).
@MainActor
final class PlannerPanel: NSPanel {
    private static var stack: [PlannerPanel] = []
    private var monitors: [Any] = []
    var onClose: (() -> Void)?
    /// Room around a popover for its shadow.
    static let margin: CGFloat = 32

    private init(content: AnyView, frame: NSRect) {
        super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .floating
        isReleasedWhenClosed = false
        let host = NSHostingView(rootView: content)
        host.safeAreaRegions = []
        contentView = host
    }

    override var canBecomeKey: Bool { true }

    /// A dialog: the whole window, the dialog centred across it and `top` points from the window's top.
    @discardableResult
    static func dialog<V: View>(in window: NSWindow, top: CGFloat = 56, @ViewBuilder _ content: (_ close: @escaping @MainActor () -> Void) -> V) -> PlannerPanel {
        var panel: PlannerPanel?
        let close: @MainActor () -> Void = { panel?.close() }
        let view = ZStack(alignment: .top) {
            Color.black.opacity(0.001).onTapGesture { close() }
            content(close).padding(.top, top)
        }
        .frame(width: window.frame.width, height: window.contentLayoutRect.height + (window.frame.height - window.contentLayoutRect.height), alignment: .top)
        .environment(\.colorScheme, window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light)
        let p = PlannerPanel(content: AnyView(view), frame: window.frame)
        panel = p
        p.present(in: window)
        return p
    }

    /// A popover under (or above) a view: its top-left at the view's bottom-left, `gap` below.
    @discardableResult
    static func popover<V: View>(below anchor: NSView, gap: CGFloat = 4, alignEnd: Bool = false, @ViewBuilder _ content: (_ close: @escaping @MainActor () -> Void) -> V) -> PlannerPanel? {
        guard let window = anchor.window else { return nil }
        var panel: PlannerPanel?
        let close: @MainActor () -> Void = { panel?.close() }
        let scheme: ColorScheme = window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light
        let view = content(close).padding(margin).environment(\.colorScheme, scheme)
        let host = NSHostingView(rootView: view)
        let size = host.fittingSize
        let r = window.convertToScreen(anchor.convert(anchor.bounds, to: nil))
        var origin = NSPoint(x: (alignEnd ? r.maxX - size.width + margin : r.minX - margin), y: r.minY - gap - size.height + margin)
        if let visible = (window.screen ?? NSScreen.main)?.visibleFrame {
            origin.x = min(max(origin.x, visible.minX - margin), visible.maxX - size.width + margin)
            if origin.y + margin < visible.minY { origin.y = r.maxY + gap - margin }
        }
        let p = PlannerPanel(content: AnyView(view), frame: NSRect(origin: origin, size: size))
        panel = p
        p.present(in: window)
        return p
    }

    private func present(in window: NSWindow) {
        appearance = window.appearance
        window.addChildWindow(self, ordered: .above)
        makeKeyAndOrderFront(nil)
        Self.stack.append(self)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            guard let self, Self.stack.last === self else { return event }
            // A click in this panel, or in a menu or popover opened from it, stays.
            var w: NSWindow? = event.window
            while let cur = w {
                if cur === self { return event }
                w = cur.parent
            }
            if event.window is WebMenuWindow { return event }
            self.close()
            return event
        } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, Self.stack.last === self, WebMenuWindow.shown == nil else { return event }
            if event.keyCode == 53 || (event.charactersIgnoringModifiers == "." && event.modifierFlags.contains(.command)) {
                self.close()
                return nil
            }
            return event
        } as Any)
    }

    override func close() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
        Self.stack.removeAll { $0 === self }
        let parentWindow = parent
        parentWindow?.removeChildWindow(self)
        super.close()
        parentWindow?.makeKey()
        let done = onClose
        onClose = nil
        done?()
    }

    /// The panel on top, if any (tests).
    static var top: PlannerPanel? { stack.last }
}

/// Holds the NSView a SwiftUI control sits on (to open a panel or a menu at it).
final class PlannerAnchor {
    weak var view: NSView?
}

extension View {
    /// Keeps the control's own NSView in `anchor` (for popovers and menus opened from it).
    func plannerAnchor(_ anchor: PlannerAnchor) -> some View {
        background(MenuAnchor { anchor.view = $0 })
    }
}

// MARK: The dialog's frame (ui/Dialog.tsx on the Mac)

/// The web dialog: a pop surface, title (Spectral) and Close, an optional description, then the body.
struct PlannerDialog<Content: View>: View {
    let title: String
    var description: String?
    let close: () -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let panel = PS("dialog")
        let p = panel.resolve(scheme)
        let header = PS("dialog.header").resolve(scheme)
        let body = PS("dialog.body").resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: header.gap) {
                VStack(alignment: .leading, spacing: 0) {
                    StyledText(title, "dialog.title", lines: nil)
                    if let description {
                        let d = PS("quick.description").resolve(scheme)
                        PrettyText(description, d.text).foregroundStyle(d.color.color).padding(.top, d.margin.top)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                PlannerIconButton(icon: .x, label: "Close", style: "dialog.close", action: close)
            }
            .padding(header.padding.edgeInsets)
            content()
                .padding(body.padding.edgeInsets)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(width: p.width)
        .foregroundStyle(p.color.color)
        .background(WebMaterial(radius: p.radius))
        .webBox(panel)
        .clipShape(RoundedRectangle(cornerRadius: p.radius, style: .circular).inset(by: -40))
    }
}

/// The blur behind a pop surface (.ui-pop's backdrop-filter), under its translucent fill.
struct WebMaterial: View {
    let radius: CGFloat
    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .circular).fill(.regularMaterial)
    }
}
#endif

// MARK: Paragraphs (`p { text-wrap: pretty }`)

#if os(macOS)
/// The web's paragraphs wrap with `text-wrap: pretty`: as many lines as plain wrapping takes, the breaks moved so
/// the lines come out even (no word alone on the last line). Lines are measured with the style's font and
/// tracking, the breaks chosen by least squared slack (the last line's at three quarters), and the text drawn with those breaks.
enum PrettyWrap {
    static func measure(_ s: Substring, _ style: WebTextStyle) -> CGFloat {
        let attr = NSAttributedString(string: String(s), attributes: [.font: style.ctFont as Any, .kern: style.letterSpacing])
        let line = CTLineCreateWithAttributedString(attr)
        return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }

    static func lines(_ text: String, _ style: WebTextStyle, width: CGFloat, lastWeight: CGFloat = 0.75) -> String {
        guard width > 0, !text.contains("\n") else { return text }
        let words = text.split(separator: " ", omittingEmptySubsequences: false)
        guard words.count > 2 else { return text }
        let w = words.map { measure($0, style) }
        let space = measure(" ", style)
        func span(_ i: Int, _ j: Int) -> CGFloat { // words i..<j on one line
            var s: CGFloat = 0
            for k in i..<j { s += w[k] }
            return s + CGFloat(j - i - 1) * space
        }
        let limit = width - 0.5
        // Plain wrapping's line count.
        var count = 0, i = 0
        while i < words.count {
            var j = i + 1
            while j < words.count, span(i, j + 1) <= limit { j += 1 }
            count += 1
            i = j
        }
        guard count > 1 else { return text }
        let n = words.count
        // best[k][i]: least cost to set words i..<n in k lines.
        var best = Array(repeating: Array(repeating: CGFloat.infinity, count: n + 1), count: count + 1)
        var next = Array(repeating: Array(repeating: n, count: n + 1), count: count + 1)
        best[0][n] = 0
        for k in 1...count {
            for i in stride(from: n - 1, through: 0, by: -1) {
                for j in (i + 1)...n {
                    let s = span(i, j)
                    if s > limit { break }
                    let rest = best[k - 1][j]
                    if rest == .infinity { continue }
                    let slack = limit - s
                    // The last line's slack counts three quarters (WebKit lets it be shorter; fitted to the web frame's breaks).
                    let c = slack * slack * (j == n ? lastWeight : 1) + rest
                    if c < best[k][i] { best[k][i] = c; next[k][i] = j }
                }
            }
        }
        guard best[count][0] < .infinity else { return text }
        var out: [String] = []
        var at = 0, k = count
        while at < n, k > 0 {
            let j = next[k][at]
            out.append(words[at..<j].joined(separator: " "))
            at = j
            k -= 1
        }
        return out.joined(separator: "\n")
    }
}

/// A paragraph in a web text style that wraps as the web's `text-wrap: pretty` does.
struct PrettyText: View {
    let text: String
    let style: WebTextStyle
    var strike = false
    var center = false
    @State private var width: CGFloat = 0

    init(_ text: String, _ style: WebTextStyle, strike: Bool = false, center: Bool = false) {
        self.text = text
        self.style = style
        self.strike = strike
        self.center = center
    }

    var body: some View {
        Text(PrettyWrap.lines(text, style, width: width))
            .strikethrough(strike)
            .webText(style)
            .multilineTextAlignment(center ? .center : .leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: center ? .center : .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}
#endif
