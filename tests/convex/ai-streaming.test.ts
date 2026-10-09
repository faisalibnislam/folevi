// What a streamed chat answer costs (convex/aiChat.ts writeMessage, streamText): the text so far goes to an
// aiStreams row, so the conversation's query (`get`, which reads every shown message, run, file and context
// note) isn't re-run for every chunk. Reads are counted by running the queries' handlers on a counting db.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { get as getConversation, streamText as getStreamText } from "../../convex/aiChat";
import { person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

type AnyDb = Record<string | symbol, unknown> & { get: (...a: unknown[]) => Promise<unknown>; query: (t: string) => object };

/** A db that counts the documents a query reads (gets, and rows returned by take, collect, first, unique, paginate). */
function counting(db: AnyDb) {
  let reads = 0;
  const count = (x: unknown) => {
    reads += Array.isArray(x) ? x.length : x && typeof x === "object" && Array.isArray((x as { page?: unknown }).page) ? (x as { page: unknown[] }).page.length : x ? 1 : 0;
    return x;
  };
  const wrap = (q: object): object =>
    new Proxy(q, {
      get(target, prop) {
        const value = (target as Record<string | symbol, unknown>)[prop];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const r = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (r && typeof (r as Promise<unknown>).then === "function") return (r as Promise<unknown>).then(count);
          return r && typeof r === "object" ? wrap(r) : r;
        };
      },
    });
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "get") return async (...a: unknown[]) => count(await target.get(...a));
      if (prop === "query") return (table: string) => wrap(target.query(table));
      const value = target[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db: proxy, reads: () => reads };
}

type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;
const handlerOf = (fn: unknown) => (fn as { _handler: Handler })._handler;

/** Documents read by one run of a query, as `p`. */
async function readsOf(p: Person, fn: unknown, args: Record<string, unknown>): Promise<number> {
  return await p.as.run(async (ctx) => {
    const c = counting(ctx.db as unknown as AnyDb);
    await handlerOf(fn)({ ...ctx, db: c.db }, args);
    return c.reads();
  });
}

/** A conversation with `turns` finished exchanges, then a question whose answer is being written. */
async function busyConversation(t: T, p: Person, turns: number) {
  const conversationId = ulid();
  for (let i = 0; i < turns; i++) {
    const { messageId } = await p.as.mutation(internal.aiChat.post, { mode: "send", scope: p.scope, conversationId, text: `Question ${i}` });
    await t.mutation(internal.aiChat.finishMessage, { messageId, status: "done", text: `Answer ${i} with a few words in it.` });
  }
  const { messageId } = await p.as.mutation(internal.aiChat.post, { mode: "send", scope: p.scope, conversationId, text: "And one more?" });
  return { conversationId, messageId };
}

const messageRow = (t: T, id: Id<"aiMessages">) => t.run(async (ctx) => await ctx.db.get(id));

