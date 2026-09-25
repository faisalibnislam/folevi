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

// MARK: - Folio card

struct FolioCard: View {
    var document: DocumentSummary
    var compact = false
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var bandHeight: CGFloat { compact ? 52 : 72 }
    private var iconSize: CGFloat { compact ? 36 : 44 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                band
                    .frame(height: bandHeight)
                    .overlay(alignment: .bottom) { FoleviColor.line.opacity(0.6).frame(height: 1) }
                Text(document.icon ?? "📄")
                    .font(.system(size: compact ? 18 : 22))
                    .frame(width: iconSize, height: iconSize)
                    .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(compact ? 10 : 12), shadow: FoleviShadow.control)
                    .padding(.leading, 18)
                    .offset(y: iconSize / 2)
                    .accessibilityHidden(true)
            }
            .zIndex(1)
            VStack(alignment: .leading, spacing: 7) {
                Text(document.displayTitle)
                    .font(.document(document.style.font, compact ? 15 : 16.5, .semibold))
                    .tracking(document.style.font == .sans ? FoleviTracking.snug * 16 : 0)
                    .foregroundStyle(FoleviColor.heading)
                    .lineLimit(2)
                if !compact {
                    Text(document.excerpt.isEmpty ? String(localized: "Empty page") : document.excerpt)
                        .font(.ui(13))
                        .lineSpacing(3)
                        .foregroundStyle(FoleviColor.inkMuted)
                        .lineLimit(3)
                }
                Spacer(minLength: 0)
                HStack(spacing: 5) {
                    Text("Edited \(Text(Date(timeIntervalSince1970: document.updatedAt / 1000), format: .relative(presentation: .named)))")
                    if let tag = document.tags?.first {
                        Text("·")
                        Text("#\(tag.name)")
                    }
                }
                .font(.ui(12))
                .foregroundStyle(FoleviColor.inkFaint)
                .lineLimit(1)
            }
            .padding(.horizontal, 18)
            .padding(.top, iconSize / 2 + 12)
            .padding(.bottom, 16)
        }
        .frame(height: compact ? 150 : 250)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .foleviSurface(fill, shape: .rounded(18), shadow: shadow)
        .offset(y: hovering && !reduceMotion ? -2 : 0)
        .animation(reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.base), value: hovering)
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(document.displayTitle))
        .accessibilityHint(Text("Opens the document"))
    }

    private var accentKey: DocumentAccent {
        document.cover.value.flatMap(DocumentAccent.init(rawValue:)) ?? document.style.accent
    }

    /// Card style (Folio / Plain / Tinted / Outline) from the page's style.
    private var fill: SurfaceFill {
        switch document.style.card {
        case .tinted: return .color(Color.folevi(accentSoft: accentKey).mix(with: FoleviColor.surface, by: 0.45))
        case .plain: return .color(FoleviColor.surfaceRaised)
        default: return .color(FoleviColor.surface)
        }
    }

    private var shadow: [FoleviShadowLayer] {
        switch document.style.card {
        case .outline:
            return [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.lineStrong, inset: false)] + (hovering ? FoleviShadow.card : [])
        case .plain:
            return hovering ? FoleviShadow.card : FoleviShadow.hairline
        default:
            return hovering ? FoleviShadow.pop : FoleviShadow.card
        }
    }

    /// Cover band: the page accent's soft multi-glow (stronger when the page has a cover).
    private var band: some View {
        let kind = document.cover.kind
        let hasCover = kind == .color || kind == .gradient || kind == .art
        return Group {
            if kind == .art, let image = CoverArt.image(document.cover.value) {
                ArtCoverImage(image: image)
            } else {
                CoverGlow(accent: Color.folevi(accent: accentKey), soft: Color.folevi(accentSoft: accentKey), intensity: hasCover ? 0.85 : 0.3)
            }
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
