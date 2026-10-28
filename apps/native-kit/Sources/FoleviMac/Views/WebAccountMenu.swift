// The account and place menu at the foot of the sidebar, drawn as the web's (components/app/WorkspaceMenu.tsx,
// owner decisions in docs/MULTI_ACCOUNT_PLAN.md): a quiet "Places" label; each account a 52 pt row (its picture or
// initial, the name over the email), the open account's workspaces under it as 32 pt rows with their plan and
// "New workspace..."; the library "On this Mac" with where it syncs; one check column for where you are. Then
// Settings (⌘,), Sign in to another account..., Move or copy notes..., Help; then Sign out of <name>. About 300
// wide, opening up from the account button without covering it. Styles: "acct.*" (gates.json, the live web).
// Keyboard: arrows, Return, Escape, type to select; a click outside closes it.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine

/// One row of the account menu.
struct AccountMenuRow: Identifiable {
    enum Kind { case heading, place, sub, item, separator }
    enum Mark {
        case none
        case icon(WebIcon)
        /// A person or workspace: its picture, or its initial on the heading colour.
        case avatar(name: String, url: String?, size: CGFloat)
        /// The library: the Mac on a quiet tile.
        case library
        case plus
    }

    var id: String
    var kind: Kind
    var title = ""
    var detail: String?
    var mark: Mark = .none
    var checked = false
    var shortcut: String?
    var badge = 0
    var dot = false
    var disabled = false
    var action: @MainActor () -> Void = {}

    var selectable: Bool { (kind == .place || kind == .sub || kind == .item) && !disabled }
}

@MainActor
enum AccountMenuRows {
    /// The rows for the window's place now (WorkspaceMenu.tsx placeEntries and actionEntries).
    static func build(model: FrameModel) -> [AccountMenuRow] {
        let session = model.session.value
        let places = model.places.value
        let current = places?.current ?? session?.place
        let rows = places?.places ?? []
        let host = model.host
        var out: [AccountMenuRow] = [AccountMenuRow(id: "h:places", kind: .heading, title: "Places")]
        let here = rows.first { $0.id == current }
        let local = session?.mode == .local || here?.kind == .library
        var accounts = rows.filter { $0.kind == .account }
        // The open account always shows, first when the list doesn't have it yet.
        if !local, let s = session, !accounts.contains(where: { $0.id == current }) {
            accounts.insert(PlaceRow(id: current ?? "here", kind: .account, name: s.profile.name, email: s.profile.email, avatarUrl: s.profile.avatarUrl, syncs: nil, workspaces: [], unread: 0, reminders: 0, waiting: 0), at: 0)
        }
        for p in accounts {
            let isHere = !local && p.id == (current ?? "here")
            let name = p.name.isEmpty ? (p.email ?? "Folevi account") : p.name
            if isHere, let s = session {
                let personal = s.spaces.first { $0.kind == .personal }?.id ?? "personal"
                out.append(AccountMenuRow(id: "place:\(p.id)", kind: .place, title: s.profile.name.isEmpty ? (s.profile.email.isEmpty ? "Personal" : s.profile.email) : s.profile.name, detail: s.profile.email.isEmpty ? nil : s.profile.email, mark: .avatar(name: s.profile.name.isEmpty ? s.profile.email : s.profile.name, url: s.profile.avatarUrl, size: 36), checked: s.space == personal) { model.switchSpace(personal) })
                for w in s.spaces where w.kind == .workspace {
                    let plan = p.workspaces.first { $0.id == w.id }?.planName
                    out.append(AccountMenuRow(id: "ws:\(w.id)", kind: .sub, title: w.name, detail: plan, mark: .avatar(name: w.name, url: p.workspaces.first { $0.id == w.id }?.logoUrl, size: 20), checked: s.space == w.id) { model.switchSpace(w.id) })
                }
                out.append(AccountMenuRow(id: "ws:new", kind: .sub, title: "New workspace\u{2026}", mark: .plus) { host?.frameOpenSettings(section: "workspace-new") })
                continue
            }
            out.append(AccountMenuRow(id: "place:\(p.id)", kind: .place, title: name, detail: p.name.isEmpty ? nil : p.email, mark: .avatar(name: name, url: p.avatarUrl, size: 36), badge: p.unread, dot: p.reminders > 0) { host?.frameSwitchPlace(p.id, space: nil) })
            for w in p.workspaces {
                out.append(AccountMenuRow(id: "ws:\(p.id):\(w.id)", kind: .sub, title: w.name, mark: .avatar(name: w.name, url: w.logoUrl, size: 20)) { host?.frameSwitchPlace(p.id, space: w.id) })
            }
        }
        if let lib = rows.first(where: { $0.kind == .library }) {
            out.append(AccountMenuRow(id: "place:library", kind: .place, title: "On this Mac", detail: lib.syncs ?? "On your devices", mark: .library, checked: local, dot: !local && (lib.reminders > 0 || lib.waiting > 0)) {
                if !local { host?.frameSwitchPlace(lib.id, space: nil) }
            })
        } else if local {
            out.append(AccountMenuRow(id: "place:library", kind: .place, title: "On this Mac", detail: "On your devices", mark: .library, checked: true))
        }
        out.append(AccountMenuRow(id: "sep:1", kind: .separator))
        out.append(AccountMenuRow(id: "settings", kind: .item, title: "Settings", mark: .icon(.settings), shortcut: "\u{2318},") { host?.frameOpenSettings(section: nil) })
        out.append(AccountMenuRow(id: "signin", kind: .item, title: "Sign in to another account\u{2026}", mark: .icon(.logIn)) { host?.frameSignInAnotherAccount() })
        if rows.contains(where: { $0.id != current }) {
            out.append(AccountMenuRow(id: "move", kind: .item, title: "Move or copy notes\u{2026}", mark: .icon(.arrowRightLeft)) { host?.frameMoveOrCopy() })
        }
        out.append(AccountMenuRow(id: "help", kind: .item, title: "Help", mark: .icon(.circleQuestionMark)) { host?.frameOpenHelp() })
        if !local, let place = current {
            out.append(AccountMenuRow(id: "sep:2", kind: .separator))
            let name = model.accountName.isEmpty ? "this account" : (session?.profile.name.isEmpty == false ? session!.profile.name : model.accountName)
            out.append(AccountMenuRow(id: "signout", kind: .item, title: "Sign out of \(name)", mark: .icon(.logOut)) { host?.frameSignOut(place: place) })
        }
        return out
    }
}

