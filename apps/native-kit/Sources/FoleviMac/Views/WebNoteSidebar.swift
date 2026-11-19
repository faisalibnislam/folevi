// The note page's own tools. On the Mac they're the sidebar's on a note, as the web's (WebSidebar+Mac.swift: its
// sections in a capsule track, the system font; the title bar's switch brings the folders back); on the iPad the
// note's own sidebar, drawn as the web's (apps/web/src/components/doc/DocumentSidebar.tsx and
// Outline.tsx, as Folevi for Mac shows them), from the live app's computed styles (FoleviDesign WebStyles
// "notetools.*", packages/design-tokens/match/app-styles/notetools.json):
//
//   under the sidebar's top bar and search (WebSidebar keeps them), a card with the note's title and where it
//   lives ("In Travel > Japan"), the note's pages when it has nested ones, five tool tabs (Table of contents,
//   Comments, Tasks in this page, Attachments and links, Find in page) and the chosen panel.
//
// What it shows comes from the note page (`note.tools`, bridge revision 14); its clicks go back as editor
// commands (block.jump, task.toggle, thread.open, find, find.clear, scrollToTop).
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import WebKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The tool tabs, in the web's order (`folevi:doc-sidebar-tab` there, `folevi.noteSidebar.tab` here).
enum NoteToolTab: String, CaseIterable, Identifiable {
    case contents, comments, tasks, attachments, find
    var id: String { rawValue }

    var label: String {
        switch self {
        case .contents: "Table of contents"
        case .comments: "Comments"
        case .tasks: "Tasks in this page"
        case .attachments: "Attachments and links"
        case .find: "Find in page"
        }
    }

    var icon: WebIcon {
        switch self {
        case .contents: .list
        case .comments: .messageSquare
        case .tasks: .circleCheck
        case .attachments: .paperclip
        case .find: .search
        }
    }

    /// The Mac's SF Symbol for the tab.
    var symbol: String {
        switch self {
        case .contents: "list.bullet.indent"
        case .comments: "bubble.left"
        case .tasks: "checkmark.circle"
        case .attachments: "paperclip"
        case .find: "magnifyingglass"
        }
    }
}

/// What the Find tab found (the bridge's `find` reply), and which match is shown.
@MainActor
@Observable
final class NoteFindModel {
    var query = ""
    private(set) var result: FindResult?
    private var run = 0

    /// Finds `query` again (typing, or the note changed); `index` shows that match (nil: none scrolled to).
    func search(_ model: FrameModel, index: Int? = nil) {
        run += 1
        let mine = run
        let q = query
        guard !q.trimmingCharacters(in: .whitespaces).isEmpty else {
            result = nil
            Task { _ = try? await model.client.editor(.findClear) }
            return
        }
        Task {
            let r = try? await model.client.editor(.find(query: q, index: index))
            guard mine == self.run else { return }
            self.result = r
        }
    }

    func step(_ model: FrameModel, by delta: Int) {
        guard let r = result, r.count > 0 else { return }
        search(model, index: r.current + delta)
    }

    func clear(_ model: FrameModel) {
        query = ""
        search(model)
    }
}

@MainActor
struct WebNoteSidebar: View {
    @Bindable var model: FrameModel
    let noteId: String
    @AppStorage("folevi.noteSidebar.tab") private var tabRaw = NoteToolTab.contents.rawValue
    @State private var find = NoteFindModel()
    /// The Find field has the keyboard (its well shows the focus ring).
    @State private var findFocused = false
    @Environment(\.colorScheme) private var scheme
    /// The native look (the Mac's, and the iPad's wide layout's).
    @Environment(\.macNativeLook) private var native

    private var tab: NoteToolTab { NoteToolTab(rawValue: tabRaw) ?? .contents }
    private var tools: NoteToolsEvent? { model.noteTools[noteId] }

    private func style(_ id: String) -> WebComputedStyle { WebStyles.named("notetools.\(id)").resolve(scheme) }
    private func pair(_ id: String) -> WebStylePair { WebStyles.named("notetools.\(id)") }
    /// A CSS colour variable of the web app, in this appearance.
    private func v(_ name: String, _ fallback: Color = .clear) -> Color {
        // The native look: the system's semantic colours for the web's palette.
        if native, let c = NoteToolsLook.color(name) { return c }
        return WebStyles.vars[name]?.resolve(scheme).color ?? fallback
    }
    /// An unchecked task's outline, as the web draws it (muted ink mixed into the strong line; QA audit F10).
    private var checkboxEdge: Color {
        guard let muted = WebStyles.vars["color-ink-muted"]?.resolve(scheme), let line = WebStyles.vars["color-line-strong"]?.resolve(scheme) else { return Folevi.color.checkboxEdge }
        return muted.mix(line, 0.75).color
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            card
            if let pages = tools?.pages, !pages.isEmpty { pageTree(pages) }
            tabs
            // (The tabs stay put; the panel scrolls under them.)
            ScrollView(.vertical) {
                panel
                    .padding(panelPadding)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollIndicators(.never)
            .frame(maxHeight: .infinity)
        }
        .onChange(of: tools?.outline.map(\.id)) { _, _ in refind() }
        .onChange(of: tools?.tasks.map(\.text)) { _, _ in refind() }
    }

    private var panelPadding: EdgeInsets {
        native ? EdgeInsets(top: MacLook.Space.s, leading: MacLook.Space.m, bottom: MacLook.Space.l, trailing: MacLook.Space.m) : style("panel").padding.edgeInsets
    }

