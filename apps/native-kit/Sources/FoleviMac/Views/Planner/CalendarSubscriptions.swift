// The Calendar's subscriptions, drawn as the web's (views/CalendarSubscriptions.tsx CalendarsButton): calendars
// you subscribe to by link (show or hide, rename, colour, refresh, remove) and adding one; and "Your tasks in your
// calendar" (CalendarFeedDialog.tsx), the private link for other calendar apps, with a Folevi account only.
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

private let colors: [(String, String)] = [("accent", "Cocoa"), ("moss", "Moss"), ("marigold", "Marigold"), ("plum", "Plum"), ("coral", "Coral"), ("muted", "Gray")]

/// The Calendars button: a red dot when a calendar couldn't be loaded; opens the subscriptions popover.
struct CalendarsButton: View {
    let state: WebCalendarState
    let frame: FrameModel
    @State private var anchor = PlannerAnchor()
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PlannerButton("Calendars", icon: .calendarRange, style: "cal.calendars") { open() }
            .overlay(alignment: .trailing) {
                if state.failing { Circle().fill(PV("color-danger").c(scheme)).frame(width: 6, height: 6).padding(.trailing, 4) }
            }
            .plannerAnchor(anchor)
    }

    private func open() {
        guard let v = anchor.view else { return }
        let state = self.state
        let frame = self.frame
        PlannerPanel.popover(below: v, alignEnd: true) { _ in CalendarsPopover(state: state, frame: frame) }
    }
}

struct CalendarsPopover: View {
    let state: WebCalendarState
    let frame: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let pop = PS("cals.pop")
        let p = pop.resolve(scheme)
        let head = PS("cals.head").resolve(scheme)
        let line = PV("color-line").c(scheme)
        let cals = state.calendars.value?.calendars ?? []
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                StyledText("Calendars", "cals.head.title")
                PrettyText("Calendars you subscribe to by link show beside your tasks. They’re read-only here. Turn one off to hide its events.", PS("cals.head.text").resolve(scheme).text)
                    .foregroundStyle(PS("cals.head.text").resolve(scheme).color.color)
                    .padding(.top, 2)
            }
            .padding(head.padding.edgeInsets)
            Rectangle().fill(line).frame(height: 1)
            if !cals.isEmpty {
                ForEach(cals, id: \.id) { c in
                    SubscriptionRow(cal: c, client: frame.client, frame: frame)
                    Rectangle().fill(line).frame(height: 1)
                }
            }
            AddCalendarForm(count: cals.count, client: frame.client, frame: frame)
        }
        .frame(width: p.width)
        .background(WebMaterial(radius: p.radius))
        .webBox(pop)
    }
}

struct ColorPicker: View {
    @Binding var value: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let item = PS("cals.color").resolve(scheme)
        VStack(alignment: .leading, spacing: 4) {
            StyledText("Color", "cals.color.legend")
            FlowRow(spacing: 4) {
                ForEach(colors, id: \.0) { id, label in
                    Button { value = id } label: {
                        HStack(spacing: item.gap) {
                            Circle().fill(calendarColor(id).c(scheme)).frame(width: 12, height: 12)
                            Text(label).webText(item.text).lineLimit(1)
                        }
                        .padding(item.padding.edgeInsets)
                        .foregroundStyle(item.color.color)
                        .background { if value == id { RoundedRectangle(cornerRadius: item.radius, style: .circular).fill(PV("color-accent-soft").c(scheme)) } }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PlainPress())
                    .accessibilityAddTraits(value == id ? .isSelected : [])
                }
            }
        }
    }
}

