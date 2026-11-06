// Sharing from the frame (docs/SHARING.md), as the web's dialogs: a page's Share dialog (doc/ShareDialog.tsx:
// who has access, people and roles, invitations, public links) and a folder's (app/FolderShareDialog.tsx: what
// sharing reaches, people, from folders above, invitations). Bridge views `sharing.get` and `folderSharing.get`;
// commands sharing.* / folderSharing.* / publicLink.*. Sharing inside an open note stays the editor's own.
// Both in the web's compact rows (the owner's design A, 2026-11-06): add people, who's added, Access as one
// dropdown, the public link as a switch with its settings folded away, Copy link and Done in the footer; the
// longer explanations are (i) tooltips. The body scrolls inside when the window is short.
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
    /// A page's Share dialog (from a note's row or card menu).
    public static func share(_ frame: FrameModel, noteId: String, title: String) {
        guard frame.session.value?.mode != .local else { return signInToShare(frame) }
        let store = frame.client.watch(.sharingGet(id: noteId))
        FrameSheets.present(frame) { close in
            PageShareSheet(frame: frame, noteId: noteId, title: title, store: store, close: close)
        }
    }

    /// A folder's Share dialog (its "…" menu, its page, People on a shared folder).
    public static func folderShare(_ frame: FrameModel, folderId: String, name: String) {
        guard frame.session.value?.mode != .local else { return signInToShare(frame) }
        let store = frame.client.watch(.folderSharingGet(id: folderId))
        FrameSheets.present(frame) { close in
            FolderShareSheet(frame: frame, folderId: folderId, name: name, store: store, close: close)
        }
    }

    /// Local mode: the web's "Sign in to Folevi to share and collaborate" where sharing would be.
    static func signInToShare(_ frame: FrameModel) {
        FrameSheets.present(frame) { close in
            WebSheetDialog(title: "Share", close: close) {
                MoreEmptyState(icon: .users, title: "Sign in to Folevi to share and collaborate", message: "Your notes are kept on your devices. Sharing, comments and workspaces need a Folevi account.")
            }
        }
    }
}

/// Runs a sharing command, toasting what happened.
@MainActor
private func run(_ frame: FrameModel, _ ok: String?, _ work: @escaping @MainActor () async throws -> Void) {
    Task {
        do {
            try await work()
            if let ok { frame.toast(ok, tone: .success) }
        } catch {
            frame.toast(ScreenErrors.message(error), tone: .error)
        }
    }
}

/// Runs a sharing command, toasting what happened; true when it went through.
@MainActor
private func attempt(_ frame: FrameModel, _ ok: String?, _ work: @escaping @MainActor () async throws -> Void) async -> Bool {
    do {
        try await work()
        if let ok { frame.toast(ok, tone: .success) }
        return true
    } catch {
        frame.toast(ScreenErrors.message(error), tone: .error)
        return false
    }
}

/// A button whose command is in flight: disabled, saying so (`busyTitle`), so a second click can't send it twice
/// (MAC-15: a second public link, a second Save).
private struct BusyButton: View {
    let title: String
    var busyTitle: String?
    var icon: WebIcon?
    var variant: WebButtonVariant = .secondary
    let work: @MainActor () async -> Void
    @State private var busy = false

    var body: some View {
        WebButton(busy ? (busyTitle ?? title) : title, icon: icon, variant: variant, size: .sm) {
            guard !busy else { return }
            busy = true
            Task {
                await work()
                busy = false
            }
        }
        .disabled(busy)
    }
}

private let roles: [(id: String, title: String)] = [("viewer", "Can view"), ("commenter", "Can comment"), ("editor", "Can edit")]