    private func refind() {
        if tab == .find, !find.query.isEmpty { find.search(model, index: find.result.map { max(0, $0.current) }) }
    }

    // MARK: the note's card

    private var noteName: String {
        (tools?.title).flatMap { $0.isEmpty ? nil : $0 } ?? model.activeNote.map { $0.title.isEmpty ? "Untitled" : $0.title } ?? "Untitled"
    }

    @ViewBuilder private var card: some View {
        if native { nativeCard } else { webCard }
    }

    /// The inspector's heading in the native look: the note's name and where it lives.
    private var nativeCard: some View {
        let name = noteName
        return VStack(alignment: .leading, spacing: 2) {
            MacTruncatingText(text: name, font: MacLook.Text.headline)
                .foregroundStyle(MacLook.Colors.label)
                .frame(maxWidth: .infinity, alignment: .leading)
            crumbs
        }
        .padding(.horizontal, MacLook.Space.l)
        .padding(.top, MacLook.Space.m)
        .padding(.bottom, MacLook.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var webCard: some View {
        let wrap = style("card.wrap")
        let c = pair("card")
        let title = style("card.title")
        let name = noteName
        return VStack(alignment: .leading, spacing: 0) {
            // The whole name in a tooltip only when it's cut off.
            TruncatingLabel(text: name, style: title.text).foregroundStyle(title.color.color)
                .frame(maxWidth: .infinity, alignment: .leading)
            crumbs.padding(.top, style("crumbs").y - title.y - title.height)
        }
        .padding(c.resolve(scheme).padding.edgeInsets)
        .frame(maxWidth: .infinity, alignment: .leading)
        .webBox(c)
        .padding(wrap.padding.edgeInsets)
    }

    private var trail: [NoteToolsCrumb] { Self.trail(tools: tools?.trail, meta: model.activeNote) }

    /// Where the note lives, for the card's "In ..." line. The note page's trail once it has said (empty while
    /// it doesn't know yet, e.g. a note just made in a folder before its name is here); before the page has said,
    /// its folder from note.meta, or Drafts only once note.meta has found the note. Never a guess: a note made in
    /// a folder must not flash "In Drafts" (QA audit F13).
    static func trail(tools: [NoteToolsCrumb]?, meta: NoteMeta?) -> [NoteToolsCrumb] {
        if let t = tools { return t }
        guard let meta, meta.found else { return [] }
        if let f = meta.folder { return [NoteToolsCrumb(href: "/folders/\(f.id)", label: f.name)] }
        return [NoteToolsCrumb(href: "/drafts", label: "Drafts")]
    }

    private var crumbs: some View {
        let row = style("crumbs")
        let inStyle = style("crumb.in")
        let link = style("crumb.link")
        let chevron = style("crumb.chevron")
        return HStack(spacing: row.gap) {
            ForEach(Array(trail.enumerated()), id: \.offset) { i, c in
                HStack(spacing: 2) {
                    if i == 0 {
                        Text("In").toolText(inStyle.text).lineLimit(1).foregroundStyle(inStyle.color.color)
                    } else {
                        WebIconView(.chevronRight, size: 11).frame(width: 11, height: 11).foregroundStyle(chevron.color.color)
                    }
                    Button { model.open(FrameRoute(path: c.href), .replace) } label: {
                        Text(c.label).toolText(link.text).lineLimit(1).truncationMode(.tail)
                            .padding(link.padding.edgeInsets)
                            .frame(maxWidth: 152, minHeight: link.height, alignment: .leading)
                            .fixedSize()
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(CrumbStyle(radius: link.radius, color: link.color.color, hoverFill: v("color-accent-soft"), hoverColor: v("color-heading")))
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: link.height, alignment: .leading)
        .clipped()
    }

    // MARK: pages in this note

    private func pageTree(_ pages: [NoteToolsPage]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("PAGES").toolText(.caps).lineLimit(1).foregroundStyle(v("color-ink-faint", Folevi.color.inkFaint))
                .padding(.horizontal, 4).padding(.bottom, 4)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(pages, id: \.id) { p in
                        let here = p.id == noteId
                        Button { if !here { model.open(.note(p.id), .replace) } } label: {
                            HStack(spacing: 6) {
                                WebIconView(.fileText, size: 13).frame(width: 13, height: 13).opacity(0.6)
                                Text(p.title).toolText(WebTextStyle.role(.subheadline, weight: here ? 600 : 400)).lineLimit(1)
                            }
                            .foregroundStyle(here ? v("color-heading") : v("color-ink").opacity(0.9))
                            .padding(.leading, 8 + CGFloat(p.depth) * 13.6)
                            .padding(.trailing, 8)
                            .frame(maxWidth: .infinity, minHeight: 28, maxHeight: 28, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(here ? v("glass-active") : .clear))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(WebHoverRowStyle(radius: 6, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: here))
                    }
                    if tools?.pagesTruncated == true {
                        Text("More pages than fit here. Open a page to see its own.").toolText(.role(.footnote)).foregroundStyle(v("color-ink-muted"))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                    }
                }
            }
            .scrollIndicators(.never)
            .frame(maxHeight: 260)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 12)
    }

    // MARK: the tabs

    @ViewBuilder private var tabs: some View {
        if native { nativeTabs } else { webTabs }
    }

    /// The sections in a capsule track at the panel's top (the owner's inspector profile).
    private var nativeTabs: some View {
        let unread = tools?.comments.threads.contains { $0.unread && $0.status == .open } ?? false
        return CapsuleTrack(NoteToolTab.allCases, selection: Binding(get: { tab }, set: { choose($0) })) { t, _ in
            ZStack(alignment: .topTrailing) {
                MacSymbol(t.symbol, size: 13)
                if t == .comments, unread {
                    Circle().fill(MacLook.Colors.red).frame(width: 6, height: 6).offset(x: 4, y: -2)
                }
            }
            .foleviTooltip(t.label)
            .accessibilityLabel(t == .comments && unread ? "Comments (unread)" : t.label)
        }
        .padding(.horizontal, MacLook.Space.m)
        .padding(.bottom, MacLook.Space.xs)
    }

    private var webTabs: some View {
        let wrap = style("tabs.wrap")
        let bar = pair("tabs")
        let b = bar.resolve(scheme)
        let unread = tools?.comments.threads.contains { $0.unread && $0.status == .open } ?? false
        return HStack(spacing: b.gap) {
            ForEach(NoteToolTab.allCases) { t in
                let on = t == tab
                let s = pair(on ? "tab.active" : "tab")
                let icon = style(on ? "tab.active.icon" : "tab.icon")
                Button { choose(t) } label: {
                    ZStack(alignment: .topTrailing) {
                        WebIconView(t.icon, size: 15).frame(width: 15, height: 15)
                        if t == .comments, unread {
                            Circle().fill(v("color-coral", Folevi.color.coral)).frame(width: 6, height: 6).offset(x: 4, y: -2)
                        }
                    }
                    .foregroundStyle(icon.color.color)
                    .frame(maxWidth: .infinity, minHeight: s.resolve(scheme).height, maxHeight: s.resolve(scheme).height)
                    .webBox(s)
                    .contentShape(Rectangle())
                }
                .buttonStyle(TabHoverStyle(on: on, hover: v("color-heading")))
                .foleviTooltip(t.label)
                .accessibilityLabel(t == .comments && unread ? "Comments (unread)" : t.label)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(b.padding.edgeInsets)
        .webBox(bar)
        .padding(wrap.padding.edgeInsets)
    }

    private func choose(_ t: NoteToolTab) {
        if tab == .find, t != .find, !find.query.isEmpty { find.clear(model) }
        tabRaw = t.rawValue
    }

    // MARK: panels

    @ViewBuilder private var panel: some View {
        switch tab {
        case .contents: contents
        case .comments: comments
        case .tasks: tasks
        case .attachments: attachments
        case .find: findPanel
        }
    }

    private func panelTitle(_ text: String, aside: String? = nil, idStyle: String = "panel.title") -> some View {
        let row = style("panel.title.row")
        let t = style(idStyle)
        return HStack {
            Text(text).toolText(t.text).lineLimit(1).foregroundStyle(t.color.color)
            Spacer(minLength: 0)
            if let aside {
                Text(aside).toolText(.role(.footnote)).lineLimit(1).monospacedDigit().foregroundStyle(v("color-ink-muted"))
            }
        }
        .padding(row.padding.edgeInsets)
        .frame(height: row.height)
        .padding(.bottom, row.margin.bottom)
    }

    private func emptyText(_ text: String, _ id: String, centered: Bool = false) -> some View {
        let s = style(id)
        let room = s.width - s.padding.left - s.padding.right
        return Text(Self.shownText(text, s.text, room, native: native)).toolText(s.text).foregroundStyle(s.color.color)
            .multilineTextAlignment(centered ? .center : .leading)
            .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
            .padding(s.padding.edgeInsets)
            .padding(.bottom, s.margin.bottom)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// A short paragraph as shown: broken as the web breaks it on the iPad (`pretty`); the Mac's system text wraps
    /// as the system does.
    static func shownText(_ text: String, _ style: WebTextStyle, _ room: CGFloat, native: Bool) -> String {
        native ? text : pretty(text, style, room)
    }

    /// `text` with its lines broken as WebKit breaks a short paragraph (`text-wrap: pretty` and `balance`): as many
    /// lines as fit in `room`, the breaks chosen so the lines are as even as they can be.
    static func pretty(_ text: String, _ style: WebTextStyle, _ room: CGFloat) -> String {
        let words = text.split(separator: " ").map(String.init)
        guard words.count > 2 else { return text }
        let attrs: [NSAttributedString.Key: Any] = [.font: style.ctFont as NSFont, .kern: style.letterSpacing]
        let width = { (s: String) -> CGFloat in CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs)), nil, nil, nil)) }
        let n = words.count
        // w[i][j]: the line of words i..<j.
        var w = Array(repeating: Array(repeating: CGFloat.infinity, count: n + 1), count: n)
        for i in 0..<n { for j in (i + 1)...n { w[i][j] = width(words[i..<j].joined(separator: " ")) } }
        // The greedy line count at this width (what a plain wrap gives).
        var lines = 0, at = 0
        while at < n {
            var j = at + 1
            while j < n, w[at][j + 1] <= room { j += 1 }
            lines += 1
            at = j
        }
        guard lines > 1, lines <= n else { return text }
        let avg = w[0][n] / CGFloat(lines)
        // best[k][j]: the least unevenness of words 0..<j in k lines; from[k][j]: where its last line starts.
        var best = Array(repeating: Array(repeating: CGFloat.infinity, count: n + 1), count: lines + 1)
        var from = Array(repeating: Array(repeating: 0, count: n + 1), count: lines + 1)
        best[0][0] = 0
        for k in 1...lines {
            for j in k...n {
                for i in (k - 1)..<j where best[k - 1][i] < .infinity && w[i][j] <= room {
                    // The last line may run long but not short (WebKit avoids a short last line).
                    let last = k == lines && j == n
                    let d = last ? max(0, avg - w[i][j]) * 2 : w[i][j] - avg
                    let c = best[k - 1][i] + d * d
                    if c < best[k][j] { best[k][j] = c; from[k][j] = i }
                }
            }
        }
        guard best[lines][n] < .infinity else { return text }
        var out: [String] = []
        var j = n
        for k in stride(from: lines, to: 0, by: -1) {
            let i = from[k][j]
            out.insert(words[i..<j].joined(separator: " "), at: 0)
            j = i
        }
        return out.joined(separator: "\n")
    }

    private var rowHover: ColorPair? { WebStyles.vars["color-accent-soft"] }

    // Table of contents

    private var contents: some View {
        let top = pair("contents.top")
        let t = top.resolve(scheme)
        let name = (tools?.title).flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled"
        let items = tools?.outline ?? []
        return VStack(alignment: .leading, spacing: 0) {
            panelTitle("Table of contents")
            Button { model.editor(.scrollToTop) } label: {
                Text(name).toolText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    .padding(t.padding.edgeInsets)
                    .frame(maxWidth: .infinity, minHeight: t.height, maxHeight: t.height, alignment: .leading)
                    .modifier(NoteToolsBox(style: top))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.webHover(radius: t.radius))
            .padding(.bottom, t.margin.bottom)
            if items.isEmpty {
                emptyText("Add headings or nested pages and they’ll appear here.", "contents.empty", centered: true)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(items, id: \.id) { outlineRow($0) }
                }
            }
        }
    }

    private func outlineRow(_ item: NoteOutlineItem) -> some View {
        let sub = WebTextStyle.role(.subheadline)
        if item.kind == .page {
            return AnyView(Button { if let d = item.documentId { model.open(.note(d), .replace) } } label: {
                Text("↳ \(item.text)").toolText(sub).lineLimit(1).foregroundStyle(v("color-ink-muted"))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(WebHoverRowStyle(radius: 6, hover: rowHover, press: rowHover, selected: false)))
        }
        let on = tools?.current == item.id
        let level = item.level
        let color = on ? v("color-heading") : level == 1 ? v("color-ink") : v("color-ink-muted")
        return AnyView(ZStack(alignment: .leading) {
            Button { model.editor(.blockJump(blockId: item.id)) } label: {
                Text(item.text.isEmpty ? "Untitled heading" : item.text)
                    .toolText(level == 1 ? sub.weight(600) : sub).lineLimit(1).foregroundStyle(color)
                    .padding(.leading, level == 1 ? 12 : level == 2 ? 24 : 36).padding(.trailing, 8).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(WebHoverRowStyle(radius: 6, hover: rowHover, press: rowHover, selected: false))
            if on {
                RoundedRectangle(cornerRadius: 1.5, style: .circular).fill(v("color-heading")).frame(width: 3).padding(.vertical, 6)
            }
        })
    }

    // Comments

    @ViewBuilder private var comments: some View {
        VStack(alignment: .leading, spacing: 0) {
            panelTitle("Comments", idStyle: "comments.title")
            if let c = tools?.comments, !c.available {
                signInToCollaborate
            } else if let c = tools?.comments, c.loaded {
                CommentsList(model: model, comments: c, v: v)
            } else {
                Text("Loading comments…").toolText(.role(.subheadline)).foregroundStyle(v("color-ink-muted"))
            }
        }
    }

    static let signInTitle = "Sign in to Folevi to share and collaborate"
    static let signInWhy = "Your notes are kept on your devices. Sharing, comments and workspaces need a Folevi account."

    /// Local mode: what comments need (the web's SignInToCollaborate, "panel").
    private var signInToCollaborate: some View {
        let box = style("comments.empty")
        let icon = style("comments.empty.icon")
        let title = style("comments.empty.title")
        let body = style("comments.empty.body")
        return VStack(spacing: 0) {
            WebIconView(.users, size: 16, strokeWidth: 1.9)
                .frame(width: 16, height: 16)
                .foregroundStyle(icon.color.color)
                .frame(width: icon.width, height: icon.height)
                .background(RoundedRectangle(cornerRadius: icon.radius, style: .circular).fill(icon.background.color))
                .padding(.bottom, icon.margin.bottom)
            Text(Self.shownText(Self.signInTitle, title.text, title.width, native: native)).toolText(title.text).multilineTextAlignment(.center).foregroundStyle(title.color.color)
                .fixedSize(horizontal: false, vertical: true)
            Text(Self.shownText(Self.signInWhy, body.text, body.width, native: native))
                .toolText(body.text).multilineTextAlignment(.center).foregroundStyle(body.color.color)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, body.margin.top)
        }
        .padding(box.padding.edgeInsets)
        .frame(maxWidth: .infinity)
    }

    // Tasks

    private var tasks: some View {
        let list = tools?.tasks ?? []
        let done = list.filter(\.checked).count
        let canEdit = !(tools?.readOnly ?? true)
        return VStack(alignment: .leading, spacing: 0) {
            panelTitle("Tasks", aside: list.isEmpty ? nil : "\(done) of \(list.count) done", idStyle: "tasks.title")
            if list.isEmpty {
                emptyText("Tasks inside this document will appear here. Type “[]” or use Insert → To-do to add one.", "tasks.empty")
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(list, id: \.id) { t in taskRow(t, canEdit: canEdit) }
                }
            }
        }
    }

    private func taskRow(_ t: NoteToolsTask, canEdit: Bool) -> some View {
        let sub = WebTextStyle.role(.subheadline).leading(17.875)
        return HStack(alignment: .top, spacing: 8) {
            Button { if canEdit { model.editor(.taskToggle(blockId: t.id)) } } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 6, style: .circular).fill(t.checked ? v("color-moss", Folevi.color.moss) : v("color-surface", Folevi.color.surface))
                    RoundedRectangle(cornerRadius: 6, style: .circular).strokeBorder(t.checked ? Folevi.color.checkboxCheckedEdge : checkboxEdge, lineWidth: 1)
                    if t.checked {
                        CheckMark().stroke(Color.white, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round)).frame(width: 10, height: 10)
                    }
                }
                .frame(width: 16, height: 16)
                .contentShape(Rectangle())
                .fingerTarget(width: 16, height: 16)
            }
            .buttonStyle(.webHover(radius: 6))
            .disabled(!canEdit)
            .padding(.top, 3)
            .accessibilityLabel("\(t.checked ? "Mark as not done" : "Mark as done"): \(t.text)")
            Button { model.editor(.blockJump(blockId: t.id)) } label: {
                Text(t.text).toolText(sub).strikethrough(t.checked).foregroundStyle(t.checked ? v("color-ink-muted") : v("color-ink"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentShape(Rectangle())
            }
            .buttonStyle(WebPressStyleLocal()) // (hover: the row fill, HoverFillModifier below)
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
        .modifier(HoverFillModifier(radius: 6, fill: v("color-accent-soft").opacity(0.6)))
    }

    // Attachments and links

    private var attachments: some View {
        let files = tools?.attachments ?? []
        let links = tools?.links ?? []
        let linksRow = style("links.title.row")
        return VStack(alignment: .leading, spacing: 0) {
            panelTitle("Attachments", idStyle: "attachments.title")
            if files.isEmpty {
                emptyText("Images and files in this page will appear here.", "attachments.empty")
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(files, id: \.id) { a in
                        Button { model.editor(.blockJump(blockId: a.id)) } label: {
                            HStack(spacing: 8) {
                                WebIconView(a.kind == "image" ? .image : a.kind == "audio" ? .mic : .paperclip, size: 14)
                                    .frame(width: 14, height: 14)
                                    .foregroundStyle(v("color-ink-muted"))
                                    .frame(width: 28, height: 28)
                                    .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(v("color-surface-sunken", Folevi.color.surfaceSunken)))
                                Text(a.name).toolText(.role(.subheadline)).lineLimit(1).foregroundStyle(v("color-ink"))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(WebHoverRowStyle(radius: 6, hover: rowHover, press: rowHover, selected: false))
                    }
                }
                .padding(.bottom, 20)
            }
            HStack {
                Text("Links").toolText(style("attachments.title").text).lineLimit(1).foregroundStyle(style("attachments.title").color.color)
                Spacer(minLength: 0)
            }
            .padding(linksRow.padding.edgeInsets)
            .frame(height: linksRow.height)
            .padding(.bottom, linksRow.margin.bottom)
            if links.isEmpty {
                emptyText("Links and page links in this page will appear here.", "links.empty")
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(links, id: \.key) { l in linkRow(l) }
                }
            }
        }
    }

    private func linkRow(_ l: NoteToolsLink) -> some View {
        Button {
            if l.internal { model.open(FrameRoute(path: l.href), .replace) } else if let url = URL(string: l.href) { model.host?.frameOpenExternal(url) }
        } label: {
            HStack(spacing: 8) {
                WebIconView(l.internal ? .fileText : .externalLink, size: 14).frame(width: 14, height: 14).foregroundStyle(v("color-ink-muted"))
                VStack(alignment: .leading, spacing: 0) {
                    Text(l.label).toolText(.role(.subheadline, weight: 500)).lineLimit(1).foregroundStyle(v("color-ink"))
                    if !l.internal {
                        Text(Self.host(l.href)).toolText(.role(.footnote)).lineLimit(1).foregroundStyle(v("color-ink-faint"))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 10, style: .circular).fill(v("color-surface", Folevi.color.surface)))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .circular).strokeBorder(v("color-line", Folevi.color.line), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.webHover(radius: 10))
        .foleviTooltip(l.href)
    }

    static func host(_ href: String) -> String {
        guard let h = URL(string: href)?.host else { return href }
        return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }

    // Find in page

    private var findPanel: some View {
        let field = pair("find.field")
        let f = field.resolve(scheme)
        let icon = style("find.icon")
        let bar = style("find.bar")
        let count = style("find.count")
        let r = find.result
        let has = (r?.count ?? 0) > 0
        let status: String = find.query.trimmingCharacters(in: .whitespaces).isEmpty
            ? "Type to search this page"
            : has ? "\((r?.current ?? 0) + 1) of \(r?.count ?? 0)\(r?.truncated == true ? "+" : "")" : r == nil ? "" : "No results in this page"
        return VStack(alignment: .leading, spacing: 0) {
            panelTitle("Find", idStyle: "find.title")
            ZStack(alignment: .leading) {
                FindField(text: $find.query, style: f.text, color: f.color.color, placeholderColor: v("color-ink-faint"),
                          onChange: { find.search(model) },
                          onSubmit: { back in find.step(model, by: back ? -1 : 1) },
                          onEscape: { find.clear(model) },
                          onFocus: { findFocused = $0 })
                    .padding(f.padding.edgeInsets)
                    .frame(height: f.height)
                    .modifier(NoteToolsBox(style: findFocused ? webFocused(field) : field, field: true, focused: findFocused))
                WebIconView(.search, size: 14).frame(width: 14, height: 14).foregroundStyle(icon.color.color)
                    .padding(.leading, icon.x - f.x)
                    .allowsHitTesting(false)
                if !find.query.isEmpty {
                    HStack {
                        Spacer()
                        Button { find.clear(model) } label: {
                            WebIconView(.x, size: 13).frame(width: 24, height: 24).foregroundStyle(v("color-ink-faint")).contentShape(Rectangle()).fingerTarget(width: 24, height: 24)
                        }
                        .buttonStyle(.webHover(radius: 6))
                        .foleviTooltip("Clear search")
                        .padding(.trailing, 8)
                    }
                }
            }
            HStack(spacing: bar.gap) {
                Text(status).toolText(count.text).lineLimit(1).foregroundStyle(count.color.color).frame(maxWidth: .infinity, alignment: .leading)
                stepButton(.chevronUp, "Previous match", enabled: has) { find.step(model, by: -1) }
                stepButton(.chevronDown, "Next match", enabled: has) { find.step(model, by: 1) }
            }
            .padding(bar.padding.edgeInsets)
            .frame(height: bar.height)
            .padding(.top, bar.margin.top)
            if let r, r.count > 0 {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(r.matches.enumerated()), id: \.offset) { i, m in matchRow(m, current: i == r.current) { find.search(model, index: i) } }
                }
                .padding(.top, 8)
            }
        }
        // Find Next and Find Previous (⌘G, ⇧⌘G) step this search while the tab shows and has one going.
        .onAppear {
            model.stepSidebarFind = { [find, weak model] delta in
                guard let model, (find.result?.count ?? 0) > 0 else { return false }
                find.step(model, by: delta)
                return true
            }
        }
        .onDisappear { model.stepSidebarFind = nil }
    }

    private func stepButton(_ icon: WebIcon, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        let s = style("find.step")
        return Button(action: action) {
            WebIconView(icon, size: 15).frame(width: s.width, height: s.height).foregroundStyle(s.color.color).contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: s.radius, hover: rowHover, press: WebStyles.vars["mac-press"], selected: false))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }

    private func matchRow(_ m: FindMatch, current: Bool, action: @escaping () -> Void) -> some View {
        let row = style("find.match.current")
        let mark = style("find.mark")
        let text = Text(m.before) + Text(AttributedString(m.hit, attributes: AttributeContainer().backgroundColor(mark.background.color).foregroundColor(v("color-ink")))) + Text(m.after)
        return Button(action: action) {
            text.toolText(row.text).foregroundStyle(current ? v("color-ink") : row.color.color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(row.padding.edgeInsets)
                .background(RoundedRectangle(cornerRadius: row.radius, style: .circular).fill(current ? row.background.color : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: row.radius, hover: WebStyles.vars["color-accent-soft"], press: nil, selected: current))
    }
}

/// The comment threads of the Comments tab (the web's CommentsList): Open and Resolved, newest first; a thread
/// opens in the note. Writing a comment on the whole note is done in the note's Comments panel.
@MainActor
private struct CommentsList: View {
    let model: FrameModel
    let comments: NoteToolsComments
    let v: (String, Color) -> Color
    @AppStorage("folevi.noteSidebar.commentsFilter") private var filter = "open"

    var body: some View {
        let open = comments.threads.filter { $0.status == .open }
        let resolved = comments.threads.filter { $0.status == .resolved }
        let shown = (filter == "open" ? open : resolved).sorted { $0.lastActivityAt > $1.lastActivityAt }
        VStack(alignment: .leading, spacing: 12) {
            if !comments.canComment {
                Text("You can read comments on this note but not add them.").toolText(.role(.subheadline)).foregroundStyle(v("color-ink-muted", .secondary))
            }
            HStack(spacing: 2) {
                seg("Open\(open.isEmpty ? "" : " · \(open.count)")", on: filter == "open") { filter = "open" }
                seg("Resolved\(resolved.isEmpty ? "" : " · \(resolved.count)")", on: filter == "resolved") { filter = "resolved" }
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 10, style: .circular).fill(v("color-ink", .primary).opacity(0.06)))
            if shown.isEmpty {
                Text(filter == "open" ? "No open comments." : "No resolved comments.").toolText(.role(.subheadline)).foregroundStyle(v("color-ink-muted", .secondary))
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(shown, id: \.id) { t in row(t) }
                }
            }
        }
    }

    private func seg(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).toolText(.role(.callout, weight: 550)).lineLimit(1)
                .foregroundStyle(on ? v("color-heading", .primary) : v("color-ink-muted", .secondary))
                .frame(maxWidth: .infinity, minHeight: 28)
                .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(on ? v("glass-active", .white) : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.webHover(radius: 6, selected: on))
    }

    private func row(_ t: NoteToolsThread) -> some View {
        Button { model.editor(.threadOpen(threadId: t.id)) } label: {
            VStack(alignment: .leading, spacing: 0) {
                Text(t.anchor).toolText(.role(.footnote)).lineLimit(1).foregroundStyle(v("color-ink-faint", .secondary))
                HStack(spacing: 8) {
                    Text(String(t.author.prefix(1)).uppercased())
                        // Caption 2 (11), the smallest desktop size (MAC-53), not 9.
                        .modifier(AvatarInitialFont())
                        .foregroundStyle(v("color-canvas", .white))
                        .frame(width: 20, height: 20)
                        .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(v("color-heading", .primary)))
                    (Text(t.author).fontWeight(.semibold).foregroundColor(v("color-heading", .primary)) + Text(" · \(when(t))").foregroundColor(v("color-ink-faint", .secondary)))
                        .toolText(.role(.subheadline)).lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if t.unread { Circle().fill(v("color-coral", .red)).frame(width: 8, height: 8).accessibilityLabel("Unread") }
                }
                .padding(.top, 6)
                Text(t.deleted ? "Comment deleted" : t.text).toolText(WebTextStyle.role(.subheadline).leading(17.875)).lineLimit(2)
                    .italic(t.deleted)
                    .foregroundStyle(t.deleted ? v("color-ink-faint", .secondary) : v("color-ink", .primary))
                    .padding(.top, 4)
                if t.replies > 0 || t.status == .resolved {
                    HStack(spacing: 8) {
                        if t.replies > 0 {
                            HStack(spacing: 4) {
                                WebIconView(.cornerDownRight, size: 11).frame(width: 11, height: 11)
                                Text("\(t.replies) \(t.replies == 1 ? "reply" : "replies")")
                            }
                        }
                        if t.status == .resolved { Text("Resolved\(t.resolvedBy.map { " by \($0)" } ?? "")") }
                    }
                    .toolText(.role(.footnote)).foregroundStyle(v("color-ink-muted", .secondary))
                    .padding(.top, 4)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: 10, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["glass-hover"], selected: false))
    }

    private func when(_ t: NoteToolsThread) -> String {
        if t.waiting == "failed" { return "Not sent" }
        if t.waiting != nil { return "Waiting to send" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: Date(timeIntervalSince1970: t.lastActivityAt / 1000), relativeTo: Date())
    }
}

