// Settings > Writing on the iPhone (PhoneWritingSettings.swift): listed after Appearance, reached at
// /settings/writing, its English choice a pushed screen, and found by what it holds.
import Testing
@testable import FoleviPhone

@Suite("Writing settings on the iPhone") @MainActor
struct PhoneWritingSettingsTests {
    @Test func reachedByItsPathAndItsChoiceScreen() {
        #expect(PhoneSettingsSection.parse("/settings/writing").section == .writing)
        let english = PhoneSettingsSection.parse("/settings/writing?screen=spelling-english")
        #expect(english.section == .writing && english.screen == "spelling-english")
        #expect(PhoneSettingsSectionView.title(.writing, screen: "spelling-english") == "English")
        #expect(PhoneSettingsSectionView.title(.writing, screen: nil) == "Writing")
        #expect(PhoneSettingsSection.writing.label == "Writing")
    }

    @Test func foundByWhatItHolds() {
        for q in ["spell check", "dictionary", "next word", "autocorrect", "british"] {
            #expect(PhoneSettingsList.matches(.writing, q), "\(q)")
        }
        #expect(!PhoneSettingsList.matches(.writing, "passkeys"))
    }

    @Test func englishFollowsTheRegionUntilPicked() {
        #expect(["en-US", "en-GB"].contains(PhoneWritingSettings.englishDefault))
        #expect(PhoneWritingSettings.englishChoices.map(\.value) == ["en-US", "en-GB"])
    }
}