/// The add-people row: an email field, a role and Share, then a short muted line whose whole note is a tooltip.
private struct InviteRow: View {
    let short: String
    let note: String
    let send: @MainActor (String, String) async -> Void
    @State private var email = ""
    @State private var role = "viewer"
    @State private var sending = false
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let input = WebStyles.named("more.prompt.input")
        let i = input.resolve(scheme)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                ZStack(alignment: .leading) {
                    if email.isEmpty { Text(verbatim: "name@example.com").webText(i.text).lineLimit(1).foregroundStyle(i.color.color.opacity(0.5)) }
                    TextField("", text: $email).textFieldStyle(.plain).webText(i.text).lineLimit(1).offset(x: -1.125, y: 1.035).focused($focused).onSubmit(submit).accessibilityLabel("Email address")
                }
                // The focus ring as the dialogs' other fields show it (MAC-37).
                .padding(i.padding.edgeInsets).frame(height: i.height).foregroundStyle(i.color.color).webBox(focused ? webFocused(input) : input)
                WebBareSelect(label: roles.first { $0.id == role }?.title ?? "Can view", options: roles.map { ($0.id, $0.title) }, selected: role) { role = $0 }
                    .padding(.horizontal, 10).webBox(input).listHoverTint(radius: 6)
                WebSheetButton(title: "Share", primary: true, enabled: !sending && email.contains("@"), action: submit)
            }
            MutedLine(text: short, tip: note)
        }
    }

    private func submit() {
        let to = email.trimmingCharacters(in: .whitespaces)
        guard !to.isEmpty, !sending else { return }
        sending = true
        Task {
            await send(to, role)
            email = ""
            sending = false
        }
    }
}

/// A small (i) whose words show in Folevi's tooltip: the longer explanations, kept off the dialog.
private struct InfoTip: View {
    let text: String
    @State private var over = false
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        WebIconView(.info, size: 13)
            .foregroundStyle(moreVar(over ? "color-ink" : "color-ink-faint", scheme))
            .contentShape(Rectangle())
            .onHover { over = $0 }
            .foleviTooltip(text)
            .accessibilityLabel(text)
    }
}

/// A one-line muted note, with its whole text in an (i) tooltip when there's more to say.
private struct MutedLine: View {
    let text: String
    var tip: String? = nil
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        HStack(spacing: 6) {
            Text(verbatim: text).webText(.role(.footnote)).lineLimit(1).foregroundStyle(moreVar("color-ink-muted", scheme))
            if let tip { InfoTip(text: tip) }
        }
    }
}

/// A quiet list: rows without a box (the compact dialogs, as Google Docs and Notion list people).
private struct QuietList<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View { VStack(spacing: 0, content: content).padding(.horizontal, -8) }
}

private struct PersonRow: View {
    let name: String
    let email: String?
    let isYou: Bool
    let guest: Bool
    let role: String
    let canChange: Bool
    /// Each true when the command went through.
    let setRole: @MainActor (String) async -> Bool
    let remove: @MainActor () async -> Bool
    var leave: (@MainActor () -> Void)? = nil
    /// The role just picked, shown at once until the server's answer says it (MAC-14: the select kept the old role
    /// until the round trip ended, so the first pick looked ignored); dropped if the change failed.
    @State private var pendingRole: String?
    @State private var removing = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let role = pendingRole ?? self.role
        let muted = moreVar("color-ink-muted", scheme)
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Text(verbatim: name).webText(.role(.subheadline, weight: 500)).lineLimit(1)
                    if isYou { Text(verbatim: "(you)").webText(.role(.footnote)).foregroundStyle(muted) }
                    if guest {
                        Text(verbatim: "Guest").webText(.role(.caption2, weight: 500)).foregroundStyle(muted)
                            .padding(.horizontal, 6).overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(moreVar("color-line", scheme), lineWidth: 1))
                    }
                }
                if let email { Text(verbatim: email).webText(.role(.footnote)).lineLimit(1).foregroundStyle(muted) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if canChange {
                WebBareSelect(label: Roles.label(role), options: roles.map { ($0.id, $0.title) }, selected: role) { r in
                    guard r != role else { return }
                    pendingRole = r
                    Task { if await !setRole(r) { pendingRole = nil } }
                }
                .padding(.horizontal, 6).listHoverTint(radius: 6)
                // (Removing: the button waits for the answer, so a second click doesn't send it again: MAC-15.)
                WebIconButton(.trash, label: "Remove \(name)") {
                    guard !removing else { return }
                    removing = true
                    Task {
                        _ = await remove()
                        removing = false
                    }
                }
                .disabled(removing)
                .opacity(removing ? 0.4 : 1)
            } else {
                Text(verbatim: Roles.label(role)).webText(.role(.footnote)).foregroundStyle(muted)
            }
            if let leave { WebButton("Leave", variant: .quiet, size: .sm, action: leave) }
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        // The server has it: its answer shows from here on (another device's change too).
        .onChange(of: self.role) { _, now in if now == pendingRole { pendingRole = nil } }
    }
}

