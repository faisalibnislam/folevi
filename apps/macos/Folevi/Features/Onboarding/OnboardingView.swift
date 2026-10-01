import SwiftUI

// MARK: - Choices

extension OnboardingChoices {
    @MainActor
    static func styleName(_ id: String?) -> String {
        guard let id, id != plain, let entry = CoverArt.entry(id) else { return String(localized: "Plain") }
        return entry.name
    }
}

// MARK: - Motion

/// The web's easing (`--ob-ease`) and its springy variant (`--ob-spring`).
enum OnboardingMotion {
    static func ease(_ duration: Double) -> Animation { .timingCurve(0.2, 0.7, 0.2, 1, duration: duration) }
    static func spring(_ duration: Double) -> Animation { .timingCurve(0.34, 1.4, 0.5, 1, duration: duration) }
}

/// Plays an entrance once, when the view appears (the web's keyframe animations: `ob-step-in`, `ob-rise`,
/// `ob-arrive`). Reduce Motion shows the view at once.
struct OnboardingEntrance: ViewModifier {
    var offset: CGSize = .zero
    var scale: CGFloat = 1
    var animation: Animation
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let on = shown || reduceMotion
        content
            .opacity(on ? 1 : 0)
            .scaleEffect(on ? 1 : scale)
            .offset(on ? .zero : offset)
            .onAppear {
                guard !shown, !reduceMotion else { return }
                withAnimation(animation) { shown = true }
            }
    }
}

extension View {
    /// `ob-rise`: up 10 pt and in, 520 ms, staggered 55 ms per item after 80 ms.
    func onboardingRise(_ index: Int) -> some View {
        modifier(OnboardingEntrance(offset: CGSize(width: 0, height: 10), animation: OnboardingMotion.ease(0.52).delay(Double(index) * 0.055 + 0.08)))
    }

    /// `ob-arrive`: a new row or card springs in.
    func onboardingArrive(_ index: Int) -> some View {
        modifier(OnboardingEntrance(offset: CGSize(width: 0, height: 8), scale: 0.94, animation: OnboardingMotion.spring(0.52).delay(Double(index) * 0.06)))
    }
}

// MARK: - The flow

/// Six steps, like the web (components/app/Onboarding.tsx): a welcome, starter pages, the Welcome page's
/// note style, appearance, the AI Assistant, and a summary that opens the Welcome page. Each step is saved
/// as it's finished, so leaving halfway resumes in the right place on any device. Beside the form, a live
/// miniature of the person's own Folevi takes shape (OnboardingPreview).
struct OnboardingView: View {
    @Environment(AppModel.self) private var app
    @State private var step = 0
    @State private var forward = true
    @State private var picks: [String] = []
    @State private var lastPick: String?
    @State private var styleId = OnboardingChoices.plain
    @State private var styleLoaded = false
    @State private var ai = true
    /// The chosen appearance (the cards follow it at once).
    @State private var look: AppearancePreference = .system
    @State private var error: String?
    @State private var busy = false
    @State private var started = false
    @AccessibilityFocusState private var headingFocused: Bool

    private static let steps: [(key: String, name: String)] = [
        ("workspace", String(localized: "Welcome")),
        ("uses", String(localized: "Your pages")),
        ("style", String(localized: "Note style")),
        ("appearance", String(localized: "Appearance")),
        ("ai", String(localized: "AI Assistant")),
        ("welcome", String(localized: "Ready")),
    ]
    private var last: Int { Self.steps.count - 1 }

    private var applied: [String] { app.profile?.onboardingUseCases ?? [] }
    private var savedAI: Bool { app.profile?.aiEnabled != false }
    private var savedLook: AppearancePreference { AppearancePreference(rawValue: app.profile?.appearance ?? "") ?? .system }
    private var welcome: DocumentSummary? {
        app.documents.first { $0.title == OnboardingChoices.welcomeTitle && $0.deletedAt == nil && $0.archivedAt == nil } ?? app.welcomeDocument
    }
    /// The Welcome page's current style, once it has loaded (a reload resumes with it).
    private var savedStyle: String? {
        guard let welcome else { return nil }
        if welcome.cover.kind == .art, let value = welcome.cover.value, !value.isEmpty { return value }
        return OnboardingChoices.plain
    }

