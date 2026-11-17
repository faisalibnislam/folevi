// The iPad's wide layout in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I7): FoleviMac's frame (IPadFrameView:
// the sidebar, the content card, its glass top bar and tab strip) on the same engine as the phone's, the note
// being the app's one Page View in the card. Under 700 pt wide (Split View, Slide Over, a small Stage Manager
// window) the iPad shows the phone's layout, as the web does (lib/iphone.ts IPAD_COMPACT).
import SwiftUI
import UIKit
import WebKit
import FoleviDesign
import FoleviEngine
import FoleviMac
import FoleviPhone
import FoleviScreens

enum RebuildIPad {
    /// lib/iphone.ts: `(max-width: 699px)` is compact.
    static let minWidth: CGFloat = 700
}

struct RebuildIPadRoot: View {
    let desk: FrameModel
    let phone: PhoneModel
    let pageHost: PageViewHost
    let gate: GateModel

    var body: some View {
        IPadFrameView(model: desk) {
            IPadNotePage(pageHost: pageHost, desk: desk)
        }
        // The screens before the app, as on the phone.
        .overlay {
            if let g = phone.gate, g.gate != nil, g.gate != "loading" {
                WebGateScreen(model: gate)
                    .onAppear { gate.show(g) }
                    .onChange(of: g) { _, next in gate.show(next) }
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: phone.gate?.gate)
    }
}

/// The note in the card: the Page View, adopted while the note shows and parked again when it goes. While the
/// on-screen keyboard is up, the iPhone's formatting bar rides on it (insert, checklist, text style, bold, italic,
/// indent, undo, Foli AI, and the key that puts the keyboard away); a hardware keyboard has the shortcuts instead.
private struct IPadNotePage: UIViewControllerRepresentable {
    let pageHost: PageViewHost
    let desk: FrameModel

    final class Controller: UIViewController, PageViewOwner {
        weak var pageHost: PageViewHost?
        weak var desk: FrameModel?
        /// The page sits in this, which ends where the on-screen keyboard (and its formatting bar) begins: the page
        /// gets shorter while the keyboard is up, so the editor keeps the line being typed in view above it (a page
        /// left full height went on typing under the keys). A floating keyboard, or none, leaves it full height.
        private let holder = UIView()
        private let keyboardBar = KeyboardToolbar()
        private var holderBottom: NSLayoutConstraint?
        /// The docked on-screen keyboard is up (not a hardware keyboard's short shortcuts bar, nor a floating one).
        private var softKeyboard = false
        var pageViewContainer: UIView { holder }

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .clear
            holder.backgroundColor = .clear
            holder.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(holder)
            keyboardBar.translatesAutoresizingMaskIntoConstraints = false
            keyboardBar.isHidden = true
            keyboardBar.alpha = 0
            keyboardBar.onCommand = { [weak self] in self?.run($0) }
            view.addSubview(keyboardBar)
            view.keyboardLayoutGuide.usesBottomSafeArea = false
            let bottom = holder.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
            holderBottom = bottom
            NSLayoutConstraint.activate([
                holder.topAnchor.constraint(equalTo: view.topAnchor),
                holder.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                holder.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                bottom,
                keyboardBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                keyboardBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                keyboardBar.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
                keyboardBar.heightAnchor.constraint(equalToConstant: KeyboardToolbar.height),
            ])
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
            center.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
            watchEditor()
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            pageHost?.adopt(by: self)
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            if let pageHost, pageHost.isOwned(by: self) { pageHost.park() }
        }

        func pageViewWillLeave(_ pageView: WKWebView) {}

        /// How much of this view the keyboard covers decides it: a hardware keyboard's shortcuts bar covers little.
        @objc private func keyboardChanged(_ note: Notification) {
            var covered: CGFloat = 0
            if note.name != UIResponder.keyboardWillHideNotification,
               let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue,
               let window = view.window {
                let frame = view.convert(view.bounds, to: window.coordinateSpace)
                covered = KeyboardBridge.coveredHeight(keyboard: window.convert(end, from: window.screen.coordinateSpace), bounds: frame)
            }
            softKeyboard = covered > 120
            showBar()
        }

        /// The bar shows while the docked on-screen keyboard is up and the editor has it.
        private func showBar() {
            let visible = softKeyboard && (desk?.editorState?.focused ?? false)
            holderBottom?.constant = visible ? -KeyboardToolbar.height : 0
            guard keyboardBar.isHidden == visible else { return }
            if visible { keyboardBar.isHidden = false }
            UIView.animate(withDuration: 0.18) {
                self.keyboardBar.alpha = visible ? 1 : 0
                self.view.layoutIfNeeded()
            } completion: { _ in
                if !visible, self.keyboardBar.alpha == 0 { self.keyboardBar.isHidden = true }
            }
        }

