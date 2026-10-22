// Folevi for Mac (docs/MAC_WEBKIT_PLAN.md): launch, folevi:// links, the Dock icon's reopen, and the first main
// window on the built-in interface. One app bundle is one instance (LaunchServices brings it forward); a Debug
// build is com.folevi.mac.dev with its own folder, Keychain names and folevi-dev:// links (Paths).
import AppKit
import WebKit

@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }

    /// The menu bar (WM2's MainMenu.swift sets this before launch finishes; until then a starter menu).
    static var buildMenu: () -> NSMenu = StarterMenu.build

    /// Runs once launch finished, before the first window (other packages' setup: WM1's places, WM2's status item,
    /// WM3's migration, which may hold the first window back by returning false).
    static var beforeFirstWindow: [() async -> Bool] = []

    private var launched = false
    private var pendingLinks: [URL] = []

    func applicationWillFinishLaunching(_ notification: Notification) {
        // folevi:// links, the one that opened the app included (it can come before launch finishes).
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:reply:)), forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
        // Decision M4: Folevi keeps its own tab strip, so the system's window tabs are off.
        NSWindow.allowsAutomaticWindowTabbing = false
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard !Paths.testing else { return }
        NSApp.setActivationPolicy(.regular)
        Offline.installIfAsked()
        NSApp.mainMenu = Self.buildMenu()
        #if DEBUG
        MacEval.install()
        #endif
        Task { @MainActor in
            await WebViewFactory.prepareRules()
            WebViewFactory.scheme.modeOf = { view in WindowManager.shared.modeOf((view as? FoleviWebView)?.place) }
            for step in Self.beforeFirstWindow { guard await step() else { return } }
            self.launched = true
            let first = self.pendingLinks
            self.pendingLinks = []
            // A link that opened the app opens its page directly; otherwise the start page.
            if let link = first.first, case .open(let path)? = Links.parseDeepLink(link.absoluteString) {
                WindowManager.shared.openMain(path: path)
                first.dropFirst().forEach(self.open)
            } else {
                WindowManager.shared.openMain()
                first.forEach(self.open)
            }
            NSApp.activate()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { WindowManager.shared.showMain() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: folevi:// links

    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let raw = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue, let url = URL(string: raw) else { return }
        if launched { open(url) } else { pendingLinks.append(url) }
    }

    /// What a link asks for: sign-in callbacks first (Links.handlers), then folevi://d/<id>, /new, /quick-add.
    func open(_ url: URL) {
        for handler in Links.handlers where handler(url) { return }
        switch Links.parseDeepLink(url.absoluteString) {
        case .open(let path)?: WindowManager.shared.showMain(path: path)
        case .newNote?:
            WindowManager.shared.showMain()
            if let view = WindowManager.shared.frontMain?.view { Events.command(["type": "new-note"], to: view) }
        case .quickAdd?:
            if let quickAdd = WindowManager.shared.quickAdd { quickAdd() } else { WindowManager.shared.showMain() }
        case nil:
            break
        }
    }
}

/// The menu bar until WM2's (MainMenu.swift): the app menu and Edit (copy and paste need it), Window.
enum StarterMenu {
    @MainActor
    static func build() -> NSMenu {
        let main = NSMenu()
        let name = ProcessInfo.processInfo.processName
        let app = NSMenu(title: name)
        app.addItem(withTitle: "About \(name)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Hide \(name)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit \(name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(withTitle: name, action: nil, keyEquivalent: "").submenu = app

        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(withTitle: "Edit", action: nil, keyEquivalent: "").submenu = edit

        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        main.addItem(withTitle: "Window", action: nil, keyEquivalent: "").submenu = window
        NSApp.windowsMenu = window
        return main
    }
}
