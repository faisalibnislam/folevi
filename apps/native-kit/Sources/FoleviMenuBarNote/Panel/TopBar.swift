// The menu bar note's panel: Home's quick note (HomeBlocks.tsx CaptureField) under the menu bar. A plain box in the
// notes' serif face (Spectral 16, "What's on your mind?"), the screenshots taken for it, then "Saves to" with the place's mark and
// folder, Add as a task, Screenshot and Save (⌘Return). Pin on top, Open as a window and "…" float at the top right
// in one GlassEffectContainer. Colours, sizes and icons are the web's (the web is the standard).
import AppKit
import FoleviDesign
import SwiftUI

/// A colour of the web app's (globals.css variables), light or dark.
@MainActor
func webColor(_ name: String, _ scheme: ColorScheme, _ fallback: Color) -> Color {
    WebStyles.vars[name]?.resolve(scheme).color ?? fallback
}

struct PanelRootView: View {
    @Environment(MenuBarNoteModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    static let cornerRadius: CGFloat = 22

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer(minLength: 0)
                TopControls()
            }
            .padding(.horizontal, 8)
            .padding(.top, model.settings.isDetached ? 30 : 8)
            NoteBox()
                .padding(.horizontal, 14)
            if !model.images.isEmpty {
                ImageChips()
                    .padding(.horizontal, 20)
                    .padding(.bottom, 6)
            }
            FooterRow()
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
        }
        .background(webColor("color-surface", scheme, Color(nsColor: .textBackgroundColor)))
        .overlay(alignment: .bottom) { toastView }
        .clipShape(RoundedRectangle(cornerRadius: model.settings.isDetached ? 0 : Self.cornerRadius, style: .continuous))
        .overlay {
            if !model.settings.isDetached {
                RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                    .strokeBorder(webColor("color-line", scheme, Color.primary.opacity(0.1)).opacity(contrast == .increased ? 1 : 0.8), lineWidth: contrast == .increased ? 1.5 : 1)
                    .allowsHitTesting(false)
            }
        }
        .animation(Motion.spring, value: model.toast)
        .animation(Motion.quick, value: model.images.count)
    }

    @ViewBuilder private var toastView: some View {
        if let toast = model.toast {
            HStack(alignment: .center, spacing: 12) {
                Text(toast.message)
                    .font(QNStyle.label)
                    .foregroundStyle(webColor("color-ink", scheme, .primary))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ForEach(toast.actions) { action in
                    Button(action.title) { model.perform(action) }
                        .buttonStyle(ToastButtonStyle())
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .quickGlass(in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(10)
            .transition(Motion.isEnabled ? .move(edge: .bottom).combined(with: .opacity) : .opacity)
            .accessibilityElement(children: .contain)
        }
    }
}

/// Pin on top and Open as a window in one glass group, then "…".
struct TopControls: View {
    @Environment(MenuBarNoteModel.self) private var model

    var body: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                HStack(spacing: 0) {
                    if !model.settings.isDetached {
                        let pinned = model.settings.isPinned
                        GlassIconButton(icon: .pin, help: pinned ? "Unpin (⇧⌘P)" : "Pin on top (⇧⌘P)", label: pinned ? "Unpin" : "Pin on top", tint: pinned ? Color.accentColor : nil, on: pinned) {
                            model.panel?.togglePin()
                        }
                    }
                    GlassIconButton(icon: model.settings.isDetached ? .arrowUpToLine : .appWindow, help: model.settings.isDetached ? "Back to the menu bar (⌥⌘D)" : "Open as a window (⌥⌘D)",
                                    label: model.settings.isDetached ? "Back to the menu bar" : "Open as a window") {
                        model.panel?.toggleDetach()
                    }
                }
                .padding(.horizontal, 3)
                .frame(height: 30)
                .quickGlass(.regular.interactive(), in: Capsule())
                PanelMenuButton()
            }
        }
    }
}

