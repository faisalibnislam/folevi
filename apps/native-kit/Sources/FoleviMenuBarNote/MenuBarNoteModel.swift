// The menu bar note's state (owner decisions, 2026-11-28): Home's quick note under the menu bar. One plain text box;
// Save (⌘Return) makes a note of it in Drafts, or the folder picked (its first line the title, as on Home), with the
// screenshots taken, and the box empties, with Open and Undo. Add as a task makes the first line a task. What's
// written and not saved yet is kept per place; so is where notes go. Folevi itself is reached only through `host`.
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

    /// What's in the box (kept per place in `settings.drafts`).
    var text: String = "" {
        didSet { if text != oldValue { settings.drafts[place] = text.isEmpty ? nil : text } }
    }
    /// The screenshots that go with the note.
    var images: [MenuNoteImage] = []
    /// A save or a task on its way (the buttons wait).
    var busy = false
    /// Bumped to give the box the keyboard (the panel opening, after a save).
    var focusRequest = 0

    /// The spaces of the place and their folders, as the host last listed them (nil before the first answer).
    var spaces: [NoteSpace]?
    var spacesError: String?
    var toast: Toast?
    public internal(set) var isPanelVisible = false
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var loadedPlace: String?

    struct Toast: Equatable {
        struct Action: Equatable, Identifiable {
            let id = UUID()
            let title: String
            static func == (a: Action, b: Action) -> Bool { a.id == b.id }
        }
        let id = UUID()
        var message: String
        var actions: [Action] = []
    }
    @ObservationIgnored private var toastHandlers: [UUID: () -> Void] = [:]

    public init(settings: MenuBarNoteSettings) {
        self.settings = settings
    }

    private var place: String { host?.placeID ?? "default" }

    /// Something to save: words, or at least a screenshot.
    var canSave: Bool { !busy && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty) }
    var canAddTask: Bool { !busy && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The panel is showing: this place's unsaved words in the box, which takes the keyboard.
    func prepare() {
        if loadedPlace != place {
            loadedPlace = place
            text = settings.drafts[place] ?? ""
            images = []
        }
        focusRequest += 1
    }

    /// Another place opened: its own words and destination.
    public func placeChanged() {
        spaces = nil
        loadedPlace = nil
        if isPanelVisible { prepare(); refreshDestinations() }
    }

    // MARK: Save

    /// Save (⌘Return): a note of the box in the destination; the box empties, with Open and Undo.
    func save() {
        guard canSave, let host else { return }
        let destination = destination
        let payload = MenuNotePayload(destination: destination, text: text, images: images)
        let keptText = text, keptImages = images
        busy = true
        Task { [weak self] in
            do {
                let id = try await host.save(payload)
                guard let self else { return }
                self.busy = false
                self.text = ""
                self.images = []
                self.focusRequest += 1
                self.showToast("Saved to \(destination.label)", actions: [
                    ("Open", { [weak self] in self?.host?.openInFolevi(path: "/d/\(id)") }),
                    ("Undo", { [weak self] in self?.undoSave(id, text: keptText, images: keptImages) }),
                ], duration: 8)
            } catch {
                self?.busy = false
                self?.showToast(error.localizedDescription, duration: 8)
            }
        }
    }

    private func undoSave(_ id: String, text: String, images: [MenuNoteImage]) {
        self.text = text
        self.images = images
        focusRequest += 1
        guard let host else { return }
        Task { [weak self] in
            do {
                try await host.undoSave(noteID: id)
                self?.showToast("The note went to the Trash. Your words are back.")
            } catch {
                self?.showToast("Your words are back. Folevi couldn't move the note to the Trash: \(error.localizedDescription)", duration: 8)
            }
        }
    }

    /// Add as a task: the first line as a task where the note would go (Home's button).
    func addTask() {
        guard canAddTask, let host else { return }
        let destination = destination
        let value = text
        busy = true
        Task { [weak self] in
            do {
                try await host.addTask(value, space: destination.space)
                guard let self else { return }
                self.busy = false
                self.text = ""
                self.focusRequest += 1
                self.showToast("Task added", actions: [("Open Tasks", { [weak self] in self?.host?.openInFolevi(path: "/tasks") })], duration: 6)
            } catch {
                self?.busy = false
                self?.showToast(error.localizedDescription, duration: 8)
            }
        }
    }

    func removeImage(_ id: UUID) {
        images.removeAll { $0.id == id }
    }

    // MARK: Destination

    /// Where notes go: the one picked for this place (if it's still there), else Personal › Drafts.
    var destination: NoteDestination {
        let saved = settings.destinations[place]
        if let spaces, let saved { return saved.resolved(in: spaces) ?? .personalDrafts }
        return saved ?? .personalDrafts
    }

    func choose(_ destination: NoteDestination) {
        settings.destinations[place] = destination
        focusRequest += 1
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

    /// A screenshot for the note, the way macOS's own work: Screen Recording asked for once (ScreenshotService).
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
            return showToast("Allow Folevi under Screen Recording in System Settings, then take the screenshot again.", actions: [("Open Settings", { ScreenshotService.openPrivacySettings() })], duration: 10)
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
        images.append(MenuNoteImage(mime: encoded.type.preferredMIMEType ?? "image/png", name: name, data: encoded.data))
        focusRequest += 1
    }

    // MARK: Toast

    func showToast(_ message: String, actions: [(String, () -> Void)] = [], duration: TimeInterval = 5) {
        toastHandlers.removeAll()
        var toast = Toast(message: message)
        for (title, run) in actions {
            let action = Toast.Action(title: title)
            toast.actions.append(action)
            toastHandlers[action.id] = run
        }
        Motion.animate(Motion.spring) { self.toast = toast }
        NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                             userInfo: [.announcement: message, .priority: NSAccessibilityPriorityLevel.high.rawValue])
        toastTask?.cancel()
        let id = toast.id
        toastTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled, self?.toast?.id == id else { return }
            Motion.animate(Motion.fade) { self?.toast = nil }
        }
    }

    func perform(_ action: Toast.Action) {
        let run = toastHandlers[action.id]
        Motion.animate(Motion.fade) { toast = nil }
        run?()
    }

    func hidePanel() { panel?.hide() }
}

struct SendableImage: @unchecked Sendable {
    let image: CGImage
}
