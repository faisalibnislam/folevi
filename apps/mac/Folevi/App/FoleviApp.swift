// Folevi: the app's scenes. Main windows (each a native window tab when the person or ⌘T asks), the
// Settings window, and the menu bar extra (Quick Add and recent notes). Every command is in the menu bar
// (AppCommands.swift).
import CoreSpotlight
import FoleviDesign
import FoleviEngine
import SwiftUI
import UserNotifications

@main
struct FoleviApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppModel.shared

    init() {
        AppLog.debug("init")
        FoleviFonts.register()
        AppDelegate.services = ServicesProvider.shared
        AppSetup.install()
    }

    var body: some Scene {
        WindowGroup("Folevi", id: "main", for: WindowSeed.self) { $seed in
            MainWindow(seed: seed)
                .environment(app)
                .task { await app.start() }
        } defaultValue: {
            WindowSeed(start: .home, asTab: false)
        }
        .windowToolbarStyle(.unified)
        .defaultSize(width: 1280, height: 820)
        .commands { AppCommands(app: app) }

        // A note floating above other windows (Note > Float on Top): just the note, always in front.
        WindowGroup("Note", id: "float", for: String.self) { $id in
            if let id { FloatingNote(id: id).environment(app) }
        }
        .windowLevel(.floating)
        .windowToolbarStyle(.unifiedCompact)
        .defaultSize(width: 460, height: 600)
        .commandsRemoved()

        Window("Folevi Help", id: "help") {
            HelpView()
        }
        .defaultSize(width: 640, height: 640)
        .commandsRemoved()

        Window("Keyboard Shortcuts", id: "shortcuts") {
            HelpView(section: "shortcuts")
        }
        .defaultSize(width: 640, height: 640)
        .commandsRemoved()

        Settings {
            SettingsView()
                .environment(app)
                .controlSize(.large)
                .task { await app.start() }
        }

    }
}

