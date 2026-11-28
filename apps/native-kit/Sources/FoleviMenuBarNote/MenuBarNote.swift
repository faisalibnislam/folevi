// What the Mac app holds: the menu bar note (owner decisions, 2026-11-28). The menu bar icon and the global shortcut
// open Home's quick note in a panel: write, Save, and it's a note in Drafts or the folder picked.
import AppKit

@MainActor
public final class MenuBarNote {
    public let model: MenuBarNoteModel
    let controller: PanelController

    public init(defaults: UserDefaults, host: any MenuBarNoteHost) {
        model = MenuBarNoteModel(settings: MenuBarNoteSettings(defaults: defaults))
        model.host = host
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

    /// Another place opened: its own note and destination.
    public func placeChanged() { model.placeChanged() }
}
