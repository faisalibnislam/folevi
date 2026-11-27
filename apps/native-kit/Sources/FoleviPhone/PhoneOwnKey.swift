// Settings > Foli AI > Your own AI key on the iPhone, for Folevi Cloud and Folevi Server (the web's OwnKeyCard.tsx,
// the Mac's SettingsOwnKey.swift; the engine's `ownAiKey` query and `ownAiKey.*` runs). The keys stay in this
// iPhone's Keychain and go with each Foli AI request; the server uses a key for that request only.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine

struct PhoneOwnAiKeyData: Decodable {
    struct Option: Decodable { var value: String, label: String }
    struct Provider: Decodable, Identifiable {
        var provider: String, label: String, stored: Bool, status: String, keyUrl: String?, defaultModel: String
        var models: [Option]
        var id: String { provider }
    }
    var loaded: Bool, description: String, on: Bool, provider: String?, model: String?, onText: String
    var providers: [Provider]
}

enum PhoneOwnKey {
    /// A pushed screen's title ("own-key-anthropic", "own-key-use", "own-key-model").
    static func title(_ screen: String) -> String? {
        switch screen {
        case "own-key-use": "Use for Foli AI"
        case "own-key-model": "Model"
        case let s where s.hasPrefix("own-key-"): "\(label(String(s.dropFirst(8)))) key"
        default: nil
        }
    }

    static func label(_ p: String) -> String {
        switch p {
        case "openai": "OpenAI"
        case "anthropic": "Anthropic"
        case "gemini": "Google Gemini"
        default: p.capitalized
        }
    }
}

/// The group on Foli AI's main screen: each provider's key, and which one Foli AI uses.
struct PhoneOwnKeyGroup: View {
    let model: PhoneSettingsModel

    var body: some View {
        if let d = model.query(.ownAiKey).data(PhoneOwnAiKeyData.self) {
            PhoneSettingsGroup("Your own AI key", footer: d.description) {
                ForEach(d.providers) { p in
                    PhoneSettingsRow(p.label, value: p.stored ? "Added" : "Not added", chevron: true, action: { model.open("/settings/ai?screen=own-key-\(p.provider)") }) { PhoneRowIcon(.keyRound) }
                }
            }
            PhoneSettingsGroup(footer: d.onText) {
                PhoneSettingsRow("Use for Foli AI", value: d.on ? (d.providers.first { $0.provider == d.provider }?.label ?? "") : "Off", chevron: true, disabled: !d.providers.contains(where: \.stored), action: { model.open("/settings/ai?screen=own-key-use") })
                if d.on, let p = d.providers.first(where: { $0.provider == d.provider }) {
                    PhoneSettingsRow("Model", value: p.models.first { $0.value == d.model }?.label ?? d.model ?? "", chevron: true, action: { model.open("/settings/ai?screen=own-key-model") })
                }
            }
        }
    }
}

/// The pushed screens: one provider's key, the provider in use, and its model.
struct PhoneOwnKeyScreen: View {
    let model: PhoneSettingsModel
    let screen: String
    @State private var keyText = ""

    var body: some View {
        if let d = model.query(.ownAiKey).data(PhoneOwnAiKeyData.self) {
            switch screen {
            case "own-key-use":
                PhoneSettingsChoiceList(label: "Use for Foli AI", value: d.on ? (d.provider ?? "off") : "off", choices: [PhoneSettingsChoice(value: "off", label: "Off (use AI credits)")] + d.providers.filter(\.stored).map { PhoneSettingsChoice(value: $0.provider, label: $0.label) }) { v in
                    Task { await model.run(.ownAiKeySetChoice, ["provider": .string(v)]) }
                }
            case "own-key-model":
                if let p = d.providers.first(where: { $0.provider == d.provider }) {
                    PhoneSettingsChoiceList(label: "Model", value: d.model ?? p.defaultModel, choices: p.models.map { PhoneSettingsChoice(value: $0.value, label: $0.label) }) { v in
                        Task { await model.run(.ownAiKeySetChoice, ["provider": .string(p.provider), "model": .string(v)]) }
                    }
                }
            default:
                if let p = d.providers.first(where: { "own-key-\($0.provider)" == screen }) { keyScreen(p, picked: d.provider == p.provider ? d.model : nil) }
            }
        }
    }

    @ViewBuilder private func keyScreen(_ p: PhoneOwnAiKeyData.Provider, picked: String?) -> some View {
        if p.stored {
            PhoneSettingsGroup(footer: p.status) {
                PhoneSettingsRow("Test key", disabled: model.busy.contains("ownAiKey.test"), action: {
                    Task {
                        if let r = await model.run(.ownAiKeyTest, ["provider": .string(p.provider), "model": .string(picked ?? p.defaultModel)], quiet: true), let t = r["text"]?.string { model.toast(t, false) }
                    }
                })
                PhoneSettingsDestructiveRow(label: "Remove key", confirm: "Remove the \(p.label) key") { Task { await model.run(.ownAiKeyRemove, ["provider": .string(p.provider)]) } }
            }
        } else {
            PhoneSettingsGroup(footer: "Paste the key from your \(p.label) account. It stays in this iPhone's Keychain.") {
                HStack(spacing: 12) {
                    Text("Key").webText(PhoneType.body()).lineLimit(1)
                    SecureField("Paste your \(p.label) key", text: $keyText).font(Font(PhoneType.body().ctFont)).multilineTextAlignment(.trailing)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
            }
            PhoneSettingsGroup {
                PhoneSettingsRow("Save", disabled: keyText.trimmingCharacters(in: .whitespaces).isEmpty, action: {
                    Task {
                        if await model.run(.ownAiKeySave, ["provider": .string(p.provider), "key": .string(keyText)]) != nil { keyText = "" }
                    }
                })
                if let url = p.keyUrl.flatMap(URL.init(string:)) {
                    Link(destination: url) { PhoneSettingsRow("Get a key from \(p.label)", chevron: true) }
                }
            }
        }
    }
}
#endif
