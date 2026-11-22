// Home: the space at a glance. The counts that lead to Notes, Drafts, Shared, Changes and Reviews, Catch me up
// (Foli AI's brief of what changed), today's reviews, recent notes as Folevi's cards, starred notes, and every
// folder (newest change first) as frosted folder cards. Native scroll view, SF Pro section titles, Folevi's type
// on the cards. Carousels fade at their ends and show arrows on hover.
import FoleviDesign
import FoleviEngine
import SwiftUI

struct HomeScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var home = Live<Views.Home>()
    @State private var folders = Live<Views.FoldersCards>()
    @State private var reviews = Live<Views.Reviews>()

    var body: some View {
        ScrollView {
            if let h = home.value {
                VStack(alignment: .leading, spacing: 20) {
                    Text(h.spaceName.nonEmpty ?? app.spaceName)
                        .font(CoreType.screenTitle(30))
                        .padding(.top, 8)
                        .accessibilityAddTraits(.isHeader)

                    if !h.rows.isEmpty { summary(h.rows) }

                    if h.catchUp.available { CatchUpCardView(card: h.catchUp, window: window) }

                    if h.rows.contains(where: { $0.id == .reviews }), let r = reviews.value, r.hasCards { reviewsCard(r) }

                    section("Recent", action: h.recents.isEmpty ? nil : "See All", to: .recent) {
                        if !h.recentsLoaded {
                            Carousel(label: "recent notes") { ForEach(0..<5, id: \.self) { _ in SkeletonCard() } }
                        } else if h.recents.isEmpty {
                            EmptyHint(title: "No notes yet", text: "Press New Note (⌘N) to write your first one.")
                        } else {
                            Carousel(label: "recent notes") {
                                ForEach(h.recents) { row in NoteCardButton(row: row, window: window, fromRecent: true).frame(width: CoreCards.noteWidth) }
                            }
                        }
                    }

                    section("Starred", action: h.starred.more ? "See All" : nil, to: .starred) {
                        if h.starred.rows.isEmpty {
                            EmptyHint(title: "No starred notes yet", text: "Star notes you come back to often, and they wait for you here.")
                        } else {
                            Carousel(label: "starred notes") {
                                ForEach(h.starred.rows.prefix(6)) { row in NoteCardButton(row: row, window: window).frame(width: CoreCards.noteWidth) }
                            }
                        }
                    }

                    foldersSection(h)

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
                .background { Color.clear.contentShape(Rectangle()).contextMenu { AnywhereMenu(window: window) } }
            } else {
                LoadingScreen().frame(height: 300)
            }
        }
        .onScreen(window) { on in
            home.setVisible(on)
            folders.setVisible(on)
            reviews.setVisible(on)
        }
        .task(id: app.client.map(ObjectIdentifier.init)) {
            home.bind(app.client, Views.Home(SpaceArgs()), snapshot: "home")
            folders.bind(app.client, Views.FoldersCards(FolderCardsArgs(space: nil, parentId: nil, all: true)))
            reviews.bind(app.client, Views.Reviews(ReviewsArgs(noteId: nil, space: nil)))
        }
    }

    // MARK: sections

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

    private func reviewsCard(_ r: ReviewsValue) -> some View {
        HStack(spacing: 12) {
            WebIcon.layers.image(size: 18).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text("Today's Reviews").font(.headline)
                Text(r.due + r.new == 0 ? "All caught up. More cards come due later." : "\(r.due + r.new) \(r.due + r.new == 1 ? "card" : "cards") to review.")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if r.due + r.new > 0 { Button("Start Review") { window.go(.reviews) }.buttonStyle(InkPillStyle()) }
        }
        .padding(16)
        .background(.fill.quinary, in: .rect(cornerRadius: 14))
    }

    @ViewBuilder private func foldersSection(_ h: HomeValue) -> some View {
        let all = (folders.value?.folders ?? h.folders).sorted { $0.updatedAt > $1.updatedAt }
        section(all.isEmpty ? "Folders" : "Folders · \(all.count)", action: all.isEmpty ? nil : "See All", to: .folders) {
            if all.isEmpty {
                EmptyHint(title: "No folders yet", text: "Make one from the sidebar (⌃⌘N) to keep related notes together.")
            } else {
                Carousel(label: "folders", rows: all.count > 4 ? 2 : 1) {
                    ForEach(all, id: \.id) { f in HomeFolderCard(folder: f, window: window).frame(width: CoreCards.folderWidth) }
                }
            }
        }
    }

    private func section<C: View>(_ title: String, action: String?, to dest: Destination?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                Spacer()
                if let action, let dest {
                    Button(action) { window.go(dest) }
                        .buttonStyle(.hoverPlain)
                        .foregroundStyle(.secondary)
                        .hoverEffectCompat()
                }
            }
            content()
        }
    }
}

