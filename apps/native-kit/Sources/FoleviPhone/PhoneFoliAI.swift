// Foli AI on the iPhone (docs/IOS_REBUILD_PLAN.md, I5), as the web's phone layout draws it: the sheet from the tab
// bar's Foli AI button (AskAiPanel.tsx, `iphone`: Conversations and the conversation's options on the left, New
// chat and Close on the right, the title in the middle) and the page (AiView.tsx under the phone's bar: the large
// title, Conversations and the title in a row, the chat under them; the conversations as a drawer). Both hold one
// conversation (ChatThread.tsx, `iphone`): the messages (FoleviScreens' shared ones, in the iPhone's layout), what
// Foli AI suggests while it's new, and the composer with what Foli AI reads inside it, Send and the footnote.
// FoliChatModel (FoleviScreens) talks to the engine; in local mode the engine asks Apple's on-device model or the
// person's own key, as on the Mac. Sizes and colours are the web's, measured on the iPhone (phone.json, phone.ai.*).
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// What the chat needs from the frame: the place, and what to open.
@MainActor
public struct PhoneAiHost {
    public var session: SessionValue?
    public var openSettings: (String) -> Void
    /// The AI policy, and other pages outside the app.
    public var openExternal: (URL) -> Void

    public init(session: SessionValue?, openSettings: @escaping (String) -> Void = { _ in }, openExternal: @escaping (URL) -> Void = { _ in }) {
        self.session = session
        self.openSettings = openSettings
        self.openExternal = openExternal
    }

    var local: Bool { session?.mode == .local }
    /// "All notes" in Personal, "Workspace" in a workspace (ContextChips.tsx).
    var whole: String { (session?.space ?? "personal") == "personal" ? "All notes" : "Workspace" }
    var workspace: Bool { (session?.space ?? "personal") != "personal" }
}

public enum PhoneAiVariant: Sendable { case sheet, page }

// MARK: the conversation

/// One conversation (ChatThread.tsx on the iPhone): the messages, following the answer as it streams unless you
/// scroll up to read ("Jump to latest" brings you back), then the dock.
public struct PhoneAiThread: View {
    @Bindable var model: FoliChatModel
    let variant: PhoneAiVariant
    let host: PhoneAiHost
    let menus: PhoneMenus
    @Environment(\.colorScheme) private var scheme
    @State private var following = true
    @State private var behind = false
    @State private var scrollProxy: ScrollViewProxy?
    @FocusState private var focused: Bool

    public init(model: FoliChatModel, variant: PhoneAiVariant, host: PhoneAiHost, menus: PhoneMenus) {
        self.model = model
        self.variant = variant
        self.host = host
        self.menus = menus
    }

    private var look: AiLook { AiLook(scheme: scheme, phone: true) }

    public var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .bottom) {
                scroller
                if behind {
                    jump.padding(.bottom, 12).transition(.opacity)
                }
            }
            PhoneAiDock(model: model, variant: variant, host: host, menus: menus, focused: $focused)
        }
        .environment(\.aiPhone, true)
    }

    private var scroller: some View {
        let t = look.s(variant == .page ? "ai.page.thread" : "ai.thread")
        let streamLength = model.streamingMessage.flatMap { model.answer($0.id)?.shownText.count } ?? 0
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 20) {
                        content
                        // The web's end marker (`endRef`, an empty div): it takes the messages' 20 pt too.
                        Color.clear.frame(height: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(t.padding.edgeInsets)
                    // (Under the thread's padding: what the web scrolls to.)
                    Color.clear.frame(height: 0).id("end")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.top, for: .alignment)
            .defaultScrollAnchor(model.isEmpty ? .top : .bottom, for: .initialOffset)
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
            // In the sheet what scrolls fades out over its last 24 pt rather than being cut off by the composer.
            .mask {
                if variant == .sheet {
                    VStack(spacing: 0) {
                        Color.black
                        LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: 24)
                    }
                } else {
                    Color.black
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        let muted = look.muted
        if model.isLoading {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading the conversation…").webText(.role(.subheadline)).foregroundStyle(muted)
            }
            .padding(.horizontal, 4)
        }
        if model.isMissing {
            Text("This conversation isn't here anymore. Ask something to start a new one.").webText(.role(.body)).foregroundStyle(muted).padding(.horizontal, 4)
        }
        if model.isEmpty, !model.isLoading {
            if variant == .page { PhoneAiPageIntro(model: model, host: host) } else { PhoneAiSuggestions(model: model) }
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
                // (No buying on the iPhone: never a Buy more or Upgrade.)
                AiAssistantMessage(model: model, message: m, last: i == messages.count - 1, export: { [model, menus] messageId, saves in
                    AnyView(PhoneAiExportButton(model: model, menus: menus, messageId: messageId, saves: saves))
                })
            }
        }
        if let p = model.shownPending {
            AiUserMessage(text: p.text)
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Thinking…").webText(.role(.subheadline)).foregroundStyle(muted)
            }
            .padding(.horizontal, 4)
        }
        if let problem = model.problemError {
            AiProblemNotice(problem: AiProblem(problem))
        } else if let text = model.problem {
            AiProblemNotice(problem: AiProblem(message: text))
        }
    }

    /// "Jump to latest": a raised capsule, 36 tall, over the thread's foot.
    private var jump: some View {
        Button {
            following = true
            behind = false
            withAnimation(.easeOut(duration: 0.25)) { scrollProxy?.scrollTo("end", anchor: .bottom) }
        } label: {
            HStack(spacing: 6) {
                WebIconView(.arrowDown, size: 16)
                Text("Jump to latest").webText(.role(.subheadline, weight: 500)).lineLimit(1)
            }
            .padding(.horizontal, 14).frame(height: 36)
            .foregroundStyle(look.heading)
            .background(Capsule().fill(look.color("color-surface-raised")).shadow(color: .black.opacity(0.25), radius: 7, y: 4))
            .overlay(Capsule().strokeBorder(Color.black.opacity(0.12), lineWidth: 0.5))
        }
        .buttonStyle(PhonePressFade())
    }
}

