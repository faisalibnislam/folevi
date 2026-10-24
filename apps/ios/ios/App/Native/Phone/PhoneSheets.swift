// Native sheets (plan 6.2): UISheetPresentationController with the medium and large detents, a grabber and the
// sheet radius (28), for the account and places switcher and the notifications (FoleviScreens' content, N11), Foli
// AI (a placeholder until N12) and the sync details. On an iPad they're popovers anchored to the bar item they came
// from.
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
enum PhoneSheets {
    /// Presents `content` as a sheet from the topmost controller over `from`.
    static func present<V: View>(_ content: V, from: UIViewController, id: String, detents: [UISheetPresentationController.Detent] = [.medium(), .large()], anchor: UIBarButtonItem? = nil, popoverSize: CGSize = CGSize(width: 380, height: 560)) {
        var top = from
        while let p = top.presentedViewController { top = p }
        let host = UIHostingController(rootView: content.environment(\.font, FoleviFonts.font(.ui, size: 17)))
        host.view.backgroundColor = Chrome.canvas
        host.view.accessibilityIdentifier = id
        if UIDevice.current.userInterfaceIdiom == .pad, from.traitCollection.horizontalSizeClass == .regular, let anchor {
            host.modalPresentationStyle = .popover
            host.preferredContentSize = popoverSize
            host.popoverPresentationController?.sourceItem = anchor
            top.present(host, animated: true)
            return
        }
        host.modalPresentationStyle = .pageSheet
        if let sheet = host.sheetPresentationController {
            sheet.detents = detents
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = FoleviTokens.Radius.sheet
            sheet.prefersScrollingExpandsWhenScrolledToEdge = true
        }
        top.present(host, animated: true)
    }
}

/// A sheet's heading row: the title in Spectral and a close button (44 pt).
private struct SheetHeader: View {
    let title: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        HStack {
            Text(title).foleviFont(.title2).foregroundStyle(DS.color.heading)
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(DS.color.inkMuted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
            .accessibilityIdentifier("sheet-close")
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.top, 14)
    }
}

// MARK: - Foli AI (N12 replaces it with the chat)

struct FoliAISheet: View {
    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: "Foli AI")
            Spacer()
            EmptyState(systemImage: "sparkle", title: "Ask Foli AI", message: "The Foli AI chat arrives here with the next update. In a note, the Foli AI button asks about that note.")
            Spacer()
        }
        .background(DS.color.canvas)
        .accessibilityIdentifier("foli-sheet")
    }
}

// MARK: - Sync details

struct SyncSheet: View {
    let phone: PhoneModel
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SheetHeader(title: "Sync")
            VStack(alignment: .leading, spacing: 14) {
                if let s = phone.sync.value {
                    HStack(spacing: 10) {
                        SyncStatusView(CardMapping.sync(s), showsLabel: true)
                        Spacer()
                    }
                    .accessibilityIdentifier("sync-state")
                    detail(s)
                    ForEach(s.spaces, id: \.space) { space in
                        if space.state != .ready {
                            HStack {
                                Text(space.state == .downloading ? "Downloading notes" : space.state == .locked ? "Locked on this device" : "Opening")
                                Spacer()
                                if let total = space.total { Text("\(space.have) of \(total)").monospacedDigit() }
                            }
                            .foleviFont(.callout).foregroundStyle(DS.color.inkMuted)
                        }
                    }
                    if s.state != .saved || s.pending > 0 {
                        Button { phone.retrySync() } label: { Text("Retry now").frame(maxWidth: .infinity) }
                            .buttonStyle(FoleviButtonStyle(.primary, fullWidth: true))
                            .accessibilityIdentifier("sync-retry")
                    }
                } else {
                    Text("Starting…").foleviFont(.body).foregroundStyle(DS.color.inkMuted)
                }
            }
            .padding(20)
            Spacer()
        }
        .background(DS.color.canvas)
    }

    @ViewBuilder private func detail(_ s: SyncStatusValue) -> some View {
        let text: String = {
            if s.authRequired { return "Sign in again to send your changes to Folevi." }
            switch s.state {
            case .saved: return s.pending == 0 ? "Everything on this iPhone is saved to Folevi." : "\(s.pending) changes are waiting to be sent."
            case .saving, .syncing: return "Sending your changes to Folevi."
            case .offline: return s.pending == 0 ? "You're offline. Changes you make are kept on this iPhone and sent when you're back online." : "You're offline. \(s.pending) \(s.pending == 1 ? "change is" : "changes are") kept on this iPhone until you're back online."
            case .conflict: return "\(s.conflicts) \(s.conflicts == 1 ? "note has" : "notes have") changes from two places. Open \(s.conflicts == 1 ? "it" : "them") to choose what to keep."
            case .error: return "Folevi couldn't send your changes. They're kept on this iPhone."
            }
        }()
        Text(text).foleviFont(.body).foregroundStyle(DS.color.ink).fixedSize(horizontal: false, vertical: true)
    }
}
