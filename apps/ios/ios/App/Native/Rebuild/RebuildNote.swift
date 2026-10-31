// A note in the iOS rebuild's frame (docs/IOS_REBUILD_PLAN.md, I1): the Page View (today's app's one web view,
// the engine and the note editor) full screen under the web's note bars drawn natively (FoleviDesign's
// PhoneNoteTopBar, PhoneNoteToolBars and PhoneKeyboardBar). The page draws the note's content only; the bars'
// room goes to it as `insets`, so the content and the caret stay clear of them. The page's tool panels (Format,
// Insert, Style, Comments, Foli AI) are still the page's own sheets.
import SwiftUI
import UIKit
import WebKit
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

struct RebuildNoteScreen: View {
    let noteId: String
    let model: PhoneModel
    let pageHost: PageViewHost
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    @State private var scrolled: CGFloat = 0
    @State private var titleFoot: CGFloat = 72
    @State private var askingLink = false
    @State private var linkText = ""
    @State private var safe = EdgeInsets()
    /// Format, Insert, Style or Comments, drawn natively in a sheet (Foli AI is still the page's own).
    @State private var nativeTool: PhoneNoteTool?

    var body: some View {
        let meta = model.noteMeta[noteId]
        // Until the page knows the note, its tools stay as for an editable note rather than flicker.
        let canEdit = meta.map { $0.found ? $0.canEdit : true } ?? true
        let editing = model.editing && model.shownNote == noteId
        let panel = model.editorPanel
        ZStack(alignment: .bottom) {
            NotePage(noteId: noteId, model: model, pageHost: pageHost, scrolled: $scrolled, titleFoot: $titleFoot)
                .ignoresSafeArea()
            PhoneNoteTopBar(
                title: meta?.title ?? "",
                place: place(meta),
                writing: editing,
                canShare: meta.map { $0.found && $0.access != "read" } ?? true,
                shared: false,
                scrolled: scrolled,
                titleFoot: titleFoot,
                back: back,
                openPlace: openPlace,
                share: { model.toast("Sharing comes to this screen soon.") },
                more: { showMenu(from: $0, meta: meta) },
                done: done
            )
            .frame(maxHeight: .infinity, alignment: .top)
            if editing, panel == nil, canEdit {
                PhoneKeyboardBar(state: PhoneKeyboardBarState(block: model.editorState?.block, link: model.editorState?.link ?? false, undo: model.editorState?.undo ?? false, redo: model.editorState?.redo ?? false), aiOn: model.aiOn, run: run)
                    .transition(.opacity)
            } else if !model.keyboardVisible, panel == nil {
                PhoneNoteToolBars(open: nativeTool ?? panel.flatMap { PhoneNoteTool(rawValue: $0.rawValue) }, canEdit: canEdit, aiOn: model.aiOn) { toggle($0) }
                    .padding(.bottom, max(10, safe.bottom - 10))
                    .ignoresSafeArea(.container, edges: .bottom)
                    .transition(.opacity.animation(.easeOut(duration: 0.16).delay(0.05)))
            }
        }
        .animation(.easeOut(duration: 0.12), value: editing)
        .background(FoleviTokens.Chrome.canvas.color)
        .onGeometryChange(for: EdgeInsets.self) { $0.safeAreaInsets } action: { safe = $0 }
        .onChange(of: insets) { _, i in sendInsets(i) }
        .onAppear {
            pageHost.adopt(by: NotePageRegistry.controller(for: noteId))
            model.show(noteId)
            KeyboardBridge.shared.setInteractiveDismiss(true)
            sendInsets(insets)
            // FOLEVI_REBUILD_SHEET=format or insert: that tool's sheet once the note is up (headless checks).
            if let t = ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SHEET"].flatMap(PhoneNoteTool.init(rawValue:)) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { nativeTool = t }
            }
            // FOLEVI_REBUILD_EDIT=style: a theme and a page colour through the engine, as the Style sheet sends them.
            if ProcessInfo.processInfo.environment["FOLEVI_REBUILD_EDIT"] == "style" {
                Task {
                    try? await Task.sleep(for: .seconds(3))
                    var paper = NoteStyleSetArgs(id: noteId)
                    paper.sheet = .set("paper")
                    _ = try? await model.client.command(.noteThemeSet(id: noteId, theme: "art-01"))
                    try? await Task.sleep(for: .seconds(1))
                    _ = try? await model.client.command(Commands.NoteStyleSet(paper))
                }
            }
            // FOLEVI_REBUILD_EDIT=1: an insert and a format.set through the engine, as the sheets send them.
            if ProcessInfo.processInfo.environment["FOLEVI_REBUILD_EDIT"] == "1" {
                Task {
                    try? await Task.sleep(for: .seconds(3))
                    var center = FormatSetArgs()
                    center.align = .center
                    center.textStyle = .subtitle
                    _ = try? await model.client.editor(.focus)
                    _ = try? await model.client.editor(.insert(kind: "quick-table-2x3"))
                    _ = try? await model.client.editor(.insert(kind: "text"))
                    _ = try? await model.client.editor(EditorCommands.FormatSet(center))
                }
            }
        }
        .phoneSheet(isPresented: Binding(get: { nativeTool == .format }, set: { if !$0 { nativeTool = nil } }), size: .fit) {
            PhoneSheetPanel(title: "Format", close: { nativeTool = nil }) {
                PhoneFormatSheetContent(state: formatState) { runFormat($0) }
            }
        }
        .phoneSheet(isPresented: Binding(get: { nativeTool == .insert }, set: { if !$0 { nativeTool = nil } }), size: .fit) {
            PhoneSheetPanel(title: "Insert", close: { nativeTool = nil }) {
                PhoneInsertSheetContent(scanner: DocumentScanner.cameraAvailable, stockPhotos: model.session.value?.mode != .local) { kind in
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    model.editor(.insert(kind: kind))
                    // The sheet steps aside to show what was added, as the web's does.
                    nativeTool = nil
                }
            }
        }
        .phoneSheet(isPresented: Binding(get: { nativeTool == .style }, set: { if !$0 { nativeTool = nil } }), size: .medium) {
            NoteStyleSheet(noteId: noteId, model: model) { nativeTool = nil }
        }
        .phoneSheet(isPresented: Binding(get: { nativeTool == .comments }, set: { if !$0 { nativeTool = nil } }), size: .medium) {
            PhoneSheetPanel(title: "Comments", close: { nativeTool = nil }) {
                PhoneCommentsSheetContent(state: commentsState) { runComments($0) }
            }
        }
        .alert(model.editorState?.link == true ? "Edit link" : "Add link", isPresented: $askingLink) {
            TextField("Paste or type a link", text: $linkText)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
            Button("Cancel", role: .cancel) { model.editor(.focus) }
            Button(model.editorState?.link == true ? "Update" : "Link") {
                let href = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
                model.editor(.link(href: href.isEmpty ? nil : href))
            }
        }
    }

    /// The bars' room over the page (points): the top bar; at the bottom the keyboard and the bar on it while
    /// writing, else the floating tool bars.
    private var insets: [Double] {
        let top = safe.top + 52
        let bottom: CGFloat = model.keyboardVisible ? model.keyboardOverlap + 48 + 8 : max(10, safe.bottom - 10) + 60 + 8
        return [Double(top.rounded()), Double(bottom.rounded())]
    }

    private func sendInsets(_ i: [Double]) {
        guard model.shownNote == noteId, i.count == 2 else { return }
        model.editor(.insets(top: i[0], bottom: i[1]))
    }

    private func place(_ meta: NoteMeta?) -> PhoneNotePlace? {
        guard let meta else { return nil }
        if let parent = meta.breadcrumbs.last { return .parent(title: parent.title) }
        if let folder = meta.folder { return .folder(name: folder.name, colorId: folder.color) }
        return meta.space == nil && meta.found ? .shared : .drafts
    }

    private func back() {
        // Back while writing: the keyboard goes first (what was typed is saved as always).
        if model.keyboardVisible { done() }
        frame.back()
    }

    private func done() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        model.editor(.dismissKeyboard)
        pageHost.pageView.endEditing(true)
    }

    private func openPlace() {
        let meta = model.noteMeta[noteId]
        if let parent = meta?.breadcrumbs.last {
            frame.open(.note(parent.id))
        } else if let folder = meta?.folder {
            frame.open(.folder(folder.id))
        } else {
            frame.open(.notes(.unsorted))
        }
    }

    private func toggle(_ tool: PhoneNoteTool) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if tool != .ai {
            nativeTool = nativeTool == tool ? nil : tool
            return
        }
        guard let panel = EditorPanel(rawValue: tool.rawValue) else { return }
        if model.editorPanel == panel { model.editor(.panelClose) } else { model.editor(.panelOpen(panel: panel)) }
    }

    private func run(_ key: PhoneKeyboardKey) {
        UISelectionFeedbackGenerator().selectionChanged()
        switch key {
        case .insert: nativeTool = .insert
        case .format: nativeTool = .format
        case .ai: model.editor(.panelOpen(panel: .ai))
        case .todo: model.editor(.format(block: .todo))
        case .indent: model.editor(.indent)
        case .outdent: model.editor(.outdent)
        case .link:
            linkText = ""
            askingLink = true
        case .mention: model.editor(.insert(kind: "mention"))
        case .image: model.editor(.insert(kind: "image"))
        case .undo: model.editor(.undo)
        case .redo: model.editor(.redo)
        case .hide: done()
        }
    }

    /// The note's comment threads for the Comments sheet (`note.tools`, revision 22's thread comments).
    private var commentsState: PhoneCommentsState {
        var st = PhoneCommentsState()
        guard let c = model.noteTools[noteId]?.comments else {
            st.loaded = false
            st.available = model.session.value?.mode != .local
            return st
        }
        st.available = c.available
        st.loaded = c.loaded
        st.canComment = c.canComment
        st.threads = c.threads.map { t in
            PhoneCommentsState.Thread(
                id: t.id, blockId: t.blockId, anchor: t.anchor, author: t.author, avatarUrl: t.avatarUrl, text: t.text, deleted: t.deleted, replies: t.replies,
                resolved: t.status == .resolved, resolvedBy: t.resolvedBy, unread: t.unread, lastActivityAt: Date(timeIntervalSince1970: Double(t.lastActivityAt) / 1000), waiting: t.waiting,
                comments: t.comments.map { PhoneCommentsState.Comment(id: $0.id, author: $0.author, avatarUrl: $0.avatarUrl, text: $0.text, deleted: $0.deleted, createdAt: Date(timeIntervalSince1970: Double($0.createdAt) / 1000)) },
                canResolve: t.canResolve, canDelete: t.canDelete
            )
        }
        return st
    }

    private func runComments(_ action: PhoneCommentsAction) {
        switch action {
        case .create(let text): model.perform { _ = try await model.client.command(.commentCreate(noteId: noteId, text: text)) }
        case .reply(let id, let text): model.perform { _ = try await model.client.command(.commentReply(threadId: id, text: text)) }
        case .open(let id):
            // A thread on a line opens in the note, under its line.
            nativeTool = nil
            model.editor(.threadOpen(threadId: id))
        case .resolve(let id, let on): model.perform { _ = try await model.client.command(.commentResolve(threadId: id, resolved: on)) }
        case .read(let id, let on): model.perform { _ = try await model.client.command(.commentRead(threadId: id, read: on)) }
        case .delete(let id): model.perform { _ = try await model.client.command(.commentDeleteThread(threadId: id)) }
        case .copyLink(let id):
            UIPasteboard.general.string = "https://app.folevi.com/d/\(noteId)#comment-\(id)"
            model.toast("Link copied")
        }
    }

    /// The line at the caret for the Format sheet (`editor.state` with its `format`, revision 21).
    private var formatState: PhoneFormatState {
        var f = PhoneFormatState()
        guard let s = model.editorState else { return f }
        f.canEdit = s.canEdit
        f.block = s.block
        f.marks = Set(s.marks.map(\.rawValue))
        f.link = s.link
        if let fmt = s.format {
            f.textStyle = fmt.textStyle?.rawValue
            f.textColor = fmt.textColor
            f.highlight = fmt.highlight
            f.align = fmt.align.rawValue
            f.group = fmt.group.rawValue
            f.decoration = fmt.decoration
            f.calloutTone = fmt.calloutTone?.rawValue
            f.codeLanguage = fmt.codeLanguage
            f.blockTools = fmt.blockTools
        }
        return f
    }

    private func runFormat(_ action: PhoneFormatAction) {
        UISelectionFeedbackGenerator().selectionChanged()
        var a = FormatSetArgs()
        switch action {
        case .mark(let m):
            if let mark = EditorMark(rawValue: m) { model.editor(.format(mark: mark)) }
            return
        case .block(let b):
            if let block = EditorBlock(rawValue: b) { model.editor(.format(block: block)) }
            return
        case .indent: return model.editor(.indent)
        case .outdent: return model.editor(.outdent)
        case .link:
            linkText = ""
            nativeTool = nil
            askingLink = true
            return
        case .removeLink: return model.editor(.link(href: nil))
        case .textStyle(let t): a.textStyle = TextStyleName(rawValue: t)
        case .group(let g): a.group = FormatSetArgs.Group(rawValue: g)
        case .align(let al): a.align = BlockAlign(rawValue: al)
        case .textColor(let c): a.textColor = c.map { .set($0) } ?? .clear
        case .highlight(let h): a.highlight = h.map { .set($0) } ?? .clear
        case .decoration(let d): a.decoration = d.map { .set($0) } ?? .clear
        case .clear: a.clear = true
        case .calloutTone(let t): a.calloutTone = CalloutTone(rawValue: t)
        case .codeLanguage(let l): a.codeLanguage = l
        }
        model.editor(EditorCommands.FormatSet(a))
    }

    /// "…": the note's actions, as the web's menu lists them (DocumentView's noteActions), where the page can run
    /// them; in Folevi's menu.
    private func showMenu(from anchor: CGRect, meta: NoteMeta?) {
        let canEdit = meta?.canEdit ?? true
        let full = canEdit && (meta.map { !["read", "comment"].contains($0.access) } ?? true)
        func page(_ title: String, _ icon: WebIcon, _ action: NoteMenuAction, danger: Bool = false) -> PhoneMenuEntry {
            PhoneMenuEntry(.item(title, icon: icon, danger: danger)) { model.editor(.noteMenu(action: action)) }
        }
        var entries: [PhoneMenuEntry] = []
        if let meta, meta.found, meta.space != nil {
            let starred = meta.starred
            entries.append(PhoneMenuEntry(.item(starred ? "Unstar" : "Star", icon: starred ? .starOff : .star)) { model.star(noteId, !starred) })
        }
        entries.append(page("Version history…", .rotateCcwClock, .history))
        entries.append(page(full ? "Find and replace…" : "Find in note…", .search, .find))
        if full { entries.append(page("Move…", .folderInput, .move)) }
        entries.append(page("Export…", .download, .export))
        entries.append(page("Present", .presentation, .present))
        var last: [PhoneMenuEntry] = []
        if full { last += [page("Duplicate", .copy, .duplicate), page("Copy to…", .copyPlus, .copyTo)] }
        if let meta, meta.found, full, meta.space != nil {
            let archived = meta.archived
            last.append(PhoneMenuEntry(.item(archived ? "Unarchive" : "Archive", icon: archived ? .archiveRestore : .archive)) { model.archive(noteId, !archived) })
        }
        if full { last.append(page("Move to Trash", .trash, .delete, danger: true)) }
        if !last.isEmpty {
            entries.append(PhoneMenuEntry(.separator(1)))
            entries += last
        }
        menus.show(entries, from: anchor, side: .bottom, align: .end)
    }
}

