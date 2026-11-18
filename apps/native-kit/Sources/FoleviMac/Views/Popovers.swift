// The sidebar foot's popovers (plan 3.9 and 5.6) and the window's toasts, in SwiftUI inside AppKit popovers and
// hosting views: the sync status (the web's states: Synced, Syncing, Waiting/Offline, Not saved, with Retry), the
// notifications list (mark read, open), and toasts with their Undo or the web page's button.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine

struct SyncPopover: View {
    let model: FrameModel

    var body: some View {
        #if os(macOS)
        mac
        #else
        drawn
        #endif
    }

    #if os(macOS)
    /// The Mac's: in an NSPopover, the system's type and colours: the state's symbol in its status colour, the
    /// headline, what it means, what's waiting, a download's progress, and Retry as the system's button.
    private var mac: some View {
        let s = model.sync.value
        let state = s?.indicator ?? .syncing()
        return VStack(alignment: .leading, spacing: MacLook.Space.s) {
            HStack(spacing: MacLook.Space.s) {
                Image(systemName: Self.symbol(state))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Self.tone(state))
                    .accessibilityHidden(true)
                Text(s?.headline ?? "Connecting…").font(MacLook.Text.headline).foregroundStyle(MacLook.Colors.label)
            }
            Text(s?.detail ?? "Folevi is starting.").font(MacLook.Text.body).foregroundStyle(MacLook.Colors.secondary).fixedSize(horizontal: false, vertical: true)
            if let s, s.pending > 0 {
                Text("\(s.pending) waiting on this \(ThisDevice.noun)").font(MacLook.Text.small).foregroundStyle(MacLook.Colors.tertiary)
            }
            if let spaces = s?.spaces, let d = spaces.first(where: { $0.state == .downloading }), let total = d.total, total > 0 {
                ProgressView(value: Double(d.have), total: Double(total)) { Text("Downloading notes to this \(ThisDevice.noun)").font(MacLook.Text.small) }
                    .tint(MacLook.Colors.accent)
            }
            if s?.canRetry == true {
                Button("Retry") { model.retrySync() }
                    .controlSize(.small)
                    .accessibilityIdentifier("sync.retry")
            }
        }
        .padding(MacLook.Space.l)
        .frame(width: 280, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("popover.sync")
    }

    static func symbol(_ state: SyncIndicator) -> String {
        switch state {
        case .saved: "checkmark.icloud"
        case .saving, .syncing: "arrow.triangle.2.circlepath.icloud"
        case .offline: "icloud.slash"
        case .conflict, .error: "exclamationmark.icloud"
        }
    }

    /// The system's status colours: green, orange, red; offline is quiet.
    static func tone(_ state: SyncIndicator) -> Color {
        switch state {
        case .saved: MacLook.Colors.green
        case .saving, .syncing: MacLook.Colors.orange
        case .offline: MacLook.Colors.secondary
        case .conflict, .error: MacLook.Colors.red
        }
    }
    #endif

    private var drawn: some View {
        let s = model.sync.value
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SyncStatusView(s?.indicator ?? .syncing())
                Text(s?.headline ?? "Connecting…").foleviFont(.bodyStrong).foregroundStyle(Folevi.color.heading)
            }
            Text(s?.detail ?? "Folevi is starting.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
            if let s, s.pending > 0 {
                Text("\(s.pending) waiting on this \(ThisDevice.noun)").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
            }
            if let spaces = s?.spaces, let d = spaces.first(where: { $0.state == .downloading }), let total = d.total, total > 0 {
                ProgressView(value: Double(d.have), total: Double(total)) { Text("Downloading notes to this \(ThisDevice.noun)").foleviFont(.caption) }
            }
            if s?.canRetry == true {
                Button("Retry") { model.retrySync() }.buttonStyle(.folevi(.secondary, size: .small))
                    .accessibilityIdentifier("sync.retry")
            }
        }
        .padding(16)
        .frame(width: 280, alignment: .leading)
        .accessibilityIdentifier("popover.sync")
    }
}

