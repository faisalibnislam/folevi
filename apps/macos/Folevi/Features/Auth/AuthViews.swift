import SwiftUI

/// Routes the main window by auth phase.
struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            switch app.phase {
            case .launching:
                // The web's AccountGate while it asks who you are.
                FullPageMessage(title: String(localized: "Opening your folio…"), busy: true)
            case .notConfigured:
                NotConfiguredView()
            case .signedOut, .signingIn:
                SignInView()
            case .emailUnverified, .mfaRequired, .suspended, .sessionRevoked, .settingUp, .setupFailed, .offline:
                AccountStateView(phase: app.phase)
            case .deviceLimit(let limit, _):
                DeviceLimitScreen(limit: limit)
            case .onboarding:
                OnboardingView()
            case .ready:
                MainWindowView()
            }
        }
        .sheet(isPresented: Binding(get: { app.showNewWorkspace }, set: { app.showNewWorkspace = $0 })) { NewWorkspaceSheet().environment(app) }
        .onOpenURL { url in InviteLink.open(url) }
    }
}

private struct AuthCard<Content: View>: View {
    var width: CGFloat = 440
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 22) {
            content
        }
        .foregroundStyle(FoleviColor.ink)
        .padding(44)
        .frame(width: width)
        .foleviSurface(.color(FoleviColor.surface), shape: .rounded(FoleviRadius.sheet), shadow: FoleviShadow.sheet)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CanvasBackground())
        .background(WindowChrome())
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .ignoresSafeArea()
    }
}

/// The brand mark at sign-in and account screens.
private struct BrandTile: View {
    var size: CGFloat = 64
    var body: some View {
        FoleviMark(size: size).shadow(color: .black.opacity(0.12), radius: size * 0.12, y: size * 0.06)
    }
}

struct SignInView: View {
    @Environment(AppModel.self) private var app

    private var message: String? {
        if case .signedOut(let m) = app.phase { return m }
        return nil
    }

    var body: some View {
        AuthCard {
            BrandTile(size: 60)
            VStack(spacing: 8) {
                Text("Welcome to Folevi").font(FoleviType.display(30)).tracking(FoleviType.displayTracking(30)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
                Text("Your living folio of notes, plans and tasks.")
                    .foregroundStyle(FoleviColor.inkMuted)
            }
            if let message {
                Text(message)
                    .font(.ui(12.5))
                    .foregroundStyle(FoleviColor.coralInk)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("signIn.message")
            }
            if app.phase == .signingIn {
                ProgressView("Signing in…").controlSize(.small)
            } else {
                VStack(spacing: 10) {
                    Button {
                        Task { await app.signInWithFolevi() }
                    } label: {
                        Text("Sign in or Create Account")
                    }
                    .buttonStyle(.folevi(.primary, .large, fullWidth: true))
                    .disabled(!app.config.isSignInConfigured)
                    .accessibilityIdentifier("signIn.folevi")
                    Text(app.config.isSignInConfigured
                         ? "You'll continue in your browser, where you can also create an account."
                         : "Folevi isn't configured for sign-in yet. Set FOLEVI_APP_URL in the app configuration.")
                        .font(.ui(11.5))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .multilineTextAlignment(.center)
                    if let error = app.signInError {
                        Text(error).font(.ui(11.5)).foregroundStyle(FoleviColor.destructive)
                    }
                }
            }
            Text("By continuing you agree to Folevi's Terms and Privacy Policy.")
                .font(.ui(10.5))
                .foregroundStyle(FoleviColor.inkFaint)
        }
    }
}

struct NotConfiguredView: View {
    var body: some View {
        AuthCard {
            BrandTile(size: 52)
            Text("Folevi isn't configured yet").font(FoleviType.display(24)).tracking(FoleviType.displayTracking(24)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
            Text("This build doesn't have a Folevi server address. Set CONVEX_URL in Config/*.xcconfig and rebuild.")
                .multilineTextAlignment(.center)
                .foregroundStyle(FoleviColor.inkMuted)
        }
    }
}

/// The choices onboarding offers (convex/lib/onboarding.ts, shared with the web).
@MainActor
enum OnboardingChoices {
    struct UseCase: Identifiable {
        var id: String
        var label: String
        var art: String
        /// The starter pages it adds (built-in template keys and titles).
        var pages: [(template: String, title: String)]
    }

