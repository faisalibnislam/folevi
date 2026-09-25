import SwiftUI

/// Routes the main window by auth phase.
struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            switch app.phase {
            case .launching:
                LaunchView()
            case .notConfigured:
                NotConfiguredView()
            case .signedOut, .signingIn:
                SignInView()
            case .emailUnverified, .mfaRequired, .suspended, .sessionRevoked:
                AccountStateView(phase: app.phase)
            case .onboarding:
                OnboardingView()
            case .ready:
                MainWindowView()
            }
        }
        .sheet(isPresented: Binding(get: { app.showHelp }, set: { app.showHelp = $0 })) { HelpView() }
    }
}

struct LaunchView: View {
    var body: some View {
        VStack(spacing: 16) {
            FoleviMark(size: 64).foregroundStyle(FoleviColor.accent)
            ProgressView().controlSize(.small)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(FoleviColor.canvas)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Opening Folevi"))
    }
}

private struct AuthCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 22) {
            content
        }
        .padding(40)
        .frame(width: 420)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(FoleviColor.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(FoleviColor.line))
        .shadow(color: .black.opacity(0.06), radius: 24, y: 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(colors: [FoleviColor.canvas, FoleviColor.accentSoft.opacity(0.35)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        )
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
            FoleviMark(size: 56).foregroundStyle(FoleviColor.accent)
            VStack(spacing: 8) {
                Text("Welcome to Folevi").font(FoleviType.display(30)).accessibilityAddTraits(.isHeader)
                Text("Your living folio of notes, plans and tasks.")
                    .foregroundStyle(FoleviColor.inkMuted)
            }
            if let message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(FoleviColor.coralInk)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("signIn.message")
            }
            if app.phase == .signingIn {
                ProgressView("Signing in…").controlSize(.small)
            } else {
                VStack(spacing: 10) {
                    Button {
                        Task { await app.signInWithAuth0() }
                    } label: {
                        Text("Sign In or Create Account").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!app.config.isAuth0Configured)
                    .accessibilityIdentifier("signIn.auth0")
                    if !app.config.isAuth0Configured {
                        Text("Folevi isn't configured for sign-in yet. Set AUTH0_DOMAIN and AUTH0_CLIENT_ID in the app configuration.")
                            .font(.caption)
                            .foregroundStyle(FoleviColor.inkMuted)
                            .multilineTextAlignment(.center)
                    }
                    if let error = app.signInError {
                        Text(error).font(.caption).foregroundStyle(FoleviColor.destructive)
                    }
                    #if DEBUG
                    if app.config.devAuthURL != nil {
                        Divider().padding(.vertical, 4)
                        Button("Developer Sign-In…") { app.showDevSignIn = true }
                            .buttonStyle(.link)
                            .accessibilityIdentifier("signIn.developer")
                    }
                    #endif
                }
            }
            Text("By continuing you agree to Folevi's Terms and Privacy Policy.")
                .font(.caption2)
                .foregroundStyle(FoleviColor.inkFaint)
        }
        #if DEBUG
        .sheet(isPresented: Binding(get: { app.showDevSignIn }, set: { app.showDevSignIn = $0 })) { DevSignInSheet() }
        #endif
    }
}

#if DEBUG
/// Development-only sign-in (DEBUG builds with FOLEVI_DEV_AUTH_URL set). Never compiled into Release.
struct DevSignInSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @AppStorage("dev.lastEmail") private var email = "ada@example.com"
    @AppStorage("dev.lastName") private var name = "Ada Example"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Developer Sign-In", systemImage: "hammer").font(.headline)
            Text("Signs in against the local development identity issuer. Not available in release builds.")
                .font(.caption).foregroundStyle(FoleviColor.inkMuted)
            TextField("Email", text: $email).textFieldStyle(.roundedBorder).accessibilityIdentifier("dev.email")
            TextField("Name", text: $name).textFieldStyle(.roundedBorder).accessibilityIdentifier("dev.name")
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Sign In") {
                    dismiss()
                    Task { await app.signInAsDeveloper(email: email, name: name) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!email.contains("@"))
            }
        }
        .padding(22)
        .frame(width: 360)
    }
}
#endif

struct AccountStateView: View {
    let phase: AppModel.Phase
    @Environment(AppModel.self) private var app

    private var content: (icon: String, title: LocalizedStringKey, message: LocalizedStringKey) {
        switch phase {
        case .emailUnverified:
            return ("envelope.badge", "Verify your email", "We sent a link to your inbox. Open it to verify your email address, then come back and try again.")
        case .mfaRequired:
            return ("lock.shield", "Two-step verification required", "Your workspace requires two-step verification. Set it up in your browser, then sign in again.")
        case .suspended:
            return ("hand.raised", "Account suspended", "This account has been suspended. If you think this is a mistake, contact support@folevi.com.")
        case .sessionRevoked:
            return ("rectangle.portrait.and.arrow.right", "Signed out", "This Mac was signed out from another device. Sign in again to continue.")
        default:
            return ("questionmark.circle", "Something went wrong", "Try signing in again.")
        }
    }

    var body: some View {
        AuthCard {
            Image(systemName: content.icon).font(.system(size: 40, weight: .light)).foregroundStyle(FoleviColor.accent).accessibilityHidden(true)
            Text(content.title).font(FoleviType.display(26)).accessibilityAddTraits(.isHeader)
            Text(content.message).multilineTextAlignment(.center).foregroundStyle(FoleviColor.inkMuted)
            HStack {
                if phase == .emailUnverified || phase == .mfaRequired {
                    Button("Try Again") { Task { await app.signIn(interactive: false) } }
                        .buttonStyle(.borderedProminent)
                }
                if phase == .sessionRevoked {
                    Button("Sign In") { Task { await app.signOut() } }.buttonStyle(.borderedProminent)
                }
                Button("Sign Out") { Task { await app.signOut() } }
            }
        }
    }
}