/// The Tasks tab's check (the web's 12-unit path "M2.5 6.2 5 8.5l4.5-5").
private struct CheckMark: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 12
        var p = Path()
        p.move(to: CGPoint(x: 2.5 * s, y: 6.2 * s))
        p.addLine(to: CGPoint(x: 5 * s, y: 8.5 * s))
        p.addLine(to: CGPoint(x: 9.5 * s, y: 3.5 * s))
        return p
    }
}

/// No system highlight (the web draws its own states).
private struct WebPressStyleLocal: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label.contentShape(Rectangle()) }
}

/// A breadcrumb link: muted, with a soft fill and the heading colour on hover.
private struct CrumbStyle: ButtonStyle {
    let radius: CGFloat
    let color: Color
    let hoverFill: Color
    let hoverColor: Color

    func makeBody(configuration: Configuration) -> some View { Body(label: configuration.label, s: self) }

    struct Body<L: View>: View {
        let label: L
        let s: CrumbStyle
        @State private var over = false
        var body: some View {
            label.foregroundStyle(over ? s.hoverColor : s.color)
                .background(RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(over ? s.hoverFill : .clear))
                .onHover { over = $0 }
        }
    }
}

/// A tab of the tool strip: the heading colour on hover (`.ui-seg > *:hover`).
private struct TabHoverStyle: ButtonStyle {
    let on: Bool
    let hover: Color

