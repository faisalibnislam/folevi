import SwiftUI

// MARK: - Sync status pill

/// Saved / Saving / Offline / Syncing / Conflict / Error. Never shows "Saved" before server ack
/// (the status comes from the reducer). Status changes are announced politely to VoiceOver.
struct SyncStatusPill: View {
    var snapshot: SyncSnapshot
    var compact = false
    @State private var showDetails = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(AppModel.self) private var app

    private var info: (label: LocalizedStringKey, icon: String, tint: Color) {
        switch snapshot.status {
        case .saved: return ("Saved", "checkmark.circle", FoleviColor.success)
        case .saving: return ("Saving", "arrow.up.circle", FoleviColor.inkMuted)
        case .syncing: return ("Syncing", "arrow.triangle.2.circlepath", FoleviColor.accent)
        case .offline: return ("Offline", "icloud.slash", FoleviColor.warning)
        case .conflict: return ("Conflict", "exclamationmark.2", FoleviColor.coral)
        case .error: return ("Error", "exclamationmark.triangle", FoleviColor.destructive)
        }
    }

    var body: some View {
        Button {
            showDetails.toggle()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: info.icon)
                    .symbolEffect(.pulse, isActive: snapshot.status == .syncing && !reduceMotion)
                if !compact {
                    Text(info.label)
                    if snapshot.status == .offline && snapshot.pendingCount > 0 {
                        Text("· \(snapshot.pendingCount)")
                            .monospacedDigit()
                    }
                }
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(info.tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(info.tint.opacity(0.12)))
        }
        .buttonStyle(.plain)
        .help(helpText)
        .accessibilityLabel(Text("Sync status"))
        .accessibilityValue(Text(info.label))
        .accessibilityIdentifier("syncStatusPill")
        .popover(isPresented: $showDetails, arrowEdge: .bottom) {
            SyncDetailsView(snapshot: snapshot)
                .environment(app)
        }
        .onChange(of: snapshot.status) { _, newValue in
            announce(newValue)
        }
    }

    private var helpText: String {
        switch snapshot.status {
        case .saved: return String(localized: "All changes are saved to Folevi.")
        case .saving: return String(localized: "Saving your latest changes.")
        case .syncing: return String(localized: "Syncing with Folevi.")
        case .offline: return String(localized: "You're offline. \(snapshot.pendingCount) changes are stored on this Mac.")
        case .conflict: return String(localized: "Some blocks were changed in two places. Review the conflict.")
        case .error: return snapshot.lastErrorMessage ?? String(localized: "Some changes couldn't be saved.")
        }
    }

    private func announce(_ status: SyncStatus) {
        // Only announce meaningful transitions, not every save.
        let message: String?
        switch status {
        case .offline: message = String(localized: "Offline. Changes will sync later.")
        case .conflict: message = String(localized: "Sync conflict needs review.")
        case .error: message = String(localized: "Sync error.")
        default: message = nil
        }
        if let message {
            AccessibilityNotification.Announcement(message).post()
        }
    }
}

struct SyncDetailsView: View {
    var snapshot: SyncSnapshot
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Sync").font(.headline)
            LabeledContent("Status", value: statusText)
            LabeledContent("Waiting to sync", value: "\(snapshot.pendingCount)")
            if snapshot.uploadCount > 0 { LabeledContent("Uploads", value: "\(snapshot.uploadCount)") }
            if let last = snapshot.lastSyncedAt {
                LabeledContent("Last synced") { Text(last, style: .relative) }
            }
            if let message = snapshot.lastErrorMessage {
                Text(message).font(.callout).foregroundStyle(FoleviColor.destructive).fixedSize(horizontal: false, vertical: true)
            }
            if !snapshot.errors.isEmpty {
                Text("\(snapshot.errors.count) changes were rejected by the server and have been reverted.")
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Button("Sync Now") { Task { await app.session?.engine.syncNow() } }
                if !snapshot.errors.isEmpty || snapshot.lastErrorMessage != nil {
                    Button("Dismiss Errors") { Task { await app.session?.engine.clearErrors() } }
                }
            }
        }
        .padding(16)
        .frame(width: 280)
    }

    private var statusText: String {
        snapshot.isOnline ? (snapshot.forcedOffline ? String(localized: "Offline (forced)") : String(localized: "Connected")) : String(localized: "Offline")
    }
}

