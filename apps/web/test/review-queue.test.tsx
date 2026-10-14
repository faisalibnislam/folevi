// The review queue (convex/study.ts) on the web: the intervals on the rating buttons, what each key does, the
// person's day, and the card flow (Space shows the answer, 1 to 4 rate it, the next card follows).
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const convex = vi.hoisted(() => ({ queue: undefined as unknown, reviews: [] as unknown[] }));
vi.mock("convex/react", () => ({
  useQuery: () => convex.queue,
  useMutation: () => async (args: unknown) => {
    convex.reviews.push(args);
    return { due: 0, duplicate: false };
  },
}));
vi.mock("@/lib/app/state", () => ({ useAppState: () => ({ workspaces: [] }) }));
vi.mock("@/lib/app/router", () => ({
  useAppRouter: () => ({ search: new URLSearchParams(), navigate: vi.fn() }),
  AppLink: (p: { children: unknown }) => p.children,
}));
vi.mock("@/components/app/Shell", () => ({ ViewChrome: (p: { children: unknown }) => p.children }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }), errorMessage: (e: unknown) => String(e) }));

const { intervalLabel, intervalWords, reviewKey, reviewWindow, RATINGS } = await import("@/components/study/review");
const { ReviewView } = await import("@/components/views/ReviewView");

const MIN = 60_000;
const DAY = 86_400_000;

describe("interval labels", () => {
  test("short labels for the buttons, words for screen readers", () => {
    expect(intervalLabel(0)).toBe("1m");
    expect(intervalLabel(MIN)).toBe("1m");
    expect(intervalLabel(10 * MIN)).toBe("10m");
    expect(intervalLabel(3 * 60 * MIN)).toBe("3h");
    expect(intervalLabel(DAY)).toBe("1d");
    expect(intervalLabel(4 * DAY + 3 * 60 * MIN)).toBe("4d");
    expect(intervalLabel(65 * DAY)).toBe("2mo");
    expect(intervalLabel(548 * DAY)).toBe("1.5y");
    expect(intervalWords(10 * MIN)).toBe("10 minutes");
    expect(intervalWords(DAY)).toBe("1 day");
    expect(intervalWords(65 * DAY)).toBe("2 months");
    expect(intervalWords(548 * DAY)).toBe("1.5 years");
  });
});

describe("review keys", () => {
  test("Space or Enter shows the answer; then 1 to 4 rate; modifiers are left alone", () => {
    expect(reviewKey({ key: " " }, false)).toEqual({ kind: "reveal" });
    expect(reviewKey({ key: "Enter" }, false)).toEqual({ kind: "reveal" });
    expect(reviewKey({ key: "3" }, false)).toBeNull();
    expect(RATINGS.map((r) => reviewKey({ key: r.key }, true))).toEqual([
      { kind: "rate", rating: "again" },
      { kind: "rate", rating: "hard" },
      { kind: "rate", rating: "good" },
      { kind: "rate", rating: "easy" },
    ]);
    expect(reviewKey({ key: " " }, true)).toBeNull();
    expect(reviewKey({ key: "1", metaKey: true }, true)).toBeNull();
    expect(reviewKey({ key: " ", ctrlKey: true }, false)).toBeNull();
  });

  test("the day runs from local midnight to midnight, and now is rounded down", () => {
    const at = new Date(2026, 9, 14, 15, 42, 31).getTime();
    const w = reviewWindow(at);
    expect(w.dayStart).toBe(new Date(2026, 9, 14).getTime());
    expect(w.dayEnd).toBe(new Date(2026, 9, 15).getTime());
    expect(w.now).toBe(new Date(2026, 9, 14, 15, 42).getTime());
  });
});

function card(blockId: string, front: string, back: string, extra: Record<string, unknown> = {}) {
  return { blockId, kind: "card", documentId: "DOC", documentTitle: "Biology", documentIcon: null, front, back, isNew: true, lastReview: null, intervals: { again: MIN, hard: 6 * MIN, good: 10 * MIN, easy: 8 * DAY }, ...extra };
}

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  convex.reviews = [];
});

function render() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ReviewView)));
  return host;
}

const press = (key: string) => act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

describe("the review page", () => {
  test("Space shows the answer, the buttons show when the card comes back, 3 rates it Good and the next card follows", () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    convex.queue = { cards: [card("B1", "What do cells divide by?", "Mitosis"), card("B2", "Powerhouse of the cell?", "Mitochondria")], counts: { due: 0, new: 2, later: 0 }, total: 0, hasCards: true, documentTitle: null };
    const host = render();
    expect(host.textContent).toContain("What do cells divide by?");
    expect(host.textContent).not.toContain("Mitosis");
    expect(host.textContent).toContain("Card 1 of 2");
    press(" ");
    expect(host.textContent).toContain("Mitosis");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="group"] button')];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Again, back in 1 minute", "Hard, back in 6 minutes", "Good, back in 10 minutes", "Easy, back in 8 days"]);
    expect(buttons.map((b) => b.textContent)).toEqual(["Again1m", "Hard6m", "Good10m", "Easy8d"]);
    press("3");
    expect(convex.reviews).toEqual([{ blockId: "B1", rating: "good", lastReview: null }]);
    expect(host.textContent).toContain("Powerhouse of the cell?");
    expect(host.textContent).not.toContain("Mitochondria");
    expect(host.textContent).toContain("Card 2 of 2");
    // Rating keys do nothing until the answer shows.
    press("1");
    expect(convex.reviews).toHaveLength(1);
  });

  test("with nothing due it says so, and when cards come back", () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    convex.queue = { cards: [], counts: { due: 0, new: 0, later: 3 }, total: 0, hasCards: true, documentTitle: null };
    const host = render();
    expect(host.textContent).toContain("Nothing to review");
    expect(host.textContent).toContain("Cards from your notes come back here when they're due. 3 cards later today.");
  });
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
