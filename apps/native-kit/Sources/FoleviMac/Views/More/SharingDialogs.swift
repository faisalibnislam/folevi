// Sharing from the frame (docs/SHARING.md), as the web's dialogs: a page's Share dialog (doc/ShareDialog.tsx:
// who has access, people and roles, invitations, public links) and a folder's (app/FolderShareDialog.tsx: what
// sharing reaches, people, from folders above, invitations). Bridge views `sharing.get` and `folderSharing.get`;
// commands sharing.* / folderSharing.* / publicLink.*. Sharing inside an open note stays the editor's own.
#if os(macOS)
import AppKit
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

private let roles: [(id: String, title: String)] = [("viewer", "Can view"), ("commenter", "Can comment"), ("editor", "Can edit")]

/// The add-people row: an email field, a role and Share.
private struct InviteRow: View {
    let note: String
    let send: @MainActor (String, String) async -> Void
    @State private var email = ""
    @State private var role = "viewer"
    @State private var sending = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let input = WebStyles.named("more.prompt.input")
        let i = input.resolve(scheme)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ZStack(alignment: .leading) {
                    if email.isEmpty { Text(verbatim: "name@example.com").webText(i.text).lineLimit(1).foregroundStyle(i.color.color.opacity(0.5)) }
                    TextField("", text: $email).textFieldStyle(.plain).webText(i.text).lineLimit(1).offset(x: -1.125, y: 1.035).onSubmit(submit).accessibilityLabel("Email address")
                }
                .padding(i.padding.edgeInsets).frame(height: i.height).foregroundStyle(i.color.color).webBox(input)
                WebBareSelect(label: roles.first { $0.id == role }?.title ?? "Can view", options: roles.map { ($0.id, $0.title) }, selected: role) { role = $0 }
                    .padding(.horizontal, 10).webBox(input)
                WebSheetButton(title: "Share", primary: true, enabled: !sending && email.contains("@"), action: submit)
            }
            Text(verbatim: note).webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
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

/// `divide-y divide-line rounded-chip border border-line`: a bordered list.
private struct BorderedList<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        VStack(spacing: 0, content: content)
            .overlay(RoundedRectangle(cornerRadius: 6, style: .circular).strokeBorder(moreVar("color-line", scheme), lineWidth: 1))
    }
}

private struct PersonRow: View {
    let name: String
    let email: String?
    let isYou: Bool
    let guest: Bool
    let role: String
    let canChange: Bool
    let setRole: @MainActor (String) -> Void
    let remove: @MainActor () -> Void
    var leave: (@MainActor () -> Void)? = nil
    @Environment(\.colorScheme) private var scheme

    var body: some View {
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
                WebBareSelect(label: Roles.label(role), options: roles.map { ($0.id, $0.title) }, selected: role, onSelect: setRole)
                WebIconButton(.trash, label: "Remove \(name)", action: remove)
            } else {
                Text(verbatim: Roles.label(role)).webText(.role(.footnote)).foregroundStyle(muted)
            }
            if let leave { WebButton("Leave", variant: .quiet, size: .sm, action: leave) }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }
}

private struct CapsHeading: View {
    let title: String
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        Text(verbatim: title.uppercased()).webText(WebTextStyle.role(.footnote, weight: 600).tracking(em: 0.06)).lineLimit(1)
            .foregroundStyle(moreVar("color-ink-faint", scheme)).padding(.top, 16).padding(.bottom, 6)
    }
}

private struct Separator: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View { Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1) }
}

// MARK: a page

