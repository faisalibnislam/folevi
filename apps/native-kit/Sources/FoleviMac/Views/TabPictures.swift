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
        if let shot = model.pictures.shots[tab?.id ?? FrameTab.homeID] {
            // The tab as it was last on screen (Safari's way): its page's own colours, its folder's notes.
            GeometryReader { g in
                Image(decorative: shot, scale: 1)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .frame(width: g.size.width, height: g.size.height, alignment: .top)
                    .clipped()
            }
            .accessibilityHidden(true)
        } else if let tab, let notes = tab.panes ?? tab.route.noteId.map({ [$0] }) {
            HStack(spacing: 1) {
                ForEach(notes, id: \.self) { id in
                    MiniPage(id: id, title: model.tabs.paneTitles[id] ?? (tab.panes == nil ? model.tabs.label(tab) : "Untitled"), store: model.pictures)
                }
            }
            .background(WebStyles.vars["color-line"]?.resolve(scheme).color ?? .gray)
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
            .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
        #else
        let line = WebStyles.vars["color-line"]?.resolve(scheme).color ?? .clear
        content
            .background(WebStyles.vars["color-surface-raised"]?.resolve(scheme).color ?? .clear)
            .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).strokeBorder(line, lineWidth: 1))
            .shadow(color: .black.opacity(0.18), radius: 18, y: 12)
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