/// Launch wiring that isn't a view: the shared host's hooks into the app model.
@MainActor
enum AppSetup {
    static func install() {
        Capabilities.install()
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
        // Mac notifications offer Mark as Read beside opening them.
        UNUserNotificationCenter.current().setNotificationCategories(AppNotifications.categories)
        AppDelegate.onContinue = { activity in
            MainActor.assumeIsolated {
                if activity.activityType == CSSearchableItemActionType, let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String, let hit = Spotlight.parse(id) {
                    if hit.place != ShellPlaces.state.current, ShellPlaces.has(hit.place) { Places.shared.switchTo(hit.place, path: "/d/\(hit.note)") } else { AppModel.shared.open(.note(hit.note)) }
                    return true
                }
                if activity.activityType == "com.folevi.note", let id = activity.userInfo?["id"] as? String {
                    AppModel.shared.open(.note(id))
                    return true
                }
                if let url = activity.webpageURL { AppModel.shared.openLink(url); return true }
                return false
            }
        }
        // Places' switch: every window starts over in the new place.
        NotificationCenter.default.addObserver(forName: Places.switched, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { AppModel.shared.placeSwitched() }
        }
        DesktopHooks.onSettings = { next, previous in
            if next.openAtLogin != previous.openAtLogin { LoginItem.apply(next.openAtLogin) }
            if next.menuBarIcon != previous.menuBarIcon { StatusItem.shared.show(next.menuBarIcon) }
            if next.quickAddShortcut != previous.quickAddShortcut { QuickAdd.shared.register(next.quickAddShortcut) }
            if next.spotlight != previous.spotlight { Spotlight.shared.enabled = next.spotlight }
        }
        DesktopHooks.pauseShortcut = { QuickAdd.shared.paused = $0 }
        DesktopHooks.onRecent = {}
        AppDelegate.dockMenu = {
            let menu = NSMenu()
            menu.addItem(withTitle: "New Note", action: #selector(AppMenuActions.newNote(_:)), keyEquivalent: "").target = AppMenuActions.shared
            menu.addItem(withTitle: "Quick Add Task", action: #selector(AppMenuActions.quickAdd(_:)), keyEquivalent: "").target = AppMenuActions.shared
            menu.addItem(withTitle: "New Window", action: #selector(AppMenuActions.newWindow(_:)), keyEquivalent: "").target = AppMenuActions.shared
            if !DesktopHooks.recent.isEmpty {
                menu.addItem(.separator())
                for note in DesktopHooks.recent.prefix(5) {
                    let item = menu.addItem(withTitle: note.title.isEmpty ? "Untitled" : note.title, action: #selector(AppMenuActions.openNote(_:)), keyEquivalent: "")
                    item.representedObject = note.id
                    item.target = AppMenuActions.shared
                }
            }
            if let places = AppModel.shared.places.value, places.places.count > 1 {
                menu.addItem(.separator())
                let sub = NSMenu()
                for p in places.places {
                    let item = sub.addItem(withTitle: p.kind == .library ? "On This Mac" : p.name, action: #selector(AppMenuActions.switchPlace(_:)), keyEquivalent: "")
                    item.representedObject = p.id
                    item.state = p.id == places.current ? .on : .off
                    item.target = AppMenuActions.shared
                }
                menu.addItem(withTitle: "Places", action: nil, keyEquivalent: "").submenu = sub
            }
            return menu
        }
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            let w = AppModel.shared.front
            // Keys typed right after ⌘K, before the palette's field has the keyboard, go to it (never to the note).
            if let w, w.paletteShown, !w.paletteFieldReady, e.modifierFlags.intersection([.command, .control]).isEmpty, let chars = e.characters, !chars.isEmpty, chars.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) {
                w.paletteSeed += chars
                return nil
            }
            guard e.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, e.charactersIgnoringModifiers == "k",
                  let w, w.window?.isKeyWindow == true else { return e }
            if !w.paletteShown { w.paletteSeed = ""; w.paletteFieldReady = false }
            w.paletteShown.toggle()
            return nil
        }
        QuickAdd.shared.register(DesktopSettings.current.quickAddShortcut)
        StatusItem.shared.show(DesktopSettings.current.menuBarIcon)
        Updater.shared.start()
        Task { await AppNotifications.requestAuthorization() }
    }
}

/// Targets for AppKit menus (the Dock menu, Services).
@MainActor
final class AppMenuActions: NSObject {
    static let shared = AppMenuActions()

    @objc func newNote(_ sender: Any?) { NoteActions.newNote(app: .shared, window: AppModel.shared.front, newTab: AppModel.shared.front == nil) }
    @objc func quickAdd(_ sender: Any?) { QuickAdd.shared.show() }
    @objc func search(_ sender: Any?) {
        AppModel.shared.showAnyWindow()
        AppModel.shared.front?.paletteShown = true
    }
    @objc func openApp(_ sender: Any?) { AppModel.shared.showAnyWindow() }
    @objc func settings(_ sender: Any?) { SettingsRouter.shared.open(nil) }
    @objc func newWindow(_ sender: Any?) { AppModel.shared.openWindow?(.home, false, false); NSApp.activate() }
    @objc func switchPlace(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Places.shared.switchTo(id)
        AppModel.shared.showAnyWindow()
    }
    @objc func openNote(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        AppModel.shared.open(.note(id))
    }
}

/// The menu bar icon: Quick Add, a new note, the recent notes, Folevi's windows (Settings > This Mac turns
/// it off). An AppKit status item, so its menu is built fresh each time it opens.
@MainActor
final class StatusItem: NSObject, NSMenuDelegate {
    static let shared = StatusItem()
    private var item: NSStatusItem?

    func show(_ on: Bool) {
        guard !Paths.testing else { return }
        if !on {
            if let item { NSStatusBar.system.removeStatusItem(item) }
            item = nil
            return
        }
        guard item == nil else { return }
        let i = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        // Folevi's F, a template image the system tints (packages/design-tokens/scripts/brand-icons.mjs makes it).
        let mark = NSImage(named: "StatusItemTemplate") ?? NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: nil)
        mark?.isTemplate = true
        mark?.accessibilityDescription = "Folevi"
        i.button?.image = mark
        let menu = NSMenu()
        menu.delegate = self
        i.menu = menu
        item = i
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let a = AppMenuActions.shared
        let qa = menu.addItem(withTitle: "Quick Add Task…", action: #selector(AppMenuActions.quickAdd(_:)), keyEquivalent: "")
        qa.target = a
        let shortcut = DesktopSettings.current.quickAddShortcut
        if !shortcut.isEmpty { qa.toolTip = HotKey.display(shortcut) }
        menu.addItem(withTitle: "Search Folevi…", action: #selector(AppMenuActions.search(_:)), keyEquivalent: "").target = a
        menu.addItem(withTitle: "New Note", action: #selector(AppMenuActions.newNote(_:)), keyEquivalent: "").target = a
        if !DesktopHooks.recent.isEmpty {
            menu.addItem(.separator())
            menu.addItem(NSMenuItem.sectionHeader(title: "Recent"))
            for (i, note) in DesktopHooks.recent.prefix(8).enumerated() {
                let item = menu.addItem(withTitle: note.title.isEmpty ? "Untitled" : note.title, action: #selector(AppMenuActions.openNote(_:)), keyEquivalent: "\(i + 1)")
                item.representedObject = note.id
                item.target = a
            }
        }
        MainActor.assumeIsolated {
            let app = AppModel.shared
            if let places = app.places.value, places.places.count > 1 {
                menu.addItem(.separator())
                let sub = NSMenu()
                for p in places.places {
                    let item = sub.addItem(withTitle: p.kind == .library ? "On This Mac" : p.name, action: #selector(AppMenuActions.switchPlace(_:)), keyEquivalent: "")
                    item.representedObject = p.id
                    item.state = p.id == places.current ? .on : .off
                    item.target = a
                }
                let placesItem = menu.addItem(withTitle: "Places", action: nil, keyEquivalent: "")
                placesItem.submenu = sub
            }
            if let sync = app.sync.value {
                menu.addItem(.separator())
                let status = menu.addItem(withTitle: sync.label, action: nil, keyEquivalent: "")
                status.isEnabled = false
            }
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open Folevi", action: #selector(AppMenuActions.openApp(_:)), keyEquivalent: "").target = a
        menu.addItem(withTitle: "Settings…", action: #selector(AppMenuActions.settings(_:)), keyEquivalent: ",").target = a
        menu.addItem(withTitle: "Quit Folevi", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    }
}

/// Clicking a Mac notification opens what it's about in the app.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let action = response.actionIdentifier
        if action != UNNotificationDefaultActionIdentifier, action != UNNotificationDismissActionIdentifier, action != "open" {
            // Reply, mark as read, complete, snooze: the page does them (the command today's app sends).
            var command: [String: Any] = ["type": "notification", "action": action, "id": info["id"] as? String ?? "", "kind": info["kind"] as? String ?? ""]
            if let path = info["path"] as? String { command["path"] = path }
            if let text = (response as? UNTextInputNotificationResponse)?.userText, !text.isEmpty { command["text"] = String(text.prefix(4000)) }
            if let thread = info["commentThread"] as? String, !thread.isEmpty { command["thread"] = thread }
            let sendable = command.mapValues { "\($0)" }
            await MainActor.run {
                if let view = PagePool.shared.engine?.view { Events.command(sendable, to: view) }
            }
            return
        }
        if action == UNNotificationDismissActionIdentifier { return }
        let path = info["path"] as? String ?? "/notifications"
        let place = info["place"] as? String ?? ""
        await MainActor.run {
            if !place.isEmpty, place != ShellPlaces.state.current, ShellPlaces.has(place) {
                Places.shared.switchTo(place, path: path)
            } else {
                AppModel.shared.open(path: path)
            }
            NSApp.activate()
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // In front: reminders still show; activity is in Notifications.
        let kind = notification.request.content.userInfo["kind"] as? String ?? ""
        return kind == "local-reminder" || notification.request.content.categoryIdentifier == "folevi.reminder" ? [.banner, .sound, .list] : []
    }
}