struct PageShareSheet: View {
    let frame: FrameModel
    let noteId: String
    let title: String
    let store: ValueStore<SharingValue>
    let close: @MainActor () -> Void
    @State private var freshLink: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        WebSheetDialog(title: "Share “\(title.isEmpty ? "Untitled" : title)”", width: 480, close: close) {
            ScrollView {
                if let d = store.value { content(d) } else { Text(verbatim: "Loading…").webText(.role(.subheadline)).foregroundStyle(moreVar("color-ink-muted", scheme)) }
            }
            .frame(maxHeight: 560)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func content(_ d: SharingValue) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        let personal = frame.session.value?.spaces.first { $0.id == frame.session.value?.space }?.kind == .personal
        return VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: "Who has access").webText(.role(.subheadline, weight: 600))
                if personal {
                    HStack(alignment: .top, spacing: 8) {
                        WebIconView(.lock, size: 16).padding(.top, 2)
                        Text(verbatim: "This page is in a Personal space: only its owner and the people added below can open it.").webText(.role(.subheadline))
                    }
                    .foregroundStyle(muted).padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(moreVar("color-line", scheme), lineWidth: 1))
                } else {
                    HStack(spacing: 8) {
                        mode(d, "workspace", "Workspace", "Everyone in this workspace, by their role", .users)
                        mode(d, "restricted", "Only invited people", "Owners, admins, the creator and people added below", .lock)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: "People").webText(.role(.subheadline, weight: 600))
                if d.canShare {
                    InviteRow(note: personal ? "Anyone with an email address. People without a Folevi account get an invitation by email." : "People outside the workspace join as guests on this page only and aren’t billed. People without a Folevi account get an invitation by email.") { email, role in
                        do {
                            let r = try await frame.client.command(.sharingInvite(noteId: noteId, email: email, role: ShareInviteArgs.Role(rawValue: role) ?? .viewer))
                            frame.toast(r.status == "invited" ? "Invitation sent to \(email). They get access once they sign up and accept." : "Shared", tone: .success)
                        } catch { frame.toast(ScreenErrors.message(error), tone: .error) }
                    }
                }
                BorderedList {
                    if d.people.isEmpty { Text(verbatim: "No one has been added to this page yet.").webText(.role(.subheadline)).foregroundStyle(muted).padding(.horizontal, 12).padding(.vertical, 10).frame(maxWidth: .infinity, alignment: .leading) }
                    ForEach(Array(d.people.enumerated()), id: \.element.profileId) { i, p in
                        if i > 0 { Separator() }
                        PersonRow(name: p.name, email: p.email, isYou: p.isYou, guest: p.guest, role: p.role, canChange: p.canChange,
                                  setRole: { r in run(frame, "Access changed") { _ = try await frame.client.command(.sharingSetRole(noteId: noteId, profileId: p.profileId, role: ShareRoleArgs.Role(rawValue: r) ?? .viewer)) } },
                                  remove: { run(frame, "Removed") { _ = try await frame.client.command(.sharingRevoke(noteId: noteId, profileId: p.profileId)) } })
                    }
                }
                if !d.invites.isEmpty {
                    CapsHeading(title: "Invited by email")
                    BorderedList {
                        ForEach(Array(d.invites.enumerated()), id: \.element.id) { i, inv in
                            if i > 0 { Separator() }
                            inviteRow(inv) { run(frame, "Invitation revoked") { _ = try await frame.client.command(.sharingCancelInvite(inviteId: inv.id)) } }
                        }
                    }
                }
            }
            if d.canManage { publicLinks(d) }
        }
        .padding(.bottom, 12)
    }

    private func mode(_ d: SharingValue, _ id: String, _ label: String, _ desc: String, _ icon: WebIcon) -> some View {
        let on = d.accessMode == id
        return Button {
            run(frame, nil) { _ = try await frame.client.command(.sharingSetAccessMode(noteId: noteId, mode: AccessModeArgs.Mode(rawValue: id) ?? .workspace)) }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                WebIconView(icon, size: 16).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(.top, 2)
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: label).webText(.role(.subheadline, weight: 500))
                    Text(verbatim: desc).webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 6).fill(on ? moreVar("color-accent-soft", scheme) : .clear))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(on ? moreVar("color-accent", scheme) : moreVar("color-line", scheme), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!d.canManage)
        .opacity(d.canManage ? 1 : 0.6)
    }

    private func publicLinks(_ d: SharingValue) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                WebIconView(.globe, size: 15)
                Text(verbatim: "Public link").webText(.role(.subheadline, weight: 600))
            }
            Text(verbatim: d.encrypted ? "This note is end-to-end encrypted: its public link carries the key, so anyone with the whole link can read it." : "Off by default. Anyone with the link can read this page (not its comments or nested pages). Search engines skip it unless you let them find it, and you can revoke it instantly.")
                .webText(.role(.footnote)).foregroundStyle(muted)
            if !d.publicLinksAvailable { Text(verbatim: "Public links are temporarily turned off for Folevi.").webText(.role(.footnote)).foregroundStyle(moreVar("color-marigold", scheme)) }
            if let freshLink {
                VStack(alignment: .leading, spacing: 8) {
                    Text(verbatim: "Copy this link now. For your security, it isn’t shown again.").webText(.role(.footnote, weight: 500))
                    HStack(spacing: 8) {
                        Text(verbatim: freshLink).font(WebFont.font(.mono, size: 12)).lineLimit(1).truncationMode(.middle).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        WebButton("Copy", icon: .copy, size: .sm) {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(freshLink, forType: .string)
                            frame.toast("Link copied")
                        }
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 6).fill(moreVar("color-success-soft", scheme)))
            }
            ForEach(d.links, id: \.id) { l in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: "…/s/\(l.tokenHint)••••••••").font(WebFont.font(.mono, size: 12))
                        Text(verbatim: "\(l.expired ? "Expired" : l.expiresAt.map { "Expires \(Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened))" } ?? "No expiry")\(l.hasPassword ? " · Password protected" : "")\(l.allowIndexing ? " · Search engines can find it" : "") · \(l.viewCount) view\(l.viewCount == 1 ? "" : "s")")
                            .webText(.role(.footnote)).foregroundStyle(muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    WebButton("Revoke", variant: .quiet, size: .sm) { run(frame, "Link revoked") { _ = try await frame.client.command(.publicLinkRevoke(linkId: l.id)) } }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(moreVar("color-line", scheme), lineWidth: 1))
            }
            if d.publicLinksAvailable {
                WebButton("Create public link", icon: .link2, size: .sm) {
                    run(frame, nil) {
                        let r = try await frame.client.command(.publicLinkCreate(noteId: noteId))
                        freshLink = r.url
                    }
                }
            }
        }
    }

    private func inviteRow(_ i: ShareInvite, revoke: @escaping @MainActor () -> Void) -> some View {
        HStack(spacing: 12) {
            Text(verbatim: i.email).webText(.role(.subheadline)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: "\(Roles.label(i.role)) · \(i.expired ? "expired" : "waiting to accept")").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-muted", scheme))
            WebButton("Revoke", variant: .quiet, size: .sm, action: revoke)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
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
            .frame(maxHeight: 560)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    static func summary(noteCount: Int, people: Int, personal: Bool) -> String {
        let notes = { (n: Int) in n == 1 ? "1 note" : "\(n) notes" }
        let what = noteCount == 0 ? "its notes" : "its \(notes(noteCount))"
        let base = "People with access to this folder can see \(what), in its subfolders too, and notes added later."
        if people == 0 { return "\(base) \(personal ? "Only you can see it now." : "Now it’s only for the workspace, by each member’s role.")" }
        return "\(base) It’s shared with \(people == 1 ? "1 person" : "\(people) people")."
    }

    private func bordered(_ t: String, _ icon: WebIcon?) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if let icon { WebIconView(icon, size: 16).padding(.top, 2) }
            Text(verbatim: t).webText(.role(.subheadline)).frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(moreVar("color-ink-muted", scheme)).padding(12)
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(moreVar("color-line", scheme), lineWidth: 1))
    }

    private func peopleList(_ d: FolderSharingValue) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        return BorderedList {
            if d.people.isEmpty {
                Text(verbatim: d.youAreGuest ? "It was shared with you through a folder above it." : "No one has been added to this folder yet.").webText(.role(.subheadline)).foregroundStyle(muted).padding(.horizontal, 12).padding(.vertical, 10).frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(Array(d.people.enumerated()), id: \.element.profileId) { i, p in
                if i > 0 { Separator() }
                personRow(d, p)
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
                         setRole: { r in run(frame, "Access changed") { _ = try await frame.client.command(.folderSharingSetRole(folderId: folderId, profileId: p.profileId, role: FolderShareRoleArgs.Role(rawValue: r) ?? .viewer)) } },
                         remove: { run(frame, "Removed") { _ = try await frame.client.command(.folderSharingRevoke(folderId: folderId, profileId: p.profileId)) } },
                         leave: leave)
    }

    private func content(_ d: FolderSharingValue) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        return VStack(alignment: .leading, spacing: 24) {
            bordered(Self.summary(noteCount: d.noteCount, people: d.people.count, personal: d.personal), nil)
            if let blocked = d.blocked { bordered(blocked, .folderLock) }
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: "People").webText(.role(.subheadline, weight: 600))
                if d.youAreGuest {
                    Text(verbatim: "This folder was shared with you\(d.sharedBy.map { " by \($0)" } ?? ""). \(d.ownerName.map { "It belongs to \($0). " } ?? "")Only its owner\(d.personal ? "" : " and the workspace’s admins") can share it.").webText(.role(.footnote)).foregroundStyle(muted)
                } else if !d.canManage {
                    Text(verbatim: "Only the folder’s owner and the workspace’s owners and admins can share it.").webText(.role(.footnote)).foregroundStyle(muted)
                }
                if d.canManage, d.blocked == nil {
                    InviteRow(note: d.personal ? "Anyone with an email address. People without a Folevi account get an invitation by email." : "People outside the workspace join as guests on this folder only and aren’t billed. People without a Folevi account get an invitation by email.") { email, role in
                        do {
                            let r = try await frame.client.command(.folderSharingInvite(folderId: folderId, email: email, role: FolderShareInviteArgs.Role(rawValue: role) ?? .viewer))
                            frame.toast(r.status == "invited" ? "Invitation sent to \(email). They get access once they sign up and accept." : "Shared", tone: .success)
                        } catch { frame.toast(ScreenErrors.message(error), tone: .error) }
                    }
                }
                peopleList(d)
                if !d.inherited.isEmpty {
                    CapsHeading(title: "From folders above")
                    BorderedList {
                        let rows = d.inherited.flatMap { f in f.people.map { (f, $0) } }
                        ForEach(Array(rows.enumerated()), id: \.offset) { i, pair in
                            if i > 0 { Separator() }
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(verbatim: pair.1.name + (pair.1.isYou ? " (you)" : "")).webText(.role(.subheadline, weight: 500)).lineLimit(1)
                                    Text(verbatim: "From folder \(pair.0.folderName.isEmpty ? "Untitled" : pair.0.folderName)").webText(.role(.footnote)).lineLimit(1).foregroundStyle(muted)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text(verbatim: Roles.label(pair.1.role)).webText(.role(.footnote)).foregroundStyle(muted)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                        }
                    }
                }
                if !d.invites.isEmpty {
                    CapsHeading(title: "Invited by email")
                    BorderedList {
                        ForEach(Array(d.invites.enumerated()), id: \.element.id) { i, inv in
                            if i > 0 { Separator() }
                            HStack(spacing: 12) {
                                Text(verbatim: inv.email).webText(.role(.subheadline)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                Text(verbatim: "\(Roles.label(inv.role)) · \(inv.expired ? "expired" : "waiting to accept")").webText(.role(.footnote)).foregroundStyle(muted)
                                WebButton("Revoke", variant: .quiet, size: .sm) { run(frame, "Invitation revoked") { _ = try await frame.client.command(.folderSharingCancelInvite(inviteId: inv.id)) } }
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                        }
                    }
                }
            }
            if d.youAreGuest {
                Button { close(); frame.open(.web("/shared/\(folderId)")) } label: { Text(verbatim: "Open the shared folder").underline().webText(.role(.footnote)).foregroundStyle(muted) }.buttonStyle(.plain)
            } else {
                Text(verbatim: "Public links are for single notes: share a note to make one.").webText(.role(.footnote)).foregroundStyle(muted)
            }
        }
        .padding(.bottom, 12)
    }
}
#endif
