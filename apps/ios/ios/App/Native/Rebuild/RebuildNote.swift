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
                PhoneNoteToolBars(open: nil, canEdit: canEdit, aiOn: model.aiOn) { toggle($0) }
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
        guard let panel = EditorPanel(rawValue: tool.rawValue) else { return }
        if model.editorPanel == panel { model.editor(.panelClose) } else { model.editor(.panelOpen(panel: panel)) }
    }

    private func run(_ key: PhoneKeyboardKey) {
        UISelectionFeedbackGenerator().selectionChanged()
        switch key {
        case .insert: model.editor(.panelOpen(panel: .insert))
        case .format: model.editor(.panelOpen(panel: .format))
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
