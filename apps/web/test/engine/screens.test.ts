// Revision 13 through the bridge host: the Graph (aiGraph.graph placed by the web's own layout) and Reviews
// (study.queue for the person's day) views, and the review commands.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import { layOut } from "@/lib/engine/viewsScreens";
import type { GraphValue, Reply, ReviewsValue } from "@/lib/engine/protocol";
import { Posts, rig, type Rig } from "./fakes";

const PLACE = "acct:user_1";
let host: BridgeHost;
let r: Rig;
let n = 0;
const send = async (m: Record<string, unknown>) => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
const ok = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
};
const code = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  return reply.ok ? null : reply.error.code;
};
const query = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "query", place: PLACE, name, args });
const command = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "command", place: PLACE, name, args });

beforeEach(() => {
  host = new BridgeHost({ post: new Posts().post, schedule: () => undefined, marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  host.attach(r.deps());
  n = 0;
});
afterEach(() => {
  host.dispose();
  resetNoteHost();
  resetGates();
});

const NODES = [
  { id: "n1", kind: "note", label: "Kyoto" },
  { id: "n2", kind: "note", label: "Packing" },
  { id: "p1", kind: "person", label: "Sam" },
];
const EDGES = [
  { source: "n1", target: "n2", kind: "link", inferred: false },
  { source: "n1", target: "p1", kind: "mention", inferred: true },
];

describe("graph", () => {
  it("every node placed where the web's layout puts it, with its degree", async () => {
    r.client.answer("aiGraph:graph", { full: true, note: null, upgrade: false, truncated: false, nodes: NODES, edges: EDGES });
    const v = (await query("graph")) as GraphValue;
    const placed = layOut(NODES, EDGES);
    expect(v.nodes).toEqual(NODES.map((x) => ({ ...x, x: placed.get(x.id)!.x, y: placed.get(x.id)!.y, degree: x.id === "n1" ? 2 : 1 })));
    expect(v.edges).toEqual(EDGES);
    expect(v).toMatchObject({ full: true, note: null, upgrade: false, truncated: false });
    // The same graph lays out the same way every time.
    expect(layOut(NODES, EDGES)).toEqual(placed);
  });

  it("kinds narrow the entities; bad kinds are refused", async () => {
    let asked: Record<string, unknown> | null = null;
    r.client.answer("aiGraph:graph", (a: Record<string, unknown>) => ((asked = a), { full: true, note: null, upgrade: false, truncated: false, nodes: [], edges: [] }));
    expect(((await query("graph", { kinds: ["person"] })) as GraphValue).nodes).toEqual([]);
    expect(asked).toMatchObject({ kinds: ["person"] });
    expect(await code({ kind: "query", place: PLACE, name: "graph", args: { kinds: ["cats"] } })).toBe("invalid_args");
  });
});

describe("reviews", () => {
  const card = { blockId: "b1", kind: "flashcard", documentId: "d1", documentTitle: "Kyoto", front: "Q", back: "A", isNew: true, lastReview: null, intervals: { again: 1, hard: 2, good: 3, easy: 4 } };
  it("the queue for the person's day, as cards", async () => {
    let asked: Record<string, unknown> | null = null;
    r.client.answer("study:queue", (a: Record<string, unknown>) => ((asked = a), { cards: [card], counts: { due: 0, new: 1, later: 2 }, total: 1, hasCards: true, documentTitle: null, newPerDay: 20 }));
    const v = (await query("reviews")) as ReviewsValue;
    expect(v).toEqual({ found: true, cards: [{ blockId: "b1", kind: "flashcard", noteId: "d1", noteTitle: "Kyoto", front: "Q", back: "A", isNew: true, lastReview: null, intervals: card.intervals }], due: 0, new: 1, later: 2, total: 1, hasCards: true, noteTitle: null, newPerDay: 20 });
    expect(asked).toMatchObject({ limit: 20 });
    expect((asked as unknown as { dayEnd: number; dayStart: number }).dayEnd).toBeGreaterThan((asked as unknown as { dayStart: number }).dayStart);
  });

  it("a note that can't be opened reads as not found", async () => {
    r.client.answer("study:queue", null);
    expect(((await query("reviews", { noteId: "d9" })) as ReviewsValue).found).toBe(false);
    expect(await code({ kind: "query", place: PLACE, name: "reviews", args: { noteId: "d9", space: "personal" } })).toBe("invalid_args");
  });

  it("review.rate and review.setNewPerDay", async () => {
    await command("review.rate", { blockId: "b1", rating: "good", lastReview: null });
    expect(r.client.mutations.at(-1)).toEqual({ name: "study:review", args: { blockId: "b1", rating: "good", lastReview: null } });
    await command("review.setNewPerDay", { value: 10 });
    expect(r.client.mutations.at(-1)).toEqual({ name: "study:setNewPerDay", args: { value: 10 } });
    expect(await code({ kind: "command", place: PLACE, name: "review.setNewPerDay", args: { value: 7 } })).toBe("invalid_args");
    expect(await code({ kind: "command", place: PLACE, name: "review.rate", args: { blockId: "b1", rating: "meh", lastReview: null } })).toBe("invalid_args");
  });
});
