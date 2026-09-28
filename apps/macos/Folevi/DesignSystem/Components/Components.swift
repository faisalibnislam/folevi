import SwiftUI

// MARK: - Canvas

/// `canvas` plus two very large, very soft radial glows — peach top-right, rose bottom-left
/// (`.ui-canvas` on the web). Flat under Reduce Transparency.
struct CanvasBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                FoleviColor.canvas
                if !reduceTransparency {
                    glow(FoleviColor.glowPeach, strength: colorScheme == .dark ? 0.55 : 0.42)
                        .frame(width: w * 1.3, height: h * 1.05)
                        .position(x: w, y: -0.05 * h)
                    glow(FoleviColor.glowRose, strength: colorScheme == .dark ? 0.5 : 0.38)
                        .frame(width: w * 1.2, height: h * 1.15)
                        .position(x: -0.05 * w, y: 1.05 * h)
                }
            }
            .frame(width: w, height: h)
            .clipped()
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func glow(_ color: Color, strength: Double) -> some View {
        EllipticalGradient(gradient: Gradient(stops: [
            .init(color: color.opacity(strength), location: 0),
            .init(color: color.opacity(strength * 0.45), location: 0.35),
            .init(color: color.opacity(0), location: 0.72),
        ]), center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
    }
}

// MARK: - Buttons

enum FoleviButtonKind { case primary, secondary, ghost, quiet, danger }
enum FoleviButtonSize {
    case small, medium, large
    var height: CGFloat { switch self { case .small: return 28; case .medium: return 34; case .large: return 40 } }
    var font: CGFloat { switch self { case .small: return 12.5; case .medium: return 13.5; case .large: return 14 } }
    var padding: CGFloat { switch self { case .small: return 12; case .medium: return 15; case .large: return 20 } }
}

/// Pill buttons: primary (cocoa gradient), secondary (white pill + control shadow), ghost, quiet, danger.
struct FoleviButtonStyle: ButtonStyle {
    var kind: FoleviButtonKind = .secondary
    var size: FoleviButtonSize = .medium
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        FoleviButtonBody(configuration: configuration, kind: kind, size: size, fullWidth: fullWidth)
    }
}

private struct FoleviButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let kind: FoleviButtonKind
    let size: FoleviButtonSize
    let fullWidth: Bool
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let pressed = configuration.isPressed && isEnabled
        configuration.label
            .font(.ui(size.font, .semibold))
            .tracking(-0.005 * size.font)
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, size.padding)
            .frame(minHeight: size.height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background { background(pressed: pressed) }
            .contentShape(Capsule())
            .opacity(isEnabled ? 1 : 0.5)
            .onHover { hovering = $0 && isEnabled }
            .animation(reduceMotion ? nil : .easeOut(duration: FoleviMotion.fast), value: hovering)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return FoleviColor.accentInk
        case .danger: return FoleviColor.accentInk
        case .secondary, .ghost: return hovering ? FoleviColor.heading : FoleviColor.ink
        case .quiet: return hovering ? FoleviColor.heading : FoleviColor.inkMuted
        }
    }

    @ViewBuilder private func background(pressed: Bool) -> some View {
        switch kind {
        case .primary:
            Color.clear.foleviSurface(.gradient(nearlyFlat(FoleviColor.accent, pressed: pressed)), shape: .capsule, shadow: FoleviShadow.primary)
        case .danger:
            Color.clear.foleviSurface(.gradient(nearlyFlat(FoleviColor.destructive, pressed: pressed)), shape: .capsule, shadow: FoleviShadow.primary)
        case .secondary:
            let base = pressed ? FoleviColor.surfaceRaised.mix(with: FoleviColor.surfaceSunken, by: 0.35) : FoleviColor.surfaceRaised
            Color.clear.foleviSurface(.gradient([base, base.mix(with: FoleviColor.surfaceSunken, by: hovering ? 0.0 : 0.04)]),
                                      shape: .capsule, shadow: FoleviShadow.control)
        case .ghost, .quiet:
            Capsule().fill(hovering || pressed ? FoleviColor.accentSoft.opacity(pressed ? 1 : 0.8) : Color.clear)
        }
    }

    /// Nearly flat: at most a 4% lighter top; hover lifts a touch, pressed darkens slightly.
    private func nearlyFlat(_ base: Color, pressed: Bool) -> [Color] {
        if pressed { return [base.mix(with: .black, by: 0.07), base.mix(with: .black, by: 0.07)] }
        let top = base.mix(with: .white, by: hovering ? 0.08 : 0.04)
        return [top, hovering ? base.mix(with: .white, by: 0.04) : base]
    }
}