/// Children left to right, wrapping (flex-wrap).
struct FlowRow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += row + spacing; row = 0 }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            row = max(row, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: .init(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

struct SubscriptionRow: View {
    let cal: CalendarSubscription
    let client: EngineClient
    let frame: FrameModel
    @State private var editing = false
    @State private var confirming = false
    @State private var name = ""
    @State private var color = "moss"
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let host = URL(string: cal.url)?.host ?? cal.url
        let status = cal.loading ? "Loading…" : cal.lastFetchedAt.map { "Updated \(PlannerDates.relative($0))" } ?? ""
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                Circle().fill(calendarColor(cal.color).c(scheme)).frame(width: 10, height: 10).padding(.top, 6)
                VStack(alignment: .leading, spacing: 0) {
                    Text(cal.name).webText(.role(.subheadline, weight: 500)).lineLimit(1).foregroundStyle(cal.visible ? PV("color-ink").c(scheme) : PV("color-ink-muted").c(scheme))
                    Text(status.isEmpty ? host : "\(host) · \(status)").webText(.role(.footnote)).lineLimit(1).foregroundStyle(PV("color-ink-faint").c(scheme)).foleviTooltip(host)
                }
                Spacer(minLength: 0)
                Toggle("Show \(cal.name)", isOn: Binding(get: { cal.visible }, set: { v in run(.calendarUpdate(id: cal.id, visible: v)) }))
                    .toggleStyle(.switch).labelsHidden().controlSize(.mini)
                PlannerButton(editing ? "Close" : "Edit", style: "edit.clear") {
                    editing.toggle()
                    confirming = false
                    name = cal.name
                    color = colors.contains { $0.0 == cal.color } ? cal.color : "moss"
                }
                .accessibilityLabel("Edit \(cal.name)")
            }
            if let e = cal.lastError {
                Text(e).webText(.role(.footnote)).foregroundStyle(PV("color-danger").c(scheme))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 6).fill(PV("color-danger").c(scheme).opacity(0.1)))
                    .padding(.top, 6)
            }
            if editing {
                VStack(alignment: .leading, spacing: 8) {
                    VStack(alignment: .leading, spacing: 4) {
                        StyledText("Name", "cals.add.label")
                        PlannerField(placeholder: "", text: $name, style: "cals.add.input")
                    }
                    ColorPicker(value: $color)
                    HStack(spacing: 6) {
                        PlannerButton("Save", style: "edit.save", hover: nil) {
                            run(.calendarUpdate(id: cal.id, name: name, color: color)) { editing = false }
                        }
                        PlannerButton("Refresh", icon: .refreshCw, iconSize: 13, style: "edit.cancel") { run(.calendarRefresh(id: cal.id)) }
                        if confirming {
                            PlannerButton("Remove calendar", style: "edit.save", hover: nil) { run(.calendarRemove(id: cal.id)) }
                        } else {
                            PlannerButton("Remove", icon: .trash, iconSize: 13, style: "edit.clear") { confirming = true }
                                .foregroundStyle(PV("color-danger").c(scheme))
                        }
                    }
                    if confirming {
                        Text("Its events leave your Calendar. You can add it again with its link.").webText(.role(.footnote)).foregroundStyle(PV("color-ink-muted").c(scheme))
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 6).fill(PV("glass-hover").c(scheme)))
                .padding(.top, 8)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func run<C: EngineCommandSpec>(_ c: C, then: @escaping () -> Void = {}) {
        Task {
            do {
                _ = try await client.command(c)
                then()
            } catch { frame.toast(ScreenErrors.message(error), tone: .error) }
        }
    }
}

struct AddCalendarForm: View {
    let count: Int
    let client: EngineClient
    let frame: FrameModel
    @State private var url = ""
    @State private var name = ""
    @State private var color: String
    @State private var error: String?
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme

    init(count: Int, client: EngineClient, frame: FrameModel) {
        self.count = count
        self.client = client
        self.frame = frame
        _color = State(initialValue: colors[count % colors.count].0)
    }

