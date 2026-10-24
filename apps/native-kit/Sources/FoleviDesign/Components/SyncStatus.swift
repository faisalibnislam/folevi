// The sync status (docs/SYNC_PROTOCOL.md, web SyncStatus.tsx): a cloud with a status dot, and a label that is
// always present for VoiceOver (never colour alone). Saved = moss, saving/syncing = ember pulsing,
// offline = faint, conflict/error = coral.
import SwiftUI

public enum SyncIndicator: Hashable, Sendable {
    case saved
    case saving
    case syncing(progress: String? = nil)
    case offline(waiting: Int)
    case conflict
    case error(String? = nil)

    public var label: String {
        switch self {
        case .saved: "Saved"
        case .saving: "Saving"
        case .syncing(let progress): progress ?? "Syncing"
        case .offline(let n): n > 0 ? "Offline, \(n) waiting" : "Offline"
        case .conflict: "Conflict"
        case .error(let message): message ?? "Couldn't sync"
        }
    }

    var dot: Color {
        switch self {
        case .saved: Folevi.color.moss
        case .saving, .syncing: Folevi.color.ember
        case .offline: Folevi.color.inkFaint
        case .conflict, .error: Folevi.color.coral
        }
    }

    var pulses: Bool {
        switch self {
        case .saving, .syncing: true
        default: false
        }
    }

    var symbol: String {
        switch self {
        case .offline: "icloud.slash"
        case .conflict, .error: "exclamationmark.icloud"
        default: "icloud"
        }
    }
}

/// The small icon (bars, sidebar bottom). `showsLabel` adds the text, as the pill under Home's title.
public struct SyncStatusView: View {
    let state: SyncIndicator
    let showsLabel: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    public init(_ state: SyncIndicator, showsLabel: Bool = false) {
        self.state = state
        self.showsLabel = showsLabel
    }

    public var body: some View {
        HStack(spacing: 6) {
            Image(systemName: state.symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Folevi.color.inkMuted)
                .overlay(alignment: .bottomTrailing) {
                    // Dots are rounded squares too (nothing fully round outside the glass).
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(state.dot)
                        .frame(width: 6.5, height: 6.5)
                        .overlay(RoundedRectangle(cornerRadius: 2.5, style: .continuous).stroke(Folevi.color.canvas, lineWidth: 1.5))
                        .opacity(state.pulses && pulse ? 0.35 : 1)
                        .offset(x: 2, y: 1)
                }
            if showsLabel {
                Text(state.label).foleviFont(.caption).foregroundStyle(Folevi.color.inkMuted).lineLimit(1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.label)
        .onAppear { startPulse() }
        .onChange(of: state) { startPulse() }
    }

    private func startPulse() {
        guard state.pulses, !reduceMotion else { pulse = false; return }
        withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulse = true }
    }
}