/// One controller per note on screen, holding the page view while it's that note's (a note further down the stack
/// keeps a still of itself until it's back on top).
@MainActor
enum NotePageRegistry {
    private static var controllers: [String: NotePageController] = [:]

    static func controller(for id: String) -> NotePageController {
        if let c = controllers[id] { return c }
        let c = NotePageController(noteId: id)
        controllers[id] = c
        return c
    }

    static func forget(_ id: String) { controllers[id] = nil }
}

/// Where the page view goes for one note: under a cover (the note's title on the canvas) until the page says the
/// note is drawn, so a zoom never shows a blank page or the previous note.
final class NotePageController: UIViewController, PageViewOwner {
    let noteId: String
    /// How far the note has scrolled and where its title ends (points, in the note's scroller).
    var onScroll: ((CGFloat, CGFloat) -> Void)?
    private var holder: PageViewHolder!
    private let cover = UIView()
    private var still: UIView?

    init(noteId: String) {
        self.noteId = noteId
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var pageViewContainer: UIView { holder.view }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Chrome.canvas
        holder = PageViewHolder.install(in: self)
        cover.backgroundColor = Chrome.canvas
        cover.frame = view.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.isUserInteractionEnabled = false
        view.addSubview(cover)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        holder?.match(view.safeAreaInsets)
    }