describe("streaming an answer", () => {
  test("chunks go to the stream row; the message (and so the conversation's query) changes only when the stream starts and when it settles", async () => {
    const t = setup();
    const a = await person(t, "stream-cost@example.com");
    const CHUNKS = 40;
    const { conversationId, messageId } = await busyConversation(t, a, 20);

    // The first chunk links the message to its stream (one change the conversation's query sees).
    expect(await t.mutation(internal.aiChat.writeMessage, { messageId, text: "A" })).toBe(true);
    const linked = (await messageRow(t, messageId))!;
    expect(linked.streamId).toBeTruthy();
    expect(linked.text).toBe("");
    let text = "A";
    for (let i = 1; i < CHUNKS; i++) {
      text += ` word${i}`;
      expect(await t.mutation(internal.aiChat.writeMessage, { messageId, text })).toBe(true);
    }
    // Every later chunk left the message row exactly as it was: the conversation's query isn't invalidated.
    expect(await messageRow(t, messageId)).toEqual(linked);
    expect(await a.as.query(api.aiChat.streamText, { messageId })).toEqual({ text });
    const live = (await a.as.query(api.aiChat.get, { conversationId }))!.messages.at(-1)!;
    expect(live).toMatchObject({ status: "streaming", live: true, text: "" });

    // What each re-run costs: the whole conversation (42 messages: 45 documents when measured), against the
    // stream query (4 when measured: who is asking, the message and its stream).
    const perGet = await readsOf(a, getConversation, { conversationId });
    const perStream = await readsOf(a, getStreamText, { messageId });
    expect(perGet).toBeGreaterThanOrEqual(42);
    expect(perStream).toBeLessThanOrEqual(5);
    // Before: every chunk re-ran `get` (40 x 45 = 1,800 reads for this answer). After: `get` runs twice (the
    // link, the settle) and the stream query once per chunk (2 x 45 + 40 x 4 = 250).
    const before = CHUNKS * perGet;
    const after = 2 * perGet + CHUNKS * perStream;
    expect(after).toBeLessThan(before / 5);

    // Settled: the text is on the message and the stream row is gone.
    await t.mutation(internal.aiChat.finishMessage, { messageId, status: "done", text });
    const done = (await messageRow(t, messageId))!;
    expect(done).toMatchObject({ status: "done", text });
    expect(done.streamId).toBeUndefined();
    expect(await t.run(async (ctx) => await ctx.db.get(linked.streamId!))).toBeNull();
    expect(await a.as.query(api.aiChat.streamText, { messageId })).toBeNull();
    expect((await a.as.query(api.aiChat.get, { conversationId }))!.messages.at(-1)).toMatchObject({ status: "done", live: false, text });
  });

  test("Stop shows what was written at once; an error keeps it; a crash keeps it too", async () => {
    const t = setup();
    const a = await person(t, "stream-stop@example.com");
    const stopped = await busyConversation(t, a, 0);
    await t.mutation(internal.aiChat.writeMessage, { messageId: stopped.messageId, text: "So far" });
    await a.as.mutation(api.aiChat.stop, { messageId: stopped.messageId });
    expect((await a.as.query(api.aiChat.get, { conversationId: stopped.conversationId }))!.messages.at(-1)).toMatchObject({ status: "stopped", text: "So far" });
    expect(await t.mutation(internal.aiChat.writeMessage, { messageId: stopped.messageId, text: "So far, more" })).toBe(false);

    const failed = await busyConversation(t, a, 0);
    await t.mutation(internal.aiChat.writeMessage, { messageId: failed.messageId, text: "Half an answer" });
    await t.mutation(internal.aiChat.finishMessage, { messageId: failed.messageId, status: "error", error: { code: "internal", message: "Something went wrong. Try again." } });
    expect((await a.as.query(api.aiChat.get, { conversationId: failed.conversationId }))!.messages.at(-1)).toMatchObject({ status: "error", text: "Half an answer" });

    const crashed = await busyConversation(t, a, 0);
    await t.mutation(internal.aiChat.writeMessage, { messageId: crashed.messageId, text: "Cut off here" });
    await t.run(async (ctx) => await ctx.db.patch(crashed.messageId, { updatedAt: Date.now() - 11 * 60_000 }));
    await t.mutation(internal.aiChat.sweep, {});
    const row = (await messageRow(t, crashed.messageId))!;
    expect(row).toMatchObject({ status: "error", text: "Cut off here" });
    expect(row.streamId).toBeUndefined();
    expect(await t.run(async (ctx) => (await ctx.db.query("aiStreams").collect()).length)).toBe(0);
  });

  test("someone else can't read an answer's stream", async () => {
    const t = setup();
    const a = await person(t, "stream-own@example.com");
    const b = await person(t, "stream-other@example.com");
    const { messageId } = await busyConversation(t, a, 0);
    await t.mutation(internal.aiChat.writeMessage, { messageId, text: "Private so far" });
    expect(await b.as.query(api.aiChat.streamText, { messageId })).toBeNull();
  });
});
