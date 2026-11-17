// The Mac frame on the iPad (docs/IOS_REBUILD_PLAN.md, I7): the iPad's wide layout is the web's desktop layout
// (sidebar, tab strip, the content card) with touch sizes, so FoleviMac's SwiftUI views build for iOS too. AppKit's
// geometry and view names, as their UIKit counterparts, so the shared views read the same on both.
#if os(iOS)
import UIKit
import GameController
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
    /// The modifier keys held on the iPad's hardware keyboard now (GameController's view of it), so a ⌘-click or
    /// ⇧-click with a pointer selects as on the Mac (multi-select, ListSelection). Without a keyboard: none.
    static var modifierFlags: ModifierFlags {
        guard let keys = GCKeyboard.coalesced?.keyboardInput else { return [] }
        func down(_ a: GCKeyCode, _ b: GCKeyCode) -> Bool { (keys.button(forKeyCode: a)?.isPressed ?? false) || (keys.button(forKeyCode: b)?.isPressed ?? false) }
        var flags: ModifierFlags = []
        if down(.leftGUI, .rightGUI) { flags.insert(.command) }
        if down(.leftShift, .rightShift) { flags.insert(.shift) }
        if down(.leftAlt, .rightAlt) { flags.insert(.option) }
        if down(.leftControl, .rightControl) { flags.insert(.control) }
        return flags
    }
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
    /// Dragging the bar moves the window (the Mac); the iPad's windows are moved by the system. A double click on the
    /// bar's empty room does what System Settings says a title bar's does: zoom (the default), minimise or nothing
    /// (MAC-63; WindowTitleBar).
    func windowDrag() -> some View {
        #if os(macOS)
        gesture(WindowDragGesture())
            .background(WindowTitleBar.DoubleClick())
        #else
        self
        #endif
    }

    /// The first click on an inactive Mac window acts on this view as well as bringing the window forward (MAC-05;
    /// ClickThroughHostingView). Nothing on the iPad.
    public func macClickThrough() -> some View {
        #if os(macOS)
        allowsWindowActivationEvents(true)
        #else
        self
        #endif
    }
}

/// Whether the pointer itself moved since a list last asked: a row that slides under a still pointer (the list
/// scrolled by the arrow keys) gets a hover too, and must not take the keyboard's highlight away (MAC-12; the web's
/// palette does the same). Starts where the pointer is, so a list opening under the pointer doesn't move its
/// highlight either.
@MainActor
final class PointerMoves {
    #if os(macOS)
    private var last: NSPoint = NSEvent.mouseLocation
    #endif

    /// True when the pointer is somewhere else than the last time this answered true (always on the iPad).
    func moved() -> Bool {
        #if os(macOS)
        let p = NSEvent.mouseLocation
        guard p != last else { return false }
        last = p
        #endif
        return true
    }

    #if os(macOS)
    /// Tests: as if the pointer were at `p`.
    func moved(to p: NSPoint) -> Bool {
        guard p != last else { return false }
        last = p
        return true
    }
    #endif
}

#if os(macOS)
/// A window bar's double click (the frame's top bar and the sidebar's: they draw under the hidden title bar, so the
/// system's own double click never reaches them).
public enum WindowTitleBar {
    public enum Action: String, Sendable { case zoom, minimize, none }

    /// System Settings > Desktop & Dock > "Double-click a window's title bar to" (`AppleActionOnDoubleClick`; older
    /// systems' `AppleMiniaturizeOnDoubleClick`).
    public nonisolated static func action(_ value: String?, legacyMinimize: Bool?) -> Action {
        switch value {
        case "Minimize": return .minimize
        case "None": return .none
        case "Maximize", "Fill": return .zoom
        default: return legacyMinimize == true ? .minimize : .zoom
        }
    }

