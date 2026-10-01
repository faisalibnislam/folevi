import SwiftUI

/// Help → "Your support requests" (the web's SupportRequests): requests filed from your account, with our
/// replies and a box to answer. Filing a new one happens on the web (Contact support).
struct SupportRequestsSection: View {
    @Environment(AppModel.self) private var app
    @State private var requests: [SupportRequest]?
    @State private var openNumber: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your support requests").font(FoleviType.display(18)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
                    Text("A person on the Folevi team reads every request and replies by email. Replies show here too.")
                        .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Button("Contact support") { openWebApp("help", config: app.config) }
                    .buttonStyle(.folevi(.primary, .small))
                    .help(Text("Opens Help on the web"))
            }
            if !app.sync.isOnline && requests == nil {
                Text("Your requests are shown when you're online.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            } else if let requests {
                if requests.isEmpty {
                    HStack(spacing: 10) {
                        Image(systemName: "lifepreserver").foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                        Text("No support requests yet. Requests you send from here, and our replies, will show up in this list.")
                            .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foleviCard(radius: 8)
                } else {
                    VStack(spacing: 8) {
                        ForEach(requests) { r in request(r) }
                    }
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task { await watch() }
    }

    private func request(_ r: SupportRequest) -> some View {
        let expanded = openNumber == r.id
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                openNumber = expanded ? nil : r.id
            } label: {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("#\(r.id) · \(r.subject)").font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                        Text("\(r.topicLabel) · \(replies(r.replyCount)) · \(Date(timeIntervalSince1970: r.lastMessageAt / 1000).formatted(.relative(presentation: .named)))")
                            .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Text(r.statusLabel)
                        .font(.ui(11.5, .semibold))
                        .foregroundStyle(r.status == "pending" ? FoleviColor.canvas : FoleviColor.inkMuted)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(r.status == "pending" ? FoleviColor.heading : FoleviGlass.hover))
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(FoleviColor.inkMuted)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(Text(expanded ? "Expanded" : "Collapsed"))
            if expanded {
                FoleviColor.line.frame(height: 1)
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(r.messages) { m in
                        VStack(alignment: .leading, spacing: 4) {
                            (Text(m.from == "support" ? String(localized: "Folevi support") : String(localized: "You")).fontWeight(.semibold).foregroundStyle(FoleviColor.heading)
                             + Text(" · \(Date(timeIntervalSince1970: m.createdAt / 1000).formatted(.relative(presentation: .named)))").foregroundStyle(FoleviColor.inkMuted))
                                .font(.ui(12))
                            Text(m.body).font(.ui(13)).foregroundStyle(FoleviColor.ink).textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background {
                            if m.from == "support" {
                                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(FoleviGlass.hover)
                            } else {
                                RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.line)
                            }
                        }
                    }
                    SupportReplyBox(number: r.id, closed: r.status == "closed")
                }
                .padding(14)
            }
        }
        .foleviCard(radius: 8)
    }

    private func replies(_ n: Int) -> String {
        n == 0 ? String(localized: "No reply yet") : n == 1 ? String(localized: "1 reply") : String(localized: "\(n) replies")
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

private struct SupportReplyBox: View {
    var number: Int
    var closed: Bool
    @Environment(AppModel.self) private var app
    @State private var text = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(closed ? "Reply (this reopens the request)" : "Reply").font(.ui(12.5, .medium)).foregroundStyle(FoleviColor.heading)
            TextEditor(text: $text)
                .font(.ui(13))
                .scrollContentBackground(.hidden)
                .padding(6)
                .frame(height: 70)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surface))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.line))
                .onChange(of: text) { _, _ in error = nil }
                .accessibilityLabel(Text("Reply"))
            if let error { Text(error).font(.ui(12.5)).foregroundStyle(FoleviColor.destructive) }
            HStack {
                Spacer()
                Button(busy ? String(localized: "Sending…") : String(localized: "Send reply")) { send() }
                    .buttonStyle(.folevi(.primary, .small))
                    .disabled(busy)
            }
        }
    }

    private func send() {
        guard let session = app.session, !busy else { return }
        let message = text
        guard message.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else {
            error = String(localized: "Write a reply first.")
            return
        }
        busy = true
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
