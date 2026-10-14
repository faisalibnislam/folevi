import { describe, expect, it } from "vitest";
import { matchOwner, ownerHint, proposalsFrom, resolveWhen, todoBlocksFor, wallClockNow, type ActionItemIn } from "../src/lib/ai/actionItems";

// Wednesday 14 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10, 0, 0);

const item = (over: Partial<ActionItemIn>): ActionItemIn => ({ text: "Send the deck", owner: null, when: null, quote: null, assigneeId: null, match: "none", ...over });

describe("resolveWhen: the note's words, read from the person's today", () => {
  it("reads days, times and lead-in words", () => {
    expect(resolveWhen("by Friday", NOW)).toEqual({ date: "2026-10-16", time: null });
    expect(resolveWhen("tomorrow 3pm", NOW)).toEqual({ date: "2026-10-15", time: "15:00" });
    expect(resolveWhen("next Tuesday at 9:30", NOW)?.time).toBe("09:30");
    expect(resolveWhen("on 12 Nov", NOW)).toEqual({ date: "2026-11-12", time: null });
  });

  it("gives nothing for words that name no day", () => {
    expect(resolveWhen(null, NOW)).toBeNull();
    expect(resolveWhen("", NOW)).toBeNull();
    expect(resolveWhen("ASAP", NOW)).toBeNull();
    expect(resolveWhen("after the launch", NOW)).toBeNull();
  });

  it("uses the person's time zone, not the browser's", () => {
    // 23:30 UTC on Wednesday the 14th: already Thursday in Auckland, still Wednesday afternoon in Los Angeles.
    const at = Date.UTC(2026, 9, 14, 23, 30);
    const auckland = wallClockNow("Pacific/Auckland", at);
    expect([auckland.getFullYear(), auckland.getMonth(), auckland.getDate(), auckland.getHours(), auckland.getMinutes()]).toEqual([2026, 9, 15, 12, 30]);
    expect(resolveWhen("tomorrow", auckland)?.date).toBe("2026-10-16");
    expect(resolveWhen("tomorrow", wallClockNow("America/Los_Angeles", at))?.date).toBe("2026-10-15");
    // An unknown zone falls back to this device's clock rather than failing.
    expect(wallClockNow("Not/AZone", at).getTime()).toBe(at);
  });
});

describe("matchOwner: names as written, to people here", () => {
  const people = [
    { profileId: "p-me", displayName: "Faisal Islam", isYou: true },
    { profileId: "p-sam", displayName: "Sam Rivera" },
    { profileId: "p-ana", displayName: "Ana" },
    { profileId: "p-jo1", displayName: "Jo Park" },
    { profileId: "p-jo2", displayName: "Jo Chen" },
  ];

  it("matches whole names, first names and 'me', ignoring case", () => {
    expect(matchOwner("Sam Rivera", people)).toEqual({ assigneeId: "p-sam", status: "matched" });
    expect(matchOwner("sam", people)).toEqual({ assigneeId: "p-sam", status: "matched" });
    expect(matchOwner("@Sam:", people)).toEqual({ assigneeId: "p-sam", status: "matched" });
    expect(matchOwner("Ana Lopez", people)).toEqual({ assigneeId: "p-ana", status: "matched" });
    expect(matchOwner("me", people)).toEqual({ assigneeId: "p-me", status: "matched" });
    expect(matchOwner("I", people)).toEqual({ assigneeId: "p-me", status: "matched" });
  });

  it("leaves ambiguous, unknown and missing names unassigned", () => {
    expect(matchOwner("Jo", people)).toEqual({ assigneeId: null, status: "ambiguous" });
    expect(matchOwner("Jo Park", people)).toEqual({ assigneeId: "p-jo1", status: "matched" });
    expect(matchOwner("Sam Lee", people)).toEqual({ assigneeId: null, status: "unknown" });
    expect(matchOwner("Priya", people)).toEqual({ assigneeId: null, status: "unknown" });
    expect(matchOwner("Sam and Ana", people)).toEqual({ assigneeId: null, status: "unknown" });
    expect(matchOwner(null, people)).toEqual({ assigneeId: null, status: "none" });
    expect(matchOwner("  ", people)).toEqual({ assigneeId: null, status: "none" });
  });

  it("in Personal only the person's own name or 'me' matches", () => {
    const personal = [{ profileId: "p-me", displayName: "Faisal Islam", isYou: true }];
    expect(matchOwner("Faisal", personal).assigneeId).toBe("p-me");
    expect(matchOwner("me", personal).assigneeId).toBe("p-me");
    expect(matchOwner("Sam", personal)).toEqual({ assigneeId: null, status: "unknown" });
  });
});

describe("the proposal", () => {
  it("resolves dates, keeps owners and says when a date couldn't be read", () => {
    const rows = proposalsFrom(
      [
        item({ text: "Send the deck", owner: "Sam", when: "by Friday", quote: "Sam to send the deck by Friday.", assigneeId: "p-sam", match: "matched" }),
        item({ text: "Book the hall", owner: "Priya", when: "after the launch", match: "unknown" }),
        item({ text: "Write notes" }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.checked, r.date, r.time, r.assigneeId, r.unreadWhen])).toEqual([
      [true, "2026-10-16", "", "p-sam", false],
      [true, "", "", "", true],
      [true, "", "", "", false],
    ]);
    expect(ownerHint(rows[0]!)).toBeNull();
    expect(ownerHint(rows[1]!)).toBe("Priya?");
    expect(ownerHint(rows[2]!)).toBeNull();
    expect(ownerHint({ owner: "Jo", match: "ambiguous", assigneeId: "" })).toBe("Jo?");
  });

  it("turns the checked rows into to-do blocks with due date, time and assignee", () => {
    const rows = proposalsFrom(
      [
        item({ text: "Send the deck", owner: "Sam", when: "tomorrow 3pm", assigneeId: "p-sam", match: "matched" }),
        item({ text: "Book the hall", owner: "Priya", match: "unknown" }),
        item({ text: "Skip me" }),
        item({ text: "   " }),
      ],
      NOW,
    );
    rows[2]!.checked = false;
    const blocks = todoBlocksFor(rows, { heading: "To-dos" });
    expect(blocks.map((b) => b.type)).toEqual(["heading", "todo", "todo"]);
    expect(blocks[0]!.props).toEqual({ level: 2 });
    expect(blocks[1]!.props).toEqual({ checked: false, dueDate: "2026-10-15", dueTime: "15:00", assigneeId: "p-sam" });
    expect(blocks[1]!.text).toEqual([{ type: "text", text: "Send the deck" }]);
    // Unassigned, with the name kept in front so who it's for isn't lost.
    expect(blocks[2]!.props).toEqual({ checked: false });
    expect(blocks[2]!.text).toEqual([{ type: "text", text: "Priya: Book the hall" }]);
    // Ranks keep their order.
    expect([...blocks].sort((a, b) => (a.rank < b.rank ? -1 : 1)).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(todoBlocksFor(rows.map((r) => ({ ...r, checked: false })))).toEqual([]);
  });
});
