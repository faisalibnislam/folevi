// Quick Add in Folevi for Mac (the floating panel, apps/mac QuickAddPanel.swift), as the web's
// components/app/MacQuickAdd.tsx works, in the system's type, colours, symbols and controls (owner decision
// 2026-11-18: the priority a segmented control, the place a pop-up button): one field that grows. A 56 pt row holds
// an empty checkbox, the task's words and, at the end, where it goes ("Inbox", or a page). Words become chips as
// they're typed: a day or time ("tomorrow 9am"), a repeat, a priority ("!high") and a page ("#Atlas"), each with a
// × that keeps its words as text. A second row (the chips, then their editors) appears only once there's
// something in it. Return adds and closes, Command-Return adds and opens its page in the main window, Shift-Return
// adds and stays for another; Escape puts an editor away, then closes. After adding, "Added to Inbox" shows for a
// moment with Open. The panel is as tall as this (the host sizes it); the material is the panel's own.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// A colour of the panel: the page's, with the translucent panel's own (globals.css `[data-vibrancy] .mac-quick-add`:
/// lines and hovers that let the material through, and lighter text in dark).
func qaColor(_ name: String, _ scheme: ColorScheme) -> RGBA {
    let dark = scheme == .dark
    switch name {
    case "mac-hover": return dark ? RGBA(255, 255, 255, 0.1) : RGBA(0, 0, 0, 0.06)
    case "mac-press": return dark ? RGBA(255, 255, 255, 0.16) : RGBA(0, 0, 0, 0.1)
    case "color-line": return dark ? RGBA(255, 255, 255, 0.12) : RGBA(0, 0, 0, 0.1)
    case "color-ink-muted" where dark: return RGBA(255, 255, 255, 0.66)
    case "color-ink-faint" where dark: return RGBA(255, 255, 255, 0.48)
    default: return PV(name).resolve(scheme)
    }
}

/// A colour of the panel as a SwiftUI colour: on the Mac the system's semantic colours (owner decision 2026-11-18,
/// docs/MAC_NATIVE_LOOK.md), elsewhere the panel's web colours (qaColor).
func qaInk(_ name: String, _ scheme: ColorScheme) -> Color {
    #if os(macOS)
    switch name {
    case "color-heading", "color-ink": return MacLook.Colors.label
    case "color-ink-muted": return MacLook.Colors.secondary
    case "color-ink-faint": return MacLook.Colors.tertiary
    case "color-line": return MacLook.Colors.separator
    case "color-line-strong": return MacLook.Colors.tertiary
    case "mac-hover": return MacLook.Colors.hover.opacity(0.7)
    case "mac-press": return MacLook.Colors.hover
    case "color-danger": return MacLook.Colors.red
    case "color-canvas": return MacLook.Colors.onAccent
    default: return qaColor(name, scheme).color
    }
    #else
    return qaColor(name, scheme).color
    #endif
}

/// Quick Add's text roles: the system font on the Mac (11, 13 or 15 pt), the web's styles elsewhere.
enum QAText {
    case small, body, bodyStrong, title3

    var web: WebTextStyle {
        switch self {
        case .small: .role(.footnote)
        case .body: .role(.subheadline)
        case .bodyStrong: .role(.body, weight: 600)
        case .title3: .role(.title3)
        }
    }

    #if os(macOS)
    var font: Font {
        switch self {
        case .small: MacLook.Text.small
        case .body: MacLook.Text.body
        case .bodyStrong: MacLook.Text.body.weight(.semibold)
        case .title3: MacLook.Text.title3
        }
    }
    #endif
}

extension View {
    /// Quick Add's text in `role` (the system font on the Mac); `web` overrides the web style off the Mac.
    func qaText(_ role: QAText, web: WebTextStyle? = nil) -> some View {
        #if os(macOS)
        font(role.font)
        #else
        webText(web ?? role.web)
        #endif
    }
}

/// Quick Add's icons: the closest SF Symbol on the Mac, the web's drawing elsewhere.
struct QAIcon: View {
    let icon: WebIcon
    let size: CGFloat
    var strokeWidth: CGFloat = 2
    init(_ icon: WebIcon, size: CGFloat, strokeWidth: CGFloat = 2) {
        self.icon = icon
        self.size = size
        self.strokeWidth = strokeWidth
    }

    var body: some View {
        #if os(macOS)
        // (Folevi's own icons, as the web's Quick Add: the owner, 2026-11-18.)
        WebIconView(icon, size: size, strokeWidth: strokeWidth)
        #else
        WebIconView(icon, size: size, strokeWidth: strokeWidth)
        #endif
    }
}

/// A button style for Quick Add's chips: plain on the Mac (the chip draws the system's hover), the glass hover
/// elsewhere.
struct QAChipStyle: ButtonStyle {
    var radius: CGFloat = 8
    var selected = false
    func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
        configuration.label.opacity(configuration.isPressed ? 0.7 : 1)
        #else
        WebHoverButtonStyle.webHover(radius: radius, selected: selected).makeBody(configuration: configuration)
        #endif
    }
}

