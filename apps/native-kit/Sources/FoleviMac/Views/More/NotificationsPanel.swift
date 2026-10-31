// The bell's panel (apps/web/src/components/app/NotificationsButton.tsx as Folevi for Mac shows it): a 380 pt
// glass panel under the bell with Notifications, Mark all read and the settings button, All / Unread, then the
// rows by Today and Earlier: who did what where, a quote of the comment, when, an unread dot, and for
// invitations (workspace, page, folder) Accept and Decline. Data and actions from FoleviScreens'
// NotificationsModel (bridge `notifications.list`); folder invitations through folderInvite.accept and
// invite.decline { kind: "folder" }.
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

extension FrameDialogs {
    /// Opens the bell's panel under the sidebar's top bar.
    public static func notifications(_ frame: FrameModel, model: NotificationsModel) {
        FrameSheets.present(frame, top: 52, leading: 12) { close in
            NotificationsPanel(frame: frame, model: model, close: close)
        }
    }
}

struct NotificationsPanel: View {
    let frame: FrameModel
    @Bindable var model: NotificationsModel
    let close: @MainActor () -> Void
    @Environment(\.colorScheme) private var scheme

    private var groups: [(String, [NotificationRow])] {
        let start = Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000
        let rows = model.rows
        let today = rows.filter { $0.at >= start }, earlier = rows.filter { $0.at < start }
        return [("Today", today), ("Earlier", earlier)].filter { !$0.1.isEmpty }
    }