/// The sheet's welcome (ChatThread.tsx, `iphone`, floating): Suggestions, each a row with the sparkles, and a
/// line on how answers work.
struct PhoneAiSuggestions: View {
    let model: FoliChatModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme, phone: true)
        let title = look.s("ai.suggest.title"), list = look.s("ai.suggest.list"), item = look.s("ai.suggest.item"), note = look.s("ai.suggest.note")
        VStack(alignment: .leading, spacing: 0) {
            Text("Suggestions").webText(title.text).lineLimit(1).foregroundStyle(title.color.color).accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(model.suggestions, id: \.self) { s in
                    Button { model.send(s) } label: {
                        HStack(spacing: item.gap) {
                            WebIconView(.sparkles, size: 18, strokeWidth: 1.8).foregroundStyle(look.s("ai.suggest.icon").color.color)
                            Text(s).webText(item.text).multilineTextAlignment(.leading).foregroundStyle(item.color.color)
                        }
                        .padding(item.padding.edgeInsets)
                        .frame(maxWidth: .infinity, minHeight: item.height, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PhonePressFade())
                }
            }
            .padding(.top, list.margin.top)
            PhonePrettyText(text: "Answers link to the notes they come from. Foli AI shows you any change before it makes it, and each request uses AI credits.", style: note.text)
                .foregroundStyle(note.color.color)
                .padding(.top, note.margin.top)
        }
    }
}

