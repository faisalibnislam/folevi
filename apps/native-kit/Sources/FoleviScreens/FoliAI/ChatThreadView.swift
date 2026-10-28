// The conversation (web chat/ChatThread.tsx): one lazy column of rows, where an answer is a row per Markdown
// block, so a 5,000-word answer streams without building or measuring what's off screen. It follows the end
// while you're at the bottom, stays put when you've scrolled up (with "Jump to latest"), and shows the empty
// state with suggestions before the first question.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// A row of the thread.
enum ThreadRow: Identifiable, Equatable {
    case intro
    case loading
    case missing
    case user(ChatMessage)
    /// An answer's top: agent steps, a refusal, research progress.
    case answerHead(ChatMessage)
    case block(messageId: String, MDBlock)
    case answerFoot(ChatMessage)
    case pending(String)
    case problem(String)

    var id: String {
        switch self {
        case .intro: "intro"
        case .loading: "loading"
        case .missing: "missing"
        case .user(let m): "u:\(m.id)"
        case .answerHead(let m): "h:\(m.id)"
        case .block(let id, let b): "b:\(id):\(b.id)"
        case .answerFoot(let m): "f:\(m.id)"
        case .pending: "pending"
        case .problem: "problem"
        }
    }
}

@MainActor
func threadRows(_ model: FoliChatModel) -> [ThreadRow] {
    var rows: [ThreadRow] = []
    if model.isLoading { rows.append(.loading) }
    if model.isMissing { rows.append(.missing) }
    if model.isEmpty, !model.isLoading { rows.append(.intro) }
    for m in model.messages {
        if m.role == .user {
            rows.append(.user(m))
            continue
        }
        rows.append(.answerHead(m))
        if m.status != "error" || !m.text.isEmpty {
            for b in model.answer(m.id)?.blocks ?? [] { rows.append(.block(messageId: m.id, b)) }
        }
        rows.append(.answerFoot(m))
    }
    if let p = model.shownPending { rows.append(.pending(p.text)) }
    if let problem = model.problem { rows.append(.problem(problem)) }
    return rows
}

public struct FoliThreadView: View {
    @Bindable var model: FoliChatModel
    var compact: Bool
    /// Space the composer covers at the bottom (the iPhone's composer floats over the thread's end).
    var bottomInset: CGFloat = 0

    @State private var pinned = true
    @State private var viewport: CGFloat = 0
    @State private var sentinel: CGFloat = 0
    @State private var contentHeight: CGFloat = 0
    @State private var userScrolling = false
    @State private var measuredHeight: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: FoliChatModel, compact: Bool, bottomInset: CGFloat = 0) {
        self.model = model
        self.compact = compact
        self.bottomInset = bottomInset
    }

    public var body: some View {
        let metrics = AnswerMetrics.current(compact)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(threadRows(model)) { row in
                            rowView(row, metrics: metrics)
                        }
                    }
                    .padding(.horizontal, compact ? 18 : 22)
                    .padding(.top, 12)
                    // Always alive (outside the lazy column), so "at the bottom" is always known.
                    Color.clear.frame(height: 1).id("end")
                        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named("thread")).minY } action: { sentinel = $0 }
                }
                .padding(.bottom, 12 + bottomInset)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .coordinateSpace(.named("thread"))
            .scrollDismissesKeyboard(.interactively)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewport = $0 }
            .onChange(of: sentinel) { _, y in
                let distance = y - viewport + bottomInset
                if FollowEnd.anchored {
                    // Only the person's own scrolling unpins (growth never does: the anchor keeps the end).
                    guard userScrolling else { return }
                    if distance > 48 { pinned = false } else if distance < 24 { pinned = true }
                    return
                }
                // iOS 17: the end moved away while the content kept its height: the person scrolled up. (When the
                // content grew, the next follow brings the end back.)
                if contentHeight != measuredHeight {
                    measuredHeight = contentHeight
                    if distance < 24 { pinned = true }
                    return
                }
                if distance > 48 { pinned = false } else if distance < 24 { pinned = true }
            }
            .modifier(ScrollPhaseWatch(scrolling: $userScrolling))
            .modifier(FollowEnd(pinned: pinned))
            .onChange(of: contentHeight) { _, _ in
                // iOS 17: follow the end while pinned, only when the content got taller (a new line, a new
                // block), never per word. iOS 18 and the Mac anchor the bottom instead (FollowEnd).
                // On the Mac the anchor alone lets a lazy column's end drift off screen as it grows (it
                // estimates the rows it hasn't measured): follow there too.
                #if os(macOS)
                guard pinned else { return }
                #else
                guard pinned, !FollowEnd.anchored else { return }
                #endif
                proxy.scrollTo("end", anchor: .bottom)
            }
            .onChange(of: model.shownPending) { _, p in
                guard p != nil else { return }
                pinned = true
                withAnimation(reduceMotion ? nil : .folevi(0.25)) { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: model.conversationId) { _, _ in
                pinned = true
                proxy.scrollTo("end", anchor: .bottom)
            }
            .onAppear { proxy.scrollTo("end", anchor: .bottom) }
            .overlay(alignment: .bottom) {
                if !pinned, !model.messages.isEmpty {
                    Button {
                        pinned = true
                        withAnimation(reduceMotion ? nil : .folevi(0.3)) { proxy.scrollTo("end", anchor: .bottom) }
                    } label: {
                        Label("Jump to latest", systemImage: "arrow.down")
                            .foleviFont(.footnote).fontWeight(.semibold)
                            .padding(.horizontal, 14).frame(minHeight: 36)
                            .foregroundStyle(Folevi.color.ink)
                            .background(Capsule().fill(Folevi.color.surfaceRaised))
                            .foleviShadow(.pop, radius: 18)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, bottomInset + 12)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                }
            }
            .foleviAnimation(FoleviTokens.Motion.base, value: pinned)
        }
    }

    @ViewBuilder
    func rowView(_ row: ThreadRow, metrics: AnswerMetrics) -> some View {
        switch row {
        case .intro:
            FoliIntroView(model: model, compact: compact).padding(.top, compact ? 4 : 16)
        case .loading:
            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Loading the chat...").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) }
                .padding(.vertical, 12)
        case .missing:
            Text("This chat isn't here anymore. Ask something to start a new one.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).padding(.vertical, 12)
        case .user(let m):
            UserMessageView(model: model, message: m, compact: compact).padding(.vertical, 10)
        case .answerHead(let m):
            AnswerHeadView(model: model, message: m)
        case .block(_, let b):
            MDBlockView(block: b, metrics: metrics).equatable()
                .padding(.vertical, 5)
                .textSelection(.enabled)
                .environment(\.openURL, OpenURLAction { url in citeOrOpen(url) })
        case .answerFoot(let m):
            AnswerFootView(model: model, message: m, compact: compact).padding(.bottom, 8)
        case .pending(let text):
            UserBubble(text: text, compact: compact).padding(.vertical, 10)
        case .problem(let text):
            Label(text, systemImage: "exclamationmark.circle")
                .foleviFont(.callout)
                .foregroundStyle(Folevi.color.destructive)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(Folevi.color.destructiveSoft))
                .padding(.vertical, 8)
        }
    }

    func citeOrOpen(_ url: URL) -> OpenURLAction.Result {
        if url.scheme == "folevi-cite", let n = Int(url.host ?? "") {
            if let m = model.messages.last(where: { $0.citations.contains { $0.n == n } || $0.webCitations.contains { $0.n == n } }) {
                if let c = m.citations.first(where: { $0.n == n }) { model.openCitation(c); return .handled }
                if let w = m.webCitations.first(where: { $0.n == n }), let u = URL(string: w.url) { return .systemAction(u) }
            }
            return .discarded
        }
        return model.openLink(url) ? .handled : .systemAction
    }
}

