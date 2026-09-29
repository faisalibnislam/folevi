// Onboarding: the steps a new account walks through and the choices it offers. Shared with the web app
// (apps/web/src/lib/onboarding.ts), so this file must stay free of server-only imports.

/**
 * Where a person is in onboarding (profiles.onboardingStep), in order. The value names the step they are
 * on. "workspace" is the first step (its name comes from an older flow that asked for a workspace name);
 * "appearance" and "welcome" also come from that flow, so profiles saved by it resume in the right place.
 */
export const ONBOARDING_STEPS = ["workspace", "uses", "style", "appearance", "ai", "welcome", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
/** Steps a client can complete (everything but "done"). */
export type CompletableStep = Exclude<OnboardingStep, "done">;

/** The step after `step`. */
export function stepAfter(step: CompletableStep): OnboardingStep {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1]!;
}

/** The later of two steps: onboarding only moves forward, so going Back in one app never undoes another's progress. */
export function laterStep(a: OnboardingStep, b: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS.indexOf(a) >= ONBOARDING_STEPS.indexOf(b) ? a : b;
}

/** A starter page a use case adds: a built-in template (convex/lib/templates.ts) by key, with its name and icon. */
export interface StarterPage {
  template: string;
  title: string;
  icon: string;
}

export interface UseCase {
  id: string;
  label: string;
  /** A note style (cover art id) that illustrates the choice. */
  art: string;
  pages: StarterPage[];
}

/**
 * What someone can say they'll use Folevi for. Each choice adds two starter pages made from built-in
 * templates (a template shared by two choices is added once). tests/convex/onboarding.test.ts checks every
 * key, title and icon against BUILT_IN_TEMPLATES.
 */
export const USE_CASES: readonly UseCase[] = [
  {
    id: "notes",
    label: "Personal notes",
    art: "art-05",
    pages: [
      { template: "daily-page", title: "Daily Page", icon: "sun" },
      { template: "brainstorm", title: "Brainstorm", icon: "lightbulb" },
    ],
  },
  {
    id: "work",
    label: "Work projects",
    art: "art-16",
    pages: [
      { template: "project-brief", title: "Project Brief", icon: "compass" },
      { template: "meeting-notes", title: "Meeting Notes", icon: "users" },
    ],
  },
  {
    id: "study",
    label: "Study and research",
    art: "art-38",
    pages: [
      { template: "class-notes", title: "Class Notes", icon: "graduation-cap" },
      { template: "research-notes", title: "Research Notes", icon: "flask-conical" },
    ],
  },
  {
    id: "journal",
    label: "Journaling",
    art: "art-09",
    pages: [
      { template: "journal", title: "Journal Entry", icon: "heart" },
      { template: "habit-tracker", title: "Habit Tracker", icon: "calendar-check" },
    ],
  },
  {
    id: "travel",
    label: "Trips and events",
    art: "art-30",
    pages: [
      { template: "travel-plan", title: "Travel Plan", icon: "plane" },
      { template: "event-plan", title: "Event Plan", icon: "party-popper" },
    ],
  },
  {
    id: "team",
    label: "Team knowledge",
    art: "art-06",
    pages: [
      { template: "meeting-notes", title: "Meeting Notes", icon: "users" },
      { template: "retrospective", title: "Retrospective", icon: "history" },
    ],
  },
  {
    id: "writing",
    label: "Writing",
    art: "art-46",
    pages: [
      { template: "writing-draft", title: "Writing Draft", icon: "pen-line" },
      { template: "reading-notes", title: "Reading Notes", icon: "book-open" },
    ],
  },
  {
    id: "home",
    label: "Home and health",
    art: "art-24",
    pages: [
      { template: "budget", title: "Monthly Budget", icon: "wallet" },
      { template: "recipe", title: "Recipe", icon: "chef-hat" },
    ],
  },
];

export const USE_CASE_IDS: readonly string[] = USE_CASES.map((u) => u.id);

/** The starter pages for a set of use cases, in the order given, each template once. */
export function starterPagesFor(ids: readonly string[]): StarterPage[] {
  const out: StarterPage[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const page of USE_CASES.find((u) => u.id === id)?.pages ?? []) {
      if (seen.has(page.template)) continue;
      seen.add(page.template);
      out.push(page);
    }
  }
  return out;
}

/** "plain": no note style (a new note's default). */
export const PLAIN_STYLE = "plain";

/** The note styles offered for the Welcome page during onboarding (cover art ids). */
export const ONBOARDING_NOTE_STYLES = ["art-03", "art-39", "art-40", "art-09", "art-01", "art-30", "art-49", "art-57"] as const;

export function isOnboardingNoteStyle(value: string): boolean {
  return value === PLAIN_STYLE || (ONBOARDING_NOTE_STYLES as readonly string[]).includes(value);
}
