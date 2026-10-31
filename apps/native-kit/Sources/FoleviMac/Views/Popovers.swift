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
        let s = model.sync.value
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SyncStatusView(s?.indicator ?? .syncing())
                Text(s?.headline ?? "Connecting…").foleviFont(.bodyStrong).foregroundStyle(Folevi.color.heading)
            }
            Text(s?.detail ?? "Folevi is starting.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
            if let s, s.pending > 0 {
                Text("\(s.pending) waiting on this Mac").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
            }
            if let spaces = s?.spaces, let d = spaces.first(where: { $0.state == .downloading }), let total = d.total, total > 0 {
                ProgressView(value: Double(d.have), total: Double(total)) { Text("Downloading notes to this Mac").foleviFont(.caption) }
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

/// The toasts as the web draws them (components/ui/Toast.tsx, "more.toast.*"): a pill at the bottom, the message
/// (13 pt medium), an optional action in a soft capsule and a Dismiss cross. Neutral toasts are the accent
/// (black on light, white on dark), success and error their soft colours with the ink.
struct ToastStack: View {
    let model: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let region = moreStyle("more.toast.region", scheme)
        VStack(spacing: region.gap) {
            ForEach(model.toasts.suffix(4)) { t in toast(t) }
        }
        .frame(maxWidth: 448)
        // 16 pt from the window's bottom (bottom-4), the content card ending its own margin above it.
        .padding(.bottom, 16 - WebStyles.named("frame.content").light.y)
        .foleviAnimation(value: model.toasts.map(\.id))
        .accessibilityIdentifier("toasts")
    }

    private func toast(_ t: FrameToast) -> some View {
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
            if let title = t.actionTitle {
                Button { model.runToastAction(t) } label: {
                    Text(verbatim: title).webText(text.text.weight(600)).lineLimit(1)
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(Capsule().fill(ink.opacity(0.14)))
                }
                .buttonStyle(.plain)
            }
            Button { model.dismissToast(t.id) } label: {
                WebIconView(.x, size: 14).opacity(close.opacity).frame(width: close.width, height: close.height).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .foregroundStyle(ink)
        .padding(p.padding.edgeInsets)
        .frame(maxWidth: 448)
        .background(RoundedRectangle(cornerRadius: p.radius, style: .circular).fill(fill))
        .webBox(WebStylePair(light: Self.clear(pill.light), dark: Self.clear(pill.dark)))
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }

    /// The pill's shadows without its (tone's) fill.
    private static func clear(_ s: WebComputedStyle) -> WebComputedStyle {
        var c = s
        c.background = RGBA(0, 0, 0, 0)
        return c
    }
}
#endif
