// The few things the shared Shell services (this folder) need from the system that differ between the iPhone and
// iPad app (UIKit) and the native Mac app (AppKit, apps/mac, docs/MAC_WEBKIT_PLAN.md §4.2): the device's words
// and name, where the app keeps its files and Keychain items, whether the app is in front, a write that may finish
// in the background, and the window a sheet or picker is shown over. Each shared file then needs one `#if` at most
// (its import). The iOS answers are exactly what those files did before; the Mac's come from apps/mac Paths.swift.
import Foundation
import LocalAuthentication
#if os(iOS)
import UIKit
#else
import AppKit
import AuthenticationServices
import SystemConfiguration
import UniformTypeIdentifiers
#endif

#if os(iOS)
/// The window a sign-in sheet attaches to.
typealias PlatformWindow = UIWindow
/// What a file or folder picker is shown from.
typealias PlatformPresenter = UIViewController
#else
typealias PlatformWindow = NSWindow
typealias PlatformPresenter = NSWindow
#endif

enum Platform {
    #if os(iOS)
    /// "iPhone", "iPad" or "Mac", for "On My iPad", "On this iPhone".
    static var deviceLabel: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    /// The name people gave the device ("Faisal's iPhone"), or its kind.
    static var deviceName: String {
        let name = UIDevice.current.name
        return name.isEmpty ? deviceLabel : name
    }

    /// Application Support/Folevi: library.json, places.json, the cloud libraries' copies.
    static var supportFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Folevi", isDirectory: true)
    }

    /// Where a library "on this device" lives (the app's Documents, "On My iPhone" in the Files app).
    static var documentsFolder: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    /// The Keychain service a shared service's name stands for (the same on iOS).
    static func keychainService(_ service: String) -> String { service }

    /// Where the shared services keep their small settings (the mode, the Face ID switch, shown reminders).
    static var defaults: UserDefaults { .standard }

    /// Whether the app is in front. Main thread only.
    static var isActive: Bool { UIApplication.shared.applicationState == .active }

    /// Posted when the app comes back to the front.
    static var didBecomeActive: Notification.Name { UIApplication.didBecomeActiveNotification }

    typealias BackgroundWork = UIBackgroundTaskIdentifier

    /// Asks for time to finish `name` if the app goes to the background meanwhile. Not on the main thread.
    static func beginBackgroundWork(_ name: String) -> BackgroundWork {
        var task = UIBackgroundTaskIdentifier.invalid
        DispatchQueue.main.sync { task = UIApplication.shared.beginBackgroundTask(withName: name) {} }
        return task
    }

    static func endBackgroundWork(_ task: BackgroundWork) {
        DispatchQueue.main.async { if task != .invalid { UIApplication.shared.endBackgroundTask(task) } }
    }

    /// Where Dropbox sends a sign-in back (registered in the Dropbox App Console); the sign-in sheet catches it.
    static let dropboxRedirect = "com.folevi.ios://oauth/dropbox"

    /// The words E2eeKeys says things in, and its device ids' start ("ios-<ulid>").
    static let e2ee = E2eeWords(idPrefix: "ios", cantKeep: "This device can't keep encryption keys safely right now.", noKeys: "This device has no encryption keys yet.",
                                noCheck: "This device has no Face ID or passcode set up.", notConfirmed: "Face ID didn't confirm it.")

    /// Whether the owner can be asked before encrypted notes open (Face ID, Touch ID or Optic ID, else the passcode).
    static var canAskOwner: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    /// How a library's folder reads for people when the platform says it its own way (nil: LibraryService's words).
    static func libraryPlace(_ url: URL) -> String? { nil }
    #else
    static var deviceLabel: String { "Mac" }

    /// The Mac's name in System Settings > General > Sharing (Electron read `scutil --get ComputerName`).
    static var deviceName: String {
        let name = (SCDynamicStoreCopyComputerName(nil, nil) as String?) ?? Host.current().localizedName ?? ""
        return name.isEmpty ? deviceLabel : name
    }

    /// The build's own support folder (Folevi, or Folevi Dev, or FOLEVI_USER_DATA): never another build's.
    static var supportFolder: URL { Paths.supportFolder }

    /// A library "on this Mac" lives under the support folder until the Mac decides otherwise (WM1).
    static var documentsFolder: URL { Paths.documentsFolder }

    /// "com.folevi.e2ee" becomes this build's own ("com.folevi.dev.e2ee" for Debug builds).
    static func keychainService(_ service: String) -> String { Paths.keychainService(service) }

    /// This build's own settings (a test run with FOLEVI_USER_DATA gets its own).
    static var defaults: UserDefaults { Paths.defaults }

    static var isActive: Bool { NSApplication.shared.isActive }

    static var didBecomeActive: Notification.Name { NSApplication.didBecomeActiveNotification }

    typealias BackgroundWork = NSObjectProtocol

    /// A Mac app isn't suspended; this only keeps the system from idling the work away (App Nap).
    static func beginBackgroundWork(_ name: String) -> BackgroundWork {
        ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled], reason: name)
    }

    static func endBackgroundWork(_ work: BackgroundWork) {
        ProcessInfo.processInfo.endActivity(work)
    }

    /// Dropbox's sign-in comes back on folevi:// (every build: the sign-in sheet catches it, nothing else sees it).
    static let dropboxRedirect = "folevi://oauth/dropbox"

    /// Electron's e2ee.ts words, and its device ids ("mac-<ulid>"), so the server sees the same kind of Mac.
    static let e2ee = E2eeWords(idPrefix: "mac", cantKeep: "This Mac can't keep encryption keys safely right now.", noKeys: "This Mac has no encryption keys yet.",
                                noCheck: "This Mac has no Touch ID, or it isn't set up.", notConfirmed: "Touch ID didn't confirm it.")

    /// Touch ID only, as Electron's canPromptTouchID: a Mac without it doesn't offer "Ask for Touch ID".
    static var canAskOwner: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) }

    /// Electron's displayPath (apps/desktop/src/library/locations.ts): "iCloud Drive › Folevi", "Dropbox › Notes",
    /// "~/Documents/Folevi Library", or the path itself.
    static func libraryPlace(_ url: URL) -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        let inside = { (dir: String) in path == dir || path.hasPrefix(dir + "/") }
        let rest = { (dir: String) in path.dropFirst(dir.count).split(separator: "/").map(String.init) }
        let drive = home + "/Library/Mobile Documents/com~apple~CloudDocs"
        if inside(drive) { return (["iCloud Drive"] + rest(drive)).joined(separator: " › ") }
        let container = home + "/Library/Mobile Documents/iCloud~com~folevi/Documents"
        if inside(container) { return (["iCloud Drive", "Folevi"] + rest(container)).joined(separator: " › ") }
        let cloud = home + "/Library/CloudStorage"
        if inside(cloud) {
            var parts = rest(cloud)
            let first = parts.isEmpty ? "" : parts.removeFirst()
            let names: [(String, String)] = [("^Dropbox(-.*)?$", "Dropbox"), ("^GoogleDrive-.+$", "Google Drive"), ("^OneDrive(-.*)?$", "OneDrive"), ("^Box(-.*)?$", "Box")]
            let name = names.first { first.range(of: $0.0, options: .regularExpression) != nil }?.1 ?? (first.isEmpty ? "Cloud storage" : first)
            return ([name] + parts).joined(separator: " › ")
        }
        if inside(home) { return "~/" + rest(home).joined(separator: "/") }
        return path
    }
    #endif
}