    var body: some View {
        GeometryReader { geo in
            // The web's lg breakpoint: the stage beside the form; narrower, a compact preview above it.
            let wide = geo.size.width >= 1024
            HStack(spacing: 0) {
                column(wide: wide, size: geo.size)
                    .frame(width: wide ? 600 : geo.size.width)
                if wide {
                    preview(compact: false)
                        .padding(.vertical, 12)
                        .padding(.trailing, 12)
                }
            }
        }
        .background(FoleviColor.canvas)
        .foregroundStyle(FoleviColor.ink)
        .background(WindowChrome())
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .ignoresSafeArea()
        .onAppear(perform: start)
        .onChange(of: savedStyle) { _, saved in
            guard let saved, !styleLoaded else { return }
            styleLoaded = true
            styleId = saved
        }
        .onChange(of: error) { _, message in
            // The web's role="alert".
            if let message { AccessibilityNotification.Announcement(message).post() }
        }
        .onChange(of: step) { _, _ in
            // Each step's heading takes focus, so VoiceOver announces where they are.
            headingFocused = true
        }
    }

    private func start() {
        guard !started else { return }
        started = true
        step = Self.steps.firstIndex { $0.key == app.profile?.onboardingStep } ?? 0
        picks = applied
        ai = savedAI
        look = app.appearance
        if let savedStyle {
            styleLoaded = true
            styleId = savedStyle
        }
    }

    // MARK: Layout