@MainActor
@Observable
final class AccountMenuState {
    var highlighted: String?
    let rows: [AccountMenuRow]
    init(_ rows: [AccountMenuRow]) { self.rows = rows }
    var selectable: [AccountMenuRow] { rows.filter(\.selectable) }

    func move(_ step: Int) {
        let list = selectable
        guard !list.isEmpty else { return }
        let i = list.firstIndex { $0.id == highlighted }.map { ($0 + step + list.count) % list.count } ?? (step > 0 ? 0 : list.count - 1)
        highlighted = list[i].id
    }
}

/// The panel (the web's .ui-pop "switcher" menu).
struct AccountMenuPanel: View {
    @Bindable var state: AccountMenuState
    let pick: (AccountMenuRow) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let panel = WebStyles.named("acct.menu")
        let p = panel.resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(state.rows) { row in rowView(row) }
        }
        .padding(p.padding.edgeInsets)
        .frame(width: p.width, alignment: .topLeading)
        // The web blurs the sidebar behind its translucent panel; under it here, the sidebar's own colour (what that
        // blur comes to over the solid sidebar).
        .background(RoundedRectangle(cornerRadius: p.radius, style: .continuous).fill((WebStyles.vars["color-sidebar"]?.resolve(scheme) ?? RGBA(255, 255, 255)).color))
        .webBox(panel)
        .onContinuousHover { phase in if case .ended = phase { state.highlighted = nil } }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("account-menu")
    }

    @ViewBuilder private func rowView(_ row: AccountMenuRow) -> some View {
        switch row.kind {
        case .heading:
            let h = gst("acct.caps")
            Text(row.title.uppercased()).webText(h.text).lineLimit(1).foregroundStyle(h.color.color)
                .padding(h.padding.edgeInsets).frame(maxWidth: .infinity, alignment: .leading)
        case .separator:
            let sep = gst("acct.sep")
            Rectangle().fill(sep.background.color).frame(height: sep.height).padding(sep.margin.edgeInsets)
        case .place, .sub, .item:
            item(row)
        }
    }

    private func gst(_ id: String) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

    private func item(_ row: AccountMenuRow) -> some View {
        let base = gst(row.kind == .place ? "acct.place" : "acct.item")
        let hl = WebStyles.named("menu.item.highlighted").resolve(scheme)
        let on = state.highlighted == row.id
        let label = gst("acct.item.label")
        let name = gst("acct.place.name")
        let detail = gst("acct.place.detail")
        return Button { pick(row) } label: {
            HStack(spacing: row.kind == .place ? base.gap : gst("acct.item").gap) {
                markView(row.mark)
                VStack(alignment: .leading, spacing: 0) {
                    if row.kind == .place {
                        Text(row.title).webText(name.text).lineLimit(1).truncationMode(.tail).foregroundStyle(name.color.color)
                        if let d = row.detail { Text(d).webText(detail.text).lineLimit(1).truncationMode(.middle).foregroundStyle(detail.color.color).padding(.top, detail.margin.top) }
                    } else {
                        Text(row.title).webText(label.text).lineLimit(1).foregroundStyle(label.color.color)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if row.kind == .sub, let d = row.detail {
                    Text(d).webText(gst("acct.item.shortcut").text).lineLimit(1).foregroundStyle(detail.color.color)
                }
                if row.badge > 0 {
                    Text(row.badge > 99 ? "99+" : "\(row.badge)").webText(gst("acct.item.shortcut").text).lineLimit(1).foregroundStyle(detail.color.color)
                } else if row.dot {
                    Circle().fill(name.color.color).frame(width: 6, height: 6)
                }
                if let k = row.shortcut {
                    let sc = gst("acct.item.shortcut")
                    Text(k).webText(sc.text).lineLimit(1).foregroundStyle(sc.color.color).padding(.leading, sc.padding.left - (gst("acct.item").gap))
                }
                if row.kind != .item {
                    let check = gst("acct.place.check")
                    WebIconView(.check, size: 16).frame(width: check.width, height: check.width).foregroundStyle(check.color.color).opacity(row.checked ? 1 : 0)
                }
            }
            .padding(base.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: base.height, maxHeight: base.height, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: base.radius, style: .continuous).fill(on ? hl.background.color : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(GatePressStyle())
        .disabled(row.disabled)
        .opacity(row.disabled ? 0.4 : 1)
        .onHover { if $0 { state.highlighted = row.id } }
        .accessibilityLabel(row.detail.map { "\(row.title), \($0)" } ?? row.title)
        .accessibilityAddTraits(row.checked ? .isSelected : [])
        .accessibilityIdentifier("account.\(row.id)")
    }

    @ViewBuilder private func markView(_ m: AccountMenuRow.Mark) -> some View {
        let icon = gst("acct.item.icon")
        switch m {
        case .none: EmptyView()
        case .icon(let i): WebIconView(i, size: 16).frame(width: icon.width, height: icon.height).foregroundStyle(icon.color.color)
        case .plus: WebIconView(.plus, size: 14).frame(width: 20, height: 20).foregroundStyle(icon.color.color)
        case .library:
            let tile = gst("acct.place.tile")
            WebIconView(.laptop, size: 18).frame(width: tile.width, height: tile.height).foregroundStyle(tile.color.color)
                .background(RoundedRectangle(cornerRadius: tile.radius, style: .continuous).fill(tile.background.color))
        case .avatar(let name, let url, let size): WebAvatar(name: name, url: url, size: size)
        }
    }
}

/// WorkspaceMenu.tsx Mark: the picture, or the initial on the heading colour (rounded-chip, 46% type).
struct WebAvatar: View {
    let name: String
    let url: String?
    let size: CGFloat
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let heading = WebStyles.vars["color-heading"]?.resolve(scheme) ?? RGBA(11, 11, 12)
        let canvas = WebStyles.vars["color-canvas"]?.resolve(scheme) ?? RGBA(255, 255, 255)
        let letter = name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "\u{00B7}"
        let initial = Text(letter).font(Font(WebFont.ctFont(.sans, size: (size * 0.46).rounded(), weight: 600))).foregroundStyle(canvas.color)
            .frame(width: size, height: size).background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(heading.color))
        if let url, let u = URL(string: url), u.scheme == "https" {
            AsyncImage(url: u) { phase in
                if let image = phase.image { image.resizable().scaledToFill().frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous)) } else { initial }
            }
            .frame(width: size, height: size)
        } else {
            initial
        }
    }
}