extension ButtonStyle where Self == FoleviButtonStyle {
    static var foleviPrimary: FoleviButtonStyle { FoleviButtonStyle(kind: .primary) }
    static var foleviSecondary: FoleviButtonStyle { FoleviButtonStyle(kind: .secondary) }
    static var foleviGhost: FoleviButtonStyle { FoleviButtonStyle(kind: .ghost) }
    static func folevi(_ kind: FoleviButtonKind, _ size: FoleviButtonSize = .medium, fullWidth: Bool = false) -> FoleviButtonStyle {
        FoleviButtonStyle(kind: kind, size: size, fullWidth: fullWidth)
    }
}

/// 30pt ghost circle for icons. Always labelled; tooltip carries the shortcut.
struct IconButton: View {
    var systemImage: String
    var label: LocalizedStringKey
    var shortcutHint: String?
    var size: CGFloat = 30
    var isActive = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.47, weight: .medium))
                .frame(width: size, height: size)
        }
        .buttonStyle(IconButtonStyle(isActive: isActive))
        .help(shortcutHint.map { Text(label) + Text(" (\($0))") } ?? Text(label))
        .accessibilityLabel(Text(label))
    }
}

struct IconButtonStyle: ButtonStyle {
    var isActive = false
    func makeBody(configuration: Configuration) -> some View {
        IconButtonBody(configuration: configuration, isActive: isActive)
    }
}

private struct IconButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let isActive: Bool
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .background(Circle().fill(isActive || configuration.isPressed ? FoleviColor.accentSoft : hovering ? FoleviColor.accentSoft.opacity(0.8) : .clear))
            .contentShape(Circle())
            .opacity(isEnabled ? 1 : 0.4)
            .onHover { hovering = $0 && isEnabled }
    }
}

// MARK: - Segmented control

/// Sunken pill track with a raised thumb that slides (180ms) under the active item.
struct FoleviSegmented<Value: Hashable>: View {
    struct Item: Identifiable {
        var value: Value
        var title: LocalizedStringKey
        var systemImage: String?
        var id: Value { value }
    }

    @Binding var selection: Value
    var items: [Item]
    var showTitles = true
    var height: CGFloat = 28
    var fontSize: CGFloat = 12.5
    var accessibilityLabel: LocalizedStringKey
    /// Icon above a small label (the inspector header).
    var stacked = false
    @Namespace private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        HStack(spacing: 2) {
            ForEach(items) { item in
                let active = item.value == selection
                Button {
                    withAnimation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base)) { selection = item.value }
                } label: {
                    let stack = stacked ? AnyLayout(VStackLayout(spacing: 3)) : AnyLayout(HStackLayout(spacing: 5))
                    stack {
                        if let icon = item.systemImage {
                            Image(systemName: icon)
                                .font(.system(size: stacked ? 13 : fontSize, weight: active ? .semibold : .medium))
                                .foregroundStyle(active && stacked ? FoleviColor.ember : active ? FoleviColor.heading : FoleviColor.inkMuted)
                                .accessibilityHidden(true)
                        }
                        if showTitles || item.systemImage == nil {
                            Text(item.title).lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                    .font(.ui(fontSize, active ? .semibold : .medium))
                    .foregroundStyle(active ? FoleviColor.heading : FoleviColor.inkMuted)
                    .padding(.horizontal, stacked ? 2 : showTitles ? 9 : 6)
                    .frame(maxWidth: .infinity, minHeight: height)
                    .background {
                        if active {
                            Color.clear
                                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
                                .matchedGeometryEffect(id: "thumb", in: namespace)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .help(Text(item.title))
                .accessibilityLabel(Text(item.title))
                .accessibilityAddTraits(active ? [.isSelected] : [])
            }
        }
        .padding(3)
        .foleviWell()
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityLabel))
    }
}