    static let plain = "plain"
    static let noteStyles = ["art-03", "art-39", "art-40", "art-09", "art-01", "art-30", "art-49", "art-57"]
    static let useCases: [UseCase] = [
        UseCase(id: "notes", label: String(localized: "Personal notes"), art: "art-05", pages: [("daily-page", "Daily Page"), ("brainstorm", "Brainstorm")]),
        UseCase(id: "work", label: String(localized: "Work projects"), art: "art-16", pages: [("project-brief", "Project Brief"), ("meeting-notes", "Meeting Notes")]),
        UseCase(id: "study", label: String(localized: "Study and research"), art: "art-38", pages: [("class-notes", "Class Notes"), ("research-notes", "Research Notes")]),
        UseCase(id: "journal", label: String(localized: "Journaling"), art: "art-09", pages: [("journal", "Journal Entry"), ("habit-tracker", "Habit Tracker")]),
        UseCase(id: "travel", label: String(localized: "Trips and events"), art: "art-30", pages: [("travel-plan", "Travel Plan"), ("event-plan", "Event Plan")]),
        UseCase(id: "team", label: String(localized: "Team knowledge"), art: "art-06", pages: [("meeting-notes", "Meeting Notes"), ("retrospective", "Retrospective")]),
        UseCase(id: "writing", label: String(localized: "Writing"), art: "art-46", pages: [("writing-draft", "Writing Draft"), ("reading-notes", "Reading Notes")]),
        UseCase(id: "home", label: String(localized: "Home and health"), art: "art-24", pages: [("budget", "Monthly Budget"), ("recipe", "Recipe")]),
    ]

    /// The starter pages of `ids`, each template once.
    static func pages(for ids: [String]) -> [(template: String, title: String)] {
        var seen = Set<String>()
        var out: [(template: String, title: String)] = []
        for u in useCases where ids.contains(u.id) {
            for p in u.pages where seen.insert(p.template).inserted { out.append(p) }
        }
        return out
    }

    static func styleName(_ id: String) -> String {
        id == plain ? String(localized: "Plain") : CoverArt.name(id)
    }

    static func list(_ items: [String]) -> String {
        guard items.count > 1 else { return items.first ?? "" }
        return items.dropLast().joined(separator: ", ") + String(localized: " and ") + items.last!
    }
}

/// Six steps, like the web: a welcome, starter pages, the Welcome page's note style, appearance, the AI
/// Assistant, and a summary that opens the Welcome page. Each step is saved as it's finished, so leaving
/// halfway resumes in the right place on any device.
struct OnboardingView: View {
    @Environment(AppModel.self) private var app
    @State private var step = 0
    @State private var picks: [String] = []
    @State private var styleId = OnboardingChoices.plain
    @State private var appearance: AppearancePreference = .system
    @State private var ai = true
    @State private var working = false
    @State private var error: String?

    private static let keys = ["workspace", "uses", "style", "appearance", "ai", "welcome"]
    private static let names: [LocalizedStringKey] = ["Welcome", "Your pages", "Note style", "Appearance", "AI Assistant", "Ready"]
    private var last: Int { Self.keys.count - 1 }
    private var applied: [String] { app.profile?.onboardingUseCases ?? [] }
    private var newPages: [String] {
        let already = Set(OnboardingChoices.pages(for: applied).map(\.template))
        return OnboardingChoices.pages(for: picks).filter { !already.contains($0.template) }.map(\.title)
    }

