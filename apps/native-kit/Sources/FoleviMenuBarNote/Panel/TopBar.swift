// The panel: a glass bar over the note (where new notes go, then New, Screenshot, Pin on top, Open as a window and
// the "…" menu, in one GlassEffectContainer so they merge and morph), and Folevi's own editor on the note below it.
import AppKit
import FoleviDesign
import SwiftUI

struct PanelRootView: View {
    @Environment(MenuBarNoteModel.self) private var model
    @Environment(\.colorSchemeContrast) private var contrast

    static let cornerRadius: CGFloat = 22
    static let barHeight: CGFloat = 46

    var body: some View {
        // The note fills the panel; the glass bar floats over its top (Notlet's layout), so the note's paper runs
        // to the panel's edges. In a window the bar sits under the title bar's buttons.
        ZStack(alignment: .top) {
            NoteSurface(view: model.host?.noteView)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Note")
            TopBar()
                .padding(.horizontal, 8)
                .padding(.top, model.settings.isDetached ? 30 : 8)
        }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                HStack(spacing: 10) {
                    Text(toast)
                        .font(QNStyle.label)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    if let action = model.toastAction {
                        Button(action.title) {
                            model.toast = nil
                            action.run()
                        }
                        .font(QNStyle.labelStrong)
                        .buttonStyle(.glass)
                        .controlSize(.small)
                    }
                }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .quickGlass(in: Capsule())
                    .padding(12)
                    .onTapGesture { Motion.animate(Motion.fade) { model.toast = nil } }
                    .transition(Motion.isEnabled ? .move(edge: .bottom).combined(with: .opacity) : .opacity)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: model.settings.isDetached ? 0 : Self.cornerRadius, style: .continuous))
        .overlay {
            if !model.settings.isDetached {
                RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                    .strokeBorder(contrast == .increased || A11yOverrides.increaseContrast ? AnyShapeStyle(Color.primary.opacity(0.55)) : AnyShapeStyle(LinearGradient(colors: [.white.opacity(0.45), .white.opacity(0.06), .clear], startPoint: .top, endPoint: .center)), lineWidth: contrast == .increased ? 1.5 : 1)
                    .allowsHitTesting(false)
            }
        }
        .animation(Motion.spring, value: model.toast)
    }
}

/// Hosts the note's web view (the host's, made once): moved between the popover and the window, never rebuilt.
struct NoteSurface: NSViewRepresentable {
    let view: NSView?
    func makeNSView(context: Context) -> NSView {
        let box = NSView()
        place(view, in: box)
        return box
    }
    func updateNSView(_ box: NSView, context: Context) { place(view, in: box) }

    private func place(_ view: NSView?, in box: NSView) {
        guard let view, view.superview !== box else { return }
        view.removeFromSuperview()
        view.frame = box.bounds
        view.autoresizingMask = [.width, .height]
        box.addSubview(view)
    }
}

struct TopBar: View {
    @Environment(MenuBarNoteModel.self) private var model

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 8) {
                DestinationButton()
                    .layoutPriority(1)
                Spacer(minLength: 0)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        actionGroup { sendButton; newButton; screenshotButton; if !model.settings.isDetached { pinButton }; windowButton }
                        PanelMenuButton()
                    }
                    HStack(spacing: 8) {
                        actionGroup { sendButton; newButton; screenshotButton }
                        PanelMenuButton()
                    }
                    PanelMenuButton()
                }
            }
        }
    }

    private func actionGroup<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 0) { content() }
            .padding(.horizontal, 3)
            .frame(height: 30)
            .quickGlass(.regular.interactive(), in: Capsule())
    }

    private var sendButton: some View {
        GlassIconButton(icon: .send, help: "Send to Folevi (⌘Return)", label: "Send to Folevi") { model.sendToFolevi() }
            .disabled(model.noteID == nil)
            .opacity(model.noteID == nil ? 0.4 : 1)
    }

    private var newButton: some View {
        GlassIconButton(icon: .plus, help: "New note (⌘N)", label: "New note") { model.newNote() }
    }

    private var screenshotButton: some View {
        GlassIconButton(icon: .camera, help: "Screenshot (⇧⌘5)", label: "Take a screenshot into this note") { model.capture(.region) }
    }

    private var pinButton: some View {
        let pinned = model.settings.isPinned
        return GlassIconButton(icon: pinned ? .pinOff : .pin, help: pinned ? "Unpin (⇧⌘P)" : "Pin on top (⇧⌘P)",
                               label: pinned ? "Unpin" : "Pin on top", tint: pinned ? Color.accentColor : nil) {
            model.panel?.togglePin()
        }
    }

    private var windowButton: some View {
        GlassIconButton(icon: model.settings.isDetached ? .arrowUpToLine : .appWindow, help: model.settings.isDetached ? "Back to the menu bar (⌥⌘D)" : "Open as a window (⌥⌘D)",
                        label: model.settings.isDetached ? "Back to the menu bar" : "Open as a window") {
            model.panel?.toggleDetach()
        }
    }
}

/// Where new notes go (Drafts by default): always in sight, picked from a menu, remembered.
struct DestinationButton: View {
    @Environment(MenuBarNoteModel.self) private var model
    @State private var anchor = MenuAnchor()
    @State private var hovering = false

    var body: some View {
        let destination = model.destination
        Button {
            anchor.pop(model.destinationMenu())
        } label: {
            HStack(spacing: 5) {
                QNIcon(destination.folderId == nil ? .inbox : .folder, size: 14)
                Text(destination.label)
                    .font(QNStyle.label)
                    .lineLimit(1)
                    .truncationMode(.middle)
                QNIcon(.chevronsUpDown, size: 12).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(Capsule().fill(Color.primary.opacity(hovering ? 0.07 : 0)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .onHover { hovering = $0 }
        .quickGlass(.regular.interactive(), in: Capsule())
        .background(MenuAnchorView(anchor: anchor))
        .foleviTooltip("Where new notes go")
        .accessibilityLabel("New notes go to \(destination.spaceName), \(destination.folderName ?? "Drafts")")
        .accessibilityHint("Opens a menu of workspaces and folders.")
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
        .foleviTooltip(help)
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

    func pop(_ menu: NSMenu) {
        guard let view else { return }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: view.bounds.height + 4), in: view)
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

/// The "…" button: the panel's actions, then today's menu bar items, so nothing the menu bar menu had is lost.
struct PanelMenuButton: View {
    @Environment(MenuBarNoteModel.self) private var model
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
        .foleviTooltip("More")
        .accessibilityLabel("More actions and Folevi")
    }
}