// MARK: - Chips, keycaps, labels

/// Small pill for due dates, tags and priorities: soft fill + ink.
struct Chip: View {
    var text: String
    var systemImage: String?
    var tint: Color = FoleviColor.inkMuted
    var fill: Color?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.ui(10, .semibold)).accessibilityHidden(true) }
            Text(text).monospacedDigit()
        }
        .font(.ui(11.5, .semibold))
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(Capsule().fill(fill ?? tint.opacity(0.12)))
    }
}

/// Filter chip (Tasks, Calendar…): quiet pill; the active one is a raised white pill.
struct FilterChip: View {
    var title: String
    var count: Int?
    var isActive: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.ui(11, .semibold))
                        .monospacedDigit()
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 18)
                        .background(Capsule().fill(isActive ? FoleviColor.emberSoft : FoleviColor.ink.opacity(0.07)))
                        .foregroundStyle(isActive ? FoleviColor.emberInk : FoleviColor.inkMuted)
                }
            }
            .font(.ui(13, isActive ? .semibold : .medium))
            .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, 13)
            .frame(height: 30)
            .background {
                if isActive {
                    Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
                } else {
                    Capsule().fill(hovering ? FoleviColor.accentSoft.opacity(0.8) : .clear)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

struct Keycap: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.ui(10.5, .semibold))
            .foregroundStyle(FoleviColor.inkMuted)
            .padding(.horizontal, 5)
            .frame(minWidth: 22, minHeight: 20)
            .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviDepth.keycap)
            .accessibilityHidden(true)
    }
}

/// Caps section label.
struct CapsLabel: View {
    var title: LocalizedStringKey
    var body: some View {
        Text(title).foleviCapsLabel().accessibilityAddTraits(.isHeader)
    }
}

