// A tab's screens in a wide window (iPhone Duo open; the owner, 2026-11-19): the list beside the open note, as
// Notes and Mail do on a big screen. The model keeps one stack per tab with the open note last, so the same stack
// shows in one column when the window is narrow (iPhone Duo closed: the note full screen, Back to its list) and in
// two when it is wide (the list on the leading side, the note on the trailing one). Half open, the line between
// them sits on the fold, so neither column runs across it.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviScreens

struct PhoneColumns<List: View, Note: View>: View {
    @Bindable var model: PhoneFrameModel
    let tab: PhoneTab
    /// The window is wide enough for two columns (PhoneWindow.wide): read outside the tab view, whose content beside
    /// the sidebar reads compact.
    let wide: Bool
    /// The window is regular width (the tabs are a sidebar).
    let regular: Bool
    /// The tab's stack from its first screen, on this path.
    let list: (Binding<[PhoneStackEntry]>) -> List
    /// The note column: its first note, then the notes over it on this path.
    let note: (FrameRoute, Binding<[PhoneStackEntry]>) -> Note

    @State private var width: CGFloat = 0
    /// The fold's line in this view while the phone is half open (nil when flat, closed, or not an iPhone Duo).
    @State private var fold: ClosedRange<CGFloat>?

    var body: some View {
        let entries = model.stacks[tab] ?? []
        let run = PhoneFrameModel.noteRunStart(entries)
        let split = wide && run < entries.count
        let current = tab == model.current
        let columns = layout(split: split)
        HStack(spacing: 0) {
            list(listPath(split: split))
                .frame(width: split ? columns.list : nil)
                .frame(maxWidth: split ? nil : .infinity)
            if split {
                // A hairline between the columns; half open, the fold's width of canvas with the line down its middle.
                FoleviTokens.Chrome.canvas.color
                    .overlay { FoleviTokens.Chrome.line.color.frame(width: 1 / 3) }
                    .frame(width: max(columns.gap, 1 / 3))
                    .ignoresSafeArea()
                note(entries[run].route, notePath)
                    .frame(maxWidth: .infinity)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(WebMotion.reduced ? nil : .snappy(duration: 0.3), value: split)
        .background {
            FoldReader(fold: $fold)
            // The sidebar steps aside while a note is open beside its list (its button in the bar brings it back),
            // and comes back when the note closes.
            // (Upright, too narrow for two columns, the sidebar slides over the screen and dims it: there it waits
            // behind its button.)
            if current { SidebarTuck(tucked: regular && (!wide || run < entries.count)) }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onChange(of: wide && current, initial: true) {
            if current, model.columns != wide { model.columns = wide }
        }
    }

    /// The list column's width and the line after it: on the fold while half open, else about two fifths of the
    /// width (the sidebar shown over an open note narrows both).
    private func layout(split: Bool) -> (list: CGFloat, gap: CGFloat) {
        if let fold, fold.lowerBound >= 240, width - fold.upperBound >= 300 {
            return (fold.lowerBound, max(fold.upperBound - fold.lowerBound, 1))
        }
        return (min(360, max(240, (width * 0.4).rounded())), 0)
    }

    /// The list column's path: the whole stack when one column, the screens under the open notes when two.
    private func listPath(split: Bool) -> Binding<[PhoneStackEntry]> {
        Binding(
            get: {
                let s = model.stacks[tab] ?? []
                return split ? Array(s[1..<PhoneFrameModel.noteRunStart(s)]) : Array(s.dropFirst())
            },
            set: { split ? model.setListPath($0, in: tab) : model.setPath($0, in: tab) }
        )
    }

    /// The notes over the note column's first.
    private var notePath: Binding<[PhoneStackEntry]> {
        Binding(
            get: {
                let s = model.stacks[tab] ?? []
                let run = PhoneFrameModel.noteRunStart(s)
                return run + 1 < s.count ? Array(s[(run + 1)...]) : []
            },
            set: { model.setNotePath($0, in: tab) }
        )
    }
}

/// The window the frame is in, for the columns: regular width (iPhone Duo open; not a Split View half) and wide
/// enough for a list and a note side by side (the inner screen across, not upright).
enum PhoneWindow {
    static func wide(_ sizeClass: UserInterfaceSizeClass?, width: CGFloat) -> Bool {
        sizeClass == .regular && width >= 800
    }
}

/// Shows or hides the tab view's sidebar (iOS 18's UITabBarController sidebar, under SwiftUI's TabView) when
/// `tucked` changes, and once when it first finds the tab view: in between the person's own toggle stays.
private struct SidebarTuck: UIViewControllerRepresentable {
    let tucked: Bool

    func makeUIViewController(context: Context) -> Probe { Probe() }
    func updateUIViewController(_ probe: Probe, context: Context) { probe.want(tucked) }

    final class Probe: UIViewController {
        private var wanted = false
        private var applied: Bool?

        func want(_ tucked: Bool) {
            wanted = tucked
            apply()
        }

        override func viewDidLoad() {
            super.viewDidLoad()
            // iOS shows the sidebar again when the window turns wide (iPhone Duo opening): said again once it has.
            registerForTraitChanges([UITraitHorizontalSizeClass.self]) { (self: Probe, _: UITraitCollection) in
                DispatchQueue.main.async { self.apply(again: true) }
            }
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            apply()
        }

        override func viewWillTransition(to size: CGSize, with coordinator: any UIViewControllerTransitionCoordinator) {
            super.viewWillTransition(to: size, with: coordinator)
            coordinator.animate(alongsideTransition: nil) { [weak self] _ in self?.apply(again: true) }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            // (The content is laid out again whenever the sidebar comes or goes, by its own button too.)
            if let tabs = tabBarController { PhoneSidebar.shared.attach(tabs) }
        }

        private func apply(again: Bool = false) {
            guard again || applied != wanted, let tabs = tabBarController, UIDevice.current.userInterfaceIdiom == .phone else { return }
            applied = wanted
            if tabs.sidebar.isHidden != wanted { tabs.sidebar.isHidden = wanted }
            PhoneSidebar.shared.attach(tabs)
        }
    }
}

/// The tab view's sidebar, for the button that brings it back: iOS draws none on the iPhone once the sidebar is
/// hidden (by its own button, or tucked away for a note), and the tabs would be out of reach.
@MainActor @Observable
final class PhoneSidebar {
    static let shared = PhoneSidebar()
    private(set) var hidden = false
    @ObservationIgnored private weak var tabs: UITabBarController?

    func attach(_ tabs: UITabBarController) {
        self.tabs = tabs
        if hidden != tabs.sidebar.isHidden { hidden = tabs.sidebar.isHidden }
    }

    func show() {
        tabs?.sidebar.isHidden = false
        hidden = false
    }
}

/// "Show sidebar" in a tab's first screen's bar while the sidebar is hidden in a regular-width window.
struct PhoneSidebarButton: ViewModifier {
    let regular: Bool

    func body(content: Content) -> some View {
        if regular, PhoneSidebar.shared.hidden, UIDevice.current.userInterfaceIdiom == .phone {
            content.toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Show sidebar", systemImage: "sidebar.leading") { PhoneSidebar.shared.show() }
                        .foleviTooltip("Show sidebar")
                }
            }
        } else {
            content
        }
    }
}

extension View {
    /// iOS 27 on the iPhone: the tabs as a sidebar in a wide window (iPhone Duo open), the tab bar when narrow
    /// (closed), the same tabs either way. (The iPad has its own wide layout; under it, its windows keep the bar.)
    @ViewBuilder
    func phoneTabSidebar() -> some View {
        if #available(iOS 27, *), UIDevice.current.userInterfaceIdiom == .phone {
            tabViewStyle(.sidebarAdaptable).defaultTabBarPlacement(.sidebar)
        } else {
            self
        }
    }
}

/// Where the fold runs through this view while iPhone Duo is half open (iOS 27.1's division region), across.
private struct FoldReader: View {
    @Binding var fold: ClosedRange<CGFloat>?

    var body: some View {
        if #available(iOS 27.1, *) {
            GeometryReader { proxy in
                Color.clear
                    .onChange(of: Self.read(proxy), initial: true) { _, f in
                        if fold != f { fold = f }
                    }
            }
        } else {
            Color.clear
        }
    }

    @available(iOS 27.1, *)
    private static func read(_ proxy: GeometryProxy) -> ClosedRange<CGFloat>? {
        // (A fold that runs across the view, not along it: tabletop's fold is a matter for the bars, not the columns.)
        guard let r = proxy.reservedRegions(kind: .division).first(where: { $0.isActive && $0.frame.height > $0.frame.width }) else { return nil }
        return r.frame.minX...r.frame.maxX
    }
}
#endif
