// The Calendar's sheets: subscribed calendars (web views/CalendarSubscriptions.tsx: show or hide, rename, colour,
// refresh, remove, add one by its link), an event's details (read-only: title, when, where, the description as
// plain text), and adding a task on a day.
import SwiftUI
import FoleviDesign
import FoleviEngine

struct CalendarsSheet: View {
    let model: CalendarModel
    @State private var url = ""
    @State private var name = ""
    @State private var color = "accent"
    @State private var error: String?
    @State private var adding = false
    @State private var renaming: CalendarSubscription?
    @State private var newName = ""
    @State private var removing: CalendarSubscription?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let cals = model.calendars?.value?.calendars {
                        if cals.isEmpty {
                            Text("No calendars yet. Add one by its link to see its events beside your tasks.")
                                .foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
                        }
                        ForEach(cals, id: \.id) { cal in row(cal) }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                } header: {
                    Text("Your calendars").foleviFont(.caps)
                }
                Section {
                    TextField("Calendar link (https:// or webcal://)", text: $url)
                        .foleviFont(.body)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .accessibilityIdentifier("calendar-add-url")
                    TextField("Name (optional)", text: $name).foleviFont(.body)
                    colorPicker(selection: $color)
                    if let error { Text(error).foleviFont(.footnote).foregroundStyle(Folevi.color.destructive) }
                    Button {
                        Task {
                            adding = true
                            error = await model.addCalendar(url: url, name: name, color: color)
                            adding = false
                            if error == nil { url = ""; name = "" }
                        }
                    } label: {
                        if adding { ProgressView() } else { Text("Add calendar") }
                    }
                    .buttonStyle(.folevi(.primary, fullWidth: true))
                    .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty || adding)
                    .accessibilityIdentifier("calendar-add-submit")
                } header: {
                    Text("Add a calendar").foleviFont(.caps)
                } footer: {
                    Text("Paste a calendar's private link from Google Calendar, Apple Calendar or Outlook. Its events show beside your tasks, read-only.")
                        .foleviFont(.footnote)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Folevi.color.canvas)
            .navigationTitle("Calendars")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.fontWeight(.semibold) } }
            .alert("Rename calendar", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $newName)
                Button("Cancel", role: .cancel) { renaming = nil }
                Button("Rename") {
                    if let cal = renaming, !newName.trimmingCharacters(in: .whitespaces).isEmpty { Task { await model.updateCalendar(cal.id, name: newName) } }
                    renaming = nil
                }
            }
            .confirmationDialog("Remove \(removing?.name ?? "this calendar")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                Button("Remove", role: .destructive) {
                    if let cal = removing { Task { await model.removeCalendar(cal) } }
                    removing = nil
                }
            } message: {
                Text("Its events leave your Calendar. You can add it again with its link.")
            }
        }
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(FoleviTokens.Radius.sheet)
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 520)
        #endif
        .accessibilityIdentifier("calendars-sheet")
    }

    private func row(_ cal: CalendarSubscription) -> some View {
        HStack(spacing: 12) {
            Button { Task { await model.updateCalendar(cal.id, visible: !cal.visible) } } label: {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny)
                    .fill(cal.visible ? CalendarMath.color(cal.color) : .clear)
                    .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).strokeBorder(CalendarMath.color(cal.color), lineWidth: 1.5))
                    .overlay { if cal.visible { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white) } }
                    .frame(width: 20, height: 20)
                    .frame(width: 32, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(cal.visible ? "Hide \(cal.name)" : "Show \(cal.name)")
            VStack(alignment: .leading, spacing: 2) {
                Text(cal.name).foleviFont(.body).foregroundStyle(Folevi.color.ink).lineLimit(1)
                Text(status(cal)).foleviFont(.footnote).foregroundStyle(cal.lastError != nil ? Folevi.color.destructive : Folevi.color.inkMuted).lineLimit(2)
            }
            Spacer(minLength: 0)
            if cal.loading { ProgressView().controlSize(.small) }
            Menu {
                Button { newName = cal.name; renaming = cal } label: { Label("Rename…", systemImage: "pencil") }
                Menu {
                    ForEach(CalendarModel.colors, id: \.id) { c in
                        Button { Task { await model.updateCalendar(cal.id, color: c.id) } } label: {
                            if c.id == cal.color { Label(c.label, systemImage: "checkmark") } else { Text(c.label) }
                        }
                    }
                } label: { Label("Colour", systemImage: "paintpalette") }
                Button { Task { await model.refreshCalendar(cal.id) } } label: { Label("Refresh now", systemImage: "arrow.clockwise") }
                Divider()
                Button(role: .destructive) { removing = cal } label: { Label("Remove", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis").frame(width: 32, height: 44).contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .accessibilityLabel("Options for \(cal.name)")
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { removing = cal } label: { Label("Remove", systemImage: "trash") }
            Button { Task { await model.refreshCalendar(cal.id) } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
        }
    }

    private func status(_ cal: CalendarSubscription) -> String {
        if let e = cal.lastError { return e }
        if cal.loading { return "Refreshing…" }
        var parts: [String] = []
        if let n = cal.eventCount { parts.append(n == 1 ? "1 event" : "\(n) events") }
        if let at = cal.lastFetchedAt { parts.append("updated \(AgeText.relative(Date(timeIntervalSince1970: at / 1000), now: ScreenClock.now()))") }
        return parts.isEmpty ? "Not fetched yet" : parts.joined(separator: ", ")
    }

    private func colorPicker(selection: Binding<String>) -> some View {
        HStack(spacing: 10) {
            ForEach(CalendarModel.colors, id: \.id) { c in
                Button { selection.wrappedValue = c.id } label: {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(CalendarMath.color(c.id)).frame(width: 22, height: 22)
                        .overlay { if selection.wrappedValue == c.id { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white) } }
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(c.label)
                .accessibilityAddTraits(selection.wrappedValue == c.id ? .isSelected : [])
            }
        }
    }
}

struct EventDetailSheet: View {
    let event: CalendarEvent
    let timeZone: TimeZone
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(CalendarMath.color(event.color)).frame(width: 10, height: 10)
                        Text(event.calendarName).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                    }
                    Text(event.title.isEmpty ? "Untitled event" : event.title).foleviFont(.title2).foregroundStyle(Folevi.color.heading)
                    Text(CalendarMath.eventWhen(event, timeZone: timeZone)).foleviFont(.body).foregroundStyle(Folevi.color.inkMuted)
                    if !event.location.isEmpty {
                        Label(event.location, systemImage: "mappin.and.ellipse").foleviFont(.body).foregroundStyle(Folevi.color.ink).textSelection(.enabled)
                    }
                    if !event.description.isEmpty {
                        Text(event.description).foleviFont(.callout).foregroundStyle(Folevi.color.ink).textSelection(.enabled).padding(.top, 4)
                    }
                    Text("From a subscribed calendar. Change it in that calendar's app.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkFaint).padding(.top, 8)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Folevi.color.canvas)
            .navigationTitle("Event")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.fontWeight(.semibold) } }
        }
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(FoleviTokens.Radius.sheet)
        #if os(macOS)
        .frame(minWidth: 380, minHeight: 320)
        #endif
        .accessibilityIdentifier("event-sheet")
    }
}

struct AddTaskOnDaySheet: View {
    let model: CalendarModel
    let day: String
    @State private var text = ""
    @State private var busy = false
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let h = TaskDates.dayHeading(day, today: model.today)
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("What needs doing?", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .foleviFont(.body)
                    .focused($focused)
                    .lineLimit(1...4)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
                    .onSubmit(add)
                    .accessibilityIdentifier("calendar-add-task-field")
                Label("Due \(h.name == "Today" || h.name == "Tomorrow" ? h.name.lowercased() : "\(h.name), \(h.date)")", systemImage: "calendar")
                    .foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(Folevi.color.canvas)
            .navigationTitle("New task")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add", action: add).fontWeight(.semibold).disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || busy) }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.height(220), .medium])
        .presentationCornerRadius(FoleviTokens.Radius.sheet)
        #if os(macOS)
        .frame(minWidth: 380, minHeight: 200)
        #endif
    }

    private func add() {
        guard !busy else { return }
        busy = true
        Task {
            if await model.addTask(text, on: day) { dismiss() }
            busy = false
        }
    }
}
