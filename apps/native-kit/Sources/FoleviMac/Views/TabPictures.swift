// Tabs as pictures (the web's TabPreview.tsx and TabOverview.tsx): a note's page drawn small from the same HTML as
// an export (the engine's note.picture), in a web view where nothing can run, take focus or be clicked; joined notes
// side by side; a view as its icon and name. The strip's hover card and the Tab Overview draw from here.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import WebKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The notes' pictures, fetched once and kept a little while (a picture shows a page's top; it needn't be live).
@MainActor @Observable
public final class TabPictureStore {
    public static let pageWidth: CGFloat = 600
    private static let fresh: TimeInterval = 30
    private(set) var html: [String: String] = [:]
    /// Each tab as it was last on screen (Safari's tab overview): the real page, its colours and its folder's notes.
    /// Kept in memory only, for the open tabs; a tab not shown yet this run falls back to its note's page or its
    /// folder's notes drawn from the engine.
    private(set) var shots: [String: CGImage] = [:]
    private var fetched: [String: Date] = [:]
    private var loading: Set<String> = []
    weak var frame: FrameModel?

    init() {}

    func load(_ id: String, title: String) {
        if loading.contains(id) { return }
        if let at = fetched[id], Date().timeIntervalSince(at) < Self.fresh { return }
        guard let client = frame?.client else { return }
        loading.insert(id)
        Task { [weak self] in
            let got = try? await client.command(.notePicture(id: id, title: title))
            guard let self else { return }
            self.loading.remove(id)
            if let page = got?.html {
                self.html[id] = page
                self.fetched[id] = Date()
                self.trim()
            }
        }
    }

    // MARK: the notes' cards (a note tab's thumbnail)

    /// The rows of the notes edited last (each one's card: its colors, cover, title, preview, folder), watched only
    /// while a note's thumbnail is on screen, then let go a little after the last one goes.
    private var rowsStore: ListStore<NoteRow>?
    private var rowUsers = 0
    private var letGo: Task<Void, Never>?
    /// How many of the latest notes are looked through: the notes open in tabs are nearly always among them.
    private static let rowsWatched = 300

    func useRows() {
        rowUsers += 1
        letGo?.cancel()
        guard rowsStore == nil, let client = frame?.client else { return }
        rowsStore = client.watchList(.notesList(view: .all, sort: .updated), window: ListWindow(start: 0, count: Self.rowsWatched))
    }

    func doneWithRows() {
        rowUsers = max(0, rowUsers - 1)
        guard rowUsers == 0 else { return }
        letGo?.cancel()
        letGo = Task { [weak self] in
            try? await Task.sleep(for: .seconds(20))
            guard let self, !Task.isCancelled, self.rowUsers == 0 else { return }
            self.rowsStore?.cancel()
            self.rowsStore = nil
        }
    }

    /// A note's row, if it's among the latest notes.
    func row(_ id: String) -> NoteRow? { rowsStore?.rows.first { $0.id == id } }
    /// The latest notes haven't come yet.
    var rowsLoading: Bool { rowsStore == nil || rowsStore?.status == .loading }

    /// A tab's picture as it's drawn now (nil forgets it: a screen that mustn't be pictured, the Vault).
    func setShot(_ image: CGImage?, for tab: String) {
        shots[tab] = image
        // (Only the open tabs keep theirs.)
        if let open = frame.map({ Set($0.tabs.tabs.map(\.id)) }) {
            for id in shots.keys where !open.contains(id) { shots[id] = nil }
        }
    }

    /// The most pictures kept: each is a whole page's HTML, pictures and all, and every tab hovered over a long
    /// run added one that stayed. (Never fewer than the open tabs, which the Tab Overview shows at once.)
    private static let kept = 40

    private func trim() {
        let limit = max(Self.kept, (frame?.tabs.tabs.count ?? 0) + 8)
        guard html.count > limit else { return }
        let oldest = fetched.sorted { $0.value < $1.value }.prefix(html.count - limit).map(\.key)
        for id in oldest {
            html[id] = nil
            fetched[id] = nil
        }
    }
}

#if os(macOS)
/// A web view that shows a page and nothing else: no scripts, no pointer, no focus, its own empty data store.
private final class PictureWebView: WKWebView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override var acceptsFirstResponder: Bool { false }
    override func scrollWheel(with event: NSEvent) { nextResponder?.scrollWheel(with: event) }
}