extension View {
    /// Menus, popovers, the palette: surfaceRaised, radius 14, pop shadow.
    func foleviPop(radius: CGFloat = 14) -> some View {
        foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(radius), shadow: FoleviShadow.pop)
    }

    /// Cards: surface, radius 16, card shadow.
    func foleviCard(radius: CGFloat = FoleviRadius.card, fill: Color = FoleviColor.surface) -> some View {
        foleviSurface(.color(fill), shape: .rounded(radius), shadow: FoleviShadow.card)
    }

    /// Large view title (All Documents, Tasks, Calendar…): 38pt semibold heading, tight tracking.
    func foleviViewTitle(size: CGFloat = 34) -> some View {
        self.font(.ui(size, .semibold))
            .tracking(FoleviTracking.tight * size)
            .foregroundStyle(FoleviColor.heading)
            .lineLimit(1)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Sync status pill

/// Sunken pill: status dot + icon + label (never color alone). Saved = moss, saving/syncing = ember
/// pulse, offline = faint, conflict/error = coral. "Saved" only after server ack (reducer status).
struct SyncStatusPill: View {
    var snapshot: SyncSnapshot
    var compact = false
    @State private var showDetails = false
    @State private var pulse = false
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(AppModel.self) private var app

    private var info: (label: LocalizedStringKey, icon: String, dot: Color, ink: Color) {
        switch snapshot.status {
        case .saved: return ("Saved", "checkmark", FoleviColor.moss, FoleviColor.inkMuted)
        case .saving: return ("Saving", "arrow.up", FoleviColor.ember, FoleviColor.inkMuted)
        case .syncing: return ("Syncing", "arrow.triangle.2.circlepath", FoleviColor.ember, FoleviColor.inkMuted)
        case .offline: return ("Offline", "icloud.slash", FoleviColor.inkFaint, FoleviColor.warning)
        case .conflict: return ("Conflict", "arrow.triangle.merge", FoleviColor.coral, FoleviColor.coralInk)
        case .error: return ("Error", "exclamationmark.triangle", FoleviColor.coral, FoleviColor.destructive)
        }
    }

    private var busy: Bool { snapshot.status == .saving || snapshot.status == .syncing }

    var body: some View {
        Button {
            showDetails.toggle()
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(info.dot)
                    .frame(width: 6, height: 6)
                    .opacity(busy && pulse ? 0.35 : 1)
                    .accessibilityHidden(true)
                if !compact {
                    Image(systemName: info.icon)
                        .font(.ui(10.5, .semibold))
                        .foregroundStyle(snapshot.status == .saved ? FoleviColor.mossInk : busy ? FoleviColor.emberInk : info.ink)
                        .accessibilityHidden(true)
                    Text(info.label)
                    if snapshot.status == .offline && snapshot.pendingCount > 0 {
                        Text("· \(snapshot.pendingCount)").monospacedDigit()
                    }
                }
            }
            .font(.ui(12, .semibold))
            .foregroundStyle(hovering ? FoleviColor.heading : info.ink)
            .padding(.horizontal, compact ? 9 : 12)
            .frame(minWidth: compact ? 28 : 104, minHeight: 30)
            .foleviWell()
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(helpText)
        .accessibilityLabel(Text("Sync status"))
        .accessibilityValue(Text(info.label))
        .accessibilityIdentifier("syncStatusPill")
        .popover(isPresented: $showDetails, arrowEdge: .bottom) {
            SyncDetailsView(snapshot: snapshot)
                .environment(app)
        }
        .onChange(of: snapshot.status) { _, newValue in announce(newValue) }
        .onChange(of: busy, initial: true) { _, isBusy in
            guard !reduceMotion else { return }
            if isBusy {
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
            } else {
                withAnimation(.easeOut(duration: 0.2)) { pulse = false }
            }
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
            Text("Sync").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading)
            Group {
                LabeledContent("Status", value: statusText)
                LabeledContent("Waiting to sync", value: "\(snapshot.pendingCount)")
                if snapshot.uploadCount > 0 { LabeledContent("Uploads", value: "\(snapshot.uploadCount)") }
                if let last = snapshot.lastSyncedAt {
                    LabeledContent("Last synced") { Text(last, style: .relative) }
                }
            }
            .font(.ui(12.5))
            if let message = snapshot.lastErrorMessage {
                Text(message).font(.ui(12.5)).foregroundStyle(FoleviColor.destructive).fixedSize(horizontal: false, vertical: true)
            }
            if !snapshot.errors.isEmpty {
                Text("\(snapshot.errors.count) changes were rejected by the server and have been reverted.")
                    .font(.ui(12.5))
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Button("Sync Now") { Task { await app.session?.engine.syncNow() } }
                    .buttonStyle(.folevi(.secondary, .small))
                if !snapshot.errors.isEmpty || snapshot.lastErrorMessage != nil {
                    Button("Dismiss Errors") { Task { await app.session?.engine.clearErrors() } }
                        .buttonStyle(.folevi(.quiet, .small))
                }
            }
            .padding(.top, 2)
        }
        .foregroundStyle(FoleviColor.ink)
        .padding(16)
        .frame(width: 290)
    }

    private var statusText: String {
        snapshot.isOnline ? (snapshot.forcedOffline ? String(localized: "Offline (forced)") : String(localized: "Connected")) : String(localized: "Offline")
    }
}

// MARK: - Note card

/// A note in the grid, drawn as a notebook (the web's NoteCardFace): a spine down the left carries the
/// note's style (its artwork thumbnail, or a light grey for plain notes), and the cover shows the title
/// (serif), when it was created, its opening text, and a footer with the last edit and its folder (or
/// Draft). Starred notes get a corner tab. Everything scales with the card's width, as on the web.
struct NoteCard: View {
    var document: DocumentSummary
    var folder: FolderInfo?
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    /// Portrait notebook proportions (25 : 27).
    static let aspect: CGFloat = 25 / 27