    func adopted(_ pageView: WKWebView) {
        guard PageScroll.shared.owner !== self else { return }
        PageScroll.shared.install(on: pageView)
        PageScroll.shared.owner = self
        // iOS 26 softens a scroll view's edges under bars; the note's bars are the web's, over a plain page.
        if #available(iOS 26.0, *) {
            pageView.scrollView.topEdgeEffect.isHidden = true
            pageView.scrollView.bottomEdgeEffect.isHidden = true
        }
        PageScroll.shared.ask(pageView)
    }

    func setReady(_ ready: Bool) {
        guard ready, !cover.isHidden || still != nil else { return }
        let s = still
        still = nil
        UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
            self.cover.alpha = 0
            s?.alpha = 0
        } completion: { _ in
            self.cover.isHidden = true
            s?.removeFromSuperview()
        }
    }

    func showCover() {
        cover.isHidden = false
        cover.alpha = 1
        cover.backgroundColor = still == nil ? Chrome.canvas : .clear
        view.bringSubviewToFront(cover)
    }

    func pageViewWillLeave(_ pageView: WKWebView) {
        if PageScroll.shared.owner === self { PageScroll.shared.owner = nil }
        guard still == nil, let s = pageView.snapshotView(afterScreenUpdates: false) else { return }
        s.frame = holder.view.bounds
        s.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        holder.view.addSubview(s)
        still = s
    }
}

