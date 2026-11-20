// The iPad's wide layout (FoleviMac's views on iOS): the Files app's stand-ins for the Mac's open and save panels,
// Settings > This device, and the frame's own right-click menu. iOS Simulator only.
//
//   FOLEVI_SCREENS_OUT=/dir   a picture of Settings > This device, light and dark
#if os(iOS)
import Foundation
import SwiftUI
import Testing
import UIKit
import UniformTypeIdentifiers
import WebKit
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviScreens
@testable import FoleviMac

/// The app's side of the frame, with a device lock (the iPad's) or without (the Mac's).
@MainActor
private final class LockHost: FrameHost {
    var lockOn = false
    var after = 0
    let hasLock: Bool
    init(hasLock: Bool) { self.hasLock = hasLock }

    func frameOpenSettings(section: String?) {}
    func frameSwitchPlace(_ place: String, space: String?) {}
    func frameSignInAnotherAccount() {}
    func frameSignOut(place: String) {}
    func frameSignOutConfirmed(place: String) {}
    func frameDownloadFile(_ id: String) {}
    func frameMoveOrCopy() {}
    func frameOpenHelp() {}
    func frameOpenExternal(_ url: URL) {}
    func frameOpenInNewWindow(_ route: FrameRoute) {}
    func frameStateChanged() {}
    var frameDeviceLock: FrameDeviceLock? {
        guard hasLock else { return nil }
        return FrameDeviceLock(state: { [unowned self] in (lockOn, after, "faceID") }, set: { [unowned self] on in lockOn = on }, setAfter: { [unowned self] in after = $0 })
    }
}

@Suite("iPad wide layout")
@MainActor
struct IPadWideLayoutTests {
    // MARK: Files

    @Test func fileNamesAreSafe() {
        #expect(FilePanelFiles.fileName("Folevi Vault recovery key.txt") == "Folevi Vault recovery key.txt")
        #expect(FilePanelFiles.fileName("a/b:c.md") == "a-b-c.md")
        #expect(FilePanelFiles.fileName("  ") == "Folevi file")
        #expect(FilePanelFiles.fileName(".hidden") == "Folevi file.hidden")
        // A save panel's type gives a name without one its extension.
        #expect(FilePanelFiles.fileName("Trip notes", type: UTType(filenameExtension: "md")) == "Trip notes.md")
        #expect(FilePanelFiles.fileName("Trip notes.md", type: .plainText) == "Trip notes.md")
        let long = FilePanelFiles.fileName(String(repeating: "x", count: 300) + ".zip")
        #expect(long.count <= 120 && long.hasSuffix(".zip"))
    }

    @Test func openPanelOffersWhatItWasAskedFor() {
        let files = NSOpenPanel()
        #expect(files.pickerTypes == [.item])
        files.allowedContentTypes = [.zip]
        #expect(files.pickerTypes == [.zip])
        let folder = NSOpenPanel()
        folder.canChooseFiles = false
        folder.canChooseDirectories = true
        #expect(folder.pickerTypes == [.folder])
    }

    @Test func aPickedFolderIsCopiedUnderItsOwnName() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("ipad-wide-\(UUID().uuidString)", isDirectory: true)
        let vault = root.appendingPathComponent("Vault", isDirectory: true)
        try fm.createDirectory(at: vault.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        try Data("# A".utf8).write(to: vault.appendingPathComponent("Notes/a.md"))
        try Data("b".utf8).write(to: vault.appendingPathComponent("b.txt"))
        defer { try? fm.removeItem(at: root) }

        let copy = try #require(FilePanelFiles.copyFolder(vault))
        defer { try? fm.removeItem(at: copy.deletingLastPathComponent()) }
        #expect(copy.lastPathComponent == "Vault")
        #expect(copy.deletingLastPathComponent() != vault.deletingLastPathComponent())
        // Import reads it as it reads a folder the Mac picked: paths from the folder's own name.
        let paths = DataSettings.files(inFolder: copy).map(\.1).sorted()
        #expect(paths == ["Vault/Notes/a.md", "Vault/b.txt"])
    }

    // MARK: Settings > This device

    @Test func thisDeviceIsListedWhereTheAppHasALock() {
        let frame = FrameModel(client: DemoEngine().client())
        let ipad = LockHost(hasLock: true)
        frame.host = ipad
        let settings = MacSettingsModel(frame: frame)
        // App lock sits right after Security (the owner, 2026-11-20); a local library has its lock in Library.
        let you = settings.groups.first?.items ?? []
        if let security = you.firstIndex(of: .security) {
            #expect(you[security + 1] == .thisDevice)
        } else {
            #expect(!you.contains(.thisDevice))
        }
        #expect(settings.shown(.thisDevice) == .thisDevice)
        #expect(MacSettingsSection(path: "/settings/this-device?screen=lock-after") == .thisDevice)

        let mac = LockHost(hasLock: false)
        frame.host = mac
        #expect(!settings.groups.flatMap(\.items).contains(.thisDevice))
        #expect(settings.shown(.thisDevice) != .thisDevice)
    }

    @Test func thisDeviceWords() {
        #expect(ThisDeviceSettingsView.label("faceID") == "Lock with Face ID")
        #expect(ThisDeviceSettingsView.label("touchID") == "Lock with Touch ID")
        #expect(ThisDeviceSettingsView.label("passcode") == "Lock with passcode")
        #expect(ThisDeviceSettingsView.description("none").hasSuffix("Set a passcode for this device in the Settings app first."))
        #expect(ThisDeviceSettingsView.description("faceID").hasSuffix("Turning it on asks for Face ID once."))
        #expect(!ThisDeviceSettingsView.description("faceID").contains("\u{2014}"))
    }

    @Test func thisDevicePicture() async {
        let host = LockHost(hasLock: true)
        host.lockOn = true
        host.after = 300
        let frame = FrameModel(client: DemoEngine().client())
        frame.host = host
        let settings = MacSettingsModel(frame: frame)
        for scheme in [ColorScheme.light, .dark] {
            let screen = ScreenHost(SettingsScreen(model: settings, section: .thisDevice), size: .ipad, scheme: scheme)
            await screen.settle()
            checkScreen(screen, named: "ipad-settings-this-device-\(scheme == .dark ? "dark" : "light")", reference: false)
            screen.close()
        }
    }

    // MARK: The frame's right-click menu

    @Test func secondaryClickMenuStaysOffFieldsAndThePage() {
        let frame = FrameModel(client: DemoEngine().client())
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 800, height: 600))
        let root = UIViewController()
        window.rootViewController = root
        window.isHidden = false
        defer { window.isHidden = true }
        let field = UITextField(frame: CGRect(x: 0, y: 0, width: 200, height: 40))
        let page = WKWebView(frame: CGRect(x: 0, y: 100, width: 200, height: 200))
        root.view.addSubview(field)
        root.view.addSubview(page)

        #expect(AppContextMenu.entries(at: CGPoint(x: 20, y: 20), in: window, model: frame) == nil)
        #expect(AppContextMenu.entries(at: CGPoint(x: 20, y: 200), in: window, model: frame) == nil)
        let entries = AppContextMenu.entries(at: CGPoint(x: 600, y: 400), in: window, model: frame) ?? []
        let items = entries.map(\.item).filter { $0.kind == .item }
        #expect(items.first?.title == "New note")
        #expect(items.first?.shortcut == "⌘N")
        #expect(items.contains { $0.title == "Search or jump to…" })
        #expect(items.contains { $0.title == "Back" } && items.contains { $0.title == "Forward" })
    }
}
#endif
