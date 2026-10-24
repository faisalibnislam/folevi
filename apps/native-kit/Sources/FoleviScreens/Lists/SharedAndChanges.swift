// Shared with Me (web views/SharedView.tsx) and Changes (web views/ChangesView.tsx) as native lists (views
// `shared.list` and `changes`, contract revision 4). Changes shows
// each changed note as a row (who, what, when) with Open and Mark as seen, and proposals from connected apps
// with Accept and Reject; the block-by-block diff stays in the note's version history (web) for now.
import SwiftUI
import FoleviDesign
import FoleviEngine

// MARK: Shared with Me

@MainActor
@Observable
public final class SharedListModel {
    public let client: EngineClient
    public let shared: ValueStore<SharedValue>
    public private(set) var refreshing = false
    @ObservationIgnored let feedback: ScreenFeedback

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback()) {
        self.client = client
        self.feedback = feedback
        self.shared = client.watch(.sharedList)
    }

    public var title: String { "Shared with Me" }
    public var rows: [SharedRow] { shared.value?.rows ?? [] }
    public var isLoading: Bool { shared.value == nil && shared.error == nil }
    public var subtitle: String? {
        guard !rows.isEmpty else { return nil }
        return rows.count == 1 ? "1 page" : "\(rows.count.formatted()) pages"
    }

    public static func detail(_ row: SharedRow) -> String {
        let place = row.workspaceName ?? "Personal · \(row.ownerName ?? "someone")"
        let role = row.role == "editor" ? "Can edit" : row.role == "commenter" ? "Can comment" : "Can view"
        return "Shared by \(row.sharedBy) · \(place) · \(role) · updated \(AgeText.relative(Date(timeIntervalSince1970: row.updatedAt / 1000), now: ScreenClock.now()))"
    }

    public func refresh() async {
        refreshing = true
        defer { refreshing = false }
        do { try await client.command(.engineRefresh) } catch { feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error)) }
    }
}

public struct SharedListScreen: View {
    let model: SharedListModel
    @Environment(\.screenNavigator) private var navigator
    public init(model: SharedListModel) { self.model = model }

    public var body: some View {
        List {
            if model.isLoading {
                ForEach(0..<5, id: \.self) { _ in PlaceholderRow() }.listRowBackground(Color.clear)
            } else if model.rows.isEmpty {
                EmptyState(systemImage: "person.2", title: "Nothing has been shared with you yet", message: "Pages people share with you directly, from their Personal or from any workspace, show up here.")
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(model.rows, id: \.id) { row in
                    Button { navigator.open(.note(id: row.id), CardFrames.shared.source(for: row.id)) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            NoteGlyph(folderColor: nil, plain: true)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 5) {
                                    if let icon = row.icon, !icon.isEmpty { Text(icon) }
                                    Text(row.title.isEmpty ? "Untitled" : row.title).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.ink).lineLimit(1)
                                    if row.encrypted { Image(systemName: "lock.fill").font(.system(size: 10)).foregroundStyle(Folevi.color.inkFaint).accessibilityLabel("Encrypted") }
                                }
                                if !row.excerpt.isEmpty { Text(row.excerpt).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).lineLimit(1) }
                                Text(SharedListModel.detail(row)).foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint).lineLimit(2)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(RowPressStyle { navigator.prepareNote(row.id) })
                    .modifier(RecordsFrame(id: row.id, kind: .noteRow))
                    .contextMenu {
                        Button { navigator.open(.note(id: row.id), nil) } label: { Label("Open", systemImage: "arrow.up.forward.square") }
                        Button { navigator.open(.noteInNewTab(id: row.id), nil) } label: { Label("Open in new tab", systemImage: "plus.rectangle.on.rectangle") }
                    }
                    .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Folevi.color.canvas)
        .refreshable { await model.refresh() }
        .accessibilityIdentifier("shared-screen")
    }
}

// MARK: Changes

@MainActor
@Observable
public final class ChangesModel {
    public let client: EngineClient
    public let changes: ValueStore<ChangesValue>
    public private(set) var busy: Set<String> = []
    /// Rows marked as seen (or proposals answered) before the engine's update.
    public private(set) var gone: Set<String> = []
    @ObservationIgnored let feedback: ScreenFeedback

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback()) {
        self.client = client
        self.feedback = feedback
        self.changes = client.watch(.changes)
    }

    public var proposals: [ProposalRow] { (changes.value?.proposals ?? []).filter { !gone.contains($0.id) } }
    public var notes: [ChangedNoteRow] { (changes.value?.notes ?? []).filter { !gone.contains($0.id) } }
    public var isLoading: Bool { changes.value == nil && changes.error == nil }

    /// "2 proposed · 3 notes changed since you last looked", or "Nothing new".
    public var subtitle: String? {
        guard changes.value != nil else { return nil }
        let parts = [proposals.isEmpty ? nil : "\(proposals.count) proposed", notes.isEmpty ? nil : "\(notes.count) \(notes.count == 1 ? "note" : "notes") changed since you last looked"].compactMap { $0 }
        return parts.isEmpty ? "Nothing new" : parts.joined(separator: " · ")
    }

    public func markSeen(_ ids: [String]) async {
        gone.formUnion(ids)
        do { try await client.command(.changesMarkSeen(ids: ids)) } catch {
            gone.subtract(ids)
            feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
        }
    }

    public func answer(_ proposal: ProposalRow, accept: Bool) async {
        busy.insert(proposal.id)
        defer { busy.remove(proposal.id) }
        do {
            if accept {
                try await client.command(.proposalAccept(id: proposal.id))
                feedback.toast(ScreenToast("Change accepted", tone: .success))
            } else {
                try await client.command(.proposalReject(id: proposal.id))
                feedback.toast(ScreenToast("Change rejected"))
            }
            gone.insert(proposal.id)
        } catch {
            feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
        }
    }
}