/// The page's welcome (ChatThread.tsx, page): the flower, Meet Foli AI, what it does here, Try asking.
struct PhoneAiPageIntro: View {
    let model: FoliChatModel
    let host: PhoneAiHost
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme, phone: true)
        let intro = look.s("ai.intro"), title = look.s("ai.intro.title"), lead = look.s("ai.intro.lead")
        let ul = look.s("ai.intro.list"), li = look.s("ai.intro.item"), tryAsking = look.s("ai.intro.try")
        let folder = model.context.first?.kind == .folder
        let leadText = folder ? "Here Foli AI answers from the notes in this folder, with links to the notes it used."
            : host.workspace ? "Ask Foli AI about this workspace's notes. Answers only use notes you can open, and link to them. Ask it to tidy up or edit notes, and it shows the changes for you to approve first."
            : "Ask Foli AI about your notes, or for a summary or a first draft. Answers link to the notes they come from. Ask it to tidy up or edit notes, and it shows the changes for you to approve first."
        VStack(alignment: .leading, spacing: 0) {
            AiMarkGlyph(size: 28)
            Text("Meet Foli AI").webText(title.text).lineLimit(1).foregroundStyle(title.color.color).padding(.top, title.margin.top).accessibilityAddTraits(.isHeader)
            PhonePrettyText(text: leadText, style: lead.text).foregroundStyle(lead.color.color).padding(.top, lead.margin.top)
            VStack(alignment: .leading, spacing: li.margin.bottom) {
                bullet("Foli AI never changes a note without showing you the change first.", li)
                if host.local {
                    bullet("What you ask, and the notes it needs, go straight from \(Self.device) to the model you chose, never through Folevi. Nothing is sent until you ask.", li)
                    bullet(settingsLine(prefix: "Choose the model in ", suffix: ".", look: look), li)
                } else {
                    bullet("What you ask, and the notes it needs, go to Google Gemini. Nothing is sent until you ask.", li)
                    let credits = model.caps?.credits.flatMap { $0.included ? $0.available : nil }
                    bullet(settingsLine(prefix: "Each request uses AI credits\(credits.map { " (you have \($0.formatted()) AI \($0 == 1 ? "credit" : "credits") left)" } ?? ""). ", suffix: "", look: look), li)
                }
            }
            // (A point less than the list's margin: WebKit's lines in it sit that much higher than Core Text's,
            // measured against the page in the Simulator.)
            .padding(.top, ul.margin.top - 1)
            .padding(.leading, ul.padding.left)
            if model.effectiveMode == .research {
                Text("Research searches the web and your notes, then writes a report with sources. It takes a few minutes.").webText(lead.text).foregroundStyle(look.muted).padding(.top, 12)
            }
            HStack(spacing: tryAsking.gap) {
                AiMarkGlyph(size: 13)
                Text("Try asking").webText(tryAsking.text).lineLimit(1).foregroundStyle(tryAsking.color.color)
            }
            .padding(.top, tryAsking.margin.top)
            .padding(.bottom, tryAsking.margin.bottom)
            AiFlow(spacing: look.s("ai.intro.suggestions").gap) {
                ForEach(model.suggestions, id: \.self) { s in
                    let chip = look.s("ai.intro.suggestion")
                    Button { model.send(s) } label: {
                        Text(s).webText(chip.text).multilineTextAlignment(.leading).foregroundStyle(chip.color.color)
                            .padding(chip.padding.edgeInsets)
                            .webBox(look.pair("ai.intro.suggestion"))
                    }
                    .buttonStyle(PhonePressFade())
                }
            }
        }
        .padding(.top, intro.padding.top)
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in
            if url.scheme == "folevi-settings" { host.openSettings("ai"); return .handled }
            return .systemAction
        })
    }

    /// "this iPhone" or "this iPad" (lib/shell/words.ts deviceWords().here).
    static var device: String { UIDevice.current.userInterfaceIdiom == .pad ? "this iPad" : "this iPhone" }

    private func settingsLine(prefix: String, suffix: String, look: AiLook) -> AttributedString {
        var link = AttributedString("AI settings")
        link.link = URL(string: "folevi-settings://ai")
        link.underlineStyle = .single
        link.foregroundColor = look.ink
        return AttributedString(prefix) + link + AttributedString(suffix)
    }

    /// (A plain line as plain text: an attributed one sets its lines a little taller in Core Text.)
    private func bullet(_ text: String, _ li: WebComputedStyle) -> some View {
        PhonePrettyText(text: text, style: li.text, wrap: .greedy).foregroundStyle(li.color.color).overlay(alignment: .topLeading) { disc(li) }
    }

    private func bullet(_ text: AttributedString, _ li: WebComputedStyle) -> some View {
        Text(text).webText(li.text).foregroundStyle(li.color.color).tint(li.color.color).fixedSize(horizontal: false, vertical: true).overlay(alignment: .topLeading) { disc(li) }
    }

    /// `list-disc` outside the text: a round bullet in the gutter, centred 16 pt left of the text, on the first
    /// line's middle.
    private func disc(_ li: WebComputedStyle) -> some View {
        Circle().fill(li.color.color).frame(width: 6, height: 6)
            .offset(x: -19, y: (li.lineHeight ?? 23) / 2 - 3)
    }
}

// MARK: the composer

/// The dock (ChatThread.tsx, `iphone`): the composer, a white box with the sheet's corners, what Foli AI reads as
/// chips at its top, the box for the question, Chat or Research when the web is on, Send; the footnote under it.
struct PhoneAiDock: View {
    @Bindable var model: FoliChatModel
    let variant: PhoneAiVariant
    let host: PhoneAiHost
    let menus: PhoneMenus
    var focused: FocusState<Bool>.Binding
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme, phone: true)
        let dock = look.s(variant == .page ? "ai.page.dock" : "ai.dock")
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                let chips = look.s("ai.composer.chips")
                PhoneAiChips(model: model, host: host, menus: menus)
                    .padding(chips.padding.edgeInsets)
                input(look: look)
                bar(look: look)
            }
            .frame(maxWidth: .infinity)
            .webBox(look.pair("ai.composer"))
            .contentShape(Rectangle())
            .onTapGesture { focused.wrappedValue = true }
            footnote(look: look)
        }
        .padding(dock.padding.edgeInsets)
    }

    private func input(look: AiLook) -> some View {
        let s = look.s("ai.composer.input")
        let placeholder = model.effectiveMode == .research ? "What should I research?" : model.messages.isEmpty ? "Ask Foli AI anything…" : "Ask a follow-up…"
        return ZStack(alignment: .topLeading) {
            if model.draft.isEmpty {
                Text(placeholder).webText(s.text).lineLimit(1).foregroundStyle(look.faint).allowsHitTesting(false)
            }
            TextField("", text: $model.draft, axis: .vertical)
                .textFieldStyle(.plain)
                .font(Font(s.text.ctFont))
                .tracking(s.letterSpacing)
                .lineSpacing(max(0, (s.lineHeight ?? 24) - (s.fontSize * 1.22).rounded()))
                .foregroundStyle(look.ink)
                .tint(look.heading)
                .lineLimit(2...6)
                .focused(focused)
                .submitLabel(.send)
                .accessibilityLabel(model.effectiveMode == .research ? "What should Foli AI research?" : "Ask about your notes, or ask Foli AI to change them")
        }
        .padding(s.padding.edgeInsets)
        .frame(minHeight: s.height, alignment: .topLeading)
    }

    private func bar(look: AiLook) -> some View {
        let bar = look.s("ai.composer.bar")
        let disc = look.s("ai.send.disc")
        let canSend = model.canSend
        return HStack(spacing: bar.gap) {
            if model.webAvailable {
                PhoneSegmented([("chat", "Chat"), ("research", "Research")], selection: Binding(get: { model.mode == .research ? "research" : "chat" }, set: { model.mode = $0 == "research" ? .research : .chat }), accessibility: "How Foli AI helps")
                    .fixedSize()
                    .disabled(model.isWorking)
            }
            Spacer(minLength: 0)
            // SendButton.tsx: a 34 pt disc in the heading's colour inside a 44 pt target, at 30% with nothing to send.
            Button { if canSend { model.send() } } label: {
                WebIconView(.arrowUp, size: 19, strokeWidth: 2.4)
                    .foregroundStyle(disc.color.color)
                    .frame(width: disc.width, height: disc.height)
                    .background(Circle().fill(disc.background.color))
                    .compositingGroup()
                    .opacity(canSend ? 1 : 0.3)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PhonePressScale())
            .padding(-5)
            .allowsHitTesting(canSend)
            .accessibilityLabel(model.effectiveMode == .research ? "Start research" : "Ask")
        }
        .padding(bar.padding.edgeInsets)
        .frame(minHeight: bar.height)
    }

    private func footnote(look: AiLook) -> some View {
        let f = look.s(variant == .page ? "ai.page.footnote" : "ai.footnote")
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
            .multilineTextAlignment(.center)
            .padding(.horizontal, f.padding.left)
            .padding(.top, f.margin.top)
            .frame(maxWidth: .infinity)
            .environment(\.openURL, OpenURLAction { url in
                host.openExternal(url)
                return .handled
            })
    }
}

