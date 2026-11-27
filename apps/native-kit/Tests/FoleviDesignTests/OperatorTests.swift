// Space Cherries LLC operates Folevi (the owner, 2026-11-27); the apps name it from FoleviOperator.
import Foundation
import Testing
@testable import FoleviDesign

struct OperatorTests {
    @Test func namesTheCompanyAndItsAddress() {
        #expect(FoleviOperator.name == "Space Cherries LLC")
        #expect(FoleviOperator.website.absoluteString == "https://www.spacecherries.com")
        #expect(FoleviOperator.address == "5242 Elbetee Lane, Alexandria, VA 22312, USA")
        #expect(FoleviOperator.copyright == "© 2026 Space Cherries LLC")
        #expect(FoleviOperator.operatedBy == "Operated by Space Cherries LLC")
    }

    @Test func signUpLineLinksTheWebsite() throws {
        let line = try AttributedString(markdown: FoleviOperator.signUpMarkdown)
        #expect(String(line.characters) == "Folevi is operated by Space Cherries LLC.")
        #expect(line.runs.contains { $0.link == FoleviOperator.website })
    }
}