/// An input's box: on the Mac a quiet rounded fill with the separator's hairline (the panel's material shows
/// through), elsewhere the web's `.ui-input`.
struct QAFieldBox: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content
            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(MacLook.Colors.hover.opacity(0.45)))
            .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(MacLook.Colors.separator))
        #else
        content.webBox(WebStyles.named("input"))
        #endif
    }
}

/// Several places (docs/MULTI_ACCOUNT_PLAN.md §6, DesktopQuickAdd.tsx QuickAddPlace): which place the task goes
/// to, over the page picker. Picking another opens Quick Add again in that place (the host's `pick`).
public struct QuickAddPlaces {
    public struct Option: Hashable {
        public var id: String
        public var label: String
        public init(id: String, label: String) {
            self.id = id
            self.label = label
        }
    }

    public var options: [Option]
    public var current: String?
    public var pick: (String) -> Void
    public init(options: [Option], current: String?, pick: @escaping (String) -> Void) {
        self.options = options
        self.current = current
        self.pick = pick
    }
}

public struct WebQuickAddPanel: View {
    @Bindable var model: QuickAddModel
    let close: () -> Void
    /// Opens a page in the main window (Command-Return, Open), then the host closes the panel.
    let openPage: (String?) -> Void
    /// The place picker, when there are several places.
    let places: QuickAddPlaces?

    enum Editor { case date, priority, page }
    enum After { case close, again }

    @State private var editor: Editor?
    @State private var details = false
    @State private var after: After = .close
    /// Asks the field for the keyboard (each change).
    @State private var focusTick = 0
    @AppStorage("folevi.quickAddHintSeen") private var hintSeen = false
    @Environment(\.colorScheme) private var scheme

    public init(model: QuickAddModel, places: QuickAddPlaces? = nil, close: @escaping () -> Void, openPage: @escaping (String?) -> Void) {
        self.model = model
        self.places = places
        self.close = close
        self.openPage = openPage
    }

    #if DEBUG
    public static let debugPageEditor = Notification.Name("folevi.quickAdd.debugPageEditor")
    #endif

    /// The web's priority tones (MacQuickAdd.tsx PRIORITIES).
    static let priorities: [(TaskCreateArgs.Priority?, String, RGBA?)] = [
        (nil, "None", nil), (.low, "Low", RGBA(0x5B, 0x6A, 0xD0)), (.medium, "Medium", RGBA(0xC5, 0x8A, 0x12)), (.high, "High", RGBA(0xD6, 0x45, 0x3D)),
    ]

    private func v(_ name: String) -> Color { qaInk(name, scheme) }
    /// `text-subheadline leading-none` (the chips).
    static let chipText = WebTextStyle(size: 13, leading: 13)