/// What Foli AI reads, inside the composer (ContextChips.tsx, every control a capsule): the notes, the folder, or
/// everything here; Add offers recent notes and everything here.
struct PhoneAiChips: View {
    let model: FoliChatModel
    let host: PhoneAiHost
    let menus: PhoneMenus
    @Environment(\.colorScheme) private var scheme
    @State private var recent: [NoteRow] = []
    @State private var addFrame: CGRect = .zero

    var body: some View {
        let look = AiLook(scheme: scheme, phone: true)
        let row = look.s("ai.composer.chips")
        HStack(spacing: row.gap) {
            HStack(spacing: 6) {
                if let folder = model.context.first(where: { $0.kind == .folder }) {
                    chip(look: look, icon: .folder, remove: { model.removeContext(folder.id) }) {
                        Text(folderLine(folder.name, look: look)).webText(look.text("ai.chip")).lineLimit(1)
                    }
                } else if !model.context.isEmpty {
                    ForEach(model.context) { item in
                        chip(look: look, icon: .fileText, remove: { model.removeContext(item.id) }) {
                            Text(item.name.isEmpty ? "Untitled" : item.name).webText(look.text("ai.chip")).lineLimit(1).truncationMode(.tail).frame(maxWidth: 224, alignment: .leading)
                        }
                    }
                } else if !model.isNew, let label = model.conversationContextLabel, model.info?.context != "workspace", model.info?.context != "none" {
                    chip(look: look, icon: .fileText, remove: nil) { Text(label).webText(look.text("ai.chip")).lineLimit(1) }
                } else {
                    chip(look: look, icon: .layers, remove: nil) { Text(host.whole).webText(look.text("ai.chip")).lineLimit(1) }
                }
                if !model.isWorking { add(look: look) }
            }
            Spacer(minLength: 0)
        }
        .task { await loadRecent() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("What Foli AI reads")
    }

    private func add(look: AiLook) -> some View {
        let s = look.s("ai.chip.add")
        return Button { menus.show(entries(), from: addFrame, side: .top, align: .start) } label: {
            HStack(spacing: s.gap) {
                WebIconView(.plus, size: 13)
                Text("Add").webText(s.text).lineLimit(1)
            }
            .padding(.horizontal, s.padding.left)
            .frame(height: s.height)
            .foregroundStyle(s.color.color)
            .contentShape(Rectangle())
        }
        .buttonStyle(PhonePressFade())
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { addFrame = $0 }
        .accessibilityLabel("Add to what Foli AI reads")
    }

    private func loadRecent() async {
        guard recent.isEmpty, let v = try? await model.client.query(.recent(limit: 6)) else { return }
        recent = v.rows.map(\.row)
    }

    private func entries() -> [PhoneMenuEntry] {
        var out: [PhoneMenuEntry] = []
        // A saved conversation keeps what it was about (the engine can't change it yet).
        let chosen = Set(model.context.map(\.id))
        let notes = model.isNew ? Array(recent.filter { !chosen.contains($0.id) }.prefix(5)) : []
        if !notes.isEmpty {
            out.append(PhoneMenuEntry(.heading("Recent notes")))
            for n in notes {
                out.append(PhoneMenuEntry(.item(n.title.isEmpty ? "Untitled" : n.title, icon: .fileText, id: "note-\(n.id)")) { model.addNote(id: n.id, title: n.title) })
            }
            out.append(PhoneMenuEntry(.separator()))
        }
        out.append(PhoneMenuEntry(.item(host.whole, icon: .layers, id: "whole")) {
            for c in model.context { model.removeContext(c.id) }
        })
        return out
    }

    private func folderLine(_ name: String, look: AiLook) -> AttributedString {
        var strong = AttributedString(name)
        strong.font = WebFont.font(.sans, size: look.s("ai.chip").fontSize, weight: 600)
        strong.foregroundColor = look.heading
        return AttributedString("In folder ") + strong
    }

    private func chip<L: View>(look: AiLook, icon: WebIcon, remove: (() -> Void)?, @ViewBuilder label: () -> L) -> some View {
        let s = look.s("ai.chip")
        return HStack(spacing: s.gap) {
            WebIconView(icon, size: 12).foregroundStyle(look.s("ai.chip.icon").color.color)
            label()
            if let remove {
                Button(action: remove) {
                    WebIconView(.x, size: 12).frame(width: 24, height: 24).foregroundStyle(look.muted).contentShape(Rectangle())
                }
                .buttonStyle(PhonePressFade())
                .padding(.trailing, 2)
                .accessibilityLabel("Remove")
            }
        }
        .padding(.leading, s.padding.left)
        .padding(.trailing, remove == nil ? s.padding.right : 0)
        .frame(height: s.height)
        .foregroundStyle(s.color.color)
        .webBox(look.pair("ai.chip"))
    }
}

// MARK: the sheet

/// The tab bar's Foli AI (AskAiPanel.tsx, `iphone`): a medium sheet, pulled up to the whole screen. Conversations
/// opens the page (on this conversation, once there is one); New chat starts afresh.
public struct PhoneAiSheet: View {
    let model: FoliChatModel
    let host: PhoneAiHost
    let close: () -> Void
    /// Conversations: the page, on this conversation or a new chat.
    let openPage: (String?) -> Void
    @State private var menus = PhoneMenus()
    @State private var moreFrame: CGRect = .zero