/// What E2eeKeys says, in the platform's words (Platform.e2ee).
struct E2eeWords {
    let idPrefix: String
    let cantKeep: String
    let noKeys: String
    let noCheck: String
    let notConfirmed: String
}

/// Dropbox's redirect scheme (the sign-in sheet's callback scheme).
extension Platform {
    static var dropboxScheme: String { URL(string: dropboxRedirect)?.scheme ?? "folevi" }
}

#if os(macOS)
// The Mac's twins of iOS-only helpers the shared services use (on iOS: Native/NativeServices.swift and
// ShellServices.swift), with the same names and calls.

/// The sign-in sheet on show (kept alive while it's up) and the window it attaches to.
@MainActor final class SignInSheet: NSObject, ASWebAuthenticationPresentationContextProviding {
    static var current: SignInSheet?
    let session: ASWebAuthenticationSession
    weak var window: NSWindow?

    init(session: ASWebAuthenticationSession, window: NSWindow?) {
        self.session = session
        self.window = window
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { window ?? NSApplication.shared.keyWindow ?? ASPresentationAnchor() }
    }
}

/// Saves a file the page made (an export) where the person picks, in a save panel on the window; false when
/// cancelled.
@MainActor
final class ShellFiles: NSObject {
    static let shared = ShellFiles()

    func save(name: String, bytes: Data, from presenter: NSWindow?) async -> Bool {
        let clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        let panel = NSSavePanel()
        panel.nameFieldStringValue = clean.isEmpty ? "Folevi export" : String(clean.prefix(120))
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        let ok: Bool
        if let presenter {
            ok = await withCheckedContinuation { cont in panel.beginSheetModal(for: presenter) { cont.resume(returning: $0 == .OK) } }
        } else {
            ok = panel.runModal() == .OK
        }
        guard ok, let url = panel.url else { return false }
        return (try? bytes.write(to: url, options: .atomic)) != nil
    }
}

/// "Choose a folder": an open panel for folders, as Electron's dialog did.
@MainActor
final class FolderPicker: NSObject {
    static let shared = FolderPicker()

    func pick(from presenter: NSWindow?) async -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Use This Folder"
        let ok: Bool
        if let presenter {
            ok = await withCheckedContinuation { cont in panel.beginSheetModal(for: presenter) { cont.resume(returning: $0 == .OK) } }
        } else {
            ok = panel.runModal() == .OK
        }
        return ok ? panel.url : nil
    }
}
#endif
