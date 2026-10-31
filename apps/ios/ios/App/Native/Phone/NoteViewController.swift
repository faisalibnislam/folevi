// A note on screen (plan 4.2 and 4.3): the Page View full width under a native bar that stays neutral whatever the
// note's colour. The bar: Back, the place chip (its parent page, folder or Drafts), Share and the "..." menu (a
// UIMenu with the note's actions: native commands for star and archive, the note page's own dialogs for the
// rest). While writing: Back (the keyboard goes first) and Done. At the bottom, Comments, Style and Format on the
// left and Foli AI and Insert on the right open the note's web panels; while the keyboard is up they give way to
// the keyboard toolbar. The bars' sizes go to the page (`insets`) so content and the caret stay clear of them.
//
// The note's content comes from the Page View the screen adopts when it appears. Until the page says the note is
// drawn (`note.ready`) a placeholder (or the still a note left when a link opened the next) covers it, so the
// zoom never shows a blank or the previous note.
import UIKit
import WebKit
import FoleviEngine
import FoleviDesign
import FoleviScreens

@MainActor
final class NoteViewController: UIViewController, PageViewOwner {
    let noteId: String
    let source: CardSource?
    private let model: PhoneModel
    private let pageHost: PageViewHost
    private weak var router: PhoneRouting?
    private var focusOnShow: Bool

