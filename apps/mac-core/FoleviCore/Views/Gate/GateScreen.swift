// What the window shows while the engine isn't ready: the first-launch choice (sign in, create an account, keep
// notes on this Mac), the session-ended and sign-in screens, unlocking encrypted notes, approvals from another
// device, onboarding, the device limit and a library move. The engine sends each as data (`gate.changed`: a
// title, text, fields and actions); Core draws it natively and sends the person's choice back (`gate.act`).
import FoleviDesign
import FoleviEngine
import SwiftUI

struct GateScreen: View {
    let gate: GateChangedEvent
    private var app: AppModel { .shared }
    @State private var values: [String: String] = [:]
    @FocusState private var focus: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                header
                if let p = gate.progress { progress(p) }
                if let m = gate.migration { MigrationSummaryView(summary: m) }
                if let d = gate.deviceLimit { deviceLimit(d) }
                if let e2ee = gate.e2ee, let code = e2ee.approvalCode {
                    VStack(spacing: 6) {
                        Text("Approve on your other device with this code").foregroundStyle(.secondary)
                        Text(code).font(.system(size: 30, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                    }
                }
                if let o = gate.onboarding { OnboardingStep(info: o, values: $values) }
                fields
                if let error = gate.error {
                    Label(error.message, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                }
                actions
            }
            .frame(maxWidth: 440)
            .padding(40)
            .frame(maxWidth: .infinity, minHeight: 520)
        }
        .background(.background)
        .disabled(gate.busy)
        .overlay(alignment: .top) { if gate.busy { ProgressView().controlSize(.small).padding(.top, 18) } }
        .onAppear { focus = gate.fields.first?.id }
        .onChange(of: gate.gate) { values = [:]; focus = gate.fields.first?.id }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 88, height: 88).accessibilityHidden(true)
            Text(title).font(CoreType.screenTitle(28)).multilineTextAlignment(.center).accessibilityAddTraits(.isHeader)
            if !message.isEmpty {
                Text(message).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The web's words when it sends them; Core's own for the screens it knows.
    private var title: String {
        if !gate.title.isEmpty { return gate.title }
        switch gate.gate {
        case "welcome", "choose", "first-launch": return "Welcome to Folevi Core"
        case "signin", "sign-in", "session-ended": return "Sign In to Folevi"
        case "loading": return "Opening your notes"
        default: return "Folevi Core"
        }
    }

    private var message: String {
        if !gate.message.isEmpty { return gate.message }
        switch gate.gate {
        case "welcome", "choose", "first-launch": return "A quieter place for ideas that keep growing. Sign in to your Folevi account, or keep notes on this Mac."
        default: return ""
        }
    }

    @ViewBuilder private var fields: some View {
        if !gate.fields.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(gate.fields, id: \.id) { f in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(f.label).font(.callout.weight(.medium))
                        Group {
                            if f.kind == .secret {
                                SecureField(f.placeholder, text: binding(f.id))
                            } else {
                                TextField(f.placeholder, text: binding(f.id))
                                    .font(f.kind == .recoveryKey || f.kind == .code ? .body.monospaced() : .body)
                            }
                        }
                        .textFieldStyle(.roundedBorder)
                        .controlSize(.large)
                        .focused($focus, equals: f.id)
                        .onSubmit { if let primary = gate.actions.first(where: { $0.style == .primary && $0.enabled }) { act(primary) } }
                    }
                }
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 10) {
            ForEach(gate.actions, id: \.id) { a in
                Button { act(a) } label: {
                    Text(a.label).frame(maxWidth: a.style == .quiet ? nil : .infinity)
                }
                .controlSize(.large)
                .buttonStyle(style(a.style))
                .tint(a.style == .destructive ? .red : nil)
                .disabled(!a.enabled)
                .keyboardShortcut(a.style == .primary ? .defaultAction : nil)
            }
        }
    }

    private func style(_ s: GateAction.Style) -> AnyPrimitiveButtonStyle {
        switch s {
        case .primary: AnyPrimitiveButtonStyle(.borderedProminent)
        case .secondary, .destructive: AnyPrimitiveButtonStyle(.bordered)
        case .quiet: AnyPrimitiveButtonStyle(.borderless)
        }
    }

    private func progress(_ p: GateProgress) -> some View {
        VStack(spacing: 6) {
            if let total = p.total, total > 0 {
                ProgressView(value: Double(p.done), total: Double(total))
            } else {
                ProgressView().controlSize(.small)
            }
            Text(p.label).font(.callout).foregroundStyle(.secondary)
        }
    }

    private func deviceLimit(_ d: DeviceLimitInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Signed in on \(d.devices.count) of \(d.limit) devices").font(.headline)
            ForEach(d.devices, id: \.id) { dev in
                HStack {
                    Image(systemName: "desktopcomputer")
                    Text(dev.label)
                    Text(CoreDates.relative(dev.lastSeenAt)).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Sign Out") { send("revoke", ["device": dev.id]) }
                }
            }
        }
        .padding(14)
        .background(.fill.quinary, in: .rect(cornerRadius: 10))
    }

    private func binding(_ id: String) -> Binding<String> {
        Binding(get: { values[id] ?? "" }, set: { values[id] = $0 })
    }

    /// The page runs the choice (signing in opens the system's sign-in sheet through the shared shell; choosing a
    /// folder opens the Mac's folder panel).
    private func act(_ a: GateAction) { send(a.id, values) }

    private func send(_ action: String, _ extra: [String: String]) {
        app.perform { _ = try await $0.command(Commands.GateAct(GateActArgs(action: action, values: extra.isEmpty ? nil : extra))) }
    }
}

