// The note's Comments tool on the iPhone, drawn natively (apps/web/src/components/doc/Comments.tsx CommentsList as
// the iPhone's sheet shows it): a comment on the whole note, Open and Resolved, a search once there are a few
// threads, and the threads newest first: what each is on, who wrote it and when, its first comment, its replies.
// A thread on a line opens in the note under that line (`thread.open`); one on the whole note opens here, with its
// comments and a reply. Each has its menu: Resolve or Reopen, Mark as read or unread, Copy link, Delete thread.
// In local mode it says what comments need instead.
import SwiftUI

/// The Comments tool's state (the engine's `note.tools` comments, in plain values).
public struct PhoneCommentsState: Equatable, Sendable {
    public struct Comment: Equatable, Sendable, Identifiable {
        public var id: String
        public var author: String
        public var avatarUrl: String?
        public var text: String
        public var deleted: Bool
        public var createdAt: Date
        public init(id: String, author: String, avatarUrl: String? = nil, text: String, deleted: Bool = false, createdAt: Date) {
            self.id = id
            self.author = author
            self.avatarUrl = avatarUrl
            self.text = text
            self.deleted = deleted
            self.createdAt = createdAt
        }
    }

    public struct Thread: Equatable, Sendable, Identifiable {
        public var id: String
        /// The line it's on (nil: the whole note, or a line that's gone).
        public var blockId: String?
        public var anchor: String
        public var author: String
        public var avatarUrl: String?
        public var text: String
        public var deleted: Bool
        public var replies: Int
        public var resolved: Bool
        public var resolvedBy: String?
        public var unread: Bool
        public var lastActivityAt: Date
        /// "waiting" or "failed" while it's still on this device.
        public var waiting: String?
        public var comments: [Comment]
        public var canResolve: Bool
        public var canDelete: Bool

        public init(id: String, blockId: String?, anchor: String, author: String, avatarUrl: String? = nil, text: String, deleted: Bool = false, replies: Int = 0, resolved: Bool = false, resolvedBy: String? = nil, unread: Bool = false, lastActivityAt: Date, waiting: String? = nil, comments: [Comment] = [], canResolve: Bool = true, canDelete: Bool = false) {
            self.id = id
            self.blockId = blockId
            self.anchor = anchor
            self.author = author
            self.avatarUrl = avatarUrl
            self.text = text
            self.deleted = deleted
            self.replies = replies
            self.resolved = resolved
            self.resolvedBy = resolvedBy
            self.unread = unread
            self.lastActivityAt = lastActivityAt
            self.waiting = waiting
            self.comments = comments
            self.canResolve = canResolve
            self.canDelete = canDelete
        }
    }

    /// False in local mode.
    public var available = true
    public var loaded = true
    public var canComment = true
    public var threads: [Thread] = []

    public init() {}
}

/// What a Comments control does.
public enum PhoneCommentsAction: Equatable, Sendable {
    case create(String)
    case reply(threadId: String, text: String)
    /// A thread on a line: open it in the note.
    case open(String)
    case resolve(String, Bool)
    case read(String, Bool)
    case delete(String)
    case copyLink(String)
}

/// The Comments sheet's content (inside a PhoneSheetPanel titled "Comments").
public struct PhoneCommentsSheetContent: View {
    let state: PhoneCommentsState
    let now: Date
    let run: (PhoneCommentsAction) -> Void
    @AppStorage("folevi.comments.filter") private var filter = "open"
    @State private var query = ""
    @State private var draft = ""
    @State private var expanded: String?
    @State private var confirmDelete: String?
    @State private var replies: [String: String] = [:]
    @State private var menus = PhoneMenus()
    @Environment(\.colorScheme) private var scheme
    @Environment(\.webSnapshot) private var snapshot

    public init(state: PhoneCommentsState, now: Date = Date(), run: @escaping (PhoneCommentsAction) -> Void) {
        self.state = state
        self.now = now
        self.run = run
    }

    private func c(_ pair: ColorPair) -> Color { pair.resolve(scheme).color }

