import SwiftUI

// AI credits in the AI panels, as on the web (AiCredits.tsx): a quiet note when credits run low, and the
// out-of-credits or not-included state when a request is refused, with "Buy more" or "Upgrade" (both open
// Plan & billing on the web). The server decides (billing:credits, and every AI request); this only shows it.

extension AiProblem {
    /// What a failed AI request needs the person to know.
    static func from(_ error: Error) -> AiProblem {
        let mapped = ConvexService.mapError(error)
        if case .ai(let problem) = mapped { return problem }
        return .other(mapped.localizedDescription)
    }
}

/// Settings → Plan & billing, where credits are bought and plans changed (as on the web).
@MainActor
func openBilling(_ app: AppModel) {
    SettingsRouter.shared.open(.billing)
}

/// A refused AI request: the server's message, and "Buy more" or "Upgrade" when that helps. Other errors
/// keep the panels' usual look.
struct AiProblemNotice: View {
    var problem: AiProblem
    @Environment(AppModel.self) private var app

    var body: some View {
        if problem.kind == .other {
            Text(problem.message)
                .font(.ui(13))
                .foregroundStyle(FoleviColor.destructive)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FoleviColor.destructiveSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .textSelection(.enabled)
                .accessibilityAddTraits(.isStaticText)
        } else {
            HStack(spacing: 12) {
                Text(problem.message)
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let title = problem.action.title {
                    Button(title) { openBilling(app) }
                        .buttonStyle(.folevi(.secondary, .small))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(FoleviGlass.border))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("ai.creditsProblem")
        }
    }
}

/// Watches the AI credits that apply where the person is working: the current scope, or `documentId`'s own
/// scope (a note from elsewhere). Live: it follows every request's charge.
@MainActor
@Observable
final class AiCreditsWatcher {
    private(set) var credits: AiCredits?

    func watch(_ app: AppModel, documentId: String?) async {
        guard let session = app.session, app.sync.isOnline else { return }
        var args: [String: JSONValue] = ["scope": session.scope.arg]
        if let documentId { args["documentId"] = .string(documentId) }
        let stream: AsyncThrowingStream<AiCredits, Error> = session.convex.subscribe("billing:credits", args)
        do {
            for try await c in stream { credits = c }
        } catch {
            // Not shown: the panels still work, and a refused request says why.
        }
    }
}

/// A quiet line in an AI panel when credits are running low: how many are left and when they reset, with
/// "Buy more" (Pro, Pro AI) or "Upgrade". Nothing otherwise.
struct AiCreditsNote: View {
    var documentId: String?
    /// Space above the note, only while it shows (the web's flex gap, which an empty note doesn't take).
    var spacingAbove: CGFloat = 0
    @Environment(AppModel.self) private var app
    @State private var watcher = AiCreditsWatcher()

    var body: some View {
        VStack(spacing: 0) {
            if let c = watcher.credits, let note = AiCreditCopy.lowNote(c) {
                HStack(spacing: 12) {
                    Text(note.text)
                        .font(.ui(12.5))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let title = note.action.title {
                        Button(title) { openBilling(app) }
                            .buttonStyle(.folevi(.secondary, .small))
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("ai.creditsNote")
                .padding(.top, spacingAbove)
            }
        }
        .task(id: "\(app.scope.key)|\(documentId ?? "")|\(app.sync.isOnline)") { await watcher.watch(app, documentId: documentId) }
    }
}

/// "Edit with AI" and the other AI chrome: a small "Thinking" shimmer while a reply hasn't started.
struct AiShimmer: View {
    var widths: [CGFloat] = [0.92, 0.78, 0.85]
    var height: CGFloat = 9
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(widths.enumerated()), id: \.offset) { _, w in
                    Capsule()
                        .fill(LinearGradient(colors: [Color(red: 0.545, green: 0.486, blue: 0.965).opacity(0.22),
                                                      Color(red: 0.961, green: 0.541, blue: 0.722).opacity(0.18)],
                                             startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * w, height: height)
                }
            }
        }
        .frame(height: CGFloat(widths.count) * (height + 8) - 8)
        .opacity(pulse ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
        }
        .accessibilityHidden(true)
    }
}

/// The "Stop" control under a streaming reply.
struct AiStopButton: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2, style: .continuous).frame(width: 8, height: 8)
                Text("Stop")
            }
            .font(.ui(12.5))
        }
        .buttonStyle(.folevi(.quiet, .small))
        .accessibilityLabel(Text("Stop"))
    }
}
