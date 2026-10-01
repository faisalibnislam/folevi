import Foundation

/// The choices onboarding offers (convex/lib/onboarding.ts, shared with the web).
enum OnboardingChoices {
    /// A starter page a use case adds: a built-in template by key, with its name and icon (Lucide name).
    struct StarterPage: Hashable, Sendable {
        var template: String
        var title: String
        var icon: String
    }

    struct UseCase: Identifiable, Sendable {
        var id: String
        var label: String
        /// A note style (cover art id) that illustrates the choice.
        var art: String
        var pages: [StarterPage]
    }

    /// "plain": no note style (a new note's default).
    static let plain = "plain"
    /// The note styles offered for the Welcome page.
    static let noteStyles = ["art-03", "art-39", "art-40", "art-09", "art-01", "art-30", "art-49", "art-57"]
    static let welcomeTitle = "Welcome to Folevi"
    /// convex/lib/plans.ts TRIAL_DAYS.
    static let trialDays = 7

    static let useCases: [UseCase] = [
        UseCase(id: "notes", label: String(localized: "Personal notes"), art: "art-05", pages: [
            StarterPage(template: "daily-page", title: "Daily Page", icon: "sun"),
            StarterPage(template: "brainstorm", title: "Brainstorm", icon: "lightbulb"),
        ]),
        UseCase(id: "work", label: String(localized: "Work projects"), art: "art-16", pages: [
            StarterPage(template: "project-brief", title: "Project Brief", icon: "compass"),
            StarterPage(template: "meeting-notes", title: "Meeting Notes", icon: "users"),
        ]),
        UseCase(id: "study", label: String(localized: "Study and research"), art: "art-38", pages: [
            StarterPage(template: "class-notes", title: "Class Notes", icon: "graduation-cap"),
            StarterPage(template: "research-notes", title: "Research Notes", icon: "flask-conical"),
        ]),
        UseCase(id: "journal", label: String(localized: "Journaling"), art: "art-09", pages: [
            StarterPage(template: "journal", title: "Journal Entry", icon: "heart"),
            StarterPage(template: "habit-tracker", title: "Habit Tracker", icon: "calendar-check"),
        ]),
        UseCase(id: "travel", label: String(localized: "Trips and events"), art: "art-30", pages: [
            StarterPage(template: "travel-plan", title: "Travel Plan", icon: "plane"),
            StarterPage(template: "event-plan", title: "Event Plan", icon: "party-popper"),
        ]),
        UseCase(id: "team", label: String(localized: "Team knowledge"), art: "art-06", pages: [
            StarterPage(template: "meeting-notes", title: "Meeting Notes", icon: "users"),
            StarterPage(template: "retrospective", title: "Retrospective", icon: "history"),
        ]),
        UseCase(id: "writing", label: String(localized: "Writing"), art: "art-46", pages: [
            StarterPage(template: "writing-draft", title: "Writing Draft", icon: "pen-line"),
            StarterPage(template: "reading-notes", title: "Reading Notes", icon: "book-open"),
        ]),
        UseCase(id: "home", label: String(localized: "Home and health"), art: "art-24", pages: [
            StarterPage(template: "budget", title: "Monthly Budget", icon: "wallet"),
            StarterPage(template: "recipe", title: "Recipe", icon: "chef-hat"),
        ]),
    ]

    /// The starter pages for a set of use cases, in the order given, each template once (`starterPagesFor`).
    static func pages(for ids: [String]) -> [StarterPage] {
        var seen = Set<String>()
        var out: [StarterPage] = []
        for id in ids {
            for page in useCases.first(where: { $0.id == id })?.pages ?? [] where seen.insert(page.template).inserted {
                out.append(page)
            }
        }
        return out
    }

    /// The style a note may be saved with during onboarding (`isOnboardingNoteStyle`).
    static func isNoteStyle(_ id: String) -> Bool { id == plain || noteStyles.contains(id) }

    /// "A", "A and B", "A, B and C".
    static func list(_ items: [String]) -> String {
        guard items.count > 1, let last = items.last else { return items.first ?? "" }
        return items.dropLast().joined(separator: ", ") + String(localized: " and ") + last
    }
}