    func makeBody(configuration: Configuration) -> some View { Body(label: configuration.label, on: on, hover: hover) }

    struct Body<L: View>: View {
        let label: L
        let on: Bool
        let hover: Color
        @State private var over = false
        // One view whatever the pointer does (MAC-51): switching between two branches rebuilt the label and its
        // hover tracking on every move, which could make the colour flicker or stick.
        var body: some View {
            label.foregroundStyle(over && !on ? AnyShapeStyle(hover) : AnyShapeStyle(.foreground)).onHover { over = $0 }
        }
    }
}

/// A fill while the pointer is over a row that holds its own buttons.
private struct HoverFillModifier: ViewModifier {
    let radius: CGFloat
    let fill: Color
    @State private var over = false

    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: radius, style: .circular).fill(over ? fill : .clear))
            .onHover { over = $0 }
    }
}

#if os(macOS)
/// The Find tab's text field (a plain AppKit field in the web's input well): Return steps forward, Shift-Return
/// back, Escape clears; it takes the keyboard when the tab opens, as the web's does.
private struct FindField: NSViewRepresentable {
    @Binding var text: String
    let style: WebTextStyle
    let color: Color
    let placeholderColor: Color
    let onChange: () -> Void
    let onSubmit: (_ back: Bool) -> Void
    let onEscape: () -> Void
    /// The field takes or gives up the keyboard (the well draws its focus ring meanwhile, MAC-52).
    var onFocus: (Bool) -> Void = { _ in }

