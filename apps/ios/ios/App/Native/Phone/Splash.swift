// The full screens shown instead of the app (plan 5.1), driven by `gate.changed`: the first-launch choice, sign-in,
// onboarding, a locked library or space, a migration, the device limit, "update required". N14 draws each one
// properly; until then this screen shows the engine's own heading, text, fields and buttons (`gate.act`), and
// signs in with ShellAuth (the provider's page in ASWebAuthenticationSession), as today's app does.
//
// "loading" is never a screen: a returning person sees their last screen from the launch snapshot, and a first
// launch sees the plain splash (the mark on the canvas), never "Opening your folio...".
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine

struct GateView: View {
    let gate: GateChangedEvent
    let act: (String, [String: String]) -> Void
    let signIn: () -> Void
    @State private var values: [String: String] = [:]

    private var heading: String {
        if !gate.title.isEmpty { return gate.title }
        switch gate.gate {
        case "modeChoice": return "Where should your notes live?"
        case "signedOut": return "Sign in to Folevi"
        case "onboarding": return "Welcome to Folevi"
        case "librarySetup": return "Choose a folder for your notes"
        case "libraryLocked": return "Your library is locked"
        case "updateRequired": return "Update Folevi"
        case "offline": return "You're offline"
        case "deviceLimit": return "Too many devices"
        default: return "Folevi"
        }
    }

    private var text: String {
        if !gate.message.isEmpty { return gate.message }
        switch gate.gate {
        case "modeChoice": return "Sign in to keep your notes in sync on every device, or keep them in a folder on this iPhone."
        case "signedOut": return "Your notes, tasks and linked pages, on every device."
        case "onboarding": return "Setting up your Personal space happens here in the next update."
        case "updateRequired": return "This version of Folevi is too old for your account. Update it from the App Store."
        default: return ""
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Text("Folevi").font(FoleviFonts.font(.display, size: 30, weight: .semibold)).foregroundStyle(DS.color.heading)
                    .padding(.top, 70)
                    .accessibilityAddTraits(.isHeader)
                Text(heading).foleviFont(.title).foregroundStyle(DS.color.heading).multilineTextAlignment(.center)
                    .accessibilityIdentifier("gate-title")
                if !text.isEmpty {
                    Text(text).foleviFont(.body).foregroundStyle(DS.color.inkMuted).multilineTextAlignment(.center)
                }
                if let p = gate.progress {
                    VStack(spacing: 6) {
                        if let total = p.total, total > 0 { ProgressView(value: Double(p.done), total: Double(total)) } else { ProgressView() }
                        Text(p.label).foleviFont(.caption).foregroundStyle(DS.color.inkMuted)
                    }
                } else if gate.busy {
                    ProgressView()
                }
                ForEach(gate.fields, id: \.id) { field in
                    Group {
                        if field.kind == .secret {
                            SecureField(field.placeholder.isEmpty ? field.label : field.placeholder, text: binding(field.id))
                        } else {
                            TextField(field.placeholder.isEmpty ? field.label : field.placeholder, text: binding(field.id))
                                .textContentType(field.kind == .code ? .oneTimeCode : nil)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        }
                    }
                    .foleviFont(.body)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(DS.color.surfaceSunken))
                    .accessibilityIdentifier("gate-field-\(field.id)")
                }
                if let e = gate.error {
                    Text(e.message).foleviFont(.callout).foregroundStyle(DS.color.coral).multilineTextAlignment(.center)
                }
                VStack(spacing: 10) {
                    if gate.gate == "signedOut" {
                        Button(action: signIn) { Text("Sign in").frame(maxWidth: .infinity) }
                            .buttonStyle(FoleviButtonStyle(.primary, size: .large, fullWidth: true))
                            .accessibilityIdentifier("gate-sign-in")
                    }
                    ForEach(gate.actions, id: \.id) { a in
                        Button { act(a.id, values) } label: { Text(a.label).frame(maxWidth: .infinity) }
                            .buttonStyle(FoleviButtonStyle(style(a.style), size: .large, fullWidth: true))
                            .disabled(!a.enabled)
                            .accessibilityIdentifier("gate-action-\(a.id)")
                    }
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 28)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .background(DS.color.canvas.ignoresSafeArea())
        .accessibilityIdentifier("gate-\(gate.gate ?? "none")")
    }

    private func binding(_ id: String) -> Binding<String> {
        Binding(get: { values[id] ?? "" }, set: { values[id] = $0 })
    }

    private func style(_ s: GateAction.Style) -> FoleviButtonKind {
        switch s {
        case .primary: .primary
        case .secondary: .secondary
        case .quiet: .ghost
        case .destructive: .destructive
        }
    }
}

/// The first launch's splash while the page boots: the mark on the canvas, nothing more.
struct SplashView: View {
    var body: some View {
        ZStack {
            DS.color.canvas.ignoresSafeArea()
            Text("Folevi").font(FoleviFonts.font(.display, size: 30, weight: .semibold)).foregroundStyle(DS.color.heading)
        }
        .accessibilityIdentifier("splash")
    }
}
