// The pages only an account has, as Folevi for Mac shows the web's: Shared with Me (views/SharedView.tsx: shared
// folders above shared pages), a folder shared with this person (views/SharedFolderView.tsx, /shared/<id>) and
// Changes (views/ChangesView.tsx: proposals from connected apps, then notes others changed, each with what
// changed). In local mode they're the web's "Sign in to Folevi to share and collaborate" page
// (app/SignInToCollaborate.tsx). Lists are drawn with the web's card, row and type styles (more.help.*: the same
// classes), as the scratch library the screenshot diffs use has no account.
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

/// "Sign in to Folevi to share and collaborate", the page an account-only view is in local mode.
struct SignInToCollaboratePage: View {
    var body: some View {
        VStack(spacing: 0) {
            MoreEmptyState(icon: .users, title: "Sign in to Folevi to share and collaborate", message: "Your notes are kept on your devices. Sharing, comments and workspaces need a Folevi account.")
            Spacer(minLength: 0)
        }
        .accessibilityIdentifier("screen.signInToCollaborate")
    }
}

/// The page column of the web's list views (`mx-auto max-w-3xl px-8 pt-6`), under the facts row.
struct WebPageColumn<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let column = moreStyle("more.help.title", scheme)
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0, content: content)
                .padding(column.padding.edgeInsets)
                .frame(width: column.width, alignment: .topLeading)
                .frame(maxWidth: .infinity)
        }
    }
}

/// `divide-y divide-line overflow-hidden ui-card rounded-control`: rows in a card split by hairlines.
struct WebListCard<Row: View, Item>: View {
    let items: [Item]
    let id: KeyPath<Item, String>
    @ViewBuilder let row: (Item) -> Row
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let card = WebStyles.named("more.help.table")
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                if i > 0 { Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1) }
                row(item)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: card.light.radius, style: .circular))
        .webBox(card)
    }
}

/// A row that takes the surface colour under the pointer (`hover:bg-surface`) and opens on click.
struct WebHoverRow<Content: View>: View {
    let action: () -> Void
    @ViewBuilder let content: () -> Content
    @State private var hovering = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            content()
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(hovering ? moreVar("color-surface", scheme) : .clear)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

enum Roles {
    static func label(_ role: String) -> String { role == "editor" ? "Can edit" : role == "commenter" ? "Can comment" : "Can view" }
    static func access(_ a: String) -> String { a == "write" || a == "manage" ? "Can edit" : a == "comment" ? "Can comment" : "Can view" }
    static func updated(_ ms: Double) -> String { AgeText.relative(Date(timeIntervalSince1970: ms / 1000)) }
    /// Where a shared folder lives (lib/app/folderSharing.ts sharedPlace).
    static func place(workspace: String?, owner: String?, inYourPlace: Bool) -> String {
        if inYourPlace { return workspace ?? "Your Personal" }
        return workspace ?? "Personal · \(owner ?? "someone")"
    }
}

// MARK: Shared with Me

@MainActor
@Observable
final class SharedWithMeModel {
    let pages: ValueStore<SharedValue>
    let folders: ValueStore<SharedFoldersValue>

    init(client: EngineClient) {
        pages = client.watch(.sharedList)
        folders = client.watch(.sharedFolders)
    }

    var loading: Bool { pages.value == nil || folders.value == nil }

    var counts: String? {
        guard let p = pages.value?.rows, let f = folders.value?.rows else { return nil }
        return [f.isEmpty ? nil : "\(f.count) \(f.count == 1 ? "folder" : "folders")", !p.isEmpty || f.isEmpty ? "\(p.count) \(p.count == 1 ? "page" : "pages")" : nil].compactMap { $0 }.joined(separator: " · ")
    }
}

struct SharedWithMeScreen: View {
    let model: SharedWithMeModel
    let frame: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if frame.session.value?.mode == .local {
            SignInToCollaboratePage()
        } else {
            VStack(spacing: 0) {
                WebFactsRow(subtitle: model.counts.map { "\($0) · from anyone" }) { EmptyView() }
                WebPageColumn { content }
            }
            .accessibilityIdentifier("screen.shared")
        }
    }