    func makeNSView(context: Context) -> NSTextField {
        let f = NSTextField()
        f.isBordered = false
        f.drawsBackground = false
        f.focusRingType = .none
        f.isBezeled = false
        f.lineBreakMode = .byTruncatingTail
        f.cell?.usesSingleLineMode = true
        f.delegate = context.coordinator
        f.setAccessibilityLabel("Find text in this page")
        DispatchQueue.main.async { f.window?.makeFirstResponder(f) }
        return f
    }

    func updateNSView(_ f: NSTextField, context: Context) {
        context.coordinator.parent = self
        if f.stringValue != text { f.stringValue = text }
        // (The system font at the native look's body size.)
        let font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        f.font = font
        f.textColor = NSColor(color)
        f.placeholderAttributedString = NSAttributedString(string: "Text in document", attributes: [.font: font, .foregroundColor: NSColor(placeholderColor)])
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    @MainActor
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: FindField
        init(parent: FindField) { self.parent = parent }

        func controlTextDidChange(_ n: Notification) {
            guard let f = n.object as? NSTextField else { return }
            parent.text = f.stringValue
            parent.onChange()
        }

        func controlTextDidBeginEditing(_ n: Notification) { parent.onFocus(true) }
        func controlTextDidEndEditing(_ n: Notification) { parent.onFocus(false) }

        /// The note's page view in this window (the web view the editor draws in), to give the keyboard back to.
        /// (The app's own class is a subclass of WKWebView, so it is found by what it is, not by its name.)
        private static func page(in view: NSView?) -> NSView? {
            guard let view else { return nil }
            if view is WKWebView { return view }
            for sub in view.subviews { if let p = page(in: sub) { return p } }
            return nil
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            if selector == #selector(NSResponder.insertNewline(_:)) {
                parent.onSubmit(NSEvent.modifierFlags.contains(.shift))
                return true
            }
            if selector == #selector(NSResponder.cancelOperation(_:)) {
                if !parent.text.isEmpty {
                    parent.onEscape()
                    return true
                }
                // Escape in an empty field gives the keyboard back to the page (MAC-52).
                if let window = control.window, let page = Self.page(in: window.contentView) {
                    window.makeFirstResponder(page)
                    return true
                }
            }
            return false
        }
    }
}
#else
/// The Find tab's text field: Return steps forward; it takes the keyboard when the tab opens, as the web's does.
private struct FindField: View {
    @Binding var text: String
    let style: WebTextStyle
    let color: Color
    let placeholderColor: Color
    let onChange: () -> Void
    let onSubmit: (_ back: Bool) -> Void
    let onEscape: () -> Void
    var onFocus: (Bool) -> Void = { _ in }
    @FocusState private var focused: Bool
    @Environment(\.macNativeLook) private var native

