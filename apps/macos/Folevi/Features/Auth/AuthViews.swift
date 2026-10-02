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
        .foleviDialog(isPresented: Binding(get: { app.showNewWorkspace }, set: { app.showNewWorkspace = $0 })) { NewWorkspaceSheet().environment(app) }
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