        /// The editor's state lights the bar's buttons and says whether the editor has the keyboard.
        private func watchEditor() {
            guard let desk else { return }
            withObservationTracking {
                keyboardBar.update(desk.editorState, aiOn: desk.session.value?.capabilities.ai ?? false)
            } onChange: { [weak self] in
                Task { @MainActor [weak self] in
                    self?.watchEditor()
                    self?.showBar()
                }
            }
        }

        private func run(_ c: KeyboardToolbar.Command) {
            guard let desk else { return }
            switch c {
            case .insert: desk.editor(.panelOpen(panel: .insert))
            case .checklist: desk.editor(.format(block: .todo))
            case .block(let b): desk.editor(.format(block: b))
            case .formatPanel: desk.editor(.panelOpen(panel: .format))
            case .bold: desk.editor(.format(mark: .bold))
            case .italic: desk.editor(.format(mark: .italic))
            case .outdent: desk.editor(.outdent)
            case .indent: desk.editor(.indent)
            case .undo: desk.editor(.undo)
            case .redo: desk.editor(.redo)
            case .ai: desk.editor(.ai(action: .open))
            case .hideKeyboard:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                desk.editor(.dismissKeyboard)
                pageHost?.pageView.endEditing(true)
            }
        }
    }

    func makeUIViewController(context: Context) -> Controller {
        let c = Controller()
        c.pageHost = pageHost
        c.desk = desk
        return c
    }

    func updateUIViewController(_ c: Controller, context: Context) {
        if let host = c.pageHost, !host.isOwned(by: c), c.view.window != nil { host.adopt(by: c) }
    }
}

/// What the iPad frame asks of the app (FrameHost): the phone's account flows and the system's own sheets.
extension RebuildFrameController: FrameHost {
    func frameOpenSettings(section: String?) {
        desk.open(FrameRoute(path: section.map { "/settings/\($0)" } ?? "/settings"))
    }

    func frameSwitchPlace(_ place: String, space: String?) { switchPlace(place) }

    func frameSignInAnotherAccount() {
        account(.signInAnother, places: PlacesModel(client: model.client, feedback: ScreenFeedback(toast: { [weak self] t in self?.model.toast(t.message) })), close: {})
    }

    func frameSignOut(place: String) { signOutNow() }

    func frameSignOutConfirmed(place: String) { signOutNow() }

    func frameDownloadFile(_ id: String) { desk.downloadDeliveredFile(id) }

    func frameMoveOrCopy() {
        PlaceMove.present(from: self, model: desk)
    }

    func frameOpenHelp() { desk.open(FrameRoute(path: "/help")) }

    func frameOpenExternal(_ url: URL) { openExternal(url) }

    func frameOpenInNewWindow(_ route: FrameRoute) {
        let activity = NSUserActivity(activityType: RebuildFrame.restorationType)
        activity.userInfo = ["path": route.path]
        UIApplication.shared.requestSceneSessionActivation(nil, userActivity: activity, options: nil)
    }

    /// The wide layout's tabs are kept a moment after they change (DeskTabs), as the Mac keeps its windows'.
    func frameStateChanged() {
        if UIDevice.current.userInterfaceIdiom == .pad { DeskTabs.changed(desk) }
    }

    /// Settings > This device: the app lock (the iPhone's Settings has the same, RebuildSettings).
    var frameDeviceLock: FrameDeviceLock? {
        FrameDeviceLock(
            state: { (LockSettings.enabled, LockSettings.after, LockSettings.method()) },
            set: { on in
                if on {
                    guard LockSettings.method() != "none" else { return }
                    guard await AppLock.confirm(reason: "Turn on the lock for Folevi") else { return }
                }
                LockSettings.enabled = on
            },
            setAfter: { after in if LockSettings.choices.contains(after) { LockSettings.after = after } }
        )
    }
}

/// The wide layout's tabs and screen, back after a relaunch (docs/IOS_REBUILD_PLAN.md I7; the Mac's WindowRestore).
extension RebuildFrameController {
    /// The desk's tabs for the scene's restoration activity (SceneDelegate); nil on an iPhone.
    var deskRestorationData: Data? {
        UIDevice.current.userInterfaceIdiom == .pad ? DeskTabs.data(desk) : nil
    }

    /// Saves the desk's tabs now (the app going to the background), not a moment later.
    func saveDesk() {
        if UIDevice.current.userInterfaceIdiom == .pad { DeskTabs.save(desk) }
    }