private struct PageFrame: NSViewRepresentable {
    let html: String
    let scale: CGFloat
    @Binding var loaded: Bool

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: PageFrame
        var shown: String?
        init(_ p: PageFrame) { parent = p }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loaded = true }
        // Nothing in a picture goes anywhere.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            action.navigationType == .other && action.request.url?.absoluteString == "about:blank" ? .allow : .cancel
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    /// One empty data store for every picture: each with its own had WebKit start a network process for it.
    private static let store = WKWebsiteDataStore.nonPersistent()

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = Self.store
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.suppressesIncrementalRendering = true
        let v = PictureWebView(frame: .zero, configuration: config)
        v.setValue(false, forKey: "drawsBackground")
        v.navigationDelegate = context.coordinator
        v.setAccessibilityElement(false)
        return v
    }

    func updateNSView(_ v: WKWebView, context: Context) {
        context.coordinator.parent = self
        if v.pageZoom != scale { v.pageZoom = scale }
        guard context.coordinator.shown != html else { return }
        context.coordinator.shown = html
        v.loadHTMLString(html, baseURL: nil)
    }
}
#else
/// A web view that shows a page and nothing else: no scripts, no touches, its own empty data store.
private struct PageFrame: UIViewRepresentable {
    let html: String
    let scale: CGFloat
    @Binding var loaded: Bool

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: PageFrame
        var shown: String?
        init(_ p: PageFrame) { parent = p }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loaded = true }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            action.navigationType == .other && action.request.url?.absoluteString == "about:blank" ? .allow : .cancel
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor private static let store = WKWebsiteDataStore.nonPersistent()

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = Self.store
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.suppressesIncrementalRendering = true
        let v = WKWebView(frame: .zero, configuration: config)
        v.isOpaque = false
        v.backgroundColor = .clear
        v.scrollView.isScrollEnabled = false
        v.isUserInteractionEnabled = false
        v.isAccessibilityElement = false
        v.accessibilityElementsHidden = true
        v.navigationDelegate = context.coordinator
        return v
    }

    func updateUIView(_ v: WKWebView, context: Context) {
        context.coordinator.parent = self
        if v.pageZoom != scale { v.pageZoom = scale }
        guard context.coordinator.shown != html else { return }
        context.coordinator.shown = html
        v.loadHTMLString(html, baseURL: nil)
    }
}
#endif

/// One note's page, small: a placeholder until the picture is drawn, which then fades in (never a blank frame).
struct MiniPage: View {
    let id: String
    let title: String
    let store: TabPictureStore
    @Environment(\.colorScheme) private var scheme
    @State private var loaded = false

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .topLeading) {
                color("color-surface-raised")
                if let html = store.html[id], g.size.width > 0 {
                    PageFrame(html: html, scale: g.size.width / TabPictureStore.pageWidth, loaded: $loaded)
                        .frame(width: g.size.width, height: g.size.width * 1.6)
                        .opacity(loaded ? 1 : 0)
                }
                if !loaded {
                    VStack(alignment: .leading, spacing: 8) {
                        bar(0.66, 16)
                        bar(1, 10)
                        bar(0.83, 10)
                    }
                    .padding(16)
                }
            }
            .clipped()
        }
        .onAppear { store.load(id, title: title) }
        .accessibilityHidden(true)
    }

    private func color(_ name: String) -> Color { WebStyles.vars[name]?.resolve(scheme).color ?? .clear }

    private func bar(_ w: CGFloat, _ h: CGFloat) -> some View {
        GeometryReader { g in
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(color("glass-hover")).frame(width: g.size.width * w, height: h)
        }
        .frame(height: h)
    }
}

