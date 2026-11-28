import SwiftUI

/// The whole popover / pinned panel / detached window content. Built once and kept alive; the
/// panel never rebuilds its hosting view.
struct PanelRootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Namespace private var glassNamespace

    static let cornerRadius: CGFloat = 22

    var body: some View {
        let settings = model.settings
        ZStack(alignment: .top) {
            editorSurface
            if model.activeDot?.isEmpty ?? false {
                placeholder
            }
            VStack(spacing: 0) {
                TopBar(namespace: glassNamespace)
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
                Spacer(minLength: 0)
                if settings.showFooter {
                    FooterBar()
                        .padding(.horizontal, 8)
                        .padding(.bottom, 8)
                        .opacity(model.footerHidden ? 0 : 1)
                        .allowsHitTesting(!model.footerHidden)
                }
            }
            if let toast = model.toast {
                VStack {
                    Spacer()
                    ToastView(toast: toast)
                        .padding(.bottom, settings.showFooter ? 40 : 12)
                        .padding(.horizontal, 12)
                }
                .transition(Motion.isEnabled ? .move(edge: .bottom).combined(with: .opacity) : .opacity)
                .zIndex(5)
            }
            overlayView
                .zIndex(10)
        }
        .overlayPreferenceValue(DotAnchorKey.self) { anchors in
            GeometryReader { proxy in
                if let id = model.hoveredDotID, model.overlay == nil, let anchor = anchors[id],
                   let dot = model.dots.first(where: { $0.id == id }) {
                    let rect = proxy[anchor]
                    DotHoverCard(dot: dot)
                        .position(x: min(max(rect.midX, 90), proxy.size.width - 90), y: rect.maxY + 48)
                        .transition(.opacity)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: settings.isDetached ? 0 : Self.cornerRadius, style: .continuous))
        .overlay {
            if !settings.isDetached {
                RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                    .strokeBorder(borderGradient, lineWidth: contrast == .increased || A11yOverrides.increaseContrast ? 1.5 : 1)
                    .allowsHitTesting(false)
            }
        }
        .onAppear {
            model.editor.bottomInset = 34
        }
        .onContinuousHover { phase in
            if case .active = phase { model.editor.mouseMoved() }
        }
        .preferredColorScheme(colorScheme)
        .animation(Motion.fade, value: model.footerHidden)
        .animation(Motion.spring, value: model.overlay)
    }

    private var colorScheme: ColorScheme? { nil }

    private var surfaceOpacity: Double {
        if reduceTransparency || A11yOverrides.reduceTransparency { return 1 }
        if model.settings.isDetached { return 0.96 }
        return model.settings.isPinned ? 0.97 : 0.92
    }

    private var editorSurface: some View {
        EditorSurface(host: model.editor.hostView)
            .background(Color(nsColor: .textBackgroundColor).opacity(surfaceOpacity))
            .accessibilityElement(children: .contain)
    }

    /// Hairline highlight along the top edge; a real border under Increase Contrast.
    private var borderGradient: some ShapeStyle {
        if contrast == .increased || A11yOverrides.increaseContrast {
            return AnyShapeStyle(Color.primary.opacity(0.55))
        }
        return AnyShapeStyle(LinearGradient(colors: [.white.opacity(0.45), .white.opacity(0.06), .clear],
                                            startPoint: .top, endPoint: .center))
    }

    private var placeholder: some View {
        HStack {
            Text("Write, paste or drop anything. ⌘/ for shortcuts")
                .font(Font(model.settings.editorFont))
                .foregroundStyle(.tertiary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.leading, 16)
        .padding(.trailing, 16)
        .padding(.top, model.editor.topInset + 1)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .transition(.opacity)
    }

    @ViewBuilder private var overlayView: some View {
        switch model.overlay {
        case .cheatSheet:
            CheatSheetOverlay().transition(.opacity)
        case .rename(let id):
            RenameOverlay(dotID: id).transition(.opacity)
        case .link(let request):
            LinkOverlay(request: request).transition(.opacity)
        case .confirmDelete(let id):
            let name = model.dots.first { $0.id == id }?.displayName ?? ""
            ConfirmOverlay(title: "Delete “\(name)”?",
                           message: "The quick note and its text go. You can undo right after.",
                           confirmTitle: "Delete") { model.deleteDot(id) }
                .transition(.opacity)
        case nil:
            EmptyView()
        }
    }
}

/// Hosts the editor's AppKit view. Returns the same instance every time: never rebuilt.
struct EditorSurface: NSViewRepresentable {
    let host: EditorHostView
    func makeNSView(context: Context) -> EditorHostView { host }
    func updateNSView(_ nsView: EditorHostView, context: Context) {}
}
