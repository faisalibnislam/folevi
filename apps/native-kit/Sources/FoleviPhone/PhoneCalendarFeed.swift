// The Calendar's Subscribe on the iPhone (web CalendarFeedDialog.tsx, the Mac's CalendarFeedDialog): "Your tasks
// in your calendar", a private iCalendar link of your tasks with a due date for Google Calendar, Apple Calendar or
// Outlook. The link is shown once, when it's made; making a new one ends the old one. On the iPhone a new link also
// goes into Apple Calendar (iOS's own subscribe screen, by its webcal:// address) or Google Calendar (its add by
// URL page) in one tap; Outlook keeps the written steps.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

public struct PhoneCalendarFeedSheet: View {
    let client: EngineClient
    let feedback: ScreenFeedback
    let close: () -> Void
    @State private var feed: CalendarFeedValue?
    @State private var link: String?
    @State private var include = true
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL

    public init(client: EngineClient, feedback: ScreenFeedback, close: @escaping () -> Void) {
        self.client = client
        self.feedback = feedback
        self.close = close
    }

    private func c(_ pair: ColorPair) -> Color { pair.resolve(scheme).color }

    public var body: some View {
        PhoneSheetPanel(title: "Your tasks in your calendar", description: "Subscribe to this link in Google Calendar, Apple Calendar or Outlook to see tasks with a due date there. It's read-only and updates about every hour.", close: close) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Workspace tasks assigned to you").webText(.role(.body)).foregroundStyle(c(FoleviTokens.Chrome.ink))
                        Text("Your Personal tasks are always in it.").webText(.role(.footnote)).foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    FoleviSwitch("Workspace tasks assigned to you", on: feed?.active == true ? feed!.includeWorkspaces : include) { on in
                        if feed?.active == true {
                            Task {
                                _ = try? await client.command(.calendarFeedWorkspaces(includeWorkspaces: on))
                                await load()
                            }
                        } else { include = on }
                    }
                }
                if let link {
                    made(link)
                } else if let f = feed, f.active {
                    Text("You have a link\(f.lastFetchedAt.map { ", last read by a calendar \(AgeText.relative(Date(timeIntervalSince1970: $0 / 1000)))" } ?? ", not used by a calendar yet"). Make a new one if you lost it; the old one stops working.")
                        .webText(.role(.subheadline))
                        .foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: 10) {
                    WebButton(feed?.active == true ? "Make a new link" : "Make a link", variant: .primary) { make() }
                        .frame(maxWidth: .infinity)
                        .disabled(busy)
                    if feed?.active == true {
                        WebButton("Turn off the link", variant: .danger) { turnOff() }
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .task { await load() }
    }

    /// A link just made: copy it, or put it straight into Apple's or Google's calendar.
    private func made(_ link: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Copy this link now. For your privacy, it isn’t shown again.").webText(.role(.footnote, weight: 500)).foregroundStyle(c(FoleviTokens.Chrome.ink))
            HStack(spacing: 8) {
                Text(link)
                    .font(.system(size: 13, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .foregroundStyle(c(FoleviTokens.Chrome.ink))
                    .padding(.horizontal, 10)
                    .frame(height: 36)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(c(FoleviTokens.Chrome.ink).opacity(0.06)))
                WebButton("Copy", icon: .copy) {
                    feedback.copy(link)
                    feedback.toast(ScreenToast("Link copied", tone: .success))
                }
            }
            HStack(spacing: 8) {
                WebButton("Add to Apple Calendar", icon: .calendarPlus) {
                    if let url = Self.appleURL(link) { openURL(url) }
                }
                .frame(maxWidth: .infinity)
                WebButton("Add to Google", icon: .externalLink) {
                    if let url = Self.googleURL(link) { openURL(url) }
                }
                .frame(maxWidth: .infinity)
            }
            Text("Outlook: Add calendar, Subscribe from web, then paste the link.")
                .webText(.role(.footnote))
                .foregroundStyle(c(FoleviTokens.Chrome.inkMuted))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).fill(c(FoleviTokens.Chrome.moss).opacity(0.12)))
    }

    /// iOS's own subscribe screen: the link as a webcal:// address.
    static func appleURL(_ link: String) -> URL? {
        guard var parts = URLComponents(string: link) else { return nil }
        parts.scheme = "webcal"
        return parts.url
    }

    /// Google Calendar's add-by-URL page, the link in `cid` as a webcal:// address.
    static func googleURL(_ link: String) -> URL? {
        guard let webcal = appleURL(link)?.absoluteString else { return nil }
        var parts = URLComponents(string: "https://calendar.google.com/calendar/r")
        parts?.queryItems = [URLQueryItem(name: "cid", value: webcal)]
        return parts?.url
    }

    private func load() async {
        feed = try? await client.query(.calendarFeed)
    }

    private func make() {
        guard !busy else { return }
        busy = true
        Task {
            do {
                let r = try await client.command(.calendarFeedCreate(includeWorkspaces: include))
                link = r.url
                feedback.haptic(.success)
                await load()
            } catch { feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error)) }
            busy = false
        }
    }

    private func turnOff() {
        Task {
            _ = try? await client.command(.calendarFeedRevoke)
            link = nil
            feedback.toast(ScreenToast("Calendar link turned off", tone: .success))
            await load()
        }
    }
}
#endif
