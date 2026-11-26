// Settings > Writing on the Mac (and the iPad's wide Settings), drawn as the web's
// (apps/web/src/components/views/settings/WritingSection.tsx): Folevi's own spell check and next-word prediction,
// American or British English, and the personal dictionary (words added, words ignored). They follow the person to
// every device (convex/spelling.ts), read and saved through Settings' Convex allowlist (viewsSettings.ts
// `spelling.get`, `spelling.setPrefs`, `spelling.setWord`); the note's editor takes a change at once
// (SpellingSync.tsx). Words added from an encrypted note stay on the device that added them, so they aren't here.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine

struct WritingSettings: View {
    let model: MacSettingsModel

    /// The languages spell check knows (the web's LANGS in WritingSection.tsx).
    static let languages = "English (American or British), Spanish, French, German, Portuguese, Indonesian, Hindi, Bengali and Arabic; Chinese gets prediction only"
    static let predictHint = "Gray words after the caret, learnt on this \(ThisDevice.noun) from what you write. Press Tab to take one, Esc to dismiss. With Foli AI on, longer suggestions come after a pause (never for encrypted notes)."

    /// American or British until the person picks (the web's `defaultEnglish`: British wherever it's the custom).
    static var englishDefault: String {
        let region = Locale.current.region?.identifier ?? ""
        return ["GB", "AU", "NZ", "IE", "IN", "ZA"].contains(region) ? "en-GB" : "en-US"
    }

    static let englishOptions: [SettingsSelect.Option] = [
        .init(value: "en-US", label: "American English"),
        .init(value: "en-GB", label: "British English"),
    ]

    var body: some View {
        let store = model.convex("spelling.get")
        let s = J(store.value?.data)
        VStack(alignment: .leading, spacing: SettingsStyle.pair("card").light.margin.bottom) {
            SettingsCard("Spelling and prediction", description: "Folevi's own spell check and next words, the same in every app and offline. Your settings follow you to all your devices.") {
                if store.value == nil {
                    SMuted("Loading…")
                } else {
                    SettingsDivided(Row.all, gap: 12, line: "row") { row in
                        switch row {
                        case .spellcheck:
                            SettingsSwitchRow(label: "Check spelling", hint: "Red underlines under misspelt words, with suggestions. \(Self.languages). Each note can turn it off in its right-click menu.", isOn: s["spellcheck"].bool ?? true) { on in
                                await save(["spellcheck": .bool(on)])
                            }
                        case .english:
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 0) {
                                    SText("English", "row.label")
                                    SText("Which spelling English notes are checked against.", "row.hint")
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                SettingsSelect(options: Self.englishOptions, value: s["english"].string ?? Self.englishDefault, width: 176) { v in
                                    await save(["english": .string(v)])
                                }
                                .accessibilityLabel("English")
                            }
                        case .predictions:
                            SettingsSwitchRow(label: "Predict next words", hint: Self.predictHint, isOn: s["predictions"].bool ?? true) { on in
                                await save(["predictions": .bool(on)])
                            }
                        }
                    }
                    .settingsRowWidth(SettingsStyle.pair("rows").light.width)
                }
            }
            SettingsCard("Your dictionary", description: "Words you added with Add to dictionary. They're never underlined and are offered as suggestions. Words from encrypted notes stay on the \(ThisDevice.noun) they were added on.") {
                words(s["learnt"].array.compactMap(\.string), kind: "learnt", empty: "No words added yet.")
            }
            SettingsCard("Ignored words", description: "Words you chose to ignore: never underlined.") {
                words(s["ignored"].array.compactMap(\.string), kind: "ignored", empty: "No words ignored.")
            }
        }
    }

    private enum Row: String, Identifiable, CaseIterable {
        case spellcheck, english, predictions
        var id: String { rawValue }
        static let all = allCases
    }

    private struct Word: Identifiable {
        let id: String
    }

    @ViewBuilder
    private func words(_ list: [String], kind: String, empty: String) -> some View {
        if list.isEmpty {
            SMuted(empty)
        } else {
            SettingsDivided(list.map(Word.init(id:)), gap: 8, line: "row") { w in
                HStack(spacing: 12) {
                    SText(w.id, "row.label")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    SButton("Remove", variant: .ghost, size: .sm) {
                        Task { await model.mutate("spelling.setWord", ["word": .string(w.id), "kind": .string(kind), "add": .bool(false)], done: "Removed “\(w.id)”") }
                    }
                    .accessibilityLabel("Remove \(w.id)")
                }
            }
        }
    }

    /// Saves spelling settings to the account; a failure says so (the switch or menu that asked goes back).
    private func save(_ patch: [String: JSONValue]) async -> Bool {
        await model.mutate("spelling.setPrefs", patch) != nil
    }
}
#endif
