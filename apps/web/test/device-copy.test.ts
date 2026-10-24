// The device copy (lib/sync/deviceCopy.ts, docs/NATIVE_APP_PLAN.md §11): fills every note of a scope into the
// account's IndexedDB from a fake server with the same semantics as convex/sync.ts (manifest, pullDocs,
// pullAll): cursor and batches, resuming after an interruption, keeping fresh, pruning, sealed notes never kept.
import { describe, expect, test } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import { scopeIdKey, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { DeviceCopy, mergeBlocks, COPY_FUNCTIONS, RELIST_AFTER_MS } from "@/lib/sync/deviceCopy";
import { localDb } from "@/lib/sync/db";

const PERSONAL: WireScope = { kind: "personal" };
const TEAM: WireScope = { kind: "workspace", workspaceId: "ws_team_1" };

type Row = { block: WireBlock; seq: number; deleted: boolean };
type Note = { id: string; scope: string; title: string; seq: number; sealed: boolean; trashed: boolean; blocks: Map<string, Row> };

const block = (id: string, text: string, revision = 1, rank = "V"): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: 1, text: [{ type: "text", text }], props: {}, revision });
const textOf = (b: WireBlock) => (b.text[0] as { text: string }).text;

/** A server with scopes, notes and blocks, each change taking the scope's next seq (as convex/lib/seq.ts). */
class FakeServer {
  notes = new Map<string, Note>();
  heads = new Map<string, number>();
  tombstones: { scope: string; id: string; seq: number }[] = [];
  calls: { name: string; args: Record<string, unknown> }[] = [];
  failNext = 0;
  private n = 0;

