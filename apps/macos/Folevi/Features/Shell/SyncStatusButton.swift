import SwiftUI

/// Honest sync status, as the web's SyncStatus (compact): a 32pt icon in the sidebar's top row (or the tab
/// strip while the sidebar is hidden). "Saved" only once the server has every change. A small dot carries
/// the state too (never colour alone: the icon and tooltip say it), offline shows how many changes wait,
/// and a click opens the details: what's happening, the pages still waiting, errors, Retry now.
struct SyncStatusButton: View {
    /// The open note, so a conflict count is about it.
    var documentId: String?
    /// Opens a page from the "Waiting to sync" list.
    var openDocument: ((String) -> Void)?
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var open = false
    @State private var hover = false
    @State private var pulse = false
    @State private var lastStatus: SyncStatus?

    private var snapshot: SyncSnapshot { app.sync }
    private var status: SyncStatus { snapshot.status }
    private var pending: Int { snapshot.pendingCount }
    private var busy: Bool { status == .saving || status == .syncing }

    var body: some View {
        Button { open.toggle() } label: {
            ZStack {
                icon
                Circle()
                    .fill(SyncStatusStyle.dot(status))
                    .frame(width: 8, height: 8)
                    .overlay(Circle().strokeBorder(FoleviColor.canvas, lineWidth: 2).padding(-2))
                    .opacity(busy && pulse ? 0.4 : 1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(.trailing, 6)
                    .padding(.bottom, 7)
                    .accessibilityHidden(true)
                if status == .offline && pending > 0 {
                    Text("\(pending)")
                        .font(.ui(9.5, .bold))
                        .monospacedDigit()
                        .foregroundStyle(FoleviColor.canvas)
                        .padding(.horizontal, 4)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.heading))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        .offset(x: 2, y: -2)
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(SyncStatusStyle.tone(status))
            .frame(width: 32, height: 32)
            .background(hover || open ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.chrome)
        .onHover { hover = $0 }
        .help(Text(SyncStatusStyle.label(status)))
        .accessibilityLabel(Text(accessibilityText))
        .accessibilityValue(Text(SyncStatusStyle.label(status)))
        .accessibilityIdentifier("syncStatusPill")
        .foleviPopover(isPresented: $open, arrowEdge: .bottom) {
            SyncDetailsPanel(documentId: documentId) { id in
                open = false
                openDocument?(id)
            }
            .environment(app)
        }
        .onChange(of: status, initial: true) { old, new in announce(from: lastStatus ?? old, to: new) }
        .onChange(of: busy, initial: true) { _, isBusy in
            guard !reduceMotion else { return }
            if isBusy {
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { pulse = true }
            } else {
                withAnimation(.easeOut(duration: 0.2)) { pulse = false }
            }
        }
    }

    @ViewBuilder private var icon: some View {
        switch status {
        case .saved: Image(systemName: "cloud").font(.system(size: 14.5, weight: .medium))
        case .offline: Image(systemName: "icloud.slash").font(.system(size: 12, weight: .medium))
        case .conflict: Image(systemName: "arrow.triangle.merge").font(.system(size: 12, weight: .medium))
        case .error: Image(systemName: "exclamationmark.triangle").font(.system(size: 12, weight: .medium))
        case .saving, .syncing: SyncSpinner(size: 12).foregroundStyle(FoleviColor.heading)
        }
    }

    /// "Sync status: Offline, 3 changes waiting".
    private var accessibilityText: String { SyncCopy.accessibilityLabel(status, pending: pending) }

    /// Announced politely, only on meaningful changes.
    private func announce(from prev: SyncStatus, to status: SyncStatus) {
        lastStatus = status
        guard prev != status else { return }
        let message: String?
        switch status {
        case .offline: message = String(localized: "You're offline. Changes are saved on this device.")
        case .conflict: message = String(localized: "A change conflicts with an edit made elsewhere. Review it in the document.")
        case .error: message = String(localized: "Some changes could not be saved.")
        case .saved where prev == .offline || prev == .error || prev == .conflict: message = String(localized: "All changes saved.")
        default: message = nil
        }
        if let message { AccessibilityNotification.Announcement(message).post() }
    }
}

/// Labels, colours and copy shared by the button and its panel (the words live in SyncCopy).
enum SyncStatusStyle {
    static func label(_ s: SyncStatus) -> String { SyncCopy.label(s) }

    /// Saved moss, offline faint, conflict and error coral, saving and syncing heading (pulsing).
    static func dot(_ s: SyncStatus) -> Color {
        switch s {
        case .saved: return FoleviColor.moss
        case .offline: return FoleviColor.inkFaint
        case .conflict, .error: return FoleviColor.coral
        case .saving, .syncing: return FoleviColor.heading
        }
    }

    static func tone(_ s: SyncStatus) -> Color {
        switch s {
        case .offline: return FoleviColor.warning
        case .conflict: return FoleviColor.plumInk
        case .error: return FoleviColor.destructive
        default: return FoleviColor.inkMuted
        }
    }

    static func detail(_ snap: SyncSnapshot, conflicts: Int) -> String {
        SyncCopy.detail(snap.status, pending: snap.pendingCount, conflicts: conflicts, authRequired: snap.authRequired)
    }

    static func describeError(_ code: String) -> String { SyncCopy.describeError(code) }
}

/// The web's Loader2: a three-quarter ring that turns (still when Reduce Motion is on).
struct SyncSpinner: View {
    var size: CGFloat = 12
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var turning = false

    var body: some View {
        Circle()
            .trim(from: 0.08, to: 0.85)
            .stroke(style: StrokeStyle(lineWidth: size * 0.15, lineCap: .round))
            .frame(width: size, height: size)
            .rotationEffect(.degrees(turning ? 360 : 0))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { turning = true }
            }
            .accessibilityHidden(true)
    }
}

/// "Sync details": the state, what it means, the pages still waiting, recent errors, Retry now and Dismiss.
private struct SyncDetailsPanel: View {
    var documentId: String?
    var openDocument: (String) -> Void
    @Environment(AppModel.self) private var app
    private static let listLimit = 6

