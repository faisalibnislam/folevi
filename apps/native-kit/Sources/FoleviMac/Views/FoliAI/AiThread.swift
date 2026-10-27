// One Foli AI conversation as the web draws it (apps/web/src/components/ai/chat/ChatThread.tsx): the messages
// (or Meet Foli AI and its suggestions while it's new), following the answer as it streams unless you scroll up
// to read ("Jump to latest" brings you back), and the dock: what Foli AI reads (chips, Add), the box that grows
// from two lines to six (Return sends, Shift-Return a new line), Send, and the footnote. The AI page and the
// floating chat both use it (`variant`); FoliChatModel (FoleviScreens) talks to the engine.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

enum AiVariant { case page, floating }

/// The window's facts the chat needs from the frame: the session (mode, place, purchases) and what to open.
@MainActor
struct AiHost {
    var session: SessionValue?
    var openSettings: (String) -> Void = { _ in }
    var openPolicy: () -> Void = { NSWorkspace.shared.open(URL(string: "https://folevi.com/ai-policy")!) }
    var local: Bool { session?.mode == .local }
    var purchases: Bool { session?.capabilities.purchases ?? false }
    /// "All notes" in Personal, "Workspace" in a workspace (ContextChips.tsx).
    var whole: String { (session?.space ?? "personal") == "personal" ? "All notes" : "Workspace" }
}

struct AiThreadView: View {
    @Bindable var model: FoliChatModel
    let variant: AiVariant
    let host: AiHost
    var autoFocus = true
    @Environment(\.colorScheme) private var scheme
    @State private var following = true
    @State private var behind = false
    @FocusState private var focused: Bool

    private var page: Bool { variant == .page }

    var body: some View {
        let look = AiLook(scheme: scheme)
        VStack(spacing: 0) {
            ZStack(alignment: .bottom) {
                scroller(look: look)
                if behind {
                    Button { jump() } label: {
                        HStack(spacing: 6) {
                            WebIconView(.arrowDown, size: 14)
                            Text("Jump to latest").webText(.role(.subheadline, weight: 500)).lineLimit(1)
                        }
                        .padding(.horizontal, 12).frame(height: 32)
                        .foregroundStyle(look.heading)
                        .background(Capsule().fill(look.color("color-surface-raised")).shadow(color: .black.opacity(0.25), radius: 7, y: 4))
                        .overlay(Capsule().strokeBorder(Color.black.opacity(0.12), lineWidth: 0.5))
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 12)
                    .transition(.opacity)
                }
            }
            dock(look: look)
        }
        .onAppear { if autoFocus { DispatchQueue.main.async { focused = true } } }
        .onReceive(NotificationCenter.default.publisher(for: AiThreadView.focusComposer)) { _ in focused = true }
    }

    /// ⌘J on the AI page: the box takes the keys (the web's AI_FOCUS_EVENT).
    static let focusComposer = FrameModel.focusAiComposer

    // MARK: the thread

    @State private var scrollProxy: ScrollViewProxy?