    public init(model: FoliChatModel, host: PhoneAiHost, close: @escaping () -> Void, openPage: @escaping (String?) -> Void) {
        self.model = model
        self.host = host
        self.close = close
        self.openPage = openPage
    }

    public var body: some View {
        PhoneSheetPanel(title: model.isNew ? "New chat" : (model.info?.title ?? "New chat"), close: close, scrolls: false) {
            PhoneSheetButton("Conversations", action: { openPage(model.conversationId) }) {
                WebIconView(.rotateCcwClock, size: 15, strokeWidth: 2.4)
            }
            if let id = model.conversationId, model.info != nil {
                PhoneSheetButton("Conversation options", action: {
                    menus.show(PhoneAiMenus.conversation(model: model, id: id, title: model.title, local: host.local), from: moreFrame, side: .bottom, align: .start)
                }) {
                    WebIconView(.ellipsis, size: 15, strokeWidth: 2.4)
                }
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
            }
        } trailing: {
            if model.conversationId != nil {
                PhoneSheetButton("New chat", action: { model.newChat() }) {
                    WebIconView(.plus, size: 16, strokeWidth: 2.4)
                }
            }
        } content: {
            PhoneAiThread(model: model, variant: .sheet, host: host, menus: menus)
        } footer: {
            EmptyView()
        }
        .overlay { PhoneMenuLayer(menus: menus) }
    }
}

/// A conversation's menu (ConversationActions.tsx): sharing (says plainly why it can't), Copy as Markdown, Save as
/// note; for a row also Rename, Pin and Delete.
@MainActor
enum PhoneAiMenus {
    static func conversation(model: FoliChatModel, id: String, title: String, local: Bool, pinned: Bool? = nil, rename: (@MainActor @Sendable () -> Void)? = nil, delete: (@MainActor @Sendable () -> Void)? = nil) -> [PhoneMenuEntry] {
        var out: [PhoneMenuEntry] = []
        if let rename { out.append(PhoneMenuEntry(.item("Rename", icon: .pencil, id: "rename"), action: rename)) }
        if let pinned {
            out.append(PhoneMenuEntry(.item(pinned ? "Unpin" : "Pin", icon: pinned ? .pinOff : .pin, id: "pin")) { model.pin(id, !pinned) })
        }
        if !out.isEmpty { out.append(PhoneMenuEntry(.separator(1))) }
        out.append(PhoneMenuEntry(.item("Copy as Markdown", icon: .clipboardCopy, id: "copy")) {
            Task { if let md = await markdown(model: model, id: id, title: title) { AiPasteboard.copy(md) } }
        })
        out.append(PhoneMenuEntry(.item("Save as note", icon: .filePlusCorner, id: "save")) { model.saveAsNote(conversationId: id) })
        if let delete {
            out.append(PhoneMenuEntry(.separator(2)))
            out.append(PhoneMenuEntry(.item("Delete…", icon: .trash, danger: true, id: "delete"), action: delete))
        }
        return out
    }