    private func column(wide: Bool, size: CGSize) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                progress.padding(.top, 40)
                if !wide {
                    preview(compact: true)
                        .frame(height: 300)
                        .padding(.top, 20)
                }
                stepBody(display: size.width >= 640 ? 44 : 34)
                    .padding(.top, wide ? 48 : 28)
                    .padding(.bottom, 32)
            }
            .padding(.horizontal, wide ? 56 : 40)
            // Clear of the title bar, where the traffic lights sit.
            .padding(.top, 52)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollIndicators(.automatic)
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if wide {
                // Under the form, on the canvas.
                footer
                    .padding(.horizontal, 56)
                    .padding(.top, 16)
                    .padding(.bottom, 40)
                    .background(FoleviColor.canvas)
            } else {
                // Narrow windows: a bar along the bottom, over the canvas.
                footer
                    .padding(.horizontal, 40)
                    .padding(.vertical, 12)
                    .background(FoleviColor.canvas.opacity(0.9))
                    .background(.ultraThinMaterial)
                    .overlay(alignment: .top) { FoleviColor.line.frame(height: 1) }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            FoleviLogo(height: 26).foregroundStyle(FoleviColor.heading)
            Spacer(minLength: 0)
            if step < last {
                Button("Skip setup") { skipAll() }
                    .buttonStyle(.folevi(.quiet, .small))
                    .disabled(busy)
                    .accessibilityIdentifier("onboarding.skipAll")
            }
        }
        .frame(height: 36)
    }

    private var progress: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                ForEach(Self.steps.indices, id: \.self) { i in
                    ProgressSegment(state: i < step ? .done : i == step ? .current : .next)
                }
            }
            (Text("\(step + 1)").foregroundStyle(FoleviColor.heading) + Text(" of \(Self.steps.count) · \(Self.steps[step].name)"))
                .font(.ui(12.5, .medium))
                .foregroundStyle(FoleviColor.inkMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Setup progress"))
        .accessibilityValue(Text("Step \(step + 1) of \(Self.steps.count): \(Self.steps[step].name)"))
    }

    private func stepBody(display: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if step == 4 {
                AiMarkTile(on: ai).padding(.bottom, 20)
            }
            Text(heading)
                .font(FoleviType.display(display))
                .tracking(FoleviType.displayTracking(display))
                .foregroundStyle(FoleviColor.heading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: display * 8.9, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($headingFocused)
            Text(lede)
                .font(.ui(15.5))
                .lineSpacing(6)
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 410, alignment: .leading)
                .padding(.top, 14)
            controls.padding(.top, 28)
            if let error {
                Text(error)
                    .font(.ui(14))
                    .foregroundStyle(FoleviColor.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 20)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // A new step slides in from the side it comes from (`ob-step-in` / `ob-step-back`).
        .modifier(OnboardingEntrance(offset: CGSize(width: forward ? 18 : -18, height: 0), animation: OnboardingMotion.ease(0.46)))
        .id(step)
    }

    @ViewBuilder private var controls: some View {
        switch step {
        case 0:
            FactList(items: [
                .init(icon: "wifi.slash", title: String(localized: "Works offline"), body: String(localized: "Your writing is saved on this device first, and syncs when you reconnect.")),
                .init(icon: "link", title: String(localized: "Pages that link up"), body: String(localized: "Type [[ to link one page to another. The page you link to shows a backlink.")),
                .init(icon: "person.2", title: String(localized: "Yours, and easy to share"), body: String(localized: "Personal is your own space. Share single pages with anyone, or start a workspace for a team any time.")),
            ])
        case 1:
            UseCasePicker(picks: picks, applied: applied) { id, on in
                if on { picks.append(id) } else { picks.removeAll { $0 == id } }
                lastPick = on ? OnboardingChoices.useCases.first { $0.id == id }?.art : nil
            }
        case 2:
            StylePicker(value: styleId) { styleId = $0 }
        case 3:
            VStack(alignment: .leading, spacing: 16) {
                AppearancePicker(value: look, styleId: chosenArt) { pickAppearance($0) }
                Text("Match system follows your device, so Folevi turns dark when your device does.")
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case 4:
            AiChoice(on: $ai, plan: aiPlanNote)
        default:
            SummaryList(rows: summaryRows)
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if step > 0 {
                Button { go(step - 1) } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "arrow.left").font(.system(size: 13, weight: .semibold)).accessibilityHidden(true)
                        Text("Back")
                    }
                }
                .buttonStyle(.folevi(.ghost, .medium))
                .disabled(busy)
                .accessibilityIdentifier("onboarding.back")
            }
            Spacer(minLength: 0)
            if step >= 1 && step < last {
                Button("Skip") { skip() }
                    .buttonStyle(.folevi(.quiet, .medium))
                    .disabled(busy)
                    .accessibilityIdentifier("onboarding.skip")
            }
            Button { cont() } label: {
                HStack(spacing: 7) {
                    Text(primaryTitle)
                    Image(systemName: "arrow.right").font(.system(size: 13, weight: .semibold)).accessibilityHidden(true)
                }
                .frame(minWidth: 112 - 30)
            }
            .buttonStyle(.folevi(.primary, .medium))
            .keyboardShortcut(.defaultAction)
            .disabled(busy)
            .accessibilityIdentifier("onboarding.continue")
        }
    }

    private func preview(compact: Bool) -> some View {
        OnboardingPreview(
            scene: step == 0 ? .deck : step == 1 ? .home : .note,
            styleId: chosenArt,
            ambientId: ambient,
            pages: OnboardingChoices.pages(for: picks),
            ai: step >= 4 ? ai : savedAI,
            highlight: step == 2 ? .style : step == 4 ? .ai : nil,
            finished: step == last,
            name: app.profile?.displayName ?? "",
            compact: compact,
            label: previewLabel
        )
    }

    // MARK: Copy

    private var chosenArt: String? { styleId != OnboardingChoices.plain ? styleId : nil }

    private var ambient: String? {
        switch step {
        case 0: return "art-03"
        case 1: return lastPick ?? picks.last.flatMap { id in OnboardingChoices.useCases.first { $0.id == id }?.art }
        default: return chosenArt
        }
    }

    private var previewLabel: String {
        switch step {
        case 0:
            return String(localized: "Five note styles fanned out like cards: Cypresses, Summer sky, Irises, Poppy print and Aurora.")
        case 1:
            let pages = OnboardingChoices.pages(for: picks)
            if pages.isEmpty { return String(localized: "A preview of your Home.") }
            return String(localized: "A preview of your Home with \(pages.count) new starter pages: \(OnboardingChoices.list(pages.map(\.title))).")
        default:
            let style = OnboardingChoices.styleName(styleId)
            return step == 4 && ai
                ? String(localized: "A preview of your “\(OnboardingChoices.welcomeTitle)” page in the \(style) style, with the Ask AI panel open.")
                : String(localized: "A preview of your “\(OnboardingChoices.welcomeTitle)” page in the \(style) style.")
        }
    }

    private var heading: String {
        let name = app.profile?.displayName.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let first = name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? name
        switch step {
        case 0: return first.isEmpty ? String(localized: "Welcome.") : String(localized: "Welcome, \(first).")
        case 1: return String(localized: "What will you use Folevi for?")
        case 2: return String(localized: "Pick a style for your first page")
        case 3: return String(localized: "Light or dark?")
        case 4: return String(localized: "Meet your AI Assistant")
        default: return String(localized: "Your Folevi is ready.")
        }
    }

    private var lede: String {
        switch step {
        case 0: return String(localized: "Folevi is a notes app for documents, tasks and linked pages. Let’s set up your Personal space. It takes about a minute.")
        case 1: return String(localized: "Pick any that fit. Each one adds two starter pages made from Folevi’s templates, next to the pages we already made for you.")
        case 2: return String(localized: "A note style gives a page its cover, paper and text colours. This one is for “\(OnboardingChoices.welcomeTitle)”. New pages start Plain.")
        case 3: return String(localized: "The app around your notes stays white, or near-black in dark mode, so your notes carry the colour. You can change this in Settings.")
        case 4: return String(localized: "It answers questions from your notes and links the notes it used, so you can check the answer.")
        default: return String(localized: "Here’s what we set up. Your Welcome page has a short tour and a few things to try.")
        }
    }

    private var primaryTitle: String {
        if step == 0 { return String(localized: "Get started") }
        if step == last { return String(localized: "Open “\(OnboardingChoices.welcomeTitle)”") }
        return String(localized: "Continue")
    }

    /// AI is counted in credits: the trial's fixed allowance, then the plan's monthly credits. Core has none.
    private var aiPlanNote: String {
        guard let e = app.profile?.entitlements else { return "" }
        if e.ai, e.aiSource == "trial" {
            let until = e.trialEndsAt.map { String(localized: " until \(Date(timeIntervalSince1970: $0 / 1000).formatted(.dateTime.month(.wide).day()))") } ?? ""
            let free = PlanCatalog.monthlyCredits["free"] ?? 25
            return String(localized: "Included in your \(OnboardingChoices.trialDays)-day \(PlanTier.name("pro_ai")) trial, with \(PlanCatalog.trialCredits) AI credits\(until). After that, Free includes \(free) AI credits a month, and you can choose a plan with more in Settings.")
        }
        if e.ai { return String(localized: "Your plan includes \(Int(e.monthlyCredits ?? 0)) AI credits a month.") }
        return String(localized: "Your plan, \(PlanTier.name("core")), has no AI: nothing is sent to an AI model. You can change plans in Settings.")
    }

    private var summaryRows: [SummaryList.Row] {
        let pages = OnboardingChoices.pages(for: applied).map(\.title)
        let style = OnboardingChoices.styleName(savedStyle ?? styleId)
        let plain = OnboardingChoices.styleName(nil)
        let look = savedLook
        return [
            .init(icon: .symbol("doc.on.doc"),
                  title: pages.isEmpty ? String(localized: "Starter pages") : pages.count == 1 ? String(localized: "1 starter page") : String(localized: "\(pages.count) starter pages"),
                  body: pages.isEmpty ? String(localized: "None this time. You’ll find templates in the sidebar.") : OnboardingChoices.list(pages)),
            .init(icon: .symbol("paintbrush"), title: OnboardingChoices.welcomeTitle,
                  body: style == plain ? String(localized: "Plain, like every new page") : String(localized: "In the \(style) style")),
            .init(icon: .symbol("circle.lefthalf.filled"), title: String(localized: "Appearance"),
                  body: look == .system ? String(localized: "Matches your system") : look == .dark ? String(localized: "Dark") : String(localized: "Light")),
            .init(icon: .ai, title: String(localized: "AI Assistant"),
                  body: savedAI ? String(localized: "On. Press ⌘J in a note to ask.") : String(localized: "Off. Turn it on in Settings any time.")),
        ]
    }

    // MARK: Actions

    private func go(_ to: Int) {
        forward = to >= step
        error = nil
        step = max(0, min(last, to))
    }

    private func cont() {
        guard !busy else { return }
        switch step {
        case 0: save(.init(step: "workspace"))
        case 1: save(.init(step: "uses", useCases: picks.isEmpty ? nil : picks))
        case 2: save(.init(step: "style", noteStyle: OnboardingChoices.isNoteStyle(styleId) ? styleId : nil))
        case 3: save(.init(step: "appearance", appearance: look.rawValue))
        case 4: save(.init(step: "ai", aiEnabled: ai))
        default:
            let welcomeId = welcome?.id
            run {
                try await app.completeOnboarding(.init(step: "welcome"))
                if let id = welcomeId ?? welcome?.id { app.pendingOpenDocumentId = id }
            }
        }
    }

    /// Leaves this step's choice as it was saved, and moves on.
    private func skip() {
        if step == 1 { picks = applied }
        if step == 2, let savedStyle { styleId = savedStyle }
        if step == 3 {
            look = savedLook
            app.appearance = savedLook
        }
        if step == 4 { ai = savedAI }
        save(.init(step: Self.steps[step].key))
    }

    /// Skips everything left and goes to the summary.
    private func skipAll() {
        picks = applied
        if let savedStyle { styleId = savedStyle }
        look = savedLook
        app.appearance = savedLook
        ai = savedAI
        save(.init(step: "ai"), to: last)
    }

    /// Switches the theme live.
    private func pickAppearance(_ value: AppearancePreference) {
        guard value != look else { return }
        look = value
        app.appearance = value
    }

    private func save(_ choice: OnboardingStepChoice, to target: Int? = nil) {
        let to = target ?? step + 1
        run {
            try await app.completeOnboarding(choice)
            go(to)
        }
    }

    private func run(_ body: @escaping @MainActor () async throws -> Void) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do { try await body() } catch { self.error = ConvexService.mapError(error).localizedDescription }
        }
    }
}