    var body: some View {
        GeometryReader { geo in
            let u = geo.size.width / 100 // the web's cqw
            let shape = UnevenRoundedRectangle(topLeadingRadius: 0.8 * u, bottomLeadingRadius: 0.8 * u, bottomTrailingRadius: 4.6 * u, topTrailingRadius: 4.6 * u, style: .continuous)
            ZStack(alignment: .topLeading) {
                // The page block, peeking out past the cover's open edge and bottom.
                shape.fill(FoleviColor.heading.mix(with: FoleviColor.canvas, by: 0.87))
                    .padding(.leading, geo.size.width * 0.01)
                    .padding(.top, geo.size.height * 0.014)
                cover(u: u, shape: shape)
                    .padding(.trailing, u)
                    .padding(.bottom, u)
            }
        }
        .aspectRatio(Self.aspect, contentMode: .fit)
        .shadow(color: .black.opacity(hovering ? 0.24 : 0.2), radius: hovering ? 18 : 15, x: hovering ? -5 : -4, y: hovering ? 12 : 9)
        .offset(y: hovering && !reduceMotion ? -2 : 0)
        .animation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: hovering)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(document.displayTitle))
        .accessibilityHint(Text("Opens the note"))
    }

    private func cover(u: CGFloat, shape: UnevenRoundedRectangle) -> some View {
        HStack(spacing: 0) {
            spine
                .frame(width: 6 * u)
                .overlay(alignment: .trailing) { Color.black.opacity(0.06).frame(width: 1) }
            VStack(alignment: .leading, spacing: 0) {
                Text(document.displayTitle)
                    .font(.serif(6.6 * u, .medium))
                    .tracking(0.005 * 6.6 * u)
                    .foregroundStyle(FoleviColor.heading)
                    .lineLimit(2)
                    .padding(.trailing, 7 * u)
                Text(Date(timeIntervalSince1970: document.createdAt / 1000), format: .dateTime.day().month(.wide).year())
                    .font(.ui(4.5 * u))
                    .foregroundStyle(FoleviColor.inkFaint)
                    .lineLimit(1)
                    .padding(.top, u)
                Text(document.excerpt.isEmpty ? String(localized: "Empty page") : document.excerpt)
                    .font(.ui(3.6 * u))
                    .italic(document.excerpt.isEmpty)
                    .lineSpacing(1.4 * u)
                    .foregroundStyle(FoleviColor.inkFaint)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(.top, 4.6 * u)
                    .clipped()
                footer(u: u)
                    .frame(height: 8.6 * u)
                    .padding(.top, 3.5 * u)
            }
            .padding(EdgeInsets(top: 8 * u, leading: 7 * u, bottom: 6 * u, trailing: 6 * u))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(FoleviColor.surface)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.black.opacity(0.05), lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            if document.starred == true {
                Image(systemName: "star.fill")
                    .font(.system(size: 5.6 * u))
                    .foregroundStyle(FoleviColor.heading)
                    .frame(width: 12 * u, height: 12 * u)
                    .background(chip, in: UnevenRoundedRectangle(bottomLeadingRadius: 2 * u, style: .continuous))
                    .clipShape(shape)
                    .accessibilityLabel(Text("Starred"))
            }
        }
    }

    /// The spine: the note's style artwork, or a very light grey for plain notes.
    @ViewBuilder private var spine: some View {
        if document.cover.kind == .art, let image = CoverArt.thumbnail(document.cover.value) {
            ArtCoverImage(image: image)
        } else {
            FoleviColor.heading.mix(with: FoleviColor.canvas, by: 0.93)
        }
    }

    private var chip: Color { FoleviColor.line.opacity(0.75) }

    private func footer(u: CGFloat) -> some View {
        HStack(spacing: 2 * u) {
            Text(Date(timeIntervalSince1970: document.updatedAt / 1000), format: .relative(presentation: .named))
                .foregroundStyle(FoleviColor.inkMuted)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 1.8 * u) {
                if let folder {
                    FolderGlyph(color: folder.color, size: 4.4 * u)
                } else {
                    Image(systemName: "pencil.line")
                        .font(.system(size: 3.8 * u, weight: .semibold))
                        .foregroundStyle(FoleviColor.heading)
                }
                Text(folder?.name ?? String(localized: "Draft"))
                    .fontWeight(.semibold)
                    .foregroundStyle(FoleviColor.heading)
                    .lineLimit(1)
            }
            .padding(.horizontal, 3 * u)
            .frame(maxHeight: .infinity)
            .background(chip, in: RoundedRectangle(cornerRadius: 1.5 * u, style: .continuous))
            .frame(maxWidth: 55 * u, alignment: .trailing)
            .fixedSize(horizontal: true, vertical: false)
        }
        .font(.ui(3.8 * u))
    }
}