    var body: some View {
        let muted = moreVar("color-ink-muted", scheme)
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                Text(verbatim: "Notifications").webText(.role(.body, weight: 600)).lineLimit(1).foregroundStyle(moreVar("color-heading", scheme)).frame(maxWidth: .infinity, alignment: .leading)
                Button { Task { await model.markAllRead() } } label: {
                    HStack(spacing: 4) {
                        WebIconView(.check, size: 14)
                        Text(verbatim: "Mark all read").webText(.role(.caption1, weight: 500)).lineLimit(1)
                    }
                    .foregroundStyle(muted).padding(.horizontal, 8).frame(height: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(model.unread == 0)
                .opacity(model.unread == 0 ? 0.4 : 1)
                WebIconButton(.settings, label: "Notification settings") {
                    close()
                    frame.host?.frameOpenSettings(section: "notifications")
                }
            }
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
            HStack(spacing: 0) {
                seg("All", model.filter == .all) { model.filter = .all }
                seg("Unread", model.filter == .unread) { model.filter = .unread }
            }
            .padding(2)
            .background(RoundedRectangle(cornerRadius: 8).fill(moreVar("color-ink", scheme).opacity(0.06)))
            .frame(width: 176)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.bottom, 8)
            Rectangle().fill(moreVar("color-line", scheme).opacity(0.7)).frame(height: 1)
            ScrollView {
                if model.isLoading {
                    VStack(spacing: 12) {
                        ForEach([70, 55, 80], id: \.self) { w in
                            HStack(spacing: 12) {
                                RoundedRectangle(cornerRadius: 6).fill(moreVar("color-surface-sunken", scheme)).frame(width: 28, height: 28)
                                RoundedRectangle(cornerRadius: 4).fill(moreVar("color-surface-sunken", scheme)).frame(width: CGFloat(w) * 2.8, height: 14)
                                Spacer(minLength: 0)
                            }
                        }
                    }
                    .padding(16)
                } else if model.rows.isEmpty {
                    let empty = model.filter == .unread
                    VStack(spacing: 0) {
                        WebIconView(.bellOff, size: 16, strokeWidth: 1.9).frame(width: 36, height: 36).background(RoundedRectangle(cornerRadius: 6).fill(moreVar("glass-hover", scheme))).padding(.bottom, 12)
                        Text(verbatim: empty ? "No unread notifications" : "You’re all caught up").webText(.role(.body, weight: 600)).foregroundStyle(moreVar("color-heading", scheme))
                        Text(verbatim: "Comments, replies, @mentions and pages shared with you show up here.").webText(.role(.subheadline)).multilineTextAlignment(.center).foregroundStyle(muted).padding(.top, 4)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 40)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(groups, id: \.0) { g in
                            Text(verbatim: g.0.uppercased()).webText(.caps).lineLimit(1).foregroundStyle(muted).padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
                            VStack(spacing: 0) { ForEach(g.1, id: \.id) { row($0) } }.padding(.horizontal, 6)
                        }
                    }
                    .padding(.bottom, 8)
                }
            }
        }
        .frame(maxHeight: min(560, (FrameSheets.window(for: frame)?.contentView?.bounds.height ?? 820) - 72))
        .fixedSize(horizontal: false, vertical: true)
        .modifier(WebSheetPanel(style: WebStyles.named("more.dialog.sm"), width: 380))
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .accessibilityIdentifier("popover.notifications")
    }

    private func seg(_ title: String, _ on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(verbatim: title).webText(.role(.footnote, weight: on ? 550 : 400)).lineLimit(1)
                .foregroundStyle(on ? moreVar("color-heading", scheme) : moreVar("color-ink-muted", scheme))
                .frame(maxWidth: .infinity).frame(height: 24)
                .background(RoundedRectangle(cornerRadius: 6).fill(on ? moreVar("color-surface", scheme) : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Who did what, where (the note's name emphasised).
    private func sentence(_ n: NotificationRow) -> Text {
        let heading = moreVar("color-heading", scheme)
        let who = Text(verbatim: n.actorName ?? "Someone").fontWeight(.semibold).foregroundColor(heading)
        if let title = n.noteTitle, n.actorName != nil {
            let doc = Text(verbatim: title).fontWeight(.medium).foregroundColor(heading)
            switch n.kind {
            case "comment": return who + Text(verbatim: n.count > 1 ? " left \(n.count) comments on " : " commented on ") + doc
            case "reply": return who + Text(verbatim: n.count > 1 ? " replied \(n.count) times in " : " replied in ") + doc
            case "mention": return who + Text(verbatim: " mentioned you in ") + doc
            case "share": return who + Text(verbatim: " shared ") + doc + Text(verbatim: " with you")
            default: break
            }
        }
        return Text(verbatim: n.title)
    }

    private func kindIcon(_ kind: String) -> WebIcon {
        switch kind {
        case "comment", "reply": .messageSquare
        case "mention": .atSign
        case "share": .share2
        case "invite": .userPlus
        case "share_change": .keyRound
        default: .fileText
        }
    }

    private func row(_ raw: NotificationRow) -> some View {
        let n = model.row(raw)
        let muted = moreVar("color-ink-muted", scheme)
        return HoverReveal { hovered in
        VStack(alignment: .leading, spacing: 0) {
            HoverFill {
                Task {
                    if let intent = await model.tap(n) { open(intent) }
                }
            } content: {
                HStack(alignment: .top, spacing: 12) {
                    ZStack(alignment: .bottomTrailing) {
                        if let name = n.actorName {
                            Text(verbatim: String(name.prefix(1)).uppercased()).webText(.role(.footnote, weight: 600)).lineLimit(1)
                                .foregroundStyle(moreVar("color-canvas", scheme))
                                .frame(width: 28, height: 28)
                                .background(Circle().fill(moreVar("color-heading", scheme)))
                            WebIconView(kindIcon(n.kind), size: 9.5, strokeWidth: 2.4).foregroundStyle(muted)
                                .frame(width: 16, height: 16)
                                .background(RoundedRectangle(cornerRadius: 6).fill(moreVar("color-surface", scheme)))
                                .offset(x: 4, y: 2)
                        } else {
                            WebIconView(.bell, size: 13).foregroundStyle(muted).frame(width: 28, height: 28).background(RoundedRectangle(cornerRadius: 6).fill(moreVar("color-surface-sunken", scheme)))
                        }
                    }
                    .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 4) {
                        sentence(n).webText(.role(.subheadline)).foregroundStyle(n.read ? muted : moreVar("color-ink", scheme)).fixedSize(horizontal: false, vertical: true)
                        if !n.body.isEmpty {
                            Text(verbatim: n.body).webText(.role(.subheadline)).lineLimit(2).foregroundStyle(muted)
                                .padding(.leading, 8)
                                .overlay(alignment: .leading) { Rectangle().fill(moreVar("color-line-strong", scheme)).frame(width: 2) }
                        }
                        Text(verbatim: AgeText.relative(Date(timeIntervalSince1970: n.at / 1000))).webText(.role(.footnote)).lineLimit(1).foregroundStyle(moreVar("color-ink-faint", scheme))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 10).padding(.leading, 10).padding(.trailing, 36)
                .overlay(alignment: .topTrailing) {
                    if !n.read { RoundedRectangle(cornerRadius: 2).fill(moreVar("color-coral", scheme)).frame(width: 8, height: 8).padding(.top, 16).padding(.trailing, 14) }
                }
            }
            // The "…" in the row's corner while it's hovered (NotificationsButton.tsx: right-1.5 top-2, h-7 w-7, no
            // icons on the desktop); a right click is the window's own menu, as on the web.
            .overlay(alignment: .topTrailing) {
                RowMoreButton(label: "Options for this notification", shown: hovered, size: 28, iconSize: 15) {
                    [
                        WebMenuEntry(.item(n.read ? "Mark as unread" : "Mark as read")) { Task { await model.toggleRead(n) } },
                        WebMenuEntry(.item("Remove", danger: true)) { Task { await model.remove(n) } },
                    ]
                }
                .padding(.top, 8)
                .padding(.trailing, 6)
            }
            if model.inviteKind(n) != nil || n.folderInviteId != nil {
                HStack(spacing: 6) {
                    inviteButton(n.folderInviteId != nil ? "Accept and open" : "Accept", primary: true) { accept(n) }
                    inviteButton("Decline", primary: false) { decline(n) }
                }
                .padding(.leading, 50).padding(.bottom, 10).padding(.top, -4)
            }
        }
        }
    }

    private func inviteButton(_ title: String, primary: Bool, action: @escaping () -> Void) -> some View {
        let style = WebStyles.named(primary ? "more.prompt.submit" : "more.prompt.cancel")
        let s = style.resolve(scheme)
        return Button(action: action) {
            Text(verbatim: title).webText(.role(.footnote, weight: 500)).lineLimit(1).fixedSize()
                .padding(.horizontal, 10).frame(height: 28)
                .foregroundStyle(s.color.color)
                .webBox(style)
        }
        .buttonStyle(.plain)
    }

    private func accept(_ n: NotificationRow) {
        if let fid = n.folderInviteId {
            frame.perform {
                let r = try await frame.client.command(.folderInviteAccept(inviteId: fid))
                frame.toast("The folder was added to Shared with Me.", tone: .success)
                close()
                frame.open(.web("/shared/\(r.folderId)"))
            }
            return
        }
        Task {
            if let intent = await model.accept(n) { open(intent) }
        }
    }

    private func decline(_ n: NotificationRow) {
        if let fid = n.folderInviteId {
            frame.perform {
                _ = try await frame.client.command(.inviteDecline(kind: .folder, inviteId: fid))
                frame.toast("Invitation declined.")
            }
            return
        }
        Task { await model.decline(n) }
    }

    private func open(_ intent: ScreenIntent) {
        close()
        FrameNavigation.intents(frame).send(intent)
    }
}

/// A row's hover fill (`hover:bg-[var(--glass-hover)]`, rounded).
private struct HoverFill<Content: View>: View {
    let action: () -> Void
    @ViewBuilder let content: () -> Content
    @State private var hovering = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(hovering ? moreVar("glass-hover", scheme) : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
#endif
