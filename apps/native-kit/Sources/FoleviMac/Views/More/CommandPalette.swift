// ⌘K, search and commands (apps/web/src/components/app/CommandPalette.tsx as Folevi for Mac shows it): the
// field, the filters (folder, tag, updated, the space), then the notes (Recent before typing: the notes opened
// last, `recent.viewed`; then the engine's `search` answers), Ask Foli AI, and the actions. Arrow keys move,
// Return opens, Escape closes. The sidebar's "Search or jump to…", ⌘K and Open Quickly open it.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
@Observable
final class PaletteModel {
    let frame: FrameModel
    var search: SearchModel
    let recent: ValueStore<RecentViewedValue>
    var active = 0

    enum Item: Identifiable {
        case note(id: String, title: String, snippet: String?, updatedAt: Double?, blockId: String?, meaning: Bool)
        case action(id: String, label: String, hint: String?, icon: WebIcon?, ai: Bool, run: @MainActor () -> Void)

        var id: String {
            switch self {
            case .note(let id, _, _, _, let b, _): "n:\(id):\(b ?? "")"
            case .action(let id, _, _, _, _, _): "a:\(id)"
            }
        }

        var isNote: Bool { if case .note = self { true } else { false } }
        var isMeaning: Bool { if case .note(_, _, _, _, _, let m) = self { m } else { false } }
    }

    init(frame: FrameModel) {
        self.frame = frame
        search = SearchModel(client: frame.client)
        recent = frame.client.watch(.recentViewed(limit: 8))
    }

    var typed: String { search.text.trimmingCharacters(in: .whitespacesAndNewlines) }
    var answered: Bool { search.answeredText == typed && search.result != nil }

    private var dark: Bool { NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }

    private var actions: [Item] {
        [
            .action(id: "new", label: "New document", hint: "⌘⌥N", icon: .plus, ai: false) { [frame] in frame.newNote() },
            .action(id: "tasks", label: "Go to Tasks · Today", hint: nil, icon: .squareCheckBig, ai: false) { [frame] in frame.open(.tasks(.today)) },
            .action(id: "calendar", label: "Go to Calendar", hint: nil, icon: .calendarDays, ai: false) { [frame] in frame.open(.calendar(nil)) },
            .action(id: "review", label: "Go to Reviews", hint: nil, icon: .layers, ai: false) { [frame] in frame.open(.web("/review")) },
            .action(id: "changes", label: "Go to Changes", hint: nil, icon: .fileDiff, ai: false) { [frame] in frame.open(.changes) },
            .action(id: "all", label: "Go to Home", hint: nil, icon: .house, ai: false) { [frame] in frame.open(.home) },
            .action(id: "trash", label: "Open Trash", hint: nil, icon: .trash, ai: false) { [frame] in frame.open(.notes(.trash)) },
            .action(id: "settings", label: "Open Settings", hint: nil, icon: .settings, ai: false) { [frame] in frame.host?.frameOpenSettings(section: "account") },
            .action(id: "theme", label: dark ? "Switch to light appearance" : "Switch to dark appearance", hint: nil, icon: dark ? .sun : .moon, ai: false) { [frame, dark] in
                Task { _ = try? await frame.client.command(.settingsUpdate(appearance: dark ? .light : .dark)) }
            },
        ]
    }

    var items: [Item] {
        let q = typed.lowercased()
        let matching = q.isEmpty ? Array(actions.prefix(4)) : actions.filter { if case .action(_, let l, _, _, _, _) = $0 { l.lowercased().contains(q) } else { false } }
        var docs: [Item]
        if typed.isEmpty {
            docs = (recent.value?.rows ?? []).map { .note(id: $0.id, title: $0.title, snippet: nil, updatedAt: $0.updatedAt, blockId: nil, meaning: false) }
        } else if answered, let hits = search.result?.hits {
            let plain = hits.filter { $0.matchIn != "meaning" }
            let found = Set(plain.map(\.id))
            docs = plain.map { .note(id: $0.id, title: $0.title, snippet: $0.snippet.isEmpty ? nil : $0.snippet, updatedAt: $0.updatedAt, blockId: $0.blockId, meaning: false) }
            docs += hits.filter { $0.matchIn == "meaning" && !found.contains($0.id) }.map { .note(id: $0.id, title: $0.title, snippet: $0.snippet, updatedAt: nil, blockId: nil, meaning: true) }
        } else {
            docs = []
        }
        var out = docs
        if frame.session.value?.capabilities.ai ?? false {
            let label = typed.isEmpty ? "Ask Foli AI about your notes" : "Ask Foli AI: “\(typed)”"
            out.append(.action(id: "ask-ai", label: label, hint: "⌘J", icon: nil, ai: true) { [frame] in frame.open(.web("/ai")) })
        }
        return out + matching
    }