/// The note's page in SwiftUI: its controller, adopting the page view, reporting how far it has scrolled and
/// lifting its cover once the page has drawn the note.
private struct NotePage: UIViewControllerRepresentable {
    let noteId: String
    let model: PhoneModel
    let pageHost: PageViewHost
    @Binding var scrolled: CGFloat
    @Binding var titleFoot: CGFloat

    func makeUIViewController(context: Context) -> NotePageController {
        let c = NotePageRegistry.controller(for: noteId)
        c.onScroll = { y, foot in
            if abs(scrolled - y) > 0.5 { scrolled = y }
            if abs(titleFoot - foot) > 0.5 { titleFoot = foot }
        }
        _ = c.view
        if !model.isReady(noteId) { c.showCover() }
        // The page has nothing to say after a second and a half (a note it can't load): show it as it is.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { c.setReady(true) }
        return c
    }

    func updateUIViewController(_ c: NotePageController, context: Context) {
        if pageHost.isOwned(by: c) { c.adopted(pageHost.pageView) }
        c.setReady(model.isReady(noteId) && model.shownNote == noteId)
    }
}

/// The note's scroll, from the page: the note scrolls in its own element (#doc-scroll), not the web view's scroll
/// view, so a script in the page reports how far it has scrolled and where the note's title ends, once a frame
/// while it moves, to the note on screen.
@MainActor
final class PageScroll: NSObject, WKScriptMessageHandler {
    static let shared = PageScroll()
    static let name = "foleviPageScroll"
    weak var owner: NotePageController?
    private var installed = Set<ObjectIdentifier>()

