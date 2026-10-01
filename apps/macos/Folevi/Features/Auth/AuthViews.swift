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
            case .deviceLimit(let limit, let active):
                DeviceLimitView(limit: limit, active: active)
            case .onboarding:
                OnboardingView()
            case .ready:
                MainWindowView()
            }
        }
        .sheet(isPresented: Binding(get: { app.showHelp }, set: { app.showHelp = $0 })) { HelpView().environment(app) }
        .sheet(isPresented: Binding(get: { app.showNewWorkspace }, set: { app.showNewWorkspace = $0 })) { NewWorkspaceSheet().environment(app) }
    }
}

struct LaunchView: View {
    var body: some View {
        VStack(spacing: 16) {
            BrandTile(size: 64)
            ProgressView().controlSize(.small)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CanvasBackground())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Opening Folevi"))
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
            Image(systemName: content.icon).font(.ui(40, .light)).foregroundStyle(FoleviColor.accent).accessibilityHidden(true)
            Text(content.title).font(FoleviType.display(26)).tracking(FoleviType.displayTracking(26)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
            Text(content.message).multilineTextAlignment(.center).foregroundStyle(FoleviColor.inkMuted)
            HStack {
                if phase == .emailUnverified || phase == .mfaRequired {
                    Button("Try again") { Task { await app.signIn(interactive: false) } }
                        .buttonStyle(.folevi(.primary))
                }
                if phase == .sessionRevoked {
                    Button("Sign in") { Task { await app.signOut() } }.buttonStyle(.folevi(.primary))
                }
                Button("Sign out") { Task { await app.signOut() } }
            }
        }
    }
}

/// Free plans work on a few devices at once. This Mac waits here until another device signs out or the
/// plan is upgraded — both happen on the web (Settings → Devices / Plan & billing).
struct DeviceLimitView: View {
    let limit: Int
    let active: Int
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL

    private func openWeb(_ path: String) {
        if let origin = app.config.appOrigin { openURL(origin.appending(path: path)) }
    }

    var body: some View {
        AuthCard {
            Image(systemName: "laptopcomputer.and.iphone").font(.ui(40, .light)).foregroundStyle(FoleviColor.accent).accessibilityHidden(true)
            Text("You’re on \(limit) devices already").font(.ui(26, .semibold)).tracking(FoleviTracking.tight * 26).foregroundStyle(FoleviColor.heading)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text("The Free plan works on \(limit) devices at a time, and \(active) are signed in. Sign one of them out, or upgrade to Basic or Pro for unlimited devices. Your notes on this Mac are safe.")
                .multilineTextAlignment(.center)
                .foregroundStyle(FoleviColor.inkMuted)
            VStack(spacing: 10) {
                Button("Manage devices…") { openWeb("settings/devices") }
                    .buttonStyle(.folevi(.primary, .large, fullWidth: true))
                Button("See plans…") { openWeb("settings/billing") }
                    .buttonStyle(.folevi(.secondary, .large, fullWidth: true))
                HStack {
                    Button("Try again") { Task { await app.signIn(interactive: false) } }
                    Button("Sign out") { Task { await app.signOut() } }
                }
            }
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

struct HelpView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app

    private let shortcuts: [(String, LocalizedStringKey)] = [
        ("⌘N", "New document"), ("⌥⌘N", "New note in the open folder"), ("⌘F / ⌥⌘F", "Find / Find and replace"),
        ("⌘-click / ⇧-click", "Select notes in a list"), ("⌘A", "Select every note shown"), ("⌘K", "Search or jump to"), ("⇧⌘A", "Quick Add Task"),
        ("/", "Insert or convert a block"), ("[[", "Link to a page"), ("# ", "Heading 1 (## and ### too)"),
        ("- ", "Bulleted list"), ("1. ", "Numbered list"), ("[] ", "To-do"), ("> ", "Quote"), ("---", "Divider"), ("```", "Code block"),
        ("⌘B / ⌘I / ⌘U", "Bold, italic, underline"), ("⇧⌘X", "Strikethrough"), ("⌘E", "Inline code"), ("⇧⌘K", "Link"),
        ("⌥⌘0–9", "Turn into block type"), ("Tab / ⇧Tab", "Indent / outdent"), ("⌥⇧↑ / ⌥⇧↓", "Move block"),
        ("Esc", "Select block"), ("⌥-click", "Open page in a new window"), ("⌃⌘S / ⌥⌘I", "Toggle sidebar / inspector"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                BrandTile(size: 34)
                Text("Folevi Help").font(FoleviType.display(26)).tracking(FoleviType.displayTracking(26)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
                Spacer()
            }
            Text("Everything you write is saved on this Mac first and synced when you're online. The status pill in the toolbar always tells you where things stand.")
                .foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if app.phase == .ready { SupportRequestsSection() }
                    Text("Keyboard shortcuts").font(.ui(14, .semibold))
                    Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 6) {
                        ForEach(shortcuts, id: \.0) { key, label in
                            GridRow {
                                Keycap(text: key)
                                Text(label).font(.ui(12))
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: app.phase == .ready ? 440 : 260)
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
