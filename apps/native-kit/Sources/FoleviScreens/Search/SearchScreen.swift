// Search (plan 5.7; web app/CommandPalette.tsx and the iPhone search): the field (focused on open), the scopes
// (this space, everywhere, by meaning) and filters as capsules that open menus, recent searches and notes before
// typing, then results by type with the matched words marked. On iPad and Mac the arrow keys move through the
// results, Return opens, Escape closes. iPhone shows it full screen; iPad and Mac in a centred panel (the frame's
// container, Command-K); `showsCancel` adds Cancel beside the field for frames without a bar.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct SearchScreen: View {
    @Bindable var model: SearchModel
    let showsCancel: Bool
    @FocusState private var focused: Bool
    @Environment(\.screenNavigator) private var navigator
    private let send = IntentSender()

    public init(model: SearchModel, showsCancel: Bool = true) {
        self.model = model
        self.showsCancel = showsCancel
    }

    public var body: some View {
        VStack(spacing: 0) {
            field.padding(.horizontal, 16).padding(.top, 10)
            scopes.padding(.top, 6)
            Rectangle().fill(Folevi.color.line).frame(height: 1).padding(.top, 4)
            results
        }
        .background(Folevi.color.canvas)
        .onAppear {
            model.setVisible(true)
            focused = true
        }
        .onDisappear { model.setVisible(false) }
        .accessibilityIdentifier("search-screen")
    }

    // MARK: Field

    private var field: some View {
        HStack(spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.inkFaint).accessibilityHidden(true)
                TextField(model.prompt, text: $model.text)
                    .textFieldStyle(.plain)
                    .foleviFont(.body)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .onSubmit { openSelectedOrFirst() }
                    .onKeyPress(.downArrow) { model.moveSelection(1); return .handled }
                    .onKeyPress(.upArrow) { model.moveSelection(-1); return .handled }
                    .onKeyPress(.escape) { send(.dismiss); return .handled }
                    .accessibilityIdentifier("search-field")
                if model.searching {
                    ProgressView().controlSize(.small)
                } else if !model.text.isEmpty {
                    Button { model.text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Folevi.color.inkFaint) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 40)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
            if showsCancel {
                Button("Cancel") { send(.dismiss) }
                    .buttonStyle(.plain)
                    .foleviFont(.body)
                    .foregroundStyle(Folevi.color.ink)
                    .accessibilityIdentifier("search-cancel")
            }
        }
    }

    // MARK: Scopes and filters

    private var scopes: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                capsule(model.spaceName, on: model.scope == .place) { model.scope = .place }
                    .accessibilityIdentifier("search-scope-place")
                if model.offersEverywhere {
                    capsule("Everywhere", on: model.scope == .everywhere) { model.scope = .everywhere }
                        .accessibilityIdentifier("search-scope-everywhere")
                }
                if model.offersMeaning {
                    capsule("By meaning", symbol: "sparkle", on: model.scope == .meaning) { model.scope = .meaning }
                        .accessibilityIdentifier("search-scope-meaning")
                }
                Rectangle().fill(Folevi.color.line).frame(width: 1, height: 20)
                filterMenu("Folder", chosen: model.folderName, disabled: !model.filtersAllowed || model.folders.isEmpty) {
                    Button("Any folder") { model.folderId = nil }
                    Divider()
                    ForEach(model.folders, id: \.id) { f in
                        Button { model.folderId = f.id } label: { Text(String(repeating: "   ", count: f.depth) + f.name) }
                    }
                }
                filterMenu("Tag", chosen: model.tagName.map { "#\($0)" }, disabled: !model.filtersAllowed || model.tags.isEmpty) {
                    Button("Any tag") { model.tagId = nil }
                    Divider()
                    ForEach(model.tags, id: \.id) { t in Button("#\(t.name)") { model.tagId = t.id } }
                }
                filterMenu("Updated", chosen: model.updated?.title, disabled: false) {
                    Button("Any time") { model.updated = nil }
                    Divider()
                    ForEach(SearchUpdated.allCases, id: \.self) { u in Button(u.title) { model.updated = u } }
                }
                capsule("Archived", symbol: "archivebox", on: model.includeArchived) { model.includeArchived.toggle() }
                    .accessibilityLabel(model.includeArchived ? "Including archived notes" : "Include archived notes")
                if model.hasFilters {
                    Button("Clear") { model.clearFilters() }.buttonStyle(.folevi(.ghost, size: .small))
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func capsule(_ title: String, symbol: String? = nil, on: Bool, action: @escaping () -> Void) -> some View {
        Button {
            model.feedback.haptic(.selection)
            action()
        } label: {
            HStack(spacing: 4) {
                if let symbol { Image(systemName: symbol).font(.system(size: 12, weight: .semibold)) }
                Text(title).lineLimit(1)
            }
            .foleviFont(.callout)
            .fontWeight(on ? .medium : .regular)
            .foregroundStyle(on ? Folevi.color.canvas : Folevi.color.ink)
            .padding(.horizontal, 13)
            .frame(minHeight: 32)
            .background(Capsule().fill(on ? Folevi.color.heading : Folevi.color.ink.opacity(0.065)))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
    }

    private func filterMenu<C: View>(_ label: String, chosen: String?, disabled: Bool, @ViewBuilder content: () -> C) -> some View {
        Menu(content: content) {
            HStack(spacing: 4) {
                Text(chosen ?? label).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).opacity(chosen != nil ? 0.7 : 1)
            }
            .foleviFont(.callout)
            .fontWeight(chosen != nil ? .medium : .regular)
            .foregroundStyle(chosen != nil ? Folevi.color.canvas : Folevi.color.ink)
            .padding(.leading, 13)
            .padding(.trailing, 10)
            .frame(minHeight: 32)
            .background(Capsule().fill(chosen != nil ? Folevi.color.heading : Folevi.color.ink.opacity(0.065)))
            .frame(maxWidth: 200, minHeight: 44)
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(chosen.map { "\(label): \($0)" } ?? label)
    }

    // MARK: Results

    private var results: some View {
        let sections = model.sections
        let selected = model.selectedItem
        let query = model.text
        return ScrollViewReader { proxy in
            List {
                if model.offline && !model.text.isEmpty {
                    Label("Showing what's on this device. Folevi will search everything when it's back.", systemImage: "icloud.slash")
                        .foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                        .padding(.horizontal, 20).padding(.vertical, 8)
                        .plainRow()
                }
                ForEach(sections) { section in
                    Section {
                        ForEach(section.items) { item in
                            SearchRowView(item: item, query: query, today: model.session.value?.today ?? TaskDates.today(), selected: item == selected) { open(item) }
                                .id(item.id)
                                .plainRow()
                                .swipeActions(edge: .trailing) {
                                    if case .recentSearch(let s) = item {
                                        Button(role: .destructive) { model.forget(s) } label: { Label("Remove", systemImage: "trash") }
                                    }
                                }
                        }
                    } header: {
                        HStack {
                            Text(section.title).foleviFont(.caps).foregroundStyle(Folevi.color.inkFaint)
                            Spacer()
                            if section.id == "recent-searches" {
                                Button("Clear") { model.clearRecents() }.buttonStyle(.plain).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 14)
                        .padding(.bottom, 4)
                        .listRowInsets(EdgeInsets())
                        .background(Folevi.color.canvas)
                    }
                }
                if model.noResults {
                    EmptyState(systemImage: "magnifyingglass", title: "No results for \u{201C}\(model.text.trimmingCharacters(in: .whitespaces))\u{201D}", message: model.hasFilters ? "Try without the filters." : (model.scope == .place && model.offersEverywhere ? "Try searching everywhere." : nil))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 50)
                        .plainRow()
                }
                if sections.isEmpty && model.text.isEmpty {
                    EmptyState(systemImage: "magnifyingglass", title: "Search your notes", message: "Titles, words in notes, files and drawings.")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 50)
                        .plainRow()
                }
                Color.clear.frame(height: 60).plainRow()
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 1)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.selection) { _, _ in
                if let id = model.selectedItem?.id { proxy.scrollTo(id) }
            }
        }
    }

    private func openSelectedOrFirst() {
        if let item = model.selectedItem ?? model.flatItems.first { open(item) }
    }

    private func open(_ item: SearchItem) {
        let action = model.action(for: item)
        if case .fill(let s) = action {
            model.text = s
            return
        }
        model.remember()
        switch action {
        case .route(let r): navigator.open(r, nil)
        case .intent(let i): send(i)
        case .fill: break
        }
    }
}