    /// The conversation (or one answer) as Markdown, as the web writes it (`ai.exportMarkdown`).
    static func markdown(model: FoliChatModel, id: String, title: String, messageId: String? = nil) async -> String? {
        try? await model.client.command(.aiExportMarkdown(conversationId: id, messageId: messageId)).markdown
    }

    /// Export under an answer (ChatMessage.tsx AnswerExport): Copy as Markdown and, not for a research report,
    /// Save as note. (Download Markdown is the Mac's: on the iPhone, Copy, then Files or Share.)
    static func export(model: FoliChatModel, messageId: String, saves: Bool) -> [PhoneMenuEntry] {
        guard let id = model.conversationId else { return [] }
        var out = [PhoneMenuEntry(.item("Copy as Markdown", icon: .clipboardCopy, id: "copy")) {
            Task { if let md = await markdown(model: model, id: id, title: model.title, messageId: messageId) { AiPasteboard.copy(md) } }
        }]
        if saves { out.append(PhoneMenuEntry(.item("Save as note", icon: .filePlusCorner, id: "save")) { model.saveAsNote(messageId) }) }
        return out
    }
}

/// "Export" under an answer, in the iPhone's row-button size; its menu opens above it.
struct PhoneAiExportButton: View {
    let model: FoliChatModel
    let menus: PhoneMenus
    let messageId: String
    let saves: Bool
    @State private var frame: CGRect = .zero

    var body: some View {
        AiRowButton(icon: .ellipsis, title: "Export") {
            menus.show(PhoneAiMenus.export(model: model, messageId: messageId, saves: saves), from: frame, side: .top, align: .start)
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
        .accessibilityLabel("Export this answer")
    }
}

// MARK: the page

/// The Foli AI page (/ai, /ai/<conversation>; AiView.tsx under the phone's bar): Back, the large title (the
/// conversation's), then Conversations, the title and its options in a row, the chat filling the rest. When Foli AI
/// can't be used here it says why (AiUnavailable.tsx).
public struct PhoneAiPage: View {
    let model: FoliChatModel
    let history: FoliHistoryModel
    let host: PhoneAiHost
    let back: () -> Void
    /// Another conversation (nil: a new chat).
    let open: (String?) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var menus = PhoneMenus()
    @State private var drawer = false
    @State private var moreFrame: CGRect = .zero
    @State private var deleting: ChatConversationRow?
    @State private var titleWidth: CGFloat = 0

    public init(model: FoliChatModel, history: FoliHistoryModel, host: PhoneAiHost, back: @escaping () -> Void, open: @escaping (String?) -> Void) {
        self.model = model
        self.history = history
        self.host = host
        self.back = back
        self.open = open
    }

    private var title: String { model.isNew ? "New chat" : (model.info?.title ?? "") }

    public var body: some View {
        let look = AiLook(scheme: scheme, phone: true)
        GeometryReader { geo in
            let safe = geo.safeAreaInsets
            ZStack(alignment: .top) {
                FoleviTokens.Chrome.canvas.resolve(scheme).color
                VStack(alignment: .leading, spacing: 0) {
                    if let reason = model.caps?.unavailable, model.caps?.available == false {
                        largeTitle("Foli AI", look: look)
                        PhoneAiUnavailable(reason: reason, host: host)
                    } else {
                        largeTitle(model.isNew ? "New chat" : (model.info?.title ?? ""), look: look)
                        header(look: look)
                        PhoneAiThread(model: model, variant: .page, host: host, menus: menus)
                            .frame(maxHeight: .infinity)
                    }
                }
                .padding(.top, safe.top + 52)
                // (The web's screen keeps the tab bar's room under the page, though the bar steps away here.)
                // (The web's screen keeps 72 pt under the page for the tab bar, which steps away here.)
                .padding(.bottom, safe.bottom + 38)
                bar(top: safe.top)
                if drawer {
                    PhoneAiDrawer(model: model, history: history, host: host, menus: menus, open: { id in
                        drawer = false
                        open(id)
                    }, delete: { deleting = $0 }, close: { drawer = false })
                    .transition(.opacity)
                }
            }
            .ignoresSafeArea()
        }
        .overlay { PhoneMenuLayer(menus: menus) }
        .animation(.easeOut(duration: 0.2), value: drawer)
        .alert("Delete this conversation?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { row in
            Button("Delete", role: .destructive) {
                let active = row.id == model.conversationId
                model.remove(row.id)
                if active { open(nil) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text("“\(row.title)” and everything in it will be gone for good.")
        }
        .accessibilityIdentifier("screen.ai")
    }

    /// The phone's large title (Screen.tsx: Spectral 600 at Large Title, 1.12, -0.02em; px-5 pt-1 pb-1.5).
    private func largeTitle(_ text: String, look: AiLook) -> some View {
        let size = WebTypeRole.largeTitle.metrics.size
        let style = WebTextStyle(family: .display, size: size, leading: size * 1.12, weight: FoleviTokens.FontWeight.semibold, letterSpacing: -0.02 * size)
        // A long conversation's title on balanced lines (`text-wrap: balance`), each its CSS line box.
        let lines = titleWidth > 0 ? WebLineBreaker.lines([WebRun(text)], style: style, width: titleWidth, wrap: .balance).map { $0.map(\.text).joined().trimmingCharacters(in: .whitespaces) } : [text]
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line).webText(style).lineLimit(1).frame(height: style.leading, alignment: .leading)
            }
        }
            .foregroundStyle(look.heading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { titleWidth = $0 }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, 6)
            .accessibilityAddTraits(.isHeader)
    }

