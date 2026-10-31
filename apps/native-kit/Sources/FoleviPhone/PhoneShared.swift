// Shared with Me and Changes on the iPhone (signed in only). The web draws both in its general layout under the
// phone's bar (apps/web/src/components/views/SharedView.tsx, ChangesView.tsx): cards of rows 16 in from the
// screen's edges, 24 below the title. Shared lists the pages people share; Changes the proposals to accept or
// reject and the notes others changed, each with Open note, Mark as seen and its changes shown on request (the
// kit's ChangeDiffView: the web draws the changed blocks in its editor).
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

private extension View {
    /// `ui-card rounded-control`: the card surface (the components' measured card), clipped to its corners.
    func phoneCard() -> some View {
        modifier(PhoneCardBox())
    }
}

private struct PhoneCardBox: ViewModifier {
    func body(content: Content) -> some View {
        let pair = WebStyles.named("card")
        content
            .webBox(pair)
            .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous))
    }
}

private func relative(_ ms: Double) -> String {
    let date = Date(timeIntervalSince1970: ms / 1000)
    let f = RelativeDateTimeFormatter()
    f.unitsStyle = .full
    return f.localizedString(for: date, relativeTo: ScreenClock.now())
}

public struct PhoneSharedScreen: View {
    let model: SharedListModel
    let openNote: (String) -> Void
    let back: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(model: SharedListModel, openNote: @escaping (String) -> Void, back: @escaping () -> Void) {
        self.model = model
        self.openNote = openNote
        self.back = back
    }

