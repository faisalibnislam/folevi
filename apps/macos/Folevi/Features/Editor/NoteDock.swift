import SwiftUI

/// The page tools, docked at the bottom of the note (the web's PageDock): AI, Insert, Format, Style and
/// Info, then after a divider the people on the page, Comments, Share and the page's "…" menu. Each tool
/// opens its panel floating just above the dock; pressing it again (or Escape, or ×) closes it.
struct NoteDock: View {
    @Bindable var nav: NavigationModel
    @Binding var aiOpen: Bool
    var aiAvailable: Bool
    /// The open note.
    var editor: EditorModel? = nil
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 2) {
            if aiAvailable {
                DockButton(title: "AI", isOn: aiOpen) { AiIcon(size: 16) } action: {
                    aiOpen.toggle()
                    if aiOpen { nav.showInspector = false }
                }
            }
            tool(.insert, "plus", iconSize: 15)
            tool(.format, "textformat", iconSize: 14)
            tool(.style, "paintbrush", iconSize: 14)
            tool(.info, "info.circle", iconSize: 14)
            if let editor {
                FoleviColor.line.frame(width: 1, height: 24).padding(.horizontal, 4).accessibilityHidden(true)
                PageDockExtras(editor: editor, nav: nav)
            }
        }
        // A thread that can't float under its block (whole note, deleted block, a link) opens in the panel.
        .opensCommentsPanel(editor: editor, nav: nav)
        .padding(6)
        .foleviGlassPop(radius: 14)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Page tools"))
    }

    private func toggle(_ tab: InspectorTab) {
        if nav.showInspector && nav.inspectorTab == tab {
            nav.showInspector = false
        } else {
            nav.inspectorTab = tab
            nav.showInspector = true
            aiOpen = false
        }
    }

    private func tool(_ tab: InspectorTab, _ systemImage: String, iconSize: CGFloat) -> some View {
        DockButton(title: tab.title, isOn: nav.showInspector && nav.inspectorTab == tab) {
            Image(systemName: systemImage).font(.system(size: iconSize, weight: .medium))
        } action: { toggle(tab) }
    }
}

/// One of the dock's tools: icon and label; the open one is inverted (heading fill, canvas text).
private struct DockButton<Icon: View>: View {
    var title: LocalizedStringKey
    var isOn: Bool
    @ViewBuilder var icon: () -> Icon
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                icon().frame(width: 17, height: 17)
                Text(title).font(.ui(13.5, .medium))
            }
            .foregroundStyle(isOn ? FoleviColor.canvas : hovering ? FoleviColor.heading : FoleviColor.ink)
            .padding(.horizontal, 16)
            .frame(height: 40)
            .background(isOn ? FoleviColor.heading : hovering ? FoleviColor.accentSoft : .clear,
                        in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}

/// The page's own actions in the dock: who else is here, Comments, Share and the "…" menu.
private struct PageDockExtras: View {
    @Bindable var editor: EditorModel
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app

    private var page: DocumentPageState { editor.page }
    private var unread: Bool { editor.comments.data?.hasUnreadOpen == true }