    func run(_ item: Item) {
        switch item {
        case .note(let id, _, _, _, _, _): frame.open(.note(id), .newTab)
        case .action(_, _, _, _, _, let run): run()
        }
    }

    func move(_ by: Int) {
        let n = items.count
        guard n > 0 else { return }
        active = min(n - 1, max(0, active + by))
    }
}

/// Opens ⌘K in a frame's window.
@MainActor
public enum CommandPalette {
    public static func show(_ frame: FrameModel) {
        let model = PaletteModel(frame: frame)
        // 12vh of the window, as `mt-[12vh]` puts it.
        let top = (FrameSheets.window(for: frame)?.contentView?.bounds.height ?? 820) * 0.12
        FrameSheets.present(frame, top: top) { close in
            CommandPaletteView(model: model, close: close)
        }
    }
}

struct CommandPaletteView: View {
    @Bindable var model: PaletteModel
    let close: @MainActor () -> Void
    @Environment(\.colorScheme) private var scheme
    @FocusState private var fieldFocused: Bool

    private func s(_ id: String) -> WebComputedStyle { moreStyle("more.palette.\(id)", scheme) }

    var body: some View {
        let list = s("list")
        let items = model.items
        VStack(spacing: 0) {
            field
            filters
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 0) {
                        status
                        caps(model.typed.isEmpty ? "Recent" : "Documents", style: s("caps"))
                        let docCount = items.filter(\.isNote).count
                        ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                            if i == docCount, !item.isNote { caps("Actions", style: s("heading")) }
                            if item.isMeaning, !(i > 0 && items[i - 1].isMeaning) { caps("By meaning", style: s("heading")) }
                            row(item, selected: i == model.active)
                                .id(item.id)
                                .onHover { if $0 { model.active = i } }
                                .onTapGesture { choose(item) }
                        }
                    }
                    .padding(list.padding.edgeInsets)
                }
                .frame(maxHeight: (FrameSheets.window(for: model.frame)?.contentView?.bounds.height ?? 820) * 0.55)
                .fixedSize(horizontal: false, vertical: true)
                .onChange(of: model.active) { _, i in if items.indices.contains(i) { proxy.scrollTo(items[i].id) } }
            }
        }
        .modifier(WebSheetPanel(style: WebStyles.named("more.palette")))
        .task {
            try? await Task.sleep(for: .milliseconds(60))
            fieldFocused = true
        }
        .onChange(of: model.search.text) { _, _ in model.active = 0 }
        .accessibilityIdentifier("sheet.palette")
    }

    private var field: some View {
        let bar = s("bar"), icon = s("icon"), input = s("input")
        return HStack(spacing: bar.gap) {
            WebIconView(.search, size: 18).foregroundStyle(icon.color.color)
            ZStack(alignment: .leading) {
                if model.search.text.isEmpty {
                    Text(verbatim: "Search documents or type a command…").webText(input.text).lineLimit(1).foregroundStyle(moreVar("color-ink-faint", scheme)).allowsHitTesting(false)
                }
                TextField("", text: $model.search.text)
                    .textFieldStyle(.plain)
                    .webText(input.text)
                    .lineLimit(1)
                    .offset(x: -1.125, y: 1.035)
                    .focused($fieldFocused)
                    .tint(input.color.color)
                    .onKeyPress(.downArrow) { model.move(1); return .handled }
                    .onKeyPress(.upArrow) { model.move(-1); return .handled }
                    .onSubmit { let items = model.items; if items.indices.contains(model.active) { choose(items[model.active]) } }
                    .accessibilityLabel("Search documents or type a command")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HelpKbdStyled(keys: "Esc", style: "more.palette.esc")
        }
        .padding(.horizontal, bar.padding.left)
        .frame(height: bar.height)
        .overlay(alignment: .bottom) { Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1) }
    }

    private var filters: some View {
        let bar = s("filters")
        let folders = flatten(model.search.folders, depth: 0)
        return HStack(spacing: bar.gap) {
            filter(label: model.search.folderName ?? "Any folder", options: [("", "Any folder")] + folders.map { ($0.0.id, String(repeating: "\u{00a0}\u{00a0}\u{00a0}", count: $0.1) + $0.0.name) }, selected: model.search.folderId ?? "") { model.search.folderId = $0.isEmpty ? nil : $0 }
            filter(label: model.search.tagName.map { "#\($0)" } ?? "Any tag", options: [("", "Any tag")] + model.search.tags.map { ($0.id, "#\($0.name)") }, selected: model.search.tagId ?? "") { model.search.tagId = $0.isEmpty ? nil : $0 }
            filter(label: model.search.updated?.title ?? "Any time", options: [("", "Any time")] + SearchUpdated.allCases.map { ($0.rawValue, $0.title) }, selected: model.search.updated?.rawValue ?? "") { model.search.updated = SearchUpdated(rawValue: $0) }
            Spacer(minLength: 0)
            Text(verbatim: model.search.spaceName).webText(s("place").text).lineLimit(1).foregroundStyle(s("place").color.color)
        }
        .padding(bar.padding.edgeInsets)
        .frame(height: bar.height)
        .overlay(alignment: .bottom) { Rectangle().fill(moreVar("color-line", scheme)).frame(height: 1) }
    }

    private func flatten(_ nodes: [FolderNode], depth: Int) -> [(FolderNode, Int)] {
        // The tree's rows are flat with parents; children follow their parent in order.
        var out: [(FolderNode, Int)] = []
        func walk(_ parent: String?, _ d: Int) {
            for n in nodes where n.parentId == parent {
                out.append((n, d))
                walk(n.id, d + 1)
            }
        }
        walk(nil, depth)
        return out
    }

    private func filter(label: String, options: [(String, String)], selected: String, onSelect: @escaping @MainActor (String) -> Void) -> some View {
        let f = WebStyles.named("more.palette.filter")
        let fs = f.resolve(scheme), l = s("filter.label"), c = s("filter.chevron")
        return WebMenuButton(width: 224, entries: {
            options.map { o in WebMenuEntry(.item(o.1, checked: o.0 == selected, id: "f:\(o.0)")) { onSelect(o.0) } }
        }) {
            HStack(spacing: fs.gap) {
                Text(verbatim: label).webText(l.text).lineLimit(1)
                WebIconView(.chevronDown, size: 14).opacity(c.opacity)
            }
            .foregroundStyle(fs.color.color)
            .padding(fs.padding.edgeInsets)
            .frame(height: fs.height)
            .webBox(f)
            .contentShape(Rectangle())
        }
    }

    @ViewBuilder
    private var status: some View {
        let muted = moreVar("color-ink-muted", scheme)
        if !model.typed.isEmpty, !model.answered {
            Text(verbatim: "Searching…").webText(.role(.subheadline)).foregroundStyle(muted).padding(.horizontal, 12).padding(.vertical, 8)
        } else if !model.typed.isEmpty, model.answered, model.search.result?.hits.isEmpty ?? true {
            Text(verbatim: "No documents match “\(model.typed)”.").webText(.role(.subheadline)).foregroundStyle(muted).padding(.horizontal, 12).padding(.vertical, 8)
        }
    }

    private func caps(_ title: String, style: WebComputedStyle) -> some View {
        Text(verbatim: title.uppercased()).webText(style.text).lineLimit(1).foregroundStyle(style.color.color)
            .padding(style.padding.edgeInsets)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ item: PaletteModel.Item, selected: Bool) -> some View {
        let base = WebStyles.named(selected ? "more.palette.option.on" : "more.palette.option")
        let r = base.resolve(scheme)
        let icon = s("option.icon")
        let label = s(selected ? "option.on.label" : "option.label")
        let hint = s("option.hint")
        return HStack(alignment: .top, spacing: r.gap) {
            switch item {
            case .note(_, let title, let snippet, let updatedAt, _, _):
                WebIconView(.fileText, size: 16).foregroundStyle(icon.color.color).frame(width: 20).padding(.top, icon.margin.top)
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: title.isEmpty ? "Untitled" : title).webText(.role(.subheadline, weight: 500)).lineLimit(1)
                    if let snippet {
                        Text(verbatim: snippet).webText(.role(.footnote)).lineLimit(2).foregroundStyle(moreVar("color-ink-muted", scheme))
                    } else if let updatedAt {
                        Text(verbatim: "Edited \(AgeText.relative(Date(timeIntervalSince1970: updatedAt / 1000)))").webText(.role(.footnote)).lineLimit(1).foregroundStyle(moreVar("color-ink-faint", scheme))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if selected { WebIconView(.arrowRight, size: 14).padding(.top, 4) }
            case .action(_, let title, let h, let i, let ai, _):
                Group {
                    if ai { WebAiMark(size: 16) } else if let i { WebIconView(i, size: 16) }
                }
                .foregroundStyle(icon.color.color)
                .frame(width: icon.width, height: icon.height)
                .padding(.top, icon.margin.top)
                Text(verbatim: title).webText(label.text).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                if let h { Text(verbatim: h).webText(hint.text).lineLimit(1).foregroundStyle(hint.color.color) }
            }
        }
        .foregroundStyle(r.color.color)
        .padding(r.padding.edgeInsets)
        .frame(maxWidth: .infinity, minHeight: r.height, alignment: .topLeading)
        .webBox(base)
        .contentShape(Rectangle())
    }

    private func choose(_ item: PaletteModel.Item) {
        close()
        model.run(item)
    }
}

/// A key cap in a computed style.
struct HelpKbdStyled: View {
    let keys: String
    let style: String
    var body: some View {
        let pair = WebStyles.named(style)
        Text(verbatim: keys).webText(pair.light.text).lineLimit(1).fixedSize().webElement(pair)
    }
}
#endif