// MARK: - Progress

private struct ProgressSegment: View {
    enum State { case done, current, next }
    var state: State
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Capsule()
            .fill(FoleviColor.heading.opacity(0.12))
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(FoleviColor.heading)
                    .opacity(state == .current ? 0.45 : 1)
                    .scaleEffect(x: state == .next ? 0 : 1, anchor: .leading)
            }
            .clipShape(Capsule())
            .frame(height: 3)
            .frame(maxWidth: .infinity)
            .animation(reduceMotion ? nil : OnboardingMotion.ease(0.52), value: state)
    }
}

// MARK: - Shared pieces

/// A 36 pt tile with an icon, on the surface with the card shadow (the web's IconTile).
private struct IconTile: View {
    enum Glyph { case symbol(String), ai }
    var glyph: Glyph

    var body: some View {
        Group {
            switch glyph {
            case .symbol(let name):
                Image(systemName: name).font(.system(size: 15, weight: .regular)).foregroundStyle(FoleviColor.heading)
            case .ai:
                AiIcon(size: 17)
            }
        }
        .frame(width: 36, height: 36)
        .foleviSurface(.color(FoleviColor.surface), shape: .rounded(9), shadow: FoleviShadow.card)
        .accessibilityHidden(true)
    }
}

/// Icon, title and a line of text (the web's FactList), rising in one after another.
private struct FactList: View {
    struct Item {
        var icon: String
        var title: String
        var body: String
    }

