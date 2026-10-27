// Help (apps/web/src/components/views/HelpView.tsx as Folevi for Mac shows it), drawn from the live app's
// computed styles ("more.help.*", packages/design-tokens/match/app-styles/more.json): the guide's address,
// support (an email in local mode; requests and Contact support with an account), the keyboard shortcuts table
// and what the save status means.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine

/// A computed style of the web app by id, in this scheme.
@MainActor
func moreStyle(_ id: String, _ scheme: ColorScheme) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

/// A CSS colour variable of the web app (`--color-line`), in this scheme.
@MainActor
func moreVar(_ name: String, _ scheme: ColorScheme) -> Color {
    (WebStyles.vars[name] ?? FoleviTokens.Chrome.surfaceSunken).resolve(scheme).color
}

struct HelpScreen: View {
    let model: FrameModel
    @Environment(\.colorScheme) private var scheme

    static let shortcuts: [(String, String)] = [
        ("Search or jump anywhere", "⌘ K"),
        ("New document", "⌘ ⌥ N"),
        ("Quick add task", "⌘ ⇧ A"),
        ("Toggle sidebar", "⌘ \\"),
        ("Toggle inspector", "⌘ ⌥ I"),
        ("Tasks · Today", "⌘ ⌥ T"),
        ("Bold / italic / underline", "⌘ B / ⌘ I / ⌘ U"),
        ("Strikethrough / inline code", "⌘ ⇧ X / ⌘ E"),
        ("Highlight", "⌘ ⇧ H"),
        ("Text / Heading 1–3", "⌘ ⌥ 0 / ⌘ ⌥ 1–3"),
        ("Numbered / bulleted / to-do", "⌘ ⇧ 7 / 8 / 9"),
        ("Nest / un-nest block", "Tab / ⇧ Tab"),
        ("Move block up / down", "⌥ ⇧ ↑ / ↓"),
        ("Duplicate block", "⌘ D"),
        ("Block options", "⌘ ."),
        ("Toggle to-do or toggle block", "⌘ Enter"),
        ("Task details (due date, reminder…)", "⌘ ⇧ D"),
        ("Soft line break", "⇧ Enter"),
        ("Undo / redo", "⌘ Z / ⌘ ⇧ Z"),
    ]

    static let statuses: [(String, String)] = [
        ("Saved", "Every change has been confirmed by the server."),
        ("Saving…", "Your latest changes are on their way."),
        ("Syncing…", "Waiting for the server to confirm."),
        ("Offline", "Keep writing. Changes are stored on this device and sync when you reconnect."),
        ("Conflict", "The same block changed in two places. Both versions are kept until you choose."),
        ("Not saved", "The server rejected a change, or you need to sign in again. Open the status for details."),
    ]

    static let localStatuses: [(String, String)] = [
        ("Saved", "Every change is saved on this device. Your library's folder gets it a few seconds later."),
        ("Saving…", "Your latest changes are being saved on this device."),
        ("Syncing…", "Folevi is reading your library's folder and writing what it lacks."),
        ("Changed on another device", "The same block changed on two devices at once. The newer change shows, and the other is kept in version history, with a note on the block."),
        ("Not saved", "This device couldn't save a change. Open the status for details."),
    ]

    private var account: Bool { model.session.value?.mode != .local }
    private func s(_ id: String) -> WebComputedStyle { moreStyle("more.help.\(id)", scheme) }