    private func scroller(look: AiLook) -> some View {
        let t = look.s(page ? "ai.thread" : "ai.panel.thread")
        let streamLength = model.streamingMessage.flatMap { model.answer($0.id)?.shownText.count } ?? 0
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    content(look: look)
                    Color.clear.frame(height: 0).id("end")
                }
                .frame(maxWidth: page ? 768 : .infinity, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(t.padding.edgeInsets)
            }
            .scrollIndicators(.automatic)
            // A new chat reads from its top (the welcome); a conversation from its end.
            .defaultScrollAnchor(.top, for: .alignment)
            .defaultScrollAnchor(model.isEmpty ? .top : .bottom, for: .initialOffset)
            // While the welcome shows, the box under it settling its height keeps the top where it is.
            .defaultScrollAnchor(model.isEmpty ? .top : .bottom, for: .sizeChanges)
            .onScrollGeometryChange(for: Bool.self) { g in
                g.contentSize.height - g.contentOffset.y - g.containerSize.height < 56
            } action: { _, atEnd in
                following = atEnd
                if atEnd { behind = false }
            }
            .onChange(of: model.messages.count + (model.shownPending == nil ? 0 : 1)) { _, _ in
                guard !model.isEmpty else { return }
                following = true
                behind = false
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: streamLength) { _, _ in
                if following { proxy.scrollTo("end", anchor: .bottom) } else { behind = true }
            }
            .onAppear {
                scrollProxy = proxy
                if !model.isEmpty { proxy.scrollTo("end", anchor: .bottom) }
            }
        }
    }

    private func jump() {
        following = true
        behind = false
        withAnimation(.easeOut(duration: 0.25)) { scrollProxy?.scrollTo("end", anchor: .bottom) }
    }

    @ViewBuilder
    private func content(look: AiLook) -> some View {
        if model.isLoading {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading the conversation…").webText(.role(.subheadline)).foregroundStyle(look.muted)
            }
            .padding(.horizontal, 4)
        }
        if model.isMissing {
            Text("This conversation isn't here anymore. Ask something to start a new one.").webText(.role(.body)).foregroundStyle(look.muted).padding(.horizontal, 4)
        }
        if model.isEmpty, !model.isLoading {
            if page { AiPageIntro(model: model, host: host) } else { AiFloatingIntro(model: model, host: host) }
        }
        let messages = model.messages
        let lastUser = model.lastUserMessageId
        ForEach(Array(messages.enumerated()), id: \.element.id) { i, m in
            if m.role == .user {
                AiUserMessage(text: m.text, onEdit: m.id == lastUser && model.conversationId != nil ? { text in
                    model.edit(m)
                    model.draft = text
                    model.send()
                } : nil, disabled: model.isWorking)
            } else {
                AiAssistantMessage(model: model, message: m, last: i == messages.count - 1, purchases: host.purchases) { host.openSettings("billing") }
            }
        }
        if let p = model.shownPending {
            AiUserMessage(text: p.text)
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Thinking…").webText(.role(.subheadline)).foregroundStyle(look.muted)
            }
            .padding(.horizontal, 4)
        }
        if let problem = model.problemError {
            AiProblemNotice(problem: AiProblem(problem), purchases: host.purchases) { host.openSettings("billing") }
        } else if let text = model.problem {
            AiProblemNotice(problem: AiProblem(message: text))
        }
    }

    // MARK: the dock

    private func dock(look: AiLook) -> some View {
        let d = look.s(page ? "ai.dock" : "ai.panel.dock")
        return VStack(alignment: .leading, spacing: 0) {
            if let c = model.caps?.credits, c.included, c.low { AiCreditsNote(credits: c, purchases: host.purchases) { host.openSettings("billing") }.padding(.bottom, 8) }
            AiContextChips(model: model, host: host)
                .padding(.horizontal, 2)
                .padding(.bottom, 8)
            AiComposer(model: model, variant: variant, focused: $focused)
            footnote(look: look)
        }
        .frame(maxWidth: page ? 768 : .infinity, alignment: .leading)
        .frame(maxWidth: .infinity)
        .padding(d.padding.edgeInsets)
        .overlay(alignment: .top) { if !page { Rectangle().fill(look.line70).frame(height: 1) } }
    }

    private func footnote(look: AiLook) -> some View {
        let f = look.s(page ? "ai.footnote" : "ai.panel.footnote")
        var notes: [String] = []
        if model.webOn || model.effectiveMode == .research { notes.append("Web searches go through Google Search.") }
        if model.info?.ephemeral == true { notes.append("History is off: this conversation is deleted when you close it.") }
        var text = AttributedString("Foli AI can make mistakes." + (notes.isEmpty ? "" : " " + notes.joined(separator: " ")) + " ")
        var link = AttributedString("AI policy")
        link.underlineStyle = .single
        link.link = URL(string: "https://folevi.com/ai-policy")
        text += link
        return Text(text)
            .webText(f.text)
            .foregroundStyle(f.color.color)
            .tint(f.color.color)
            .padding(.horizontal, f.padding.left)
            .padding(.top, f.margin.top)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The credits note when they run low (AiCredits.tsx AiCreditsNote): account mode only.
struct AiCreditsNote: View {
    let credits: ChatCredits
    var purchases = false
    var onBilling: () -> Void = {}
    @Environment(\.colorScheme) private var scheme

    static func count(_ n: Int) -> String { "\(n.formatted()) AI \(n == 1 ? "credit" : "credits")" }

    var body: some View {
        let look = AiLook(scheme: scheme)
        let ws = credits.seat ? " in this workspace" : ""
        let left = credits.available > 0 ? "\(Self.count(credits.available)) left\(ws)." : "No AI credits left\(ws)."
        let date = credits.resetsAt.map { Date(timeIntervalSince1970: $0 / 1000).formatted(.dateTime.month(.abbreviated).day()) }
        let when = date.map { credits.trialing ? "Your trial ends on \($0)." : "Resets \($0)." } ?? ""
        HStack(spacing: 12) {
            Text("\(left) \(when)").webText(.role(.subheadline)).foregroundStyle(look.muted).frame(maxWidth: .infinity, alignment: .leading)
            if purchases, credits.canBuy || !credits.seat {
                WebButton(credits.canBuy ? "Buy more" : "Upgrade", variant: .secondary, size: .sm, action: onBilling)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 10).fill(look.glassHover))
    }
}

// MARK: Meet Foli AI

/// The AI page's welcome (ChatThread.tsx, variant "page"): the mark, Meet Foli AI, what it does, Try asking.
struct AiPageIntro: View {
    let model: FoliChatModel
    let host: AiHost
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let intro = look.s("ai.intro")
        VStack(alignment: .leading, spacing: 0) {
            AiMarkGlyph(size: 28)
            Text("Meet Foli AI").webText(look.text("ai.intro.title")).lineLimit(1).foregroundStyle(look.heading).padding(.top, look.s("ai.intro.title").margin.top)
            AiIntroBody(model: model, host: host, lead: "ai.intro.lead", list: "ai.intro.list", item: "ai.intro.item")
            if model.effectiveMode == .research {
                Text("Research searches the web and your notes, then writes a report with sources. It takes a few minutes.").webText(.role(.body)).foregroundStyle(look.muted).padding(.top, 12)
            }
            AiTryAsking(style: "ai.intro.try")
            AiFlow(spacing: look.s("ai.intro.suggestions").gap) {
                ForEach(AiSuggestions.list(model), id: \.self) { s in
                    AiSuggestionButton(text: s, style: "ai.intro.suggestion") { model.send(s) }
                }
            }
        }
        .padding(.top, intro.padding.top)
        .frame(maxWidth: intro.width, alignment: .leading)
        .frame(maxWidth: .infinity)
    }
}