public struct ChangesScreen: View {
    let model: ChangesModel
    @Environment(\.screenNavigator) private var navigator
    public init(model: ChangesModel) { self.model = model }

    public var body: some View {
        List {
            if model.isLoading {
                ForEach(0..<4, id: \.self) { _ in PlaceholderRow() }.listRowBackground(Color.clear)
            } else {
                if !model.proposals.isEmpty {
                    Section {
                        ForEach(model.proposals, id: \.id) { p in proposalRow(p).listRowBackground(Color.clear) }
                    } header: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Proposed").foleviFont(.headline).foregroundStyle(Folevi.color.heading)
                            Text("Changes connected apps want to make to your notes. Nothing changes until you accept.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                        }
                        .textCase(nil)
                    }
                }
                Section {
                    if model.notes.isEmpty {
                        if model.proposals.isEmpty {
                            EmptyState(systemImage: "arrow.triangle.2.circlepath.doc.on.clipboard", title: "You’re all caught up", message: "When someone else changes a note you’ve opened, it shows up here until you look.")
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                        } else {
                            Text("Nothing else changed since you last looked.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).listRowBackground(Color.clear)
                        }
                    } else {
                        ForEach(model.notes, id: \.id) { n in changedRow(n).listRowBackground(Color.clear) }
                    }
                } header: {
                    HStack {
                        if !model.proposals.isEmpty { Text("Changed").foleviFont(.headline).foregroundStyle(Folevi.color.heading) }
                        Spacer()
                        if model.notes.count > 1 {
                            Button { Task { await model.markSeen(model.notes.map(\.id)) } } label: { Label("Mark all as seen", systemImage: "checkmark") }
                                .buttonStyle(.folevi(.secondary, size: .small))
                        }
                    }
                    .textCase(nil)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Folevi.color.canvas)
        .accessibilityIdentifier("changes-screen")
    }

    private func changedRow(_ n: ChangedNoteRow) -> some View {
        Button { navigator.open(.note(id: n.id), CardFrames.shared.source(for: n.id)) } label: {
            HStack(alignment: .top, spacing: 12) {
                NoteGlyph(folderColor: nil, plain: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(n.title.isEmpty ? "Untitled" : n.title).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.ink).lineLimit(1)
                    Text("\(n.who) · \(n.counts)").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).lineLimit(2)
                    Text(AgeText.age(Date(timeIntervalSince1970: n.changedAt / 1000), now: ScreenClock.now())).foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowPressStyle { navigator.prepareNote(n.id) })
        .modifier(RecordsFrame(id: n.id, kind: .noteRow))
        .swipeActions(edge: .trailing) {
            Button { Task { await model.markSeen([n.id]) } } label: { Label("Seen", systemImage: "checkmark") }.tint(Folevi.color.moss)
        }
        .contextMenu {
            Button { navigator.open(.note(id: n.id), nil) } label: { Label("Open", systemImage: "arrow.up.forward.square") }
            Button { Task { await model.markSeen([n.id]) } } label: { Label("Mark as seen", systemImage: "checkmark") }
        }
        .accessibilityActions {
            Button("Mark as seen") { Task { await model.markSeen([n.id]) } }
        }
    }

    private func proposalRow(_ p: ProposalRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { if let id = p.noteId { navigator.open(.note(id: id), nil) } } label: {
                Text(p.title.isEmpty ? "Untitled" : p.title).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.ink)
            }
            .buttonStyle(.plain)
            Text("\(p.sourceName) proposed · \(AgeText.relative(Date(timeIntervalSince1970: p.createdAt / 1000), now: ScreenClock.now()))").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
            Text(p.summary).foleviFont(.callout).foregroundStyle(Folevi.color.mossInk).lineLimit(6)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.mossSoft))
            if let problem = p.problem { Text(problem).foleviFont(.footnote).foregroundStyle(Folevi.color.coralInk) }
            HStack {
                if p.problem == nil {
                    Button("Accept") { Task { await model.answer(p, accept: true) } }.buttonStyle(.folevi(.primary, size: .small))
                }
                Button("Reject") { Task { await model.answer(p, accept: false) } }.buttonStyle(.folevi(.secondary, size: .small))
            }
            .disabled(model.busy.contains(p.id))
        }
        .padding(.vertical, 8)
    }
}