private struct CapsHeading: View {
    let title: String
    var tip: String? = nil
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        HStack(spacing: 6) {
            Text(verbatim: title.uppercased()).webText(WebTextStyle.role(.footnote, weight: 600).tracking(em: 0.06)).lineLimit(1)
                .foregroundStyle(moreVar("color-ink-faint", scheme))
            if let tip { InfoTip(text: tip) }
        }
        .padding(.top, 4)
    }
}

private struct Separator: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View { Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1) }
}

/// A Folevi dropdown in a field's box (ui/Select.tsx with `ui-input`), its options with a description line.
private struct FieldSelect: View {
    let label: String
    var icon: WebIcon? = nil
    let options: [(id: String, title: String, description: String, icon: WebIcon?)]
    let selected: String
    var enabled = true
    let pick: @MainActor (String) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let input = WebStyles.named("more.prompt.input")
        let i = input.resolve(scheme)
        WebMenuButton(width: 300, align: .start, entries: {
            options.map { o in WebMenuEntry(.item(o.title, icon: o.icon, checked: o.id == selected, description: o.description, id: o.id)) { pick(o.id) } }
        }) {
            HStack(spacing: 8) {
                if let icon { WebIconView(icon, size: 15).foregroundStyle(moreVar("color-ink-muted", scheme)) }
                Text(verbatim: label).webText(i.text).lineLimit(1)
                Spacer(minLength: 0)
                WebIconView(.chevronDown, size: 14).opacity(0.6)
            }
            .foregroundStyle(i.color.color)
            .padding(.horizontal, 12).frame(height: i.height).frame(maxWidth: .infinity)
            .webBox(input)
            .listHoverTint(radius: 6, enabled: enabled)
            .contentShape(Rectangle())
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.6)
        .accessibilityLabel("\(label), \(label)")
    }
}

/// The dialogs' footer (ui/Dialog.tsx `footer`): Copy link at the start, Done at the end.
private struct ShareFooter: View {
    let copyLink: @MainActor () -> Void
    let done: @MainActor () -> Void
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        HStack(spacing: 8) {
            WebButton("Copy link", icon: .link2, variant: .quiet, size: .sm, action: copyLink)
            Spacer(minLength: 0)
            WebSheetButton(title: "Done", primary: true, action: done)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(moreVar("color-surface-sunken", scheme).opacity(0.6))
        .overlay(alignment: .top) { Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1) }
    }
}

/// How tall the dialog's body may be: the window less the tab strip, the dialog's title and footer and a margin,
/// so the dialog sits inside the window, below the tab strip, and scrolls inside when the window is short.
@MainActor
private func shareBodyMaxHeight() -> CGFloat {
    #if os(macOS)
    let window = NSApp.keyWindow?.contentLayoutRect.height ?? 700
    #else
    let window = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.bounds.height ?? 700
    #endif
    return max(180, min(560, window - 2 * ContentViewController.barHeight - 170))
}

@MainActor
private func copyToPasteboard(_ frame: FrameModel, _ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    frame.toast("Link copied")
}

private let looks: [(id: String, title: String, description: String, icon: WebIcon?)] = [
    ("note", "Note", "The note’s own style", nil),
    ("article", "Article", "Serif and narrow, for reading", nil),
    ("docs", "Docs", "Wide, with contents beside it", nil),
    ("minimal", "Minimal", "Plain paper, no cover", nil),
]
private func lookName(_ id: String) -> String { looks.first { $0.id == id }?.title ?? "Note" }

// MARK: a page