    var body: some View {
        let snap = app.sync
        let docConflicts = documentId.map { id in snap.conflicts.filter { $0.documentId == id }.count } ?? snap.conflicts.count
        let conflictCount = docConflicts > 0 ? docConflicts : snap.conflicts.count
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Circle().fill(SyncStatusStyle.dot(snap.status)).frame(width: 8, height: 8).accessibilityHidden(true)
                Text(SyncStatusStyle.label(snap.status)).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading)
            }
            Text(SyncStatusStyle.detail(snap, conflicts: conflictCount))
                .font(.ui(13))
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 16)
                .padding(.top, 4)
            if !snap.pendingDocuments.isEmpty { pendingList(snap.pendingDocuments) }
            if !snap.errors.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(snap.errors.suffix(3).enumerated()), id: \.offset) { _, e in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("•")
                            Text(SyncStatusStyle.describeError(e.code)).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .font(.ui(12))
                .foregroundStyle(FoleviColor.inkMuted)
                .padding(.leading, 12)
                .padding(.top, 8)
            }
            if snap.status != .saved || !snap.errors.isEmpty {
                HStack(spacing: 8) {
                    if snap.status != .saved {
                        Button {
                            Task { await app.session?.engine.syncNow() }
                        } label: {
                            Label("Retry now", systemImage: "arrow.clockwise").font(.ui(12, .semibold))
                        }
                        .buttonStyle(.folevi(.secondary, .small))
                    }
                    if !snap.errors.isEmpty {
                        Button("Dismiss") { Task { await app.session?.engine.clearErrors() } }
                            .buttonStyle(.folevi(.quiet, .small))
                    }
                }
                .padding(.leading, 16)
                .padding(.top, 12)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(width: 288, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Sync details"))
    }

    private func pendingList(_ pending: [PendingDocument]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            FoleviColor.line.frame(height: 1).padding(.bottom, 12)
            Text("Waiting to sync").font(.ui(12, .semibold)).tracking(0.08 * 12).textCase(.uppercase).foregroundStyle(FoleviColor.inkMuted)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(pending.prefix(Self.listLimit)) { p in
                    PendingRow(pending: p, title: title(p)) { openDocument(p.documentId) }
                }
            }
            .padding(.top, 6)
            if pending.count > Self.listLimit {
                let more = pending.count - Self.listLimit
                Text(more == 1 ? String(localized: "…and 1 more page") : String(localized: "…and \(more) more pages"))
                    .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 4)
            }
        }
        .padding(.top, 12)
    }

    private func title(_ p: PendingDocument) -> String {
        if let doc = app.document(p.documentId), !doc.title.isEmpty { return doc.title }
        return p.isNew ? String(localized: "New page") : String(localized: "Untitled")
    }
}

private struct PendingRow: View {
    var pending: PendingDocument
    var title: String
    var open: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                Image(systemName: "doc.text").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                Text(title).font(.ui(13)).foregroundStyle(FoleviColor.ink).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 6) {
                    if pending.changes > 0 {
                        Text(pending.changes == 1 ? String(localized: "1 change") : String(localized: "\(pending.changes) changes"))
                    }
                    if pending.uploads > 0 {
                        HStack(spacing: 2) {
                            Image(systemName: "paperclip").font(.system(size: 10))
                            Text("\(pending.uploads)")
                        }
                        .help(Text(pending.uploads == 1 ? String(localized: "1 file waiting to upload") : String(localized: "\(pending.uploads) files waiting to upload")))
                    }
                }
                .font(.ui(12).monospacedDigit())
                .foregroundStyle(FoleviColor.inkMuted)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(hover ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .padding(.horizontal, -8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
