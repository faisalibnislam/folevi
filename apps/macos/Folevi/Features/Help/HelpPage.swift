import SwiftUI

/// Help, a page of the main window as on the web (`HelpView`): where the guide lives, your support requests
/// (with our replies and a box to answer), the keyboard shortcuts, and what the save status means.
struct HelpPage: View {
    @Environment(AppModel.self) private var app
    @State private var router = SettingsRouter.shared

    /// The full guide (the web's `${MARKETING_URL}/docs`).
    static let docsURL = URL(string: "https://folevi.com/docs") ?? URL(fileURLWithPath: "/")

    static let shortcuts: [(String, String)] = [
        (String(localized: "Search or jump anywhere"), "⌘ K"),
        (String(localized: "New document"), "⌘ ⌥ N"),
        (String(localized: "Quick add task"), "⌘ ⇧ A"),
        (String(localized: "Toggle sidebar"), "⌘ \\"),
        (String(localized: "Toggle inspector"), "⌘ ⌥ I"),
        (String(localized: "Tasks · Today"), "⌘ ⌥ T"),
        (String(localized: "Bold / italic / underline"), "⌘ B / ⌘ I / ⌘ U"),
        (String(localized: "Strikethrough / inline code"), "⌘ ⇧ X / ⌘ E"),
        (String(localized: "Highlight"), "⌘ ⇧ H"),
        (String(localized: "Text / Heading 1–3"), "⌘ ⌥ 0 / ⌘ ⌥ 1–3"),
        (String(localized: "Numbered / bulleted / to-do"), "⌘ ⇧ 7 / 8 / 9"),
        (String(localized: "Nest / un-nest block"), "Tab / ⇧ Tab"),
        (String(localized: "Move block up / down"), "⌥ ⇧ ↑ / ↓"),
        (String(localized: "Duplicate block"), "⌘ D"),
        (String(localized: "Block options"), "⌘ ."),
        (String(localized: "Toggle to-do or toggle block"), "⌘ Enter"),
        (String(localized: "Task details (due date, reminder…)"), "⌘ ⇧ D"),
        (String(localized: "Soft line break"), "⇧ Enter"),
        (String(localized: "Undo / redo"), "⌘ Z / ⌘ ⇧ Z"),
    ]

    static let statuses: [(String, String)] = [
        (String(localized: "Saved"), String(localized: "Every change has been confirmed by the server.")),
        (String(localized: "Saving…"), String(localized: "Your latest changes are on their way.")),
        (String(localized: "Syncing…"), String(localized: "Waiting for the server to confirm.")),
        (String(localized: "Offline"), String(localized: "Keep writing. Changes are stored on this device and sync when you reconnect.")),
        (String(localized: "Conflict"), String(localized: "The same block changed in two places. Both versions are kept until you choose.")),
        (String(localized: "Not saved"), String(localized: "The server rejected a change, or you need to sign in again. Open the status for details.")),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 40) {
                header
                support
                shortcuts
                statuses
            }
            .frame(maxWidth: 768, alignment: .leading)
            .padding(.horizontal, 32)
            .padding(.top, 24)
            .padding(.bottom, 96)
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
        .onChange(of: router.contactSupport, initial: true) { _, contact in
            guard contact else { return }
            router.contactSupport = false
            ContactSupport.open(app)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Help")
                .font(FoleviType.display(34))
                .tracking(FoleviType.displayTracking(34))
                .foregroundStyle(FoleviColor.heading)
                .accessibilityAddTraits(.isHeader)
            (Text("The full guide lives at ")
             + Text("[folevi.com/docs](https://folevi.com/docs)").foregroundStyle(FoleviColor.accent).underline()
             + Text(". Questions or problems? Contact support below, or write to support@folevi.com. Security reports: security@folevi.com."))
                .font(.ui(16))
                .foregroundStyle(FoleviColor.inkMuted)
                .tint(FoleviColor.accent)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
    }

