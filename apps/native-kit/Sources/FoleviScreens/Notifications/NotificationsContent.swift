// The bell's content (plan 5.6; web app/NotificationsButton.tsx). The frames own the container: a sheet on iPhone,
// a popover on iPad and Mac. Header: All or Unread (with the count), Mark all read, notification settings. Rows: who
// (their picture with the kind's badge) or a bell, the sentence, the body in two lines, when, and an unread dot;
// swipe right to mark read or unread, left to remove; invitations accept or decline in place; a tap goes where the
// notification points (and marks it read).
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct NotificationsContent: View {
    @Bindable var model: NotificationsModel
    /// Phone measure (bigger text, 36 pt pictures) or the popover's.
    let phone: Bool
    private let send = IntentSender()

    public init(model: NotificationsModel, phone: Bool = true) {
        self.model = model
        self.phone = phone
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Folevi.color.line).frame(height: 1)
            if model.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityLabel("Loading notifications")
            } else if model.rows.isEmpty {
                let t = model.emptyText
                EmptyState(systemImage: model.filter == .unread ? "checkmark.circle" : "bell", title: t.title, message: t.message)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                list
            }
        }
        .background(Folevi.color.canvas)
        .onChange(of: model.store.value) { _, _ in model.reconcile() }
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .accessibilityIdentifier("notifications-content")
    }

    private var header: some View {
        HStack(spacing: 10) {
            SegmentedControl(selection: $model.filter, options: [(.all, "All"), (.unread, model.unread > 0 ? "Unread · \(model.unread > 99 ? "99+" : String(model.unread))" : "Unread")])
                .frame(maxWidth: 240)
                .accessibilityIdentifier("notifications-filter")
            Spacer(minLength: 4)
            Button { Task { await model.markAllRead() } } label: {
                Label("Mark all read", systemImage: "checkmark").labelStyle(.titleAndIcon)
            }
            .buttonStyle(.folevi(.ghost, size: .small))
            .disabled(model.unread == 0)
            .accessibilityIdentifier("notifications-mark-all")
            Button { send(.dismiss); send(.openSettings(section: "notifications")) } label: {
                Image(systemName: "gearshape").font(.system(size: 15, weight: .medium)).frame(width: 32, height: 32).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Folevi.color.inkMuted)
            .accessibilityLabel("Notification settings")
            .accessibilityIdentifier("notifications-settings")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var list: some View {
        List {
            ForEach(model.rows, id: \.id) { r in
                NotificationRowView(row: r, phone: phone, accepting: model.accepting.contains(r.id), kind: model.inviteKind(r),
                    onTap: { Task { if let i = await model.tap(r) { send(.dismiss); send(i) } } },
                    onAccept: { Task { if let i = await model.accept(r) { send(.dismiss); send(i) } } },
                    onDecline: { Task { await model.decline(r) } },
                    onDownload: { if let f = r.fileId { send(.downloadFile(id: f)) } })
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Folevi.color.canvas)
                    .listRowSeparatorTint(Folevi.color.line)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button { Task { await model.toggleRead(r) } } label: {
                            r.read ? Label("Unread", systemImage: "circle.fill") : Label("Read", systemImage: "checkmark")
                        }
                        .tint(Color(red: 0.36, green: 0.42, blue: 0.82))
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) { Task { await model.remove(r) } } label: { Label("Remove", systemImage: "trash") }
                    }
                    .contextMenu {
                        Button { Task { await model.toggleRead(r) } } label: {
                            r.read ? Label("Mark as unread", systemImage: "circle") : Label("Mark as read", systemImage: "checkmark")
                        }
                        Divider()
                        Button(role: .destructive) { Task { await model.remove(r) } } label: { Label("Remove", systemImage: "trash") }
                    }
                    .accessibilityActions {
                        Button(r.read ? "Mark as unread" : "Mark as read") { Task { await model.toggleRead(r) } }
                        Button("Remove") { Task { await model.remove(r) } }
                    }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 1)
        .refreshable { _ = try? await model.client.command(.engineRefresh) }
    }
}