    var body: some View {
        TextField("", text: $text, prompt: Text("Text in document").foregroundStyle(placeholderColor))
            .font(native ? MacLook.Text.body : Font(style.ctFont))
            .foregroundStyle(color)
            .textFieldStyle(.plain)
            .submitLabel(.search)
            .focused($focused)
            .onChange(of: text) { onChange() }
            .onSubmit { onSubmit(false) }
            .onKeyPress(.escape) {
                guard !text.isEmpty else { return .ignored }
                onEscape()
                return .handled
            }
            .accessibilityLabel("Find text in this page")
            .onAppear { focused = true }
    }
}
#endif
extension View {
    /// Text in the note's tools: the web's text style on the iPad; on the Mac the system font at the native look's
    /// sizes (11, 13, 15 pt), the web's weight kept.
    func toolText(_ s: WebTextStyle) -> some View {
        modifier(ToolText(style: s))
    }
}

/// toolText's: the system font in the native look (the Mac's, the iPad's wide layout's), the web's style elsewhere.
private struct ToolText: ViewModifier {
    let style: WebTextStyle
    @Environment(\.macNativeLook) private var native

    func body(content: Content) -> some View {
        #if os(macOS)
        content.font(NoteToolsLook.font(style))
        #else
        if native { content.font(NoteToolsLook.font(style)) } else { content.webText(style) }
        #endif
    }
}

