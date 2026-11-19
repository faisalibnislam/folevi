// Ask Foli AI (⌘J) as the web draws it (apps/web/src/components/ai/AskAiChat.tsx and AskAiPanel.tsx): the black
// floating button in the bottom-right corner of every page but a note and the AI page, and the chat it opens
// above it. The chat isn't modal (you keep working while it's open), keeps its conversation while closed,
// starts afresh with New chat, and moves to the AI page with Open in full view. With history off, closing it
// deletes the conversation (FoliChatModel.closed).
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The window's floating chat: its model, kept for the window's life (made on first use, as the web loads the
/// chat's code on first use).
@MainActor
@Observable
final class AiAskState {
    /// The chat's height: 640, or the window's height less 136 when that's smaller (`min(640px,100dvh-136px)`).
    var maxHeight: CGFloat = 640
    @ObservationIgnored private let frame: FrameModel
    private var made: FoliChatModel?
    @ObservationIgnored let feedback: ScreenFeedback

    init(frame: FrameModel, feedback: ScreenFeedback) {
        self.frame = frame
        self.feedback = feedback
    }

    var model: FoliChatModel {
        if let made { return made }
        let m = FoliChatModel(client: frame.client, feedback: feedback)
        m.onOpen = { [weak frame] route in
            guard let frame, let r = FrameNavigation.route(route) else { return }
            frame.askAiOpen = false
            frame.open(r)
        }
        m.onClose = { [weak frame] in frame?.askAiOpen = false }
        made = m
        return m
    }
}

/// The button and, when open, the chat above it. Sized to what it shows, so the page under it keeps its clicks.
struct AiAskOverlay: View {
    @Bindable var frame: FrameModel
    let state: AiAskState
    /// The floating button (the iPad has none: Shell.tsx `hideLauncher` there; ⌘J and the menus open the chat).
    var launcher = true
    @Environment(\.colorScheme) private var scheme

    /// The web places them on the window (`bottom-9 right-9`, the chat `bottom-[104px]`); this view sits in the
    /// content card, which is inset from the window.
    static var cardInset: CGFloat {
        let c = WebStyles.named("frame.content").light
        return c.y
    }

    /// The room a scrolling page leaves under its last row so it scrolls clear of the floating button (the web's
    /// --fab-clearance): the button's top above the card's bottom edge plus a 24 pt gap (100 pt, as the measured
    /// pages' bottom padding), none on the iPad, which has no button. Pages pad their end by at least this.
    static var clearance: CGFloat {
        #if os(iOS)
        // (The iPad's wide layout has the Mac's button since the native look; the web-matched layout had none.)
        guard !WebStyles.isPad || MacLook.padWide else { return 0 }
        #endif
        let fab = WebStyles.named("ai.fab").light
        return 820 - fab.y - cardInset + 24
    }

    /// How far above the card's bottom edge the chat's own bottom edge sits in the native look (the button's inset,
    /// the button, the gap between them), plus the air it keeps under the card's controls.
    static var panelLift: CGFloat {
        let fab = WebStyles.named("ai.fab").light
        let panel = WebStyles.named("ai.panel").light
        return launcherInset.bottom + MacLook.barControlHeight + 4 + (fab.y - (panel.y + panel.height)) + MacLook.Space.s
    }

    /// The button's distance from the card's trailing and bottom edges: the web's on the Mac; on the iPad's wide
    /// layout the card's own control inset and a touch more, so it sits inside the card's rounded corner.
    static var launcherInset: (trailing: CGFloat, bottom: CGFloat) {
        let fab = WebStyles.named("ai.fab").light
        #if os(iOS)
        if MacLook.padWide { return (MacLook.barPaddingSides + 8, MacLook.barPaddingSides + 8) }
        #endif
        return (1280 - (fab.x + fab.width) - cardInset, 820 - (fab.y + fab.height) - cardInset)
    }

    private var shows: Bool {
        guard frame.session.value?.capabilities.ai ?? false else { return false }
        // Not over Settings either (MAC-21): it sat over the cards there, and Settings has its own Foli AI section.
        return !frame.route.isNote && frame.route.tabKey != "view:ai" && frame.route.tabKey != "view:settings"
    }

    var body: some View {
        let look = AiLook(scheme: scheme)
        let fab = look.s("ai.fab")
        let panel = look.s("ai.panel")
        VStack(alignment: .trailing, spacing: fab.y - (panel.y + panel.height)) {
            if shows, frame.askAiOpen {
                AiAskPanelView(frame: frame, model: state.model, height: min(panel.height, state.maxHeight))
                    .transition(.asymmetric(insertion: .scale(scale: 0.96, anchor: .bottomTrailing).combined(with: .opacity), removal: .opacity))
            }
            if shows, launcher {
                AiLauncher(open: frame.askAiOpen, thinking: frame.askAiOpen ? false : (state.isWorking)) {
                    if frame.askAiOpen { close() } else { frame.askAiOpen = true }
                }
            }
        }
        // (The iPad has no button: the chat floats over the card's corner, 16 points in, with its own shadow, as
        // the Mac's floating window gets one from the system.)
        .compositingGroup()
        .nativeShadow(launcher ? nil : .overlay)
        .padding(.trailing, launcher ? Self.launcherInset.trailing : 16)
        .padding(.bottom, launcher ? Self.launcherInset.bottom : 16)
        .animation(.easeOut(duration: 0.18), value: frame.askAiOpen)
        .onChange(of: frame.askAiOpen) { _, open in if !open { state.model.closed() } }
        .onChange(of: frame.askAbout, initial: true) { _, about in
            guard let about else { return }
            state.model.reopen(about: .folder(id: about.id, name: about.name))
            frame.askAbout = nil
        }
        .onChange(of: frame.askQuestion, initial: true) { _, question in
            guard let question else { return }
            state.model.newChat()
            state.model.draft = question
            frame.askQuestion = nil
        }
        // (System type and controls in the floating chat on the Mac, as the Foli AI page; the iPad keeps the web's.)
        .nativeDialogContent()
    }

    private func close() {
        frame.askAiOpen = false
    }
}

extension AiAskState {
    /// Foli AI is answering in the floating chat (the button's flower drifts meanwhile).
    var isWorking: Bool { made?.isWorking ?? false }
}

/// The black floating button (AskAiLauncher): the flower, or × while the chat is open, and "Ask Foli AI".
struct AiLauncher: View {
    let open: Bool
    var thinking = false
    let action: () -> Void
    @State private var over = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The native look: a regular Liquid Glass capsule, not a second coloured action beside New note
    /// (liquid-glass.md: refrain from adding colour to the background of more than one control).
    @Environment(\.macNativeLook) private var native

    var body: some View {
        if native { glass } else { web }
    }

    private var glass: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if open { MacSymbol("xmark", size: 13, weight: .semibold) } else { AiMarkGlyph(size: 16).rotationEffect(.degrees(thinking && !reduceMotion ? 20 : 0)) }
                Text("Ask Foli AI").font(MacLook.Text.body.weight(.medium)).lineLimit(1)
            }
            .foregroundStyle(MacLook.Colors.label)
            .padding(.horizontal, 16)
            .frame(height: MacLook.barControlHeight + 4)
            .contentShape(Capsule())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .nativeGlass(Capsule(), interactive: true)
        // It says "Ask Foli AI": the tooltip is its shortcut alone (or what a click does while it is open).
        .foleviTooltip(open ? "Close Foli AI" : "(⌘J)")
        .accessibilityLabel(open ? "Close Foli AI" : "Ask Foli AI")
        .accessibilityValue(open ? "Open" : "Closed")
    }

    private var web: some View {
        let look = AiLook(scheme: scheme)
        let s = look.s("ai.fab")
        return Button(action: action) {
            HStack(spacing: s.gap) {
                if open { WebIconView(.x, size: 18) } else { AiMarkGlyph(size: 17).rotationEffect(.degrees(thinking && !reduceMotion ? 20 : 0)) }
                Text("Ask Foli AI").webText(look.text("ai.fab.label")).lineLimit(1)
            }
            .padding(.leading, s.padding.left)
            .padding(.trailing, s.padding.right)
            .frame(height: s.height)
            .foregroundStyle(s.color.color)
            .background {
                // `hover:bg-[#1c1c1f]` over the black, with the web's shadows and inner hairline.
                Color.clear.webBox(WebStyles.named("ai.fab"))
                if over { RoundedRectangle(cornerRadius: s.radius).fill(Color(red: 0x1c / 255, green: 0x1c / 255, blue: 0x1f / 255)) }
            }
            // (No lift on hover, MAC-58: nothing moves under the pointer on the Mac, and the click area stays put.)
            .contentShape(Rectangle())
        }
        .buttonStyle(.webPlain)
        .onHover { over = $0 }
        .animation(.easeOut(duration: 0.2), value: over)
        // It says "Ask Foli AI": the tooltip is its shortcut alone (or what a click does while it is open).
        .foleviTooltip(open ? "Close Foli AI" : "(⌘J)")
        .accessibilityLabel(open ? "Close Foli AI" : "Ask Foli AI")
        .accessibilityValue(open ? "Open" : "Closed")
    }
}