    @ViewBuilder
    private var content: some View {
        let folders = model.folders.value?.rows ?? []
        let pages = model.pages.value?.rows ?? []
        if model.loading {
            RoundedRectangle(cornerRadius: 6, style: .circular).fill(moreVar("color-surface", scheme)).frame(height: 96).padding(.top, 24)
        } else if folders.isEmpty, pages.isEmpty {
            MoreEmptyState(icon: .share2, title: "Nothing has been shared with you yet", message: "Folders and pages people share with you, from their Personal or from any workspace, show up here.")
        } else {
            if !folders.isEmpty {
                sectionTitle("Folders").padding(.top, 24)
                WebListCard(items: folders, id: \.id) { f in
                    WebHoverRow(action: { frame.open(.web("/shared/\(f.id)")) }) {
                        HStack(alignment: .top, spacing: 12) {
                            FolderGlyph(colorId: f.color, size: 18).padding(.top, 2)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(verbatim: f.name.isEmpty ? "Untitled" : f.name).webText(.role(.body, weight: 500)).lineLimit(1).foregroundStyle(moreVar("color-ink", scheme))
                                Text(verbatim: "Shared by \(f.sharedBy) · \(Roles.place(workspace: f.workspaceName, owner: f.ownerName, inYourPlace: f.inYourPlace)) · \(Roles.label(f.role)) · \(f.noteCount == 1 ? "1 note" : "\(f.noteCount) notes") · updated \(Roles.updated(f.updatedAt))")
                                    .webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-faint", scheme))
                            }
                        }
                    }
                }
            }
            if !pages.isEmpty {
                if !folders.isEmpty { sectionTitle("Pages").padding(.top, 24) }
                WebListCard(items: pages, id: \.id) { d in
                    WebHoverRow(action: { frame.open(.note(d.id)) }) {
                        HStack(alignment: .top, spacing: 12) {
                            WebIconView(.fileText, size: 16).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(.top, 4)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(verbatim: d.title.isEmpty ? "Untitled" : d.title).webText(.role(.body, weight: 500)).lineLimit(1).foregroundStyle(moreVar("color-ink", scheme))
                                if !d.excerpt.isEmpty { Text(verbatim: d.excerpt).webText(.role(.subheadline)).lineLimit(1).foregroundStyle(moreVar("color-ink-muted", scheme)) }
                                Text(verbatim: "Shared by \(d.sharedBy) · \(d.workspaceName ?? "Personal · \(d.ownerName ?? "someone")") · \(Roles.label(d.role)) · updated \(Roles.updated(d.updatedAt))")
                                    .webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-faint", scheme))
                            }
                        }
                    }
                }
                .padding(.top, folders.isEmpty ? 24 : 0)
            }
        }
    }

    private func sectionTitle(_ t: String) -> some View {
        Text(verbatim: t).webText(.role(.footnote, weight: 600)).lineLimit(1).foregroundStyle(moreVar("color-ink-muted", scheme)).padding(.bottom, 8)
    }
}

// MARK: a shared folder

@MainActor
@Observable
final class SharedFolderModel {
    let store: ValueStore<SharedFolderValue>
    let folderId: String

    init(client: EngineClient, folderId: String, feedback: ScreenFeedback) {
        self.folderId = folderId
        store = client.watch(.sharedFolderOpen(id: folderId))
    }
}