/// A horizontal row of cards (one or two rows) that snaps, fades at its ends, and shows Back and Forward arrows
/// while the pointer is over it.
struct Carousel<Content: View>: View {
    let label: String
    var rows = 1
    @ViewBuilder let content: () -> Content
    @State private var hovering = false
    @State private var position = ScrollPosition(idType: Int.self)
    @State private var offset: CGFloat = 0
    @State private var maxOffset: CGFloat = 0
    @State private var width: CGFloat = 0

    var body: some View {
        ScrollView(.horizontal) {
            Group {
                if rows > 1 {
                    LazyHGrid(rows: Array(repeating: GridItem(.fixed(150), spacing: 18), count: rows), spacing: 18) { content() }
                } else {
                    LazyHStack(spacing: 18) { content() }
                }
            }
            .scrollTargetLayout()
            .padding(.vertical, 10)
        }
        .scrollPosition($position)
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.never)
        .onScrollGeometryChange(for: [CGFloat].self) { g in [g.contentOffset.x, g.contentSize.width - g.containerSize.width, g.containerSize.width] } action: { _, v in
            offset = v[0]; maxOffset = max(0, v[1]); width = v[2]
        }
        .mask {
            HStack(spacing: 0) {
                LinearGradient(colors: [.black.opacity(offset > 4 ? 0 : 1), .black], startPoint: .leading, endPoint: .trailing).frame(width: 28)
                Rectangle()
                LinearGradient(colors: [.black, .black.opacity(offset < maxOffset - 4 ? 0 : 1)], startPoint: .leading, endPoint: .trailing).frame(width: 28)
            }
        }
        .overlay(alignment: .leading) { if hovering && offset > 4 { arrow("chevron.left", "Scroll \(label) back", by: -1) } }
        .overlay(alignment: .trailing) { if hovering && offset < maxOffset - 4 { arrow("chevron.right", "Scroll \(label) forward", by: 1) } }
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hovering = h } }
    }

    private func arrow(_ symbol: String, _ help: String, by direction: CGFloat) -> some View {
        Button {
            withAnimation(.smooth) { position.scrollTo(x: min(max(0, offset + direction * width * 0.8), maxOffset)) }
        } label: {
            Image(systemName: symbol).font(.body.weight(.semibold)).frame(width: 30, height: 30)
        }
        .buttonStyle(.hoverIcon)
        .glassEffect(.regular.interactive(), in: .circle)
        .help(help)
        .accessibilityLabel(help)
        .padding(.horizontal, 4)
        .transition(.opacity)
    }
}

/// A card's shape while Home loads.
struct SkeletonCard: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 10).fill(.fill.tertiary).frame(width: CoreCards.noteWidth, height: 172)
            .accessibilityHidden(true)
    }
}

/// What an empty section says, and how to fill it.
struct EmptyHint: View {
    let title: String
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.callout.weight(.medium))
            Text(text).font(.callout).foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }
}

/// A folder on Home: opens it, takes notes and folders dropped on it, and has the folder's menu.
struct HomeFolderCard: View {
    let folder: FolderCard
    let window: WindowModel
    /// Where a folder dropped on this card goes: before it, inside it, after it (Folders page); nil: inside only.
    var reorder: ((FolderDropZone, String) -> Void)? = nil
    @State private var zone: FolderDropZone?
    @State private var width: CGFloat = 190
    private var app: AppModel { .shared }
    @State private var targeted = false
    @State private var hoveringCard = false
    @State private var renaming: FolderNode?
    @State private var newSubfolderOf: FolderNode?

    private var node: FolderNode? { app.tree.value?.folders.first { $0.id == folder.id } }

