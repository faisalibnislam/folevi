// WM5's pieces in WM2's menu bar (Chrome.swift's hooks): File > Share ▸ lists the services that take the key
// window's note, and File > Print… (⌘P) prints the open note in its print layout (Sharing.swift).
import AppKit

@MainActor
enum ChromeHooks {
    static func install() {
        Chrome.print = { view in Task { @MainActor in await Sharing.printNote(view) } }
        Chrome.shareItems = { view in Sharing.menuItems(for: view) }
        MainMenu.shared.refreshShare()
    }
}