struct PageShareSheet: View {
    let frame: FrameModel
    let noteId: String
    let title: String
    let store: ValueStore<SharingValue>
    let close: @MainActor () -> Void
    @State private var freshLink: String?
    @State private var freshId: String?
    /// The access just picked, shown at once until the note's sharing says it (one click is enough; the
    /// highlight used to wait for the server, so a first click looked like it did nothing).
    @State private var pendingMode: String?
    @State private var settingsOpen = false
    @State private var another = false
    @State private var busy = false
    // A new link's settings (Link settings, before the switch or Create link).
    @State private var newExpires = ""
    @State private var newPassword = ""
    @State private var newIndex = false
    @State private var newTheme = "note"
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        WebSheetDialog(title: "Share “\(title.isEmpty ? "Untitled" : title)”", width: 480, close: close) {
            ScrollView {
                if let d = store.value { content(d) } else { Text(verbatim: "Loading…").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)) }
            }
            .frame(maxHeight: shareBodyMaxHeight())
            .fixedSize(horizontal: false, vertical: true)
        } footer: {
            ShareFooter(copyLink: { copyToPasteboard(frame, FoleviLinks.note(noteId)) }, done: close)
        }
    }

    static let peopleNote = "People outside the workspace join as guests on this page only and aren’t billed. People without a Folevi account get an invitation by email."
    static let personalNote = "Anyone with an email address. People without a Folevi account get an invitation by email."
    static let linkInfo = "Anyone with the link can read this page (not its comments or nested pages). Search engines skip it unless you let them find it, and you can revoke it instantly."

    private func content(_ d: SharingValue) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        let personal = frame.session.value?.spaces.first { $0.id == frame.session.value?.space }?.kind == .personal
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                if d.youAreGuest {
                    MutedLine(text: "You’re a guest\(d.sharedBy.map { ", shared by \($0)" } ?? "").", tip: "\(d.ownerName.isEmpty ? "" : "It belongs to \(d.ownerName). ")Only its owner and the workspace’s members can share it.")
                }
                if d.canShare {
                    InviteRow(short: personal ? "Anyone with an email address." : "People outside the workspace join as guests.", note: personal ? Self.personalNote : Self.peopleNote) { email, role in
                        do {
                            let r = try await frame.client.command(.sharingInvite(noteId: noteId, email: email, role: ShareInviteArgs.Role(rawValue: role) ?? .viewer))
                            frame.toast(r.status == "invited" ? "Invitation sent to \(email). They get access once they sign up and accept." : "Shared", tone: .success)
                        } catch { frame.toast(ScreenErrors.message(error), tone: .error) }
                    }
                }
                if d.people.isEmpty {
                    Text(verbatim: "No one added directly.").webText(.role(.subheadline)).foregroundStyle(muted)
                } else {
                    QuietList {
                        ForEach(d.people, id: \.profileId) { p in
                            PersonRow(name: p.name, email: p.email, isYou: p.isYou, guest: p.guest, role: p.role, canChange: p.canChange,
                                      setRole: { r in await attempt(frame, "Access changed") { _ = try await frame.client.command(.sharingSetRole(noteId: noteId, profileId: p.profileId, role: ShareRoleArgs.Role(rawValue: r) ?? .viewer)) } },
                                      remove: { await attempt(frame, "Removed") { _ = try await frame.client.command(.sharingRevoke(noteId: noteId, profileId: p.profileId)) } })
                        }
                    }
                }
                if !d.invites.isEmpty {
                    CapsHeading(title: "Invited by email")
                    QuietList {
                        ForEach(d.invites, id: \.id) { inv in
                            inviteRow(inv) { _ = await attempt(frame, "Invitation revoked") { _ = try await frame.client.command(.sharingCancelInvite(inviteId: inv.id)) } }
                        }
                    }
                }
            }
            HStack(spacing: 12) {
                Text(verbatim: "Access").webText(.role(.subheadline, weight: 500)).frame(width: 56, alignment: .leading)
                if personal {
                    HStack(spacing: 6) {
                        WebIconView(.lock, size: 15)
                        Text(verbatim: "Only the owner and people added here").webText(.role(.subheadline)).lineLimit(1)
                        InfoTip(text: "This page is in a Personal space: only its owner and the people added here can open it.")
                    }
                    .foregroundStyle(muted)
                } else {
                    let mode = pendingMode ?? d.accessMode
                    FieldSelect(label: mode == "restricted" ? "Only invited people" : "Workspace", icon: mode == "restricted" ? .lock : .users, options: [
                        ("workspace", "Workspace", "Everyone in this workspace, by their role", .users),
                        ("restricted", "Only invited people", "Owners, admins, the creator and people added here", .lock),
                    ], selected: mode, enabled: d.canManage) { setMode(d, $0) }
                    // The server has it: its answer shows from here on (another device's change too).
                    .onChange(of: d.accessMode) { _, now in if now == pendingMode { pendingMode = nil } }
                }
            }
            if d.canManage {
                Separator()
                publicLinks(d)
            }
        }
        .padding(.bottom, 4)
    }

    private func setMode(_ d: SharingValue, _ id: String) {
        guard (pendingMode ?? d.accessMode) != id else { return }
        pendingMode = id
        Task {
            do {
                _ = try await frame.client.command(.sharingSetAccessMode(noteId: noteId, mode: AccessModeArgs.Mode(rawValue: id) ?? .workspace))
            } catch {
                frame.toast(ScreenErrors.message(error), tone: .error)
                pendingMode = nil
            }
        }
    }

    private static func expiryText(_ l: PublicLinkRow) -> String {
        l.expired ? "Expired" : l.expiresAt.map { "Expires \(Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened))" } ?? "No expiry"
    }

    /// The end of a YYYY-MM-DD day here, in milliseconds (the link stops working after that day).
    private static func endOfDay(_ day: String) -> Double? {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let start = Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])),
              let end = Calendar.current.date(byAdding: DateComponents(day: 1, second: -1), to: start) else { return nil }
        return end.timeIntervalSince1970 * 1000
    }

    private func makeLink(_ d: SharingValue) async {
        guard !busy else { return }
        if !newPassword.isEmpty, newPassword.count < 5 {
            settingsOpen = true
            frame.toast("Use a password of at least 5 characters.", tone: .error)
            return
        }
        busy = true
        defer { busy = false }
        _ = await attempt(frame, nil) {
            let r = try await frame.client.command(.publicLinkCreate(noteId: noteId, expiresAt: Self.endOfDay(newExpires), password: newPassword.isEmpty ? nil : newPassword, allowIndexing: newIndex && newPassword.isEmpty && !d.encrypted, theme: PublicLinkCreateArgs.Theme(rawValue: newTheme)))
            freshLink = r.url
            freshId = r.id
            newExpires = ""
            newPassword = ""
            newIndex = false
            newTheme = "note"
            another = false
        }
    }

    private func stopLinks(_ d: SharingValue) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        _ = await attempt(frame, d.links.count > 1 ? "Links revoked" : "Link revoked") {
            for l in d.links { _ = try await frame.client.command(.publicLinkRevoke(linkId: l.id)) }
        }
        freshLink = nil
    }

    private func publicLinks(_ d: SharingValue) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        let on = !d.links.isEmpty
        let newest = d.links.max { $0.createdAt < $1.createdAt }
        let summary = on && newest != nil
            ? "\(Self.expiryText(newest!)) · \(lookName(newest!.theme)) look"
            : "\(newExpires.isEmpty ? "No expiry" : "Expires \(PlannerDates.fieldLabel(newExpires))")\(newPassword.isEmpty ? "" : " · Password") · \(lookName(newTheme)) look"
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                WebIconView(.globe, size: 15)
                Text(verbatim: "Public link").webText(.role(.subheadline, weight: 600))
                InfoTip(text: d.encrypted ? "This note is end-to-end encrypted: its public link carries the key, so anyone with the whole link can read it." : Self.linkInfo)
                Spacer(minLength: 0)
                SettingsSwitch(isOn: on, label: "Public link", disabled: busy || (!on && !d.publicLinksAvailable)) { want in
                    if want { await makeLink(d) } else { await stopLinks(d) }
                    return true
                }
            }
            Group {
                if !d.publicLinksAvailable { Text(verbatim: "Public links are temporarily turned off for Folevi.").webText(.role(.footnote)).foregroundStyle(moreVar("color-marigold", scheme)) }
                if !on { Text(verbatim: "Off: only the people with access can open it.").webText(.role(.footnote)).foregroundStyle(muted) }
                ForEach(d.links, id: \.id) { l in linkRow(l, fresh: freshId == l.id || (freshId == nil && l.id == newest?.id) ? freshLink : nil) }
                settings(d, summary: summary)
            }
            .padding(.leading, 23)
        }
    }

    private func linkRow(_ l: PublicLinkRow, fresh: String?) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(verbatim: fresh ?? "\(FoleviLinks.shareHost)/s/\(l.tokenHint)••••••••").font(WebFont.font(.mono, size: 12)).lineLimit(1).truncationMode(.middle)
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    .foleviTooltip(fresh == nil ? "The whole link is shown once, when it’s made." : nil)
                if let fresh { WebButton("Copy", icon: .copy, size: .sm) { copyToPasteboard(frame, fresh) } }
                BusyButton(title: "Revoke", busyTitle: "Revoking…", variant: .quiet) { _ = await attempt(frame, "Link revoked") { _ = try await frame.client.command(.publicLinkRevoke(linkId: l.id)) } }
            }
            HStack(spacing: 0) {
                if fresh != nil { Text(verbatim: "Copy it now: it isn’t shown again. ").webText(.role(.footnote, weight: 500)).foregroundStyle(moreVar("color-success", scheme)) }
                Text(verbatim: "\(Self.expiryText(l))\(l.hasPassword ? " · Password" : "")\(l.allowIndexing ? " · Search engines can find it" : "") · \(l.viewCount) view\(l.viewCount == 1 ? "" : "s")")
                    .webText(.role(.footnote)).foregroundStyle(muted)
            }
            .lineLimit(1)
        }
    }

    /// `› Link settings (No expiry · Note look)`, folded by default: the link's look while it's on (the rest is
    /// set when a link is made), a new link's expiry, password, look and search engines while it's off.
    private func settings(_ d: SharingValue, summary: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { settingsOpen.toggle() } label: {
                HStack(spacing: 4) {
                    WebIconView(.chevronRight, size: 13).rotationEffect(.degrees(settingsOpen ? 90 : 0))
                    Text(verbatim: "Link settings").webText(.role(.footnote, weight: 500))
                    Text(verbatim: "(\(summary))").webText(.role(.footnote)).lineLimit(1).foregroundStyle(moreVar("color-ink-faint", scheme))
                }
                .foregroundStyle(moreVar("color-ink-muted", scheme))
                .padding(.horizontal, 6).padding(.vertical, 4)
                .listHoverTint(radius: 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.webPlain)
            .padding(.leading, -6)
            .accessibilityAddTraits(settingsOpen ? .isSelected : [])
            if settingsOpen {
                VStack(alignment: .leading, spacing: 10) {
                    if !d.links.isEmpty {
                        ForEach(d.links, id: \.id) { l in
                            if d.links.count > 1 { Text(verbatim: "…/s/\(l.tokenHint)").font(WebFont.font(.mono, size: 12)).foregroundStyle(moreVar("color-ink-muted", scheme)) }
                            fieldRow("Look") {
                                FieldSelect(label: lookName(l.theme), options: looks, selected: l.theme) { t in
                                    run(frame, "Look changed") { _ = try await frame.client.command(.publicLinkSetTheme(linkId: l.id, theme: PublicLinkThemeArgs.Theme(rawValue: t) ?? .note)) }
                                }
                            }
                            fieldRow("Expires") {
                                HStack(spacing: 6) {
                                    Text(verbatim: "\(Self.expiryText(l))\(l.hasPassword ? " · Password" : "")").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme))
                                    InfoTip(text: "Set when the link is made. To change them, revoke it and make a new one.")
                                }
                            }
                        }
                        if another { Separator(); newLinkFields(d) } else {
                            WebButton("New link…", variant: .quiet, size: .sm) { another = true }.disabled(!d.publicLinksAvailable)
                        }
                    } else {
                        newLinkFields(d)
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 8).fill(moreVar("color-ink", scheme).opacity(0.04)))
            }
        }
    }

    @ViewBuilder private func newLinkFields(_ d: SharingValue) -> some View {
        let input = WebStyles.named("more.prompt.input")
        let i = input.resolve(scheme)
        fieldRow("Expires") { PlannerDateField(value: $newExpires, label: "Expiry", placeholder: "Never", width: 200) }
        fieldRow("Password") {
            SecureField("", text: $newPassword, prompt: Text(verbatim: "None")).textFieldStyle(.plain).webText(i.text)
                .padding(i.padding.edgeInsets).frame(height: i.height).webBox(input).accessibilityLabel("Password")
        }
        fieldRow("Look") { FieldSelect(label: lookName(newTheme), options: looks, selected: newTheme) { newTheme = $0 } }
        if !d.encrypted {
            fieldRow("Search") {
                HStack(spacing: 8) {
                    SettingsSwitch(isOn: newIndex && newPassword.isEmpty, label: "Let search engines find it", disabled: !newPassword.isEmpty) { on in
                        newIndex = on
                        return true
                    }
                    Text(verbatim: newPassword.isEmpty ? "Let search engines find it" : "Not for a password-protected page.").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
                }
            }
        }
        HStack {
            Spacer(minLength: 0)
            BusyButton(title: "Create link", busyTitle: "Creating…", icon: .globe, variant: .primary) { await makeLink(d) }
                .disabled(!d.publicLinksAvailable)
        }
    }

    private func fieldRow<Control: View>(_ label: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(spacing: 12) {
            Text(verbatim: label).webText(.role(.subheadline, weight: 500)).frame(width: 72, alignment: .leading)
            control().frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func inviteRow(_ i: ShareInvite, revoke: @escaping @MainActor () async -> Void) -> some View {
        HStack(spacing: 12) {
            Text(verbatim: i.email).webText(.role(.subheadline)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: "\(Roles.label(i.role)) · \(i.expired ? "expired" : "waiting to accept")").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
            BusyButton(title: "Revoke", busyTitle: "Revoking…", variant: .quiet, work: revoke)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
    }
}

// MARK: a folder

struct FolderShareSheet: View {
    let frame: FrameModel
    let folderId: String
    let name: String
    let store: ValueStore<FolderSharingValue>
    let close: @MainActor () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        WebSheetDialog(title: "Share “\(name.isEmpty ? "Untitled" : name)”", width: 480, close: close) {
            ScrollView {
                if let d = store.value { content(d) } else { Text(verbatim: "Loading…").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)) }
            }
            .frame(maxHeight: shareBodyMaxHeight())
            .fixedSize(horizontal: false, vertical: true)
        } footer: {
            ShareFooter(copyLink: { copyToPasteboard(frame, FoleviLinks.folder(folderId)) }, done: close)
        }
    }

    static func summary(noteCount: Int, people: Int, personal: Bool) -> String {
        let notes = { (n: Int) in n == 1 ? "1 note" : "\(n) notes" }
        let what = noteCount == 0 ? "its notes" : "its \(notes(noteCount))"
        let base = "People with access to this folder can see \(what), in its subfolders too, and notes added later."
        if people == 0 { return "\(base) \(personal ? "Only you can see it now." : "Now it’s only for the workspace, by each member’s role.")" }
        return "\(base) It’s shared with \(people == 1 ? "1 person" : "\(people) people")."
    }

    private func note(_ t: String, _ icon: WebIcon?) -> some View {
        HStack(alignment: .top, spacing: 6) {
            if let icon { WebIconView(icon, size: 15).padding(.top, 1) }
            Text(verbatim: t).webText(.role(.footnote)).frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(moreVar("color-ink-muted", scheme))
    }

    private func peopleList(_ d: FolderSharingValue) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        return Group {
            if d.people.isEmpty {
                Text(verbatim: d.youAreGuest ? "Shared with you through a folder above it." : "No one added yet.").webText(.role(.subheadline)).foregroundStyle(muted)
            } else {
                QuietList {
                    ForEach(d.people, id: \.profileId) { p in personRow(d, p) }
                }
            }
        }
    }

    private func personRow(_ d: FolderSharingValue, _ p: FolderShareGrant) -> PersonRow {
        let frame = frame, folderId = folderId, close = close
        var leave: (@MainActor () -> Void)?
        if p.isYou && d.youAreGuest {
            leave = { @MainActor in
                close()
                run(frame, "You left the folder") { _ = try await frame.client.command(.folderSharingRevoke(folderId: folderId, profileId: p.profileId)) }
            }
        }
        return PersonRow(name: p.name, email: p.email, isYou: p.isYou, guest: p.guest, role: p.role, canChange: p.canChange,
                         setRole: { r in await attempt(frame, "Access changed") { _ = try await frame.client.command(.folderSharingSetRole(folderId: folderId, profileId: p.profileId, role: FolderShareRoleArgs.Role(rawValue: r) ?? .viewer)) } },
                         remove: { await attempt(frame, "Removed") { _ = try await frame.client.command(.folderSharingRevoke(folderId: folderId, profileId: p.profileId)) } },
                         leave: leave)
    }

    private func content(_ d: FolderSharingValue) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        return VStack(alignment: .leading, spacing: 16) {
            note(Self.summary(noteCount: d.noteCount, people: d.people.count, personal: d.personal), nil)
            if let blocked = d.blocked { note(blocked, .folderLock) }
            VStack(alignment: .leading, spacing: 8) {
                if d.youAreGuest {
                    MutedLine(text: "Shared with you\(d.sharedBy.map { " by \($0)" } ?? "").", tip: "\(d.ownerName.map { "It belongs to \($0). " } ?? "")Only its owner\(d.personal ? "" : " and the workspace’s admins") can share it.")
                } else if !d.canManage {
                    Text(verbatim: "Only the folder’s owner and the workspace’s owners and admins can share it.").webText(.role(.footnote)).foregroundStyle(muted)
                }
                if d.canManage, d.blocked == nil {
                    InviteRow(short: d.personal ? "Anyone with an email address." : "People outside the workspace join as guests.", note: d.personal ? PageShareSheet.personalNote : "People outside the workspace join as guests on this folder only and aren’t billed. People without a Folevi account get an invitation by email.") { email, role in
                        do {
                            let r = try await frame.client.command(.folderSharingInvite(folderId: folderId, email: email, role: FolderShareInviteArgs.Role(rawValue: role) ?? .viewer))
                            frame.toast(r.status == "invited" ? "Invitation sent to \(email). They get access once they sign up and accept." : "Shared", tone: .success)
                        } catch { frame.toast(ScreenErrors.message(error), tone: .error) }
                    }
                }
                peopleList(d)
                if !d.inherited.isEmpty {
                    CapsHeading(title: "From folders above")
                    QuietList {
                        let rows = d.inherited.flatMap { f in f.people.map { (f, $0) } }
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, pair in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(verbatim: pair.1.name + (pair.1.isYou ? " (you)" : "")).webText(.role(.subheadline, weight: 500)).lineLimit(1)
                                    Text(verbatim: "From folder \(pair.0.folderName.isEmpty ? "Untitled" : pair.0.folderName)").webText(.role(.footnote)).lineLimit(1).foregroundStyle(muted)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text(verbatim: Roles.label(pair.1.role)).webText(.role(.footnote)).foregroundStyle(muted)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                        }
                    }
                }
                if !d.invites.isEmpty {
                    CapsHeading(title: "Invited by email")
                    QuietList {
                        ForEach(d.invites, id: \.id) { inv in
                            HStack(spacing: 12) {
                                Text(verbatim: inv.email).webText(.role(.subheadline)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                Text(verbatim: "\(Roles.label(inv.role)) · \(inv.expired ? "expired" : "waiting to accept")").webText(.role(.footnote)).foregroundStyle(muted)
                                BusyButton(title: "Revoke", busyTitle: "Revoking…", variant: .quiet) { _ = await attempt(frame, "Invitation revoked") { _ = try await frame.client.command(.folderSharingCancelInvite(inviteId: inv.id)) } }
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                        }
                    }
                }
            }
            Separator()
            if d.youAreGuest {
                Button { close(); frame.open(.web("/shared/\(folderId)")) } label: { Text(verbatim: "Open the shared folder").underline().webText(.role(.footnote)).foregroundStyle(muted).listHoverTint(radius: 4) }.buttonStyle(.webPlain)
            } else {
                Text(verbatim: "Public links are for single notes: share a note to make one.").webText(.role(.footnote)).foregroundStyle(muted)
            }
        }
        .padding(.bottom, 4)
    }
}
#endif