    var body: some View {
        Button { window.go(.folder(folder.id)) } label: {
            VStack(alignment: .leading, spacing: 4) {
                WebFolderCard(Cards.folder(folder))
                if let path = folder.path, !path.isEmpty { Text(path).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
        .buttonStyle(CardPressStyle())
        .overlay(alignment: .topTrailing) {
            if hoveringCard, let node {
                Menu { FolderMenu(folder: node, window: window, rename: { renaming = $0 }, newSubfolder: { newSubfolderOf = $0 }) } label: {
                    Image(systemName: "ellipsis").frame(width: 24, height: 24)
                }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                .glassEffect(.regular.interactive(), in: .circle)
                .help("Folder Options")
                .padding(.top, 54).padding(.trailing, 8)
            }
        }
        .onHover { hoveringCard = $0 }
        .onMiddleClick { app.open(.folder(folder.id), newTab: true, background: true) }
        .scaleEffect(zone == .inside ? 1.04 : 1)
        .animation(.snappy, value: zone)
        .task(id: zone) {
            // Spring-loading: a drag that rests on the folder for 0.6 s opens it.
            guard zone == .inside else { return }
            try? await Task.sleep(for: .milliseconds(600))
            if zone == .inside, !Task.isCancelled { window.go(.folder(folder.id)) }
        }
        .draggable(FolderDrag(id: folder.id, name: folder.name))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onDrop(of: [FolderDrag.type, NoteDrag.type], delegate: FolderCardDrop(width: width, zones: reorder != nil, zone: $zone) { z, providers in
            for p in providers {
                if p.hasItemConformingToTypeIdentifier(FolderDrag.type.identifier) {
                    _ = p.loadTransferable(type: FolderDrag.self) { r in
                        guard case .success(let f) = r else { return }
                        Task { @MainActor in
                            guard f.id != folder.id else { return }
                            if z == .inside || reorder == nil {
                                if FolderActions.move(f.id, into: folder.id) { app.toast("Moved to \(folder.name)") }
                            } else {
                                reorder?(z, f.id)
                            }
                        }
                    }
                } else {
                    _ = p.loadTransferable(type: NoteDrag.self) { r in
                        guard case .success(let n) = r else { return }
                        Task { @MainActor in
                            app.perform { _ = try await $0.command(Commands.NoteMove(NoteMoveArgs(ids: [n.id], folderId: folder.id))) }
                            app.toast("Moved to \(folder.name)")
                        }
                    }
                }
            }
        })
        .overlay(alignment: .leading) { if zone == .before { Capsule().fill(Color.foleviInk).frame(width: 3).padding(.vertical, 8).offset(x: -10) } }
        .overlay(alignment: .trailing) { if zone == .after { Capsule().fill(Color.foleviInk).frame(width: 3).padding(.vertical, 8).offset(x: 10) } }
        .contextMenu {
            if let node { FolderMenu(folder: node, window: window, rename: { renaming = $0 }, newSubfolder: { newSubfolderOf = $0 }) }
        }
        .sheet(item: $renaming) { f in
            NameSheet(title: "Rename Folder", initial: f.name, action: "Rename") { name in
                app.perform { _ = try await $0.command(Commands.FolderRename(FolderRenameArgs(id: f.id, name: name))) }
            }
        }
        .sheet(item: $newSubfolderOf) { f in
            NameSheet(title: "New Folder in \(f.name)", initial: "", action: "Create") { name in
                app.perform { _ = try await $0.command(Commands.FolderCreate(FolderCreateArgs(space: nil, name: name, parentId: f.id, color: nil))) }
            }
        }
        .accessibilityLabel(folder.name)
    }
}

/// Catch me up: Foli AI's short brief of what changed since you last looked. Its [n] marks open the numbered
/// sources; Refresh writes it again.
struct CatchUpCardView: View {
    let card: CatchUpCard
    let window: WindowModel
    private var app: AppModel { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button { window.go(.catchUp) } label: { Label { Text("Catch Me Up") } icon: { AiMarkGlyph(size: 16) }.font(.headline) }
                    .buttonStyle(.hoverPlain).help("About Catch Me Up")
                Spacer()
                switch card.state {
                case .running: EmptyView()
                case .ready:
                    Button { run() } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.borderless).help("Refresh")
                    Button("Clear") { app.perform { _ = try await $0.command(Commands.CatchUpClear(SpaceArgs())) } }.buttonStyle(.borderless)
                default:
                    Button("Catch Me Up", action: run)
                }
            }
            if card.state == .running {
                ShimmerLines(caption: "Reading this week's notes…")
            } else if let brief = card.brief {
                AnswerText(text: brief.text, citations: brief.sources.enumerated().map { ChatCitation(n: $0.offset + 1, noteId: $0.element.id, title: $0.element.title) }, webCitations: [], window: window)
                if !brief.sources.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(Array(brief.sources.enumerated()), id: \.element.id) { i, s in
                            Button { window.go(.note(s.id)) } label: { Text("\(i + 1). \(s.title.nonEmpty ?? "Untitled")") }
                                .buttonStyle(.bordered).controlSize(.regular)
                        }
                    }
                }
            } else if let e = card.error {
                Text(e.message).foregroundStyle(.secondary)
            } else {
                Text("Your week in one short read: what changed in your notes, what's due, and where it came from.").foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(.fill.quinary, in: .rect(cornerRadius: 14))
    }