    public var body: some View {
        Group {
            if !state.available {
                signIn
            } else if !state.loaded {
                Text("Loading comments…").webText(.role(.subheadline)).foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
            } else {
                list
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
        .overlay { PhoneMenuLayer(menus: menus) }
    }

    /// SignInToCollaborate as a panel: the people icon on a soft tile, the title, why.
    private var signIn: some View {
        VStack(spacing: 0) {
            WebIconView(.users, size: 16, strokeWidth: 1.9)
                .foregroundStyle(c(FoleviTokens.Chrome.heading))
                .frame(width: 36, height: 36)
                .background(c(FoleviTokens.Glass.hover), in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular))
                .padding(.bottom, 12)
            Text("Sign in to Folevi to share and collaborate")
                .webText(PhoneType.body(weight: FoleviTokens.FontWeight.semibold))
                .multilineTextAlignment(.center)
                .foregroundStyle(c(FoleviTokens.Chrome.heading))
            Text("Your notes are kept on your devices. Sharing, comments and workspaces need a Folevi account.")
                .webText(PhoneType.subheadline(leading: 20))
                .multilineTextAlignment(.center)
                .foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
                .padding(.top, 4)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 32)
        .frame(maxWidth: .infinity)
    }

    private var list: some View {
        let open = state.threads.filter { !$0.resolved }
        let resolved = state.threads.filter(\.resolved)
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = (filter == "open" ? open : resolved)
            .filter { t in q.isEmpty || ([t.anchor] + t.comments.map { "\($0.author) \($0.deleted ? "" : $0.text)" } + [t.author, t.text]).joined(separator: " ").lowercased().contains(q) }
            .sorted { $0.lastActivityAt > $1.lastActivityAt }
        return VStack(alignment: .leading, spacing: 12) {
            if state.canComment {
                composer
            } else {
                Text("You can read comments on this note but not add them.").webText(PhoneType.subheadline(leading: 20)).foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
            }
            VStack(spacing: 8) {
                filterSeg(open: open.count, resolved: resolved.count)
                if state.threads.count > 2 {
                    TextField("", text: $query, prompt: Text("Search comments").foregroundStyle(c(FoleviTokens.Chrome.inkFaint)))
                        .font(WebFont.font(.sans, size: WebTypeRole.callout.metrics.size))
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 10)
                        .frame(height: 32)
                        .background(inputBox(FoleviTokens.Radius.chip))
                        .accessibilityLabel("Search comments")
                }
            }
            if shown.isEmpty {
                Text(!q.isEmpty ? "No comments match." : filter == "open" ? "No open comments." : "No resolved comments.")
                    .webText(PhoneType.subheadline(leading: 20))
                    .foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            } else {
                VStack(spacing: 6) {
                    ForEach(shown) { t in thread(t) }
                }
            }
        }
    }

