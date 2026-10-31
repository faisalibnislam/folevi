// Foli AI on the iPhone (I5) reads the web's iPhone measurements (phone.json, phone.ai.*) where the iPhone's layout
// differs, and the shared ones elsewhere.
import Testing
import SwiftUI
import FoleviDesign
import FoleviScreens

@Suite("Foli AI on the iPhone") @MainActor
struct PhoneFoliAITests {
    /// Every style the iPhone's Foli AI asks for, as it asks for it (without the `phone.` prefix).
    static let phoneIds = [
        "ai.thread", "ai.page.thread", "ai.user", "ai.user.bubble", "ai.user.edit", "ai.answer", "ai.answer.p",
        "ai.answer.cite", "ai.sources", "ai.sources.title", "ai.sources.list", "ai.source", "ai.source.n",
        "ai.answer.actions", "ai.rowbtn", "ai.suggest.title", "ai.suggest.list", "ai.suggest.item", "ai.suggest.icon",
        "ai.suggest.note", "ai.dock", "ai.page.dock", "ai.composer", "ai.composer.chips", "ai.chip", "ai.chip.icon",
        "ai.chip.add", "ai.composer.input", "ai.composer.bar", "ai.send.disc", "ai.footnote", "ai.page.footnote",
        "ai.page.header", "ai.page.conversations", "ai.page.title", "ai.intro", "ai.intro.title", "ai.intro.lead",
        "ai.intro.list", "ai.intro.item", "ai.intro.try", "ai.intro.suggestions", "ai.intro.suggestion",
    ]

    @Test func everyIphoneStyleIsMeasured() {
        for id in Self.phoneIds {
            #expect(WebStyles.all["phone." + id] != nil, "phone.\(id) is missing: run screen-match.mjs --styles")
        }
    }

    @Test func theIphoneReadsItsOwnMeasurements() {
        let phone = AiLook(scheme: .light, phone: true)
        // The composer: the sheet's corners, white; answers at Body on the iPhone.
        #expect(phone.s("ai.composer").radius == 28)
        #expect(phone.s("ai.answer.p").fontSize == 17)
        // A style the iPhone has no measurement of falls back to the shared one.
        #expect(phone.s("ai.header").height == AiLook(scheme: .light).s("ai.header").height)
    }
}