    /// Back, 4 pt under the status bar, 16 pt in.
    private func bar(top: CGFloat) -> some View {
        HStack {
            WebGlassCircle("Back", action: back) {
                WebIconView(.chevronLeft, size: 24, strokeWidth: 2.2).offset(x: -2)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
        .padding(.top, top + 4)
    }

    /// Conversations, the title, the conversation's options (AiView.tsx's row, narrow).
    private func header(look: AiLook) -> some View {
        let h = look.s("ai.page.header"), c = look.s("ai.page.conversations"), t = look.s("ai.page.title")
        return HStack(spacing: h.gap) {
            Button { drawer = true } label: {
                HStack(spacing: c.gap) {
                    WebIconView(.messagesSquare, size: 15)
                    Text("Conversations").webText(c.text).lineLimit(1)
                }
                .padding(.horizontal, c.padding.left)
                .frame(height: c.height)
                .foregroundStyle(c.color.color)
                .contentShape(Rectangle())
            }
            .buttonStyle(PhonePressFade())
            Text(title).webText(t.text).lineLimit(1).truncationMode(.tail).foregroundStyle(t.color.color)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let id = model.conversationId, model.info != nil {
                Button {
                    menus.show(PhoneAiMenus.conversation(model: model, id: id, title: title, local: host.local), from: moreFrame, side: .bottom, align: .end)
                } label: {
                    WebIconView(.ellipsis, size: 16).frame(width: 32, height: 32).foregroundStyle(look.muted).contentShape(Rectangle())
                }
                .buttonStyle(PhonePressFade())
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
                .accessibilityLabel("Conversation options")
            }
        }
        .padding(.horizontal, h.padding.left)
        .frame(height: h.height)
    }
}

/// The conversations, as a drawer from the left (AiView.tsx ListDrawer with ConversationList.tsx): New chat, search,
/// pinned then recent; each row opens its conversation, and holds its menu (Rename, Pin, Copy, Save as note, Delete).
struct PhoneAiDrawer: View {
    let model: FoliChatModel
    @Bindable var history: FoliHistoryModel
    let host: PhoneAiHost
    let menus: PhoneMenus
    let open: (String?) -> Void
    let delete: (ChatConversationRow) -> Void
    let close: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var renaming: ChatConversationRow?
    @State private var name = ""

    var body: some View {
        let look = AiLook(scheme: scheme, phone: true)
        GeometryReader { geo in
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    Button { open(nil) } label: {
                        HStack(spacing: 8) {
                            WebIconView(.plus, size: 16)
                            Text("New chat").webText(.role(.body, weight: 500)).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .foregroundStyle(look.heading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(look.color("color-surface-raised")))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(look.glassBorder))
                    }
                    .buttonStyle(PhonePressFade())
                    HStack(spacing: 8) {
                        WebIconView(.search, size: 16).foregroundStyle(look.muted)
                        TextField("", text: $history.search, prompt: Text("Search conversations").foregroundStyle(look.faint))
                            .textFieldStyle(.plain)
                            .font(WebFont.font(.sans, size: WebTypeRole.body.metrics.size))
                            .foregroundStyle(look.ink)
                            .accessibilityLabel("Search conversations")
                    }
                    .padding(.horizontal, 12).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 12).fill(look.glassHover))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(look.glassBorder))
                    ScrollView {
                        VStack(alignment: .leading, spacing: 2) {
                            if model.caps?.history == false {
                                Text("History is off, so new conversations are deleted when you close them.").webText(.role(.subheadline)).foregroundStyle(look.muted)
                                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                    .background(RoundedRectangle(cornerRadius: 10).fill(look.glassHover))
                                    .padding(.bottom, 12)
                            }
                            let searching = !history.search.trimmingCharacters(in: .whitespaces).isEmpty
                            if !searching, !history.pinned.isEmpty {
                                caps("PINNED", look: look)
                                ForEach(history.pinned, id: \.id) { row($0, look: look) }
                                caps("RECENT", look: look).padding(.top, 12)
                            }
                            ForEach(history.recent, id: \.id) { row($0, look: look) }
                            if !history.isLoading, history.isEmpty {
                                Text(searching ? "No conversations match that" : "No conversations yet").webText(.role(.body, weight: 600)).foregroundStyle(look.heading)
                                    .frame(maxWidth: .infinity).padding(.top, 32)
                                if !searching {
                                    Text("Your conversations will show up here.").webText(.role(.subheadline)).foregroundStyle(look.muted).frame(maxWidth: .infinity).padding(.top, 4)
                                }
                            }
                        }
                    }
                    .scrollDismissesKeyboard(.interactively)
                }
                .padding(.horizontal, 12)
                .padding(.top, geo.safeAreaInsets.top + 8)
                .frame(width: min(geo.size.width * 0.86, 320))
                .frame(maxHeight: .infinity, alignment: .top)
                .background(look.color("color-surface-raised").ignoresSafeArea())
                .transition(.move(edge: .leading))
                Color.black.opacity(0.32)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityLabel("Close conversations")
                    .accessibilityAddTraits(.isButton)
            }
        }
        .ignoresSafeArea()
        .alert("Rename conversation", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Save") {
                if let r = renaming {
                    let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty, t != r.title { model.rename(r.id, to: t) }
                }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Conversations")
        .accessibilityAddTraits(.isModal)
    }

    private func caps(_ t: String, look: AiLook) -> some View {
        Text(t).webText(.caps).lineLimit(1).foregroundStyle(look.faint).padding(.horizontal, 10).padding(.bottom, 4)
    }

    private func row(_ r: ChatConversationRow, look: AiLook) -> some View {
        let active = r.id == model.conversationId
        return Button { open(r.id) } label: {
            HStack(spacing: 8) {
                Text(r.title.isEmpty ? "New chat" : r.title)
                    .webText(.role(.body, weight: active ? 600 : 400))
                    .lineLimit(1).truncationMode(.tail)
                    .foregroundStyle(active ? look.heading : look.ink.opacity(0.9))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(AiAge.text(r.lastMessageAt)).webText(.role(.footnote)).lineLimit(1).foregroundStyle(look.faint)
            }
            .padding(.horizontal, 10)
            .frame(height: 44)
            .background { if active { RoundedRectangle(cornerRadius: 10).fill(look.glassActive) } }
            .contentShape(Rectangle())
        }
        .buttonStyle(PhonePressFade())
        .contextMenu {
            Button("Rename", systemImage: "pencil") { name = r.title; renaming = r }
            Button(r.pinned ? "Unpin" : "Pin", systemImage: r.pinned ? "pin.slash" : "pin") { model.pin(r.id, !r.pinned) }
            Button("Copy as Markdown", systemImage: "doc.on.clipboard") {
                Task { if let md = await PhoneAiMenus.markdown(model: model, id: r.id, title: r.title) { AiPasteboard.copy(md) } }
            }
            Button("Save as note", systemImage: "doc.badge.plus") { model.saveAsNote(conversationId: r.id) }
            Button("Delete…", systemImage: "trash", role: .destructive) { delete(r) }
        }
        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
    }
}

