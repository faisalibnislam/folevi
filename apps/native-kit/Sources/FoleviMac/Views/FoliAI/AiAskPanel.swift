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

    private var shows: Bool {
        guard frame.session.value?.capabilities.ai ?? false else { return false }
        return !frame.route.isNote && frame.route.tabKey != "view:ai"
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
        .padding(.trailing, 1280 - (fab.x + fab.width) - Self.cardInset)
        .padding(.bottom, 820 - (fab.y + fab.height) - Self.cardInset)
        .animation(.easeOut(duration: 0.18), value: frame.askAiOpen)
        .onChange(of: frame.askAiOpen) { _, open in if !open { state.model.closed() } }
        .onChange(of: frame.askAbout, initial: true) { _, about in
            guard let about else { return }
            state.model.reopen(about: .folder(id: about.id, name: about.name))
            frame.askAbout = nil
        }
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

    var body: some View {
        let look = AiLook(scheme: scheme)
        let s = look.s("ai.fab")
        Button(action: action) {
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
            .offset(y: over && !reduceMotion ? -2 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { over = $0 }
        .animation(.easeOut(duration: 0.2), value: over)
        // It says "Ask Foli AI": the tooltip is its shortcut alone (or what a click does while it is open).
        .foleviTooltip(open ? "Close Foli AI" : "(⌘J)")
        .accessibilityLabel(open ? "Close Foli AI" : "Ask Foli AI")
        .accessibilityValue(open ? "Open" : "Closed")
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
                    WebMenuButton(width: 240, entries: { AiConversationMenu.entries(model: model, host: host, id: id, title: model.title, shared: model.info?.shared ?? false, ephemeral: model.info?.ephemeral ?? false, includeRows: false) }) {
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
        .clipShape(RoundedRectangle(cornerRadius: p.radius))
        // The web's `ui-pop`: its translucent fill over a 24 pt backdrop blur, the hairlines and the soft shadow.
        .background { Color.clear.webBox(WebStyles.named("ai.panel")) }
        .background { RoundedRectangle(cornerRadius: p.radius).fill(.regularMaterial) }
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
