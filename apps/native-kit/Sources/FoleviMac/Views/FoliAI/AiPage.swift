// The Foli AI page (/ai, /ai/<conversation>) as the web draws it (apps/web/src/components/views/AiView.tsx,
// chat/ConversationList.tsx): your conversations on the left (New chat, search, pinned then recent, each with
// Rename, Pin, Copy, Download, Save as note and Delete), the chat on the right with its title and options. A
// new chat gets its address once you ask the first question (the tab follows). When Foli AI can't be used here
// it says why (AiUnavailable.tsx): turned off, not on the plan, or not set up on this Mac yet.
#if os(macOS)
import AppKit
import SwiftUI
import UniformTypeIdentifiers
import FoleviDesign
import FoleviEngine
import FoleviScreens

struct AiPageScreen: View {
    let frame: FrameModel
    let model: FoliChatModel
    /// The conversation in the route (/ai/<id>), or nil for a new chat.
    let conversationId: String?
    @State private var history: FoliHistoryModel?
    @State private var deleting: ChatConversationRow?
    @Environment(\.colorScheme) private var scheme

    var host: AiHost {
        AiHost(session: frame.session.value, openSettings: { [weak frame] section in frame?.host?.frameOpenSettings(section: section) })
    }

    var body: some View {
        let look = AiLook(scheme: scheme)
        Group {
            if let reason = model.caps?.unavailable, model.caps?.available == false {
                AiUnavailableView(reason: reason, host: host)
            } else {
                HStack(spacing: 0) {
                    if let history {
                        AiConversationList(model: model, history: history, frame: frame, deleting: $deleting)
                            // (264 with its 1 pt border on the right, inside the width as CSS draws it.)
                            .padding(.trailing, 1)
                            .frame(width: look.s("ai.aside").width)
                            .overlay(alignment: .trailing) { Rectangle().fill(look.line70).frame(width: 1) }
                    }
                    VStack(spacing: 0) {
                        header(look: look)
                        AiThreadView(model: model, variant: .page, host: host)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay { if let d = deleting { deleteDialog(d) } }
        .onAppear {
            if history == nil { history = FoliHistoryModel(client: frame.client) }
            sync()
        }
        .onChange(of: conversationId) { _, _ in sync() }
        .onChange(of: model.conversationId) { _, id in
            // The first question names a new chat: its address replaces /ai in the same tab.
            if let id, id != conversationId { frame.open(.web("/ai/\(id)"), title: model.title) }
        }
        .onChange(of: model.title) { _, t in frame.tabs.setTitle(model.isNew ? "New chat" : t, for: "view:ai") }
        .accessibilityIdentifier("screen.ai")
    }

    private func sync() {
        if let id = conversationId {
            if model.conversationId != id { model.open(conversationId: id) }
        } else if !model.isNew {
            model.newChat()
        }
        frame.tabs.setTitle(model.isNew ? "New chat" : model.title, for: "view:ai")
    }

    private func header(look: AiLook) -> some View {
        let h = look.s("ai.header")
        let title = model.isNew ? "New chat" : (model.info?.title ?? "")
        let more = look.s("ai.header.more")
        return HStack(spacing: h.gap) {
            Text(title).webText(look.text("ai.header.title")).lineLimit(1).truncationMode(.tail).foregroundStyle(look.heading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            if !model.isNew, model.info != nil {
                WebMenuButton(width: 240, entries: { AiConversationMenu.entries(model: model, host: host, id: model.conversationId ?? "", title: title, includeRows: false) }) {
                    WebIconView(.ellipsis, size: 16).frame(width: more.width, height: more.height).foregroundStyle(more.color.color).contentShape(Rectangle())
                }
                .buttonStyle(AiHoverStyle(radius: more.radius))
                .accessibilityLabel("Conversation options")
            }
        }
        .padding(.horizontal, h.padding.left)
        .frame(height: h.height)
    }

    private func deleteDialog(_ row: ChatConversationRow) -> some View {
        ZStack {
            Color.black.opacity(0.0001).onTapGesture { deleting = nil }
            WebDialog("Delete this conversation?", description: "“\(row.title)” and everything in it will be gone for good.", width: 384) {
                EmptyView()
            } footer: {
                WebButton("Cancel") { deleting = nil }.keyboardShortcut(.cancelAction)
                WebButton("Delete", variant: .danger) {
                    let id = row.id
                    deleting = nil
                    let active = id == model.conversationId
                    model.remove(id)
                    if active { frame.open(.web("/ai")) }
                }
                .keyboardShortcut(.defaultAction)
            }
        }
    }
}

/// A conversation's menu (ConversationList.tsx and ConversationActions.tsx): Rename and Pin for a row, then
/// share (says plainly why it can't), Copy as Markdown, Download Markdown, Save as note, and Delete.
@MainActor
enum AiConversationMenu {
    static func entries(model: FoliChatModel, host: AiHost, id: String, title: String, pinned: Bool = false, includeRows: Bool, onRename: @escaping @MainActor @Sendable () -> Void = {}, onDelete: @escaping @MainActor @Sendable () -> Void = {}) -> [WebMenuEntry] {
        var out: [WebMenuEntry] = []
        if includeRows {
            out.append(WebMenuEntry(.item("Rename", icon: .pencil, id: "rename"), action: onRename))
            out.append(WebMenuEntry(.item(pinned ? "Unpin" : "Pin", icon: pinned ? .pinOff : .pin, id: "pin")) { model.pin(id, !pinned) })
            out.append(.separator(1))
        }
        if !host.local {
            // Sharing a chat with the workspace needs R12.6 (the encrypted-content consent): said plainly here.
            out.append(WebMenuEntry(.item("Share with workspace", icon: .share2, id: "share"), disabled: true))
            out.append(.separator(2))
        }
        out.append(WebMenuEntry(.item("Copy as Markdown", icon: .clipboardCopy, id: "copy")) {
            Task { if let md = await markdown(model: model, id: id, title: title) { AiPasteboard.copy(md) } }
        })
        out.append(WebMenuEntry(.item("Download Markdown", icon: .download, id: "download")) {
            Task { if let md = await markdown(model: model, id: id, title: title) { save(md, title: title) } }
        })
        out.append(WebMenuEntry(.item("Save as note", icon: .filePlusCorner, id: "save")) { model.saveAsNote(conversationId: id) })
        if includeRows {
            out.append(.separator(3))
            out.append(WebMenuEntry(.item("Delete…", icon: .trash, danger: true, id: "delete"), action: onDelete))
        }
        return out
    }

    /// The conversation as Markdown: its title, then each turn.
    static func markdown(model: FoliChatModel, id: String, title: String) async -> String? {
        let messages: [ChatMessage]
        if id == model.conversationId { messages = model.messages } else {
            guard let v = try? await model.client.query(.aiConversation(conversationId: id)) else { return nil }
            messages = v.messages
        }
        var out = "# \(title.isEmpty ? "Foli AI" : title)\n"
        for m in messages { out += "\n**\(m.role == .user ? "You" : "Foli AI")**\n\n\(m.text)\n" }
        return out
    }

    static func save(_ text: String, title: String) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
        let safe = title.replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespaces)
        panel.nameFieldStringValue = "\(safe.isEmpty ? "Foli AI" : String(safe.prefix(80))).md"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? text.write(to: url, atomically: true, encoding: .utf8)
    }
}

/// The conversations (ConversationList.tsx).
struct AiConversationList: View {
    let model: FoliChatModel
    @Bindable var history: FoliHistoryModel
    let frame: FrameModel
    @Binding var deleting: ChatConversationRow?
    @State private var renaming: String?
    @State private var name = ""
    @FocusState private var renameFocused: Bool
    @Environment(\.colorScheme) private var scheme

    var host: AiHost { AiHost(session: frame.session.value, openSettings: { [weak frame] s in frame?.host?.frameOpenSettings(section: s) }) }

    var body: some View {
        let look = AiLook(scheme: scheme)
        let top = look.s("ai.list.top")
        let new = look.s("ai.list.new")
        let well = look.s("ai.list.search")
        let scroll = look.s("ai.list.scroll")
        VStack(spacing: 0) {
            VStack(spacing: new.margin.bottom) {
                Button { frame.open(.web("/ai")); model.newChat() } label: {
                    HStack(spacing: new.gap) {
                        WebIconView(.plus, size: 15)
                        Text("New chat").webText(new.text).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: new.height)
                    .foregroundStyle(new.color.color)
                    .webBox(WebStyles.named("ai.list.new"))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                HStack(spacing: well.gap) {
                    WebIconView(.search, size: 14).foregroundStyle(look.muted)
                    ZStack(alignment: .leading) {
                        if history.search.isEmpty { Text("Search conversations").webText(look.text("ai.list.search.input")).lineLimit(1).foregroundStyle(look.faint) }
                        TextField("", text: $history.search)
                            .textFieldStyle(.plain)
                            .font(Font(look.text("ai.list.search.input").ctFont))
                            .foregroundStyle(look.ink)
                            .accessibilityLabel("Search conversations")
                    }
                }
                .padding(.horizontal, well.padding.left)
                .frame(height: well.height)
                .webBox(WebStyles.named("ai.list.search"))
            }
            .padding(top.padding.edgeInsets)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if model.caps?.history == false {
                        Text("History is off, so new conversations are deleted when you close them.").webText(.role(.subheadline)).foregroundStyle(look.muted)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 10).fill(look.glassHover))
                            .padding(.bottom, 12)
                    }
                    let searching = !history.search.trimmingCharacters(in: .whitespaces).isEmpty
                    if !searching, !history.pinned.isEmpty {
                        caps("PINNED", look: look)
                        rows(history.pinned)
                        Color.clear.frame(height: 12)
                        caps("RECENT", look: look)
                    }
                    rows(history.recent)
                    if !history.isLoading, history.isEmpty {
                        empty(searching: searching, look: look)
                    }
                }
                .padding(scroll.padding.edgeInsets)
            }
            .scrollIndicators(.automatic)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Conversations")
    }

    private func caps(_ t: String, look: AiLook) -> some View {
        Text(t).webText(.caps).lineLimit(1).foregroundStyle(look.faint).padding(.horizontal, 10).padding(.bottom, 4)
    }

    private func rows(_ list: [ChatConversationRow]) -> some View {
        VStack(spacing: 2) {
            ForEach(list, id: \.id) { r in row(r) }
        }
    }

    private func empty(searching: Bool, look: AiLook) -> some View {
        VStack(spacing: 0) {
            WebIconView(.messageSquare, size: 18)
                .frame(width: 36, height: 36)
                .foregroundStyle(look.heading)
                .background(RoundedRectangle(cornerRadius: 6).fill(look.glassHover))
                .padding(.bottom, 12)
            Text(searching ? "No conversations match that" : "No conversations yet").webText(.role(.body, weight: 600)).foregroundStyle(look.heading).multilineTextAlignment(.center)
            if !searching {
                Text("Your conversations will show up here.").webText(WebTextStyle(size: WebTypeRole.subheadline.desktop.size, leading: (WebTypeRole.subheadline.desktop.size * 1.375).rounded(), weight: 400)).foregroundStyle(look.muted).multilineTextAlignment(.center).padding(.top, 4)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 32)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func row(_ r: ChatConversationRow) -> some View {
        let look = AiLook(scheme: scheme)
        if renaming == r.id {
            TextField("", text: $name)
                .textFieldStyle(.plain)
                .font(WebFont.font(.sans, size: WebTypeRole.body.desktop.size))
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 6).fill(look.glassHover))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(look.glassBorder))
                .focused($renameFocused)
                .onSubmit { finishRename(r) }
                .onKeyPress(.escape) { renaming = nil; return .handled }
                .onChange(of: renameFocused) { _, f in if !f, renaming == r.id { finishRename(r) } }
                .padding(.horizontal, 4).padding(.vertical, 2)
                .accessibilityLabel("Conversation name")
        } else {
            AiConversationRowView(row: r, active: r.id == model.conversationId, open: { frame.open(.web("/ai/\(r.id)"), title: r.title) }) {
                AiConversationMenu.entries(model: model, host: host, id: r.id, title: r.title, pinned: r.pinned, includeRows: true, onRename: {
                    name = r.title
                    renaming = r.id
                    DispatchQueue.main.async { renameFocused = true }
                }, onDelete: { deleting = r })
            }
        }
    }

