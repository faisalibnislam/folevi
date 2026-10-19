// The sticky notes board's data beyond the shared visual-block checks (visual-blocks.test.ts): dot votes,
// the workshop timer, merging two people's edits, lists of ideas and arranging (src/stickies.ts).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  STICKY_VOTES,
  arrangeStickies,
  emptyStickies,
  markdownToBlocks,
  mergeStickies,
  normalizeStickies,
  parseStickies,
  serializeStickies,
  stickiesDataIssue,
  stickiesFromFence,
  stickiesFromIdeas,
  stickiesToMarkdown,
  stickyFromIdea,
  stickyGroupOf,
  stickyIdeasFromText,
  stickyTimerDone,
  stickyTimerLeft,
  stickyTimerRunning,
  stickyVoteCount,
  stickyVotesBy,
  validateWireBlock,
  voteOnSticky,
  type StickiesData,
} from "../src";

const board = (): StickiesData => ({
  ...emptyStickies(),
  notes: [
    stickyFromIdea({ text: "Faster sign up", color: "pink" }, "s1", { x: 0, y: 0 }, "alice"),
    stickyFromIdea({ text: "Dark mode" }, "s2", { x: 200, y: 0 }, "bob"),
    stickyFromIdea({ text: "Offline" }, "s3", { x: 400, y: 0 }),
  ],
});

describe("dot votes", () => {
  it("each person votes within the board's limit, can take a vote back, and totals add up", () => {
    let b = { ...board(), voteLimit: 3 };
    b = voteOnSticky(b, "s1", "alice", 1);
    b = voteOnSticky(b, "s1", "alice", 1);
    b = voteOnSticky(b, "s2", "alice", 1);
    // A fourth vote is over the limit: nothing changes.
    expect(voteOnSticky(b, "s3", "alice", 1)).toBe(b);
    b = voteOnSticky(b, "s1", "bob", 1);
    expect(stickyVotesBy(b, "alice")).toBe(3);
    expect(stickyVoteCount(b.notes[0]!)).toBe(3);
    b = voteOnSticky(b, "s1", "alice", -1);
    expect(b.notes[0]!.votes).toEqual({ alice: 1, bob: 1 });
    // Taking back a vote that isn't there, or voting on a note that isn't there, changes nothing.
    expect(voteOnSticky(b, "s3", "alice", -1)).toBe(b);
    expect(voteOnSticky(b, "nope", "alice", 1)).toBe(b);
    // Votes survive the wire, sorted by voter, and pass the server's check.
    const wire = serializeStickies(b);
    expect(stickiesDataIssue(wire)).toBeNull();
    expect(parseStickies(wire).notes[0]!.votes).toEqual({ alice: 1, bob: 1 });
    expect(parseStickies(wire).voteLimit).toBe(3);
  });

  it("the server refuses bad votes and limits", () => {
    const note = { id: "s1", x: 0, y: 0, text: "x" };
    const issue = (extra: Record<string, unknown>, top: Record<string, unknown> = {}) => stickiesDataIssue(JSON.stringify({ v: 1, notes: [{ ...note, ...extra }], ...top }));
    expect(issue({ votes: { alice: 2 } })).toBeNull();
    expect(issue({ votes: { alice: 0 } })).toMatch(/vote count/);
    expect(issue({ votes: { alice: 1.5 } })).toMatch(/vote count/);
    expect(issue({ votes: { alice: 99 } })).toMatch(/vote count/);
    expect(issue({ votes: { "a b": 1 } })).toMatch(/voter/);
    expect(issue({ votes: [1] })).toMatch(/votes/);
    expect(issue({}, { voteLimit: 0 })).toMatch(/vote limit/);
    expect(issue({}, { voteLimit: 21 })).toMatch(/vote limit/);
    expect(issue({}, { voteLimit: 8 })).toBeNull();
    // The reader drops what it can't use.
    expect(normalizeStickies({ notes: [{ ...note, votes: { alice: 0, bob: 2, "x y": 1 } }], voteLimit: 99 })).toMatchObject({ notes: [{ votes: { bob: 2 } }], voteLimit: 20 });
  });
});