struct SharedFolderScreen: View {
    let model: SharedFolderModel
    let frame: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let d = model.store.value
        VStack(spacing: 0) {
            WebFactsRow(subtitle: d.flatMap { $0.found ? "\(Roles.place(workspace: $0.workspaceName, owner: $0.ownerName, inYourPlace: $0.inYourPlace)) · \($0.roleLabel ?? Roles.access($0.access))" : nil }) {
                if let d, d.found {
                    WebButton("People", icon: .users, variant: .quiet, size: .sm) { FrameDialogs.folderShare(frame, folderId: d.id, name: d.name) }
                }
            }
            WebPageColumn { content(d) }
        }
        .accessibilityIdentifier("screen.sharedFolder")
    }

    @ViewBuilder
    private func content(_ d: SharedFolderValue?) -> some View {
        let muted = moreVar("color-ink-muted", scheme), heading = moreVar("color-heading", scheme)
        if let d {
            if !d.found {
                MoreEmptyState(icon: .folderX, title: "You can’t open this folder", message: "It may have been unshared, moved or deleted. Folders shared with you are in Shared with Me.")
            } else {
                HStack(spacing: 4) {
                    Button { frame.open(.shared) } label: { Text(verbatim: "Shared with Me") }.buttonStyle(.plain)
                    ForEach(d.path, id: \.id) { p in
                        WebIconView(.chevronRight, size: 12)
                        Button { frame.open(.web("/shared/\(p.id)")) } label: { Text(verbatim: p.name.isEmpty ? "Untitled" : p.name) }.buttonStyle(.plain)
                    }
                    WebIconView(.chevronRight, size: 12)
                    Text(verbatim: d.name.isEmpty ? "Untitled" : d.name).foregroundStyle(heading)
                }
                .webText(.role(.footnote)).lineLimit(1)
                .foregroundStyle(muted)
                .padding(.bottom, 16)
                if let by = d.sharedBy {
                    Text(verbatim: "Shared with you by \(by)\(d.roleLabel.map { " (\($0.lowercased()))" } ?? ""). Notes added to this folder later show up here too.")
                        .webText(.role(.footnote)).foregroundStyle(muted).padding(.bottom, 16)
                }
                if !d.subfolders.isEmpty {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                        ForEach(d.subfolders, id: \.id) { f in
                            Button { frame.open(.web("/shared/\(f.id)")) } label: {
                                HStack(spacing: 12) {
                                    FolderGlyph(colorId: f.color, size: 20)
                                    Text(verbatim: f.name.isEmpty ? "Untitled" : f.name).webText(.role(.body, weight: 500)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                    Text(verbatim: f.noteCount == 1 ? "1 note" : "\(f.noteCount) notes").webText(.role(.footnote)).foregroundStyle(muted)
                                }
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .webBox(WebStyles.named("more.help.table"))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.bottom, 24)
                }
                if d.notes.isEmpty {
                    if d.subfolders.isEmpty { MoreEmptyState(icon: .fileText, title: "No notes here yet", message: "Notes added to this folder show up here.") }
                } else {
                    WebListCard(items: d.notes, id: \.id) { n in
                        WebHoverRow(action: { frame.open(.note(n.id)) }) {
                            HStack(alignment: .top, spacing: 12) {
                                WebIconView(.fileText, size: 16).foregroundStyle(muted).padding(.top, 2)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(verbatim: n.title.isEmpty ? "Untitled" : n.title).webText(.role(.body, weight: 500)).lineLimit(1)
                                    if !n.excerpt.isEmpty { Text(verbatim: n.excerpt).webText(.role(.subheadline)).lineLimit(1).foregroundStyle(muted) }
                                    Text(verbatim: "\(Roles.access(n.access)) · updated \(Roles.updated(n.updatedAt))").webText(.role(.footnote)).foregroundStyle(moreVar("color-ink-faint", scheme))
                                }
                            }
                        }
                    }
                }
            }
        } else {
            RoundedRectangle(cornerRadius: 6, style: .circular).fill(moreVar("color-surface", scheme)).frame(height: 96).padding(.top, 24)
        }
    }
}

// MARK: Changes

@MainActor
@Observable
final class ChangesWebModel {
    let client: EngineClient
    let feedback: ScreenFeedback
    let store: ValueStore<ChangesValue>
    private var diffs: [String: ValueStore<FoleviEngine.ChangeDiffValue>] = [:]
    var busy: Set<String> = []

    init(client: EngineClient, feedback: ScreenFeedback) {
        self.client = client
        self.feedback = feedback
        store = client.watch(.changes)
    }

    func diff(_ id: String) -> ValueStore<FoleviEngine.ChangeDiffValue> {
        if let d = diffs[id] { return d }
        let d = client.watch(.changesDiff(id: id))
        diffs[id] = d
        return d
    }