    private static let script = """
    (() => {
      if (window.__foleviPageScroll) return;
      let frame = 0;
      const send = () => {
        frame = 0;
        const s = document.getElementById("doc-scroll");
        if (!s) return;
        const t = s.querySelector("h1");
        // (Measured from the bar's foot: the page runs under the bar with the bar's room as its padding.)
        const top = s.getBoundingClientRect().top + (parseFloat(getComputedStyle(s).paddingTop) || 0);
        const foot = t ? t.getBoundingClientRect().bottom - top + s.scrollTop : 72;
        window.webkit.messageHandlers.\(PageScroll.name).postMessage({ y: s.scrollTop, foot });
      };
      window.__foleviPageScroll = send;
      document.addEventListener("scroll", () => { if (!frame) frame = requestAnimationFrame(send); }, { capture: true, passive: true });
    })();
    """

    func install(on v: WKWebView) {
        guard installed.insert(ObjectIdentifier(v)).inserted else { return }
        let ucc = v.configuration.userContentController
        ucc.add(self, contentWorld: .page, name: Self.name)
        ucc.addUserScript(WKUserScript(source: Self.script, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .page))
        v.evaluateJavaScript(Self.script, in: nil, in: .page)
    }

    /// Asks the page where the note is now (a note just shown starts at its top).
    func ask(_ v: WKWebView) {
        for delay in [0.0, 0.3, 0.8] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                v.evaluateJavaScript("window.__foleviPageScroll && window.__foleviPageScroll(); 0", in: nil, in: .page)
            }
        }
    }

    nonisolated func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        let y = (body["y"] as? NSNumber)?.doubleValue ?? 0
        let foot = (body["foot"] as? NSNumber)?.doubleValue ?? 72
        MainActor.assumeIsolated { owner?.onScroll?(CGFloat(y), CGFloat(foot)) }
    }
}