    private func run() { app.perform { _ = try await $0.command(Commands.CatchUpRun(SpaceArgs())) } }
}

/// Catch me up (/catch-up): what the brief is, then the brief itself.
struct CatchUpScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var home = Live<Views.Home>()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 14) {
                    AiMarkGlyph(size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Catch Me Up").font(CoreType.screenTitle(28))
                        Text("Your week in one short read").foregroundStyle(.secondary)
                    }
                }
                Text("Foli AI reads what changed in your notes since you last looked and writes a short brief, with the notes it came from.")
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 10) {
                    Label("What changed: notes you and others edited, added or finished.", coreSymbol: "pencil.line")
                    Label("What's due: tasks coming up and overdue.", coreSymbol: "checklist")
                    Label("Where it came from: every line points to its note.", coreSymbol: "quote.bubble")
                }
                if let card = home.value?.catchUp {
                    if card.available {
                        CatchUpCardView(card: card, window: window)
                    } else {
                        Text("Catch Me Up needs Foli AI. Turn it on in Settings.").foregroundStyle(.secondary)
                        Button("Open Foli AI Settings") { SettingsRouter.shared.open("ai") }
                    }
                } else {
                    ShimmerLines(caption: "Loading…")
                }
            }
            .padding(32)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .task(id: app.client.map(ObjectIdentifier.init)) { home.bind(app.client, Views.Home(SpaceArgs())) }
    }
}

/// Four soft lines that shimmer while Foli AI writes (still with Reduce Motion).
struct ShimmerLines: View {
    let caption: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(caption).font(.callout).foregroundStyle(.secondary)
            ForEach([1.0, 0.92, 0.97, 0.6], id: \.self) { w in
                GeometryReader { g in
                    RoundedRectangle(cornerRadius: 4).fill(.fill.tertiary)
                        .overlay {
                            if !reduceMotion {
                                LinearGradient(colors: [.clear, .white.opacity(0.35), .clear], startPoint: .leading, endPoint: .trailing)
                                    .frame(width: g.size.width * 0.4)
                                    .offset(x: phase * g.size.width)
                            }
                        }
                        .clipShape(.rect(cornerRadius: 4))
                        .frame(width: g.size.width * w)
                }
                .frame(height: 10)
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1.2 }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(caption)
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
                .buttonStyle(.hoverChip)
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


enum FolderDropZone: Equatable { case before, inside, after }

/// A folder card as a drop target: notes go inside; a folder goes before (leading quarter), inside (middle) or
/// after (trailing quarter) when the card's place in the order can change.
struct FolderCardDrop: DropDelegate {
    let width: CGFloat
    let zones: Bool
    /// Rows (the sidebar): the zones run top to bottom, measured against `width` as the row's height.
    var vertical = false
    @Binding var zone: FolderDropZone?
    let perform: (FolderDropZone, [NSItemProvider]) -> Void

    private func zone(for info: DropInfo) -> FolderDropZone {
        guard zones, info.hasItemsConforming(to: [FolderDrag.type]) else { return .inside }
        let x = vertical ? info.location.y : info.location.x
        if x < width * 0.25 { return .before }
        if x > width * 0.75 { return .after }
        return .inside
    }

    func dropEntered(info: DropInfo) { zone = zone(for: info) }
    func dropUpdated(info: DropInfo) -> DropProposal? { zone = zone(for: info); return DropProposal(operation: .move) }
    func dropExited(info: DropInfo) { zone = nil }
    func performDrop(info: DropInfo) -> Bool {
        let z = zone(for: info)
        zone = nil
        perform(z, info.itemProviders(for: [FolderDrag.type, NoteDrag.type]))
        return true
    }
}