    var items: [Item]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(items.indices, id: \.self) { i in
                HStack(alignment: .top, spacing: 14) {
                    IconTile(glyph: .symbol(items[i].icon))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(items[i].title).font(.ui(14.5, .semibold)).foregroundStyle(FoleviColor.heading)
                        Text(items[i].body)
                            .font(.ui(13.5))
                            .lineSpacing(4)
                            .foregroundStyle(FoleviColor.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 2)
                }
                .accessibilityElement(children: .combine)
                .onboardingRise(i)
            }
        }
    }
}

/// The check the web draws (`m2.5 6.2 2.3 2.3 4.7-5` in a 12 by 12 box).
struct OnboardingCheckShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 12, sy = rect.height / 12
        var p = Path()
        p.move(to: CGPoint(x: 2.5 * sx, y: 6.2 * sy))
        p.addLine(to: CGPoint(x: 4.8 * sx, y: 8.5 * sy))
        p.addLine(to: CGPoint(x: 9.5 * sx, y: 3.5 * sy))
        return p
    }
}

private struct CheckGlyph: View {
    var size: CGFloat = 12
    var body: some View {
        OnboardingCheckShape()
            .stroke(style: StrokeStyle(lineWidth: 1.8 * size / 12, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
    }
}

/// A choice card (`.ob-choice`): the surface with a hairline ring that lifts on hover; the chosen one gets a
/// heading-coloured ring.
private struct ChoiceCard<Label: View>: View {
    var selected: Bool
    var enabled = true
    var action: () -> Void
    @ViewBuilder var label: (_ hovering: Bool) -> Label
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            label(hovering)
                .frame(maxWidth: .infinity, alignment: .leading)
                .foleviSurface(.color(FoleviColor.surface), shape: .rounded(10), shadow: layers)
                .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .offset(y: hovering && !reduceMotion ? -1 : 0)
        }
        .buttonStyle(PressScaleStyle(scale: 0.99))
        .disabled(!enabled)
        .onHover { hovering = $0 && enabled }
        .animation(reduceMotion ? nil : OnboardingMotion.ease(0.18), value: hovering)
        .animation(reduceMotion ? nil : OnboardingMotion.ease(0.18), value: selected)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var layers: [FoleviShadowLayer] {
        if selected {
            return [
                FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1.5, color: FoleviColor.heading, inset: false),
                FoleviShadowLayer(x: 0, y: 8, blur: 22, spread: -10, color: .black.opacity(0.25), inset: false),
            ]
        }
        if hovering {
            return [
                FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.lineStrong, inset: false),
                FoleviShadowLayer(x: 0, y: 6, blur: 18, spread: -8, color: .black.opacity(0.18), inset: false),
            ]
        }
        return [
            FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: false),
            FoleviShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: .black.opacity(0.04), inset: false),
        ]
    }
}

/// Presses in slightly (`:active { scale(0.99) }`).
private struct PressScaleStyle: ButtonStyle {
    var scale: CGFloat
    func makeBody(configuration: Configuration) -> some View {
        PressScaleBody(configuration: configuration, scale: scale)
    }
}

private struct PressScaleBody: View {
    let configuration: ButtonStyle.Configuration
    let scale: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .animation(reduceMotion ? nil : OnboardingMotion.ease(0.18), value: configuration.isPressed)
    }
}