    private var support: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Your support requests")
                        .font(FoleviType.display(20))
                        .tracking(FoleviType.displayTracking(20))
                        .foregroundStyle(FoleviColor.heading)
                        .accessibilityAddTraits(.isHeader)
                    Text("A person on the Folevi team reads every request and replies by email. Replies show here too.")
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Button("Contact support") { ContactSupport.open(app) }
                    .buttonStyle(.folevi(.primary, .medium))
            }
            SupportRequestsList()
        }
    }

    private var shortcuts: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Keyboard shortcuts")
                .font(FoleviType.display(20))
                .tracking(FoleviType.displayTracking(20))
                .foregroundStyle(FoleviColor.heading)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(Array(Self.shortcuts.enumerated()), id: \.offset) { i, item in
                    if i > 0 { FoleviColor.line.frame(height: 1) }
                    HStack {
                        Text(item.0).font(.ui(13)).foregroundStyle(FoleviColor.ink)
                        Spacer(minLength: 12)
                        WebKbd(text: item.1)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .combine)
                }
            }
            .foleviCard(radius: 8)
            Text("Type / on an empty line for every block type, [[ to link a page, and @ to mention someone or a date. Markdown shortcuts like “# ”, “- ”, “[] ” and “```” work at the start of a line.")
                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, -4)
        }
    }

    private var statuses: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("What the save status means")
                .font(FoleviType.display(20))
                .tracking(FoleviType.displayTracking(20))
                .foregroundStyle(FoleviColor.heading)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .top), GridItem(.flexible(), spacing: 12, alignment: .top)], spacing: 12) {
                ForEach(Self.statuses, id: \.0) { k, v in
                    VStack(alignment: .leading, spacing: 0) {
                        Text(k).font(.ui(16, .medium)).foregroundStyle(FoleviColor.ink)
                        Text(v).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .foleviCard(radius: 8)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// `ui-kbd`: 20 pt high, 6 pt corners, 10.5 pt semibold muted on raised with a line and a bottom edge.
struct WebKbd: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.ui(10.5, .medium))
            .foregroundStyle(FoleviColor.inkMuted)
            .padding(.horizontal, 5)
            .frame(minWidth: 22, minHeight: 20)
            .background {
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                shape.fill(FoleviColor.lineStrong).offset(y: 1)
                shape.fill(FoleviColor.surfaceRaised)
                shape.strokeBorder(FoleviColor.line)
            }
            .padding(.bottom, 1)
    }
}

/// Contact support. Filing a request is the web's form posting to /api/support, which attaches the account
/// from the browser's session and calls Convex with the server's own secret; the Mac can't do either, so
/// the request is written on Help in the browser, and it shows up here, with our replies, as soon as it's sent.
@MainActor
enum ContactSupport {
    static func open(_ app: AppModel) {
        guard let origin = app.config.appOrigin else {
            NSWorkspace.shared.open(URL(string: "mailto:support@folevi.com") ?? HelpPage.docsURL)
            return
        }
        var comps = URLComponents(url: origin.appending(path: "help"), resolvingAgainstBaseURL: false)
        comps?.fragment = "support"
        NSWorkspace.shared.open(comps?.url ?? origin)
    }
}

/// Help → "Your support requests" (the web's SupportRequests): requests filed from your account, newest
/// first, with our replies and a box to answer. Live: a reply shows up as it arrives.
struct SupportRequestsList: View {
    @Environment(AppModel.self) private var app
    @State private var requests: [SupportRequest]?
    @State private var openNumber: Int?

