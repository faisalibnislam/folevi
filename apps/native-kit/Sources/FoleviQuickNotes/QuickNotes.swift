// What the Mac app holds: the quick notes (their store, model and panel), shown from the menu bar icon and the
// global shortcut. Owner decisions, 2026-11-28: Notlet's menu bar scratchpad of coloured dots, inside Folevi; each
// dot is a local quick note on this Mac; "Save to note" makes it a Folevi note in the chosen workspace and folder.
import AppKit

@MainActor
public final class QuickNotes {
    public let model: QuickNotesModel
    let controller: PanelController

    /// `folder`: where the quick notes live (the build's own support folder); nil keeps them in memory.
    public init(defaults: UserDefaults, folder: URL?, host: any QuickNotesHost) {
        let settings = QuickNotesSettings(defaults: defaults)
        model = QuickNotesModel(settings: settings, folder: folder)
        model.host = host
        model.start()
        controller = PanelController(model: model)
        model.panel = controller
    }

    /// The menu bar icon's frame on screen: the panel opens under it.
    public var anchor: () -> NSRect? {
        get { controller.anchor }
        set { controller.anchor = newValue }
    }

    /// Called when the panel shows or goes (the icon's highlight).
    public var onShownChange: (Bool) -> Void {
        get { controller.onShownChange }
        set { controller.onShownChange = newValue }
    }

    public var isVisible: Bool { controller.isVisible }

    public func show() {
        model.refreshDestinations()
        controller.show()
    }

    public func hide() { controller.hide() }

    public func toggle() {
        if !controller.isVisible { model.refreshDestinations() }
        controller.toggle()
    }

    /// Builds the panel while idle, so the first open is quick.
    public func prewarm() { controller.prewarm() }

    /// Writes every open quick note now (the app quitting, going to sleep).
    public func flush() { model.editor.flushAll() }

    /// The place changed (another account or library opened): its destinations are listed again.
    public func placeChanged() {
        model.spaces = nil
        if controller.isVisible { model.refreshDestinations() }
    }
}
