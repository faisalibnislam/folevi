import SwiftUI

/// One row of a menu (the web's MenuItem): a label, an optional icon, shortcut, second line, quiet detail,
/// a check for a choice among several, danger red, or disabled.
struct FoleviMenuItem {
    enum Icon {
        case symbol(String)
        case view(AnyView)
    }
    var title: String
    var icon: Icon?
    var shortcut: String?
    var description: String?
    var detail: String?
    /// nil: a plain action; true/false: one of several choices (a check shows on the chosen one).
    var checked: Bool?
    var danger = false
    var disabled = false
    var action: () -> Void

    init(_ title: String, systemImage: String? = nil, shortcut: String? = nil, description: String? = nil, detail: String? = nil,
         checked: Bool? = nil, danger: Bool = false, disabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.icon = systemImage.map { .symbol($0) }
        self.shortcut = shortcut
        self.description = description
        self.detail = detail
        self.checked = checked
        self.danger = danger
        self.disabled = disabled
        self.action = action
    }

    init<V: View>(_ title: String, icon: V, shortcut: String? = nil, description: String? = nil, detail: String? = nil,
                  checked: Bool? = nil, danger: Bool = false, disabled: Bool = false, action: @escaping () -> Void) {
        self.init(title, shortcut: shortcut, description: description, detail: detail, checked: checked, danger: danger,
                  disabled: disabled, action: action)
        self.icon = .view(AnyView(icon))
    }
}

/// A menu entry: an item, a small caps heading over a group, or a separator.
enum FoleviMenuEntry {
    case item(FoleviMenuItem)
    case heading(String)
    case separator
}

/// The web's MenuPanel: glass pop, padding 6, min width 224; rows 32pt, radius 6, 13.5pt; arrow keys move,
/// Return chooses, Escape closes.
struct FoleviMenuList: View {
    var entries: [FoleviMenuEntry]
    var minWidth: CGFloat = 224
    var width: CGFloat?
    var close: () -> Void
    @State private var active: Int?
    @FocusState private var focused: Bool

    private var actionable: [Int] {
        entries.indices.filter { if case .item(let i) = entries[$0] { return !i.disabled } else { return false } }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.offset) { idx, entry in
                switch entry {
                case .separator:
                    FoleviColor.line.frame(height: 1).padding(.horizontal, 8).padding(.vertical, 6).accessibilityHidden(true)
                case .heading(let text):
                    Text(text).foleviCapsLabel().padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 4)
                        .accessibilityHidden(true)
                case .item(let item):
                    FoleviMenuRow(item: item, highlighted: active == idx) {
                        close()
                        item.action()
                    } hover: { on in
                        if on { active = idx } else if active == idx { active = nil }
                    }
                }
            }
        }
        .padding(6)
        .frame(minWidth: width ?? minWidth, maxWidth: width, alignment: .leading)
        .fixedSize(horizontal: width == nil, vertical: true)
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onAppear { focused = true }
        .onKeyPress(.downArrow) { step(1) }
        .onKeyPress(.upArrow) { step(-1) }
        .onKeyPress(.return) {
            guard let active, case .item(let item) = entries[active] else { return .ignored }
            close()
            item.action()
            return .handled
        }
        .accessibilityElement(children: .contain)
    }

    private func step(_ delta: Int) -> KeyPress.Result {
        let list = actionable
        guard !list.isEmpty else { return .ignored }
        let at = active.flatMap { list.firstIndex(of: $0) } ?? (delta > 0 ? -1 : list.count)
        active = list[(at + delta + list.count) % list.count]
        return .handled
    }
}

private struct FoleviMenuRow: View {
    var item: FoleviMenuItem
    var highlighted: Bool
    var run: () -> Void
    var hover: (Bool) -> Void

    var body: some View {
        Button(action: run) {
            HStack(spacing: 10) {
                switch item.icon {
                case .symbol(let name):
                    Image(systemName: name).font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(item.danger ? FoleviColor.destructive : FoleviColor.inkMuted)
                        .frame(width: 16).accessibilityHidden(true)
                case .view(let v):
                    v.frame(minWidth: 16).accessibilityHidden(true)
                case nil:
                    EmptyView()
                }
                if let description = item.description {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.title).lineLimit(1)
                        Text(description).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(item.title).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                }
                if let detail = item.detail { Text(detail).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted) }
                if let shortcut = item.shortcut { Text(shortcut).font(.ui(12)).foregroundStyle(FoleviColor.inkFaint) }
                if item.checked == true {
                    Image(systemName: "checkmark").font(.system(size: 11.5, weight: .bold)).foregroundStyle(FoleviColor.heading)
                        .accessibilityHidden(true)
                }
            }
            .font(.ui(13.5))
            .foregroundStyle(item.danger ? FoleviColor.destructive : highlighted ? FoleviColor.heading : FoleviColor.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, item.description == nil ? 0 : 5)
            .frame(minHeight: 32)
            .background(highlighted ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.disabled)
        .opacity(item.disabled ? 0.4 : 1)
        .onHover(perform: hover)
        .accessibilityLabel(Text(item.title))
        .accessibilityValue(Text([item.description, item.detail].compactMap { $0 }.joined(separator: " · ")))
        .accessibilityAddTraits(item.checked == true ? .isSelected : [])
    }
}

/// The web's MenuButton: a trigger (an "…" by default) that opens a menu in a popover.
struct FoleviMenuButton<Trigger: View>: View {
    var label: String
    var arrowEdge: Edge = .bottom
    var menuWidth: CGFloat?
    var entries: () -> [FoleviMenuEntry]
    @ViewBuilder var trigger: (_ open: Bool) -> Trigger
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: { trigger(open) }
            .buttonStyle(.chrome)
            .help(Text(label))
            .accessibilityLabel(Text(label))
            .foleviPopover(isPresented: $open, arrowEdge: arrowEdge) {
                FoleviMenuList(entries: entries(), width: menuWidth) { open = false }
            }
    }
}

extension FoleviMenuButton where Trigger == FoleviMenuTrigger {
    /// The default "…" trigger: 32pt, radius 6, muted; hover and open tint it.
    init(label: String, systemImage: String = "ellipsis", size: CGFloat = 32, arrowEdge: Edge = .bottom,
         entries: @escaping () -> [FoleviMenuEntry]) {
        self.label = label
        self.arrowEdge = arrowEdge
        self.entries = entries
        self.trigger = { open in FoleviMenuTrigger(systemImage: systemImage, size: size, open: open) }
    }
}

/// A square icon trigger: muted, accent-soft on hover or while its menu is open.
struct FoleviMenuTrigger: View {
    var systemImage: String
    var size: CGFloat = 32
    var open = false
    @State private var hover = false

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(open || hover ? FoleviColor.heading : FoleviColor.inkMuted)
            .frame(width: size, height: size)
            .background(open || hover ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
            .onHover { hover = $0 }
    }
}