    @MainActor static func doubleClick(_ window: NSWindow) {
        let global = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain) ?? [:]
        switch action(global["AppleActionOnDoubleClick"] as? String, legacyMinimize: global["AppleMiniaturizeOnDoubleClick"] as? Bool) {
        case .minimize: window.performMiniaturize(nil)
        case .none: break
        case .zoom: window.performZoom(nil)
        }
    }

    /// Behind a bar: takes only the second click of a double click on the bar's empty room (every other click goes
    /// on to the bar's window drag and its buttons, which sit above it).
    struct DoubleClick: NSViewRepresentable {
        final class View: NSView {
            /// Tests: hit-test as for a double click whatever the current event.
            nonisolated(unsafe) static var testing = false
            override func hitTest(_ point: NSPoint) -> NSView? {
                guard Self.testing || NSApp.currentEvent.map({ $0.type == .leftMouseDown && $0.clickCount == 2 }) == true else { return nil }
                return super.hitTest(point)
            }
            override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
            override func mouseDown(with event: NSEvent) {
                if event.clickCount == 2, let w = window { WindowTitleBar.doubleClick(w) }
            }
        }

        func makeNSView(context: Context) -> View { View() }
        func updateNSView(_ v: View, context: Context) {}
    }
}
#endif

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

/// The Mac's open panel, as the Files app's picker on the iPad (UIDocumentPickerViewController). AppKit's runs modally
/// and answers at once; this one answers once the person has picked, so the shared views ask through `choose`, which
/// is `runModal()` on the Mac. Files come as copies the app may read; a folder is copied into the app's temporary
/// folder under its own name (its provider's access ends with the picker), so its paths read as the Mac's.
@MainActor
final class NSOpenPanel {
    enum Response { case OK, cancel }
    var canChooseFiles = true
    var canChooseDirectories = false
    var allowsMultipleSelection = false
    var allowedContentTypes: [UTType] = []
    var urls: [URL] = []
    var url: URL? { urls.first }

    /// What the picker offers: a folder, or files of the allowed types (any file when none are given).
    var pickerTypes: [UTType] {
        if canChooseDirectories && !canChooseFiles { return [.folder] }
        return allowedContentTypes.isEmpty ? [.item] : allowedContentTypes
    }

    /// Shows the Files app's picker; `done` gets OK with `urls` filled in, or cancel.
    func choose(_ done: @escaping @MainActor (Response) -> Void) {
        let folder = pickerTypes == [.folder]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: pickerTypes, asCopy: !folder)
        picker.allowsMultipleSelection = allowsMultipleSelection && !folder
        DocumentPickerRelay.present(picker) { [self] picked in
            guard !picked.isEmpty else { return done(.cancel) }
            guard folder else {
                urls = picked
                return done(.OK)
            }
            Task { @MainActor in
                let copies = await Task.detached { picked.compactMap(FilePanelFiles.copyFolder) }.value
                urls = copies
                done(copies.isEmpty ? .cancel : .OK)
            }
        }
    }
}

/// The files the iPad's panels hand around.
enum FilePanelFiles {
    /// A picked folder copied into a new temporary folder under its own name, read while its provider allows; nil
    /// when it can't be read.
    nonisolated static func copyFolder(_ folder: URL) -> URL? {
        let scoped = folder.startAccessingSecurityScopedResource()
        defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
        guard let dir = newTemporaryFolder() else { return nil }
        let copy = dir.appendingPathComponent(folder.lastPathComponent, isDirectory: true)
        var failed: NSError?
        var copied = false
        NSFileCoordinator().coordinate(readingItemAt: folder, options: [], error: &failed) { at in
            copied = (try? FileManager.default.copyItem(at: at, to: copy)) != nil
        }
        return copied ? copy : nil
    }

