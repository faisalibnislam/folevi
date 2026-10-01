import Foundation
import XCTest

/// The onboarding choices must match the ones the web and the server share (convex/lib/onboarding.ts).
final class OnboardingCatalogTests: XCTestCase {
    private func sharedSource() throws -> String {
        try String(contentsOf: Fixtures.repoRoot.appendingPathComponent("convex/lib/onboarding.ts"), encoding: .utf8)
    }

    func testUseCasesMatchTheSharedList() throws {
        let source = try sharedSource()
        // Every use case, in order, with its label and art; then each of its two starter pages.
        let rows = source.matches(of: /id: "([a-z]+)",\s*label: "([^"]+)",\s*art: "(art-\d+)"/)
        XCTAssertEqual(rows.map { String($0.1) }, OnboardingChoices.useCases.map(\.id))
        XCTAssertEqual(rows.map { String($0.2) }, OnboardingChoices.useCases.map(\.label))
        XCTAssertEqual(rows.map { String($0.3) }, OnboardingChoices.useCases.map(\.art))
        for useCase in OnboardingChoices.useCases {
            XCTAssertEqual(useCase.pages.count, 2, useCase.id)
            for page in useCase.pages {
                let line = "{ template: \"\(page.template)\", title: \"\(page.title)\", icon: \"\(page.icon)\" }"
                XCTAssertTrue(source.contains(line), page.template)
            }
        }
    }

    func testNoteStylesMatchTheSharedList() throws {
        let source = try sharedSource()
        let match = try XCTUnwrap(source.firstMatch(of: /ONBOARDING_NOTE_STYLES = \[([^\]]+)\]/))
        let ids = String(match.1).matches(of: /"(art-\d+)"/).map { String($0.1) }
        XCTAssertEqual(ids, OnboardingChoices.noteStyles)
        XCTAssertTrue(OnboardingChoices.isNoteStyle("plain"))
        XCTAssertTrue(OnboardingChoices.isNoteStyle("art-57"))
        XCTAssertFalse(OnboardingChoices.isNoteStyle("art-02"))
    }

    func testStarterPagesFollowThePickOrderAndAddATemplateOnce() {
        let pages = OnboardingChoices.pages(for: ["team", "work"]).map(\.template)
        XCTAssertEqual(pages, ["meeting-notes", "retrospective", "project-brief"])
        XCTAssertEqual(OnboardingChoices.pages(for: ["unknown"]), [])
    }

    func testListReadsLikeASentence() {
        XCTAssertEqual(OnboardingChoices.list([]), "")
        XCTAssertEqual(OnboardingChoices.list(["A"]), "A")
        XCTAssertEqual(OnboardingChoices.list(["A", "B"]), "A and B")
        XCTAssertEqual(OnboardingChoices.list(["A", "B", "C"]), "A, B and C")
    }
}