/// The toasts (components/ui/Toast.tsx): a pill at the bottom, the message, an optional action and a Dismiss cross.
/// On the Mac a small floating control in the system's type: regular glass, the status symbol in the system's
/// green or red, the action as a capsule button. On the iPad as the web draws them ("more.toast.*"): neutral toasts
/// the accent, success and error their soft colours with the ink.
struct ToastStack: View {
    let model: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let region = moreStyle("more.toast.region", scheme)
        VStack(spacing: region.gap) {
            ForEach(model.toasts.suffix(4)) { t in toast(t) }
        }
        .frame(maxWidth: 448)
        // 16 pt from the window's bottom (bottom-4), the content card ending its own margin above it; on a note,
        // above its floating page tools with a gap (the web's .ui-toasts there), so Undo never covers them.
        .padding(.bottom, Self.bottomInset(onNote: model.route.isNote))
        .foleviAnimation(value: model.toasts.map(\.id))
        .accessibilityIdentifier("toasts")
        .macClickThrough()
    }

    /// The pill's widest (the web's `max-w-md`): its padding inside it, so a long message wraps rather than pushing the
    /// pill past its edges (MAC-36).
    static let maxWidth: CGFloat = 448

    /// How far above the card's bottom the toasts sit: 16 pt from the window's bottom, or on a note clear of its
    /// floating page tools (their top about 80 pt up) with a gap: 96 pt, the web's 6rem (QA audit F22).
    static func bottomInset(onNote: Bool) -> CGFloat {
        (onNote ? noteDockClearance : 16) - WebStyles.named("frame.content").light.y
    }
    static let noteDockClearance: CGFloat = 96

    private func toast(_ t: FrameToast) -> some View {
        #if os(macOS)
        macToast(t)
        #else
        drawnToast(t)
        #endif
    }

    #if os(macOS)
    private func macToast(_ t: FrameToast) -> some View {
        HStack(spacing: MacLook.Space.s + 2) {
            switch t.tone {
            case .success: Image(systemName: "checkmark.circle.fill").foregroundStyle(MacLook.Colors.green).accessibilityHidden(true)
            case .error: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(MacLook.Colors.red).accessibilityHidden(true)
            case .info: EmptyView()
            }
            Text(verbatim: t.message).font(MacLook.Text.body).foregroundStyle(MacLook.Colors.label)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
            if let title = t.actionTitle {
                ToastControl(label: title) { model.runToastAction(t) }
            }
            ToastControl(symbol: "xmark", label: "Dismiss") { model.dismissToast(t.id) }
                .foleviTooltip("Dismiss")
        }
        // (The width is held before the padding, so the padding stays inside the 448 pt pill: MAC-36.)
        .frame(maxWidth: Self.maxWidth - 32)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.leading, MacLook.Space.l).padding(.trailing, MacLook.Space.s + 2).padding(.vertical, MacLook.Space.s + 2)
        .glassEffect(.regular, in: .capsule)
        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .offset(y: 8).combined(with: .opacity)))
        .accessibilityElement(children: .combine)
    }
    #endif

    private func drawnToast(_ t: FrameToast) -> some View {
        let pill = WebStyles.named("more.toast")
        let p = pill.resolve(scheme)
        let text = moreStyle("more.toast.text", scheme)
        let close = moreStyle("more.toast.close", scheme)
        let fill: Color, ink: Color
        switch t.tone {
        case .error: fill = moreVar("color-danger-soft", scheme); ink = moreVar("color-ink", scheme)
        case .success: fill = moreVar("color-success-soft", scheme); ink = moreVar("color-ink", scheme)
        case .info: fill = moreVar("color-accent-strong", scheme); ink = moreVar("color-accent-ink", scheme)
        }
        return HStack(spacing: p.gap) {
            Text(verbatim: t.message).webText(text.text).fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
            if let title = t.actionTitle {
                Button { model.runToastAction(t) } label: {
                    Text(verbatim: title).webText(text.text.weight(600)).lineLimit(1).fixedSize()
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(ink.opacity(0.14)))
                }
                .buttonStyle(.webHover(radius: 6))
            }
            Button { model.dismissToast(t.id) } label: {
                WebIconView(.x, size: 14).opacity(close.opacity).frame(width: close.width, height: close.height).contentShape(Rectangle())
            }
            .buttonStyle(.webHover(radius: 6))
            .accessibilityLabel("Dismiss")
        }
        .foregroundStyle(ink)
        // (The width is held before the padding, so the padding stays inside the 448 pt pill: MAC-36.)
        .frame(maxWidth: Self.maxWidth - p.padding.left - p.padding.right)
        .fixedSize(horizontal: false, vertical: true)
        .padding(p.padding.edgeInsets)
        .background(RoundedRectangle(cornerRadius: p.radius, style: .circular).fill(fill))
        .webBox(WebStylePair(light: Self.clear(pill.light), dark: Self.clear(pill.dark)))
        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .offset(y: 8).combined(with: .opacity)))
        .accessibilityElement(children: .combine)
    }

    /// The pill's shadows without its (tone's) fill.
    private static func clear(_ s: WebComputedStyle) -> WebComputedStyle {
        var c = s
        c.background = RGBA(0, 0, 0, 0)
        return c
    }
}
#if os(macOS)
/// A toast's action (a capsule with its title) or its Dismiss (an xmark), with the quaternary hover fill.
private struct ToastControl: View {
    var symbol: String?
    let label: String
    let action: () -> Void
    @State private var hovered = false

    init(symbol: String? = nil, label: String, action: @escaping () -> Void) {
        self.symbol = symbol
        self.label = label
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Group {
                if let symbol {
                    Image(systemName: symbol).font(.system(size: 10, weight: .semibold)).foregroundStyle(MacLook.Colors.secondary)
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(hovered ? MacLook.Colors.hover : .clear))
                } else {
                    Text(verbatim: label).font(MacLook.Text.body.weight(.semibold)).lineLimit(1).fixedSize()
                        .padding(.horizontal, 10).padding(.vertical, 3)
                        .background(Capsule().fill(MacLook.Colors.hover.opacity(hovered ? 1.6 : 1)))
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .accessibilityLabel(label)
    }
}
#endif
#endif