    private var holder: PageViewHolder!
    private var content: UIView { holder.view }
    private let cover = UIView()
    private let coverTitle = UILabel()
    private var still: UIView?
    private let leftBar = GlassCapsule()
    private let rightBar = GlassCapsule()
    private let keyboardBar = KeyboardToolbar()
    private var observer: Observer?
    private var sentInsets: (top: CGFloat, bottom: CGFloat)?
    private var coverShown = true
    private var appeared = false
    private lazy var chip = PlaceChip { [weak self] in self?.openPlace() }
    private lazy var doneItem: UIBarButtonItem = {
        // Plain style in Folevi's semibold: iOS 26's prominent "done" fills the button with the tint, which would
        // put dark text on a dark capsule.
        let item = UIBarButtonItem(title: "Done", style: .plain, target: self, action: #selector(done))
        item.setTitleTextAttributes([.font: FoleviFonts.uiFont(.ui, size: 17, weight: .semibold), .foregroundColor: Chrome.heading], for: .normal)
        item.accessibilityIdentifier = "note-done"
        return item
    }()
    private lazy var shareItem: UIBarButtonItem = {
        let item = UIBarButtonItem(image: UIImage(systemName: "square.and.arrow.up"), style: .plain, target: self, action: #selector(share))
        item.accessibilityLabel = "Share"
        item.accessibilityIdentifier = "note-share"
        return item
    }()
    private lazy var moreItem: UIBarButtonItem = {
        let item = UIBarButtonItem(image: UIImage(systemName: "ellipsis"), menu: UIMenu(children: [UIDeferredMenuElement.uncached { [weak self] done in done(self?.menuItems() ?? []) }]))
        item.accessibilityLabel = "Note actions"
        item.accessibilityIdentifier = "note-more"
        return item
    }()

    var pageViewContainer: UIView { content }

    init(noteId: String, source: CardSource?, focus: Bool, model: PhoneModel, pageHost: PageViewHost, router: PhoneRouting?) {
        self.noteId = noteId
        self.source = source
        self.focusOnShow = focus
        self.model = model
        self.pageHost = pageHost
        self.router = router
        super.init(nibName: nil, bundle: nil)
        hidesBottomBarWhenPushed = true
        extendedLayoutIncludesOpaqueBars = true
        navigationItem.largeTitleDisplayMode = .never
        navigationItem.backButtonDisplayMode = .minimal
        navigationItem.titleView = chip
        navigationItem.rightBarButtonItems = [moreItem, shareItem]
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Chrome.canvas
        view.accessibilityIdentifier = "note-screen"
        holder = PageViewHolder.install(in: self)

        cover.backgroundColor = Chrome.canvas
        cover.frame = view.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.isUserInteractionEnabled = false
        coverTitle.font = FoleviFonts.uiFont(.display, size: 30, weight: .medium, relativeTo: .largeTitle)
        coverTitle.textColor = Chrome.heading
        coverTitle.numberOfLines = 2
        coverTitle.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(coverTitle)
        view.addSubview(cover)
        NSLayoutConstraint.activate([
            coverTitle.leadingAnchor.constraint(equalTo: cover.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            coverTitle.trailingAnchor.constraint(equalTo: cover.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            coverTitle.topAnchor.constraint(equalTo: cover.safeAreaLayoutGuide.topAnchor, constant: 28),
        ])

        buildBottomBars()
        keyboardBar.translatesAutoresizingMaskIntoConstraints = false
        keyboardBar.alpha = 0
        keyboardBar.isHidden = true
        keyboardBar.onCommand = { [weak self] in self?.run($0) }
        view.addSubview(keyboardBar)
        NSLayoutConstraint.activate([
            keyboardBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            keyboardBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            keyboardBar.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            keyboardBar.heightAnchor.constraint(equalToConstant: KeyboardToolbar.height),
        ])

        observer = Observer { [weak self] in self?.update() }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // A link back from the next note: the page view comes back here and shows this note again.
        pageHost.adopt(by: self)
        if still != nil || !model.isReady(noteId) || model.shownNote != noteId { showCover(animated: false) }
        model.show(noteId, focus: focusOnShow)
        focusOnShow = false
        KeyboardBridge.shared.setInteractiveDismiss(true)
        sentInsets = nil
        sendInsets()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        appeared = true
        update()
        // The page hasn't said the note is drawn after a second and a half (a note it can't load, a note made
        // somewhere else that hasn't arrived): show the page as it is rather than the placeholder for ever.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, self.coverShown, self.pageHost.isOwned(by: self) else { return }
            PhoneFrame.log.error("note.ready didn't come for \(self.noteId, privacy: .public) in 1.5 s")
            self.hideCover()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if immersive {
            immersive = false
            navigationController?.setNavigationBarHidden(false, animated: animated)
            navigationController?.interactivePopGestureRecognizer?.isEnabled = true
        }
        // Back while writing: the keyboard goes first (what was typed is saved as always).
        if isMovingFromParent || model.keyboardVisible {
            pageHost.pageView.endEditing(true)
            if model.keyboardVisible { model.editor(.dismissKeyboard) }
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        appeared = false
        if isMovingFromParent { KeyboardBridge.shared.setInteractiveDismiss(false) }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        holder?.match(view.safeAreaInsets)
        sendInsets()
    }

    // MARK: PageViewOwner

    func pageViewWillLeave(_ pageView: WKWebView) {
        // A still of this note stays while the next one has the page view (seen again on the way back).
        guard still == nil, let s = pageHost.still() else { return }
        s.frame = content.bounds
        s.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        content.addSubview(s)
        still = s
    }

    // MARK: State

    private func update() {
        let meta = model.noteMeta[noteId]
        chip.set(meta)
        if let meta, meta.found {
            coverTitle.text = meta.title.isEmpty ? "Untitled" : meta.title
            navigationItem.backButtonTitle = meta.title.isEmpty ? "Untitled" : meta.title
        }
        // Until the page knows the note (found), its tools stay as for an editable note rather than flicker.
        let canEdit = meta.map { $0.found ? $0.canEdit : true } ?? true
        let editing = model.editing && model.shownNote == noteId
        let panelOpen = model.editorPanel != nil
        // Writing: Done in place of Share and "…".
        let items: [UIBarButtonItem] = editing ? [doneItem] : (meta.map { $0.found && $0.access != "read" } ?? true ? [moreItem, shareItem] : [moreItem])
        if navigationItem.rightBarButtonItems != items { navigationItem.setRightBarButtonItems(items, animated: appeared) }

        // Focus Mode, or a block open full screen on the page (a mind map, a chart): the page alone, no bars,
        // and no edge swipe back (a finger drawing from the edge would leave the note).
        let immersive = model.editorState?.focus == true && model.shownNote == noteId
        setImmersive(immersive)
        let showKeyboardBar = editing && !panelOpen && canEdit && !immersive
        setKeyboardBar(visible: showKeyboardBar)
        keyboardBar.update(model.editorState, aiOn: model.aiOn)
        let showBars = !model.keyboardVisible && !panelOpen && !immersive
        setBottomBars(visible: showBars, canEdit: canEdit)

        if model.isReady(noteId), model.shownNote == noteId, coverShown { hideCover() }
        sendInsets()
    }

    private func showCover(animated: Bool) {
        coverShown = true
        cover.alpha = 1
        cover.isHidden = false
        view.bringSubviewToFront(cover)
        view.bringSubviewToFront(leftBar)
        view.bringSubviewToFront(rightBar)
        view.bringSubviewToFront(keyboardBar)
        // A still from before covers the page instead, when there is one.
        cover.backgroundColor = still == nil ? Chrome.canvas : .clear
        coverTitle.isHidden = still != nil
    }

    private func hideCover() {
        coverShown = false
        PhoneMetrics.openEnded(noteId, prepared: true)
        let s = still
        still = nil
        let fade = { self.cover.alpha = 0; s?.alpha = 0 }
        let done: (Bool) -> Void = { _ in
            self.cover.isHidden = true
            s?.removeFromSuperview()
        }
        if appeared {
            UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction], animations: fade, completion: done)
        } else {
            fade()
            done(true)
        }
    }

    // MARK: Bars

    private func buildBottomBars() {
        leftBar.row.addArrangedSubview(GlassCapsule.button(symbol: "bubble.left", label: "Comments", id: "note-comments") { [weak self] in self?.togglePanel(.comments) })
        leftBar.row.addArrangedSubview(GlassCapsule.button(symbol: "paintbrush", label: "Style", id: "note-style") { [weak self] in self?.togglePanel(.style) })
        leftBar.row.addArrangedSubview(GlassCapsule.button(symbol: "textformat", label: "Format", id: "note-format") { [weak self] in self?.togglePanel(.format) })
        rightBar.row.addArrangedSubview(GlassCapsule.button(symbol: "sparkle", label: "Foli AI", id: "note-ai", pointSize: 22) { [weak self] in self?.togglePanel(.ai) })
        let insert = GlassCapsule.plusButton(label: "Insert", id: "note-insert", target: 52, disc: 38)
        insert.addAction(UIAction { [weak self] _ in
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            self?.togglePanel(.insert)
        }, for: .touchUpInside)
        rightBar.row.addArrangedSubview(insert.slot)
        view.addSubview(leftBar)
        view.addSubview(rightBar)
        let bottom = view.safeAreaLayoutGuide.bottomAnchor
        NSLayoutConstraint.activate([
            leftBar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            rightBar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            leftBar.bottomAnchor.constraint(equalTo: bottom, constant: Self.barLift),
            rightBar.bottomAnchor.constraint(equalTo: bottom, constant: Self.barLift),
            leftBar.heightAnchor.constraint(equalToConstant: 60),
            rightBar.heightAnchor.constraint(equalToConstant: 60),
        ])
    }

    /// The bars sit just above the home indicator: 10 pt from the bottom edge where there's no indicator.
    private static var barLift: CGFloat { 10 }

    private func setBottomBars(visible: Bool, canEdit: Bool) {
        for (i, v) in leftBar.row.arrangedSubviews.enumerated() where i > 0 { v.isHidden = !canEdit }
        if let insert = rightBar.row.arrangedSubviews.last { insert.isHidden = !canEdit }
        rightBar.row.arrangedSubviews.first?.isHidden = !model.aiOn
        rightBar.isHidden = rightBar.row.arrangedSubviews.allSatisfy(\.isHidden)
        let alpha: CGFloat = visible ? 1 : 0
        guard leftBar.alpha != alpha else { return }
        leftBar.isUserInteractionEnabled = visible
        rightBar.isUserInteractionEnabled = visible
        UIView.animate(withDuration: visible ? 0.16 : 0.1, delay: visible ? 0.05 : 0, options: [.beginFromCurrentState]) {
            self.leftBar.alpha = alpha
            self.rightBar.alpha = alpha
        }
    }

    private var immersive = false

    private func setImmersive(_ on: Bool) {
        guard on != immersive, let nav = navigationController, nav.topViewController === self else { return }
        immersive = on
        nav.setNavigationBarHidden(on, animated: appeared)
        nav.interactivePopGestureRecognizer?.isEnabled = !on
    }

    private func setKeyboardBar(visible: Bool) {
        guard keyboardBar.isHidden == visible else { return }
        if visible { keyboardBar.isHidden = false }
        UIView.animate(withDuration: visible ? 0.12 : 0.1, delay: 0, options: [.beginFromCurrentState]) {
            self.keyboardBar.alpha = visible ? 1 : 0
        } completion: { _ in
            if !visible, self.keyboardBar.alpha == 0 { self.keyboardBar.isHidden = true }
        }
    }

    /// The bars' room over the page, in CSS pixels (points): the bar on top; at the bottom the keyboard and its
    /// toolbar while writing, else the floating buttons.
    private func sendInsets() {
        guard isViewLoaded, pageHost.isOwned(by: self), model.shownNote == noteId else { return }
        let top = view.safeAreaInsets.top
        let bottom: CGFloat
        if model.keyboardVisible {
            bottom = model.keyboardOverlap + (keyboardBar.isHidden ? 0 : KeyboardToolbar.height)
        } else {
            bottom = view.safeAreaInsets.bottom + 60 + Self.barLift + 8
        }
        if let s = sentInsets, abs(s.top - top) < 0.5, abs(s.bottom - bottom) < 0.5 { return }
        sentInsets = (top, bottom)
        model.editor(.insets(top: Double(top.rounded()), bottom: Double(bottom.rounded())))
    }

    // MARK: Actions

    private func togglePanel(_ panel: EditorPanel) {
        if model.editorPanel == panel { model.editor(.panelClose) } else { model.editor(.panelOpen(panel: panel)) }
    }

    private func run(_ c: KeyboardToolbar.Command) {
        switch c {
        case .insert: model.editor(.panelOpen(panel: .insert))
        case .checklist: model.editor(.format(block: .todo))
        case .block(let b): model.editor(.format(block: b))
        case .formatPanel: model.editor(.panelOpen(panel: .format))
        case .bold: model.editor(.format(mark: .bold))
        case .italic: model.editor(.format(mark: .italic))
        case .outdent: model.editor(.outdent)
        case .indent: model.editor(.indent)
        case .undo: model.editor(.undo)
        case .redo: model.editor(.redo)
        case .ai: model.editor(.ai(action: .open))
        case .hideKeyboard: done()
        }
    }

    @objc private func done() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        model.editor(.dismissKeyboard)
        pageHost.pageView.endEditing(true)
    }

    /// The native Share screen (people and the public link), FoleviScreens' ShareScreen.
    @objc private func share() { router?.share(noteId: noteId) }

    private func openPlace() {
        let meta = model.noteMeta[noteId]
        if let parent = meta?.breadcrumbs.last {
            router?.openNote(parent.id, source: nil, focus: false)
        } else if let folder = meta?.folder {
            router?.open(.folder(id: folder.id), source: nil)
        } else {
            router?.open(.notes(.unsorted), source: nil)
        }
    }

    private func menuItems() -> [UIMenuElement] {
        let meta = model.noteMeta[noteId]
        let canEdit = meta?.canEdit ?? true
        // Moving, copying, archiving and deleting need edit rights (a page shared to read or comment has none).
        let full = canEdit && meta.map { !["read", "comment"].contains($0.access) } ?? true
        func page(_ title: String, _ symbol: String, _ action: NoteMenuAction, destructive: Bool = false) -> UIAction {
            let a = UIAction(title: title, image: UIImage(systemName: symbol), attributes: destructive ? .destructive : []) { [weak self] _ in self?.model.editor(.noteMenu(action: action)) }
            a.accessibilityIdentifier = "note-menu-\(action.rawValue)"
            return a
        }
        var first: [UIMenuElement] = []
        if let meta, meta.found, meta.space != nil {
            let starred = meta.starred
            first.append(UIAction(title: starred ? "Unstar" : "Star", image: UIImage(systemName: starred ? "star.slash" : "star")) { [weak self] _ in
                guard let self else { return }
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self.model.star(self.noteId, !starred)
            })
        }
        if let meta, meta.found {
            first.append(UIAction(title: "Share", image: UIImage(systemName: "square.and.arrow.up")) { [weak self] _ in self?.share() })
        }
        if full {
            first.append(page("Move", "folder", .move))
            first.append(page("Copy to", "plus.square.on.square", .copyTo))
            first.append(page("Duplicate", "doc.on.doc", .duplicate))
        }
        let second: [UIMenuElement] = [
            page("Find in Note", "magnifyingglass", .find),
            page("Version History", "clock.arrow.circlepath", .history),
            page("Export", "square.and.arrow.down", .export),
            page("Present", "play.rectangle", .present),
            page("Print", "printer", .print),
        ]
        var last: [UIMenuElement] = []
        if let meta, meta.found, full, meta.space != nil {
            let archived = meta.archived
            last.append(UIAction(title: archived ? "Unarchive" : "Archive", image: UIImage(systemName: archived ? "tray.and.arrow.up" : "archivebox")) { [weak self] _ in
                guard let self else { return }
                self.model.archive(self.noteId, !archived)
            })
        }
        if canEdit && full { last.append(page("Delete", "trash", .delete, destructive: true)) }
        return [UIMenu(options: .displayInline, children: first), UIMenu(options: .displayInline, children: second), UIMenu(options: .displayInline, children: last)]
    }
}

// MARK: - The place chip

/// The note's place in the middle of its bar (web NotePlaceChip): its parent page, else its folder, else Drafts.
final class PlaceChip: UIControl {
    private let icon = UIImageView()
    private let label = UILabel()
    private let chevron = UIImageView(image: UIImage(systemName: "chevron.right", withConfiguration: UIImage.SymbolConfiguration(pointSize: 10, weight: .bold)))
    private let tap: () -> Void

    init(tap: @escaping () -> Void) {
        self.tap = tap
        super.init(frame: CGRect(x: 0, y: 0, width: 160, height: 32))
        backgroundColor = Chrome.surfaceSunken
        layer.cornerRadius = 16
        layer.cornerCurve = .continuous
        icon.tintColor = Chrome.inkMuted
        icon.contentMode = .scaleAspectFit
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)
        label.font = FoleviFonts.uiFont(.ui, size: 13, weight: .medium)
        label.textColor = Chrome.heading
        label.lineBreakMode = .byTruncatingTail
        chevron.tintColor = Chrome.inkFaint
        let row = UIStackView(arrangedSubviews: [icon, label, chevron])
        row.spacing = 5
        row.alignment = .center
        row.isUserInteractionEnabled = false
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -9),
            row.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightAnchor.constraint(equalToConstant: 32),
            widthAnchor.constraint(lessThanOrEqualToConstant: 220),
        ])
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        addAction(UIAction { [weak self] _ in self?.tap() }, for: .touchUpInside)
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityIdentifier = "note-place"
        set(nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func set(_ meta: NoteMeta?) {
        let text: String
        if let parent = meta?.breadcrumbs.last {
            text = parent.title.isEmpty ? "Untitled" : parent.title
            icon.image = UIImage(systemName: "doc.text")
        } else if let folder = meta?.folder {
            text = folder.name
            icon.image = UIImage(systemName: "folder")
        } else {
            text = meta?.space == nil && meta?.found == true ? "Shared with Me" : "Drafts"
            icon.image = UIImage(systemName: meta?.space == nil && meta?.found == true ? "person.2" : "tray")
        }
        guard label.text != text else { return }
        label.text = text
        accessibilityLabel = "In \(text)"
        invalidateIntrinsicContentSize()
        sizeToFit()
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.6 : 1 }
    }
}
