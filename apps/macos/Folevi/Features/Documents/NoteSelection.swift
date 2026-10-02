import AppKit
import SwiftUI

/// One button in the selection bar.
struct SelectionBarAction: Identifiable {
    var title: String
    var systemImage: String
    var danger = false
    var run: () -> Void
    var id: String { title }
}

/// The floating bar shown while notes are selected (the web's SelectionBar): how many, the actions for
/// them, "Select all" and a way out (× or Escape).
struct SelectionBar: View {
    var count: Int
    var total: Int
    var actions: [SelectionBarAction]
    var onSelectAll: () -> Void
    var onClear: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            Text(count == 1 ? String(localized: "1 selected") : String(localized: "\(count.formatted()) selected"))
                .font(.ui(13, .semibold))
                .foregroundStyle(FoleviColor.heading)
                .padding(.horizontal, 10)
                .accessibilityAddTraits(.updatesFrequently)
            if count < total {
                BarButton(title: String(localized: "Select all"), systemImage: nil, muted: true, action: onSelectAll)
            }
            divider
            ForEach(actions) { a in
                BarButton(title: a.title, systemImage: a.systemImage, danger: a.danger, action: a.run)
            }
            divider
            BarButton(title: nil, systemImage: "xmark", muted: true, action: onClear)
                .help(Text("Clear selection (Esc)"))
                .accessibilityLabel(Text("Clear selection"))
        }
        .padding(6)
        .foleviPop(radius: 14)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Selected notes"))
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var divider: some View {
        Rectangle().fill(FoleviColor.line).frame(width: 1, height: 24).padding(.horizontal, 4)
    }

    private struct BarButton: View {
        var title: String?
        var systemImage: String?
        var danger = false
        var muted = false
        var action: () -> Void
        @State private var hovering = false

        var body: some View {
            Button(action: action) {
                HStack(spacing: 6) {
                    if let systemImage { Image(systemName: systemImage).font(.system(size: 13, weight: .medium)).accessibilityHidden(true) }
                    if let title { Text(title).lineLimit(1) }
                }
                .font(.ui(13, .medium))
                .foregroundStyle(danger ? FoleviColor.destructive : muted && !hovering ? FoleviColor.inkMuted : hovering ? FoleviColor.heading : FoleviColor.ink)
                .padding(.horizontal, title == nil ? 0 : 10)
                .frame(minWidth: 36)
                .frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(hovering ? (danger ? FoleviColor.destructive.opacity(0.1) : FoleviColor.accentSoft) : .clear))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
        }
    }
}

/// The ring and check on a selected card (and the selected look of a list row).
struct SelectedCardMark: ViewModifier {
    var selected: Bool
    var radius: CGFloat = 6