/// A tab's picture: a note's page, joined notes side by side, or a view's icon and name on the canvas.
struct TabPicture: View {
    let tab: FrameTab?
    let model: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if tab == nil || tab?.isHome == true {
            // Home is drawn from its own data, its latest notes and folders as cards, whole at any size (a picture
            // of the window cropped it: the owner, 21 November 2026).
            HomePicture(model: model)
        } else if let tab, let notes = tab.panes ?? tab.route.noteId.map({ [$0] }) {
            // A note's thumbnail is its card, as the folder grid draws it (the owner, 2026-11-18): its colors and
            // cover, title, a preview and its folder, whole, for every tab at once.
            NoteCardPicture(ids: notes, title: { id in model.tabs.paneTitles[id] ?? (tab.panes == nil ? model.tabs.label(tab) : "Untitled") }, store: model.pictures)
        } else if let shot = model.pictures.shots[tab?.id ?? FrameTab.homeID] {
            // The tab as it was last on screen (Safari's way): its page's own colours, its folder's notes. Whole,
            // fitted inside the box on the canvas (filling it cut off a window wider than 16:10).
            GeometryReader { g in
                ZStack {
                    (WebStyles.vars["color-canvas"]?.resolve(scheme).color ?? .clear)
                    Image(decorative: shot, scale: 1)
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                        .frame(width: g.size.width, height: g.size.height)
                }
                .clipped()
            }
            .accessibilityHidden(true)
        } else if let tab, let list = FolderPicture.list(for: tab.route) {
            FolderPicture(view: list.view, folderId: list.folderId, tagId: list.tagId, label: model.tabs.label(tab), model: model)
        } else {
            let label = tab.map { model.tabs.label($0) } ?? "Home"
            ZStack {
                (WebStyles.vars["color-canvas"]?.resolve(scheme).color ?? .clear)
                VStack(spacing: 8) {
                    Group {
                        if let t = tab, WebTopBar.wearsFlower(t.route) { AiMarkGlyph(size: 24) } else { WebIconView(tab.map { WebTopBar.icon(for: $0.route) } ?? .house, size: 24) }
                    }
                        .frame(width: 48, height: 48)
                        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).fill(WebStyles.vars["glass-hover"]?.resolve(scheme).color ?? .clear))
                        .foregroundStyle(WebStyles.vars["color-ink-muted"]?.resolve(scheme).color ?? .gray)
                    Text(label).webText(WebTextStyle(size: 13, leading: 18, weight: 600)).foregroundStyle(WebStyles.vars["color-heading"]?.resolve(scheme).color ?? .primary)
                }
            }
        }
    }
}

/// A note tab's thumbnail: each note's card (WebNoteCard, the folder grid's) whole and centered on the canvas; joined
/// notes side by side. A note not among the latest (shared with you, archived) shows its page drawn small instead.
struct NoteCardPicture: View {
    let ids: [String]
    let title: (String) -> String
    let store: TabPictureStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { g in
            let n = CGFloat(max(1, ids.count))
            let pad = max(8, g.size.height * 0.07)
            // As tall as the picture allows, narrower if several must fit side by side.
            let w = min((g.size.height - pad * 2) * WebNoteCard.aspect, (g.size.width - pad * (n + 1)) / n)
            let h = w / WebNoteCard.aspect
            ZStack {
                (WebStyles.vars["color-surface-sunken"]?.resolve(scheme).color ?? .clear)
                HStack(spacing: pad) {
                    ForEach(ids, id: \.self) { id in
                        Group {
                            if let row = store.row(id) {
                                WebNoteCard(CardMapping.noteCard(row))
                            } else if !store.rowsLoading {
                                MiniPage(id: id, title: title(id), store: store)
                                    .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous))
                            } else {
                                RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
                                    .fill(WebStyles.vars["color-surface-raised"]?.resolve(scheme).color ?? .white)
                            }
                        }
                        .frame(width: w, height: h)
                    }
                }
                .allowsHitTesting(false)
            }
        }
        .onAppear { store.useRows() }
        .onDisappear { store.doneWithRows() }
        .accessibilityHidden(true)
    }
}

/// A folder (or a list of notes: All notes, Drafts, a tag) not on screen yet this run: its first notes as its grid
/// shows them, each card in its own colours.
struct FolderPicture: View {
    let view: NotesListView
    var folderId: String? = nil
    var tagId: String? = nil
    let label: String
    let model: FrameModel
    @Environment(\.colorScheme) private var scheme
    @State private var store: ListStore<NoteRow>?

    /// The notes a tab's route lists, if it lists notes as cards.
    static func list(for route: FrameRoute) -> (view: NotesListView, folderId: String?, tagId: String?)? {
        switch route {
        case .folder(let id): return (.folder, id, nil)
        case .tag(let id): return (.tag, nil, id)
        case .notes(let v) where v != .folder && v != .tag: return (v, nil, nil)
        default: return nil
        }
    }

    /// The grid drawn at this width, then scaled to the picture (the card's look holds at any size).
    private static let width: CGFloat = 640
    private static let columns = 3