    /// Puts the desk's tabs back: the scene's own when iOS kept it, else (the app was closed) the last saved, unless
    /// another window is open already. Not when launched to open routes (FOLEVI_REBUILD_OPEN).
    func restoreDesk(from activity: NSUserActivity?) {
        guard UIDevice.current.userInterfaceIdiom == .pad, (ProcessInfo.processInfo.environment["FOLEVI_REBUILD_OPEN"] ?? "").isEmpty else { return }
        let kept = (activity?.userInfo?[RebuildFrame.deskRestorationKey] as? Data).flatMap(DeskTabs.decode)
        let alone = UIApplication.shared.connectedScenes.count <= 1
        guard let saved = kept ?? (alone ? DeskTabs.saved() : nil) else { return }
        desk.restore(saved)
        // The phone's layout doesn't follow this to the restored screen (it has its own restored stacks).
        RebuildDeskBridge.placed = desk.route
    }
}

/// Folevi's shortcuts with a hardware keyboard (KeyCommands.swift's list, in the ⌘ overlay): done natively, on the
/// desk in the iPad's wide layout and on the phone's frame otherwise. A note's page still gets its own keys.
extension RebuildFrameController {
    override var keyCommands: [UIKeyCommand]? {
        let app = FoleviShortcut.all.map { $0.keyCommand(action: #selector(pressRebuildShortcut(_:))) }
        // The iPad's wide layout has the Mac's tabs, so the Mac's keys for them (and Settings, Search All Notes).
        let desk = wide ? IPadShortcut.all.map { $0.keyCommand(action: #selector(pressDeskShortcut(_:))) } : []
        return (super.keyCommands ?? []) + app + desk
    }

    @objc func pressDeskShortcut(_ command: UIKeyCommand) {
        guard wide, let shortcut = IPadShortcut.all.first(where: { $0.input == command.input && $0.modifiers == command.modifierFlags }) else { return }
        switch shortcut.action {
        case .settings: desk.open(FrameRoute(path: "/settings"))
        case .searchAll: desk.open(FrameRoute(path: "/search"))
        case .closeTab: desk.closeTab()
        case .reopenTab: desk.reopenClosedTab()
        case .nextTab: desk.nextTab(1)
        case .previousTab: desk.nextTab(-1)
        case .allTabs: desk.overviewShown.toggle()
        case .tab(let n): desk.selectTab(number: n)
        }
    }

    var wide: Bool { UIDevice.current.userInterfaceIdiom == .pad && view.bounds.width >= RebuildIPad.minWidth }

    @objc func pressRebuildShortcut(_ command: UIKeyCommand) {
        guard let shortcut = FoleviShortcut.matching(command) else { return }
        switch shortcut.input {
        case "n": wide ? desk.newNote() : model.newNote()
        case "k":
            if wide {
                CommandPalette.show(desk)
            } else {
                // What's typed before the search field has the focus waits for it, out of the note (F04).
                EarlyKeys.start(in: view.window)
                frame.open(FrameRoute(path: "/search"))
            }
        case "a": model.quickAddShown = true
        case "j": wide ? desk.askAI() : RebuildFrame.ai.ask()  // (the phone: the sheet, as the web's openAsk)
        case "t": openLink(DeepLink.todayURL)
        case "\\": if wide { desk.toggleSidebar() }
        case "[": wide ? desk.goBack() : frame.back()
        case "]": if wide { desk.goForward() }
        default: break
        }
    }
}

/// The Mac's keys for the iPad's wide layout (apps/mac/Folevi/Chrome/MenuModel.swift): Settings, Search All Notes and
/// the tabs. Listed in the overlay iPadOS shows while ⌘ is held.
struct IPadShortcut {
    enum Action: Equatable { case settings, searchAll, closeTab, reopenTab, nextTab, previousTab, allTabs, tab(Int) }

    let title: String
    let input: String
    let modifiers: UIKeyModifierFlags
    let action: Action

    static let all: [IPadShortcut] = [
        IPadShortcut(title: "Settings", input: ",", modifiers: .command, action: .settings),
        IPadShortcut(title: "Search All Notes", input: "f", modifiers: [.command, .shift], action: .searchAll),
        IPadShortcut(title: "Close Tab", input: "w", modifiers: .command, action: .closeTab),
        IPadShortcut(title: "Reopen Closed Tab", input: "t", modifiers: [.command, .shift], action: .reopenTab),
        IPadShortcut(title: "Show Next Tab", input: "\t", modifiers: .control, action: .nextTab),
        IPadShortcut(title: "Show Previous Tab", input: "\t", modifiers: [.control, .shift], action: .previousTab),
        IPadShortcut(title: "Show All Tabs", input: "\\", modifiers: [.command, .shift], action: .allTabs),
    ] + (1...9).map { IPadShortcut(title: "Tab \($0)", input: "\($0)", modifiers: .command, action: .tab($0)) }

    func keyCommand(action selector: Selector) -> UIKeyCommand {
        let command = UIKeyCommand(title: title, action: selector, input: input, modifierFlags: modifiers)
        command.discoverabilityTitle = title
        command.wantsPriorityOverSystemBehavior = true
        return command
    }
}