/// A borderless panel holding the account menu, above its window.
@MainActor
public final class AccountMenuWindow: NSPanel {
    private static weak var current: AccountMenuWindow?
    private var monitors: [Any] = []
    private let state: AccountMenuState
    static let margin: CGFloat = 32
    /// On the left only as much room as there is to the window's edge (the web's shadow stops there too, and the
    /// panel never pokes out of the window).
    static var leading: CGFloat { min(margin, WebStyles.named("acct.menu").light.x) }

    private init(rows: [AccountMenuRow]) {
        state = AccountMenuState(rows)
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .popUpMenu
        isReleasedWhenClosed = false
        let host = NSHostingView(rootView: AccountMenuPanel(state: state) { [weak self] r in self?.pick(r) }.padding(EdgeInsets(top: Self.margin, leading: Self.leading, bottom: Self.margin, trailing: Self.margin)))
        host.safeAreaRegions = []
        contentView = host
        setContentSize(host.fittingSize)
    }

    override public var canBecomeKey: Bool { true }

    /// Opens the menu for `model` in `window`, its bottom-left corner where the web puts it (8 pt above the
    /// account button, at its left edge).
    @discardableResult
    public static func show(model: FrameModel, in window: NSWindow) -> AccountMenuWindow {
        current?.close()
        let menu = AccountMenuWindow(rows: AccountMenuRows.build(model: model))
        let m = WebStyles.named("acct.menu").light
        let trigger = WebStyles.named("acct.trigger").light
        // (Web coordinates from the top of a 820 pt window; the foot of the sidebar is pinned to the bottom.)
        _ = trigger
        let bottomInset = 820 - (m.y + m.height)
        let local = NSPoint(x: m.x, y: bottomInset)
        let screen = window.convertPoint(toScreen: local)
        var frame = menu.frame
        frame.origin = NSPoint(x: screen.x - leading, y: screen.y - margin)
        menu.setFrame(frame, display: false)
        menu.appearance = window.appearance
        window.addChildWindow(menu, ordered: .above)
        menu.makeKeyAndOrderFront(nil)
        menu.watch()
        current = menu
        return menu
    }

    public static var shown: AccountMenuWindow? { current?.isVisible == true ? current : nil }

    private func watch() {
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
            guard let self else { return event }
            if event.window !== self { self.close() }
            return event
        } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.isVisible else { return event }
            switch event.keyCode {
            case 53: self.close()
            case 125: self.state.move(1)
            case 126: self.state.move(-1)
            case 36, 76:
                if let id = self.state.highlighted, let r = self.state.selectable.first(where: { $0.id == id }) { self.pick(r) }
            default:
                if let c = event.charactersIgnoringModifiers?.lowercased().first, c.isLetter {
                    let list = self.state.selectable
                    let start = list.firstIndex { $0.id == self.state.highlighted }.map { $0 + 1 } ?? 0
                    let order = Array(list[start...] + list[..<start])
                    if let hit = order.first(where: { $0.title.lowercased().first == c }) { self.state.highlighted = hit.id }
                }
            }
            return nil
        } as Any)
    }

    private func pick(_ r: AccountMenuRow) {
        close()
        DispatchQueue.main.async { MainActor.assumeIsolated { r.action() } }
    }

    override public func close() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
        parent?.removeChildWindow(self)
        super.close()
    }
}
#endif
