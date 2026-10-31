// The Mac frame on the iPad (docs/IOS_REBUILD_PLAN.md, I7): the iPad's wide layout is the web's desktop layout
// (sidebar, tab strip, the content card) with touch sizes, so FoleviMac's SwiftUI views build for iOS too. AppKit's
// geometry and view names, as their UIKit counterparts, so the shared views read the same on both.
#if os(iOS)
import UIKit
import FoleviDesign

public typealias NSPoint = CGPoint
public typealias NSRect = CGRect
public typealias NSSize = CGSize
public typealias NSView = UIView
public typealias NSWindow = UIWindow
public typealias NSImage = UIImage
public typealias NSColor = UIColor
public typealias NSFont = UIFont

/// SwiftUI's window state (key, active, inactive) is the Mac's; an iPad window draws as the key one.
enum ControlActiveStateShim { case key, active, inactive }
#endif

#if os(iOS)
import SwiftUI

/// The Mac's event monitors (keys, clicks outside, scroll) have no iPad counterpart in this form: a monitor is
/// never installed and never fires, so the views keep their Mac paths and the iPad uses its touch ones (the
/// hardware keyboard's shortcuts come from the frame's key commands).
@MainActor
final class NSEvent {
    enum EventType { case keyDown, keyUp, leftMouseDown, leftMouseUp, rightMouseDown, otherMouseDown, scrollWheel, flagsChanged, mouseMoved, leftMouseDragged }
    struct EventTypeMask: OptionSet, Sendable {
        let rawValue: UInt64
        static let keyDown = EventTypeMask(rawValue: 1 << 0)
        static let keyUp = EventTypeMask(rawValue: 1 << 1)
        static let leftMouseDown = EventTypeMask(rawValue: 1 << 2)
        static let leftMouseUp = EventTypeMask(rawValue: 1 << 3)
        static let rightMouseDown = EventTypeMask(rawValue: 1 << 4)
        static let otherMouseDown = EventTypeMask(rawValue: 1 << 5)
        static let scrollWheel = EventTypeMask(rawValue: 1 << 6)
        static let flagsChanged = EventTypeMask(rawValue: 1 << 7)
        static let mouseMoved = EventTypeMask(rawValue: 1 << 8)
        static let leftMouseDragged = EventTypeMask(rawValue: 1 << 9)
    }
    struct ModifierFlags: OptionSet, Sendable {
        let rawValue: UInt
        static let shift = ModifierFlags(rawValue: 1 << 0)
        static let control = ModifierFlags(rawValue: 1 << 1)
        static let option = ModifierFlags(rawValue: 1 << 2)
        static let command = ModifierFlags(rawValue: 1 << 3)
        static let deviceIndependentFlagsMask = ModifierFlags(rawValue: 0xF)
    }
    var type: EventType = .keyDown
    var keyCode: UInt16 = 0
    var charactersIgnoringModifiers: String?
    var modifierFlags: ModifierFlags = []
    var locationInWindow: CGPoint = .zero
    var window: UIWindow?
    var buttonNumber = 0
    var clickCount = 1
    var scrollingDeltaX: CGFloat = 0
    var scrollingDeltaY: CGFloat = 0
    var hasPreciseScrollingDeltas = true
    static var modifierFlags: ModifierFlags { [] }
    static var mouseLocation: CGPoint { .zero }
    static func addLocalMonitorForEvents(matching mask: EventTypeMask, handler: @escaping (NSEvent) -> NSEvent?) -> Any? { nil }
    static func removeMonitor(_ monitor: Any) {}
}

/// UIPasteboard under AppKit's names (strings only).
@MainActor
final class NSPasteboard {
    struct PasteboardType: Hashable, Sendable {
        let rawValue: String
        init(_ raw: String) { rawValue = raw }
        static let string = PasteboardType("public.utf8-plain-text")
    }
    static let general = NSPasteboard()
    var changeCount: Int { UIPasteboard.general.changeCount }
    @discardableResult func clearContents() -> Int {
        UIPasteboard.general.items = []
        return changeCount
    }
    @discardableResult func setString(_ s: String, forType type: PasteboardType) -> Bool {
        UIPasteboard.general.string = s
        return true
    }
    func string(forType type: PasteboardType) -> String? { UIPasteboard.general.string }
}

@MainActor
final class NSWorkspace {
    static let shared = NSWorkspace()
    @discardableResult func open(_ url: URL) -> Bool {
        UIApplication.shared.open(url)
        return true
    }
    var accessibilityDisplayShouldReduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }
}

/// The app's windows under AppKit's names: the key window is the foreground scene's.
@MainActor
final class NSApplicationShim {
    var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.filter { $0.activationState == .foregroundActive }.flatMap(\.windows).first(where: \.isKeyWindow)
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first
    }
    var mainWindow: UIWindow? { keyWindow }
    var currentEvent: NSEvent? { nil }
}

@MainActor let NSApp = NSApplicationShim()
#endif

import SwiftUI

extension View {
    /// Dragging the bar moves the window (the Mac); the iPad's windows are moved by the system.
    func windowDrag() -> some View {
        #if os(macOS)
        gesture(WindowDragGesture())
        #else
        self
        #endif
    }
}

extension Image {
    /// An AppKit or UIKit image.
    init(platformImage image: NSImage) {
        #if os(macOS)
        self.init(nsImage: image)
        #else
        self.init(uiImage: image)
        #endif
    }
}

#if os(iOS)
import UniformTypeIdentifiers

/// The Mac's open panel runs modally and returns its answer; the iPad has no modal file panel, so this one
/// answers Cancel and the iPad's own screens use SwiftUI's `fileImporter`.
@MainActor
final class NSOpenPanel {
    enum Response { case OK, cancel }
    var canChooseFiles = true
    var canChooseDirectories = false
    var allowsMultipleSelection = false
    var allowedContentTypes: [UTType] = []
    var urls: [URL] = []
    var url: URL? { urls.first }
    func runModal() -> Response { .cancel }
}
#endif

#if os(iOS)
extension UIViewController {
    /// The controller on top of everything this one presents.
    var topmostPresented: UIViewController {
        var c: UIViewController = self
        while let next = c.presentedViewController { c = next }
        return c
    }
}
#endif

#if os(iOS)
extension UIWindow {
    /// AppKit's content view: the window itself on the iPad.
    var contentView: UIView? { self }
}

/// The content card's glass bar height (FrameViews' ContentViewController on the Mac).
enum ContentViewController {
    @MainActor static var barHeight: CGFloat { WebStyles.named("frame.main").light.padding.top }
}

/// The Mac's save panel runs modally; the iPad answers Cancel here and shares the file from its own screens.
@MainActor
final class NSSavePanel {
    enum Response { case OK, cancel }
    var nameFieldStringValue = ""
    var allowedContentTypes: [UTType] = []
    var url: URL?
    func runModal() -> Response { .cancel }
}
#endif

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

extension View {
    /// A checkbox on the Mac; the iPad's switch.
    func checkboxStyle() -> some View {
        #if os(macOS)
        toggleStyle(.checkbox)
        #else
        self
        #endif
    }
}

#if os(iOS)
/// Where the sidebar's choices are kept (the Mac's controller holds this; the iPad has no controller).
enum WebSidebarController {
    nonisolated(unsafe) static var defaults: UserDefaults = .standard
}
#endif
