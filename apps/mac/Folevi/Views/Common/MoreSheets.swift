// Smaller sheets: a new workspace, contacting support, a Vault item's history, and Foli AI's research progress.
import FoleviDesign
import FoleviEngine
import SwiftUI

/// A new workspace (a team space with its own members, plan and billing); it opens once made.
struct NewWorkspaceSheet: View {
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New Workspace").font(.headline)
            Text("A shared space for a team: its own notes, members, plan and billing. Your Personal space stays yours.").foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            TextField("Workspace name", text: $name).textFieldStyle(.roundedBorder).onSubmit(create)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                if !name.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button("Create", action: create).buttonStyle(InkPillStyle()).keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func create() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        dismiss()
        app.perform { client in
            let r = try await client.command(Commands.WorkspaceCreate(WorkspaceCreateArgs(name: n)))
            _ = try await client.command(Commands.SpaceSwitch(SpaceSwitchArgs(space: r.space)))
            app.toast("\(n) is ready", tone: .success)
        }
    }
}

/// Help > Contact Support: a topic and a message, sent to Folevi's support inbox.
struct SupportSheet: View {
    /// Closes the window it's in (the Help menu's window); a sheet dismisses itself.
    var close: (() -> Void)?
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var envDismiss
    private func dismiss() { if let close { close() } else { envDismiss() } }
    @State private var topics = Live<Views.SupportTopics>()
    @State private var topic = ""
    @State private var message = ""
    @State private var sent: Int??

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Contact Support").font(.headline)
            if let sent {
                Label(sent.map { "Sent. Your request number is \($0)." } ?? "Sent. We'll reply by email.", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                HStack { Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction) }
            } else {
                Picker("Topic", selection: $topic) {
                    ForEach(topics.value?.topics ?? [], id: \.id) { Text($0.label).tag($0.id) }
                }
                TextEditor(text: $message)
                    .font(.body)
                    .frame(height: 140)
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .background(.fill.quinary, in: .rect(cornerRadius: 8))
                Text("We reply by email to the address on your account.").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Spacer()
                    Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                    if !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !topic.isEmpty {
                        Button("Send") {
                            let t = topic, m = message
                            app.perform { client in
                                let r = try await client.command(Commands.SupportSend(SupportSendArgs(topic: t, message: m)))
                                sent = .some(r.number)
                            }
                        }
                        .buttonStyle(InkPillStyle())
                        .keyboardShortcut(.defaultAction)
                    }
                }
            }
        }
        .padding(20)
        .frame(width: 460)
        .task {
            topics.bind(app.client, Views.SupportTopics())
        }
        .onChange(of: topics.value?.topics.first?.id) { if topic.isEmpty { topic = topics.value?.topics.first?.id ?? "" } }
    }
}

/// A Vault item's earlier versions, with who changed it when, to look at or restore.
struct VaultHistorySheet: View {
    let vaultId: String
    let itemId: String
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var versions: [VaultVersion]?
    @State private var picked: Int?

    var body: some View {
        NavigationSplitView {
            List(versions ?? [], id: \.revision, selection: $picked) { v in
                VStack(alignment: .leading) {
                    Text(AppDates.short(v.editedAt))
                    Text(v.editedBy).font(.caption).foregroundStyle(.secondary)
                }
                .tag(v.revision)
            }
            .navigationSplitViewColumnWidth(200)
        } detail: {
            if let v = versions?.first(where: { $0.revision == picked }) {
                Form {
                    Section(v.title) {
                        ForEach(v.fields, id: \.key) { f in
                            LabeledContent(f.label, value: f.type == "password" || f.type == "secret" ? String(repeating: "•", count: 10) : f.value)
                        }
                    }
                    Button("Restore This Version") {
                        app.perform { _ = try await $0.command(Commands.VaultItemRestoreVersion(VaultRevisionArgs(vaultId: vaultId, itemId: itemId, revision: v.revision))) }
                        dismiss()
                    }
                }
                .formStyle(.grouped)
            } else {
                Text(versions == nil ? "Loading…" : "Choose a version").foregroundStyle(.secondary)
            }
        }
        .frame(width: 620, height: 420)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        .task {
            versions = (try? await app.client?.command(Commands.VaultItemHistory(VaultItemIdArgs(vaultId: vaultId, itemId: itemId))))?.versions ?? []
            picked = versions?.first?.revision
        }
    }
}

/// Foli AI's research in a conversation: each job's steps as they run, its sources, and saving the report as a note.
struct ResearchJobsView: View {
    let conversationId: String
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var research = Live<Views.AiResearch>()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(research.value?.jobs ?? [], id: \.id) { job in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label(job.question, appSymbol: "globe").font(.headline).lineLimit(2)
                        Spacer()
                        if job.status == "running" {
                            ProgressView().controlSize(.small)
                            Button("Stop") { app.perform { _ = try await $0.command(Commands.AiResearchCancel(ResearchIdArgs(researchId: job.id))) } }.controlSize(.small)
                        }
                    }
                    ForEach(Array(job.steps.enumerated()), id: \.offset) { _, step in
                        Label(step.label + (step.count.map { " (\($0))" } ?? ""), systemImage: step.status == "done" ? "checkmark.circle" : step.status == "running" ? "circle.dotted" : "circle")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    if !job.sources.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(job.sources, id: \.n) { s in
                                if let note = s.noteId {
                                    Button("\(s.n). \(s.title)") { window.go(.note(note)) }.buttonStyle(.bordered).controlSize(.regular)
                                } else if let u = s.url.flatMap(URL.init(string:)) {
                                    Link("\(s.n). \(s.domain ?? s.title)", destination: u).buttonStyle(.bordered).controlSize(.regular)
                                }
                            }
                        }
                    }
                    if let e = job.error { Text(e.message).foregroundStyle(.orange) }
                    if job.status == "done" {
                        if let note = job.noteId {
                            Button("Open Report") { window.go(.note(note)) }
                        } else {
                            Button("Save Report as Note") {
                                app.perform { client in
                                    let r = try await client.command(Commands.AiResearchSave(ResearchSaveArgs(researchId: job.id)))
                                    window.go(.note(r.id))
                                }
                            }
                            .buttonStyle(InkPillStyle())
                        }
                    }
                }
                .padding(12)
                .background(.fill.quinary, in: .rect(cornerRadius: 12))
            }
        }
        .task(id: conversationId) { research.bind(app.client, Views.AiResearch(ResearchArgs(conversationId: conversationId))) }
    }
}

/// Contact Support in a small window of its own (from the Help menu, where there's no window to attach a sheet to).
@MainActor
enum SupportWindow {
    private static var window: NSWindow?

    static func show() {
        if let window { window.makeKeyAndOrderFront(nil); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 340), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = "Contact Support"
        w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: SupportSheet(close: { [weak w] in w?.close() }).tint(.foleviInk))
        w.center()
        w.makeKeyAndOrderFront(nil)
        window = w
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { _ in MainActor.assumeIsolated { SupportWindow.window = nil } }
    }
}