    /// A folder of its own in the app's temporary folder.
    nonisolated static func newTemporaryFolder() -> URL? {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("panel-\(UUID().uuidString)", isDirectory: true)
        return (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil ? dir : nil
    }

    /// A name a file can have: no slashes or colons, never empty or hidden, at most about 120 characters, with the
    /// type's extension when it has none (a save panel's `allowedContentTypes`).
    nonisolated static func fileName(_ name: String, type: UTType? = nil) -> String {
        var clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.isEmpty || clean.hasPrefix(".") { clean = "Folevi file" + clean }
        if clean.count > 120 {
            let ext = (clean as NSString).pathExtension
            let stem = String((clean as NSString).deletingPathExtension.prefix(ext.isEmpty ? 120 : 110))
            clean = ext.isEmpty ? stem : "\(stem).\(ext)"
        }
        if (clean as NSString).pathExtension.isEmpty, let ext = type?.preferredFilenameExtension { clean += ".\(ext)" }
        return clean
    }
}

/// Presents a Files app picker over everything on screen and hands what it picked (nothing when cancelled) to `done`.
@MainActor
public final class DocumentPickerRelay: NSObject, UIDocumentPickerDelegate {
    private static var live: [DocumentPickerRelay] = []
    private var done: (@MainActor ([URL]) -> Void)?

    private init(_ done: @escaping @MainActor ([URL]) -> Void) { self.done = done }

    public static func present(_ picker: UIDocumentPickerViewController, done: @escaping @MainActor ([URL]) -> Void) {
        guard let top = NSApp.keyWindow?.rootViewController?.topmostPresented else { return done([]) }
        let relay = DocumentPickerRelay(done)
        live.append(relay)
        picker.delegate = relay
        top.present(picker, animated: true)
    }

    /// Saves a copy of a file where the person picks in the Files app; `done` says whether it was saved.
    public static func export(_ file: URL, done: @escaping @MainActor (Bool) -> Void = { _ in }) {
        present(UIDocumentPickerViewController(forExporting: [file], asCopy: true)) { done(!$0.isEmpty) }
    }

    private func finish(_ urls: [URL]) {
        Self.live.removeAll { $0 === self }
        let f = done
        done = nil
        f?(urls)
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls) }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish([]) }
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

/// The Mac's save panel, as the Files app's export picker on the iPad. `choose` hands its answer a file in a
/// temporary folder under the panel's name (OK at once: the iPad asks where only once the file exists); once it is
/// written there, the picker saves a copy where the person chooses, and the temporary one goes.
@MainActor
final class NSSavePanel {
    enum Response { case OK, cancel }
    var nameFieldStringValue = ""
    var allowedContentTypes: [UTType] = []
    var url: URL?

    func choose(_ write: (Response) throws -> Void) rethrows {
        guard let dir = FilePanelFiles.newTemporaryFolder() else { return try write(.cancel) }
        let file = dir.appendingPathComponent(FilePanelFiles.fileName(nameFieldStringValue, type: allowedContentTypes.first))
        url = file
        try write(.OK)
        guard FileManager.default.fileExists(atPath: file.path) else {
            try? FileManager.default.removeItem(at: dir)
            return
        }
        DocumentPickerRelay.export(file) { _ in try? FileManager.default.removeItem(at: dir) }
    }
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

#if os(macOS)
import AppKit
import FoleviDesign

extension NSSavePanel {
    /// The panel, modally, and its answer at once (the iPad's stand-in answers once the Files app's picker is done).
    /// An open panel's too (NSOpenPanel is a save panel).
    func choose(_ done: (NSApplication.ModalResponse) throws -> Void) rethrows { try done(runModal()) }
}

extension NSWindow {
    /// Fades the window away, macOS's own for a menu, a popover or a sheet going (at once with Reduce Motion), then
    /// runs `done` (which closes it). It takes no clicks while it fades.
    func fadeAway(then done: @escaping @MainActor () -> Void) {
        guard !WebMotion.reduced, isVisible else { return done() }
        ignoresMouseEvents = true
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = WebMotion.fadeOut
            animator().alphaValue = 0
        }, completionHandler: { MainActor.assumeIsolated { done() } })
    }
}
#endif