    var body: some View {
        AuthCard(width: 600) {
            VStack(alignment: .leading, spacing: 20) {
                header
                VStack(alignment: .leading, spacing: 8) {
                    Text(heading).font(FoleviType.display(28)).tracking(FoleviType.displayTracking(28)).foregroundStyle(FoleviColor.heading)
                        .accessibilityAddTraits(.isHeader)
                    Text(lede).font(.ui(14)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                content
                if let error { Text(error).font(.ui(11.5)).foregroundStyle(FoleviColor.destructive) }
                footer
            }
        }
        .onAppear {
            appearance = app.appearance
            picks = applied
            ai = app.profile?.aiEnabled != false
            step = max(0, Self.keys.firstIndex(of: app.profile?.onboardingStep ?? "") ?? 0)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                ForEach(0..<Self.keys.count, id: \.self) { i in
                    Capsule().fill(i <= step ? FoleviColor.heading : FoleviColor.line).frame(height: 4)
                }
            }
            HStack {
                (Text("\(step + 1)").foregroundStyle(FoleviColor.heading) + Text(" of \(Self.keys.count) · ") + Text(Self.names[step]))
                    .font(.ui(12, .medium)).foregroundStyle(FoleviColor.inkMuted)
                Spacer()
                if step < last {
                    Button("Skip setup") { skipAll() }
                        .buttonStyle(.folevi(.quiet, .small))
                        .disabled(working)
                        .accessibilityIdentifier("onboarding.skipAll")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Step \(step + 1) of \(Self.keys.count)"))
    }

    private var heading: String {
        let first = app.profile?.displayName.split(separator: " ").first.map(String.init) ?? ""
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
        case 2: return String(localized: "A note style gives a page its cover, paper and text colours. This one is for “Welcome to Folevi”. New pages start Plain.")
        case 3: return String(localized: "The app around your notes stays white, or near-black in dark mode, so your notes carry the colour. You can change this in Settings.")
        case 4: return String(localized: "It answers questions from your notes and links the notes it used, so you can check the answer.")
        default: return String(localized: "Here’s what we set up. Your Welcome page has a short tour and a few things to try.")
        }
    }

    @ViewBuilder private var content: some View {
        switch step {
        case 0:
            FactList(items: [
                ("wifi.slash", String(localized: "Works offline"), String(localized: "Your writing is saved on this Mac first, and syncs when you reconnect.")),
                ("link", String(localized: "Pages that link up"), String(localized: "Type [[ to link one page to another. The page you link to shows a backlink.")),
                ("person.2", String(localized: "Yours, and easy to share"), String(localized: "Personal is your own space. Share single pages with anyone, or start a workspace for a team any time.")),
            ])
        case 1: useCases
        case 2: styles
        case 3:
            FoleviSegmented(selection: $appearance, items: [
                .init(value: .light, title: "Light", systemImage: "sun.max"),
                .init(value: .dark, title: "Dark", systemImage: "moon"),
                .init(value: .system, title: "Match system", systemImage: "desktopcomputer"),
            ], height: 34, fontSize: 13, accessibilityLabel: "Appearance")
            .onChange(of: appearance) { _, v in app.appearance = v }
        case 4: aiChoice
        default: summary
        }
    }

    private var useCases: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(OnboardingChoices.useCases) { u in
                    let added = applied.contains(u.id)
                    let on = picks.contains(u.id)
                    Button {
                        if on { picks.removeAll { $0 == u.id } } else { picks.append(u.id) }
                    } label: {
                        HStack(spacing: 10) {
                            ArtSwatch(id: u.art).frame(width: 40, height: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(u.label).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading)
                                Text(added ? String(localized: "Added") : OnboardingChoices.list(u.pages.map(\.title)))
                                    .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(2)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(on ? FoleviColor.heading : FoleviColor.line)
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10).fill(FoleviColor.surfaceRaised))
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(on ? FoleviColor.heading : FoleviColor.line, lineWidth: on ? 1.5 : 1))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(added)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            Text(usesNote).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
        }
    }

    private var usesNote: String {
        let pages = newPages
        if !pages.isEmpty {
            return pages.count == 1 ? String(localized: "Adds 1 page: \(pages[0]).") : String(localized: "Adds \(pages.count) pages: \(OnboardingChoices.list(pages)).")
        }
        return applied.isEmpty ? String(localized: "Nothing picked yet. You can skip this and add templates any time.") : String(localized: "Those pages are in your Personal.")
    }

    private var styles: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 12) {
                ForEach([OnboardingChoices.plain] + OnboardingChoices.noteStyles, id: \.self) { id in
                    Button { styleId = id } label: {
                        VStack(spacing: 5) {
                            Group {
                                if id == OnboardingChoices.plain {
                                    ZStack {
                                        FoleviColor.surface
                                        Text("Aa").font(FoleviType.display(22)).foregroundStyle(FoleviColor.heading)
                                    }
                                } else {
                                    ArtSwatch(id: id)
                                }
                            }
                            .frame(height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(styleId == id ? FoleviColor.heading : FoleviColor.line, lineWidth: styleId == id ? 2 : 1))
                            Text(OnboardingChoices.styleName(id)).font(.ui(11.5, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(OnboardingChoices.styleName(id)))
                    .accessibilityAddTraits(styleId == id ? .isSelected : [])
                }
            }
            Text("\(CoverArt.all.count) styles in all. Change any page’s style from Style in the page tools.").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
        }
    }

    private var aiChoice: some View {
        VStack(alignment: .leading, spacing: 14) {
            FactList(items: [
                ("bubble.left.and.text.bubble.right", String(localized: "Ask AI"), String(localized: "Ask a question about your notes and get an answer with links to its sources.")),
                ("sparkles", String(localized: "Catch me up"), String(localized: "On Home, a short brief of your week: recent notes and what’s due.")),
                ("pencil.line", String(localized: "Writing help"), String(localized: "Rewrite, shorten, fix or summarize the text you select, or press ⌘J in a note.")),
            ])
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(ai ? "AI Assistant on" : "AI Assistant off").font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.heading)
                    Text("When you use it, your request and the notes it needs are sent to Google Gemini. Nothing is sent while it’s off, and the AI buttons are hidden.")
                        .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Toggle("AI Assistant", isOn: $ai).labelsHidden().toggleStyle(.switch).accessibilityIdentifier("onboarding.ai")
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 12).fill(FoleviColor.surfaceRaised))
            Text(aiPlanNote).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var aiPlanNote: String {
        guard let e = app.profile?.entitlements else { return "" }
        if e.ai, e.aiSource == "trial" {
            let ends = e.trialEndsAt.map { Date(timeIntervalSince1970: $0 / 1000).formatted(.dateTime.month(.wide).day()) }
            let until = ends.map { String(localized: " until \($0)") } ?? ""
            return String(localized: "Included in your 7-day Pro AI trial, with 100 AI credits\(until). After that, Free includes 25 AI credits a month, and you can choose a plan with more in Settings.")
        }
        if e.ai { return String(localized: "Your plan includes \(Int(e.monthlyCredits ?? 0)) AI credits a month.") }
        return String(localized: "Your plan, Core, has no AI: nothing is sent to an AI model. You can change plans in Settings.")
    }