    func body(content: Content) -> some View {
        content
            .overlay {
                if selected {
                    // ring-2 ring-heading ring-offset-4: a 2 pt ring 4 pt outside the card.
                    RoundedRectangle(cornerRadius: radius + 6, style: .continuous)
                        .strokeBorder(FoleviColor.heading, lineWidth: 2)
                        .padding(-6)
                        .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .topLeading) {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(FoleviColor.canvas)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(FoleviColor.heading))
                        .shadow(color: .black.opacity(0.2), radius: 3, y: 2)
                        .offset(x: -8, y: -8)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

extension View {
    func selectedCard(_ selected: Bool, radius: CGFloat = 6) -> some View { modifier(SelectedCardMark(selected: selected, radius: radius)) }

    /// ⌘A selects every note shown and Escape clears the selection, while this view's window is key and
    /// nothing is being typed (the web's useCardSelection keys).
    func noteSelectionKeys(enabled: Bool, hasSelection: Bool, selectAll: @escaping () -> Void, clear: @escaping () -> Void) -> some View {
        background(SelectionKeyMonitor(enabled: enabled, hasSelection: hasSelection, selectAll: selectAll, clear: clear))
    }
}

/// Watches key presses in its own window: ⌘A and Escape, unless a text field or sheet has them.
private struct SelectionKeyMonitor: NSViewRepresentable {
    var enabled: Bool
    var hasSelection: Bool
    var selectAll: () -> Void
    var clear: () -> Void

    final class Coordinator {
        var parent: SelectionKeyMonitor
        var monitor: Any?
        weak var view: NSView?
        init(_ parent: SelectionKeyMonitor) { self.parent = parent }
        deinit { if let monitor { NSEvent.removeMonitor(monitor) } }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        context.coordinator.view = view
        let coordinator = context.coordinator
        context.coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak coordinator] event in
            guard let coordinator, let window = coordinator.view?.window, event.window === window,
                  window.attachedSheet == nil, coordinator.parent.enabled else { return event }
            // Typing in a field (or the editor) keeps its own ⌘A and Escape.
            if window.firstResponder is NSText || window.firstResponder is NSTextView { return event }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == 53, flags.isEmpty, coordinator.parent.hasSelection {
                MainActor.assumeIsolated { coordinator.parent.clear() }
                return nil
            }
            if flags == .command, event.charactersIgnoringModifiers?.lowercased() == "a" {
                MainActor.assumeIsolated { coordinator.parent.selectAll() }
                return nil
            }
            return event
        }
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleNSView(_ view: NSView, coordinator: Coordinator) {
        if let monitor = coordinator.monitor { NSEvent.removeMonitor(monitor) }
        coordinator.monitor = nil
    }
}

// MARK: - Move to folder

/// Picks a folder (or Drafts) to move notes into (the web's MoveToFolderDialog): a search field over the
/// folders, ↑/↓ to choose, Return to move. The folder the notes are already in is marked and can't be picked.
struct MoveToFolderSheet: View {
    var count: Int
    var noteTitle: String?
    /// Where the notes are now: a folder id, nil for Drafts, or unknown (`.none`) when they're in different places.
    var currentFolderId: String??
    var onPick: (FolderTarget) -> Void
    @Environment(AppModel.self) private var app
    @DialogDismiss private var dismiss
    @State private var query = ""
    @State private var active = 0
    @FocusState private var fieldFocused: Bool

    private struct Option: Identifiable, Hashable {
        var id: String?
        var name: String
        var color: String?
        var parent: String?
        var nested: Bool
        var key: String { id ?? "drafts" }
    }

    private var options: [Option] {
        let folders = app.sidebar.folders
        let names = Dictionary(folders.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let ordered = folders.filter { $0.parentFolderId == nil }.flatMap { f in [f] + folders.filter { $0.parentFolderId == f.id } }
        let all = [Option(id: nil, name: String(localized: "No folder (Drafts)"), color: nil, parent: nil, nested: false)]
            + ordered.map { Option(id: $0.id, name: $0.name, color: $0.color, parent: $0.parentFolderId.flatMap { names[$0] }, nested: $0.parentFolderId != nil) }
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return all }
        return all.filter { $0.name.lowercased().contains(needle) || ($0.id == nil && "drafts".contains(needle)) }
    }

    private func isCurrent(_ o: Option) -> Bool {
        guard let current = currentFolderId else { return false }
        return o.id == current
    }

    var body: some View {
        let list = options
        let current = min(active, max(0, list.count - 1))
        // The web's MoveToFolderDialog: the small dialog with a description, a search field and the folders
        // as a list (no Cancel: Escape or the × closes it).
        FoleviDialogShell(title: String(localized: "Move to folder"),
                          description: count == 1 ? String(localized: "Choose where “\((noteTitle ?? "").isEmpty ? String(localized: "Untitled") : noteTitle ?? "")” should live.")
                                                  : String(localized: "Choose where \(count.formatted()) notes should live."),
                          size: .sm, onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
                    TextField("Search folders", text: $query)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .focused($fieldFocused)
                        .onSubmit { pick(list.indices.contains(current) ? list[current] : nil) }
                        .onChange(of: query) { _, _ in active = 0 }
                        .onKeyPress(.downArrow) { active = list.isEmpty ? 0 : (current + 1) % list.count; return .handled }
                        .onKeyPress(.upArrow) { active = list.isEmpty ? 0 : (current - 1 + list.count) % list.count; return .handled }
                }
                .padding(.leading, 12)
                .padding(.trailing, 12)
                .frame(height: 40)
                .foleviInputSurface(focused: fieldFocused)
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(Array(list.enumerated()), id: \.element.key) { i, o in
                                row(o, highlighted: i == current)
                                    .id(o.key)
                                    .onHover { if $0 { active = i } }
                            }
                            if list.isEmpty {
                                Text("No folders match “\(query.trimmingCharacters(in: .whitespaces))”.")
                                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 8).padding(.vertical, 12)
                            }
                        }
                    }
                    // As tall as the folders, up to 360pt (max-h-[min(360px,50dvh)]).
                    .frame(height: list.isEmpty ? 44 : min(360, CGFloat(list.count) * 34 - 2))
                    .onChange(of: current) { _, c in if list.indices.contains(c) { proxy.scrollTo(list[c].key) } }
                }
            }
        }
        .claimsFocus($fieldFocused)
    }

    private func row(_ o: Option, highlighted: Bool) -> some View {
        let here = isCurrent(o)
        return Button { pick(o) } label: {
            HStack(spacing: 9) {
                if o.id != nil {
                    FolderGlyph(color: o.color, size: 17)
                } else {
                    Image(systemName: "tray").font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).frame(width: 17)
                }
                Text(o.name).font(.ui(13.5)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                if let parent = o.parent, !query.isEmpty {
                    Text("in \(parent)").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                }
                Spacer(minLength: 4)
                if here {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                        Text("Current")
                    }
                    .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                }
            }
            .padding(.leading, o.nested && query.isEmpty ? 32 : 10)
            .padding(.trailing, 10)
            .frame(height: 32)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(highlighted && !here ? FoleviGlass.hover : .clear))
            .opacity(here ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(here)
        .accessibilityAddTraits(highlighted ? .isSelected : [])
    }

    private func pick(_ o: Option?) {
        guard let o, !isCurrent(o) else { return }
        dismiss()
        onPick(o.id == nil ? .drafts : FolderTarget(id: o.id, name: o.name))
    }
}

// MARK: - Delete permanently

/// One trashed note, deleted for good after its title is typed back (the web's PermanentDeleteDialog).
struct PermanentDeleteSheet: View {
    var documentId: String
    var title: String
    @Environment(AppModel.self) private var app
    @DialogDismiss private var dismiss
    @State private var typed = ""
    @State private var busy = false

    private var expected: String {
        let t = title.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? String(localized: "Untitled") : t
    }

    var body: some View {
        FoleviDialog(title: String(localized: "Delete permanently?"),
                     message: String(localized: "“\(expected)”, its nested pages, attachments and version history will be deleted for everyone. This can’t be undone. Type the title to confirm."),
                     confirmTitle: String(localized: "Delete permanently"),
                     confirmDisabled: typed.trimmingCharacters(in: .whitespaces) != expected, busy: busy, onConfirm: delete) {
            TypeToConfirmField(expected: expected, text: $typed, label: String(localized: "Document title"))
        }
    }

    private func delete() {
        guard let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await session.documents.deletePermanently(documentId, confirmTitle: typed)
                app.showToast(String(localized: "Deleted permanently"))
                await session.engine.syncNow()
                dismiss()
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}