describe("the workshop timer", () => {
  it("counts down from its start on every viewer's clock, pauses, and runs out", () => {
    const start = 1_800_000_000_000;
    const running = { total: 300_000, left: 300_000, startedAt: start };
    expect(stickyTimerLeft(running, start + 60_000)).toBe(240_000);
    expect(stickyTimerRunning(running, start + 60_000)).toBe(true);
    expect(stickyTimerLeft(running, start + 400_000)).toBe(0);
    expect(stickyTimerDone(running, start + 400_000)).toBe(true);
    // A clock a little behind the start never reads more than was left.
    expect(stickyTimerLeft(running, start - 5_000)).toBe(300_000);
    const paused = { total: 300_000, left: 120_000 };
    expect(stickyTimerLeft(paused, start + 10_000_000)).toBe(120_000);
    expect(stickyTimerRunning(paused, start)).toBe(false);
    expect(stickyTimerDone(paused, start)).toBe(false);
    expect(stickyTimerLeft(undefined, start)).toBe(0);
  });

  it("is checked on the server and kept on the wire", () => {
    const issue = (timer: unknown) => stickiesDataIssue(JSON.stringify({ v: 1, notes: [], timer }));
    expect(issue({ total: 300_000, left: 300_000, startedAt: 1_800_000_000_000 })).toBeNull();
    expect(issue({ total: 300_000, left: 10_000 })).toBeNull();
    expect(issue({ total: 10, left: 10 })).toMatch(/total/);
    expect(issue({ total: 300_000, left: -1 })).toMatch(/left/);
    expect(issue({ total: 99 * 3_600_000, left: 1 })).toMatch(/total/);
    expect(issue({ total: 300_000, left: 1, startedAt: 12 })).toMatch(/start/);
    expect(issue({ total: 300_000, left: 1, sound: true })).toMatch(/unexpected/);
    // A board with only a timer is still a board.
    const b = { ...emptyStickies(), timer: { total: 60_000, left: 60_000 } };
    expect(serializeStickies(b)).not.toBe("");
    expect(parseStickies(serializeStickies(b)).timer).toEqual({ total: 60_000, left: 60_000 });
  });
});

describe("merging two people's edits", () => {
  it("keeps both sides' changes, both sides' votes, and their deletes", () => {
    const base = board();
    // They: moved s2, voted on s1, added s4, deleted s3.
    let theirs = voteOnSticky(base, "s1", "bob", 1);
    theirs = { ...theirs, notes: [...theirs.notes.filter((n) => n.id !== "s3").map((n) => (n.id === "s2" ? { ...n, x: 999 } : n)), stickyFromIdea({ text: "Their idea" }, "s4", { x: 0, y: 400 }, "bob")] };
    // I: recoloured s1, voted on s2 twice, added s5, started the timer.
    let mine = voteOnSticky(voteOnSticky(base, "s2", "alice", 1), "s2", "alice", 1);
    mine = { ...mine, notes: [...mine.notes.map((n) => (n.id === "s1" ? { ...n, color: "blue" as const } : n)), stickyFromIdea({ text: "My idea" }, "s5", { x: 0, y: 600 }, "alice")], timer: { total: 60_000, left: 60_000, startedAt: 1_800_000_000_000 } };
    const merged = mergeStickies(base, theirs, mine, "alice");
    const byId = new Map(merged.notes.map((n) => [n.id, n]));
    expect([...byId.keys()].sort()).toEqual(["s1", "s2", "s4", "s5"]);
    expect(byId.get("s1")).toMatchObject({ color: "blue", votes: { bob: 1 } });
    expect(byId.get("s2")).toMatchObject({ x: 999, votes: { alice: 2 } });
    expect(merged.timer).toEqual(mine.timer);
    expect(stickiesDataIssue(serializeStickies(merged))).toBeNull();
  });

  it("a note they changed comes back if I deleted it; one I changed stays if they deleted it", () => {
    const base = board();
    const theirs = { ...base, notes: base.notes.map((n) => (n.id === "s1" ? { ...n, text: "Edited" } : n)).filter((n) => n.id !== "s2") };
    const mine = { ...base, notes: base.notes.map((n) => (n.id === "s2" ? { ...n, text: "Mine" } : n)).filter((n) => n.id !== "s1") };
    const merged = mergeStickies(base, theirs, mine, "alice");
    expect(merged.notes.map((n) => [n.id, n.text]).sort()).toEqual([
      ["s1", "Edited"],
      ["s2", "Mine"],
      ["s3", "Offline"],
    ]);
  });

  it("votes never clash: each person's own votes always survive a merge", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom("s1", "s2", "s3"), fc.boolean()), { maxLength: 6 }), fc.array(fc.tuple(fc.constantFrom("s1", "s2", "s3"), fc.boolean()), { maxLength: 6 }), (aliceVotes, bobVotes) => {
        const base = board();
        const apply = (who: string, votes: [string, boolean][]) => votes.reduce((b, [id, up]) => voteOnSticky(b, id, who, up ? 1 : -1), base);
        const mine = apply("alice", aliceVotes);
        const theirs = apply("bob", bobVotes);
        const merged = mergeStickies(base, theirs, mine, "alice");
        expect(stickyVotesBy(merged, "alice")).toBe(stickyVotesBy(mine, "alice"));
        expect(stickyVotesBy(merged, "bob")).toBe(stickyVotesBy(theirs, "bob"));
      }),
    );
  });
});