    private var summary: some View {
        let pages = OnboardingChoices.pages(for: picks).map(\.title)
        let style = OnboardingChoices.styleName(styleId)
        return FactList(items: [
            ("doc.on.doc", pages.isEmpty ? String(localized: "Starter pages") : String(localized: "\(pages.count) starter pages"),
             pages.isEmpty ? String(localized: "None this time. You’ll find templates in the sidebar.") : OnboardingChoices.list(pages)),
            ("paintbrush", String(localized: "Welcome to Folevi"), styleId == OnboardingChoices.plain ? String(localized: "Plain, like every new page") : String(localized: "In the \(style) style")),
            ("circle.lefthalf.filled", String(localized: "Appearance"),
             appearance == .system ? String(localized: "Matches your system") : appearance == .dark ? String(localized: "Dark") : String(localized: "Light")),
            ("sparkles", String(localized: "AI Assistant"), ai ? String(localized: "On. Press ⌘J in a note to ask.") : String(localized: "Off. Turn it on in Settings any time.")),
        ])
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if step > 0 && step < last {
                Button("Back") { error = nil; step -= 1 }.buttonStyle(.folevi(.quiet, .large)).disabled(working)
            }
            Spacer()
            if step > 0 && step < last {
                Button("Skip") { skip() }.buttonStyle(.folevi(.secondary, .large)).disabled(working)
            }
            Button(step == 0 ? "Get started" : step == last ? "Open “Welcome to Folevi”" : "Continue") { next() }
                .buttonStyle(.folevi(.primary, .large))
                .keyboardShortcut(.defaultAction)
                .disabled(working)
                .accessibilityIdentifier("onboarding.continue")
        }
    }

    private func next() {
        switch step {
        case 0: save(.init(step: "workspace"))
        case 1: save(.init(step: "uses", useCases: picks.isEmpty ? nil : picks))
        case 2: save(.init(step: "style", noteStyle: OnboardingChoices.noteStyles.contains(styleId) ? styleId : nil))
        case 3: save(.init(step: "appearance", appearance: appearance.rawValue))
        case 4: save(.init(step: "ai", aiEnabled: ai))
        default:
            run {
                try await app.completeOnboarding(.init(step: "welcome"))
                if let welcome = app.welcomeDocument { app.pendingOpenDocumentId = welcome.id }
            }
        }
    }

    /// Leaves this step's choice as it was saved, and moves on.
    private func skip() {
        if step == 1 { picks = applied }
        if step == 3 { appearance = app.appearance }
        if step == 4 { ai = app.profile?.aiEnabled != false }
        save(.init(step: Self.keys[step]))
    }

    private func skipAll() {
        picks = applied
        ai = app.profile?.aiEnabled != false
        save(.init(step: "ai"), to: last)
    }

    private func save(_ choice: OnboardingStepChoice, to target: Int? = nil) {
        run {
            try await app.completeOnboarding(choice)
            step = target ?? min(last, step + 1)
        }
    }

    private func run(_ body: @escaping @MainActor () async throws -> Void) {
        working = true
        error = nil
        Task {
            defer { working = false }
            do { try await body() } catch { self.error = ConvexService.mapError(error).localizedDescription }
        }
    }
}

/// Icon, title and a line of text, as the web's onboarding lists them.
private struct FactList: View {
    var items: [(icon: String, title: String, body: String)]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(items.indices, id: \.self) { i in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: items[i].icon)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(FoleviColor.heading)
                        .frame(width: 34, height: 34)
                        .background(RoundedRectangle(cornerRadius: 9).fill(FoleviColor.surfaceRaised))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(items[i].title).font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.heading)
                        Text(items[i].body).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

/// A note style's thumbnail, filling its frame.
private struct ArtSwatch: View {
    var id: String
    var body: some View {
        if let image = CoverArt.thumbnail(id) {
            Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
                .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity).clipped()
                .clipShape(RoundedRectangle(cornerRadius: 7))
        } else {
            RoundedRectangle(cornerRadius: 7).fill(FoleviColor.line)
        }
    }
}
