import { describe, expect, test } from "vitest";
import { awayMarks, type Away } from "@/components/doc/AwayBanner";
import { authorSheet } from "@/components/editor/plugins";

const away: Away = {
  since: Date.now() - 2 * 86_400_000,
  people: [{ key: "k1", name: "Sam Rivera", color: "moss", avatarUrl: null }],
  lines: [
    ["b1", "k1", Date.now() - 3_600_000, "edited"],
    ["b2", "k1", Date.now() - 3_600_000, "added"],
  ],
  removed: 1,
  more: false,
};

describe("since you were away: marking the lines", () => {
  test("each changed line is marked in its author's colour, washed, with what happened and who", () => {
    const marks = awayMarks(away);
    expect([...marks.keys()]).toEqual(["b1", "b2"]);
    expect(marks.get("b1")).toMatchObject({ color: "moss", tint: true });
    expect(marks.get("b1")!.label).toMatch(/^Changed by Sam Rivera · /);
    expect(marks.get("b2")!.label).toMatch(/^Added by Sam Rivera · /);
    // The wash is part of the line's stylesheet entry; plain "Show editors" lines have none.
    const sheet = authorSheet(marks);
    expect(sheet).toContain('[data-block-id="b1"]');
    expect(sheet).toContain("--author-tint:color-mix(in oklab,var(--color-moss) 10%,transparent)");
    expect(authorSheet(new Map([["b3", { color: "moss", label: "Sam · now" }]]))).not.toContain("--author-tint");
  });
});
