// Notifications (comments, mentions, invitations, reminders, shared notes) and the Inbox note (where Save to
// Folevi and Quick Add land).
import FoleviDesign
import FoleviEngine
import SwiftUI

struct NotificationsScreen: View {
    let window: WindowModel
    @Environment(AppModel.self) private var app
    @State private var selection: Set<String> = []
    @State private var replying: NotificationRow?

    var body: some View {
        Group {
            if let v = app.notifications.value {
                if v.rows.isEmpty {
                    EmptyScreen(symbol: "bell", title: "No Notifications", message: "Comments, mentions and invitations show up here.")
                } else {
                    List(selection: $selection) {
                        ForEach(v.rows, id: \.id) { n in
                            NotificationLine(row: n, window: window, reply: { replying = n })
                                .tag(n.id)
                        }
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
                LoadingScreen()
            }
        }
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Button("Mark All as Read") { app.perform { _ = try await $0.command(Commands.NotificationMarkAllRead()) } }
                    .disabled(app.unread == 0)
            }
        }
        .sheet(item: $replying) { n in ReplySheet(row: n) }
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
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(row.read ? Color.clear : Color.accentColor).frame(width: 8, height: 8).padding(.top, 6)
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
    @Environment(AppModel.self) private var app
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
    @Environment(AppModel.self) private var app

    var body: some View {
        LoadingScreen()
            .task {
                guard let client = app.client, let r = try? await client.command(Commands.InboxOpen(InboxOpenArgs(space: nil))) else { return }
                window.replaceCurrent(.note(r.id))
            }
    }
}
