import SwiftUI

/// The sidebar while a note is open (the web's DocumentSidebar): the note's name and where it lives, then
/// four tools for the page: Table of contents, Tasks in this page, Attachments and links, Find in page.
struct NoteSidebarContent: View {
    @Bindable var model: EditorModel
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @AppStorage("noteSidebar.tab") private var tab: Tab = .contents

    enum Tab: String, CaseIterable, Identifiable {
        case contents, tasks, attachments, find
        var id: String { rawValue }
        var label: LocalizedStringKey {
            switch self {
            case .contents: return "Table of contents"
            case .tasks: return "Tasks in this page"
            case .attachments: return "Attachments and links"
            case .find: return "Find in page"
            }
        }
        var systemImage: String {
            switch self {
            case .contents: return "list.bullet"
            case .tasks: return "checkmark.circle"
            case .attachments: return "paperclip"
            case .find: return "magnifyingglass"
            }
        }
    }

    /// Every block in page order (also inside collapsed toggles).
    private var ordered: [Block] {
        Tree.flatten(model.liveWire).compactMap { model.blocks[$0.block.id] }
    }

    private var title: String { model.document?.title.isEmpty == false ? model.document!.title : String(localized: "Untitled") }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            titleCard
                .padding(.horizontal, 12)
                .padding(.top, 4)
                .padding(.bottom, 12)
            tabs
                .padding(.horizontal, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    switch tab {
                    case .contents: contents
                    case .tasks: tasks
                    case .attachments: attachments
                    case .find: FindInPage(model: model, jump: jump)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 16)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.never)
        }
    }

    /// Puts the cursor in the block (or selects it) and brings it into view.
    private func jump(_ blockId: String) {
        guard let block = model.blocks[blockId] else { return }
        if block.content.carriesText {
            model.focus = FocusRequest(blockId: blockId, caret: .start)
        } else {
            model.select(blockId, extend: false)
        }
        model.revealBlockId = blockId
    }

    // MARK: Title card

    private var trail: [(label: String, action: () -> Void)] {
        var out: [(String, () -> Void)] = []
        let folderId = model.detail?.folder?.id ?? model.document?.folderId
        if let folderId, let folder = app.sidebar.folders.first(where: { $0.id == folderId }) {
            if let parentId = folder.parentFolderId, let parent = app.sidebar.folders.first(where: { $0.id == parentId }) {
                out.append((parent.name, { nav.selection = .folder(parent.id) }))
            }
            out.append((folder.name, { nav.selection = .folder(folder.id) }))
        } else if let folder = model.detail?.folder {
            out.append((folder.name, { nav.selection = .folder(folder.id) }))
        } else {
            out.append((String(localized: "Drafts"), { nav.selection = .drafts }))
        }
        for a in ancestors {
            out.append((a.title.isEmpty ? String(localized: "Untitled") : a.title, { nav.open(a.id) }))
        }
        return out
    }

    /// Parent pages, outermost first.
    private var ancestors: [(id: String, title: String)] {
        if let crumbs = model.detail?.breadcrumbs { return crumbs.map { ($0.id, $0.title) } }
        var out: [(String, String)] = []
        var cursor = model.document?.parentDocumentId
        var guardCount = 0
        while let id = cursor, let parent = app.document(id), guardCount < 12 {
            out.insert((parent.id, parent.title), at: 0)
            cursor = parent.parentDocumentId
            guardCount += 1
        }
        return out
    }

    private var titleCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.ui(13.5, .semibold))
                .foregroundStyle(FoleviColor.heading)
                .lineLimit(1)
                .help(Text(title))
            FlowLayout(spacing: 2) {
                Text("In").foregroundStyle(FoleviColor.inkMuted).frame(height: 20)
                ForEach(Array(trail.enumerated()), id: \.offset) { i, crumb in
                    HStack(spacing: 2) {
                        if i > 0 {
                            Image(systemName: "chevron.right").font(.system(size: 8.5, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
                                .accessibilityHidden(true)
                        }
                        TrailLink(title: crumb.label, action: crumb.action)
                    }
                }
            }
            .font(.ui(11.5))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Breadcrumb"))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(FoleviGlass.border))
        .accessibilityElement(children: .contain)
    }

    private var tabs: some View {
        HStack(spacing: 2) {
            ForEach(Tab.allCases) { t in
                Button {
                    tab = t
                } label: {
                    Image(systemName: t.systemImage)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(tab == t ? FoleviColor.heading : FoleviColor.inkMuted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
                        .background {
                            if tab == t {
                                RoundedRectangle(cornerRadius: 4, style: .continuous).fill(FoleviGlass.active)
                                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(.white.opacity(0.6)))
                                    .shadow(color: .black.opacity(0.08), radius: 1.5, y: 1)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(Text(t.label))
                .accessibilityLabel(Text(t.label))
                .accessibilityAddTraits(tab == t ? [.isSelected] : [])
            }
        }
        .padding(3)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviGlass.border))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Page tools"))
    }

    private func panelTitle(_ text: LocalizedStringKey, aside: String? = nil) -> some View {
        HStack {
            Text(text).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
                .uiLineHeight(13 * 1.55, size: 13, weight: .semibold) // the sidebar's 1.55 line height
            Spacer()
            if let aside { Text(aside).font(.ui(11.5)).monospacedDigit().foregroundStyle(FoleviColor.inkMuted) }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
    }

    private func emptyText(_ text: LocalizedStringKey) -> some View {
        Text(text).font(.ui(12.5)).lineSpacing(3).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 4)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Contents

    @ViewBuilder private var contents: some View {
        panelTitle("Table of contents")
        Button {
            model.page.scrollTopToken = UUID()
        } label: {
            Text(title).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                .uiLineHeight(13 * 1.55, size: 13, weight: .semibold)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.bottom, 2)
        let entries = ordered.compactMap { b -> OutlineEntry? in
            switch b.content {
            case .heading(let h):
                let text = RichText.plainText(b.text)
                return OutlineEntry(id: b.id, label: text.isEmpty ? String(localized: "Untitled heading") : text,
                                    level: h.level == .level1 ? 1 : h.level == .level2 ? 2 : 3, pageId: nil)
            case .page(let p):
                return OutlineEntry(id: b.id, label: p.titleCache?.isEmpty == false ? p.titleCache! : String(localized: "Nested page"), level: 0, pageId: p.documentId)
            default: return nil
            }
        }
        if entries.isEmpty {
            Text("Add headings or nested pages and they’ll appear here.")
                .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity).padding(.horizontal, 4).padding(.vertical, 24)
        } else {
            let current = currentHeading(entries.filter { $0.pageId == nil }.map(\.id))
            VStack(alignment: .leading, spacing: 2) {
                ForEach(entries) { e in
                    OutlineRow(entry: e, isCurrent: e.id == current) {
                        if let page = e.pageId { nav.open(page) } else { jump(e.id) }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Outline"))
        }
    }

    /// The heading whose section holds the cursor (the first one otherwise).
    private func currentHeading(_ ids: [String]) -> String? {
        guard !ids.isEmpty else { return nil }
        let anchor = model.focusedBlockId ?? model.orderedByRows(Array(model.selectedBlockIds)).first
        let order = ordered.map(\.id)
        guard let anchor, let at = order.firstIndex(of: anchor) else { return ids.first }
        let set = Set(ids)
        return order[...at].last { set.contains($0) } ?? ids.first
    }

    // MARK: Tasks

    @ViewBuilder private var tasks: some View {
        let todos = ordered.filter { if case .todo = $0.content { return true } else { return false } }
        let done = todos.filter { if case .todo(let p) = $0.content { return p.checked } else { return false } }.count
        panelTitle("Tasks", aside: todos.isEmpty ? nil : String(localized: "\(done) of \(todos.count) done"))
        if todos.isEmpty {
            emptyText("Tasks inside this document will appear here. Type “[]” or use Insert → To-do to add one.")
        }
        ForEach(todos) { b in
            PageTaskRow(block: b, readOnly: model.isReadOnly, toggle: { model.toggleTodo(b.id) }, jump: { jump(b.id) })
        }
    }

    // MARK: Attachments and links

    private struct LinkItem: Identifiable {
        var id: String
        var label: String
        var url: URL?
        var documentId: String?
    }

    @ViewBuilder private var attachments: some View {
        let blocks = ordered
        let files = blocks.compactMap { b -> (id: String, name: String, icon: String)? in
            switch b.content {
            case .image(let p): return (b.id, !p.caption.isEmpty ? p.caption : !p.alt.isEmpty ? p.alt : String(localized: "Image"), "photo")
            case .file(let p): return (b.id, p.name.isEmpty ? String(localized: "File") : p.name, "paperclip")
            default:
                if b.typeName == "audio" {
                    let name = b.wire.props["name"]?.stringValue ?? ""
                    return (b.id, name.isEmpty ? String(localized: "Audio recording") : name, "mic")
                }
                return nil
            }
        }
        let links: [LinkItem] = blocks.flatMap { b -> [LinkItem] in
            var out: [LinkItem] = []
            if case .bookmark(let p) = b.content, !p.url.isEmpty, let url = URL(string: p.url) {
                let host = (url.host() ?? p.url).replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression)
                out.append(LinkItem(id: "\(b.id)-bm", label: p.title.flatMap { $0.isEmpty ? nil : $0 } ?? host, url: url))
            }
            for (i, node) in b.text.enumerated() {
                switch node {
                case .pageLink(let documentId, let label):
                    out.append(LinkItem(id: "\(b.id)-\(i)", label: label.isEmpty ? String(localized: "Untitled") : label, documentId: documentId))
                case .text(let text, let marks):
                    for case .link(let href) in marks ?? [] where href.lowercased().hasPrefix("http:") || href.lowercased().hasPrefix("https:") {
                        if let url = URL(string: href) { out.append(LinkItem(id: "\(b.id)-\(i)", label: text, url: url)) }
                    }
                default: break
                }
            }
            return out
        }
        panelTitle("Attachments")
        if files.isEmpty {
            emptyText("Images and files in this page will appear here.").padding(.bottom, 20)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(files, id: \.id) { f in
                    AttachmentRow(name: f.name, icon: f.icon) { jump(f.id) }
                }
            }
            .padding(.bottom, 20)
        }
        panelTitle("Links")
        if links.isEmpty {
            emptyText("Links and page links in this page will appear here.")
        }
        VStack(alignment: .leading, spacing: 6) {
            ForEach(links) { l in
                LinkCard(label: l.label, host: l.url.flatMap { $0.host()?.replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression) },
                         internal: l.documentId != nil) {
                    if let id = l.documentId { nav.open(id) } else if let url = l.url { NSWorkspace.shared.open(url) }
                }
            }
        }
    }
}

private struct TrailLink: View {
    var title: String
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title).lineLimit(1).truncationMode(.tail)
                .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                .padding(.horizontal, 4)
                .frame(maxWidth: 152, alignment: .leading)
                .fixedSize(horizontal: true, vertical: false)
                .frame(height: 20)
                .background(hovering ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct OutlineEntry: Identifiable {
    var id: String
    var label: String
    /// 1–3 for headings, 0 for a nested page.
    var level: Int
    var pageId: String?
}

private struct OutlineRow: View {
    var entry: OutlineEntry
    var isCurrent: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Group {
                if entry.pageId != nil {
                    Text("↳ \(entry.label)")
                        .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                        .padding(.horizontal, 10)
                } else {
                    Text(entry.label)
                        .fontWeight(entry.level == 1 ? .semibold : .regular)
                        .foregroundStyle(isCurrent || hovering ? FoleviColor.heading : entry.level == 1 ? FoleviColor.ink : FoleviColor.inkMuted)
                        .padding(.leading, entry.level == 1 ? 12 : entry.level == 2 ? 24 : 36)
                        .padding(.trailing, 8)
                }
            }
            .font(.ui(13))
            .lineLimit(1)
            .truncationMode(.tail)
            .uiLineHeight(13 * 1.55, size: 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .background(hovering ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(alignment: .leading) {
                if isCurrent { Capsule().fill(FoleviColor.heading).frame(width: 3).padding(.vertical, 6) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityValue(Text(entry.pageId != nil ? "Nested page" : "Heading level \(entry.level)"))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

private struct PageTaskRow: View {
    var block: Block
    var readOnly: Bool
    var toggle: () -> Void
    var jump: () -> Void
    @State private var hovering = false

    private var checked: Bool { if case .todo(let p) = block.content { return p.checked } else { return false } }
    private var text: String {
        let t = RichText.plainText(block.text)
        return t.isEmpty ? String(localized: "Untitled task") : t
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Button(action: toggle) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(checked ? FoleviColor.moss : FoleviColor.surface)
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .strokeBorder(checked ? FoleviColor.moss : FoleviColor.lineStrong)
                    if checked {
                        Image(systemName: "checkmark").font(.system(size: 8.5, weight: .bold)).foregroundStyle(.white)
                    }
                }
                .frame(width: 16, height: 16)
                .padding(.top, 2)
            }
            .buttonStyle(.plain)
            .disabled(readOnly)
            .accessibilityLabel(Text(checked ? "Mark as not done: \(text)" : "Mark as done: \(text)"))
            .accessibilityAddTraits(checked ? .isSelected : [])
            Button(action: jump) {
                Text(text)
                    .font(.ui(13))
                    .strikethrough(checked)
                    .foregroundStyle(checked ? FoleviColor.inkMuted : FoleviColor.ink)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(hovering ? FoleviColor.accentSoft.opacity(0.6) : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .onHover { hovering = $0 }
    }
}

private struct AttachmentRow: View {
    var name: String
    var icon: String
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12.5)).foregroundStyle(FoleviColor.inkMuted)
                    .frame(width: 28, height: 28)
                    .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                Text(name).font(.ui(13)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(hovering ? FoleviColor.accentSoft.opacity(0.6) : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct LinkCard: View {
    var label: String
    var host: String?
    var `internal`: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: `internal` ? "doc.text" : "arrow.up.right.square")
                    .font(.system(size: 12.5)).foregroundStyle(FoleviColor.inkMuted)
                VStack(alignment: .leading, spacing: 0) {
                    Text(label).font(.ui(13, .medium)).foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.ink).lineLimit(1)
                    if !`internal`, let host { Text(host).font(.ui(11)).foregroundStyle(FoleviColor.inkFaint).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .foleviCard(radius: 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityHint(`internal` ? Text("") : Text("Opens in your browser"))
    }
}

/// Find in page: every occurrence, with a snippet around it; Return / Shift-Return and the arrows step
/// through them, choosing one brings it into view (the web's FindPanel).
private struct FindInPage: View {
    @Bindable var model: EditorModel
    var jump: (String) -> Void
    @State private var query = ""
    @State private var index = 0
    @FocusState private var focused: Bool

    struct Match: Identifiable {
        var id: Int
        var blockId: String
        var before: String
        var hit: String
        var after: String
    }

    /// Up to 500 matches across the page's text blocks, case-insensitive, with word-bounded excerpts.
    private var matches: [Match] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return [] }
        var out: [Match] = []
        for entry in Tree.flatten(model.liveWire) {
            guard let b = model.blocks[entry.block.id] else { continue }
            let text: String
            if case .code(let p) = b.content { text = p.code } else if b.content.carriesText { text = RichText.plainText(b.text) } else { continue }
            for r in FindReplace.ranges(of: q, in: text) {
                let s = FindSnippet.around(text, at: r.location, length: r.length)
                out.append(Match(id: out.count, blockId: b.id, before: s.before, hit: s.hit, after: s.after))
                if out.count >= 500 { return out }
            }
        }
        return out
    }

    var body: some View {
        let matches = self.matches
        let current = matches.isEmpty ? -1 : min(index, matches.count - 1)
        VStack(alignment: .leading, spacing: 0) {
            Text("Find").font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading)
                .uiLineHeight(13 * 1.55, size: 13, weight: .semibold).padding(.horizontal, 4).padding(.bottom, 8)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                TextField("Text in document", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(13))
                    .focused($focused)
                    .onChange(of: query) { _, _ in index = 0 }
                    .onSubmit { reveal(current + (NSEvent.modifierFlags.contains(.shift) ? -1 : 1), matches) }
                    .onExitCommand { query = "" }
                    .accessibilityLabel(Text("Find text in this page"))
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint).frame(width: 24, height: 24) }
                        .buttonStyle(.plain).accessibilityLabel(Text("Clear search"))
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .frame(height: 36)
            .pageInput(focused: focused)
            HStack(spacing: 4) {
                Text(query.trimmingCharacters(in: .whitespaces).isEmpty ? String(localized: "Type to search this page")
                     : matches.isEmpty ? String(localized: "No results in this page")
                     : String(localized: "\(current + 1) of \(matches.count)\(matches.count >= 500 ? "+" : "")"))
                    .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.updatesFrequently)
                PageIconButton(systemImage: "chevron.up", label: String(localized: "Previous match"), size: 28) { reveal(current - 1, matches) }
                    .disabled(matches.isEmpty)
                PageIconButton(systemImage: "chevron.down", label: String(localized: "Next match"), size: 28) { reveal(current + 1, matches) }
                    .disabled(matches.isEmpty)
            }
            .padding(.horizontal, 4)
            .padding(.top, 8)
            if !matches.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(matches.prefix(100)) { m in
                        Button { reveal(m.id, matches) } label: {
                            Text(snippet(m))
                                .font(.ui(12.5))
                                .foregroundStyle(m.id == current ? FoleviColor.ink : FoleviColor.inkMuted)
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                                .background(m.id == current ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(m.id == current ? .isSelected : [])
                    }
                }
                .padding(.top, 8)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Matches"))
            }
        }
        .claimsFocus($focused)
    }

    /// The excerpt with the match marked (marigold-soft, ink).
    private func snippet(_ m: Match) -> AttributedString {
        var hit = AttributedString(m.hit)
        hit.backgroundColor = FoleviColor.marigoldSoft
        hit.foregroundColor = FoleviColor.ink
        return AttributedString(m.before) + hit + AttributedString(m.after)
    }

    private func reveal(_ i: Int, _ matches: [Match]) {
        guard !matches.isEmpty else { return }
        let next = ((i % matches.count) + matches.count) % matches.count
        index = next
        model.revealBlockId = matches[next].blockId
    }
}