/// A note style's thumbnail, filling its frame.
private struct ArtThumb: View {
    var id: String
    var body: some View {
        if let image = CoverArt.thumbnail(id) {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fill)
                .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                .clipped()
        } else {
            FoleviColor.surfaceSunken
        }
    }
}

// MARK: - Step 2: use cases

private struct UseCasePicker: View {
    var picks: [String]
    var applied: [String]
    var toggle: (String, Bool) -> Void

    private var newPages: [String] {
        let already = Set(OnboardingChoices.pages(for: applied).map(\.template))
        return OnboardingChoices.pages(for: picks).filter { !already.contains($0.template) }.map(\.title)
    }

    private var note: String {
        let pages = newPages
        if !pages.isEmpty {
            return pages.count == 1
                ? String(localized: "Adds 1 page: \(pages[0]).")
                : String(localized: "Adds \(pages.count) pages: \(OnboardingChoices.list(pages)).")
        }
        return applied.isEmpty
            ? String(localized: "Nothing picked yet. You can skip this and add templates any time.")
            : String(localized: "Those pages are in your Personal.")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(Array(OnboardingChoices.useCases.enumerated()), id: \.element.id) { i, u in
                    let added = applied.contains(u.id)
                    let on = picks.contains(u.id)
                    ChoiceCard(selected: on, enabled: !added, action: { toggle(u.id, !on) }) { hovering in
                        HStack(spacing: 12) {
                            ArtThumb(id: u.art)
                                .scaleEffect(hovering || on ? 1.06 : 1)
                                .animation(OnboardingMotion.ease(0.42), value: hovering || on)
                                .frame(width: 48, height: 48)
                                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(Color.black.opacity(0.06), lineWidth: 1))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(u.label).font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                                Text(added ? String(localized: "Added") : OnboardingChoices.list(u.pages.map(\.title)))
                                    .font(.ui(12.5))
                                    .foregroundStyle(FoleviColor.inkMuted)
                                    .lineLimit(2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            CheckSquare(on: on)
                        }
                        .padding(.leading, 8)
                        .padding(.vertical, 8)
                        .padding(.trailing, 12)
                    }
                    .accessibilityLabel(Text(u.label))
                    .accessibilityValue(Text(added ? String(localized: "Added") : OnboardingChoices.list(u.pages.map(\.title))))
                    .onboardingRise(i)
                }
            }
            Text(note)
                .font(.ui(13))
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(minHeight: 20, alignment: .topLeading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.updatesFrequently)
        }
        .onChange(of: note) { _, text in
            // The web's aria-live="polite" line.
            AccessibilityNotification.Announcement(text).post()
        }
    }
}

/// The check in a use-case card, as the editor draws a checkbox (`.ob-check`).
private struct CheckSquare: View {
    var on: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 5, style: .continuous)
        ZStack {
            shape.fill(on ? FoleviColor.heading : .clear)
            shape.strokeBorder(FoleviColor.lineStrong, lineWidth: 1.5).opacity(on ? 0 : 1)
            CheckGlyph()
                .foregroundStyle(FoleviColor.canvas)
                .scaleEffect(on ? 1 : 0.4)
                .opacity(on ? 1 : 0)
                .animation(reduceMotion ? nil : OnboardingMotion.spring(0.26), value: on)
        }
        .frame(width: 18, height: 18)
        .animation(reduceMotion ? nil : OnboardingMotion.ease(0.16), value: on)
        .accessibilityHidden(true)
    }
}

// MARK: - Step 3: note style

