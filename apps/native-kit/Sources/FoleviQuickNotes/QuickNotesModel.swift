// The quick notes' one observable state (Notlet's AppModel, made Folevi's): the dots, the active one, the editor, the
// toast and overlays, where a save goes, and every action the panel, its menus and its keys run. Local to this Mac
// (no iCloud: see PersistenceController). Folevi itself is reached only through `host`.
import AppKit
import Observation
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

typealias AppModel = QuickNotesModel

@MainActor
@Observable
public final class QuickNotesModel {
    public let settings: QuickNotesSettings
    @ObservationIgnored let persistence: PersistenceController
    @ObservationIgnored let store: NoteStore
    @ObservationIgnored let attachments: AttachmentStore
    @ObservationIgnored let editor = EditorController()
    @ObservationIgnored let screenshots = ScreenshotService()
    @ObservationIgnored public weak var host: (any QuickNotesHost)?

    var dots: [DotState] = []
    var activeDotID: UUID?
    var counts = TextCounts()
    var toast: Toast?
    var overlay: PanelOverlay?
    var footerHidden = false
    var hoveredDotID: UUID?
    public internal(set) var isPanelVisible = false
    /// Bumped when the menu bar icon should redraw (the active dot's colour).
    public internal(set) var iconRevision = 0

    /// The spaces of the place and their folders, as the host last listed them (nil before the first answer).
    var spaces: [QuickNoteSpace]?
    var spacesError: String?
    /// A save on its way (the button shows it and can't be pressed twice).
    var saving = false

    @ObservationIgnored weak var panel: PanelController?
    @ObservationIgnored private var dotModels: [UUID: Dot] = [:]
    @ObservationIgnored private var toastHandlers: [UUID: () -> Void] = [:]
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    static let hardCap = NoteStore.hardCap

    /// `folder` nil keeps everything in memory (tests).
    public init(settings: QuickNotesSettings, folder: URL?) {
        self.settings = settings
        persistence = PersistenceController(folder: folder)
        store = NoteStore(context: persistence.container.mainContext)
        attachments = AttachmentStore(store: store, container: persistence.container, cacheFolder: folder.map { $0.appendingPathComponent("Previews", isDirectory: true) })
        editor.model = self
        applySettingsToEditor()
        attachments.onThumbnail = { [weak self] id, image, pixels in
            self?.editor.thumbnailDidLoad(id: id, image: image, pixelSize: pixels)
        }
    }