    var body: some View {
        GeometryReader { g in
            let rows = Array((store?.rows ?? []).prefix(Self.columns * 2))
            ZStack(alignment: .topLeading) {
                (WebStyles.vars["color-surface-raised"]?.resolve(scheme).color ?? .clear)
                if rows.isEmpty {
                    VStack(spacing: 8) {
                        WebIconView(view == .folder ? .folder : .files, size: 24)
                            .foregroundStyle(WebStyles.vars["color-ink-muted"]?.resolve(scheme).color ?? .gray)
                        Text(store?.status == .loading ? label : "No notes")
                            .webText(WebTextStyle(size: 13, leading: 18, weight: 600))
                            .foregroundStyle(WebStyles.vars["color-heading"]?.resolve(scheme).color ?? .primary)
                    }
                    .frame(width: g.size.width, height: g.size.height)
                } else {
                    let gap: CGFloat = 20, pad: CGFloat = 28
                    let w = (Self.width - pad * 2 - gap * CGFloat(Self.columns - 1)) / CGFloat(Self.columns)
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(w), spacing: gap), count: Self.columns), alignment: .leading, spacing: gap) {
                        ForEach(rows, id: \.id) { row in
                            WebNoteCard(CardMapping.noteCard(row)).frame(width: w)
                        }
                    }
                    .padding(pad)
                    .frame(width: Self.width, alignment: .topLeading)
                    .scaleEffect(g.size.width / Self.width, anchor: .topLeading)
                    .allowsHitTesting(false)
                }
            }
            .clipped()
        }
        .onAppear {
            guard store == nil else { return }
            store = model.client.watchList(.notesList(view: view, folderId: folderId, tagId: tagId))
        }
        .onDisappear {
            store?.cancel()
            store = nil
        }
        .accessibilityHidden(true)
    }
}

/// Home's tab, drawn small (the owner, 21 November 2026): a "Recent notes" row of note cards and a "Recent folders"
/// row of folder cards, as Home shows them, laid out at 960 by 600 pt (16:10, with 32 pt of breathing room between
/// the rows: the owner, 21 November 2026) and scaled to the picture so every card is whole.
struct HomePicture: View {
    let model: FrameModel
    @Environment(\.colorScheme) private var scheme
    @State private var notes: ListStore<NoteRow>?
    @State private var folders: ValueStore<FolderCardsValue>?

    private static let width: CGFloat = 960
    private static let columns = 4
    private static let pad: CGFloat = 24
    private static let gap: CGFloat = 16
    /// Between the notes' row and the folders' heading.
    private static let rowGap: CGFloat = 32

    var body: some View {
        GeometryReader { g in
            let rows = Array((notes?.rows ?? []).prefix(Self.columns))
            let recent = (folders?.value?.folders ?? [])
                .sorted { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.createdAt < $1.createdAt }
                .prefix(Self.columns)
            ZStack(alignment: .topLeading) {
                color("color-canvas")
                if rows.isEmpty && recent.isEmpty {
                    VStack(spacing: 8) {
                        WebIconView(.house, size: 24).foregroundStyle(color("color-ink-muted"))
                        Text("Home").webText(WebTextStyle(size: 13, leading: 18, weight: 600)).foregroundStyle(color("color-heading"))
                    }
                    .frame(width: g.size.width, height: g.size.height)
                } else {
                    let w = (Self.width - Self.pad * 2 - Self.gap * CGFloat(Self.columns - 1)) / CGFloat(Self.columns)
                    VStack(alignment: .leading, spacing: 0) {
                        if !rows.isEmpty {
                            heading("Recent notes", icon: .clock3)
                            HStack(alignment: .top, spacing: Self.gap) {
                                ForEach(rows, id: \.id) { row in WebNoteCard(CardMapping.noteCard(row)).frame(width: w) }
                            }
                            .padding(.bottom, Self.rowGap)
                        }
                        if !recent.isEmpty {
                            heading("Recent folders", icon: .folder)
                            HStack(alignment: .top, spacing: Self.gap) {
                                ForEach(Array(recent), id: \.id) { f in WebFolderCard(CardMapping.folderCard(f, parentName: f.path)).frame(width: w) }
                            }
                        }
                    }
                    .padding(Self.pad)
                    // Its own 16:10 box at the layout's width: offered only the picture's height, the cards shrank.
                    .frame(width: Self.width, height: Self.width / 1.6, alignment: .topLeading)
                    .scaleEffect(g.size.width / Self.width, anchor: .topLeading)
                    .allowsHitTesting(false)
                }
            }
            .clipped()
        }
        .onAppear {
            if notes == nil { notes = model.client.watchList(.notesList(view: .all, sort: .updated), window: ListWindow(start: 0, count: Self.columns)) }
            if folders == nil { folders = model.client.watch(.foldersCards(all: true)) }
        }
        .onDisappear {
            notes?.cancel()
            notes = nil
            folders = nil
        }
        .accessibilityHidden(true)
    }