/// While the thread is at its end, the scroll view keeps its bottom anchored as the content grows (no scroll per
/// line); scrolled up, the anchor is the top, so what you're reading stays put.
struct FollowEnd: ViewModifier {
    let pinned: Bool
    /// Read once: the thread asks on every update while an answer streams.
    static let anchored: Bool = {
        if #available(iOS 18, macOS 15, *) { return ProcessInfo.processInfo.environment["FOLEVI_FOLLOW_BY_SCROLL"] == nil }
        return false
    }()
    func body(content: Content) -> some View {
        if #available(iOS 18, macOS 15, *), Self.anchored {
            content.defaultScrollAnchor(pinned ? .bottom : .top, for: .sizeChanges)
        } else {
            content
        }
    }
}

/// Whether the person is scrolling (dragging or flicking), on iOS 18 and the Mac.
struct ScrollPhaseWatch: ViewModifier {
    @Binding var scrolling: Bool
    func body(content: Content) -> some View {
        if #available(iOS 18, macOS 15, *) {
            content.onScrollPhaseChange { _, phase in scrolling = phase == .interacting || phase == .decelerating || phase == .tracking }
        } else {
            content
        }
    }
}

/// Before the first question: what Foli AI does, and suggestions to tap.
struct FoliIntroView: View {
    let model: FoliChatModel
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !model.available {
                HStack(spacing: 8) { FoliSpark(size: 18); Text("Foli AI isn't on here").foleviFont(.headline).foregroundStyle(Folevi.color.heading) }
                Text("Turn it on in Settings > Foli AI, or ask the workspace's admin.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).padding(.top, 6)
            } else {
                HStack(spacing: 8) {
                    FoliSpark(size: 18)
                    Text("Meet Foli AI").font(FoleviFonts.font(.display, size: 22, weight: .semibold, relativeTo: .title2)).foregroundStyle(Folevi.color.heading)
                }
                Text(model.effectiveMode == .research
                     ? "Research searches the web and your notes, then writes a report with sources. It takes a few minutes."
                     : "Ask about your notes or ask Foli AI to change them. Answers link to the notes they come from, and you see every change before it's made.")
                    .foleviFont(.callout)
                    .foregroundStyle(Folevi.color.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
                Text("Suggestions").foleviFont(.headline).foregroundStyle(Folevi.color.heading).padding(.top, 20).padding(.bottom, 2)
                ForEach(model.suggestions, id: \.self) { s in
                    Button { model.send(s) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "sparkle").font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.inkMuted).accessibilityHidden(true)
                            Text(s).foleviFont(.body).foregroundStyle(Folevi.color.ink).multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressFade())
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Fades a little while pressed (rows and small buttons).
struct PressFade: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.55 : 1)
    }
}