    var body: some View {
        let form = PS("cals.add").resolve(scheme)
        let label = PS("cals.add.label").resolve(scheme)
        if count >= 20 {
            Text("You have 20 calendars, the most you can subscribe to. Remove one to add another.").webText(.role(.footnote)).foregroundStyle(PV("color-ink-muted").c(scheme)).padding(.horizontal, 16).padding(.vertical, 12)
        } else {
            VStack(alignment: .leading, spacing: label.margin.bottom) {
                StyledText("Add calendar", "cals.add.title")
                VStack(alignment: .leading, spacing: 4) {
                    StyledText("Calendar link (ICS)", "cals.add.label")
                    PlannerField(placeholder: "https://… or webcal://…", text: $url, style: "cals.add.input") { add() }
                        .onChange(of: url) { _, _ in error = nil }
                }
                VStack(alignment: .leading, spacing: 4) {
                    StyledText("Name (optional)", "cals.add.label")
                    PlannerField(placeholder: "", text: $name, style: "cals.add.input") { add() }
                }
                ColorPicker(value: $color)
                if let error { Text(error).webText(.role(.footnote)).foregroundStyle(PV("color-danger").c(scheme)) }
                HStack(alignment: .center, spacing: 8) {
                    StyledText("Read-only. Folevi checks it for changes about once an hour.", "cals.add.note", lines: nil).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    PlannerButton("Add", style: "cals.add.button", hover: nil) { add() }
                        .disabled(busy || url.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.top, 4)
            }
            .padding(form.padding.edgeInsets)
        }
    }

    private func add() {
        let link = url.trimmingCharacters(in: .whitespaces)
        guard !link.isEmpty, !busy else { return }
        busy = true
        let n = name.trimmingCharacters(in: .whitespaces)
        Task {
            do {
                _ = try await client.command(.calendarAdd(url: link, name: n.isEmpty ? nil : n, color: color))
                url = ""
                name = ""
            } catch { self.error = ScreenErrors.message(error) }
            busy = false
        }
    }
}

/// "Your tasks in your calendar": the private iCalendar link (made once, shown once).
struct CalendarFeedDialog: View {
    let client: EngineClient
    let frame: FrameModel
    let close: () -> Void
    @State private var feed: CalendarFeedValue?
    @State private var link: String?
    @State private var include = true
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PlannerDialog(title: "Your tasks in your calendar", description: "Subscribe to this link in Google Calendar, Apple Calendar or Outlook to see tasks with a due date there. It's read-only and updates about every hour.", close: close) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Workspace tasks assigned to you").webText(.role(.subheadline)).foregroundStyle(PV("color-ink").c(scheme))
                        Text("Your Personal tasks are always in it.").webText(.role(.footnote)).foregroundStyle(PV("color-ink-muted").c(scheme))
                    }
                    Spacer(minLength: 0)
                    Toggle("Workspace tasks assigned to you", isOn: Binding(get: { feed?.active == true ? feed!.includeWorkspaces : include }, set: { on in
                        if feed?.active == true { Task { _ = try? await client.command(.calendarFeedWorkspaces(includeWorkspaces: on)); await load() } } else { include = on }
                    }))
                    .toggleStyle(.switch).labelsHidden().controlSize(.mini)
                }
                if let link {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Copy this link now. For your privacy, it isn’t shown again.").webText(.role(.footnote, weight: 500))
                        HStack(spacing: 8) {
                            Text(link).font(.system(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                                .padding(.horizontal, 8).frame(height: 28).frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 6).fill(PV("glass-hover").c(scheme)))
                            PlannerButton("Copy", icon: .copy, iconSize: 13, style: "edit.cancel") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(link, forType: .string)
                                frame.toast("Link copied")
                            }
                        }
                        Text("Google Calendar: Other calendars, From URL. Apple Calendar: File, New Calendar Subscription. Outlook: Add calendar, Subscribe from web.").webText(.role(.footnote)).foregroundStyle(PV("color-ink-muted").c(scheme))
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 6).fill(PV("color-moss").c(scheme).opacity(0.12)))
                } else if let f = feed, f.active {
                    Text("You have a link\(f.lastFetchedAt.map { ", last read by a calendar \(PlannerDates.relative($0))" } ?? ", not used by a calendar yet"). Make a new one if you lost it; the old one stops working.")
                        .webText(.role(.subheadline)).foregroundStyle(PV("color-ink-muted").c(scheme))
                }
                HStack {
                    if feed?.active == true {
                        PlannerButton("Turn off the link", style: "edit.clear") {
                            Task {
                                _ = try? await client.command(.calendarFeedRevoke)
                                link = nil
                                frame.toast("Calendar link turned off")
                                await load()
                            }
                        }
                        .foregroundStyle(PV("color-danger").c(scheme))
                    }
                    Spacer()
                    PlannerButton(feed?.active == true ? "Make a new link" : "Make a link", style: "edit.save", hover: nil) {
                        Task {
                            do {
                                let r = try await client.command(.calendarFeedCreate(includeWorkspaces: include))
                                link = r.url
                                await load()
                            } catch { frame.toast(ScreenErrors.message(error), tone: .error) }
                        }
                    }
                }
            }
        }
        .task { await load() }
    }

    private func load() async { feed = try? await client.query(.calendarFeed) }
}
#endif