    private func heading(_ title: String, icon: WebIcon) -> some View {
        HStack(spacing: 6) {
            WebIconView(icon, size: 18).foregroundStyle(color("color-ink-muted"))
            Text(title).webText(WebTextStyle(size: 20, leading: 26, weight: 600)) // the web's Title 2.foregroundStyle(color("color-heading"))
        }
        .padding(.bottom, 12)
    }

    private func color(_ name: String) -> Color { WebStyles.vars[name]?.resolve(scheme).color ?? .clear }
}

/// The hover card's surface: the web's raised card on the iPad; on the Mac the system's control background with a
/// popover's corners, hairline and shadow.
private struct PreviewCard: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        #if os(macOS)
        let shape = RoundedRectangle(cornerRadius: MacLook.containerRadius, style: .continuous)
        content
            .background(MacLook.Colors.container)
            .clipShape(shape)
            .overlay(shape.strokeBorder(MacLook.Colors.separator, lineWidth: 1))
            .nativeShadow(.overlay)
        #else
        let line = WebStyles.vars["color-line"]?.resolve(scheme).color ?? .clear
        content
            .background(WebStyles.vars["color-surface-raised"]?.resolve(scheme).color ?? .clear)
            .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).strokeBorder(line, lineWidth: 1))
            .nativeShadow(.floating)
        #endif
    }
}

/// The strip's hover card: the picture (16:10) and the tab's name, under the tab, kept inside the window. It takes no
/// clicks. The tabs pictured lately stay drawn, hidden, so going back to one shows it already there.
public struct TabPreviewLayer: View {
    let model: FrameModel
    /// Where the top bar sits in this layer (its tabs' frames are the bar's).
    let barOrigin: CGPoint
    @Environment(\.colorScheme) private var scheme
    @State private var pictured: [String] = []

    public init(model: FrameModel, barOrigin: CGPoint) {
        self.model = model
        self.barOrigin = barOrigin
    }

    public var body: some View {
        GeometryReader { g in
            if let shown = model.preview.shown, let tab = model.tabs.tabs.first(where: { $0.id == shown.id }) {
                let left = min(max(8, barOrigin.x + shown.frame.midX - 150), g.size.width - 308)
                VStack(spacing: 0) {
                    ZStack {
                        ForEach(pictured, id: \.self) { id in
                            if let t = model.tabs.tabs.first(where: { $0.id == id }) {
                                TabPicture(tab: t, model: model).opacity(id == tab.id ? 1 : 0)
                            }
                        }
                    }
                    .aspectRatio(16 / 10, contentMode: .fit)
                    // The pictures stay in their box (a joined tab's pages ran on under its name).
                    .clipped()
                    #if os(macOS)
                    // The native look: the system's type and colours, a popover's corners and shadow.
                    Divider()
                    Text(model.tabs.label(tab)).font(MacLook.Text.headline)
                        .foregroundStyle(MacLook.Colors.label)
                        .lineLimit(1).truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                    #else
                    Rectangle().fill(color("color-line")).frame(height: 1)
                    Text(model.tabs.label(tab)).webText(WebTextStyle(size: 13, leading: 18, weight: 600))
                        .foregroundStyle(color("color-heading"))
                        .lineLimit(1).truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                    #endif
                }
                .frame(width: 300)
                .modifier(PreviewCard())
                .offset(x: left, y: barOrigin.y + shown.frame.maxY + 8)
                .onAppear { picture(tab.id) }
                .onChange(of: tab.id) { picture(tab.id) }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func picture(_ id: String) {
        pictured = [id] + pictured.filter { $0 != id }.prefix(5)
    }

    private func color(_ name: String) -> Color { WebStyles.vars[name]?.resolve(scheme).color ?? .clear }
}
#endif