    public var body: some View {
        let ink = FoleviTokens.Chrome.ink.resolve(scheme)
        let muted = FoleviTokens.Chrome.inkMuted.resolve(scheme)
        let faint = FoleviTokens.Chrome.inkFaint.resolve(scheme)
        let rows = model.rows
        PhoneScreen(PhoneScreenOptions(title: "Shared with Me", subtitle: model.isLoading || rows.isEmpty ? nil : "\(rows.count) \(rows.count == 1 ? "page" : "pages")"), root: false, back: back) {
            EmptyView()
        } trailing: {
            EmptyView()
        } content: {
            VStack(alignment: .leading, spacing: 0) {
                if model.isLoading {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(FoleviTokens.Chrome.surface.resolve(scheme).color).frame(height: 96).padding(.top, 24)
                } else if rows.isEmpty {
                    PhoneScreenEmpty(icon: .share2, title: "Nothing has been shared with you yet", message: "Folders and pages people share with you, from their Personal or from any workspace, show up here.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { i, d in
                            Button { openNote(d.id) } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    WebIconView(.fileText, size: 16).foregroundStyle(muted.color).padding(.top, 4)
                                    VStack(alignment: .leading, spacing: 0) {
                                        Text(d.title.isEmpty ? "Untitled" : d.title).webText(WebTextStyle(size: 16, leading: 24.8, weight: 500)).foregroundStyle(ink.color)
                                        if !d.excerpt.isEmpty {
                                            Text(d.excerpt).webText(WebTextStyle(size: 15, leading: 20)).lineLimit(1).foregroundStyle(muted.color)
                                        }
                                        Text("Shared by \(d.sharedBy) · \(d.workspaceName ?? "Personal · \(d.ownerName ?? "someone")") · \(Self.role(d.role)) · updated \(relative(d.updatedAt))")
                                            .webText(WebTextStyle(size: 13, leading: 18)).foregroundStyle(faint.color)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(PhoneRowPressStyle())
                            if i < rows.count - 1 { FoleviTokens.Chrome.line.resolve(scheme).color.frame(height: 1) }
                        }
                    }
                    .phoneCard()
                    .padding(.top, 24)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    static func role(_ r: String) -> String {
        switch r {
        case "editor": "Can edit"
        case "commenter": "Can comment"
        default: "Can view"
        }
    }
}

public struct PhoneChangesScreen: View {
    let model: ChangesModel
    let openNote: (String) -> Void
    let back: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(model: ChangesModel, openNote: @escaping (String) -> Void, back: @escaping () -> Void) {
        self.model = model
        self.openNote = openNote
        self.back = back
    }

    public var body: some View {
        PhoneScreen(PhoneScreenOptions(title: "Changes", subtitle: model.subtitle), root: false, back: back) {
            EmptyView()
        } trailing: {
            EmptyView()
        } content: {
            VStack(alignment: .leading, spacing: 16) {
                if model.isLoading {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(FoleviTokens.Chrome.surface.resolve(scheme).color).frame(height: 96)
                } else if model.proposals.isEmpty && model.notes.isEmpty {
                    PhoneScreenEmpty(icon: .fileDiff, title: "Nothing new", message: "When someone changes a note you can see, or proposes a change to one of yours, it shows up here.")
                } else {
                    ForEach(model.proposals, id: \.id) { proposalCard($0) }
                    ForEach(model.notes, id: \.id) { noteCard($0) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
        }
    }

    private func proposalCard(_ p: ProposalRow) -> some View {
        let muted = FoleviTokens.Chrome.inkMuted.resolve(scheme)
        let busy = model.busy.contains(p.id)
        return VStack(alignment: .leading, spacing: 8) {
            Text(p.title.isEmpty ? "Untitled" : p.title).webText(WebTextStyle(size: 17, leading: 22, weight: 600)).lineLimit(1)
                .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(p.sourceName) proposed this \(relative(p.createdAt))").webText(WebTextStyle(size: 13, leading: 18)).foregroundStyle(muted.color)
                if !p.summary.isEmpty { Text(p.summary).webText(WebTextStyle(size: 13, leading: 18)).foregroundStyle(muted.color) }
                if let problem = p.problem { Text(problem).webText(WebTextStyle(size: 15, leading: 20)).foregroundStyle(FoleviTokens.Chrome.destructive.resolve(scheme).color) }
            }
            HStack(spacing: 6) {
                if p.problem == nil {
                    WebButton("Accept", icon: .check, variant: .primary, size: .sm) { Task { await model.answer(p, accept: true) } }.disabled(busy)
                }
                WebButton("Reject", icon: .x, variant: .ghost, size: .sm) { Task { await model.answer(p, accept: false) } }.disabled(busy)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .phoneCard()
    }

    private func noteCard(_ n: ChangedNoteRow) -> some View {
        let muted = FoleviTokens.Chrome.inkMuted.resolve(scheme)
        let shown = model.expanded.contains(n.id)
        return VStack(alignment: .leading, spacing: 8) {
            Button { openNote(n.id) } label: {
                Text(n.title.isEmpty ? "Untitled" : n.title).webText(WebTextStyle(size: 17, leading: 22, weight: 600)).lineLimit(1)
                    .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(n.who) · \(relative(n.changedAt))").webText(WebTextStyle(size: 13, leading: 18)).foregroundStyle(muted.color)
                Text(n.counts).webText(WebTextStyle(size: 13, leading: 18)).foregroundStyle(muted.color)
            }
            HStack(spacing: 6) {
                WebButton("Open note", icon: .externalLink, variant: .ghost, size: .sm) { openNote(n.id) }
                WebButton("Mark as seen", icon: .check, variant: .ghost, size: .sm) { Task { await model.markSeen([n.id]) } }
            }
            WebButton(shown ? "Hide changes" : "Show changes", variant: .quiet, size: .sm) { Task { await model.toggleDiff(n.id) } }
            if shown {
                if let diff = model.diffs[n.id] {
                    ChangeDiffView(diff: diff)
                } else if let error = model.diffErrors[n.id] {
                    Text(error).webText(WebTextStyle(size: 15, leading: 20)).foregroundStyle(FoleviTokens.Chrome.destructive.resolve(scheme).color)
                } else {
                    ProgressView()
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .phoneCard()
    }
}
#endif