/// A result row: what it is (a note's page glyph, a folder, a task box), its title, the matched words with the
/// match marked (two lines), and where it is and when it was edited.
struct SearchRowView: View {
    let item: SearchItem
    let query: String
    let today: String
    let selected: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 12) {
                leading.frame(width: 24, height: 24).padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text(SearchModel.highlighted(title, query: query)).foleviFont(.body).foregroundStyle(Folevi.color.ink).lineLimit(1)
                    if let snippet, !snippet.isEmpty {
                        Text(SearchModel.highlighted(snippet, query: query)).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).lineLimit(2)
                    }
                    if let meta, !meta.isEmpty {
                        Text(meta).foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .frame(minHeight: 48)
            .background(selected ? Folevi.color.selection.opacity(0.7) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("search-row-\(item.id)")
    }

    @ViewBuilder private var leading: some View {
        switch item {
        case .note(let h): Image(systemName: h.matchIn == "file" ? "doc.richtext" : (h.matchIn == "meaning" ? "sparkle" : "doc.text")).foregroundStyle(Folevi.color.inkMuted)
        case .recentNote: Image(systemName: "doc.text").foregroundStyle(Folevi.color.inkMuted)
        case .folder(let f): FolderGlyph(colorId: f.color, size: 18)
        case .task(let t): TaskBox(status: t.status, size: 16)
        case .recentSearch: Image(systemName: "clock.arrow.circlepath").foregroundStyle(Folevi.color.inkFaint)
        }
    }

    private var title: String {
        switch item {
        case .note(let h): h.title.isEmpty ? "Untitled" : h.title
        case .recentNote(let r): r.title.isEmpty ? "Untitled" : r.title
        case .folder(let f): f.name
        case .task(let t): t.title.isEmpty ? "Untitled task" : t.title
        case .recentSearch(let s): s
        }
    }

    private var snippet: String? {
        switch item {
        case .note(let h): h.snippet
        default: nil
        }
    }

    private var meta: String? {
        let now = ScreenClock.now()
        switch item {
        case .note(let h):
            var parts: [String] = []
            if let s = h.spaceName { parts.append(s) }
            if let f = h.folder { parts.append(f.name) }
            if h.matchIn == "file" { parts.append(h.page.map { "In a file, page \($0)" } ?? "In a file") }
            if h.archived { parts.append("Archived") }
            if h.updatedAt > 0 { parts.append(AgeText.age(Date(timeIntervalSince1970: h.updatedAt / 1000), now: now)) }
            return parts.joined(separator: " · ")
        case .recentNote(let r):
            return [r.folder?.name, AgeText.age(Date(timeIntervalSince1970: r.updatedAt / 1000), now: now)].compactMap { $0 }.joined(separator: " · ")
        case .folder(let f):
            return f.noteCount.map { $0 == 1 ? "1 note" : "\($0) notes" }
        case .task(let t):
            return TaskFacts.line(t, today: today, showNote: true, onDay: false)
        case .recentSearch:
            return nil
        }
    }
}

private extension View {
    func plainRow() -> some View {
        listRowInsets(EdgeInsets()).listRowSeparator(.hidden).listRowBackground(Folevi.color.canvas)
    }
}
