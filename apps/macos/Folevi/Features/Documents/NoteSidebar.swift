import SwiftUI

/// The sidebar while a note is open (the web's DocumentSidebar): the note's name and where it lives, then
/// four tools — Table of contents, Tasks in this page, Attachments and links, Find in page.
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

    private var title: String { model.document?.displayTitle ?? String(localized: "Untitled") }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            titleCard
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
            tabs
                .padding(.horizontal, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    switch tab {
                    case .contents: contents
                    case .tasks: tasks
                    case .attachments: attachments
                    case .find: FindInPage(model: model, jump: jump)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.top, 14)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.never)
        }
    }

    private func jump(_ blockId: String) {
        model.revealBlockId = blockId
        model.select(blockId, extend: false)
    }

    // MARK: Title card

    private var trail: [(label: String, action: () -> Void)] {
        var out: [(String, () -> Void)] = []
        if let folderId = model.document?.folderId, let folder = app.sidebar.folders.first(where: { $0.id == folderId }) {
            if let parentId = folder.parentFolderId, let parent = app.sidebar.folders.first(where: { $0.id == parentId }) {
                out.append((parent.name, { nav.selection = .folder(parent.id); nav.closeDocument() }))
            }
            out.append((folder.name, { nav.selection = .folder(folder.id); nav.closeDocument() }))
        } else {
            out.append((String(localized: "Drafts"), { nav.selection = .drafts; nav.closeDocument() }))
        }
        if let parentId = model.document?.parentDocumentId, let parent = app.documents.first(where: { $0.id == parentId }) {
            out.append((parent.displayTitle, { nav.open(parent.id) }))
        }
        return out
    }

    private var titleCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.ui(13.5, .semibold))
                .foregroundStyle(FoleviColor.heading)
                .lineLimit(1)
            HStack(spacing: 2) {
                Text("In").foregroundStyle(FoleviColor.inkMuted)
                ForEach(Array(trail.enumerated()), id: \.offset) { i, crumb in
                    if i > 0 {
                        Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
                    }
                    Button(action: crumb.action) {
                        Text(crumb.label).lineLimit(1).padding(.horizontal, 3)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(FoleviColor.inkMuted)
                }
            }
            .font(.ui(11.5))
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
                        .frame(height: 30)
                        .background(tab == t ? FoleviColor.surface : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .shadow(color: .black.opacity(tab == t ? 0.08 : 0), radius: 1.5, y: 1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(Text(t.label))
                .accessibilityLabel(Text(t.label))
                .accessibilityAddTraits(tab == t ? [.isSelected] : [])
            }
        }
        .padding(3)
        .foleviWell()
    }

    private func panelTitle(_ text: LocalizedStringKey, aside: String? = nil) -> some View {
        HStack {
            Text(text).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading)
            Spacer()
            if let aside { Text(aside).font(.ui(11.5)).monospacedDigit().foregroundStyle(FoleviColor.inkMuted) }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 6)
    }

    private func emptyText(_ text: LocalizedStringKey) -> some View {
        Text(text).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 4)
    }

    // MARK: Contents

    @ViewBuilder private var contents: some View {
        panelTitle("Table of contents")
        Button {
            if let first = model.rows.first { jump(first.id) }
            model.focus = FocusRequest(blockId: "__title__", caret: .start)
        } label: {
            Text(title).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        let entries = ordered.compactMap { b -> (id: String, label: String, level: Int, page: Bool)? in
            switch b.content {
            case .heading(let h):
                let text = RichText.plainText(b.text)
                return text.isEmpty ? nil : (b.id, text, h.level == .level1 ? 0 : h.level == .level2 ? 1 : 2, false)
            case .page(let p):
                return (b.id, p.titleCache?.isEmpty == false ? p.titleCache! : String(localized: "Untitled"), 0, true)
            default: return nil
            }
        }
        if entries.isEmpty {
            emptyText("Headings in this page will appear here.").padding(.top, 8)
        }
        ForEach(entries, id: \.id) { e in
            OutlineRow(label: e.label, level: e.level, isPage: e.page) {
                if e.page, case .page(let p)? = model.blocks[e.id]?.content { nav.open(p.documentId) } else { jump(e.id) }
            }
        }
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
            let checked: Bool = { if case .todo(let p) = b.content { return p.checked } else { return false } }()
            let text = RichText.plainText(b.text)
            HStack(alignment: .top, spacing: 8) {
                Button {
                    model.toggleTodo(b.id)
                } label: {
                    Image(systemName: checked ? "checkmark.square.fill" : "square")
                        .font(.system(size: 14))
                        .foregroundStyle(checked ? FoleviColor.moss : FoleviColor.inkFaint)
                }
                .buttonStyle(.plain)
                .disabled(model.isReadOnly)
                .accessibilityLabel(Text(checked ? "Mark as not done: \(text)" : "Mark as done: \(text)"))
                Button {
                    jump(b.id)
                } label: {
                    Text(text.isEmpty ? String(localized: "Untitled task") : text)
                        .font(.ui(13))
                        .strikethrough(checked)
                        .foregroundStyle(checked ? FoleviColor.inkMuted : FoleviColor.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
        }
    }

    // MARK: Attachments and links

    private struct LinkItem: Identifiable {
        var id: String
        var blockId: String
        var label: String
        var url: URL?
        var documentId: String?
    }

    @ViewBuilder private var attachments: some View {
        let blocks = ordered
        let files = blocks.compactMap { b -> (id: String, name: String, image: Bool)? in
            switch b.content {
            case .image(let p): return (b.id, p.caption.isEmpty ? (p.alt.isEmpty ? String(localized: "Image") : p.alt) : p.caption, true)
            case .file(let p): return (b.id, p.name.isEmpty ? String(localized: "File") : p.name, false)
            default: return nil
            }
        }
        let links: [LinkItem] = blocks.flatMap { b -> [LinkItem] in
            var out: [LinkItem] = []
            if case .bookmark(let p) = b.content, let url = URL(string: p.url) {
                out.append(LinkItem(id: "\(b.id)-bm", blockId: b.id, label: p.title ?? url.host() ?? p.url, url: url))
            }
            for (i, node) in b.text.enumerated() {
                switch node {
                case .pageLink(let documentId, let label):
                    out.append(LinkItem(id: "\(b.id)-\(i)", blockId: b.id, label: label.isEmpty ? String(localized: "Untitled") : label, documentId: documentId))
                case .text(let text, let marks):
                    for case .link(let href) in marks ?? [] {
                        if let url = URL(string: href), url.scheme == "http" || url.scheme == "https" {
                            out.append(LinkItem(id: "\(b.id)-\(i)", blockId: b.id, label: text, url: url))
                        }
                    }
                default: break
                }
            }
            return out
        }
        panelTitle("Attachments")
        if files.isEmpty {
            emptyText("Images and files in this page will appear here.").padding(.bottom, 14)
        } else {
            ForEach(files, id: \.id) { f in
                Button { jump(f.id) } label: {
                    HStack(spacing: 8) {
                        Image(systemName: f.image ? "photo" : "paperclip")
                            .font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                            .frame(width: 26, height: 26)
                            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        Text(f.name).font(.ui(13)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 6).padding(.vertical, 3).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer().frame(height: 14)
        }
        panelTitle("Links")
        if links.isEmpty {
            emptyText("Links and page links in this page will appear here.")
        }
        ForEach(links) { l in
            Button {
                if let id = l.documentId { nav.open(id) } else if let url = l.url { NSWorkspace.shared.open(url) }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: l.documentId == nil ? "arrow.up.right.square" : "doc.text")
                        .font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(l.label).font(.ui(13, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                        if let host = l.url?.host() { Text(host).font(.ui(11)).foregroundStyle(FoleviColor.inkFaint).lineLimit(1) }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviGlass.border))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.bottom, 4)
        }
    }
}

private struct OutlineRow: View {
    var label: String
    var level: Int
    var isPage: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isPage { Text("↳").foregroundStyle(FoleviColor.inkFaint) }
                Text(label).lineLimit(1)
                Spacer(minLength: 0)
            }
            .font(.ui(13))
            .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.leading, 12 + CGFloat(level) * 14)
            .padding(.trailing, 8)
            .frame(height: 30)
            .background(hovering ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// Find in page: every block whose text contains the query, with a snippet; choosing one jumps to it.
private struct FindInPage: View {
    @Bindable var model: EditorModel
    var jump: (String) -> Void
    @State private var query = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                TextField("Find in page", text: $query).textFieldStyle(.plain).font(.ui(13)).focused($focused)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(FoleviColor.inkFaint) }
                        .buttonStyle(.plain).accessibilityLabel(Text("Clear search"))
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .foleviWell()
            let q = query.trimmingCharacters(in: .whitespaces)
            if !q.isEmpty {
                let hits = Tree.flatten(model.liveWire).compactMap { entry -> (id: String, text: String, range: Range<String.Index>)? in
                    guard let b = model.blocks[entry.block.id] else { return nil }
                    let text = RichText.plainText(b.text)
                    guard let r = text.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) else { return nil }
                    return (b.id, text, r)
                }
                Text(hits.isEmpty ? String(localized: "No matches") : hits.count == 1 ? String(localized: "1 match") : String(localized: "\(hits.count) matches"))
                    .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 4)
                ForEach(hits, id: \.id) { h in
                    Button { jump(h.id) } label: {
                        snippet(h.text, h.range)
                            .font(.ui(12.5))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .onAppear { focused = true }
    }

    private func snippet(_ text: String, _ r: Range<String.Index>) -> Text {
        let start = text.index(r.lowerBound, offsetBy: -30, limitedBy: text.startIndex) ?? text.startIndex
        let end = text.index(r.upperBound, offsetBy: 60, limitedBy: text.endIndex) ?? text.endIndex
        let before = (start > text.startIndex ? "…" : "") + String(text[start..<r.lowerBound])
        let after = String(text[r.upperBound..<end]) + (end < text.endIndex ? "…" : "")
        return Text(before).foregroundStyle(FoleviColor.inkMuted)
            + Text(text[r]).bold().foregroundStyle(FoleviColor.heading)
            + Text(after).foregroundStyle(FoleviColor.inkMuted)
    }
}