    var body: some View {
        HStack(spacing: 2) {
            PresenceAvatars(people: page.presence)
            DockIconButton(label: unread ? String(localized: "Comments (unread)") : String(localized: "Comments"),
                           isOn: nav.showInspector && nav.inspectorTab == .comments) {
                Image(systemName: "bubble.left").font(.system(size: 14, weight: .medium))
                    .overlay(alignment: .topTrailing) {
                        if unread {
                            Circle().fill(FoleviColor.heading).frame(width: 8, height: 8)
                                .overlay(Circle().strokeBorder(FoleviColor.canvas, lineWidth: 2))
                                .offset(x: 4, y: -4)
                        }
                    }
            } action: {
                // The Comments panel with every thread in the note (as ⌘⌥M off a block).
                editor.comments.panelThreadId = nil
                nav.inspectorTab = .comments
                nav.showInspector = true
            }
            if editor.detail != nil {
                DockIconButton(label: String(localized: "Share"), isOn: page.shareOpen) {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 14, weight: .medium))
                } action: { page.shareOpen.toggle() }
                // The web's Share dialog (a sheet over the window).
                .foleviDialog(isPresented: Bindable(page).shareOpen) {
                    SharePanel(documentId: editor.documentId, title: editor.document?.displayTitle ?? String(localized: "Untitled"),
                               personal: (editor.document?.workspaceId ?? "").isEmpty) { page.shareOpen = false }
                        .environment(app)
                }
                DockIconButton(label: String(localized: "Document actions"), isOn: page.moreOpen) {
                    Image(systemName: "ellipsis").font(.system(size: 14, weight: .semibold))
                } action: { page.moreOpen.toggle() }
                .foleviPopover(isPresented: Bindable(page).moreOpen, arrowEdge: .top, align: .end, gap: 8) {
                    PageMenuList(entries: PageActions.entries(editor: editor, nav: nav, app: app)) { page.moreOpen = false }
                        .environment(app)
                }
            }
        }
        .sheet(isPresented: Bindable(page).movePageOpen) {
            MovePageDialog(editor: editor).environment(app)
        }
        .noteDialogs(Bindable(page).dialog)
        .task(id: PresenceKey(documentId: editor.documentId, online: app.sync.isOnline, ready: editor.detail != nil)) { await presenceLoop() }
        .task(id: app.sync.isOnline) {
            // Came online after the page opened offline: fetch what the server knows about it.
            if app.sync.isOnline, editor.detail == nil { await editor.loadDetail() }
        }
    }

    private struct PresenceKey: Equatable {
        var documentId: String
        var online: Bool
        var ready: Bool
    }

    /// Heartbeats every 20 s with the focused block, and who else is here every 15 s; leaves on close.
    private func presenceLoop() async {
        guard let session = app.session, app.sync.isOnline, editor.detail != nil else {
            page.presence = []
            return
        }
        let id = editor.documentId
        let sessionId = page.presenceSession
        var tick = 0
        while !Task.isCancelled {
            if tick % 4 == 0 { try? await session.documents.heartbeat(id, sessionId: sessionId, focusedBlockId: editor.focusedBlockId == "__title__" ? nil : editor.focusedBlockId) }
            if tick % 3 == 0 {
                let now = (Date().timeIntervalSince1970 * 1000 / 15_000).rounded(.down) * 15_000
                if let people = try? await session.documents.presence(id, now: now) { page.presence = people }
            }
            tick += 1
            try? await Task.sleep(for: .seconds(5))
        }
        let s = session
        Task.detached { try? await s.documents.leave(id, sessionId: sessionId) }
    }
}

/// A 40pt quiet icon button in the dock.
private struct DockIconButton<Icon: View>: View {
    var label: String
    var isOn: Bool
    @ViewBuilder var icon: () -> Icon
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            icon()
                .foregroundStyle(hovering || isOn ? FoleviColor.heading : FoleviColor.ink)
                .frame(width: 40, height: 40)
                .background(isOn ? FoleviColor.accentSoft : hovering ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text(label))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// Up to four people also on the page: overlapping initials in their colour.
struct PresenceAvatars: View {
    var people: [PresencePerson]

    var body: some View {
        if !people.isEmpty {
            HStack(spacing: -6) {
                ForEach(people.prefix(4)) { p in
                    Text(p.name.prefix(1).uppercased())
                        .font(.ui(10, .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(Self.color(p.color)))
                        .overlay(Circle().strokeBorder(FoleviColor.canvas, lineWidth: 2))
                        .help(Text(p.name))
                }
            }
            .padding(.trailing, 4)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Also here: \(people.map(\.name).joined(separator: ", "))"))
        }
    }

    static func color(_ name: String) -> Color {
        switch name {
        case "moss": return FoleviColor.moss
        case "marigold": return FoleviColor.marigold
        case "plum": return FoleviColor.plum
        case "coral": return FoleviColor.coral
        default: return FoleviColor.accent
        }
    }
}