  next(scope: string) {
    const s = (this.heads.get(scope) ?? 0) + 1;
    this.heads.set(scope, s);
    return s;
  }
  create(scope: WireScope, title: string, lines: string[] = [], opts: { sealed?: boolean } = {}) {
    const key = scopeIdKey(scope);
    const id = `NOTE${String(++this.n).padStart(22, "0")}`;
    const note: Note = { id, scope: key, title, seq: this.next(key), sealed: opts.sealed ?? false, trashed: false, blocks: new Map() };
    this.notes.set(id, note);
    lines.forEach((t, i) => this.write(id, `${id}-b${i}`, t));
    return id;
  }
  write(id: string, blockId: string, text: string) {
    const note = this.notes.get(id)!;
    const prev = note.blocks.get(blockId);
    note.blocks.set(blockId, { block: block(blockId, text, (prev?.block.revision ?? 0) + 1, prev?.block.rank ?? `V${note.blocks.size}`), seq: this.next(note.scope), deleted: false });
  }
  deleteBlock(id: string, blockId: string) {
    const note = this.notes.get(id)!;
    const prev = note.blocks.get(blockId)!;
    note.blocks.set(blockId, { block: { ...prev.block, revision: (prev.block.revision ?? 0) + 1 }, seq: this.next(note.scope), deleted: true });
  }
  rename(id: string, title: string) {
    const note = this.notes.get(id)!;
    note.title = title;
    note.seq = this.next(note.scope);
  }
  purge(id: string) {
    const note = this.notes.get(id)!;
    this.notes.delete(id);
    this.tombstones.push({ scope: note.scope, id, seq: this.next(note.scope) });
  }
  summary(n: Note) {
    return { id: n.id, title: n.title, icon: null, kind: "document", updatedAt: n.seq, excerpt: "", parentDocumentId: null, deletedAt: n.trashed ? 1 : null, archivedAt: null };
  }
  headOf(n: Note) {
    return Math.max(0, ...[...n.blocks.values()].map((r) => r.seq));
  }
  inScope(scope: WireScope) {
    return [...this.notes.values()].filter((n) => n.scope === scopeIdKey(scope));
  }
  client = {
    query: async (ref: FunctionReference<"query">, args: Record<string, unknown>): Promise<unknown> => {
      const name = getFunctionName(ref);
      this.calls.push({ name, args });
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error("network down");
      }
      if (name === COPY_FUNCTIONS.manifest) {
        const scope = args.scope as WireScope;
        const rows = this.inScope(scope)
          .filter((n) => n.seq > (args.after as number))
          .sort((a, b) => a.seq - b.seq);
        const page = rows.slice(0, args.limit as number);
        const more = rows.length > page.length;
        return { notes: page.map((n) => (n.sealed ? { id: n.id, head: 0, sealed: true, summary: null } : { id: n.id, head: this.headOf(n), sealed: false, summary: this.summary(n) })), next: more ? page[page.length - 1]!.seq : null, head: this.heads.get(scopeIdKey(scope)) ?? 0 };
      }
      if (name === COPY_FUNCTIONS.pullDocs) {
        return {
          notes: (args.ids as string[]).map((id) => {
            const n = this.notes.get(id);
            if (!n) return { id, status: "missing" };
            if (n.sealed) return { id, status: "sealed" };
            return { id, status: "ok", summary: this.summary(n), head: this.headOf(n), blocks: [...n.blocks.values()].filter((r) => !r.deleted).map((r) => r.block) };
          }),
        };
      }
      if (name === COPY_FUNCTIONS.pullAll) {
        const scope = args.scope as WireScope;
        const key = scopeIdKey(scope);
        const cursor = args.cursor as number;
        const notes = this.inScope(scope);
        return {
          documents: notes.filter((n) => n.seq > cursor).map((n) => (n.sealed ? { id: n.id, sealed: true, summary: null } : { id: n.id, sealed: false, summary: this.summary(n) })),
          blocks: notes.filter((n) => !n.sealed).flatMap((n) => [...n.blocks.values()].filter((r) => r.seq > cursor).map((r) => ({ documentId: n.id, block: r.block, deleted: r.deleted, seq: r.seq }))),
          folders: [],
          tags: [],
          removed: this.tombstones.filter((t) => t.scope === key && t.seq > cursor).map((t) => ({ kind: "document", id: t.id })),
          nextCursor: this.heads.get(key) ?? 0,
          hasMore: false,
        };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}

let accounts = 0;
function setup(opts: { isPlain?: (s: WireScope) => boolean; hasLocalWork?: (id: string) => boolean; now?: () => number } = {}) {
  const server = new FakeServer();
  const accountKey = `copy-acct-${++accounts}`;
  const copy = new DeviceCopy({ client: server.client, accountKey, idle: async () => undefined, ...opts });
  return { server, accountKey, copy };
}

async function kept(accountKey: string, id: string) {
  return (await localDb(accountKey)).get("blocks", id);
}
async function rows(accountKey: string, scope: WireScope) {
  return (await localDb(accountKey)).getAllFromIndex("documents", "by_scope", scopeIdKey(scope));
}

describe("the device copy", () => {
  test("lists a scope a page at a time, then fills every note whole in batches", async () => {
    const { server, accountKey, copy } = setup();
    const ids = Array.from({ length: 45 }, (_, i) => server.create(PERSONAL, `Note ${i}`, [`line one of ${i}`, `line two of ${i}`]));
    copy.setScopes([PERSONAL], PERSONAL);
    await copy.runUntilIdle();
    expect((await rows(accountKey, PERSONAL)).length).toBe(45);
    for (const id of ids) expect((await kept(accountKey, id))?.blocks.map(textOf)).toEqual([`line one of ${ids.indexOf(id)}`, `line two of ${ids.indexOf(id)}`]);
    const pulls = server.calls.filter((c) => c.name === COPY_FUNCTIONS.pullDocs);
    expect(pulls.length).toBe(3);
    expect(Math.max(...pulls.map((c) => (c.args.ids as string[]).length))).toBeLessThanOrEqual(20);
    expect(copy.status()[0]).toMatchObject({ phase: "live", have: 45, total: 45 });
    // Nothing more to do: no extra calls.
    const before = server.calls.length;
    await copy.runUntilIdle();
    expect(server.calls.length).toBe(before);
  });

  test("resumes where it was after an interruption (a reload, the network going away)", async () => {
    const { server, accountKey, copy } = setup();
    for (let i = 0; i < 30; i++) server.create(PERSONAL, `Note ${i}`, [`text ${i}`]);
    copy.setScopes([PERSONAL], PERSONAL);
    // Listing and one batch, then the tab goes away.
    await copy.step();
    await copy.step();
    const filledBefore = server.calls.filter((c) => c.name === COPY_FUNCTIONS.pullDocs).flatMap((c) => c.args.ids as string[]);
    expect(filledBefore.length).toBe(20);
    const again = new DeviceCopy({ client: server.client, accountKey, idle: async () => undefined });
    again.setScopes([PERSONAL], PERSONAL);
    server.calls = [];
    server.failNext = 1;
    await expect(again.step()).rejects.toThrow(/network down/);
    await again.runUntilIdle();
    // No second listing; only the ten left are asked for.
    expect(server.calls.filter((c) => c.name === COPY_FUNCTIONS.manifest)).toHaveLength(0);
    const asked = server.calls.filter((c) => c.name === COPY_FUNCTIONS.pullDocs).flatMap((c) => c.args.ids as string[]);
    expect(asked.length).toBe(10);
    for (const id of asked) expect(filledBefore).not.toContain(id);
    expect(again.status()[0]).toMatchObject({ have: 30, total: 30 });
  });

  test("keeps fresh from the cursor: edits, new notes, renames, deleted blocks and notes deleted for good", async () => {
    const { server, accountKey, copy } = setup();
    const a = server.create(PERSONAL, "A", ["first", "second"]);
    const b = server.create(PERSONAL, "B", ["bee"]);
    copy.setScopes([PERSONAL], PERSONAL);
    await copy.runUntilIdle();

    server.write(a, `${a}-b0`, "first, edited elsewhere");
    server.deleteBlock(a, `${a}-b1`);
    server.rename(b, "B renamed");
    const c = server.create(PERSONAL, "C", ["made on the phone"]);
    copy.nudge(PERSONAL);
    await copy.runUntilIdle();
    expect((await kept(accountKey, a))!.blocks.map(textOf)).toEqual(["first, edited elsewhere"]);
    expect((await (await localDb(accountKey)).get("documents", b))?.title).toBe("B renamed");
    expect((await kept(accountKey, c))!.blocks.map(textOf)).toEqual(["made on the phone"]);
    // Only what changed came: pullAll, plus pullDocs for the new note alone.
    expect(server.calls.filter((x) => x.name === COPY_FUNCTIONS.pullDocs).at(-1)!.args.ids).toEqual([c]);

    server.purge(b);
    copy.nudge(PERSONAL);
    await copy.runUntilIdle();
    expect(await kept(accountKey, b)).toBeUndefined();
    expect((await rows(accountKey, PERSONAL)).map((r) => r.id).sort()).toEqual([a, c].sort());
  });

  test("a note with changes still on this device is never dropped", async () => {
    const pending = new Set<string>();
    const { server, accountKey, copy } = setup({ hasLocalWork: (id) => pending.has(id) });
    const a = server.create(PERSONAL, "A", ["mine"]);
    copy.setScopes([PERSONAL], PERSONAL);
    await copy.runUntilIdle();
    pending.add(a);
    server.purge(a);
    copy.nudge(PERSONAL);
    await copy.runUntilIdle();
    expect(await kept(accountKey, a)).toBeDefined();
  });

  test("a weekly listing drops notes it no longer sees (access taken away, purged before tombstones)", async () => {
    let now = 1_000_000;
    const { server, accountKey, copy } = setup({ now: () => now });
    const a = server.create(PERSONAL, "Stays", ["x"]);
    const b = server.create(PERSONAL, "Goes quietly", ["y"]);
    copy.setScopes([PERSONAL], PERSONAL);
    await copy.runUntilIdle();
    // Gone without a tombstone (as access lost, or a purge from before tombstones).
    server.notes.delete(b);
    now += RELIST_AFTER_MS + 1;
    await copy.runUntilIdle();
    expect(await kept(accountKey, b)).toBeUndefined();
    expect(await kept(accountKey, a)).toBeDefined();
    expect((await rows(accountKey, PERSONAL)).map((r) => r.id)).toEqual([a]);
  });

  test("sealed or locked notes are never kept, and a note locked later loses its readable copy", async () => {
    const { server, accountKey, copy } = setup();
    const secret = server.create(PERSONAL, "", ["ciphertext"], { sealed: true });
    const plain = server.create(PERSONAL, "Plain", ["readable"]);
    copy.setScopes([PERSONAL], PERSONAL);
    await copy.runUntilIdle();
    expect(await kept(accountKey, secret)).toBeUndefined();
    expect(await (await localDb(accountKey)).get("documents", secret)).toBeUndefined();
    expect(await kept(accountKey, plain)).toBeDefined();
    // Locked elsewhere: its row comes back sealed and the plaintext goes.
    server.notes.get(plain)!.sealed = true;
    server.rename(plain, "");
    copy.nudge(PERSONAL);
    await copy.runUntilIdle();
    expect(await kept(accountKey, plain)).toBeUndefined();
    const db = await localDb(accountKey);
    const everything = JSON.stringify([await db.getAll("blocks"), await db.getAll("documents")]);
    expect(everything).not.toContain("readable");
    expect(everything).not.toContain("ciphertext");
  });

  test("a space with end-to-end encryption is left to its replica", async () => {
    const { server, accountKey, copy } = setup({ isPlain: (s) => s.kind === "personal" });
    server.create(TEAM, "Team secret", ["encrypted space"]);
    const mine = server.create(PERSONAL, "Mine", ["plain"]);
    copy.setScopes([PERSONAL, TEAM], PERSONAL);
    await copy.runUntilIdle();
    expect(server.calls.some((c) => (c.args.scope as WireScope | undefined)?.kind === "workspace")).toBe(false);
    expect(await kept(accountKey, mine)).toBeDefined();
    expect(await rows(accountKey, TEAM)).toEqual([]);
  });

  test("scopes and accounts stay apart; the current scope fills first", async () => {
    const { server, accountKey, copy } = setup();
    const team = server.create(TEAM, "Team note", ["team"]);
    const mine = server.create(PERSONAL, "Mine", ["personal"]);
    copy.setScopes([PERSONAL, TEAM], TEAM);
    await copy.step();
    expect((server.calls[0]!.args.scope as WireScope).kind).toBe("workspace");
    await copy.runUntilIdle();
    expect((await rows(accountKey, TEAM)).map((r) => r.id)).toEqual([team]);
    expect((await rows(accountKey, PERSONAL)).map((r) => r.id)).toEqual([mine]);
    // Another account's database holds nothing of it.
    expect(await (await localDb(`${accountKey}-other`)).getAll("blocks")).toEqual([]);
  });

  test("notes asked for on intent come first, even with the copy turned off", async () => {
    const { server, accountKey, copy } = setup();
    const ids = Array.from({ length: 5 }, (_, i) => server.create(PERSONAL, `N${i}`, [`t${i}`]));
    copy.setEnabled(false);
    copy.setScopes([PERSONAL], PERSONAL);
    copy.start();
    await copy.prefetch([ids[3]!]);
    expect((await kept(accountKey, ids[3]!))!.blocks.map(textOf)).toEqual(["t3"]);
    expect(await kept(accountKey, ids[0]!)).toBeUndefined();
    expect(server.calls.some((c) => c.name === COPY_FUNCTIONS.manifest)).toBe(false);
    // Already whole: asking again costs nothing.
    const before = server.calls.length;
    await copy.prefetch([ids[3]!]);
    expect(server.calls.length).toBe(before);
    copy.stop();
  });

  test("clearing removes what the copy downloaded, never an open note's copy", async () => {
    const { server, accountKey, copy } = setup();
    const a = server.create(PERSONAL, "A", ["a"]);
    copy.setScopes([PERSONAL], PERSONAL);
    await copy.runUntilIdle();
    const db = await localDb(accountKey);
    await db.put("blocks", { documentId: "OPENED00000000000000000000", blocks: [block("x", "opened here")], cachedAt: 1, by: "view" });
    await copy.clear();
    expect(await kept(accountKey, a)).toBeUndefined();
    expect(await kept(accountKey, "OPENED00000000000000000000")).toBeDefined();
    expect(copy.status()[0]).toMatchObject({ phase: "listing" });
  });
});

describe("mergeBlocks", () => {
  test("never takes back a newer revision, removes deleted blocks, keeps rank order", () => {
    const kept = [block("a", "a v3", 3, "A"), block("b", "b v1", 1, "B")];
    const out = mergeBlocks(kept, [
      { block: block("a", "a v2 (stale)", 2, "A"), deleted: false },
      { block: block("b", "b v2", 2, "B"), deleted: true },
      { block: block("c", "c", 1, "0"), deleted: false },
    ]);
    expect(out.map(textOf)).toEqual(["c", "a v3"]);
  });
});