    private func finishRename(_ r: ChatConversationRow) {
        renaming = nil
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty, t != r.title { model.rename(r.id, to: t) }
    }
}

struct AiConversationRowView: View {
    let row: ChatConversationRow
    let active: Bool
    let open: () -> Void
    let menu: @MainActor () -> [WebMenuEntry]
    @State private var over = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let s = look.s("ai.row.active")
        let more = look.s("ai.row.more")
        ZStack(alignment: .trailing) {
            Button(action: open) {
                HStack(spacing: s.gap) {
                    Text(row.title.isEmpty ? "New chat" : row.title)
                        .webText(WebTextStyle(size: s.fontSize, leading: s.lineHeight ?? 20, weight: active ? 600 : 400, letterSpacing: s.letterSpacing))
                        .lineLimit(1).truncationMode(.tail)
                        .foregroundStyle(active || over ? look.heading : look.ink.opacity(0.9))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if row.shared { WebIconView(.users, size: 12).foregroundStyle(look.faint).help("Shared with the workspace") }
                    if !over {
                        Text(AiAge.text(row.lastMessageAt)).webText(look.text("ai.row.age")).lineLimit(1).foregroundStyle(look.faint)
                    }
                }
                .padding(.leading, s.padding.left)
                .padding(.trailing, over ? 36 : s.padding.right)
                .frame(height: s.height)
                .background {
                    if active {
                        Color.clear.webBox(WebStyles.named("ai.row.active"))
                    } else if over {
                        RoundedRectangle(cornerRadius: s.radius).fill(look.glassHover)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .webContextMenu(menu)
            if over {
                WebMenuButton(width: 240, entries: menu) {
                    WebIconView(.ellipsis, size: 14).frame(width: more.width, height: more.height).foregroundStyle(more.color.color).contentShape(Rectangle())
                }
                .buttonStyle(AiHoverStyle(radius: more.radius, hover: "glass-active"))
                .padding(.trailing, 4)
                .accessibilityLabel("Options for \(row.title)")
            }
        }
        .onHover { over = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
    }
}

/// Foli AI can't be used here (AiUnavailable.tsx): why, and where to change it. Never a price or a plan in
/// local mode; the plans link only where buying is allowed.
struct AiUnavailableView: View {
    let reason: String
    let host: AiHost
    var compact = false
    @Environment(\.colorScheme) private var scheme

    static let includes = "answers from your notes with links, writing help, an agent that tidies up and edits notes (always showing changes first), study tools and research"

    static func copy(_ reason: String, local: Bool, purchases: Bool) -> (title: String, body: String, link: (label: String, section: String)?) {
        switch reason {
        case "off":
            return ("Foli AI is turned off", "You turned Foli AI off, so nothing is sent to AI. Turn it on again in Settings > AI.", ("Open AI settings", "ai"))
        case "setup":
            return ("Set up Foli AI on this Mac", "Turn on Apple Intelligence, or add your own OpenAI, Anthropic or Google key. Your notes go straight from this Mac to the model, never through Folevi.", ("Open AI settings", "ai"))
        case "workspacePlan":
            return ("Foli AI isn't part of this workspace's plan", "Plans with Foli AI include \(includes). A workspace owner or admin can change the plan.", purchases ? ("See plans", "billing") : nil)
        default:
            if local { return copy("setup", local: true, purchases: false) }
            return ("Foli AI isn't part of your plan", "Core doesn't include Foli AI. Pro and Pro AI do: \(includes).", purchases ? ("Upgrade", "billing") : nil)
        }
    }

    var body: some View {
        let look = AiLook(scheme: scheme)
        let c = Self.copy(reason, local: host.local, purchases: host.purchases)
        VStack(spacing: 0) {
            AiMarkGlyph(size: 28)
            Text(c.title).webText(.display(.title1)).foregroundStyle(look.heading).multilineTextAlignment(.center).padding(.top, 16)
            Text(c.body).webText(.role(.body)).foregroundStyle(look.muted).multilineTextAlignment(.center).padding(.top, 8)
            if let link = c.link {
                WebButton(link.label, variant: .secondary) { host.openSettings(link.section) }.padding(.top, 24)
            }
        }
        .frame(maxWidth: 448)
        .padding(.horizontal, 24)
        .padding(.vertical, 96)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityIdentifier("ai-unavailable")
    }
}
#endif
