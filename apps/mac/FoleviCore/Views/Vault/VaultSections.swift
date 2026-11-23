import FoleviDesign
import FoleviEngine
import SwiftUI

/// The Vault's other sections: Health (weak, reused or old passwords), Activity (who opened or changed what) and
/// People (who shares the Vault and their roles).
struct VaultHealthView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var health = Live<Views.VaultHealth>()

    var body: some View {
        List {
            if let h = health.value {
                if h.groups.isEmpty { Text("Everything looks good.").foregroundStyle(.secondary) }
                ForEach(h.groups, id: \.issue) { g in
                    Section {
                        Text(g.body).font(.callout).foregroundStyle(.secondary)
                        ForEach(g.items, id: \.id) { item in
                            Label(item.title.nonEmpty ?? item.kindLabel, systemImage: g.tone == "danger" ? "exclamationmark.triangle" : "info.circle")
                        }
                    } header: { Text(g.title) }
                }
            } else {
                ProgressView()
            }
        }
        .task { health.bind(app.client, Views.VaultHealth(VaultIdArgs(vaultId: vaultId))) }
    }
}

struct VaultActivityView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var activity = Live<Views.VaultActivity>()
    @State private var failedOnly = false
    @State private var event = ""

    private static let events: [(String, String)] = [("", "Everything"), ("vault.", "Unlocking and Locking"), ("item.", "Items"), ("file.", "Files"), ("note.", "Notes"), ("person.", "People"), ("link.", "Links"), ("share.", "Sharing")]

    var body: some View {
        List {
            HStack {
                Picker("What", selection: $event) { ForEach(Self.events, id: \.0) { Text($0.1).tag($0.0) } }
                    .labelsHidden().fixedSize()
                Toggle("Failures only", isOn: $failedOnly).toggleStyle(.checkbox)
                Spacer()
            }
            if (activity.value?.entries ?? []).isEmpty, activity.value != nil {
                Text(failedOnly || !event.isEmpty ? "Nothing matches." : "Nothing has happened in the Vault yet.").foregroundStyle(.secondary)
            }
            ForEach(activity.value?.entries ?? [], id: \.seq) { e in
                HStack(alignment: .top) {
                    Image(systemName: e.failed ? "xmark.octagon" : "checkmark.circle").foregroundStyle(e.failed ? .red : .secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(e.actorName) \(e.label)")
                        if !e.detail.isEmpty { Text(e.detail).font(.caption).foregroundStyle(.secondary) }
                        if let r = e.reason { Text(r).font(.caption).foregroundStyle(.red) }
                    }
                    Spacer()
                    Text(CoreDates.short(e.at)).font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
        .task(id: "\(failedOnly)\(event)") { activity.bind(app.client, Views.VaultActivity(VaultActivityArgs(vaultId: vaultId, event: event.isEmpty ? nil : event, failedOnly: failedOnly ? true : nil, personId: nil))) }
    }
}

struct VaultPeopleView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var people = Live<Views.VaultPeople>()

    var body: some View {
        List {
            if let p = people.value {
                Section("People") {
                    ForEach(p.people, id: \.profileId) { person in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(person.name + (person.isYou ? " (you)" : ""))
                                Text([person.email, person.role.capitalized, person.status == "active" ? nil : person.status.capitalized].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if p.canAdd && !person.isYou && person.role != "owner" {
                                Picker("", selection: Binding(get: { person.role }, set: { r in
                                    app.perform { _ = try await $0.command(Commands.VaultPeopleSetRole(VaultRoleArgs(vaultId: vaultId, profileId: person.profileId, role: .init(rawValue: r) ?? .member))) }
                                })) {
                                    Text("Custodian").tag("custodian")
                                    Text("Member").tag("member")
                                }
                                .labelsHidden().fixedSize()
                                Button("Remove") { app.perform { _ = try await $0.command(Commands.VaultPeopleRemove(VaultPersonArgs(vaultId: vaultId, profileId: person.profileId))) } }
                                    .buttonStyle(.borderless)
                            }
                        }
                    }
                }
                if p.onlyOneCustodian {
                    Label("Only one person can open this Vault's recovery. Make someone else a custodian too.", coreSymbol: "exclamationmark.triangle").foregroundStyle(.orange)
                }
                Button("Everyone Here Should Have Access") { app.perform { _ = try await $0.command(Commands.VaultPeopleReviewed(VaultIdArgs(vaultId: vaultId))) } }
                if p.canAdd, !p.candidates.isEmpty {
                    Section("Add from the Workspace") {
                        ForEach(p.candidates, id: \.profileId) { c in
                            HStack {
                                Text(c.name)
                                Spacer()
                                Button("Add") { app.perform { _ = try await $0.command(Commands.VaultPeopleAdd(VaultPersonArgs(vaultId: vaultId, profileId: c.profileId))) } }
                            }
                        }
                    }
                }
            } else {
                ProgressView()
            }
        }
        .task { people.bind(app.client, Views.VaultPeople(VaultIdArgs(vaultId: vaultId))) }
    }
}