    /// Loads (or seeds) the dots. Cheap: a dot's text is read when it's first shown.
    public func start() {
        reloadDots(store.prepare(defaultRichText: settings.defaultRichText))
        activeDotID = settings.activeDotID.flatMap { id in dots.contains { $0.id == id } ? id : nil } ?? dots.first?.id
        if persistence.recoveredStoreURL != nil {
            showToast("Folevi couldn't open the quick notes and started them fresh. The old ones were kept in a folder beside them.", symbol: "exclamationmark.triangle", duration: 12)
        }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(10))
            self?.store.collectGarbage(retentionDays: 30)
        }
    }

    func dotModel(_ id: UUID) -> Dot? { dotModels[id] }

    var activeDot: DotState? { dots.first { $0.id == activeDotID } }
    var activeIndex: Int? { dots.firstIndex { $0.id == activeDotID } }

    /// The active dot's colour (the menu bar icon shows it).
    public var activeColor: NSColor? { activeDot?.nsColor }
    public var hasDots: Bool { !dots.isEmpty }

    private func reloadDots(_ models: [Dot]? = nil) {
        let models = models ?? store.fetchDots()
        dotModels = Dictionary(models.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let old = Dictionary(dots.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var uncounted: [(UUID, String)] = []
        dots = models.enumerated().map { i, dot in
            let text = dot.note?.plainText ?? ""
            let page = editor.pages[dot.id]
            let isEmpty = page?.isEmpty ?? Self.isBlank(text)
            let updatedAt = dot.note?.updatedAt ?? dot.updatedAt
            let known = old[dot.id].flatMap { $0.updatedAt == updatedAt ? $0.wordCount : nil }
            if known == nil, !isEmpty { uncounted.append((dot.id, text)) }
            return DotState(id: dot.id, index: i, name: dot.name, colorID: DotColorID(rawValue: dot.colorID ?? ""),
                            customHex: dot.customColorHex, isEmpty: isEmpty, isRichText: dot.isRichText,
                            wordCount: known ?? old[dot.id]?.wordCount ?? 0, updatedAt: updatedAt)
        }
        iconRevision += 1
        if !uncounted.isEmpty {
            let pending = uncounted
            Task { [weak self] in
                let counts = await Task.detached(priority: .utility) { pending.map { ($0.0, TextCounter.count($0.1).words) } }.value
                for (id, words) in counts { self?.setWordCount(words, of: id) }
            }
        }
    }

    private func setWordCount(_ words: Int, of id: UUID) {
        guard let i = dots.firstIndex(where: { $0.id == id }), dots[i].wordCount != words else { return }
        dots[i].wordCount = words
    }

    nonisolated static func isBlank(_ text: String) -> Bool {
        !text.unicodeScalars.contains { !CharacterSet.whitespacesAndNewlines.contains($0) }
    }

    // MARK: Dots

    func selectDot(id: UUID, animated: Bool = true) {
        guard dots.contains(where: { $0.id == id }) else { return }
        let changed = activeDotID != id
        activeDotID = id
        settings.activeDotID = id
        editor.show(dotID: id, animated: animated && changed)
        if changed {
            iconRevision += 1
            NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                                 userInfo: [.announcement: activeDot?.accessibilityLabel ?? "", .priority: NSAccessibilityPriorityLevel.medium.rawValue])
        }
    }

    func selectDot(index: Int) {
        guard dots.indices.contains(index) else { return }
        selectDot(id: dots[index].id)
    }

    func selectNextDot() { step(1) }
    func selectPreviousDot() { step(-1) }

    private func step(_ delta: Int) {
        guard let i = activeIndex, !dots.isEmpty else { return }
        selectDot(index: (i + delta + dots.count) % dots.count)
    }

    func addDot() {
        guard dots.count < NoteStore.hardCap else {
            showToast("\(NoteStore.hardCap) quick notes is the most there can be.", symbol: "circle.grid.3x3")
            return
        }
        editor.flushAll()
        guard let dot = store.addDot(defaultRichText: settings.defaultRichText) else { return }
        Motion.animate { reloadDots() }
        selectDot(id: dot.id)
    }

    func requestDelete(_ id: UUID? = nil) {
        guard let id = id ?? activeDotID else { return }
        guard dots.count > 1 else {
            showToast("There's always at least one quick note.", symbol: "circle")
            return
        }
        overlay = .confirmDelete(id)
    }

    struct DeletedDot {
        var order: Int, name: String?, colorID: String?, customHex: String?, isRich: Bool
        var rtf: Data?, markdown: String, attachments: [(UUID, Data, String, String)]
    }

    func deleteDot(_ id: UUID) {
        overlay = nil
        guard dots.count > 1, let dot = dotModels[id] else { return }
        editor.flushAll()
        let snapshot = DeletedDot(order: dot.order, name: dot.name, colorID: dot.colorID, customHex: dot.customColorHex,
                                  isRich: dot.isRichText, rtf: dot.note?.rtfData, markdown: dot.note?.plainText ?? "",
                                  attachments: (dot.note?.attachments ?? []).compactMap { a in a.cloudAssetData.map { (a.id, $0, a.utType, a.filename) } })
        let wasActive = activeDotID == id
        let index = dots.firstIndex { $0.id == id } ?? 0
        editor.discardPage(id)
        store.delete(dot)
        Motion.animate { reloadDots() }
        if wasActive { selectDot(index: min(index, dots.count - 1)) }
        showToast("Quick note deleted", symbol: "trash", actions: [("Undo", { [weak self] in self?.restoreDeleted(snapshot) })], duration: 6)
    }

    private func restoreDeleted(_ s: DeletedDot) {
        guard let dot = store.addDot(defaultRichText: s.isRich) else { return }
        dot.name = s.name
        dot.colorID = s.colorID
        dot.customColorHex = s.customHex
        dot.isRichText = s.isRich
        for (id, data, type, name) in s.attachments { _ = store.addAttachment(to: dot, id: id, data: data, utType: type, filename: name) }
        store.updateNote(of: dot, rtf: s.rtf ?? Data(), markdown: s.markdown)
        store.move(from: dots.count, to: s.order)
        Motion.animate { reloadDots() }
        selectDot(id: dot.id)
    }

    func renameDot(_ id: UUID, to name: String) {
        guard let dot = dotModels[id] else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        dot.name = trimmed.isEmpty ? nil : String(trimmed.prefix(40))
        dot.updatedAt = .now
        store.save()
        reloadDots()
    }

    func setColor(_ id: UUID, colorID: DotColorID?, customHex: String? = nil) {
        guard let dot = dotModels[id] else { return }
        if let colorID { dot.colorID = colorID.rawValue }
        dot.customColorHex = customHex
        dot.updatedAt = .now
        store.save()
        Motion.animate { reloadDots() }
    }

    func moveDot(from source: Int, to destination: Int) {
        guard source != destination else { return }
        store.move(from: source, to: destination)
        Motion.animate { reloadDots() }
    }

    /// Moves the active dot one place left or right (keyboard reordering, VoiceOver's actions).
    func moveActiveDot(by delta: Int) {
        guard let i = activeIndex else { return }
        let to = i + delta
        guard dots.indices.contains(to) else { return }
        moveDot(from: i, to: to)
        let name = activeDot?.displayName ?? ""
        NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                             userInfo: [.announcement: "\(name) moved to place \(to + 1)", .priority: NSAccessibilityPriorityLevel.medium.rawValue])
    }

    // MARK: Text

    func toggleRichText(_ id: UUID? = nil) {
        guard let id = id ?? activeDotID, let dot = dotModels[id] else { return }
        let rich = !dot.isRichText
        dot.isRichText = rich
        store.save()
        editor.setRichText(rich, for: id)
        reloadDots()
        showToast(rich ? "Rich text" : "Plain text (Markdown)", symbol: rich ? "textformat" : "number")
    }

    func clearDot(_ id: UUID? = nil) {
        guard let id = id ?? activeDotID else { return }
        editor.replaceContents(of: id, with: NSAttributedString(), undoable: true, actionName: "Clear Text")
        showToast("Cleared. ⌘Z to undo.", symbol: "eraser")
    }

    func append(_ markdown: String, to id: UUID? = nil, atEnd: Bool = true) {
        guard let id = id ?? activeDotID, !markdown.isEmpty else { return }
        editor.insert(markdown: markdown, into: id, atEnd: atEnd)
        editor.flushAll()
    }

    func zoom(_ delta: Double?) {
        settings.fontSize = delta.map { min(36, max(9, settings.fontSize + $0)) } ?? 15
        applySettingsToEditor()
    }

    func applySettingsToEditor() {
        editor.applyStyle(settings.textStyle)
        editor.smartBulletsEnabled = settings.smartBullets
        editor.defaultDividerStyle = settings.dividerStyle
        editor.autoDetectLinks = settings.autoDetectLinks
        Motion.animationsEnabledSetting = settings.animatePopover
    }

    func presentLinkEditor(range: NSRange, url: String?, text: String) {
        overlay = .link(LinkRequest(range: range, url: url ?? "", text: text))
    }

    func applyLink(_ request: LinkRequest, url: String?) {
        overlay = nil
        var normalized = url?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let n = normalized, !n.isEmpty, !n.contains(":") { normalized = "https://" + n }
        editor.activeTextView?.applyLink(normalized, text: request.text, to: request.range)
        editor.focusEditor()
    }

    // MARK: From the editor

    func updateFillState(dotID: UUID, isEmpty: Bool) {
        guard let i = dots.firstIndex(where: { $0.id == dotID }), dots[i].isEmpty != isEmpty else { return }
        Motion.animate(Motion.quick) { dots[i].isEmpty = isEmpty }
        iconRevision += 1
    }

    func noteDidSave(dotID: UUID, markdown: String, rtf: Data?) {
        guard let i = dots.firstIndex(where: { $0.id == dotID }) else { return }
        dots[i].updatedAt = dotModels[dotID]?.note?.updatedAt ?? .now
        if dotID != editor.activePage?.dotID {
            let text = editor.pages[dotID]?.textView.string ?? markdown
            Task { [weak self] in
                let words = await Task.detached(priority: .utility) { TextCounter.count(text).words }.value
                self?.setWordCount(words, of: dotID)
            }
        }
    }

    func activeCountsDidChange(_ counts: TextCounts, dotID: UUID) {
        self.counts = counts
        setWordCount(counts.words, of: dotID)
    }

    /// The destination stays in sight while typing: the footer never hides.
    func typingDidContinue() {}
    func revealFooter() {}

    // MARK: Toasts

    func showToast(_ message: String, symbol: String? = nil, actions: [(String, () -> Void)] = [], duration: TimeInterval = 3.5) {
        toastHandlers.removeAll()
        var toast = Toast(message: message, symbol: symbol, duration: duration)
        for (title, handler) in actions {
            let action = Toast.Action(title: title)
            toast.actions.append(action)
            toastHandlers[action.id] = handler
        }
        Motion.animate(Motion.spring) { self.toast = toast }
        NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                             userInfo: [.announcement: message, .priority: NSAccessibilityPriorityLevel.high.rawValue])
        toastTask?.cancel()
        let id = toast.id
        toastTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled, let self, self.toast?.id == id else { return }
            Motion.animate(Motion.fade) { self.toast = nil }
        }
    }

    func performToastAction(_ action: Toast.Action) {
        let handler = toastHandlers[action.id]
        Motion.animate(Motion.fade) { toast = nil }
        handler?()
    }

    func dismissToast() { Motion.animate(Motion.fade) { toast = nil } }

    // MARK: Panel

    func showPanel() { panel?.show() }
    func hidePanel() {
        if overlay != nil { Motion.animate(Motion.fade) { overlay = nil }; return }
        panel?.hide()
    }

    /// Runs an app-modal panel (open, save, alerts) without the popover hiding underneath it.
    func runModalPanel(_ body: () -> Void) {
        panel?.suppressAutoHide += 1
        NSApp.activate()
        body()
        panel?.suppressAutoHide -= 1
    }

    // MARK: Drops

    func importFiles(_ urls: [URL], into dotID: UUID?) {
        guard let dotID = dotID ?? activeDotID else { return }
        var imported = 0
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let page = editor.page(for: dotID), let fragment = editor.fragment(forFile: url, rich: page.isRichText, dotID: dotID) else { continue }
            editor.insert(fragment: fragment, into: dotID, atEnd: true)
            imported += 1
        }
        editor.flushAll()
        if imported == 0 { showToast("Quick notes take text, Markdown, RTF and images.", symbol: "doc.badge.ellipsis") }
    }

    func handleDrop(_ providers: [NSItemProvider], into dotID: UUID) {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                _ = provider.loadObject(ofClass: URL.self, completionHandler: Self.onMain { [weak self] (url: URL) in self?.importFiles([url], into: dotID) })
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier, completionHandler: Self.onMain { [weak self] (data: Data) in
                    guard let self, let page = self.editor.page(for: dotID),
                          let fragment = self.editor.imageFragment(data: data, suggestedName: "Dropped Image", rich: page.isRichText, dotID: dotID) else { return }
                    self.editor.insert(fragment: fragment, into: dotID, atEnd: true)
                    self.editor.flushAll()
                })
            } else if provider.canLoadObject(ofClass: String.self) {
                _ = provider.loadObject(ofClass: String.self, completionHandler: Self.onMain { [weak self] (text: String) in self?.append(text, to: dotID) })
            }
        }
    }

    private nonisolated static func onMain<T: Sendable>(_ body: @escaping @MainActor @Sendable (T) -> Void) -> @Sendable (T?, (any Error)?) -> Void {
        { value, _ in
            guard let value else { return }
            Task { @MainActor in body(value) }
        }
    }

    // MARK: Screenshots

    /// A screenshot straight into the active dot (Notlet's permission-free picker route: no Screen Recording prompt).
    func capture(_ mode: ScreenshotService.Mode = .region) {
        Task { await performCapture(mode) }
    }

    func performCapture(_ mode: ScreenshotService.Mode) async {
        guard let panel else { return }
        let wasVisible = panel.isVisible
        if wasVisible {
            panel.hide()
            try? await Task.sleep(for: .milliseconds(220))
        }
        guard let image = await screenshots.capture(mode) else {
            if wasVisible { panel.show() }
            return
        }
        if settings.screenshotSound { ScreenshotService.playShutter() }
        var final = image
        if settings.screenshotDownscale, let screen = NSScreen.main {
            let maxWidth = screen.frame.width * 2
            if CGFloat(image.width) > maxWidth, let scaled = ImageEncoder.scaled(image, by: maxWidth / CGFloat(image.width)) { final = scaled }
        }
        let format = settings.screenshotFormat
        let sendable = SendableImage(image: final)
        guard let encoded = await Task.detached(priority: .userInitiated, operation: { ImageEncoder.encode(sendable.image, format: format) }).value else {
            showToast("Folevi couldn't keep that screenshot.", symbol: "exclamationmark.triangle")
            return
        }
        guard let dotID = activeDotID, let dot = dotModel(dotID) else { return }
        if !panel.isVisible { panel.show() }
        editor.show(dotID: dotID, animated: false)
        let name = "Screenshot \(Date.now.formatted(date: .abbreviated, time: .shortened))"
        let ext = encoded.type.preferredFilenameExtension ?? "png"
        let attachmentID = store.addAttachment(to: dot, data: encoded.data, utType: encoded.type.identifier, filename: "\(name).\(ext)")
        let rich = editor.activePage?.isRichText ?? true
        let fragment = editor.fragment(forAttachment: attachmentID, data: encoded.data, pixelSize: encoded.pixelSize, name: name, rich: rich)
        let line = NSMutableAttributedString(attributedString: fragment)
        line.append(NSAttributedString(string: "\n", attributes: editor.activeTextView?.baseAttributes() ?? [:]))
        editor.insertAtCursor(line)
        editor.flushAll()
        showToast("Screenshot added", symbol: "camera.viewfinder", actions: [("Copy", { [weak self] in self?.editor.copyImage(attachmentID: attachmentID) })], duration: 5)
    }

    // MARK: Destination

    /// Where a save goes now: the one picked for this place (if it's still there), else this place's Personal Drafts.
    var destination: QuickNoteDestination {
        let place = host?.placeID ?? "default"
        let saved = settings.destinations[place]
        if let spaces, let saved { return saved.resolved(in: spaces) ?? .personalDrafts }
        return saved ?? .personalDrafts
    }

    func choose(_ destination: QuickNoteDestination) {
        settings.destinations[host?.placeID ?? "default"] = destination
        editor.focusEditor()
    }

    /// Asks the host for the spaces and folders again (the panel opening, the destination menu opening).
    func refreshDestinations() {
        guard let host else { return }
        Task { [weak self] in
            do {
                let list = try await host.destinations()
                self?.spaces = list
                self?.spacesError = nil
            } catch {
                self?.spacesError = error.localizedDescription
            }
        }
    }

    // MARK: Save to note

    /// What would be saved from `dotID`: title, body with renamed image refs, and the images.
    func payload(for dotID: UUID) -> QuickNotePayload? {
        editor.flushAll()
        let markdown = editor.markdown(of: dotID)
        guard !Self.isBlank(markdown) else { return nil }
        let split = QuickNoteExport.split(markdown)
        let renamed = QuickNoteExport.renameImages(split.body)
        var images: [QuickNoteImage] = []
        for (ref, id) in renamed.ids {
            guard let a = store.attachment(id: id), let data = a.cloudAssetData else { continue }
            let mime = UTType(a.utType)?.preferredMIMEType ?? "image/png"
            images.append(QuickNoteImage(ref: ref, mime: mime, name: a.filename.isEmpty ? "Image" : a.filename, data: data))
        }
        return QuickNotePayload(destination: destination, title: split.title, markdown: renamed.markdown, images: images)
    }

    /// "Save to note": a new Folevi note from the active dot in the destination, then the dot is cleared (Undo puts
    /// the text back and the note in the Trash). Nothing is cleared unless the note was made.
    func saveToNote() {
        guard !saving, let dotID = activeDotID else { return }
        guard let host else { return showToast("Open Folevi to save quick notes.", symbol: "exclamationmark.triangle") }
        guard let payload = payload(for: dotID) else { return showToast("Write something first.", symbol: "square.and.pencil") }
        let before = editor.attributedText(of: dotID).map(NSAttributedString.init(attributedString:)) ?? NSAttributedString()
        let where_ = payload.destination.label
        saving = true
        Task { [weak self] in
            do {
                let noteID = try await host.save(payload)
                guard let self else { return }
                self.saving = false
                self.editor.replaceContents(of: dotID, with: NSAttributedString(), undoable: true, actionName: "Save to Note")
                self.editor.flushAll()
                self.showToast("Saved to \(where_)", symbol: "checkmark.circle", actions: [
                    ("Open", { [weak self] in self?.host?.openNote(noteID) }),
                    ("Undo", { [weak self] in self?.undoSave(noteID: noteID, dotID: dotID, text: before) }),
                ], duration: 8)
            } catch {
                self?.saving = false
                self?.showToast(error.localizedDescription, symbol: "exclamationmark.triangle", duration: 8)
            }
        }
    }

    private func undoSave(noteID: String, dotID: UUID, text: NSAttributedString) {
        if let page = editor.page(for: dotID) {
            let restored = page.isRichText ? text : NSAttributedString(string: AttributedMarkdown.markdown(from: text), attributes: TextStyler.plainAttributes(style: editor.textStyle))
            editor.replaceContents(of: dotID, with: restored, undoable: true, actionName: "Undo Save to Note")
            editor.flushAll()
        }
        selectDot(id: dotID, animated: false)
        guard let host else { return }
        Task { [weak self] in
            do {
                try await host.undoSave(noteID: noteID)
                self?.showToast("The text is back, and the note went to the Trash.", symbol: "arrow.uturn.backward")
            } catch {
                self?.showToast("The text is back. Folevi couldn't move the note to the Trash: \(error.localizedDescription)", symbol: "exclamationmark.triangle", duration: 8)
            }
        }
    }
}

struct SendableImage: @unchecked Sendable {
    let image: CGImage
}