/// The floating chat's surface. The Mac's native look: Liquid Glass (a panel floating over the page, the owner,
/// 2026-11-18) with a soft shadow of its own. Elsewhere the web's `ui-pop`: its translucent fill over a backdrop
/// blur, the hairlines and the soft shadow.
struct AiAskSurface: ViewModifier {
    let radius: CGFloat
    @Environment(\.macNativeLook) private var native

    func body(content: Content) -> some View {
        if native {
            let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
            content
                .clipShape(shape)
                .nativeGlass(shape)
                .nativeShadow(.overlay)
        } else {
            web(content)
        }
    }

    private func web(_ content: Content) -> some View {
        content
            .clipShape(RoundedRectangle(cornerRadius: radius))
            .background { Color.clear.webBox(WebStyles.named("ai.panel")) }
            .background { RoundedRectangle(cornerRadius: radius).fill(.regularMaterial) }
    }
}

/// The chat (AskAiPanel.tsx): header with the flower, "Foli AI", the conversation's options, New chat, Open in
/// full view and Close, then the thread.
struct AiAskPanelView: View {
    @Bindable var frame: FrameModel
    let model: FoliChatModel
    var height: CGFloat = 640
    @Environment(\.colorScheme) private var scheme

    var host: AiHost { AiHost(session: frame.session.value, frame: frame, openSettings: { [weak frame] s in frame?.askAiOpen = false; frame?.host?.frameOpenSettings(section: s) }) }

