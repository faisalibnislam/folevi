// The panel's top bar (Notlet's): the dots in a glass capsule, then the actions in one glass group (rich or plain
// text, screenshot, pin on top, open as a window) and the menu button. All in one GlassEffectContainer so they
// merge and morph.
import AppKit
import FoleviDesign
import SwiftUI

struct TopBar: View {
    @Environment(QuickNotesModel.self) private var model
    var namespace: Namespace.ID

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 8) {
                DotBar(namespace: namespace)
                    .layoutPriority(1)
                Spacer(minLength: 0)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        actionGroup { richButton; screenshotButton; if !model.settings.isDetached { pinButton }; windowButton }
                        PanelMenuButton().glassEffectID("more", in: namespace)
                    }
                    HStack(spacing: 8) {
                        actionGroup { screenshotButton; if !model.settings.isDetached { pinButton } }
                        PanelMenuButton().glassEffectID("more", in: namespace)
                    }
                    PanelMenuButton().glassEffectID("more", in: namespace)
                }
            }
        }
    }

    private var isRich: Bool { model.activeDot?.isRichText ?? true }

    private func actionGroup<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 0) { content() }
            .padding(.horizontal, 3)
            .frame(height: 30)
            .quickGlass(.regular.interactive(), in: Capsule())
            .glassEffectID("actions", in: namespace)
    }

    private var richButton: some View {
        GlassIconButton(icon: isRich ? .type : .hash,
                        help: isRich ? "Rich text. Switch to Markdown (⇧⌘T)" : "Markdown. Switch to rich text (⇧⌘T)",
                        label: isRich ? "Rich text, switch to Markdown" : "Markdown, switch to rich text") {
            model.toggleRichText()
        }
    }

    private var screenshotButton: some View {
        GlassIconButton(icon: .camera, help: "Screenshot into this note (⇧⌘5)", label: "Take a screenshot into this note") {
            model.capture(.region)
        }
    }

    private var pinButton: some View {
        let pinned = model.settings.isPinned
        return GlassIconButton(icon: pinned ? .pinOff : .pin, help: pinned ? "Unpin (⇧⌘P)" : "Pin on top (⇧⌘P)",
                               label: pinned ? "Unpin" : "Pin on top", tint: pinned ? Color.accentColor : nil) {
            model.panel?.togglePin()
        }
    }

    private var windowButton: some View {
        GlassIconButton(icon: .appWindow, help: model.settings.isDetached ? "Back to the menu bar (⌥⌘D)" : "Open as a window (⌥⌘D)",
                        label: model.settings.isDetached ? "Back to the menu bar" : "Open as a window") {
            model.panel?.toggleDetach()
        }
    }
}

/// An icon button inside a glass group: no glass of its own (no glass on glass), a soft hover and press highlight.
struct GlassIconButton: View {
    let icon: WebIcon
    let help: String
    let label: String
    var tint: Color?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            QNIcon(icon, size: 15)
                .foregroundStyle(tint ?? .primary)
                .frame(width: 18, height: 18)
        }
        .buttonStyle(CapsuleItemButtonStyle())
        .help(help)
        .accessibilityLabel(label)
    }
}

struct CapsuleItemButtonStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: 28, height: 24)
            .background { Capsule().fill(Color.primary.opacity(configuration.isPressed ? 0.14 : (hovering ? 0.07 : 0))) }
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && Motion.isEnabled ? 0.92 : 1)
            .animation(Motion.quick, value: configuration.isPressed)
            .onHover { hovering = $0 }
    }
}

/// Holds the AppKit view a menu pops up from (SwiftUI's Menu can't carry Folevi's own NSMenu items).
@MainActor
final class MenuAnchor {
    weak var view: NSView?

    func pop(_ menu: NSMenu, below: Bool = true) {
        guard let view else { return }
        let point = below ? NSPoint(x: 0, y: view.bounds.height + 4) : NSPoint(x: 0, y: -4)
        menu.popUp(positioning: nil, at: point, in: view)
    }
}

struct MenuAnchorView: NSViewRepresentable {
    let anchor: MenuAnchor
    func makeNSView(context: Context) -> NSView {
        let v = FlippedView()
        anchor.view = v
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) { anchor.view = nsView }

    final class FlippedView: NSView {
        override var isFlipped: Bool { true }
    }
}

/// The "…" button: the panel's own actions, then today's menu bar items (New Note, Quick Add Task, Search, recent
/// notes, places, Open Folevi, Settings, Quit), so nothing the menu bar menu had is lost.
struct PanelMenuButton: View {
    @Environment(QuickNotesModel.self) private var model
    @State private var anchor = MenuAnchor()

    var body: some View {
        Button {
            anchor.pop(model.panelMenu())
        } label: {
            QNIcon(.ellipsis, size: 15).frame(width: 18, height: 18)
        }
        .buttonStyle(CapsuleItemButtonStyle())
        .padding(3)
        .frame(height: 30)
        .quickGlass(.regular.interactive(), in: Capsule())
        .background(MenuAnchorView(anchor: anchor))
        .fixedSize()
        .help("More")
        .accessibilityLabel("More actions and Folevi")
    }
}
