// Notifications (comments, mentions, invitations, reminders, shared notes) and the Inbox note (where Save to
// Folevi and Quick Add land).
import FoleviDesign
import FoleviEngine
import SwiftUI

struct NotificationsScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var selection: Set<String> = []
    @State private var replying: NotificationRow?
    @State private var unreadOnly = false

    var body: some View {
        Group {
            if let v = app.notifications.value {
                let rows = v.rows.filter { !unreadOnly || !$0.read }
                let today = rows.filter { Calendar.current.isDateInToday(Date(timeIntervalSince1970: $0.at / 1000)) }
                let earlier = rows.filter { !Calendar.current.isDateInToday(Date(timeIntervalSince1970: $0.at / 1000)) }
                if v.rows.isEmpty {
                    EmptyScreen(symbol: "bell", title: "No Notifications", message: "Comments, mentions and invitations show up here.")
                } else if rows.isEmpty {
                    EmptyScreen(symbol: "checkmark.circle", title: "All Read", message: "Nothing unread. Show All to see earlier ones.", actionTitle: "Show All") { unreadOnly = false }
                } else {
                    List(selection: $selection) {
                        if !today.isEmpty { Section("Today") { ForEach(today, id: \.id, content: line) } }
                        if !earlier.isEmpty { Section("Earlier") { ForEach(earlier, id: \.id, content: line) } }
                    }
                    .listStyle(.inset)
                    .contextMenu(forSelectionType: String.self) { ids in
                        Button("Mark as Read") { mark(ids, read: true) }
                        Button("Mark as Unread") { mark(ids, read: false) }
                        Divider()
                        Button("Remove", role: .destructive) { app.perform { _ = try await $0.command(Commands.NotificationRemove(NotificationIdsArgs(ids: Array(ids)))) } }
                    } primaryAction: { ids in
                        if let id = ids.first, let row = v.rows.first(where: { $0.id == id }) { open(row) }
                    }
                }
            } else {
                SkeletonRows()
            }
        }
        .navigationSubtitle(app.unread == 0 ? "Nothing unread" : "\(app.unread) unread")
        .toolbar {
            ToolbarItemGroup(placement: .secondaryAction) {
                Picker("Show", selection: $unreadOnly) {
                    Text("All").tag(false)
                    Text("Unread").tag(true)
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                Button("Mark All as Read") { app.perform { _ = try await $0.command(Commands.NotificationMarkAllRead()) } }
                    .disabled(app.unread == 0)
                Button { SettingsRouter.shared.open("notifications") } label: { Label("Notification Settings", systemImage: "gearshape") }
                    .help("Notification Settings")
            }
        }
        .sheet(item: $replying) { n in ReplySheet(row: n) }
    }

    private func line(_ n: NotificationRow) -> some View {
        NotificationLine(row: n, window: window, reply: { replying = n })
            .overlay(alignment: .trailing) {
                if let file = n.fileId {
                    Button("Download") { download(file) }.controlSize(.small)
                }
            }
            .tag(n.id)
    }

    private func download(_ fileId: String) {
        app.perform { client in
            let v = try await client.query(Views.FilesUrls(FileUrlsArgs(ids: [fileId])))
            guard let link = v.urls[fileId], let s = link.url, let url = URL(string: s) else { app.toast("The file isn't ready yet.", tone: .error); return }
            let (data, _) = try await URLSession.shared.data(from: url)
            _ = await ShellFiles.shared.save(name: link.filename ?? "Download", bytes: data, from: NSApp.keyWindow)
        }
    }

    private func mark(_ ids: Set<String>, read: Bool) {
        app.perform { _ = try await $0.command(Commands.NotificationMarkRead(NotificationMarkArgs(ids: Array(ids), read: read))) }
    }

    private func open(_ row: NotificationRow) {
        mark([row.id], read: true)
        if let route = row.route { app.open(path: route) } else if let note = row.noteId { window.go(.note(note)) }
    }
}

extension NotificationRow: Identifiable {}

struct NotificationLine: View {
    let row: NotificationRow
    let window: WindowModel
    let reply: () -> Void
    private var app: AppModel { .shared }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(row.read ? Color.clear : Color.foleviInk).frame(width: 8, height: 8).padding(.top, 6)
                .accessibilityLabel(row.read ? "" : "Unread")
            avatar
            VStack(alignment: .leading, spacing: 3) {
                Text(row.title).font(.body.weight(row.read ? .regular : .semibold)).lineLimit(2)
                if !row.body.isEmpty { Text(row.body).font(.callout).foregroundStyle(.secondary).lineLimit(3) }
                HStack(spacing: 8) {
                    Text(CoreDates.relative(row.at))
                    if let t = row.noteTitle { Text(t) }
                    if row.count > 1 { Text("\(row.count) more") }
                }
                .font(.caption).foregroundStyle(.tertiary)
                actions
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var avatar: some View {
        if let url = row.actorAvatarUrl.flatMap(URL.init(string:)) {
            AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.2) }
                .frame(width: 28, height: 28).clipShape(Circle())
        } else {
            Image(systemName: icon).frame(width: 28, height: 28).background(.fill.tertiary, in: Circle())
        }
    }

    private var icon: String {
        switch row.kind {
        case let k where k.contains("comment"): "text.bubble"
        case let k where k.contains("mention"): "at"
        case let k where k.contains("invite"): "envelope"
        case let k where k.contains("reminder"): "bell"
        case let k where k.contains("share"): "person.2"
        default: "bell"
        }
    }

    @ViewBuilder private var actions: some View {
        let invite = row.inviteId != nil || row.pageInviteId != nil || row.folderInviteId != nil
        if invite || row.kind.contains("comment") || row.kind.contains("mention") {
            HStack {
                if invite {
                    Button("Accept") { act("accept") }.buttonStyle(.borderedProminent)
                    Button("Decline") { act("decline") }
                } else {
                    Button("Reply…", action: reply)
                    Button("Resolve") { act("resolve") }
                }
            }
            .controlSize(.small)
            .padding(.top, 2)
        }
    }

    private func act(_ action: String) {
        app.perform { _ = try await $0.command(Commands.NotificationAct(NotificationActArgs(id: row.id, action: action, text: nil, thread: nil))) }
    }
}

/// Replying to a comment from its notification.
struct ReplySheet: View {
    let row: NotificationRow
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Reply to \(row.actorName ?? "comment")").font(.headline)
            Text(row.body).foregroundStyle(.secondary).lineLimit(4)
            TextEditor(text: $text).font(.body).frame(width: 380, height: 110).scrollContentBackground(.hidden).padding(6).background(.fill.quinary, in: .rect(cornerRadius: 8))
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button("Reply") {
                        let t = text
                        app.perform { _ = try await $0.command(Commands.NotificationAct(NotificationActArgs(id: row.id, action: "reply", text: t, thread: nil))) }
                        dismiss()
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(20)
    }
}

/// The Inbox: a note of its own (Save to Folevi and Quick Add put things there). Opens it.
struct InboxNoteScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }

    var body: some View {
        LoadingScreen()
            .task {
                guard let client = app.client, let r = try? await client.command(Commands.InboxOpen(InboxOpenArgs(space: nil))) else { return }
                window.replaceCurrent(.note(r.id))
            }
    }
}
