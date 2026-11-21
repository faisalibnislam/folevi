// Home: the space at a glance. Recent notes as Folevi's cards, Catch me up (Foli AI's brief of what changed),
// the counts that lead to Notes, Drafts, Shared, Changes and Reviews, starred notes, and the space's folders as
// frosted folder cards. Native scroll view, SF Pro section titles, Folevi's type on the cards.
import FoleviDesign
import FoleviEngine
import SwiftUI

struct HomeScreen: View {
    let window: WindowModel
    @Environment(AppModel.self) private var app
    @State private var home = Live<Views.Home>()

    var body: some View {
        ScrollView {
            if let h = home.value {
                VStack(alignment: .leading, spacing: 28) {
                    Text(h.spaceName.nonEmpty ?? app.spaceName)
                        .font(CoreType.screenTitle(30))
                        .padding(.top, 8)
                        .accessibilityAddTraits(.isHeader)

                    if !h.rows.isEmpty { summary(h.rows) }

                    if h.catchUp.available { CatchUpCardView(card: h.catchUp, window: window) }

                    section("Recent", action: "See All", to: .recent) {
                        if h.recents.isEmpty && h.recentsLoaded {
                            Text("Notes you open show up here.").foregroundStyle(.secondary)
                        } else {
                            strip(h.recents)
                        }
                    }

                    if !h.starred.rows.isEmpty {
                        section("Starred", action: h.starred.more ? "See All" : nil, to: .starred) { strip(h.starred.rows) }
                    }

                    if !h.folders.isEmpty {
                        section("Folders", action: "See All", to: .folders) {
                            ScrollView(.horizontal) {
                                LazyHStack(spacing: 18) {
                                    ForEach(h.folders, id: \.id) { f in
                                        Button { window.go(.folder(f.id)) } label: { WebFolderCard(Cards.folder(f)).frame(width: 190) }
                                            .buttonStyle(CardPressStyle())
                                            .dropDestination(for: NoteDrag.self) { items, _ in
                                                let ids = items.map(\.id)
                                                app.perform { _ = try await $0.command(Commands.NoteMove(NoteMoveArgs(ids: ids, folderId: f.id))) }
                                                return true
                                            }
                                    }
                                }
                                .padding(.vertical, 10)
                            }
                            .scrollIndicators(.never)
                            .scrollClipDisabled()
                        }
                    }

                    if !h.tags.isEmpty {
                        section("Tags", action: nil, to: nil) {
                            FlowTags(tags: h.tags) { window.go(.tag($0)) }
                        }
                    }
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 40)
                .frame(maxWidth: 1100, alignment: .leading)
                .frame(maxWidth: .infinity)
            } else {
                LoadingScreen().frame(height: 300)
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) { home.bind(app.client, Views.Home(SpaceArgs())) }
    }

    private func summary(_ rows: [HomeRow]) -> some View {
        HStack(spacing: 12) {
            ForEach(rows, id: \.id) { r in
                Button {
                    if let d = Destination(path: r.route) { window.go(d) }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(r.count.map { $0.formatted() } ?? "–").font(.title2.weight(.semibold)).monospacedDigit()
                        Text(r.title).font(.callout).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(.fill.quinary, in: .rect(cornerRadius: 12))
                    .contentShape(.rect(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .hoverEffectCompat()
            }
        }
    }

    private func section<C: View>(_ title: String, action: String?, to dest: Destination?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                Spacer()
                if let action, let dest {
                    Button(action) { window.go(dest) }.buttonStyle(.link)
                }
            }
            content()
        }
    }

    private func strip(_ rows: [NoteRow]) -> some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 18) {
                ForEach(rows) { row in
                    NoteCardButton(row: row, window: window).frame(width: 196)
                }
            }
            .padding(.vertical, 10)
        }
        .scrollIndicators(.never)
        .scrollClipDisabled()
    }
}

/// Catch me up: Foli AI's short brief of what changed since you last looked, with its sources.
struct CatchUpCardView: View {
    let card: CatchUpCard
    let window: WindowModel
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Catch Me Up", systemImage: "sparkles").font(.headline)
                Spacer()
                switch card.state {
                case .running: ProgressView().controlSize(.small)
                case .ready:
                    Button("Clear") { app.perform { _ = try await $0.command(Commands.CatchUpClear(SpaceArgs())) } }.buttonStyle(.borderless)
                default:
                    Button("Catch Me Up") { app.perform { _ = try await $0.command(Commands.CatchUpRun(SpaceArgs())) } }
                }
            }
            if let brief = card.brief {
                Text(brief.text).font(CoreType.noteText(14)).textSelection(.enabled)
                if !brief.sources.isEmpty {
                    HStack {
                        ForEach(brief.sources.prefix(4), id: \.id) { s in
                            Button(s.title.nonEmpty ?? "Untitled") { window.go(.note(s.id)) }.buttonStyle(.link).font(.callout)
                        }
                    }
                }
            } else if let e = card.error {
                Text(e.message).foregroundStyle(.secondary)
            } else {
                Text("A short summary of what changed in your notes while you were away.").foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(.fill.quinary, in: .rect(cornerRadius: 14))
    }
}

/// Tags as small capsules that wrap.
struct FlowTags: View {
    let tags: [TagRow]
    let open: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(tags, id: \.id) { t in
                Button { open(t.id) } label: {
                    Text("#" + t.name)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Color.folevi(t.color).opacity(0.15), in: .capsule)
                        .foregroundStyle(Color.folevi(t.color))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// A layout that places its children in rows, wrapping at the width.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 600
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > width, x > 0 { x = 0; y += line + spacing; line = 0 }
            x += s.width + spacing
            line = max(line, s.height)
        }
        return CGSize(width: width, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += line + spacing; line = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            line = max(line, s.height)
        }
    }
}

extension View {
    /// A visible hover on a plain button (every clickable control shows one).
    func hoverEffectCompat() -> some View { modifier(HoverHighlight()) }
}

struct HoverHighlight: ViewModifier {
    @State private var hovered = false

    func body(content: Content) -> some View {
        content
            .brightness(hovered ? -0.03 : 0)
            .onHover { hovered = $0 }
            .animation(.easeOut(duration: 0.12), value: hovered)
    }
}