    public var body: some View {
        Group {
            if let added = model.added {
                addedRow(added)
            } else {
                form
            }
        }
        .frame(width: 640, alignment: .topLeading)
        .background(hiddenKeys)
        #if DEBUG
        // Scripts open the page editor as a click on the page chip would (ChromeEval `quickAdd {"action": "pageEditor"}`).
        .onReceive(NotificationCenter.default.publisher(for: WebQuickAddPanel.debugPageEditor)) { _ in editor = .page }
        #endif
        .onChange(of: model.added) { _, added in
            guard added != nil else { return }
            hintSeen = true
            let stay = after == .again
            after = .close
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1.2))
                guard model.added == added else { return }
                model.clearAdded()
                if stay { focusTick += 1 } else { close() }
            }
        }
        .onChange(of: model.round) { _, _ in
            editor = nil
            details = false
            focusTick += 1
        }
        .onAppear {
            model.readsTokens = true
            model.start()
            focusTick += 1
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Quick add task")
        .accessibilityIdentifier("quick-add")
    }

    // MARK: The form

    /// A picked day and time ("Tomorrow, 9:00 AM"), else the words' ("Tomorrow, 09:00": naturalDateLabel writes
    /// the parsed time as it is).
    private var dateLabel: String? {
        let today = model.session.value?.today
        if let due = model.dueDate {
            let day = WebQuickAddPanel.dayLabel(due, today: today)
            return model.dueTime.map { "\(day), \(WebQuickAddPanel.clock($0))" } ?? day
        }
        guard !model.keepText, let p = model.parsed, let date = p.dueDate else { return nil }
        let day = WebQuickAddPanel.dayLabel(date, today: today)
        return p.dueTime.map { "\(day), \($0)" } ?? day
    }

    private var repeatLabel: String? { model.keepText ? nil : model.parsed?.repeatLabel }

    private var hasChips: Bool { dateLabel != nil || repeatLabel != nil || model.effectivePriority != nil }
    private var second: Bool { hasChips || details || editor != nil }

    private var form: some View {
        VStack(alignment: .leading, spacing: 0) {
            firstRow
            if second {
                secondRow
            }
            switch editor {
            case .date?: dateEditor
            case .priority?: priorityEditor
            case .page?: pageEditor
            case nil: EmptyView()
            }
            if !hintSeen, !second, editor == nil {
                Text("Return adds it, \u{2318}Return opens it too. Try \u{201C}tomorrow 9am\u{201D}, \u{201C}!high\u{201D} or \u{201C}#page\u{201D}.")
                    .qaText(.small)
                    .lineLimit(1)
                    .foregroundStyle(v("color-ink-faint"))
                    .padding(.leading, 48).padding(.trailing, 16).padding(.bottom, 10)
                    .padding(.top, -8)
                    .accessibilityIdentifier("quick-add-hint")
            }
        }
    }

    /// The 56 pt row: the checkbox outline, the field, where it goes.
    private var firstRow: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(v("color-line-strong"), lineWidth: 1.5)
                .frame(width: 20, height: 20)
                .accessibilityHidden(true)
                .accessibilityHidden(true)
            PanelField(text: $model.text, placeholder: "New task", ink: qaColor("color-heading", scheme), faint: qaColor("color-ink-faint", scheme), focusTick: focusTick, submit: { key in
                switch key {
                case .plain: add(.close)
                case .shift: add(.again)
                case .command: addAndOpen()
                }
            }, escape: escape)
                // (Its own line height, centred in the input's 40 pt, as the input centres its 24 pt line.)
                .fixedSize(horizontal: false, vertical: true)
                .frame(height: 40)
                .background(alignment: .leading) {
                    // The placeholder where the typed words stand (the cell's own sits 2 pt higher).
                    if model.text.isEmpty {
                        Text("New task").qaText(.title3).lineLimit(1)
                            .foregroundStyle(v("color-ink-faint"))
                            .padding(.leading, PanelField.inset)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .accessibilityLabel("New task")
                .accessibilityIdentifier("quick-add-field")
            HStack(spacing: 4) {
                placeChip
                if let token = model.tokens.page {
                    removeButton("Keep \u{201C}\(token.text)\u{201D} as text") { model.keep(token.text) }
                }
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
    }

    private var placeChip: some View {
        let target = model.destination.noteId != nil
        let label = model.pageTokenMissing ? "No page \u{201C}\(model.tokens.page?.query ?? "")\u{201D}" : model.destinationLabel
        return Button { toggle(.page) } label: {
            HStack(spacing: 6) {
                QAIcon(target ? .fileText : .inbox, size: 14)
                Text(label).qaText(.body, web: Self.chipText).lineLimit(1).truncationMode(.tail)
            }
            .padding(.leading, 10).padding(.trailing, model.tokens.page != nil ? 6 : 10)
            .frame(height: 28)
            .frame(maxWidth: 192, alignment: .leading)
            .fixedSize()
            .foregroundStyle(target ? v("color-heading") : v("color-ink-muted"))
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(v("mac-hover")))
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(QAChipStyle())
        .accessibilityLabel("Adds to \(label), change")
        .accessibilityIdentifier("quick-add-place")
    }

    /// The chips (and quiet buttons for what isn't set yet), under a line.
    private var secondRow: some View {
        HStack(spacing: 6) {
            if let r = repeatLabel {
                chip(set: true, trailing: -6, remove: removeButton("Keep the repeat as text") { model.keepDateAsText() }) {
                    HStack(spacing: 6) {
                        QAIcon(.repeat, size: 13)
                        Text(r).qaText(.body, web: Self.chipText).lineLimit(1)
                    }
                }
            }
            chip(set: dateLabel != nil, remove: dateRemove) {
                Button { toggle(.date) } label: {
                    chipLabel(.calendarDays, dateLabel.map { "Due \($0)" } ?? "Date", tone: nil)
                }
                .buttonStyle(QAChipStyle())
                .accessibilityIdentifier("quick-add-date")
            }
            let p = Self.priorities.first { $0.0 == model.effectivePriority } ?? Self.priorities[0]
            chip(set: model.effectivePriority != nil, remove: priorityRemove) {
                Button { toggle(.priority) } label: {
                    chipLabel(.flag, model.effectivePriority == nil ? "Priority" : p.1, tone: p.2)
                }
                .buttonStyle(QAChipStyle())
                .accessibilityIdentifier("quick-add-priority")
            }
            Spacer(minLength: 0)
            if let e = model.error {
                Text(e).qaText(.small).lineLimit(1).foregroundStyle(v("color-danger"))
                    .accessibilityIdentifier("quick-add-error")
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 47)
        .overlay(alignment: .top) { Rectangle().fill(v("color-line")).frame(height: 1).offset(y: -1) }
        .padding(.top, 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Task details")
    }

    /// The date chip's ×: a picked date goes; a date read from the words stays as text.
    private var dateRemove: RemoveButton? {
        if model.dueDate != nil {
            return removeButton("Remove the date") {
                model.dueDate = nil
                model.dueTime = nil
            }
        }
        guard model.parsed?.dueDate != nil, !model.keepText else { return nil }
        return removeButton("Keep \u{201C}\(model.parsed?.dateText?.trimmingCharacters(in: .whitespaces) ?? "")\u{201D} as text") { model.keepDateAsText() }
    }

    /// The priority chip's ×: a "!high" token stays as text; a picked one goes.
    private var priorityRemove: RemoveButton? {
        guard model.effectivePriority != nil else { return nil }
        return removeButton(model.tokens.priority.map { "Keep \u{201C}\($0.text)\u{201D} as text" } ?? "Remove the priority") {
            if let t = model.tokens.priority?.text { model.keep(t) }
            model.priority = nil
        }
    }

    /// A chip: the mac-hover fill once set, muted text until then; its × (when it has one) `trailing` from the end.
    /// The date and priority chips' buttons pad 10 pt inside the chip's own 10 pt, as the web's classes do.
    private func chip<Label: View>(set: Bool, trailing: CGFloat = 4, remove: RemoveButton? = nil, @ViewBuilder label: () -> Label) -> some View {
        HStack(spacing: 6) {
            label()
            if let remove { remove.padding(.trailing, trailing) }
        }
        .padding(.horizontal, 10)
        .frame(height: 28)
        .foregroundStyle(set ? v("color-heading") : v("color-ink-muted"))
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(set ? v("mac-hover") : .clear))
        .fixedSize()
    }

    private func chipLabel(_ icon: WebIcon, _ title: String, tone: RGBA?) -> some View {
        HStack(spacing: 6) {
            QAIcon(icon, size: 13).foregroundStyle(tone.map { AnyShapeStyle($0.color) } ?? AnyShapeStyle(.foreground))
            Text(title).qaText(.body, web: Self.chipText).lineLimit(1)
        }
        .padding(.horizontal, 10)
        .frame(height: 28)
        .contentShape(Rectangle())
    }

    private func removeButton(_ label: String, _ action: @escaping () -> Void) -> RemoveButton {
        RemoveButton(label: label, action: action)
    }

    private func toggle(_ e: Editor) {
        editor = editor == e ? nil : e
        if editor == nil { focusTick += 1 }
    }

    // MARK: Editors

    private var dateEditor: some View {
        HStack(spacing: 8) {
            QuickAddDateField(model: model)
            if model.effectiveDueDate != nil { QuickAddTimeField(model: model) }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        // (`border-t`: the line takes its point before the editor.)
        .padding(.top, 1)
        .overlay(alignment: .top) { Rectangle().fill(v("color-line")).frame(height: 1) }
    }

    private var priorityEditor: some View {
        #if os(macOS)
        // The system's segmented control.
        Picker("Priority", selection: Binding(get: { model.effectivePriority?.rawValue ?? "" }, set: { raw in
            let level = Self.priorities.first { ($0.0?.rawValue ?? "") == raw }?.0
            if let t = model.tokens.priority, t.level.rawValue != level?.rawValue { model.keep(t.text) }
            model.priority = level
            editor = nil
            focusTick += 1
        })) {
            ForEach(Self.priorities, id: \.1) { p in Text(p.1).tag(p.0?.rawValue ?? "") }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal, 16).padding(.bottom, 12).padding(.top, 10)
        .accessibilityLabel("Priority")
        #else
        priorityEditorDrawn
        #endif
    }

    private var priorityEditorDrawn: some View {
        let base = "edit.seg"
        let box = PS(base).resolve(scheme)
        return HStack(spacing: box.gap) {
            ForEach(Self.priorities, id: \.1) { p in
                let on = p.0 == model.effectivePriority
                let style = PS(on ? "\(base).item.active" : "\(base).item")
                let s = style.resolve(scheme)
                Button {
                    if let t = model.tokens.priority, t.level.rawValue != p.0?.rawValue { model.keep(t.text) }
                    model.priority = p.0
                    editor = nil
                    focusTick += 1
                } label: {
                    HStack(spacing: 6) {
                        if let tone = p.2 { QAIcon(.flag, size: 12).foregroundStyle(tone.color) }
                        Text(p.1).webText(s.text).lineLimit(1).fixedSize()
                    }
                    .padding(s.padding.edgeInsets)
                    .frame(maxWidth: .infinity)
                    .frame(height: s.height)
                    .foregroundStyle(on ? v("color-heading") : s.color.color)
                    .webBox(style)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.webHover(radius: s.radius, selected: on))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(box.padding.edgeInsets)
        .frame(height: box.height)
        .webBox(PS(base))
        .padding(.horizontal, 12).padding(.bottom, 12).padding(.top, 10)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Priority")
    }

    private var pageEditor: some View {
        VStack(alignment: .leading, spacing: 0) {
            // `mb-3 flex items-center gap-2 text-subheadline text-muted`, its Select `min-w-0 flex-1` (DesktopQuickAdd.tsx).
            if let places, places.options.count > 1 {
                HStack(spacing: 8) {
                    Text("Add to").qaText(.body).fixedSize()
                    #if os(macOS)
                    // The system's pop-up button.
                    Picker("Add to", selection: Binding(get: { places.current ?? "" }, set: { places.pick($0) })) {
                        ForEach(places.options, id: \.id) { o in Text(o.label).tag(o.id) }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .controlSize(.small)
                    .fixedSize()
                    .accessibilityLabel("Add to")
                    .accessibilityIdentifier("quick-add-place")
                    Spacer(minLength: 0)
                    #else
                    // The web's Select with no box of its own here: the label, then its chevron at the far end.
                    GeometryReader { g in
                        WebMenuButton(select: true, entries: {
                            places.options.map { o in WebMenuEntry(.item(o.label, checked: o.id == places.current, id: o.id)) { places.pick(o.id) } }
                        }) {
                            HStack(spacing: 6) {
                                Text(places.options.first { $0.id == places.current }?.label ?? "").qaText(.body).lineLimit(1).truncationMode(.tail)
                                Spacer(minLength: 0)
                                QAIcon(.chevronDown, size: 14).opacity(0.6)
                            }
                            .contentShape(Rectangle())
                        }
                    }
                    .frame(height: WebTextStyle.role(.subheadline).leading)
                    .accessibilityLabel("Add to")
                    .accessibilityIdentifier("quick-add-place")
                    #endif
                }
                .foregroundStyle(v("color-ink-muted"))
                // (Its mb-3 collapses with the picker's mt-3: the picker's own top padding is the gap.)
            }
            QuickAddPagePicker(model: model) {
                editor = nil
                focusTick += 1
            }
        }
        // (`border-t`: the line takes its point before the editor.)
        .padding(.top, 1)
        .padding(.horizontal, 16).padding(.bottom, 12)
        .overlay(alignment: .top) { Rectangle().fill(v("color-line")).frame(height: 1) }
    }

    // MARK: Added

    private func addedRow(_ added: QuickAddModel.Added) -> some View {
        HStack(spacing: 12) {
            QAIcon(.check, size: 13, strokeWidth: 3)
                .foregroundStyle(v("color-canvas"))
                .frame(width: 20, height: 20)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(v("color-heading")))
                .accessibilityHidden(true)
            HStack(spacing: 0) {
                Text("Added to ").qaText(.body, web: .role(.body)).foregroundStyle(v("color-ink")).fixedSize()
                Text(added.label).qaText(.bodyStrong).foregroundStyle(v("color-heading")).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            openButton(added)
            .accessibilityIdentifier("quick-add-open")
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
        .accessibilityIdentifier("quick-add-confirmation")
    }

    @ViewBuilder
    private func openButton(_ added: QuickAddModel.Added) -> some View {
        #if os(macOS)
        Button("Open") {
            model.clearAdded()
            openPage(added.noteId)
        }
        .controlSize(.small)
        #else
        WebButton("Open", variant: .secondary, size: .sm) {
            model.clearAdded()
            openPage(added.noteId)
        }
        #endif
    }

    // MARK: Keys

    private func add(_ mode: After) {
        guard model.canSave else { return }
        after = mode
        Task { await model.save(keepOpen: mode == .again) }
    }

    private func addAndOpen() {
        guard model.canSave else { return }
        Task { await model.save(open: true) }
    }

    /// Escape: an editor goes first, then the panel.
    private func escape() {
        if editor != nil {
            editor = nil
            focusTick += 1
        } else {
            close()
        }
    }

    /// Shift-Return and Command-Return from the second row too, and Escape there (the field reads its own keys).
    private var hiddenKeys: some View {
        Group {
            Button("") { add(.again) }.keyboardShortcut(.return, modifiers: .shift)
            Button("", action: addAndOpen).keyboardShortcut(.return, modifiers: .command)
            Button("", action: escape).keyboardShortcut(.cancelAction)
        }
        .opacity(0)
        .accessibilityHidden(true)
    }

    // MARK: Words

    /// lib/format.ts dueLabel: "Today", "Tomorrow", "Yesterday", the weekday within the week ahead ("Friday"),
    /// else "Nov 3", in the language WebKit uses (the Mac's first preferred one).
    static func dayLabel(_ ymd: String, today: String?) -> String {
        if ymd == today { return "Today" }
        // (Formatters are kept: this runs on every key typed into Quick Add, and made three each time.)
        let f = PlannerDates.Formatters.shared.cached("quickadd.ymd") {
            let f = DateFormatter()
            f.calendar = Calendar(identifier: .gregorian)
            f.timeZone = TimeZone(identifier: "UTC")
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd"
            return f
        }
        guard let d = f.date(from: ymd) else { return ymd }
        let language = Locale.preferredLanguages.first ?? "en-US"
        func out(_ template: String) -> DateFormatter {
            PlannerDates.Formatters.shared.cached("quickadd.out.\(template).\(language)") {
                let out = DateFormatter()
                out.timeZone = TimeZone(identifier: "UTC")
                out.locale = Locale(identifier: language)
                out.setLocalizedDateFormatFromTemplate(template)
                return out
            }
        }
        if let today, let t = f.date(from: today) {
            let days = Int((d.timeIntervalSince(t) / 86_400).rounded())
            if days == 1 { return "Tomorrow" }
            if days == -1 { return "Yesterday" }
            if days > 1, days < 7 { return out("EEEE").string(from: d) }
        }
        return out("MMM d").string(from: d)
    }

    /// "09:00" or "9:00 AM", as the page writes a time (toLocaleTimeString with `hour: "numeric", minute:
    /// "2-digit"`), in the language WebKit uses: the Mac's first preferred one.
    static func clock(_ hhmm: String) -> String {
        // (Kept: the list of times asks for all 96 quarter hours at once, which made 192 formatters a click.)
        let f = PlannerDates.Formatters.shared.cached("quickadd.hhmm") {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "HH:mm"
            return f
        }
        guard let d = f.date(from: hhmm) else { return hhmm }
        let language = Locale.preferredLanguages.first ?? "en-US"
        let out = PlannerDates.Formatters.shared.cached("quickadd.clock.\(language)") {
            let out = DateFormatter()
            out.locale = Locale(identifier: language)
            out.setLocalizedDateFormatFromTemplate("jmm")
            return out
        }
        return out.string(from: d)
    }
}

#if os(macOS)
/// The task's field: an AppKit text field in the system font (15 pt, the label colour; the placeholder tertiary),
/// reading Return, Shift-Return, Command-Return and Escape itself.
private struct PanelField: NSViewRepresentable {
    enum Key { case plain, shift, command }

    @Binding var text: String
    let placeholder: String
    let ink: RGBA
    let faint: RGBA
    let focusTick: Int
    let submit: (Key) -> Void
    let escape: () -> Void

    /// The system font at 15 pt (MacLook.Text.title3), the system's tracking (2026-11-18).
    static let font = NSFont.preferredFont(forTextStyle: .title3)
    /// Where the field editor starts the text.
    static let inset: CGFloat = 0
    static let kern: CGFloat = 0

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField()
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = Self.font
        field.lineBreakMode = .byClipping
        field.usesSingleLineMode = true
        field.cell?.isScrollable = true
        field.delegate = context.coordinator
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        context.coordinator.parent = self
        let attrs: [NSAttributedString.Key: Any] = [.font: Self.font, .kern: Self.kern, .foregroundColor: Self.ns(ink)]
        if field.currentEditor() == nil, field.stringValue != text {
            field.attributedStringValue = NSAttributedString(string: text, attributes: attrs)
        } else if let editor = field.currentEditor() as? NSTextView, editor.string != text {
            editor.string = text
            Coordinator.style(editor, attrs)
        }
        field.textColor = Self.ns(ink)
        if context.coordinator.tick != focusTick {
            context.coordinator.tick = focusTick
            DispatchQueue.main.async {
                guard let window = field.window else { return }
                window.makeFirstResponder(field)
                if let editor = field.currentEditor() as? NSTextView { Coordinator.style(editor, attrs) }
            }
        }
    }

    /// The text's colour: the system's label colour (the panel's own ink is no longer used on the Mac).
    static func ns(_ c: RGBA) -> NSColor { .labelColor }

    @MainActor
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: PanelField
        var tick = Int.min

        init(_ parent: PanelField) { self.parent = parent }

        var attrs: [NSAttributedString.Key: Any] { [.font: PanelField.font, .kern: PanelField.kern, .foregroundColor: PanelField.ns(parent.ink)] }

        /// The field editor's text and what's typed next, spaced as the web spaces it.
        static func style(_ editor: NSTextView, _ attrs: [NSAttributedString.Key: Any]) {
            editor.typingAttributes = attrs
            editor.insertionPointColor = attrs[.foregroundColor] as? NSColor ?? .textColor
            if let storage = editor.textStorage, storage.length > 0 { storage.addAttributes(attrs, range: NSRange(location: 0, length: storage.length)) }
        }

        func controlTextDidBeginEditing(_ obj: Notification) {
            if let editor = (obj.object as? NSTextField)?.currentEditor() as? NSTextView { Self.style(editor, attrs) }
        }

        func controlTextDidChange(_ obj: Notification) {
            guard let field = obj.object as? NSTextField else { return }
            if let editor = field.currentEditor() as? NSTextView { Self.style(editor, attrs) }
            parent.text = field.stringValue
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertLineBreak(_:)), #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
                // (Return while composing is the input method's.)
                guard !textView.hasMarkedText() else { return false }
                let mods = NSApp.currentEvent?.modifierFlags ?? []
                parent.submit(mods.contains(.command) ? .command : mods.contains(.shift) ? .shift : .plain)
                return true
            case #selector(NSResponder.cancelOperation(_:)):
                parent.escape()
                return true
            default:
                return false
            }
        }
    }
}
#else
/// The task's field in Instrument Sans 17 (`text-title-3`) with the web's letter spacing, heading ink, the faint
/// placeholder. Return submits (Shift-Return and Command-Return from a hardware keyboard), Escape closes.
private struct PanelField: View {
    /// The Mac's native look: interface text in the system font (WebFont.interface).
    @Environment(\.nativeChrome) private var chrome
    enum Key { case plain, shift, command }

    @Binding var text: String
    let placeholder: String
    let ink: RGBA
    let faint: RGBA
    let focusTick: Int
    let submit: (Key) -> Void
    let escape: () -> Void
    @FocusState private var focused: Bool

    static let inset: CGFloat = 0
    static let kern = WebTextStyle.bodyLetterSpacing

    var body: some View {
        TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(faint.color))
            .font(chrome != nil ? .system(size: 17) : Font(WebTextStyle(size: 17, leading: 22, letterSpacing: Self.kern).ctFont))
            .tracking(chrome != nil ? 0 : Self.kern)
            .foregroundStyle(ink.color)
            .textFieldStyle(.plain)
            .focused($focused)
            .onSubmit { submit(.plain) }
            .onKeyPress(.return, phases: .down) { press in
                if press.modifiers.contains(.command) { submit(.command); return .handled }
                if press.modifiers.contains(.shift) { submit(.shift); return .handled }
                return .ignored
            }
            .onKeyPress(.escape) { escape(); return .handled }
            .onChange(of: focusTick, initial: true) { focused = true }
    }
}
#endif

/// The chips' × (`-mr-1.5 grid h-5 w-5 rounded-tiny text-faint hover:text-heading`).
private struct RemoveButton: View {
    let label: String
    let action: () -> Void
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            QAIcon(.x, size: 12)
                .frame(width: 20, height: 20)
                .foregroundStyle(hover ? qaInk("color-heading", scheme) : qaInk("color-ink-faint", scheme))
                .contentShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
        .buttonStyle(PlainPress())
        .onHover { hover = $0 }
        .accessibilityLabel(label)
    }
}

/// components/ui/DateField: a 160 pt input with the calendar icon and the day ("No date"); the calendar in a popover.
private struct QuickAddDateField: View {
    @Bindable var model: QuickAddModel
    @State private var anchor = PlannerAnchor()
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let date = model.dueDate ?? model.effectiveDueDate
        Button { open(date) } label: {
            HStack(spacing: 8) {
                QAIcon(.calendarDays, size: 14).foregroundStyle(qaInk("color-ink-muted", scheme))
                Text(date.map { WebQuickAddPanel.dayLabel($0, today: model.session.value?.today) } ?? "No date")
                    .qaText(.body).lineLimit(1)
                    .foregroundStyle(date == nil ? qaInk("color-ink-faint", scheme) : qaInk("color-ink", scheme))
                Spacer(minLength: 0)
            }
            .padding(.leading, 10).padding(.trailing, 32)
            .frame(width: 160, height: 32)
            .modifier(QAFieldBox())
            .contentShape(Rectangle())
            .plannerAnchor(anchor)
        }
        .buttonStyle(QAChipStyle(radius: WebStyles.named("input").resolve(scheme).radius))
        .accessibilityLabel("Due date: \(date ?? "No date")")
    }

    /// The planner's own calendar in a Folevi popover, as Edit task's (MAC-02: it was the system's popover and date
    /// picker).
    private func open(_ date: String?) {
        guard let v = anchor.view else { return }
        let model = model
        PlannerPanel.popover(below: v) { close in
            CalendarPopover(value: date ?? "", clearable: false) { picked in
                if !picked.isEmpty { model.dueDate = picked }
                close()
            }
        }
    }

    static func day(_ ymd: String?) -> Date? {
        guard let ymd else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: ymd)
    }

    static func ymd(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

/// components/ui/TimeField: a 112 pt input with the time ("All day"); hours and minutes in a popover.
private struct QuickAddTimeField: View {
    @Bindable var model: QuickAddModel
    @State private var anchor = PlannerAnchor()
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let time = model.dueDate != nil ? model.dueTime : model.effectiveDueTime
        Button { open(time) } label: {
            HStack(spacing: 8) {
                QAIcon(.clock, size: 14).foregroundStyle(qaInk("color-ink-muted", scheme))
                Text(time.map(WebQuickAddPanel.clock) ?? "All day")
                    .qaText(.body).lineLimit(1)
                    .foregroundStyle(time == nil ? qaInk("color-ink-faint", scheme) : qaInk("color-ink", scheme))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(width: 112, height: 32)
            .modifier(QAFieldBox())
            .contentShape(Rectangle())
            .plannerAnchor(anchor)
        }
        .buttonStyle(QAChipStyle(radius: WebStyles.named("input").resolve(scheme).radius))
        .accessibilityLabel("Due time: \(time ?? "All day")")
    }

    /// The planner's time list (every quarter hour, "All day" first) in a Folevi popover, as Edit task's (MAC-02: it
    /// was the system's popover and stepper field).
    private func open(_ time: String?) {
        guard let v = anchor.view else { return }
        var times = PlannerTimeField.times
        if let time, !times.contains(time) { times = (times + [time]).sorted() }
        let options = [("", "All day")] + times.map { ($0, WebQuickAddPanel.clock($0)) }
        let width = max(v.bounds.width, 160)
        PlannerPanel.popover(below: v) { close in
            OptionList(options: options, selected: time ?? "", width: width) { id in
                set(id.isEmpty ? nil : id)
                close()
            }
        }
    }

    /// A time picked keeps the day read from the words (web: `q.setDue(due), q.setTime(v)`).
    private func set(_ hhmm: String?) {
        if model.dueDate == nil { model.dueDate = model.effectiveDueDate }
        model.dueTime = hhmm
    }

    static func time(_ hhmm: String?) -> Date {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return hhmm.flatMap(f.date(from:)) ?? f.date(from: "09:00")!
    }

    static func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

/// QuickAddTask.tsx DocumentPicker: "Add to", a search field ("Inbox, or search a page…"), then the Inbox and the
/// pages found.
private struct QuickAddPagePicker: View {
    @Bindable var model: QuickAddModel
    let done: () -> Void
    @State private var query = ""
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Add to").qaText(.body).foregroundStyle(qaInk("color-ink-muted", scheme))
            // (Its placeholder is Tailwind's own: the text's colour at 50 %, over the field. A prompt draws an
            // opaque colour as given but not a translucent one, so it gets the two already mixed.)
            TextField("", text: $query, prompt: Text(model.destination.noteId == nil ? "Inbox, or search a page…" : "Search another page…").foregroundStyle(placeholder.color))
                .textFieldStyle(.plain)
                .qaText(.body, web: WebTextStyle(size: 13, leading: 18))
                .foregroundStyle(qaInk("color-ink", scheme))
                .padding(.horizontal, 12)
                .frame(height: 36)
                .modifier(QAFieldBox())
                .focused($focused)
                .onChange(of: query) { _, q in model.searchPages(q) }
                .onSubmit { pick(query.isEmpty ? nil : model.pageHits.first) }
                .accessibilityLabel("Add to")
                .accessibilityIdentifier("quick-add-page-search")
            if !query.isEmpty || model.destination.noteId != nil {
                VStack(alignment: .leading, spacing: 0) {
                    row(.inbox, "Inbox", selected: model.destination.noteId == nil) { pick(nil) }
                    ForEach(model.pageHits.prefix(6), id: \.id) { hit in
                        row(.fileText, hit.title.isEmpty ? "Untitled" : hit.title, selected: hit.id == model.destination.noteId) { pick(hit) }
                    }
                }
                .padding(.top, 4)
            }
        }
        // (No focus of its own on opening: the web's DocumentPicker waits for a click or Tab.)
        .padding(.top, 12)
    }

    private var placeholder: RGBA {
        let ink = qaColor("color-ink", scheme), field = qaColor("color-surface", scheme)
        return RGBA((ink.r + field.r) / 2, (ink.g + field.g) / 2, (ink.b + field.b) / 2)
    }

    private func pick(_ hit: SearchHit?) {
        model.pick(page: hit)
        done()
    }

    private func row(_ icon: WebIcon, _ title: String, selected: Bool, _ action: @escaping () -> Void) -> some View {
        PickerRow(icon: icon, title: title, selected: selected, action: action)
    }
}

private struct PickerRow: View {
    let icon: WebIcon
    let title: String
    let selected: Bool
    let action: () -> Void
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                QAIcon(icon, size: 14).foregroundStyle(qaInk("color-ink-muted", scheme))
                Text(title).qaText(.body).lineLimit(1).foregroundStyle(qaInk("color-ink", scheme))
                Spacer(minLength: 0)
                if selected { QAIcon(.check, size: 14).foregroundStyle(qaInk("color-heading", scheme)) }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hover ? qaInk("mac-hover", scheme) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainPress())
        .onHover { hover = $0 }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
#endif
