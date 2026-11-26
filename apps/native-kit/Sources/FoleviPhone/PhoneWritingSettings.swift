// Settings > Writing on the iPhone, as the web's phone layout draws it (apps/web/src/components/views/settings/
// WritingSection.tsx): Folevi's own spell check and next-word prediction, American or British English (a pushed
// choice screen, `?screen=spelling-english`), and the personal dictionary (words added, words ignored). They follow
// the person to every device (convex/spelling.ts), read and saved through Settings' Convex allowlist
// (viewsSettings.ts `spelling.get`, `spelling.setPrefs`, `spelling.setWord`); the note's editor takes a change at
// once (SpellingSync.tsx). Words added from an encrypted note stay on the device that added them, so aren't here.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine

struct PhoneWritingSettings: View {
    let model: PhoneSettingsModel
    let screen: String?

    static let languages = "English (American or British), Spanish, French, German, Portuguese, Indonesian, Hindi, Bengali and Arabic; Chinese gets prediction only"
    static let predictHint = "Gray words after the caret, learnt on this iPhone from what you write. Tap the word over the keyboard to take it. With Foli AI on, longer suggestions come after a pause (never for encrypted notes)."

    /// American or British until the person picks (the web's `defaultEnglish`: British wherever it's the custom).
    static var englishDefault: String {
        let region = Locale.current.region?.identifier ?? ""
        return ["GB", "AU", "NZ", "IE", "IN", "ZA"].contains(region) ? "en-GB" : "en-US"
    }

    static let englishChoices = [
        PhoneSettingsChoice(value: "en-US", label: "American English"),
        PhoneSettingsChoice(value: "en-GB", label: "British English"),
    ]

    var body: some View {
        let s = JV(model.convex("spelling.get").value?.data)
        let english = s["english"].string ?? Self.englishDefault
        switch screen {
        case "spelling-english":
            PhoneSettingsChoiceList(label: "English", value: english, choices: Self.englishChoices, footer: "Which spelling English notes are checked against.") { v in
                Task { await save(["english": .string(v)]) }
            }
        default:
            PhoneSettingsGroup(footer: "Red underlines under misspelt words, with suggestions over the keyboard. \(Self.languages). Each note can turn it off in its menu.") {
                PhoneSettingsSwitchRow("Check spelling", on: s["spellcheck"].bool ?? true, change: { on in Task { await save(["spellcheck": .bool(on)]) } }) { PhoneRowIcon(.spellCheck2) }
                PhoneSettingsRow("English", value: Self.englishChoices.first { $0.value == english }?.label ?? "American English", chevron: true, action: { model.open("/settings/writing?screen=spelling-english") }) { PhoneRowIcon(.bookA) }
            }
            PhoneSettingsGroup(footer: Self.predictHint) {
                PhoneSettingsSwitchRow("Predict next words", on: s["predictions"].bool ?? true, change: { on in Task { await save(["predictions": .bool(on)]) } }) { PhoneRowIcon(.sparkles) }
            }
            words(s["learnt"].array.compactMap(\.string), kind: "learnt", header: "Your dictionary", footer: "Words you added with Add to dictionary: never underlined, offered as suggestions. Words from encrypted notes stay on the device they were added on.", empty: "No words added yet.")
            words(s["ignored"].array.compactMap(\.string), kind: "ignored", header: "Ignored words", footer: "Words you chose to ignore: never underlined.", empty: "No words ignored.")
        }
    }

    @ViewBuilder
    private func words(_ list: [String], kind: String, header: String, footer: String, empty: String) -> some View {
        PhoneSettingsGroup(header, footer: footer) {
            if list.isEmpty {
                PhoneSettingsText(text: empty, muted: true)
            } else {
                ForEach(list, id: \.self) { w in
                    PhoneSettingsRow(w) {
                        EmptyView()
                    } trailing: {
                        Button("Remove") {
                            Task { await model.mutate("spelling.setWord", ["word": .string(w), "kind": .string(kind), "add": .bool(false)], done: "Removed “\(w)”") }
                        }
                        .accessibilityLabel("Remove \(w)")
                    }
                }
            }
        }
    }

    /// Saves spelling settings to the account (a failure shows its toast, and the switch shows the stored value).
    private func save(_ patch: [String: JSONValue]) async {
        await model.mutate("spelling.setPrefs", patch)
    }
}
#endif
