import AppKit
import SwiftUI

/// Unified, transparent title bar with full-size content: the canvas (and its glow) runs under the
/// traffic lights and our own 52pt toolbar row. An empty unified `NSToolbar` gives the title bar its
/// 52pt height, so the traffic lights sit centred in the toolbar row exactly like a native toolbar.
struct WindowChrome: NSViewRepresentable {
    func makeNSView(context: Context) -> WindowChromeView { WindowChromeView() }
    func updateNSView(_ nsView: WindowChromeView, context: Context) {}
}

final class WindowChromeView: NSView {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let window else { return }
        Self.configure(window)
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    static func configure(_ window: NSWindow) {
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarSeparatorStyle = .none
        window.isMovableByWindowBackground = false
        if window.toolbar == nil {
            let toolbar = NSToolbar(identifier: "folevi.chrome")
            toolbar.showsBaselineSeparator = false
            toolbar.allowsUserCustomization = false
            toolbar.displayMode = .iconOnly
            window.toolbar = toolbar
        }
        window.toolbarStyle = .unified
    }
}

/// Makes a SwiftUI area behave like title bar chrome: drag to move the window, double-click to zoom or
/// minimize (following the user's Dock setting).
struct TitlebarDragArea: ViewModifier {
    func body(content: Content) -> some View {
        content
            .contentShape(Rectangle())
            .gesture(WindowDragGesture())
            .simultaneousGesture(TapGesture(count: 2).onEnded {
                guard let window = NSApp.keyWindow else { return }
                let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
                switch action {
                case "Minimize": window.performMiniaturize(nil)
                case "None": break
                default: window.performZoom(nil)
                }
            })
    }
}

extension View {
    func titlebarDragArea() -> some View { modifier(TitlebarDragArea()) }
}

/// For buttons in the title bar row (tabs, back and forward, the sync pill, Share). The system `.plain`
/// style there lost real mouse clicks to the window's title bar, while our own styles kept them, so these
/// buttons draw their label as is and only dim while pressed.
struct ChromeButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Rectangle())
    }
}

extension ButtonStyle where Self == ChromeButtonStyle {
    static var chrome: ChromeButtonStyle { ChromeButtonStyle() }
}

extension View {
    /// Focuses a SwiftUI field when it appears. A note's text view (AppKit) keeps the keyboard otherwise, so
    /// typing and Return went to the note instead of the field: the window lets go of it first.
    func claimsFocus(_ focus: FocusState<Bool>.Binding) -> some View {
        onAppear {
            if let window = NSApp.keyWindow, window.firstResponder is NSTextView { window.makeFirstResponder(nil) }
            Task { @MainActor in
                focus.wrappedValue = true
                try? await Task.sleep(for: .milliseconds(60))
                focus.wrappedValue = true
            }
        }
    }
}

extension View {
    /// A popover drawn as a solid card. The system popover is see-through glass, and the page behind made
    /// panels like Notifications, Share and Sync hard to read.
    func foleviPopover<Content: View>(isPresented: Binding<Bool>, arrowEdge: Edge? = nil,
                                      @ViewBuilder content: @escaping () -> Content) -> some View {
        popover(isPresented: isPresented, arrowEdge: arrowEdge) {
            content()
                .background(FoleviColor.surface)
                .presentationBackground(FoleviColor.surface)
        }
    }
}
