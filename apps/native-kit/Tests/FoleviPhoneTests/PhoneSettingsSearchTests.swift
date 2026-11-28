// Settings' list and search on the iPhone (PhoneSettings.swift), as the web's (SettingsView.tsx, settingsSearch.ts):
// "You" in Account, Security, App and Data, and a search where most words must match, filler words left out.
#if os(iOS)
import Testing
import FoleviScreens
@testable import FoleviPhone

@Suite("Settings search on the iPhone") @MainActor
struct PhoneSettingsSearchTests {
    @Test func youIsFourGroups() {
        #expect(PhoneSettingsList.youGroups.map(\.label) == ["Account", "Security", "App", "Data"])
        #expect(PhoneSettingsList.youGroups.first { $0.label == "Data" }?.ids.contains(.thisDevice) == true)
        #expect(PhoneSettingsList.youGroups.first { $0.label == "Security" }?.ids == [.security, .privacy])
    }

    @Test func questionsFindTheirSection() {
        #expect(PhoneSettingsList.matches(.appearance, "how do I turn on dark mode"))
        #expect(PhoneSettingsList.matches(.notifications, "stop emails about comments"))
        #expect(PhoneSettingsList.matches(.appearance, "theme zzz"), "most words, not all")
        #expect(!PhoneSettingsList.matches(.appearance, "zzz qqq"))
        #expect(!PhoneSettingsList.matches(.writing, "passkeys"))
    }

    @Test func askOffersOnlyWithFoliAIAndTwoLetters() {
        #expect(SettingsMatch.canAsk("dark", aiOn: true))
        #expect(!SettingsMatch.canAsk("d", aiOn: true))
        #expect(!SettingsMatch.canAsk("dark", aiOn: false))
    }
}
#endif