private struct StylePicker: View {
    var value: String
    var pick: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 14) {
                let ids = [OnboardingChoices.plain] + OnboardingChoices.noteStyles
                ForEach(Array(ids.enumerated()), id: \.element) { i, id in
                    StyleTile(id: id, selected: value == id) { pick(id) }
                        .onboardingRise(i)
                }
            }
            Text("\(CoverArt.all.count) styles in all. Change any page’s style from Style in the page tools.")
                .font(.ui(13))
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The artwork fills the tile; the chosen one gets a ring and a badge (`.ob-tile`).
private struct StyleTile: View {
    var id: String
    var selected: Bool
    var action: () -> Void
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let plain = id == OnboardingChoices.plain
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        Button(action: action) {
            VStack(spacing: 6) {
                Color.clear
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay {
                        if plain {
                            ZStack {
                                FoleviColor.surface
                                Text("Aa").font(FoleviType.display(26)).foregroundStyle(FoleviColor.heading)
                            }
                        } else {
                            ArtThumb(id: id)
                        }
                    }
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(plain ? FoleviColor.line : Color.black.opacity(0.08), lineWidth: 1))
                    .overlay(alignment: .topTrailing) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10.5, weight: .bold))
                            .foregroundStyle(FoleviColor.canvas)
                            .frame(width: 22, height: 22)
                            .background(Circle().fill(FoleviColor.heading).shadow(color: .black.opacity(0.3), radius: 4, y: 2))
                            .scaleEffect(selected ? 1 : 0.3)
                            .opacity(selected ? 1 : 0)
                            .padding(7)
                            .animation(reduceMotion ? nil : OnboardingMotion.spring(0.32), value: selected)
                    }
                    // Chosen: a 2 pt gap in the canvas colour, then a 2 pt heading ring.
                    .overlay(shape.inset(by: -3).stroke(FoleviColor.heading, lineWidth: 2).opacity(selected ? 1 : 0))
                    .shadow(color: .black.opacity(selected ? 0.22 : hovering ? 0.2 : 0), radius: selected || hovering ? 10 : 0, y: selected ? 10 : 8)
                    .offset(y: hovering && !reduceMotion ? -2 : 0)
                Text(OnboardingChoices.styleName(id))
                    .font(.ui(12.5, .medium))
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(reduceMotion ? nil : OnboardingMotion.ease(0.2), value: hovering)
        .animation(reduceMotion ? nil : OnboardingMotion.ease(0.2), value: selected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(OnboardingChoices.styleName(id)))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Step 4: appearance

private struct AppearancePicker: View {
    var value: AppearancePreference
    var styleId: String?
    var pick: (AppearancePreference) -> Void

    private let options: [(value: AppearancePreference, label: String, icon: String)] = [
        (.light, String(localized: "Light"), "sun.max"),
        (.dark, String(localized: "Dark"), "moon"),
        (.system, String(localized: "Match system"), "desktopcomputer"),
    ]

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(Array(options.enumerated()), id: \.element.value) { i, o in
                ChoiceCard(selected: value == o.value, action: { pick(o.value) }) { _ in
                    VStack(alignment: .leading, spacing: 10) {
                        mini(o.value)
                        HStack(spacing: 8) {
                            Image(systemName: o.icon).font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                            Text(o.label).font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                        }
                        .padding(.horizontal, 4)
                        .padding(.bottom, 2)
                    }
                    .padding(8)
                }
                .accessibilityLabel(Text(o.label))
                .onboardingRise(i)
            }
        }
    }

    private func mini(_ mode: AppearancePreference) -> some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return Color.clear
            .aspectRatio(16 / 10, contentMode: .fit)
            .overlay {
                switch mode {
                case .light: MiniWindow(dark: false, styleId: styleId)
                case .dark: MiniWindow(dark: true, styleId: styleId)
                case .system:
                    ZStack {
                        MiniWindow(dark: false, styleId: styleId)
                        MiniWindow(dark: true, styleId: styleId).clipShape(SplitShape())
                    }
                }
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.black.opacity(0.1), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// `polygon(62% 0, 100% 0, 100% 100%, 38% 100%)`: the dark half of Match system.
private struct SplitShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.width * 0.62, y: 0))
        p.addLine(to: CGPoint(x: rect.width, y: 0))
        p.addLine(to: CGPoint(x: rect.width, y: rect.height))
        p.addLine(to: CGPoint(x: rect.width * 0.38, y: rect.height))
        p.closeSubpath()
        return p
    }
}

/// A tiny window in fixed light or dark colours, with the Welcome page in its chosen style.
private struct MiniWindow: View {
    var dark: Bool
    var styleId: String?

    var body: some View {
        let art = styleId.flatMap { CoverArt.entry($0) }
        let bg = Color(hex: dark ? "#0c0c0e" : "#eeeef1") ?? .gray
        let ink = Color(hex: dark ? "#f2f2f3" : "#18181b") ?? .black
        let muted = Color(hex: dark ? "#4a4a50" : "#c9c9cf") ?? .gray
        let paper = (dark ? art?.paperDark : art?.paper).flatMap { Color(hex: $0) } ?? (Color(hex: dark ? "#1c1c1e" : "#ffffff") ?? .white)
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let pad = w * 0.06
            HStack(alignment: .top, spacing: w * 0.05) {
                VStack(alignment: .leading, spacing: h * 0.09) {
                    ForEach([0.75, 1, 0.667, 0.833], id: \.self) { f in
                        Capsule().fill(muted).frame(width: w * 0.26 * f, height: h * 0.05)
                    }
                }
                .frame(width: w * 0.26, alignment: .leading)
                .padding(.top, h * 0.04)
                VStack(alignment: .leading, spacing: 0) {
                    if let art, let image = CoverArt.thumbnail(art.id) {
                        Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
                            .frame(maxWidth: .infinity).frame(height: (h - pad * 2) * 0.34).clipped()
                    }
                    let inner = (w - pad * 2 - w * 0.31) * 0.09
                    VStack(alignment: .leading, spacing: inner * 0.7) {
                        Capsule().fill(ink.opacity(0.85)).frame(height: 9).frame(maxWidth: .infinity).scaleEffect(x: 2 / 3, anchor: .leading)
                        Capsule().fill(ink.opacity(0.25)).frame(height: 4).frame(maxWidth: .infinity)
                        Capsule().fill(ink.opacity(0.25)).frame(height: 4).frame(maxWidth: .infinity).scaleEffect(x: 5 / 6, anchor: .leading)
                    }
                    .padding(inner)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(paper)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
            }
            .padding(pad)
            .frame(width: w, height: h)
        }
        .background(bg)
        .environment(\.colorScheme, dark ? .dark : .light)
    }
}