/// The box: plain text as a note's body text, Home's "What's on your mind?".
struct NoteBox: View {
    @Environment(MenuBarNoteModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        @Bindable var model = model
        ZStack(alignment: .topLeading) {
            PlainTextBox(text: $model.text, focusRequest: model.focusRequest, ink: NSColor(webColor("color-ink", scheme, .primary)))
                .accessibilityLabel("New note")
            if model.text.isEmpty {
                Text("What’s on your mind?")
                    .font(PlainTextBox.swiftUIFont)
                    .frame(height: PlainTextBox.lineHeight, alignment: .bottom)
                    .foregroundStyle(webColor("color-ink-faint", scheme, .secondary))
                    .padding(.leading, PlainTextBox.inset.width + 5)
                    .padding(.top, PlainTextBox.inset.height)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// An NSTextView for plain text: no rich text or images, spelling as everywhere in Folevi, the keyboard on request.
struct PlainTextBox: NSViewRepresentable {
    @Binding var text: String
    let focusRequest: Int
    let ink: NSColor

    /// Spectral, the notes' serif face, at 16 pt with the serif note's line height (editor.css: line-height 1.62; the
    /// owner, 2026-11-28: serif, 16 pt).
    static let size: CGFloat = 16
    static let lineHeight: CGFloat = (16 * 1.62).rounded()
    static var nsFont: NSFont { FoleviFonts.nsFont(.display, size: size) }
    static var swiftUIFont: Font { FoleviFonts.font(.display, size: size) }
    static let inset = NSSize(width: 6, height: 6)

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        let view = scroll.documentView as! NSTextView
        view.delegate = context.coordinator
        view.isRichText = false
        view.importsGraphics = false
        view.allowsUndo = true
        view.drawsBackground = false
        view.font = Self.nsFont
        view.textColor = ink
        view.insertionPointColor = ink
        view.textContainerInset = Self.inset
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = Self.lineHeight
        paragraph.maximumLineHeight = Self.lineHeight
        view.defaultParagraphStyle = paragraph
        view.typingAttributes = [.font: Self.nsFont, .foregroundColor: ink, .paragraphStyle: paragraph]
        view.isContinuousSpellCheckingEnabled = true
        view.isAutomaticQuoteSubstitutionEnabled = true
        view.string = text
        context.coordinator.lastFocus = focusRequest
        DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? NSTextView else { return }
        context.coordinator.parent = self
        if view.string != text { view.string = text }
        view.textColor = ink
        view.insertionPointColor = ink
        if context.coordinator.lastFocus != focusRequest {
            context.coordinator.lastFocus = focusRequest
            DispatchQueue.main.async {
                view.window?.makeFirstResponder(view)
                view.setSelectedRange(NSRange(location: (view.string as NSString).length, length: 0))
            }
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: PlainTextBox
        var lastFocus = 0
        init(_ parent: PlainTextBox) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            parent.text = view.string
        }
    }
}

/// The screenshots that go with the note: small thumbnails, each with a remove button.
struct ImageChips: View {
    @Environment(MenuBarNoteModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.images) { image in
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if let picture = NSImage(data: image.data) {
                                Image(nsImage: picture).resizable().scaledToFill()
                            } else {
                                Color.primary.opacity(0.06)
                            }
                        }
                        .frame(width: 56, height: 42)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(webColor("color-line", scheme, Color.primary.opacity(0.1)), lineWidth: 1))
                        Button { model.removeImage(image.id) } label: {
                            QNIcon(.x, size: 10)
                                .frame(width: 16, height: 16)
                                .background(Circle().fill(webColor("color-surface", scheme, .white)))
                                .overlay(Circle().strokeBorder(webColor("color-line", scheme, Color.primary.opacity(0.1)), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .offset(x: 5, y: -5)
                        .foleviTooltip("Remove")
                        .accessibilityLabel("Remove \(image.name)")
                    }
                    .padding(.top, 5)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(image.name)
                }
            }
            .padding(.trailing, 6)
        }
    }
}

/// "Saves to" and where, then Add as a task, Screenshot and Save, as Home's box ends.
struct FooterRow: View {
    @Environment(MenuBarNoteModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 6) {
            Text("Saves to")
                .font(QNStyle.label)
                .foregroundStyle(webColor("color-ink-faint", scheme, .secondary))
                .lineLimit(1)
                .fixedSize()
                .padding(.leading, 6)
            // Whole when there's room; a long folder name gives way (truncated in the middle) before the buttons do.
            DestinationButton()
                .layoutPriority(1)
            Spacer(minLength: 4)
            // The hint only when there's room for it (Home shows it on wide boxes too).
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    if model.canSave {
                        Text("⌘↩ to save").font(QNStyle.meta).foregroundStyle(webColor("color-ink-faint", scheme, .secondary)).lineLimit(1).fixedSize()
                    }
                    tools
                }
                tools
            }
        }
    }

    private var tools: some View {
        HStack(spacing: 6) {
            QuietIconButton(icon: .squareCheckBig, help: "Add as a task (⇧⌘Return)", label: "Add as a task", enabled: model.canAddTask) { model.addTask() }
            QuietIconButton(icon: .camera, help: "Screenshot (⇧⌘5)", label: "Take a screenshot for this note", enabled: !model.busy) { model.capture(.region) }
            Button {
                model.save()
            } label: {
                if model.busy { ProgressView().controlSize(.mini).tint(webColor("color-accent-ink", scheme, .white)) } else { Text("Save").lineLimit(1).fixedSize() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.canSave)
            .foleviTooltip("Save (⌘Return)")
            .accessibilityLabel("Save to \(model.destination.label)")
        }
    }
}

