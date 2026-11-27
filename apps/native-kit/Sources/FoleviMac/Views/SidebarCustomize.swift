// Customize sidebar (the owner, 2026-11-27; the web's SidebarCustomize.tsx): the app's own sidebar items, each with a
// checkbox (checked: on the sidebar; unchecked: under More), in their order. A drag reorders them; so do each row's
// Move up and Move down buttons and VoiceOver's actions, and Reset to default goes back to the default layout. Home
// and Drafts are always shown. Every change is saved at once (SidebarLayoutStore), so Done only closes the sheet.
//
// A sheet on the frame's window on the Mac, in the system's controls (a bordered list, checkboxes), as its other
// dialogs (FrameSheets.swift); opened from the Customize row at the end of More, an item's right-click menu, and a
// right click on the sidebar's empty space.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

extension SidebarItemID {
    /// The page the row opens.
    var route: FrameRoute {
        switch self {
        case .home: .home
        case .ai: .web("/ai")
        case .dna: .web("/graph")
        case .bookmarks: .notes(.starred)
        case .drafts: .notes(.unsorted)
        case .notes: .notes(.all)
        case .tasks: .tasks(.today)
        case .calendar: .calendar(nil)
        case .reviews: .web("/review")
        case .shared: .shared
        case .vault: .web("/vault")
        case .changes: .changes
        case .templates: .notes(.templates)
        }
    }

    /// Whether this person has the item here (Sidebar.tsx `available`): Foli AI when it's on, Foli DNA where this
    /// place has it, Reviews once there's something to study (and while it's open), Shared with Me and Changes where
    /// the place shares, the Vault where there's one.
    @MainActor
    func available(in model: FrameModel) -> Bool {
        let caps = model.session.value?.capabilities
        switch self {
        case .ai: return caps?.ai ?? false
        case .dna: return caps?.graph ?? false
        case .reviews:
            let due = model.home.value?.rows.first { $0.id == .reviews }?.count ?? 0
            return due > 0 || model.route.tabKey == FrameRoute.web("/review").tabKey
        case .shared: return caps?.sharing ?? false
        case .vault:
            guard let v = VaultSidebarStores.summary(model.client).value else { return false }
            return v.state != .none
        case .changes: return caps?.changes ?? false
        default: return true
        }
    }
}

@MainActor
enum SidebarCustomize {
    /// Opens Customize sidebar on the frame's window.
    static func present(_ model: FrameModel) {
        FrameSheets.present(model) { close in
            SidebarCustomizeSheet(model: model, close: close)
        }
    }

    /// The right-click menu's entry.
    static func entry(_ model: FrameModel) -> WebMenuEntry {
        WebMenuEntry(.item("Customize sidebar…", icon: .slidersHorizontal, id: "customize-sidebar")) { present(model) }
    }

    /// An item's right-click menu (Sidebar.tsx itemMenu): Move to More or Move to sidebar, then Customize sidebar.
    static func menu(_ model: FrameModel, _ id: SidebarItemID) -> [WebMenuEntry] {
        let store = model.sidebarLayout
        if id.locked {
            return [WebMenuEntry(.item("Always on the sidebar", id: "sidebar-locked"), disabled: true), .separator(1), entry(model)]
        }
        let more = store.slots.first { $0.id == id }?.more ?? false
        return [
            WebMenuEntry(.item(more ? "Move to sidebar" : "Move to More", id: "sidebar-move")) { store.save(SidebarLayout.move(store.slots, id, more: !more)) },
            .separator(1),
            entry(model),
        ]
    }

    /// What VoiceOver says after a move (the web's live region).
    static func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}

struct SidebarCustomizeSheet: View {
    let model: FrameModel
    let close: @MainActor () -> Void

    /// The items listed: the ones this person has here, in their order.
    static func items(_ model: FrameModel) -> [SidebarSlot] {
        model.sidebarLayout.slots.filter { $0.id.available(in: model) }
    }

    /// The list's rows are as tall as the sidebar's.
    static let rowHeight: CGFloat = 30

