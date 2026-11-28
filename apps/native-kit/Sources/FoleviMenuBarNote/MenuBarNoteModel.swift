// The menu bar note's state (owner decisions, 2026-11-28): one real Folevi note at a time, in Folevi's own editor (the
// float page without its bar). Typing on the empty page makes a new note in the destination, Drafts by default; it
// syncs like any other note (the account, or an iCloud library). New starts another. The note shown and where new
// notes go are remembered per place. Folevi itself is reached only through `host`.
import AppKit
import Observation
import SwiftUI
import UniformTypeIdentifiers

@MainActor
@Observable
public final class MenuBarNoteModel {
    public let settings: MenuBarNoteSettings
    @ObservationIgnored public weak var host: (any MenuBarNoteHost)?
    @ObservationIgnored let screenshots = ScreenshotService()
    @ObservationIgnored weak var panel: PanelController?

    /// The spaces of the place and their folders, as the host last listed them (nil before the first answer).
    var spaces: [NoteSpace]?
    var spacesError: String?
    var toast: String?
    /// The toast's one button (Open Settings).
    @ObservationIgnored var toastAction: ToastAction?
    struct ToastAction {
        let title: String
        let run: () -> Void
    }
    public internal(set) var isPanelVisible = false
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    public init(settings: MenuBarNoteSettings) {
        self.settings = settings
    }

    private var place: String { host?.placeID ?? "default" }

    // MARK: Paths (pure: tests)

    /// The page of a note in the panel: the float page without its bar.
    nonisolated static func notePath(_ id: String) -> String {
        "/float/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))) ?? id)?panel=1"
    }

    /// The empty page that makes a note in `destination` once something is typed.
    nonisolated static func composerPath(_ destination: NoteDestination) -> String {
        var c = URLComponents()
        c.path = "/float/new"
        var items = [URLQueryItem(name: "panel", value: "1"), URLQueryItem(name: "space", value: destination.space)]
        if let folder = destination.folderId { items.append(URLQueryItem(name: "folder", value: folder)) }
        c.queryItems = items
        return c.string ?? "/float/new?panel=1"
    }

    /// The note a panel path shows, nil for the empty page or anything else.
    nonisolated static func noteID(inPath path: String) -> String? {
        guard let c = URLComponents(string: path), c.path.hasPrefix("/float/") else { return nil }
        let id = String(c.path.dropFirst("/float/".count))
        guard !id.isEmpty, id != "new", !id.contains("/") else { return nil }
        return id.removingPercentEncoding ?? id
    }

    // MARK: The note

    /// The note this place's panel shows, if one was made.
    var noteID: String? { settings.notes[place] }

    /// Loads this place's note (or the empty page) into the view, unless it shows it already.
    func prepareNote() {
        guard let host else { return }
        let want = noteID.map(Self.notePath) ?? Self.composerPath(destination)
        if let current = host.currentPath {
            if let id = noteID, Self.noteID(inPath: current) == id { return }
            if noteID == nil, current.hasPrefix("/float/new") { return }
        }
        host.load(path: want)
    }

    /// The view moved to another page: a new note was made by typing (its id is remembered for this place).
    public func pathChanged(_ path: String) {
        guard let id = Self.noteID(inPath: path), settings.notes[place] != id else { return }
        settings.notes[place] = id
    }

    /// New (⌘N): an empty page; typing on it makes a note in the destination.
    func newNote() {
        settings.notes[place] = nil
        host?.load(path: Self.composerPath(destination))
        host?.focusNote()
    }

    /// Send to Folevi (⌘↩): the note opens in Folevi's main window, and the panel starts a new empty note.
    func sendToFolevi() {
        guard let id = noteID, let host else { return showToast("Write something first.") }
        Task { [weak self] in
            guard await !host.noteIsEmpty() else { self?.showToast("Write something first."); return }
            host.flush()
            self?.newNote()
            host.openInFolevi(path: "/d/\(id)")
        }
    }

    /// The note in Folevi's main window.
    func openInFolevi() {
        guard let id = noteID else { return }
        host?.openInFolevi(path: "/d/\(id)")
    }

    /// The place changed: its own note and destination.
    public func placeChanged() {
        spaces = nil
        if isPanelVisible { prepareNote(); refreshDestinations() }
    }

    // MARK: Destination

    /// Where new notes go: the one picked for this place (if it's still there), else Personal › Drafts.
    var destination: NoteDestination {
        let saved = settings.destinations[place]
        if let spaces, let saved { return saved.resolved(in: spaces) ?? .personalDrafts }
        return saved ?? .personalDrafts
    }

    func choose(_ destination: NoteDestination) {
        settings.destinations[place] = destination
        // The empty page makes its note in the new place.
        if noteID == nil { host?.load(path: Self.composerPath(destination)) }
        host?.focusNote()
    }

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

    // MARK: Screenshots

    /// A screenshot into the note at the caret, the way macOS's own work: Screen Recording asked for once (ScreenshotService).
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
        let image: CGImage
        switch await screenshots.take(mode) {
        case .image(let taken): image = taken
        case .cancelled:
            if wasVisible { panel.show() }
            return
        case .needsPermission:
            panel.show()
            return showToast("Allow Folevi under Screen Recording in System Settings, then take the screenshot again.", action: ("Open Settings", { ScreenshotService.openPrivacySettings() }), duration: 10)
        }
        if settings.screenshotSound { ScreenshotService.playShutter() }
        var final = image
        if settings.screenshotDownscale, let screen = NSScreen.main {
            let maxWidth = screen.frame.width * 2
            if CGFloat(image.width) > maxWidth, let scaled = ImageEncoder.scaled(image, by: maxWidth / CGFloat(image.width)) { final = scaled }
        }
        let format = settings.screenshotFormat
        let sendable = SendableImage(image: final)
        if !panel.isVisible { panel.show() }
        guard let encoded = await Task.detached(priority: .userInitiated, operation: { ImageEncoder.encode(sendable.image, format: format) }).value else {
            return showToast("Folevi couldn't keep that screenshot.")
        }
        let name = "Screenshot \(Date.now.formatted(date: .abbreviated, time: .shortened)).\(encoded.type.preferredFilenameExtension ?? "png")"
        do {
            try await host?.insertImage(encoded.data, mime: encoded.type.preferredMIMEType ?? "image/png", name: name)
        } catch {
            showToast(error.localizedDescription)
        }
    }

    // MARK: Toast

    func showToast(_ message: String, action: (String, () -> Void)? = nil, duration: TimeInterval = 5) {
        toastAction = action.map { ToastAction(title: $0.0, run: $0.1) }
        Motion.animate(Motion.spring) { toast = message }
        NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                             userInfo: [.announcement: message, .priority: NSAccessibilityPriorityLevel.high.rawValue])
        toastTask?.cancel()
        toastTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            Motion.animate(Motion.fade) { self?.toast = nil }
        }
    }

    func hidePanel() { panel?.hide() }
}

struct SendableImage: @unchecked Sendable {
    let image: CGImage
}