    func markSeen(_ ids: [String]) {
        Task { do { _ = try await client.command(.changesMarkSeen(ids: ids)) } catch { feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error)) } }
    }

    func proposal(_ p: ProposalRow, accept: Bool) {
        busy.insert(p.id)
        Task {
            defer { busy.remove(p.id) }
            do {
                if accept {
                    _ = try await client.command(.proposalAccept(id: p.id))
                    feedback.toast(ScreenToast("Added to “\(p.title)”", tone: .success))
                } else {
                    _ = try await client.command(.proposalReject(id: p.id))
                    feedback.toast(ScreenToast("Proposal rejected"))
                }
            } catch { feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error)) }
        }
    }
}

struct ChangesWebScreen: View {
    let model: ChangesWebModel
    let frame: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if frame.session.value?.mode == .local {
            SignInToCollaboratePage()
        } else {
            let v = model.store.value
            let subtitle: String? = v.map { v in
                [v.proposals.isEmpty ? nil : "\(v.proposals.count) proposed", v.notes.isEmpty ? nil : "\(v.notes.count) \(v.notes.count == 1 ? "note" : "notes") changed since you last looked"].compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "Nothing new"
            }
            VStack(spacing: 0) {
                WebFactsRow(subtitle: subtitle) { EmptyView() }
                WebPageColumn { content(v) }
            }
            .accessibilityIdentifier("screen.changes")
        }
    }

    @ViewBuilder
    private func content(_ v: ChangesValue?) -> some View {
        let heading = moreVar("color-heading", scheme), muted = moreVar("color-ink-muted", scheme)
        if let v {
            if !v.proposals.isEmpty {
                Text(verbatim: "Proposed").webText(.role(.headline)).lineLimit(1).foregroundStyle(heading)
                Text(verbatim: "Changes connected apps want to make to your notes. Nothing changes until you accept.").webText(.role(.subheadline)).foregroundStyle(muted).padding(.top, 4)
                VStack(spacing: 16) { ForEach(v.proposals, id: \.id) { proposal($0) } }.padding(.top, 16).padding(.bottom, 40)
                Text(verbatim: "Changed").webText(.role(.headline)).lineLimit(1).foregroundStyle(heading).padding(.bottom, 4)
            }
            if v.notes.count > 1 {
                HStack { Spacer(); WebButton("Mark all as seen", icon: .check, size: .sm) { model.markSeen(v.notes.map(\.id)) } }
            }
            if v.notes.isEmpty, !v.proposals.isEmpty {
                Text(verbatim: "Nothing else changed since you last looked.").webText(.role(.subheadline)).foregroundStyle(muted).padding(.top, 16)
            } else if v.notes.isEmpty {
                MoreEmptyState(icon: .fileDiff, title: "You’re all caught up", message: "When someone else changes a note you’ve opened, it shows up here until you look.")
            } else {
                VStack(spacing: 16) { ForEach(v.notes, id: \.id) { changed($0) } }.padding(.top, 24)
            }
        } else {
            RoundedRectangle(cornerRadius: 10, style: .circular).fill(moreVar("color-surface", scheme)).frame(height: 128).padding(.top, 24)
        }
    }

    private func card<Header: View, Body: View>(@ViewBuilder header: () -> Header, @ViewBuilder body: () -> Body) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header().padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
            Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1)
            body().padding(.horizontal, 16).padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading).background(moreVar("color-surface-sunken", scheme))
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .circular))
        .webBox(WebStyles.named("more.help.table"))
    }

    private func proposal(_ p: ProposalRow) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        return card {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    Button { if let id = p.noteId { frame.open(.note(id)) } } label: { Text(verbatim: p.title).webText(.role(.headline)).lineLimit(1).foregroundStyle(moreVar("color-heading", scheme)) }.buttonStyle(.plain)
                    (Text(verbatim: p.sourceName).foregroundColor(moreVar("color-ink", scheme)) + Text(verbatim: " proposed this \(Roles.updated(p.createdAt))")).webText(.role(.footnote)).foregroundStyle(muted).padding(.top, 4)
                    Text(verbatim: p.summary).webText(.role(.footnote)).lineLimit(1).foregroundStyle(muted).padding(.top, 2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if p.problem == nil { WebButton("Accept", icon: .check, variant: .primary, size: .sm) { model.proposal(p, accept: true) }.disabled(model.busy.contains(p.id)) }
                WebButton("Reject", icon: .x, variant: .ghost, size: .sm) { model.proposal(p, accept: false) }.disabled(model.busy.contains(p.id))
            }
        } body: {
            if let problem = p.problem {
                Text(verbatim: problem).webText(.role(.subheadline)).foregroundStyle(moreVar("color-danger", scheme))
            } else if p.noteId == nil {
                Text(verbatim: "You can’t open this note, so its proposal isn’t shown.").webText(.role(.subheadline)).foregroundStyle(muted)
            } else {
                Text(verbatim: p.summary).webText(.role(.body)).foregroundStyle(moreVar("color-ink", scheme))
                    .padding(.leading, 8)
                    .overlay(alignment: .leading) { Rectangle().fill(moreVar("color-moss", scheme)).frame(width: 2) }
            }
        }
    }

    private func changed(_ n: ChangedNoteRow) -> some View {
        let muted = moreVar("color-ink-muted", scheme)
        let diff = model.diff(n.id)
        return card {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    Button { frame.open(.note(n.id)) } label: { Text(verbatim: n.title.isEmpty ? "Untitled" : n.title).webText(.role(.headline)).lineLimit(1).foregroundStyle(moreVar("color-heading", scheme)) }.buttonStyle(.plain)
                    (Text(verbatim: n.who).foregroundColor(moreVar("color-ink", scheme)) + Text(verbatim: " · \(Roles.updated(n.changedAt))")).webText(.role(.footnote)).foregroundStyle(muted).padding(.top, 4)
                    Text(verbatim: n.counts).webText(.role(.footnote)).foregroundStyle(muted).padding(.top, 2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebButton("Open note", icon: .externalLink, variant: .ghost, size: .sm) { frame.open(.note(n.id)) }
                WebButton("Mark as seen", icon: .check, variant: .ghost, size: .sm) { model.markSeen([n.id]) }
            }
        } body: {
            if let d = diff.value {
                if d.blocks.isEmpty {
                    Text(verbatim: "Only formatting or order changed.").webText(.role(.subheadline)).foregroundStyle(muted)
                } else {
                    VStack(alignment: .leading, spacing: 6) { ForEach(d.blocks.prefix(40), id: \.id) { diffBlock($0) } }
                }
            } else {
                RoundedRectangle(cornerRadius: 4, style: .circular).fill(moreVar("color-surface-sunken", scheme)).frame(height: 40)
            }
        }
    }

    /// One changed block as version history marks it: added lines in green, removed struck through, words changed
    /// inside a line marked one by one.
    private func diffBlock(_ b: FoleviEngine.ChangeDiffBlock) -> some View {
        let added = moreVar("color-moss", scheme), removed = moreVar("color-coral", scheme), ink = moreVar("color-ink", scheme)
        let style: WebTextStyle = b.t == "heading" ? .role(b.l == 1 ? .title2 : .title3, weight: 600) : .role(.body)
        let text: Text = {
            if let parts = b.parts, !parts.isEmpty {
                return parts.reduce(Text(verbatim: "")) { acc, p in
                    switch p.kind {
                    case "added": acc + Text(verbatim: p.text).foregroundColor(added).underline()
                    case "removed": acc + Text(verbatim: p.text).foregroundColor(removed).strikethrough()
                    default: acc + Text(verbatim: p.text).foregroundColor(ink)
                    }
                }
            }
            switch b.change {
            case "removed": return Text(verbatim: b.x).foregroundColor(removed).strikethrough()
            default: return Text(verbatim: b.x).foregroundColor(ink)
            }
        }()
        return text.webText(style)
            .padding(.leading, 8)
            .overlay(alignment: .leading) { Rectangle().fill(b.change == "removed" ? removed : added).frame(width: 2) }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
#endif