/// A comment author's initial: Caption 2 (11), the smallest desktop size (MAC-53); the system's on the Mac.
private struct AvatarInitialFont: ViewModifier {
    @Environment(\.macNativeLook) private var native
    func body(content: Content) -> some View {
        content.font(native ? MacLook.Text.smallStrong : WebFont.font(.sans, size: 11, weight: 600))
    }
}

/// A box of the note's tools (the outline's top row, the Find field's well): the web's box on the iPad; on the Mac
/// a quiet rounded fill (a field's ring in the accent while it has the keyboard).
private struct NoteToolsBox: ViewModifier {
    let style: WebStylePair
    var field = false
    var focused = false
    @Environment(\.macNativeLook) private var native

    func body(content: Content) -> some View {
        if native {
            let shape = RoundedRectangle(cornerRadius: MacLook.rowRadius, style: .continuous)
            content
                .background(field ? MacLook.Colors.container.opacity(0.9) : MacLook.Colors.hover.opacity(0.35), in: shape)
                .overlay {
                    if field { shape.strokeBorder(focused ? MacLook.Colors.accent : MacLook.Colors.separator, lineWidth: focused ? 2 : 1) }
                }
        } else {
            content.webBox(style)
        }
    }
}

/// The note tools' type and colours in the native look.
enum NoteToolsLook {
    static func font(_ s: WebTextStyle) -> Font {
        let base: Font = s.size >= 17 ? MacLook.Text.title3 : s.size >= 13 ? MacLook.Text.body : MacLook.Text.small
        return s.weight >= 600 ? base.weight(.semibold) : s.weight >= 500 ? base.weight(.medium) : base
    }

    /// The web palette's variables the tools use, as the system's semantic colours.
    static func color(_ name: String) -> Color? {
        switch name {
        case "color-heading", "color-ink": return MacLook.Colors.label
        case "color-ink-muted": return MacLook.Colors.secondary
        case "color-ink-faint": return MacLook.Colors.tertiary
        case "glass-hover", "color-accent-soft", "color-surface-sunken": return MacLook.Colors.hover
        case "glass-active", "color-surface", "color-canvas": return MacLook.Colors.container
        case "color-line", "color-line-strong": return MacLook.Colors.separator
        case "color-coral": return MacLook.Colors.red
        case "color-moss": return MacLook.Colors.green
        default: return nil
        }
    }
}
#endif