/// A primitive button style of either kind (a gate action's style is data).
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ s: S) { make = { AnyView(s.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// What a move to or from the library takes (notes, folders, files, the room it needs).
struct MigrationSummaryView: View {
    let summary: MigrationSummary

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
            GridRow { Text("Notes").foregroundStyle(.secondary); Text(summary.notes.formatted()) }
            GridRow { Text("Folders").foregroundStyle(.secondary); Text(summary.folders.formatted()) }
            GridRow { Text("Tags").foregroundStyle(.secondary); Text(summary.tags.formatted()) }
            GridRow { Text("Files").foregroundStyle(.secondary); Text("\(summary.files.formatted()) (\(ByteCountFormatter.string(fromByteCount: Int64(summary.fileBytes), countStyle: .file)))") }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quinary, in: .rect(cornerRadius: 10))
    }
}

/// An onboarding step: what you'll use Folevi for, a note style, the appearance, Foli AI on or off.
struct OnboardingStep: View {
    let info: OnboardingGateInfo
    @Binding var values: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Step \(info.index + 1) of \(info.total)").font(.caption).foregroundStyle(.secondary)
            switch info.step {
            case "use", "useCases":
                ForEach(info.useCaseOptions, id: \.id) { o in
                    Toggle(o.label, isOn: Binding(
                        get: { (values["useCases"] ?? info.useCases.joined(separator: ",")).split(separator: ",").map(String.init).contains(o.id) },
                        set: { on in
                            var set = Set((values["useCases"] ?? info.useCases.joined(separator: ",")).split(separator: ",").map(String.init))
                            if on { set.insert(o.id) } else { set.remove(o.id) }
                            values["useCases"] = set.sorted().joined(separator: ",")
                        }
                    ))
                    .toggleStyle(.checkbox)
                }
            case "style", "noteStyle":
                Picker("Note style", selection: Binding(get: { values["noteStyle"] ?? info.noteStyle }, set: { values["noteStyle"] = $0 })) {
                    ForEach(info.noteStyleOptions, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .pickerStyle(.radioGroup)
            case "appearance":
                Picker("Appearance", selection: Binding(get: { values["appearance"] ?? info.appearance }, set: { values["appearance"] = $0 })) {
                    Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
            case "ai":
                Toggle("Turn on Foli AI", isOn: Binding(get: { (values["ai"] ?? (info.aiEnabled ? "on" : "off")) == "on" }, set: { values["ai"] = $0 ? "on" : "off" }))
                    .toggleStyle(.switch)
            default:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