describe("lists of ideas", () => {
  it("typed or pasted lines become one note each: markers, colours and tags read", () => {
    const ideas = stickyIdeasFromText("- Faster sign up #ux #growth\n\n* [pink] Dark mode\n1. Offline mode\n[ ] Export to PDF\n   \n• Widgets");
    expect(ideas).toEqual([{ text: "Faster sign up", tags: ["ux", "growth"] }, { text: "Dark mode", color: "pink" }, { text: "Offline mode" }, { text: "Export to PDF" }, { text: "Widgets" }]);
    // A hashtag alone is the note's text, not a tag.
    expect(stickyIdeasFromText("#launch")).toEqual([{ text: "#launch" }]);
  });

  it("spreadsheet rows become one note per row; a colour cell colours it", () => {
    const ideas = stickyIdeasFromText('Faster sign up\tGrowth\tpink\n"Dark ""mode"""\tDesign\n\t\n');
    expect(ideas).toEqual([{ text: "Faster sign up · Growth", color: "pink" }, { text: 'Dark "mode" · Design' }]);
    expect(stickyIdeasFromText("a\nb\nc", 2)).toHaveLength(2);
  });

  it("a ```stickies fence becomes a laid-out board with labelled groups", () => {
    const b = stickiesFromFence("Loose idea\n## Quick wins\n- Faster sign up\n- [green] Dark mode #ui\n## Later\nOffline\n## Empty\n");
    expect(b.groups.map((g) => g.label)).toEqual(["Quick wins", "Later"]);
    expect(b.notes.map((n) => n.text)).toEqual(["Faster sign up", "Dark mode", "Offline", "Loose idea"]);
    // Every grouped note sits inside its group; the loose one in none.
    const groupOf = (text: string) => stickyGroupOf(b.notes.find((n) => n.text === text)!, b.groups)?.label ?? null;
    expect([groupOf("Faster sign up"), groupOf("Dark mode"), groupOf("Offline"), groupOf("Loose idea")]).toEqual(["Quick wins", "Quick wins", "Later", null]);
    expect(b.notes.find((n) => n.text === "Dark mode")).toMatchObject({ color: "green", tags: ["ui"] });
    // Groups get a colour each when their ideas don't name one.
    expect(b.notes.find((n) => n.text === "Faster sign up")!.color).not.toBe(b.notes.find((n) => n.text === "Offline")!.color);
    expect(stickiesDataIssue(serializeStickies(b))).toBeNull();
  });

  it("Markdown with a ```stickies fence imports as a sticky notes block the server accepts", () => {
    const { blocks } = markdownToBlocks("Ideas from the retro:\n\n```stickies\n## Went well\nShipped on time\n## To improve\nFewer meetings\n```\n");
    const sticky = blocks.find((x) => x.type === "stickies")!;
    expect(sticky).toBeTruthy();
    expect(validateWireBlock(sticky)).toEqual([]);
    expect(parseStickies(String(sticky.props.data)).notes.map((n) => n.text)).toEqual(["Shipped on time", "Fewer meetings"]);
    // An empty fence stays a code block.
    expect(markdownToBlocks("```stickies\n\n```").blocks[0]!.type).toBe("code");
  });

  it("exports mention vote totals", () => {
    const b = voteOnSticky(board(), "s1", "alice", 1);
    expect(stickiesToMarkdown(b, (s) => s).join("\n")).toContain("- Faster sign up [1 vote]");
  });
});

describe("arranging", () => {
  it("buckets become labelled group areas holding their notes; the rest go under them", () => {
    const b = arrangeStickies(board(), [
      { label: "Pink", ids: ["s1"] },
      { label: "Yellow", ids: ["s2", "s1"] },
    ]);
    expect(b.groups.map((g) => g.label)).toEqual(["Pink", "Yellow"]);
    const groupOf = (id: string) => stickyGroupOf(b.notes.find((n) => n.id === id)!, b.groups)?.label ?? null;
    expect([groupOf("s1"), groupOf("s2"), groupOf("s3")]).toEqual(["Pink", "Yellow", null]);
    // No two notes overlap.
    for (const a of b.notes)
      for (const c of b.notes) if (a !== c) expect(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y).toBe(true);
    expect(stickiesDataIssue(serializeStickies(b))).toBeNull();
  });

  it("a big board of ideas stays within the limits", () => {
    const ideas = Array.from({ length: 60 }, (_, i) => ({ text: `Idea ${i}` }));
    const b = stickiesFromIdeas({ groups: Array.from({ length: 12 }, (_, g) => ({ label: `Theme ${g}`, ideas: ideas.slice(g * 5, g * 5 + 5) })) });
    expect(b.notes).toHaveLength(60);
    expect(b.groups).toHaveLength(12);
    expect(stickiesDataIssue(serializeStickies(b))).toBeNull();
    expect(b.voteLimit).toBe(STICKY_VOTES);
  });
});