struct NotConfiguredView: View {
    var body: some View {
        AuthCard {
            FoleviMark(size: 48).foregroundStyle(FoleviColor.inkMuted)
            Text("Folevi isn't configured yet").font(FoleviType.display(24)).accessibilityAddTraits(.isHeader)
            Text("This build doesn't have a Folevi server address. Set CONVEX_URL in Config/*.xcconfig and rebuild.")
                .multilineTextAlignment(.center)
                .foregroundStyle(FoleviColor.inkMuted)
        }
    }
}

/// Three steps: name the workspace, pick an appearance, open the Welcome document.
struct OnboardingView: View {
    @Environment(AppModel.self) private var app
    @State private var step: Int
    @State private var workspaceName = ""
    @State private var appearance: AppearancePreference = .system
    @State private var working = false
    @State private var error: String?

    init() {
        _step = State(initialValue: 0)
    }

    var body: some View {
        AuthCard {
            HStack(spacing: 6) {
                ForEach(0..<3) { i in
                    Capsule().fill(i <= step ? FoleviColor.accent : FoleviColor.line).frame(width: 28, height: 4)
                }
            }
            .accessibilityElement()
            .accessibilityLabel(Text("Step \(step + 1) of 3"))
            switch step {
            case 0:
                Text("Name your workspace").font(FoleviType.display(26)).accessibilityAddTraits(.isHeader)
                Text("This is where your documents live. You can change it later.").foregroundStyle(FoleviColor.inkMuted).multilineTextAlignment(.center)
                TextField("Workspace name", text: $workspaceName)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { next() }
                    .accessibilityIdentifier("onboarding.workspace")
            case 1:
                Text("Choose an appearance").font(FoleviType.display(26)).accessibilityAddTraits(.isHeader)
                Picker("Appearance", selection: $appearance) {
                    ForEach(AppearancePreference.allCases) { p in Text(p.title).tag(p) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .onChange(of: appearance) { _, v in app.appearance = v }
            default:
                Text("You're all set").font(FoleviType.display(26)).accessibilityAddTraits(.isHeader)
                Text("Start with the Welcome document — it's a quick tour of blocks, tasks and shortcuts.")
                    .foregroundStyle(FoleviColor.inkMuted).multilineTextAlignment(.center)
            }
            if let error { Text(error).font(.caption).foregroundStyle(FoleviColor.destructive) }
            Button(step == 2 ? "Open Welcome" : "Continue") { next() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(working || (step == 0 && workspaceName.trimmingCharacters(in: .whitespaces).isEmpty))
                .accessibilityIdentifier("onboarding.continue")
        }
        .onAppear {
            workspaceName = app.workspace?.name ?? ""
            appearance = app.appearance
            switch app.profile?.onboardingStep {
            case "appearance": step = 1
            case "welcome": step = 2
            default: step = 0
            }
        }
    }

    private func next() {
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                switch step {
                case 0:
                    try await app.completeOnboarding(step: "workspace", workspaceName: workspaceName.trimmingCharacters(in: .whitespaces))
                    step = 1
                case 1:
                    try await app.completeOnboarding(step: "appearance", appearance: appearance.rawValue)
                    step = 2
                default:
                    try await app.completeOnboarding(step: "welcome")
                    if let welcome = app.welcomeDocument { app.pendingOpenDocumentId = welcome.id }
                }
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}

struct HelpView: View {
    @Environment(\.dismiss) private var dismiss

    private let shortcuts: [(String, LocalizedStringKey)] = [
        ("⌘N", "New document"), ("⌘K", "Search or jump to"), ("⇧⌘A", "Quick Add Task"),
        ("/", "Insert or convert a block"), ("[[", "Link to a page"), ("# ", "Heading 1 (## and ### too)"),
        ("- ", "Bulleted list"), ("1. ", "Numbered list"), ("[] ", "To-do"), ("> ", "Quote"), ("---", "Divider"), ("```", "Code block"),
        ("⌘B / ⌘I / ⌘U", "Bold, italic, underline"), ("⇧⌘X", "Strikethrough"), ("⌘E", "Inline code"), ("⇧⌘K", "Link"),
        ("⌥⌘0–9", "Turn into block type"), ("Tab / ⇧Tab", "Indent / outdent"), ("⌥⇧↑ / ⌥⇧↓", "Move block"),
        ("Esc", "Select block"), ("⌥-click", "Open page in a new window"), ("⌃⌘S / ⌥⌘I", "Toggle sidebar / inspector"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                FoleviMark(size: 28).foregroundStyle(FoleviColor.accent)
                Text("Folevi Help").font(FoleviType.display(26)).accessibilityAddTraits(.isHeader)
                Spacer()
            }
            Text("Everything you write is saved on this Mac first and synced when you're online. The status pill in the toolbar always tells you where things stand.")
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            Text("Keyboard shortcuts").font(.headline)
            ScrollView {
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 6) {
                    ForEach(shortcuts, id: \.0) { key, label in
                        GridRow {
                            Text(key).font(.system(size: 12, design: .monospaced)).foregroundStyle(FoleviColor.accentSoftInk)
                            Text(label).font(.system(size: 12))
                        }
                    }
                }
            }
            .frame(height: 260)
            HStack {
                Link("Read the full guide at folevi.com/help", destination: URL(string: "https://folevi.com/help") ?? URL(fileURLWithPath: "/"))
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 560)
    }
}