// MARK: - Step 5: AI Assistant

/// The AI mark on a tile; it turns and greys as the assistant switches off (`.ob-ai-mark`).
private struct AiMarkTile: View {
    var on: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        AiIcon(size: 30)
            .frame(width: 56, height: 56)
            .foleviSurface(.color(FoleviColor.surface), shape: .rounded(16), shadow: FoleviShadow.card)
            .animation(reduceMotion ? nil : OnboardingMotion.spring(0.7)) {
                $0.rotationEffect(.degrees(on || reduceMotion ? 0 : -45)).scaleEffect(on ? 1 : 0.86)
            }
            .animation(reduceMotion ? nil : OnboardingMotion.ease(0.4)) {
                $0.grayscale(on ? 0 : 1).opacity(on ? 1 : 0.55)
            }
            .accessibilityHidden(true)
    }
}

private struct AiChoice: View {
    @Binding var on: Bool
    var plan: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FactList(items: [
                .init(icon: "text.bubble", title: String(localized: "Ask AI"), body: String(localized: "Ask a question about your notes and get an answer with links to its sources.")),
                .init(icon: "sparkles", title: String(localized: "Catch me up"), body: String(localized: "On Home, a short brief of your week: recent notes and what’s due.")),
                .init(icon: "pencil.line", title: String(localized: "Writing help"), body: String(localized: "Rewrite, shorten, fix or summarize the text you select, or press ⌘J in a note.")),
            ])
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(on ? String(localized: "AI Assistant on") : String(localized: "AI Assistant off"))
                        .font(.ui(14.5, .semibold))
                        .foregroundStyle(FoleviColor.heading)
                    Text("When you use it, your request and the notes it needs are sent to Google Gemini. Nothing is sent while it’s off, and the AI buttons are hidden.")
                        .font(.ui(13))
                        .lineSpacing(4)
                        .foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityHidden(true)
                FoleviToggleSwitch(
                    isOn: $on,
                    label: String(localized: "AI Assistant"),
                    hint: String(localized: "When you use it, your request and the notes it needs are sent to Google Gemini. Nothing is sent while it’s off, and the AI buttons are hidden.")
                )
                .accessibilityIdentifier("onboarding.ai")
            }
            .padding(16)
            .foleviSurface(.color(FoleviColor.surface), shape: .rounded(12), shadow: FoleviShadow.card)
            .padding(.top, 24)
            .onboardingRise(3)
            if !plan.isEmpty {
                Text(plan)
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)
            }
        }
    }
}

// MARK: - Step 6: summary

private struct SummaryList: View {
    struct Row {
        var icon: IconTile.Glyph
        var title: String
        var body: String
    }

    var rows: [Row]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows.indices, id: \.self) { i in
                HStack(spacing: 14) {
                    IconTile(glyph: rows[i].icon)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(rows[i].title).font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading)
                        Text(rows[i].body).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    DrawnCheck(index: i)
                }
                .padding(12)
                .padding(.trailing, 4)
                .foleviSurface(.color(FoleviColor.surface), shape: .rounded(12), shadow: FoleviShadow.card)
                .accessibilityElement(children: .combine)
                .onboardingRise(i)
            }
        }
    }
}

/// A check that draws itself (`.ob-draw`).
private struct DrawnCheck: View {
    var index: Int
    @State private var drawn = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        OnboardingCheckShape()
            .trim(from: 0, to: drawn || reduceMotion ? 1 : 0)
            .stroke(FoleviColor.canvas, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
            .frame(width: 12, height: 12)
            .frame(width: 24, height: 24)
            .background(Circle().fill(FoleviColor.heading))
            .accessibilityHidden(true)
            .onAppear {
                guard !drawn, !reduceMotion else { return }
                withAnimation(OnboardingMotion.ease(0.52).delay(Double(index) * 0.11 + 0.36)) { drawn = true }
            }
    }
}
