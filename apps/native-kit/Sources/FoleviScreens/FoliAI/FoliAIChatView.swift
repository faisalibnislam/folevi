// The Foli AI chat, container-agnostic (plan 5.9): header, thread (or the history list) and composer. The Mac
// panel and iPad hosts use `FoliAIChatView` whole; the iPhone sheet (FoliChatController) hosts `FoliChatTop`
// and `FoliComposerView` separately so the composer can ride the keyboard layout guide.
//
// Header (owner's feedback): History on the left, the chat's title centred and truncated, New chat and Close on
// the right. The two sides are the same width, so the title stays centred and never runs under a button.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct FoliAIChatView: View {
    @Bindable var model: FoliChatModel
    var compact: Bool

    public init(model: FoliChatModel, compact: Bool) {
        self.model = model
        self.compact = compact
    }

    public var body: some View {
        VStack(spacing: 0) {
            FoliChatTop(model: model, compact: compact)
            if !model.historyOpen { FoliComposerView(model: model, compact: compact) }
        }
        .background(Folevi.color.canvas)
    }
}

/// Header plus the thread or the history list.
public struct FoliChatTop: View {
    @Bindable var model: FoliChatModel
    var compact: Bool
    var bottomInset: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: FoliChatModel, compact: Bool, bottomInset: CGFloat = 0) {
        self.model = model
        self.compact = compact
        self.bottomInset = bottomInset
    }

    public var body: some View {
        VStack(spacing: 0) {
            FoliChatHeader(model: model, compact: compact)
            ZStack {
                if model.historyOpen {
                    FoliHistoryView(model: model, compact: compact)
                        .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
                } else {
                    FoliThreadView(model: model, compact: compact, bottomInset: bottomInset)
                        .transition(.opacity)
                }
            }
            .frame(maxHeight: .infinity)
            .clipped()
        }
        .background(Folevi.color.canvas)
        .onChange(of: reduceMotion, initial: true) { _, r in model.reduceMotion = r }
        .onChange(of: model.announcement) { _, text in
            guard let text else { return }
            AccessibilityNotification.Announcement(text).post()
        }
        .confirmationDialog("Some notes changed after Foli AI's edits", isPresented: Binding(get: { model.undoConflict != nil }, set: { if !$0 { model.dismissUndoConflict() } }), titleVisibility: .visible) {
            if let c = model.undoConflict {
                Button("Undo anyway", role: .destructive) { model.undo(c.run, force: .all) }
                Button("Undo the rest") { model.undo(c.run, force: .rest) }
                Button("Cancel", role: .cancel) { model.dismissUndoConflict() }
            }
        } message: {
            Text("Undo anyway puts them back as they were before Foli AI. The later edits stay in version history.")
        }
        .foleviAnimation(FoleviTokens.Motion.base, value: model.historyOpen)
    }
}

struct FoliChatHeader: View {
    @Bindable var model: FoliChatModel
    var compact: Bool
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var confirmDelete = false
    @ScaledMetric(relativeTo: .body) private var button: CGFloat = 36

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 4) {
                headerButton(model.historyOpen ? "chevron.left" : "clock.arrow.circlepath", label: model.historyOpen ? "Back to the chat" : "Chats") {
                    model.historyOpen.toggle()
                }
                .accessibilityIdentifier("foli-history")
                Spacer(minLength: 0)
            }
            .frame(width: button * 2 + 8)
            titleView.frame(maxWidth: .infinity)
            HStack(spacing: 4) {
                Spacer(minLength: 0)
                headerButton("square.and.pencil", label: "New chat") { model.newChat() }
                    .disabled(model.isNew && !model.historyOpen && model.context.isEmpty && model.draft.isEmpty)
                    .accessibilityIdentifier("foli-new-chat")
                headerButton("xmark", label: "Close") { model.onClose() }
                    .keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("foli-close")
            }
            .frame(width: button * 2 + 8)
        }
        .padding(.horizontal, 10)
        .padding(.top, compact ? 10 : 8)
        .padding(.bottom, 6)
        .alert("Rename chat", isPresented: $renaming) {
            TextField("Title", text: $newTitle)
            Button("Rename") { if let id = model.conversationId { model.rename(id, to: newTitle) } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete this chat?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let id = model.conversationId { model.remove(id) } }
        } message: { Text("It's deleted for good.") }
    }

    @ViewBuilder
    var titleView: some View {
        let title = Text(model.historyOpen ? "Chats" : model.title)
            .foleviFont(.headline)
            .foregroundStyle(Folevi.color.heading)
            .lineLimit(1)
            .truncationMode(.tail)
        if model.historyOpen || model.isNew {
            title.accessibilityAddTraits(.isHeader)
        } else {
            // The title opens the chat's options.
            Menu {
                Button { newTitle = model.info?.title ?? ""; renaming = true } label: { Label("Rename", systemImage: "pencil") }
                if let id = model.conversationId {
                    let pinned = model.info?.pinned ?? false
                    Button { model.pin(id, !pinned) } label: { Label(pinned ? "Unpin" : "Pin", systemImage: pinned ? "pin.slash" : "pin") }
                }
                Button { model.saveAsNote() } label: { Label("Save as note", systemImage: "square.and.arrow.down") }
                ShareLink(item: model.transcript) { Label("Share...", systemImage: "square.and.arrow.up") }
                Divider()
                Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
            } label: {
                HStack(spacing: 4) {
                    title
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(Folevi.color.inkFaint)
                }
                .padding(.horizontal, 6)
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(PressFade())
            .accessibilityLabel("\(model.title), chat options")
        }
    }

    func headerButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Folevi.color.ink)
                .frame(width: button, height: button)
                .background(Circle().fill(Folevi.color.surfaceSunken))
                .contentShape(Circle())
        }
        .buttonStyle(PressFade())
        .accessibilityLabel(label)
        .help(label)
    }
}

