import SwiftUI
import UserNotifications

@main
struct FoleviApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var app = AppModel()

    init() {
        // Instrument Sans, Spectral and JetBrains Mono before the first view renders.
        FoleviFont.registerBundledFonts()
        #if DEBUG
        if ProcessInfo.processInfo.environment["FOLEVI_TRACE_CLICKS"] != nil { ClickTrace.install() }
        #endif
    }

    var body: some Scene {
        WindowGroup("Folevi", id: "main") {
            RootView()
                .foleviPopoverHost()
                .environment(app)
                .foleviTypography()
                .frame(minWidth: 820, minHeight: 540)
                .task {
                    appDelegate.app = app
                    await app.start()
                }
                .onReceive(NotificationCenter.default.publisher(for: .foleviQuickAdd)) { _ in
                    OpenWindowBridge.shared.open?("quickAdd")
                }
                .background(OpenWindowCapture())
        }
        .defaultSize(width: 1240, height: 820)
        .commands { FoleviCommands(app: app) }

        WindowGroup("Document", id: "document", for: String.self) { $documentId in
            if let documentId {
                DocumentWindowView(documentId: documentId)
                    .foleviPopoverHost()
                    .environment(app)
                    .foleviTypography()
                    .frame(minWidth: 560, minHeight: 420)
            }
        }
        .defaultSize(width: 900, height: 780)

        Window("Quick Add Task", id: "quickAdd") {
            QuickAddView()
                .environment(app)
                .foleviTypography()
        }
        // The web's Quick add dialog has its own title and Close: no title bar above it. (A plain window
        // can't take typing.)
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultPosition(.center)

        MenuBarExtra {
            MenuBarContent()
                .environment(app)
        } label: {
            Image(nsImage: FoleviMarkShape.templateImage(size: 16))
                .accessibilityLabel(Text("Folevi"))
        }
    }
}

/// Lets non-view code (notifications, palette actions) open scenes.
@MainActor
final class OpenWindowBridge {
    static let shared = OpenWindowBridge()
    var open: ((String) -> Void)?
    var openDocument: ((String) -> Void)?
    /// Opens a page in a new tab of the main window (set while it's showing).
    var openInNewTab: ((String) -> Void)?
}

struct OpenWindowCapture: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .onAppear {
                OpenWindowBridge.shared.open = { id in openWindow(id: id) }
                OpenWindowBridge.shared.openDocument = { id in openWindow(id: "document", value: id) }
            }
            .accessibilityHidden(true)
    }
}

struct MenuBarContent: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Quick Add Task…") {
            NSApp.activate()
            openWindow(id: "quickAdd")
        }
        .keyboardShortcut("a", modifiers: [.command, .shift])
        Button("New Document") {
            NSApp.activate()
            Task {
                if let id = await app.createDocument() { openWindow(id: "document", value: id) }
            }
        }
        .disabled(app.phase != .ready)
        Divider()
        Text(statusText)
        Divider()
        Button("Open Folevi") {
            NSApp.activate()
            openWindow(id: "main")
        }
    }

    private var statusText: String {
        switch app.sync.status {
        case .saved: return String(localized: "All changes saved")
        case .saving, .syncing: return String(localized: "Syncing…")
        case .offline: return String(localized: "Offline · \(app.sync.pendingCount) waiting")
        case .conflict: return String(localized: "Conflict needs review")
        case .error: return String(localized: "Sync error")
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    @MainActor var app: AppModel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        NSWindow.allowsAutomaticWindowTabbing = false
    }

    /// Make sure every edit is on disk before quitting.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task { @MainActor in
            if let engine = app?.session?.engine {
                await engine.flushNow()
            }
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let id = response.notification.request.content.userInfo["documentId"] as? String
        await MainActor.run {
            if let id { OpenWindowBridge.shared.openDocument?(id) }
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

#if DEBUG
/// Debug only (FOLEVI_TRACE_CLICKS=1): prints which view each mouse-down lands on, to chase lost clicks.
enum ClickTrace {
    /// Unbuffered, so every line lands in the log at once.
    nonisolated static func trace(_ line: String) { FileHandle.standardError.write(Data((line + "\n").utf8)) }

    @MainActor static func install() {
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { e in
            if let w = e.window, let frame = w.contentView?.superview {
                let p = frame.convert(e.locationInWindow, from: nil)
                var chain: [String] = []
                var v = frame.hitTest(p)
                while let view = v, chain.count < 8 { chain.append(String(describing: type(of: view))); v = view.superview }
                trace("CLICK \(e.type == .leftMouseDown ? "down" : "up") \(Int(e.locationInWindow.x)) \(Int(w.frame.height - e.locationInWindow.y)) \(chain.joined(separator: " < "))")
            } else {
                trace("CLICK no window \(e.type.rawValue)")
            }
            return e
        }
    }
}
#endif