    /// A comment on the whole note: a growing field, the hint, Comment.
    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            Group {
                // (A picture for the diffs can't draw a text field: its placeholder, as the field shows it.)
                if snapshot {
                    Text("Comment on the whole note").webText(WebTextStyle(size: WebTypeRole.body.metrics.size, leading: WebTypeRole.body.metrics.size * 1.375)).lineLimit(1).foregroundStyle(c(FoleviTokens.Chrome.inkFaint))
                        .frame(height: WebTypeRole.body.metrics.size * 1.375, alignment: .top)
                } else {
                    TextField("", text: $draft, prompt: Text("Comment on the whole note").foregroundStyle(c(FoleviTokens.Chrome.inkFaint)), axis: .vertical)
                        .font(WebFont.font(.sans, size: WebTypeRole.body.metrics.size))
                        .foregroundStyle(c(FoleviTokens.Chrome.ink))
                        .lineLimit(1...6)
                        .textFieldStyle(.plain)
                        .frame(minHeight: WebTypeRole.body.metrics.size * 1.375)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.trailing, 8)
            .accessibilityLabel("Comment on this document")
            HStack {
                Text("@ to mention · Enter to send").webText(.role(.footnote)).foregroundStyle(c(FoleviTokens.Chrome.inkFaint))
                Spacer()
                WebButton("Comment", variant: .primary, size: .sm) { send() }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(inputBox(FoleviTokens.Radius.panel))
        .onSubmit(send)
    }

    /// `.ui-input`: the surface, a soft shadow inside along the top, a 1 pt ring of the line colour outside.
    private func inputBox(_ radius: CGFloat) -> some View {
        WebShapeBox(shape: WebCornersShape(topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius), fill: c(FoleviTokens.Chrome.surface), shadows: [
            ShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: FoleviTokens.Chrome.heading.resolve(scheme).opacity(0.08), inset: true),
            ShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviTokens.Chrome.line.resolve(scheme)),
        ])
    }

    private func send() {
        let t = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        draft = ""
        run(.create(t))
    }

    private func filterSeg(open: Int, resolved: Int) -> some View {
        HStack(spacing: 2) {
            ForEach([("open", "Open", open), ("resolved", "Resolved", resolved)], id: \.0) { id, label, n in
                let on = filter == id
                Button { filter = id } label: {
                    Text(n > 0 ? "\(label) · \(n)" : label)
                        .webText(WebTextStyle(size: WebTypeRole.callout.metrics.size, leading: WebTypeRole.callout.metrics.leading, weight: 550))
                        .lineLimit(1)
                        .foregroundStyle(c(on ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.inkMuted))
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .background {
                            if on {
                                WebShapeBox(shape: WebCornersShape(topLeft: FoleviTokens.Radius.chip, topRight: FoleviTokens.Radius.chip, bottomRight: FoleviTokens.Radius.chip, bottomLeft: FoleviTokens.Radius.chip), fill: c(FoleviTokens.Glass.active), shadows: PhoneStyleSheetContent.glassEdge(scheme) + [ShadowLayer(x: 0, y: 1, blur: 3, spread: 0, color: RGBA(0, 0, 0, 0.08))])
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(c(FoleviTokens.Chrome.ink).opacity(0.06), in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular))
        .accessibilityLabel("Show threads")
    }

    // MARK: A thread

    private func thread(_ t: PhoneCommentsState.Thread) -> some View {
        let inline = t.blockId == nil
        let pending = t.waiting != nil
        return VStack(alignment: .leading, spacing: 4) {
            if confirmDelete == t.id {
                HStack(spacing: 8) {
                    Text("Delete this thread and its \(t.comments.count <= 1 ? "comment" : "\(t.comments.count) comments")?")
                        .webText(PhoneType.subheadline(leading: 20))
                        .foregroundStyle(c(FoleviTokens.Chrome.ink))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    WebButton("Cancel", variant: .quiet, size: .sm) { confirmDelete = nil }
                    WebButton("Delete", variant: .danger, size: .sm) {
                        confirmDelete = nil
                        run(.delete(t.id))
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(c(FoleviTokens.Chrome.destructiveSoft).opacity(0.4), in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular))
            }
            Button {
                if inline {
                    withAnimation(.easeOut(duration: 0.2)) { expanded = expanded == t.id ? nil : t.id }
                } else {
                    run(.open(t.id))
                }
            } label: {
                summary(t, pending: pending)
            }
            .buttonStyle(ThreadPress())
            .overlay(alignment: .topTrailing) {
                if !pending { menuButton(t) }
            }
            if inline, expanded == t.id {
                conversation(t)
            }
        }
    }

    private func summary(_ t: PhoneCommentsState.Thread, pending: Bool) -> some View {
        let faint = c(FoleviTokens.Chrome.inkFaint)
        let when = t.waiting == "failed" ? "Not sent" : pending ? "Waiting to send" : AgeText.relative(t.lastActivityAt, now: now)
        return VStack(alignment: .leading, spacing: 0) {
            Text(t.anchor).webText(.role(.footnote)).lineLimit(1).foregroundStyle(faint).padding(.trailing, 32)
            HStack(spacing: 8) {
                PhoneAvatar(name: t.author, url: t.avatarUrl, size: 20)
                (Text(t.author).font(WebFont.font(.sans, size: WebTypeRole.subheadline.metrics.size, weight: FoleviTokens.FontWeight.semibold)).foregroundStyle(c(FoleviTokens.Chrome.heading)) + Text(" · \(when)").foregroundStyle(faint))
                    .webText(PhoneType.subheadline(leading: 20))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if t.unread {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(c(FoleviTokens.Chrome.coral)).frame(width: 8, height: 8).accessibilityLabel("Unread")
                }
            }
            .frame(height: 20)
            .padding(.top, 6)
            // line-clamp-2 (its box is two of the type size's own 20 pt lines).
            WebFittedLines(t.deleted ? "Comment deleted" : t.text, style: PhoneType.subheadline(leading: WebTypeRole.subheadline.metrics.leading), maxLines: 2)
                .foregroundStyle(t.deleted ? faint : c(FoleviTokens.Chrome.ink))
                .padding(.top, 4)
            if t.replies > 0 || t.resolved {
                HStack(spacing: 8) {
                    if t.replies > 0 {
                        HStack(spacing: 4) {
                            WebIconView(.cornerDownRight, size: 11)
                            Text("\(t.replies) \(t.replies == 1 ? "reply" : "replies")")
                        }
                    }
                    if t.resolved { Text(t.resolvedBy.map { "Resolved by \($0)" } ?? "Resolved") }
                }
                .webText(.role(.footnote))
                .foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
                .padding(.top, 4)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func menuButton(_ t: PhoneCommentsState.Thread) -> some View {
        Button {} label: {
            WebIconView(.ellipsis, size: 15)
                .foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
                .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frames[t.id] = $0 }
        .simultaneousGesture(TapGesture().onEnded { showMenu(t) })
        .padding(6)
        .accessibilityLabel("Thread actions")
    }

    @State private var frames: [String: CGRect] = [:]

    private func showMenu(_ t: PhoneCommentsState.Thread) {
        var entries: [PhoneMenuEntry] = []
        if t.canResolve {
            entries.append(t.resolved ? PhoneMenuEntry(.item("Reopen", icon: .rotateCcw)) { run(.resolve(t.id, false)) } : PhoneMenuEntry(.item("Resolve", icon: .check)) { run(.resolve(t.id, true)) })
        }
        entries.append(t.unread ? PhoneMenuEntry(.item("Mark as read", icon: .eye)) { run(.read(t.id, true)) } : PhoneMenuEntry(.item("Mark as unread", icon: .eyeOff)) { run(.read(t.id, false)) })
        entries.append(PhoneMenuEntry(.item("Copy link", icon: .link2)) { run(.copyLink(t.id)) })
        if t.canDelete { entries.append(PhoneMenuEntry(.item("Delete thread…", icon: .trash, danger: true)) { confirmDelete = t.id }) }
        menus.show(entries, from: frames[t.id] ?? .zero, side: .bottom, align: .end)
    }

    /// A thread on the whole note, open: each comment, then a reply.
    private func conversation(_ t: PhoneCommentsState.Thread) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(t.comments) { cm in
                HStack(alignment: .top, spacing: 8) {
                    PhoneAvatar(name: cm.author, url: cm.avatarUrl, size: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        (Text(cm.author).font(WebFont.font(.sans, size: WebTypeRole.subheadline.metrics.size, weight: FoleviTokens.FontWeight.semibold)).foregroundStyle(c(FoleviTokens.Chrome.heading)) + Text(" · \(AgeText.relative(cm.createdAt, now: now))").foregroundStyle(c(FoleviTokens.Chrome.inkFaint)))
                            .webText(PhoneType.subheadline(leading: 20))
                            .lineLimit(1)
                        Text(cm.deleted ? "Comment deleted" : cm.text)
                            .webText(PhoneType.subheadline(leading: 20))
                            .italic(cm.deleted)
                            .foregroundStyle(cm.deleted ? c(FoleviTokens.Chrome.inkFaint) : c(FoleviTokens.Chrome.ink))
                            .textSelection(.enabled)
                    }
                }
            }
            if state.canComment {
                HStack(spacing: 6) {
                    TextField("", text: Binding(get: { replies[t.id] ?? "" }, set: { replies[t.id] = $0 }), prompt: Text("Reply").foregroundStyle(c(FoleviTokens.Chrome.inkFaint)), axis: .vertical)
                        .font(WebFont.font(.sans, size: WebTypeRole.body.metrics.size))
                        .lineLimit(1...5)
                        .textFieldStyle(.plain)
                        .accessibilityLabel("Reply")
                    WebButton("Reply", variant: .primary, size: .sm) {
                        let text = (replies[t.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        replies[t.id] = ""
                        run(.reply(threadId: t.id, text: text))
                    }
                    .disabled((replies[t.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.leading, 12)
                .padding(.trailing, 4)
                .padding(.vertical, 4)
                .background(inputBox(FoleviTokens.Radius.panel))
            }
        }
        .padding(.horizontal, 2)
        .padding(.bottom, 4)
    }
}

/// Avatar (ui/Avatar.tsx): the picture, or the initial in the heading colour on the sunken surface with a faint
/// edge; the chip radius.
public struct PhoneAvatar: View {
    let name: String
    let url: String?
    let size: CGFloat
    @Environment(\.colorScheme) private var scheme

    public init(name: String, url: String?, size: CGFloat) {
        self.name = name
        self.url = url
        self.size = size
    }

    public var body: some View {
        let shape = RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular)
        let initial = Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased().ifEmpty("?"))
            .font(WebFont.font(.sans, size: max(9, (size * 0.42).rounded()), weight: FoleviTokens.FontWeight.semibold))
            .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
            .frame(width: size, height: size)
            .background(FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color, in: shape)
            .overlay(shape.strokeBorder(FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.08), lineWidth: 1))
        Group {
            if let url, let u = URL(string: url) {
                AsyncImage(url: u) { phase in
                    if let image = phase.image { image.resizable().scaledToFill().frame(width: size, height: size).clipShape(shape) } else { initial }
                }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

private struct ThreadPress: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? FoleviTokens.Glass.hover.resolve(scheme).color : .clear, in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .circular))
    }
}