// MARK: - Buttons

/// Borderless icon button that always carries an accessibility label.
struct IconButton: View {
    var systemImage: String
    var label: LocalizedStringKey
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .help(Text(label))
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Folio card

struct FolioCard: View {
    var document: DocumentSummary
    var compact = false
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                coverBackground
                    .frame(height: compact ? 44 : 72)
                Text(document.icon ?? "")
                    .font(.system(size: compact ? 20 : 28))
                    .padding(.leading, 14)
                    .offset(y: compact ? 12 : 16)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(document.displayTitle)
                    .font(FoleviType.cardTitle)
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(2)
                if !compact && !document.excerpt.isEmpty {
                    Text(document.excerpt)
                        .font(.system(size: 12))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .lineLimit(3)
                }
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Text(Date(timeIntervalSince1970: document.updatedAt / 1000), format: .relative(presentation: .named))
                    if document.wordCount > 0 {
                        Text("·")
                        Text("\(document.wordCount) words")
                    }
                }
                .font(.system(size: 11))
                .foregroundStyle(FoleviColor.inkFaint)
            }
            .padding(.horizontal, 14)
            .padding(.top, compact ? 16 : 22)
            .padding(.bottom, 12)
        }
        .frame(height: compact ? 132 : 208)
        .background(FoleviColor.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous)
                .strokeBorder(hovering ? FoleviColor.lineStrong : FoleviColor.line, lineWidth: 1)
        )
        .shadow(color: .black.opacity(hovering ? 0.08 : 0.03), radius: hovering ? 10 : 4, y: hovering ? 4 : 1)
        .scaleEffect(hovering && !reduceMotion ? 1.01 : 1)
        .animation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast), value: hovering)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(document.displayTitle))
        .accessibilityHint(Text("Opens the document"))
    }

    @ViewBuilder private var coverBackground: some View {
        let accent = Color.folevi(accent: document.style.accent)
        switch document.cover.kind {
        case .color, .gradient:
            LinearGradient(colors: [accent.opacity(0.55), accent.opacity(0.25)], startPoint: .topLeading, endPoint: .bottomTrailing)
        default:
            LinearGradient(colors: [accent.opacity(0.16), FoleviColor.surfaceSunken], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
}

// MARK: - Empty state

struct EmptyStateView: View {
    var systemImage: String
    var title: LocalizedStringKey
    var message: LocalizedStringKey
    var actionTitle: LocalizedStringKey?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(FoleviColor.inkFaint)
                .accessibilityHidden(true)
            Text(title).font(FoleviType.sectionTitle).foregroundStyle(FoleviColor.ink)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(FoleviColor.inkMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.borderedProminent)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Chrome background (Liquid Glass on macOS 26+, solid when Reduce Transparency is on)

struct ChromeBackground: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(FoleviColor.surface)
        } else if #available(macOS 26, *) {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: FoleviRadius.sheet, style: .continuous))
        } else {
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: FoleviRadius.sheet, style: .continuous))
        }
    }
}

extension View {
    func foleviChrome() -> some View { modifier(ChromeBackground()) }
}

/// Small rounded label used for due dates, tags and priorities.
struct Chip: View {
    var text: String
    var systemImage: String?
    var tint: Color = FoleviColor.inkMuted

    var body: some View {
        HStack(spacing: 3) {
            if let systemImage { Image(systemName: systemImage).accessibilityHidden(true) }
            Text(text)
        }
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(tint)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(tint.opacity(0.12)))
    }
}