    var body: some View {
        let store = model.sidebarLayout
        let slots = Self.items(model)
        let shown = slots.map(\.id)
        return WebSheetDialog(title: "Customize sidebar", description: "Checked items show on the sidebar. The rest are under More. Drag to reorder.", width: 420, close: close) {
            List {
                ForEach(Array(slots.enumerated()), id: \.element.id) { i, s in
                    SidebarCustomizeRow(slot: s, first: i == 0, last: i == slots.count - 1) { on in
                        store.save(SidebarLayout.move(store.slots, s.id, more: !on))
                        SidebarCustomize.announce(on ? "\(s.id.title) on the sidebar" : "\(s.id.title) under More")
                    } step: { by in
                        store.save(SidebarLayout.step(store.slots, s.id, by: by, shown: shown))
                        let at = i + by
                        SidebarCustomize.announce("\(s.id.title) moved \(by < 0 ? "up" : "down"), \(at + 1) of \(slots.count)")
                    }
                }
                .onMove { from, to in
                    var ids = shown
                    ids.move(fromOffsets: from, toOffset: to)
                    store.save(SidebarLayout.reorder(store.slots, shown: ids))
                    if let moved = from.first, let at = ids.firstIndex(of: shown[moved]) {
                        SidebarCustomize.announce("\(shown[moved].title) moved, \(at + 1) of \(ids.count)")
                    }
                }
            }
            #if os(macOS)
            .listStyle(.bordered)
            .alternatingRowBackgrounds(.disabled)
            #else
            .listStyle(.plain)
            .environment(\.editMode, .constant(.active))
            #endif
            .frame(height: min(CGFloat(slots.count), 10) * (Self.rowHeight + 2) + 10)
            .accessibilityLabel("Sidebar items")
        } footer: {
            WebSheetFooter {
                WebSheetButton(title: "Reset to default") {
                    store.save(nil)
                    SidebarCustomize.announce("Sidebar reset to default")
                }
                WebSheetButton(title: "Done", primary: true, action: close)
            }
        }
    }
}

/// One item: its checkbox (with the item's symbol and name), "Always shown" or "Under More", Move up and Move down.
struct SidebarCustomizeRow: View {
    let slot: SidebarSlot
    let first: Bool
    let last: Bool
    let toggle: (Bool) -> Void
    let step: (Int) -> Void

    var body: some View {
        let id = slot.id
        let on = Binding(get: { !slot.more }, set: { toggle($0) })
        HStack(spacing: MacLook.Space.s) {
            Toggle(isOn: on) {
                HStack(spacing: MacLook.rowIconGap) {
                    MacSymbol(id.symbol, size: MacLook.rowSymbolSize)
                        .foregroundStyle(MacLook.Colors.secondary)
                        .frame(width: MacLook.rowIconSlot)
                        .accessibilityHidden(true)
                    Text(id.title).font(MacLook.Text.body).foregroundStyle(MacLook.Colors.label).lineLimit(1)
                }
            }
            #if os(macOS)
            .toggleStyle(.checkbox)
            #endif
            .disabled(id.locked)
            .accessibilityLabel(id.title)
            .accessibilityValue(Self.place(slot))
            Spacer(minLength: MacLook.Space.s)
            if id.locked || slot.more {
                Text(id.locked ? "Always shown" : "Under More")
                    .font(MacLook.Text.small).foregroundStyle(MacLook.Colors.secondary)
                    .accessibilityHidden(true)
            }
            stepButton("chevron.up", label: "Move \(id.title) up", enabled: !first) { step(-1) }
            stepButton("chevron.down", label: "Move \(id.title) down", enabled: !last) { step(1) }
        }
        .frame(minHeight: SidebarCustomizeSheet.rowHeight)
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Move up") { if !first { step(-1) } }
        .accessibilityAction(named: "Move down") { if !last { step(1) } }
    }

    /// Where VoiceOver says the item is.
    static func place(_ slot: SidebarSlot) -> String {
        slot.id.locked ? "Always on the sidebar" : slot.more ? "Under More" : "On the sidebar"
    }

    private func stepButton(_ symbol: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            MacSymbol(symbol, size: 11, weight: .semibold)
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .foregroundStyle(MacLook.Colors.secondary)
        .disabled(!enabled)
        .foleviTooltip(label)
        .accessibilityLabel(label)
    }
}
#endif
