// Settings > Foli AI > Your own AI key, for Folevi Cloud and Folevi Server (the web's OwnKeyCard.tsx; the engine's
// `ownAiKey` settings query and `ownAiKey.*` runs, viewsSettings.ts). Each provider's key is kept in this Mac's
// Keychain and goes with each Foli AI request; the server uses it for that request only. A library on this Mac has
// its own keys card (LocalAiSettings), on the same Keychain entries.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine

struct OwnAiKeyData: Decodable {
    struct Option: Decodable { var value: String, label: String }
    struct Provider: Decodable, Identifiable {
        var provider: String, label: String, stored: Bool, status: String, keyUrl: String?, defaultModel: String
        var models: [Option]
        var id: String { provider }
    }
    var loaded: Bool, description: String, on: Bool, provider: String?, model: String?, onText: String
    var providers: [Provider]
}

struct OwnAiKeyCard: View {
    let model: MacSettingsModel
    @State private var busy = false

    var body: some View {
        let store = model.query(.ownAiKey)
        if let d = store.data(OwnAiKeyData.self) {
            SettingsCard("Your own AI key", description: d.description) {
                VStack(alignment: .leading, spacing: 14) {
                    SettingsDivided(d.providers, gap: 14) { p in OwnKeyRow(model: model, key: p, picked: d.provider == p.provider ? d.model : nil, busy: $busy) }
                    useCard(d)
                }
            }
        }
    }

    /// Which stored key Foli AI uses, and with which model ("Off": credits).
    private func useCard(_ d: OwnAiKeyData) -> some View {
        let stored = d.providers.filter(\.stored)
        let current = d.providers.first { $0.provider == d.provider }
        return VStack(alignment: .leading, spacing: 8) {
            SText("Use for Foli AI", "field.label")
            SettingsSelect(options: [.init(value: "off", label: "Off (use AI credits)")] + stored.map { .init(value: $0.provider, label: $0.label) }, value: d.on ? (d.provider ?? "off") : "off", save: { v in
                await model.run(.ownAiKeySetChoice, ["provider": .string(v)]) != nil
            })
            .disabled(busy || stored.isEmpty)
            if let current, d.on {
                SText("Model", "field.label").padding(.top, 4)
                SettingsSelect(options: current.models.map { .init(value: $0.value, label: $0.label) }, value: d.model ?? current.defaultModel, save: { v in
                    await model.run(.ownAiKeySetChoice, ["provider": .string(current.provider), "model": .string(v)]) != nil
                })
                .disabled(busy)
            }
            SText(d.onText, "row.hint")
        }
        .frame(maxWidth: SettingsStyle.pair("model.grid").light.width, alignment: .leading)
    }
}

private struct OwnKeyRow: View {
    let model: MacSettingsModel
    let key: OwnAiKeyData.Provider
    /// The model in use when this is the provider Foli AI uses (Test key checks that one).
    let picked: String?
    @Binding var busy: Bool
    @State private var adding = false
    @State private var value = ""
    @State private var result: (ok: Bool, text: String)?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                HStack(alignment: .center, spacing: 8) {
                    SIcon(.keyRound, size: 14).foregroundStyle(SettingsStyle.pair("key.icon").resolve(scheme).color.color)
                    VStack(alignment: .leading, spacing: 2) {
                        SText(key.label, "key.name", lines: 1)
                        SText(key.status, "key.status")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    if key.stored {
                        SButton("Test key", size: .sm) { test() }.disabled(busy)
                        SButton("Remove", variant: .ghost, size: .sm) { remove() }.disabled(busy)
                    } else if !adding {
                        SButton("Add key…", size: .sm) { adding = true }.disabled(busy)
                    }
                }
            }
            if adding && !key.stored {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        SettingsField(placeholder: "Paste your \(key.label) key", text: $value, secure: true, onSubmit: save)
                        SButton("Save", variant: .primary, size: .sm) { save() }.disabled(busy || value.trimmingCharacters(in: .whitespaces).isEmpty)
                        SButton("Cancel", variant: .ghost, size: .sm) { adding = false; value = ""; result = nil }
                    }
                    if let url = key.keyUrl.flatMap(URL.init(string:)) {
                        SettingsLink("Get a key from \(key.label)", style: "muted") { openURL(url) }
                    }
                }
                .padding(.top, 12)
            }
            if let result {
                HStack(spacing: 6) {
                    if result.ok { SIcon(.check, size: 14) }
                    SText(result.text, "muted", color: result.ok ? SettingsColor.v("color-heading", scheme) : nil)
                }
                .padding(.top, 8)
            }
        }
    }

    private func save() {
        busy = true
        Task {
            do {
                let r = try await model.client.command(.settingsRun(key: .ownAiKeySave, args: ["provider": .string(key.provider), "key": .string(value)]))
                value = ""
                adding = false
                result = nil
                if case .object(let o) = r.data, case .string(let m)? = o["message"] { model.frame.toast(m, tone: .success) }
            } catch {
                result = (false, MacSettingsModel.message(error))
            }
            busy = false
        }
    }

    private func remove() {
        busy = true
        Task {
            await model.run(.ownAiKeyRemove, ["provider": .string(key.provider)], tone: .info)
            result = nil
            busy = false
        }
    }

    private func test() {
        busy = true
        result = nil
        Task {
            if case .object(let o)? = await model.run(.ownAiKeyTest, ["provider": .string(key.provider), "model": .string(picked ?? key.defaultModel)], quiet: true), case .string(let t)? = o["text"] {
                result = (o["ok"] == .bool(true), t)
            }
            busy = false
        }
    }
}
#endif
