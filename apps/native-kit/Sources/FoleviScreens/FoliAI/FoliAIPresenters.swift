// Where the chat lives on each device (plan 5.9):
//
// - iPhone: a sheet (UISheetPresentationController) at medium and large detents. The composer is pinned to the
//   keyboard layout guide in its own hosting controller, so it rides the keyboard in the keyboard's own
//   animation (one motion, no SwiftUI avoidance on top). Once an answer starts the sheet goes large and stays
//   large, so the keyboard going down never drops it back to medium mid-answer.
// - iPad: a form sheet (the same controller), or the whole view in a popover.
// - Mac: a panel window beside the main window (FoliAIPanelController).
//
// Frames keep one controller (and its model) per window and present it again, so it opens at once with the
// conversation as it was.
import SwiftUI
import Observation
import FoleviDesign
import FoleviEngine

#if canImport(UIKit)
import UIKit

@MainActor
public final class FoliChatController: UIViewController {
    public let model: FoliChatModel
    private let top: UIHostingController<AnyView>
    private let composer: UIHostingController<AnyView>
    private var tracking = false
    private var wasWorking = false

    /// `open` handles a route the chat asks for (the controller dismisses itself first on iPhone).
    public init(model: FoliChatModel, open: @escaping @MainActor @Sendable (ScreenRoute) -> Void) {
        self.model = model
        let compact = UIDevice.current.userInterfaceIdiom == .phone
        top = UIHostingController(rootView: AnyView(FoliChatTop(model: model, compact: compact)))
        composer = UIHostingController(rootView: AnyView(FoliComposerHost(model: model, compact: compact)))
        super.init(nibName: nil, bundle: nil)
        model.onClose = { [weak self] in self?.dismiss(animated: true) }
        model.onOpen = { [weak self] route in
            guard let self else { return open(route) }
            if self.presentingViewController != nil, compact {
                self.dismiss(animated: true) { open(route) }
            } else {
                open(route)
            }
        }
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(Folevi.color.canvas)
        for child in [top, composer] {
            addChild(child)
            child.view.translatesAutoresizingMaskIntoConstraints = false
            child.view.backgroundColor = .clear
            // The keyboard is handled by the layout guide below, not by SwiftUI's avoidance.
            child.safeAreaRegions = .container
            view.addSubview(child.view)
            child.didMove(toParent: self)
        }
        composer.sizingOptions = .intrinsicContentSize
        view.keyboardLayoutGuide.followsUndockedKeyboard = true
        NSLayoutConstraint.activate([
            top.view.topAnchor.constraint(equalTo: view.topAnchor),
            top.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            top.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            top.view.bottomAnchor.constraint(equalTo: composer.view.topAnchor),
            composer.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            composer.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composer.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
        ])
        track()
    }

    public override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { model.closed() }
    }

    /// Goes large when an answer starts, and stays there while it's written.
    private func track() {
        guard !tracking else { return }
        tracking = true
        let working = withObservationTracking { model.isWorking } onChange: { [weak self] in
            Task { @MainActor in
                self?.tracking = false
                self?.track()
            }
        }
        if working, !wasWorking, let sheet = sheetPresentationController, sheet.selectedDetentIdentifier != .large {
            sheet.animateChanges { sheet.selectedDetentIdentifier = .large }
        }
        wasWorking = working
    }
}

/// The composer area hides while the history list shows.
struct FoliComposerHost: View {
    @Bindable var model: FoliChatModel
    let compact: Bool
    var body: some View {
        if !model.historyOpen {
            FoliComposerView(model: model, compact: compact).background(Folevi.color.canvas)
        }
    }
}

public enum FoliAISheet {
    /// Sets up a controller as the iPhone sheet (medium and large) or the iPad form sheet.
    @MainActor
    public static func configure(_ controller: FoliChatController, regular: Bool) {
        if regular {
            controller.modalPresentationStyle = .formSheet
            controller.preferredContentSize = CGSize(width: 560, height: 760)
            return
        }
        controller.modalPresentationStyle = .pageSheet
        guard let sheet = controller.sheetPresentationController else { return }
        sheet.detents = [.medium(), .large()]
        sheet.prefersGrabberVisible = true
        sheet.prefersScrollingExpandsWhenScrolledToEdge = false
        sheet.preferredCornerRadius = FoleviTokens.Radius.sheet
        // A chat with something in it opens large; a new one at medium, so its suggestions show over the page.
        sheet.selectedDetentIdentifier = controller.model.messages.isEmpty ? .medium : .large
    }

    /// Presents the chat (configured for the presenter's size class).
    @MainActor
    public static func present(_ controller: FoliChatController, from presenter: UIViewController, animated: Bool = true) {
        guard controller.presentingViewController == nil else { return }
        configure(controller, regular: presenter.traitCollection.horizontalSizeClass == .regular)
        presenter.present(controller, animated: animated)
    }
}
#endif

#if os(macOS)
import AppKit

/// The Mac's chat: a panel window (resizable, remembered frame) beside the main window. Command-J toggles it.
@MainActor
public final class FoliAIPanelController: NSWindowController, NSWindowDelegate {
    public let model: FoliChatModel

    public init(model: FoliChatModel, open: @escaping @MainActor @Sendable (ScreenRoute) -> Void) {
        self.model = model
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 680), styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: true)
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.title = "Foli AI"
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        panel.isFloatingPanel = false
        panel.minSize = NSSize(width: 360, height: 420)
        for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { panel.standardWindowButton(b)?.isHidden = true }
        panel.contentView = NSHostingView(rootView: FoliAIChatView(model: model, compact: false).padding(.top, 6))
        panel.setFrameAutosaveName("FoliAIChat")
        super.init(window: panel)
        panel.delegate = self
        model.onClose = { [weak self] in self?.close() }
        model.onOpen = { route in open(route) }
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    /// Shows the panel beside `parent` (its right edge, inside the screen) the first time; later where it was left.
    public func show(beside parent: NSWindow?) {
        guard let window else { return }
        if !window.isVisible, let parent, window.frame.origin == .zero || !(NSScreen.screens.contains { $0.visibleFrame.intersects(window.frame) }) {
            let p = parent.frame
            let x = min(p.maxX - window.frame.width - 24, (parent.screen?.visibleFrame.maxX ?? p.maxX) - window.frame.width - 12)
            window.setFrameOrigin(NSPoint(x: x, y: p.minY + 24))
        }
        showWindow(nil)
        window.makeKeyAndOrderFront(nil)
    }

    public func toggle(beside parent: NSWindow?) {
        if window?.isVisible == true, window?.isKeyWindow == true { close() } else { show(beside: parent) }
    }

    public func windowWillClose(_ notification: Notification) { model.closed() }
}
#endif