    var body: some View {
        Group {
            if let requests {
                if requests.isEmpty {
                    HStack(spacing: 12) {
                        Image(systemName: "lifepreserver").font(.system(size: 16)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                        Text("No support requests yet. Requests you send from here, and our replies, will show up in this list.")
                            .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Contact support") { ContactSupport.open(app) }
                            .buttonStyle(.folevi(.secondary, .small))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .foleviCard(radius: 8)
                } else {
                    VStack(spacing: 8) {
                        ForEach(requests) { r in request(r) }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text("Your support requests"))
                }
            } else if !app.sync.isOnline {
                Text("Your requests are shown when you're online.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            } else {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(FoleviColor.surfaceSunken)
                    .frame(height: 64)
                    .accessibilityLabel(Text("Loading…"))
            }
        }
        .task(id: app.sync.isOnline) { await watch() }
    }

    private func request(_ r: SupportRequest) -> some View {
        let expanded = openNumber == r.id
        return VStack(alignment: .leading, spacing: 0) {
            SupportRequestHeader(request: r, expanded: expanded) { openNumber = expanded ? nil : r.id }
            if expanded {
                FoleviColor.line.frame(height: 1)
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(r.messages) { m in
                        VStack(alignment: .leading, spacing: 4) {
                            (Text(m.from == "support" ? String(localized: "Folevi support") : String(localized: "You")).fontWeight(.semibold).foregroundStyle(FoleviColor.heading)
                             + Text(" · \(WebFormat.relative(m.createdAt))").foregroundStyle(FoleviColor.inkMuted))
                                .font(.ui(12))
                                .help(Text(WebFormat.dateTime(m.createdAt)))
                            Text(m.body).font(.ui(13)).foregroundStyle(FoleviColor.ink).textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background {
                            let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
                            if m.from == "support" { shape.fill(FoleviGlass.hover) } else { shape.strokeBorder(FoleviColor.line) }
                        }
                    }
                    SupportReplyBox(number: r.id, closed: r.status == "closed")
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 16)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Messages in request \(r.id)"))
            }
        }
        .foleviCard(radius: 8)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func watch() async {
        guard let session = app.session, app.sync.isOnline else { return }
        do {
            for try await value in session.account.supportRequestUpdates() { requests = value }
        } catch {
            if requests == nil { requests = [] }
        }
    }
}

private struct SupportRequestHeader: View {
    var request: SupportRequest
    var expanded: Bool
    var toggle: () -> Void
    @State private var hovering = false

    var body: some View {
        let r = request
        let replies = r.replyCount
        Button(action: toggle) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("#\(r.id) · \(r.subject)").font(.ui(13, .medium)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                    Text("\(r.topicLabel) · \(replies == 0 ? String(localized: "No reply yet") : replies == 1 ? String(localized: "1 reply") : String(localized: "\(replies) replies")) · \(WebFormat.relative(r.lastMessageAt))")
                        .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                status(r)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(hovering ? FoleviGlass.hover : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityValue(Text(expanded ? String(localized: "Expanded") : String(localized: "Collapsed")))
    }

    @ViewBuilder private func status(_ r: SupportRequest) -> some View {
        let text = Text(r.statusLabel).font(.ui(11.5, .semibold)).padding(.horizontal, 8).frame(height: 20)
        switch r.status {
        case "pending":
            text.foregroundStyle(FoleviColor.canvas).background(FoleviColor.heading, in: Capsule())
        case "closed":
            text.foregroundStyle(FoleviColor.inkMuted).overlay(Capsule().strokeBorder(FoleviColor.lineStrong))
        default:
            text.foregroundStyle(FoleviColor.inkMuted).background(FoleviGlass.hover, in: Capsule())
        }
    }
}

/// The reply box under a request: "Reply" (or "Reply (this reopens the request)" when closed), a 3-line
/// text area, the error, and Send reply.
private struct SupportReplyBox: View {
    var number: Int
    var closed: Bool
    @Environment(AppModel.self) private var app
    @State private var text = ""
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(closed ? "Reply (this reopens the request)" : "Reply").font(.ui(12.5, .medium)).foregroundStyle(FoleviColor.heading)
            TextEditor(text: $text)
                .font(.ui(13))
                .foregroundStyle(FoleviColor.ink)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(minHeight: 72)
                .background {
                    let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                    shape.fill(FoleviColor.surface)
                        .overlay(shape.strokeBorder(error != nil ? FoleviColor.destructive : focused ? FoleviColor.heading.opacity(0.165) : FoleviColor.line,
                                                    lineWidth: error != nil || focused ? 1.5 : 1))
                }
                .onChange(of: text) { _, v in
                    error = nil
                    if v.count > 5200 { text = String(v.prefix(5200)) }
                }
                .accessibilityLabel(Text(closed ? "Reply (this reopens the request)" : "Reply"))
            if let error { Text(error).font(.ui(12.5)).foregroundStyle(FoleviColor.destructive) }
            HStack {
                Spacer()
                Button(busy ? String(localized: "Sending…") : String(localized: "Send reply")) { send() }
                    .buttonStyle(.folevi(.primary, .small))
                    .disabled(busy)
            }
            .padding(.top, 4)
        }
        .padding(.top, 0)
    }

    private func send() {
        guard let session = app.session, !busy else { return }
        let message = text
        guard message.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else {
            error = String(localized: "Write a reply first.")
            return
        }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await session.account.replyToSupportRequest(number: number, message: message)
                text = ""
                app.showToast(String(localized: "Reply added to request #\(number)"))
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}