    var body: some View {
        let look = AiLook(scheme: scheme)
        let p = look.s("ai.panel")
        let h = look.s("ai.panel.header")
        VStack(spacing: 0) {
            HStack(spacing: h.gap) {
                AiMarkGlyph(size: 20).padding(.trailing, look.s("ai.panel.mark").margin.right)
                Text("Foli AI").webText(look.text("ai.panel.title")).lineLimit(1).foregroundStyle(look.heading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                if let id = model.conversationId, model.info != nil {
                    WebMenuButton(width: 240, hover: look.s("ai.panel.button").radius, entries: { AiConversationMenu.entries(model: model, host: host, id: id, title: model.title, shared: model.info?.shared ?? false, ephemeral: model.info?.ephemeral ?? false, includeRows: false) }) {
                        headerIcon(.ellipsis, look: look)
                    }
                    .buttonStyle(AiHoverStyle(radius: look.s("ai.panel.button").radius))
                    .accessibilityLabel("Conversation options")
                }
                headerButton(.plus, "New chat", look: look) { model.newChat() }
                headerButton(.maximize2, "Open in full view", look: look) {
                    frame.askAiOpen = false
                    frame.open(.web(model.conversationId.map { "/ai/\($0)" } ?? "/ai"))
                }
                headerButton(.x, "Close chat", look: look) { frame.askAiOpen = false }
            }
            .padding(h.padding.edgeInsets)
            // `border-b`: the header's 57 pt include its line.
            .padding(.bottom, 1)
            .overlay(alignment: .bottom) { Rectangle().fill(look.line70).frame(height: 1) }
            AiThreadView(model: model, variant: .floating, host: host)
        }
        .frame(width: p.width, height: height)
        .modifier(AiAskSurface(radius: p.radius))
        .onKeyPress(.escape) {
            frame.askAiOpen = false
            return .handled
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Foli AI")
    }

    private func headerIcon(_ icon: WebIcon, look: AiLook) -> some View {
        let b = look.s("ai.panel.button")
        return WebIconView(icon, size: icon == .maximize2 ? 15 : 16)
            .frame(width: b.width, height: b.height)
            .foregroundStyle(b.color.color)
            .contentShape(Rectangle())
    }

    private func headerButton(_ icon: WebIcon, _ label: String, look: AiLook, action: @escaping () -> Void) -> some View {
        Button(action: action) { headerIcon(icon, look: look) }
            .buttonStyle(AiHoverStyle(radius: look.s("ai.panel.button").radius))
            .foleviTooltip(label)
            .accessibilityLabel(label)
    }
}
#endif