/// The compact card (Compact layout): title and folder, as the web's DocumentCardPreview.
struct CompactNoteCard: View {
    var document: DocumentSummary
    var folder: FolderInfo?
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(document.displayTitle)
                .font(.serif(16.5, .semibold))
                .foregroundStyle(FoleviColor.heading)
                .lineLimit(2)
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Text(folder?.name ?? String(localized: "Draft"))
                Text("·")
                Text(Date(timeIntervalSince1970: document.updatedAt / 1000), format: .relative(presentation: .named))
            }
            .font(.ui(11.5))
            .foregroundStyle(FoleviColor.inkFaint)
            .lineLimit(1)
        }
        .padding(14)
        .frame(height: 120, alignment: .topLeading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.black.opacity(0.05)))
        .shadow(color: .black.opacity(hovering ? 0.12 : 0.06), radius: hovering ? 10 : 4, y: 2)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
    }
}

extension Color {
    /// `#RRGGBB`.
    init?(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
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
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.ui(24, .medium))
                .foregroundStyle(FoleviColor.ember)
                .frame(width: 60, height: 60)
                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(18), shadow: FoleviShadow.card)
                .accessibilityHidden(true)
                .padding(.bottom, 4)
            Text(title)
                .font(.ui(FoleviFontSize.xl, .semibold))
                .tracking(FoleviTracking.snug * FoleviFontSize.xl)
                .foregroundStyle(FoleviColor.heading)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.ui(14))
                .lineSpacing(3)
                .foregroundStyle(FoleviColor.inkMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.folevi(.primary))
                    .padding(.top, 6)
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
            content.foleviPop(radius: FoleviRadius.round)
        } else {
            content
                .foleviSurface(.color(FoleviColor.surfaceRaised.opacity(0.78)), shape: .capsule, shadow: FoleviShadow.pop, clipShadowInside: true)
                .background(.regularMaterial, in: Capsule(style: .continuous))
        }
    }
}

extension View {
    func foleviChrome() -> some View { modifier(ChromeBackground()) }
}

// MARK: - Text fields

/// Single-line input: a sunken pill with a focus halo.
struct FoleviFieldStyle: TextFieldStyle {
    var height: CGFloat = 36
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration.modifier(FoleviFieldModifier(height: height))
    }
}

private struct FoleviFieldModifier: ViewModifier {
    var height: CGFloat
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.ui(13.5))
            .foregroundStyle(FoleviColor.ink)
            .focused($focused)
            .padding(.horizontal, 14)
            .frame(minHeight: height)
            .foleviSurface(.color(FoleviColor.surface), shape: .capsule,
                           shadow: focused ? [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.focus, inset: false),
                                              FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 4, color: FoleviColor.focus.opacity(0.2), inset: false)]
                                   : FoleviDepth.well + [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: false)])
    }
}

extension TextFieldStyle where Self == FoleviFieldStyle {
    static var folevi: FoleviFieldStyle { FoleviFieldStyle() }
}