    var body: some View {
        let column = s("title")
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: s("support").margin.bottom) {
                header
                support
                shortcuts
                statuses
            }
            .padding(column.padding.edgeInsets)
            .frame(width: column.width, alignment: .topLeading)
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("screen.help")
    }

    private var header: some View {
        let h2 = s("h2"), intro = s("intro"), link = s("link")
        let text = Text(verbatim: "The full guide lives at ")
            + Text(verbatim: "folevi.com/docs").foregroundColor(link.color.color).underline()
            + Text(verbatim: ". Questions or problems? Contact support below, or write to support@folevi.com. Security reports: security@folevi.com.")
        return VStack(alignment: .leading, spacing: 0) {
            Text("Help").webText(h2.text).lineLimit(1).foregroundStyle(h2.color.color)
            text.webText(intro.text).foregroundStyle(intro.color.color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .onTapGesture { open("https://folevi.com/docs") }
        }
    }

    private var support: some View {
        let h3 = s("h3"), p = s("support.text"), button = WebStyles.named("more.help.support.button")
        let b = button.resolve(scheme)
        return VStack(alignment: .leading, spacing: 0) {
            Text(account ? "Your support requests" : "Support").webText(h3.text).lineLimit(1).foregroundStyle(h3.color.color)
            Text(account ? "A person on the Folevi team reads every request and replies by email. Replies show here too." : "A person on the Folevi team reads every email and replies.")
                .webText(p.text).foregroundStyle(p.color.color)
                .padding(.top, p.margin.top)
            Button { open("mailto:support@folevi.com") } label: {
                Text(account ? "Contact support" : "Email support").webText(b.text).lineLimit(1).fixedSize()
                    .webElement(button)
            }
            .buttonStyle(.plain)
            .padding(.top, b.margin.top)
        }
    }

    private var shortcuts: some View {
        let h3 = s("shortcuts.h3"), table = WebStyles.named("more.help.table"), row = s("row"), th = s("th"), td = s("td"), foot = s("footnote")
        let pitch = (s("row.last").y - row.y) / CGFloat(Self.shortcuts.count - 1)
        let hairline = max(0, pitch - row.height)
        return VStack(alignment: .leading, spacing: 0) {
            Text("Keyboard shortcuts").webText(h3.text).lineLimit(1).foregroundStyle(h3.color.color)
                .padding(.bottom, h3.margin.bottom)
            VStack(spacing: 0) {
                ForEach(Array(Self.shortcuts.enumerated()), id: \.offset) { i, item in
                    HStack(spacing: 0) {
                        Text(item.0).webText(th.text).lineLimit(1).foregroundStyle(th.color.color)
                            .padding(.leading, th.padding.left)
                        Spacer(minLength: 0)
                        HelpKbd(keys: item.1).padding(.trailing, td.padding.right)
                    }
                    .frame(height: row.height)
                    if i < Self.shortcuts.count - 1 {
                        Rectangle().fill(moreVar("color-line", scheme)).frame(height: hairline)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: table.light.radius, style: .circular))
            .webBox(table)
            Text(verbatim: "Type / on an empty line for every block type, [[ to link a page, and @ to mention someone or a date. Markdown shortcuts like “# ”, “- ”, “[] ” and “```” work at the start of a line.")
                .webText(foot.text).foregroundStyle(foot.color.color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, foot.margin.top)
        }
    }

    private var statuses: some View {
        let h3 = s("sync.h3"), grid = s("grid")
        let items = account ? Self.statuses : Self.localStatuses
        let pairs = stride(from: 0, to: items.count, by: 2).map { Array(items[$0..<min($0 + 2, items.count)]) }
        return VStack(alignment: .leading, spacing: 0) {
            Text("What the save status means").webText(h3.text).lineLimit(1).foregroundStyle(h3.color.color)
                .padding(.bottom, h3.margin.bottom)
            VStack(spacing: grid.gap) {
                ForEach(Array(pairs.enumerated()), id: \.offset) { _, pair in
                    HStack(alignment: .top, spacing: grid.gap) {
                        ForEach(pair, id: \.0) { card($0.0, $0.1) }
                        if pair.count == 1 { Color.clear.frame(maxWidth: .infinity) }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func card(_ title: String, _ text: String) -> some View {
        let style = WebStyles.named("more.help.card"), c = style.resolve(scheme), dt = s("dt"), dd = s("dd")
        return VStack(alignment: .leading, spacing: 0) {
            Text(title).webText(dt.text).lineLimit(1).foregroundStyle(dt.color.color)
            Text(text).webText(dd.text).foregroundStyle(dd.color.color).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(c.padding.edgeInsets)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .webBox(style)
    }

    private func open(_ s: String) {
        if let url = URL(string: s) { model.host?.frameOpenExternal(url) }
    }
}

/// The help table's key cap (`<Kbd>` in a table cell).
struct HelpKbd: View {
    let keys: String
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let style = WebStyles.named("more.help.kbd")
        let k = style.resolve(scheme)
        Text(keys).webText(k.text).lineLimit(1).fixedSize().webElement(style)
    }
}
#endif