/// Where the note goes: the place's mark, then Drafts or the folder, and a chevron; a menu picks it.
struct DestinationButton: View {
    @Environment(MenuBarNoteModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var anchor = MenuAnchor()
    @State private var hovering = false

    var body: some View {
        let destination = model.destination
        Button {
            anchor.pop(model.destinationMenu())
        } label: {
            HStack(spacing: 6) {
                SpaceMark(space: model.spaces?.first { $0.id == destination.space }, name: destination.spaceName, size: 16)
                Text(destination.label)
                    .font(QNStyle.labelStrong)
                    .lineLimit(1)
                    .truncationMode(.middle)
                QNIcon(.chevronDown, size: 12)
            }
            .foregroundStyle(webColor(hovering ? "color-heading" : "color-ink-muted", scheme, .primary))
            .padding(.horizontal, 8)
            .frame(minWidth: 90, maxHeight: 28)
            .frame(height: 28)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(hovering ? webColor("glass-hover", scheme, Color.primary.opacity(0.07)) : .clear))
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .background(MenuAnchorView(anchor: anchor))
        .foleviTooltip("Where it saves")
        .accessibilityLabel("Saves to \(destination.spaceName), \(destination.folderName ?? "Drafts")")
        .accessibilityHint("Opens a menu of workspaces and folders.")
    }
}

/// Home's quiet tool button (`ui-btn ui-btn-quiet`): muted icon, a soft fill on hover, faded when it can't be used.
struct QuietIconButton: View {
    let icon: WebIcon
    let help: String
    let label: String
    var enabled = true
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            QNIcon(icon, size: 16)
                .foregroundStyle(webColor(hovering && enabled ? "color-heading" : "color-ink-muted", scheme, .secondary))
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(hovering && enabled ? webColor("glass-hover", scheme, Color.primary.opacity(0.07)) : .clear))
                .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .onHover { hovering = $0 }
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }
}

/// Home's Save (`ui-btn ui-btn-primary`): the accent fill with its ink, half faded while there's nothing to save.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var scheme
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(QNStyle.labelStrong)
            .foregroundStyle(webColor("color-accent-ink", scheme, .white))
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(webColor("color-accent", scheme, .accentColor)))
            .brightness(configuration.isPressed ? -0.04 : (hovering && enabled ? 0.05 : 0))
            .opacity(enabled ? 1 : 0.5)
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .onHover { hovering = $0 }
    }
}

/// An icon button inside a glass group: no glass of its own (no glass on glass), a soft hover and press highlight.
struct GlassIconButton: View {
    let icon: WebIcon
    let help: String
    let label: String
    var tint: Color?
    /// A toggle that's on (Pin on top): a soft accent fill behind the icon.
    var on = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            QNIcon(icon, size: 15)
                .foregroundStyle(tint ?? .primary)
                .frame(width: 18, height: 18)
        }
        .buttonStyle(CapsuleItemButtonStyle(on: on))
        .accessibilityAddTraits(on ? .isSelected : [])
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }
}

struct CapsuleItemButtonStyle: ButtonStyle {
    var on = false
    /// The highlight's size: 28 by 24 inside a group, the whole button for the round "…".
    var size = CGSize(width: 28, height: 24)
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: size.width, height: size.height)
            .background {
                if on { Capsule().fill(Color.accentColor.opacity(0.16)) }
                Capsule().fill(Color.primary.opacity(configuration.isPressed ? 0.14 : (hovering ? 0.07 : 0)))
            }
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
        // A round glass button as tall as the groups beside it (Notlet's "…").
        .buttonStyle(CapsuleItemButtonStyle(size: CGSize(width: 30, height: 30)))
        .quickGlass(.regular.interactive(), in: Circle())
        .background(MenuAnchorView(anchor: anchor))
        .fixedSize()
        .foleviTooltip("More")
        .accessibilityLabel("More actions and Folevi")
    }
}

/// The toast's button: accent text on a light fill, clear in an inactive panel (the system's glass button greys out
/// when Folevi isn't the active app).
struct ToastButtonStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(QNStyle.labelStrong)
            .foregroundStyle(Color.accentColor)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(Capsule().fill(Color.accentColor.opacity(configuration.isPressed ? 0.22 : (hovering ? 0.16 : 0.1))))
            .contentShape(Capsule())
            .onHover { hovering = $0 }
    }
}

/// A space's mark, as the app's workspace menu draws it (WorkspaceMenu.tsx PersonalMark and WorkspaceLogo): the
/// picture in a small rounded square, or the name's initial on a neutral tile.
struct SpaceMark: View {
    let space: NoteSpace?
    let name: String
    var size: CGFloat = 16
    @Environment(\.colorScheme) private var scheme

    private var radius: CGFloat { size * 6 / 24 }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        Group {
            if let string = space?.imageUrl, let url = URL(string: string), url.scheme == "https" {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { initial }
                }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var initial: some View {
        let source = (space?.markName ?? name).trimmingCharacters(in: .whitespaces)
        return Text(String(source.first ?? "?").uppercased())
            .font(FoleviFonts.font(.ui, size: max(9, (size * 0.5).rounded()), weight: .semibold))
            .foregroundStyle(webColor("color-heading", scheme, .primary))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(webColor("color-surface-sunken", scheme, Color.primary.opacity(0.06)))
    }
}