struct NotificationRowView: View {
    let row: NotificationRow
    let phone: Bool
    let accepting: Bool
    let kind: NotificationsModel.InviteKind?
    let onTap: () -> Void
    let onAccept: () -> Void
    let onDecline: () -> Void
    let onDownload: () -> Void

    var body: some View {
        let size: CGFloat = phone ? 36 : 28
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onTap) {
                HStack(alignment: .top, spacing: 12) {
                    ZStack(alignment: .bottomTrailing) {
                        if let actor = row.actorName {
                            Avatar(name: actor, size: size)
                            Image(systemName: NotificationsModel.symbol(row.kind))
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(Folevi.color.inkMuted)
                                .frame(width: 16, height: 16)
                                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(Folevi.color.surfaceRaised))
                                .offset(x: 4, y: 3)
                        } else {
                            Image(systemName: "bell").font(.system(size: phone ? 16 : 13)).foregroundStyle(Folevi.color.inkMuted)
                                .frame(width: size, height: size)
                                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(Folevi.color.surfaceSunken))
                        }
                    }
                    .padding(.top, 1)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(sentence).foleviFont(phone ? .callout : .footnote).fontWeight(row.read ? .regular : .medium)
                            .foregroundStyle(row.read ? Folevi.color.inkMuted : Folevi.color.ink)
                            .multilineTextAlignment(.leading)
                        if !row.body.isEmpty {
                            Text(row.body).foleviFont(phone ? .callout : .footnote).foregroundStyle(Folevi.color.inkMuted).lineLimit(2)
                                .padding(.leading, 8)
                                .overlay(alignment: .leading) { Rectangle().fill(Folevi.color.lineStrong).frame(width: 2) }
                        }
                        Text(AgeText.age(Date(timeIntervalSince1970: row.at / 1000), now: ScreenClock.now()))
                            .foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
                    }
                    Spacer(minLength: 14)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(sentence)\(row.body.isEmpty ? "" : ". \(row.body)"), \(AgeText.relative(Date(timeIntervalSince1970: row.at / 1000), now: ScreenClock.now()))\(row.read ? "" : ", unread")")
            .accessibilityIdentifier("notification-\(row.id)")

            if kind != nil || row.fileId != nil {
                HStack(spacing: 8) {
                    if row.fileId != nil {
                        Button("Download", action: onDownload).buttonStyle(.folevi(.secondary, size: phone ? .medium : .small))
                    }
                    if let kind {
                        Button(action: onAccept) {
                            if accepting { ProgressView().controlSize(.small) } else { Text(kind == .page ? "Accept and open" : "Accept invitation") }
                        }
                        .buttonStyle(.folevi(.primary, size: phone ? .medium : .small))
                        .disabled(accepting)
                        .accessibilityIdentifier("notification-accept-\(row.id)")
                        Button("Decline", action: onDecline)
                            .buttonStyle(.folevi(.ghost, size: phone ? .medium : .small))
                            .disabled(accepting)
                            .accessibilityIdentifier("notification-decline-\(row.id)")
                    }
                }
                .padding(.leading, size + 12)
            }
        }
        .padding(.leading, phone ? 20 : 12)
        .padding(.trailing, 16)
        .padding(.vertical, phone ? 12 : 9)
        .overlay(alignment: .topTrailing) {
            if !row.read {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(Folevi.color.coral).frame(width: 8, height: 8)
                    .padding(.trailing, 14).padding(.top, phone ? 20 : 15)
                    .accessibilityHidden(true)
            }
        }
    }

    /// The title with "and 3 more" when it stands for several.
    private var sentence: String {
        row.count > 1 ? "\(row.title) and \(row.count - 1) more" : row.title
    }
}