/// Foli AI can't be used here (AiUnavailable.tsx): why, and where to change it. Never a price or a plan on the
/// iPhone (no buying in the app).
struct PhoneAiUnavailable: View {
    let reason: String
    let host: PhoneAiHost
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme, phone: true)
        let device = PhoneAiPageIntro.device
        let copy: (String, String, Bool) = {
            switch reason {
            case "off": return ("Foli AI is turned off", "You turned Foli AI off, so nothing is sent to AI. Turn it on again in Settings > AI.", true)
            case "workspacePlan": return ("Foli AI isn't part of this workspace's plan", "A workspace owner or admin can change the plan.", false)
            case "setup": return ("Set up Foli AI on \(device)", "Turn on Apple Intelligence, or add your own OpenAI, Anthropic or Google key. Your notes go straight from \(device) to the model, never through Folevi.", true)
            default:
                if host.local { return ("Set up Foli AI on \(device)", "Turn on Apple Intelligence, or add your own OpenAI, Anthropic or Google key. Your notes go straight from \(device) to the model, never through Folevi.", true) }
                return ("Foli AI isn't part of your plan", "Your plan doesn't include Foli AI.", false)
            }
        }()
        VStack(spacing: 0) {
            AiMarkGlyph(size: 28)
            Text(copy.0).webText(.display(.title1)).foregroundStyle(look.heading).multilineTextAlignment(.center).padding(.top, 16)
            Text(copy.1).webText(.role(.body)).foregroundStyle(look.muted).multilineTextAlignment(.center).padding(.top, 8)
            if copy.2 {
                WebButton("Open AI settings", variant: .secondary) { host.openSettings("ai") }.padding(.top, 24)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 64)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityIdentifier("ai-unavailable")
    }
}

/// A paragraph broken as the iPhone's WebKit breaks every `p` (`text-wrap: pretty`).
struct PhonePrettyText: View {
    let text: String
    let style: WebTextStyle
    /// (A list item isn't a `p`: its lines as they fall.)
    var wrap: WebTextWrap = .iPhonePretty
    @State private var width: CGFloat = 0

    var body: some View {
        Text(width > 0 ? WebLineBreaker.lines([WebRun(text)], style: style, width: width, wrap: wrap).map { $0.map(\.text).joined().trimmingCharacters(in: .whitespaces) }.joined(separator: "\n") : text)
            .webText(style)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

/// `active:opacity-60`.
struct PhonePressFade: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// `group-active:scale-90` (Send).
struct PhonePressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.9 : 1).animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
#endif