/// The floating chat's welcome (variant "floating").
struct AiFloatingIntro: View {
    let model: FoliChatModel
    let host: AiHost
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: look.s("ai.panel.intro.title").gap) {
                AiMarkGlyph(size: 16)
                Text("Meet Foli AI").webText(look.text("ai.panel.intro.title")).lineLimit(1).foregroundStyle(look.heading)
            }
            AiIntroBody(model: model, host: host, lead: "ai.panel.intro.lead", list: "ai.panel.intro.list", item: "ai.panel.intro.item")
            AiTryAsking(style: "ai.panel.try")
            VStack(alignment: .leading, spacing: look.s("ai.panel.suggestions").gap) {
                ForEach(AiSuggestions.list(model), id: \.self) { s in
                    AiSuggestionButton(text: s, style: "ai.panel.suggestion") { model.send(s) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "Try asking" with the small mark (`mb-2.5 mt-6` on the page, `mt-5` in the floating chat).
struct AiTryAsking: View {
    let style: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = AiLook(scheme: scheme).s(style)
        HStack(spacing: s.gap) {
            AiMarkGlyph(size: 13)
            Text("Try asking").webText(s.text).lineLimit(1).foregroundStyle(s.color.color)
        }
        .padding(.top, s.margin.top)
        .padding(.bottom, s.margin.bottom)
    }
}

enum AiSuggestions {
    @MainActor
    static func list(_ model: FoliChatModel) -> [String] { model.suggestions }
}

/// What Foli AI does here (AiIntro.tsx AiIntroBody): the lead for this place and three points; in local mode
/// the model goes straight from the Mac and nothing is said about credits.
struct AiIntroBody: View {
    let model: FoliChatModel
    let host: AiHost
    let lead: String
    let list: String
    let item: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let l = look.s(lead), ul = look.s(list), li = look.s(item)
        let folder = model.context.first?.kind == .folder
        let workspace = (host.session?.space ?? "personal") != "personal"
        let leadText = folder ? "Here Foli AI answers from the notes in this folder, with links to the notes it used."
            : workspace ? "Ask Foli AI about this workspace's notes. Answers only use notes you can open, and link to them. Ask it to tidy up or edit notes, and it shows the changes for you to approve first."
            : "Ask Foli AI about your notes, or for a summary or a first draft. Answers link to the notes they come from. Ask it to tidy up or edit notes, and it shows the changes for you to approve first."
        VStack(alignment: .leading, spacing: 0) {
            AiPrettyText(text: leadText, style: l.text).foregroundStyle(l.color.color).padding(.top, l.margin.top)
            VStack(alignment: .leading, spacing: li.margin.bottom) {
                bullet("Foli AI never changes a note without showing you the change first.", li)
                if host.local {
                    bullet("What you ask, and the notes it needs, go straight from this Mac to the model you chose, never through Folevi. Nothing is sent until you ask.", li)
                    bullet(settingsLine(prefix: "Choose the model in ", suffix: ".", look: look), li)
                } else {
                    bullet("What you ask, and the notes it needs, go to Google Gemini. Nothing is sent until you ask.", li)
                    let credits = model.caps?.credits.flatMap { $0.included ? $0.available : nil }
                    bullet(settingsLine(prefix: "Each request uses AI credits\(credits.map { " (you have \(AiCreditsNote.count($0)) left)" } ?? ""). ", suffix: "", look: look), li)
                }
            }
            .padding(.top, ul.margin.top)
            .padding(.leading, ul.padding.left)
        }
        .environment(\.openURL, OpenURLAction { url in
            if url.scheme == "folevi-settings" { host.openSettings("ai"); return .handled }
            return .systemAction
        })
    }

    private func settingsLine(prefix: String, suffix: String, look: AiLook) -> AttributedString {
        var link = AttributedString("AI settings")
        link.link = URL(string: "folevi-settings://ai")
        link.underlineStyle = .single
        link.foregroundColor = look.ink
        return AttributedString(prefix) + link + AttributedString(suffix)
    }

    private func bullet(_ text: String, _ li: WebComputedStyle) -> some View { bullet(AttributedString(text), li) }

    private func bullet(_ text: AttributedString, _ li: WebComputedStyle) -> some View {
        Text(text)
            .webText(li.text)
            .foregroundStyle(li.color.color)
            .tint(li.color.color)
            .fixedSize(horizontal: false, vertical: true)
            .overlay(alignment: .topLeading) {
                // `list-disc` outside the text: a round bullet in the gutter, on the first line's middle.
                Circle().fill(li.color.color).frame(width: 5.5, height: 5.5)
                    .offset(x: -16.25, y: (li.lineHeight ?? 19) / 2 - 2.75)
            }
    }
}

// MARK: what Foli AI reads

/// The chips above the box (ContextChips.tsx): the notes it reads, the folder it searches, or everything here;
/// Add offers the open note or folder and recent notes. A saved conversation keeps what it was about.
struct AiContextChips: View {
    let model: FoliChatModel
    let host: AiHost
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let chip = look.s("ai.chip")
        let disabled = model.isWorking
        HStack(spacing: 6) {
            if let folder = model.context.first(where: { $0.kind == .folder }) {
                chipView(look: look, icon: .folder) {
                    Text(folderLine(folder.name, look: look)).webText(chip.text).lineLimit(1)
                } remove: { model.removeContext(folder.id) }
            } else if !model.context.isEmpty {
                ForEach(model.context) { item in
                    chipView(look: look, icon: .fileText) {
                        Text(item.name).webText(chip.text).lineLimit(1).truncationMode(.tail).frame(maxWidth: 224, alignment: .leading)
                    } remove: { model.removeContext(item.id) }
                }
            } else if !model.isNew, let label = model.conversationContextLabel, model.info?.context != "workspace", model.info?.context != "none" {
                chipView(look: look, icon: .fileText, label: { Text(label).webText(chip.text).lineLimit(1) }, remove: nil)
            } else {
                chipView(look: look, icon: .layers, label: { Text(host.whole).webText(chip.text).lineLimit(1) }, remove: nil)
            }
            if !disabled {
                let add = look.s("ai.chip.add")
                WebMenuButton(width: 240, entries: { addEntries() }) {
                    HStack(spacing: add.gap) {
                        WebIconView(.plus, size: 13)
                        Text("Add").webText(add.text).lineLimit(1)
                    }
                    .padding(.horizontal, add.padding.left)
                    .frame(height: add.height)
                    .foregroundStyle(add.color.color)
                    .contentShape(Rectangle())
                }
                .buttonStyle(AiHoverStyle(radius: add.radius))
                .accessibilityLabel("Add to what Foli AI reads")
                .task { await loadRecent() }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("What Foli AI reads")
    }

    @State private var recent: [NoteRow] = []

    private func loadRecent() async {
        guard recent.isEmpty, let v = try? await model.client.query(.recent(limit: 6)) else { return }
        recent = v.rows.map(\.row)
    }

    private func addEntries() -> [WebMenuEntry] {
        var out: [WebMenuEntry] = []
        // A saved conversation keeps what it was about until the engine can change it (R12.1).
        let locked = !model.isNew
        let chosen = Set(model.context.map(\.id))
        let notes = recent.filter { !chosen.contains($0.id) }.prefix(5)
        if !notes.isEmpty {
            out.append(.heading("Recent notes"))
            for n in notes {
                out.append(WebMenuEntry(.item(n.title.isEmpty ? "Untitled" : n.title, icon: .fileText, id: "note-\(n.id)"), disabled: locked) { model.addNote(id: n.id, title: n.title) })
            }
        }
        if !model.context.isEmpty {
            if !out.isEmpty { out.append(.separator()) }
            out.append(WebMenuEntry(.item(host.whole, icon: .layers, id: "whole")) {
                for c in model.context { model.removeContext(c.id) }
            })
        }
        return out
    }

    private func folderLine(_ name: String, look: AiLook) -> AttributedString {
        var strong = AttributedString(name)
        strong.font = WebFont.font(.sans, size: look.s("ai.chip").fontSize, weight: 600)
        strong.foregroundColor = look.heading
        return AttributedString("In folder ") + strong
    }

    private func chipView<L: View>(look: AiLook, icon: WebIcon, @ViewBuilder label: () -> L, remove: (() -> Void)?) -> some View {
        let chip = look.s("ai.chip")
        return HStack(spacing: chip.gap) {
            WebIconView(icon, size: 12).foregroundStyle(look.muted)
            label()
            if let remove {
                Button(action: remove) {
                    WebIconView(.x, size: 12).frame(width: 24, height: 24).foregroundStyle(look.muted)
                }
                .buttonStyle(AiHoverStyle(radius: 6, hover: "glass-active"))
                .padding(.trailing, 2)
                .disabled(model.isWorking)
                .accessibilityLabel("Remove")
            }
        }
        .padding(.leading, chip.padding.left)
        .padding(.trailing, remove == nil ? chip.padding.right : 0)
        .frame(height: chip.height)
        .foregroundStyle(look.ink)
        .webBox(WebStyles.named("ai.chip"))
    }
}

// MARK: the box

struct AiComposer: View {
    @Bindable var model: FoliChatModel
    let variant: AiVariant
    var focused: FocusState<Bool>.Binding
    @Environment(\.colorScheme) private var scheme
    @Environment(\.controlActiveState) private var controlActive

    var body: some View {
        let look = AiLook(scheme: scheme)
        let box = look.s(variant == .page ? "ai.composer" : "ai.panel.composer")
        let input = look.s(variant == .page ? "ai.composer.input" : "ai.panel.composer.input")
        let bar = look.s("ai.composer.bar")
        let send = look.s("ai.composer.send")
        let line = input.lineHeight ?? 21
        let canSend = !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isWorking && model.available
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                if model.draft.isEmpty {
                    Text(placeholder).webText(input.text).lineLimit(1).foregroundStyle(look.faint).allowsHitTesting(false)
                }
                TextField("", text: $model.draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(Font(input.text.ctFont))
                    .tracking(input.letterSpacing)
                    .lineSpacing(max(0, line - 17))
                    .foregroundStyle(look.ink)
                    .lineLimit(2...6)
                    .focused(focused)
                    .onKeyPress(.return, phases: .down) { press in
                        if press.modifiers.contains(.shift) || press.modifiers.contains(.option) {
                            model.draft += "\n"
                            return .handled
                        }
                        model.send()
                        return .handled
                    }
                    .accessibilityLabel(model.effectiveMode == .research ? "What should Foli AI research?" : "Ask about your notes, or ask Foli AI to change them")
            }
            .padding(input.padding.edgeInsets)
            .frame(minHeight: input.height, alignment: .topLeading)
            HStack(spacing: bar.gap) {
                Spacer(minLength: 0)
                Button { if canSend { model.send() } } label: {
                    WebIconView(.arrowUp, size: 16)
                        .frame(width: send.width, height: send.height)
                        .foregroundStyle(send.color.color)
                        .background(RoundedRectangle(cornerRadius: send.radius).fill(send.background.color))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // (Not `.disabled`: AppKit would dim it again; the web's `disabled:opacity-30` is the whole look.)
                .compositingGroup()
                .opacity(canSend ? 1 : send.opacity)
                .accessibilityAddTraits(canSend ? [] : .isStaticText)
                .accessibilityLabel(model.effectiveMode == .research ? "Start research" : "Ask")
            }
            .padding(bar.padding.edgeInsets)
        }
        .background(RoundedRectangle(cornerRadius: box.radius).fill(box.background.color))
        .overlay {
            // `focus-within:shadow-[inset_0_0_0_1.5px_...heading 22%]`, only while the window has the keys (as
            // WebKit draws it); without it, the box's 1 pt hairline (`--glass-border`).
            let ring = box.shadows.first { $0.inset && $0.color.a > 0 }
            if focused.wrappedValue, controlActive == .key || controlActive == .active, let ring {
                RoundedRectangle(cornerRadius: box.radius).strokeBorder(ring.color.color, lineWidth: ring.spread)
            } else {
                RoundedRectangle(cornerRadius: box.radius).strokeBorder(look.glassBorder, lineWidth: 1)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { focused.wrappedValue = true }
    }

    private var placeholder: String {
        if model.effectiveMode == .research { return "What should I research?" }
        if model.webOn { return "Ask anything. Answers use your notes and the web…" }
        return model.messages.isEmpty ? "Ask anything, or ask Foli AI to tidy or organize…" : "Ask a follow-up…"
    }
}
#endif