/// The chats: pinned first, then recent; search, rename, pin, delete.
struct FoliHistoryView: View {
    let model: FoliChatModel
    let compact: Bool
    @State private var history: FoliHistoryModel?
    @State private var renaming: ChatConversationRow?
    @State private var newTitle = ""
    @State private var deleting: ChatConversationRow?

    var body: some View {
        VStack(spacing: 0) {
            if let history {
                SearchField(text: Binding(get: { history.search }, set: { history.search = $0 }), prompt: "Search chats")
                    .padding(.horizontal, 16).padding(.bottom, 6)
                List {
                    if !history.pinned.isEmpty {
                        Section("Pinned") { ForEach(history.pinned, id: \.id) { row($0) } }
                    }
                    if !history.recent.isEmpty {
                        Section("Recent") { ForEach(history.recent, id: \.id) { row($0) } }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .overlay {
                    if history.isLoading { ProgressView() } else if history.isEmpty {
                        EmptyState(systemImage: "bubble.left.and.text.bubble.right", title: history.search.isEmpty ? "No chats yet" : "No chats match", message: history.search.isEmpty ? "Your chats with Foli AI show here." : nil)
                    }
                }
            } else {
                Spacer()
            }
        }
        .onAppear { if history == nil { history = FoliHistoryModel(client: model.client) } }
        .alert("Rename chat", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Rename") { if let r = renaming { model.rename(r.id, to: newTitle) } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete this chat?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let d = deleting { model.remove(d.id) } }
        } message: { Text("It's deleted for good.") }
    }

    func row(_ r: ChatConversationRow) -> some View {
        Button { model.open(conversationId: r.id) } label: {
            HStack(spacing: 10) {
                Image(systemName: r.pinned ? "pin.fill" : r.shared ? "person.2" : "bubble.left")
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(Folevi.color.inkMuted).frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.title.isEmpty ? "New chat" : r.title).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.ink).lineLimit(1)
                    Text(AgeText.relative(Date(timeIntervalSince1970: r.lastMessageAt / 1000), now: ScreenClock.now())).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                }
                Spacer(minLength: 0)
                if r.id == model.conversationId { Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Folevi.color.accentStrong) }
            }
            .frame(minHeight: compact ? 52 : 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
        .contextMenu { menu(r) }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { deleting = r } label: { Label("Delete", systemImage: "trash") }
            Button { model.pin(r.id, !r.pinned) } label: { Label(r.pinned ? "Unpin" : "Pin", systemImage: r.pinned ? "pin.slash" : "pin") }.tint(Folevi.color.ember)
        }
        .accessibilityLabel("\(r.title.isEmpty ? "New chat" : r.title)\(r.pinned ? ", pinned" : "")")
    }

    @ViewBuilder
    func menu(_ r: ChatConversationRow) -> some View {
        Button { newTitle = r.title; renaming = r } label: { Label("Rename", systemImage: "pencil") }
        Button { model.pin(r.id, !r.pinned) } label: { Label(r.pinned ? "Unpin" : "Pin", systemImage: r.pinned ? "pin.slash" : "pin") }
        Divider()
        Button(role: .destructive) { deleting = r } label: { Label("Delete", systemImage: "trash") }
    }
}