/// The Style sheet: the note's `note.style` while it's open, its choices sent back as `note.style.set` and
/// `note.theme.set`; All themes in a sheet of its own.
private struct NoteStyleSheet: View {
    let noteId: String
    let model: PhoneModel
    let close: () -> Void
    @State private var store: ValueStore<NoteStyleValue>?
    @State private var gallery = false

    var body: some View {
        let state = Self.state(store?.value)
        PhoneSheetPanel(title: "Style", close: close) {
            PhoneStyleSheetContent(state: state) { run($0) }
        }
        .onAppear { if store == nil { store = model.client.watch(.noteStyle(id: noteId)) } }
        .phoneSheet(isPresented: $gallery, size: .large) {
            PhoneSheetPanel(title: "All themes", close: { gallery = false }) {
                PhoneThemeGallery(state: state) { id in
                    gallery = false
                    run(.theme(id))
                }
            }
        }
    }

    static func state(_ v: NoteStyleValue?) -> PhoneStyleState {
        var s = PhoneStyleState()
        guard let v else { return s }
        s.canEdit = v.canEdit
        s.current = v.current
        s.styleName = v.styleName
        s.themeId = v.themeId
        s.ownImage = v.ownImage
        s.themes = v.themes.map { PhoneStyleState.Theme(id: $0.id, name: $0.name, thumb: $0.thumb, locked: $0.locked) }
        s.hasBackdrop = v.hasBackdrop
        s.blur = v.blur
        s.sheet = v.sheet
        s.text = v.text
        s.sheetColor = v.sheetColor
        s.textColor = v.textColor
        s.autoPaper = v.autoPaper
        s.autoInk = v.autoInk
        s.font = v.font
        s.separator = v.separator
        s.width = v.width
        s.sheets = v.sheets.map { PhoneStyleState.Choice(id: $0.id, name: $0.name, color: $0.color) }
        s.texts = v.texts.map { PhoneStyleState.Choice(id: $0.id, name: $0.name, color: $0.color) }
        s.fonts = v.fonts.map { PhoneStyleState.Choice(id: $0.id, name: $0.name) }
        s.separators = v.separators.map { PhoneStyleState.Choice(id: $0.id, name: $0.name) }
        return s
    }

    private func run(_ action: PhoneStyleAction) {
        UISelectionFeedbackGenerator().selectionChanged()
        var a = NoteStyleSetArgs(id: noteId)
        switch action {
        case .allThemes:
            gallery = true
            return
        case .theme(let id):
            model.perform { _ = try await model.client.command(.noteThemeSet(id: noteId, theme: id)) }
            return
        case .blur(let on): a.blur = on
        case .sheet(let id): a.sheet = id.map { .set($0) } ?? .clear
        case .text(let id): a.text = id.map { .set($0) } ?? .clear
        case .font(let f): a.font = f
        case .separator(let sep): a.separator = sep
        case .width(let w): a.width = w
        }
        model.perform { _ = try await model.client.command(Commands.NoteStyleSet(a)) }
    }
}
