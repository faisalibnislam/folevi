// The sidebar foot's popovers (plan 3.9 and 5.6) and the window's toasts, in SwiftUI inside AppKit popovers and
// hosting views: the sync status (the web's states: Synced, Syncing, Waiting/Offline, Not saved, with Retry), the
// notifications list (mark read, open), and toasts with their Undo or the web page's button.
#if os(macOS)
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

struct ToastStack: View {
    let model: FrameModel

    var body: some View {
        VStack(spacing: 8) {
            ForEach(model.toasts) { t in
                HStack(spacing: 12) {
                    if t.tone == .error { Image(systemName: "exclamationmark.circle").foregroundStyle(Folevi.color.coral) }
                    Text(t.message).foleviFont(.callout).foregroundStyle(Folevi.color.ink).lineLimit(2)
                    if let title = t.actionTitle {
                        Button(title) { model.runToastAction(t) }.buttonStyle(.folevi(.ghost, size: .small))
                    }
                    Button { model.dismissToast(t.id) } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)) }
                        .buttonStyle(.plain).foregroundStyle(Folevi.color.inkMuted).accessibilityLabel("Dismiss")
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.regularMaterial))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Folevi.color.line, lineWidth: 0.5))
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.bottom, 16)
        .foleviAnimation(value: model.toasts.map(\.id))
        .accessibilityIdentifier("toasts")
    }
}
#endif
