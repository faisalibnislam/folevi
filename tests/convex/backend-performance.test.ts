// Hot rows, bounded background jobs and batch caches (the backend performance pass of 2026-10).
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { para, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
type Routing = Person["scope"];

const DAY = 24 * 60 * 60 * 1000;

async function push(p: Person, routing: Routing, ops: unknown[]) {
  return await p.as.mutation(api.sync.push, { scope: routing, deviceId: "device-perf-1", ops: ops as never });
}

async function newDoc(p: Person, routing: Routing = PERSONAL, title = "Doc") {
  const id = ulid();
  const [r] = await push(p, routing, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }]);
  expect(r!.status).toBe("applied");
  return id;
}

const upsertOp = (documentId: string, block: ReturnType<typeof para>, baseRevision: number | null = null) => ({
  opId: ulid(),
  kind: "block.upsert",
  documentId,
  block,
  baseRevision,
  fields: ["content", "position"],
});

async function counter(t: T, key: string) {
  return await t.run(async (ctx) => await ctx.db.query("scopeCounters").withIndex("by_key", (q) => q.eq("key", key)).unique());
}

/** Puts a scope back in the state it had before counters moved: no counter row, the counter on the old field. */
async function legacyCounter(t: T, scope: { profileId: Id<"profiles"> } | { workspaceId: Id<"workspaces"> }, value: number) {
  await t.run(async (ctx) => {
    const key = "profileId" in scope ? `p:${scope.profileId}` : `w:${scope.workspaceId}`;
    const row = await ctx.db.query("scopeCounters").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.delete(row._id);
    if ("profileId" in scope) await ctx.db.patch(scope.profileId, { personalChangeSeq: value });
    else await ctx.db.patch(scope.workspaceId, { changeSeq: value });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("change counters live off the profile and workspace rows", () => {
  test("an existing Personal continues from its old counter, keeps counting, and the profile is never written", async () => {
    const t = setup();
    const a = await person(t, "seq-a@example.com");
    const profileId = a.profileId as Id<"profiles">;
    const docId = await newDoc(a);
    await legacyCounter(t, { profileId }, 1000);
    expect((await a.as.query(api.sync.head, { scope: PERSONAL })).seq).toBe(1000);
    const before = await t.run(async (ctx) => (await ctx.db.get(profileId))!);

    const [first] = await push(a, PERSONAL, [upsertOp(docId, para(ulid(), "one"))]);
    expect(first!.status).toBe("applied");
    expect((await counter(t, `p:${profileId}`))!.seq).toBe(1001);
    expect((await a.as.query(api.sync.head, { scope: PERSONAL })).seq).toBe(1001);

    const second = para(ulid(), "two");
    await push(a, PERSONAL, [upsertOp(docId, second)]);
    expect((await a.as.query(api.sync.head, { scope: PERSONAL })).seq).toBe(1002);

    // Pull sees the new seqs, and a client caught up at 1001 gets only the second block (and its page).
    const pulled = await a.as.query(api.sync.pull, { scope: PERSONAL, cursor: 1001 });
    expect(pulled.head).toBe(1002);
    expect(pulled.nextCursor).toBe(1002);
    expect(pulled.blocks.map((b) => b.block.id)).toEqual([second.id]);

    // The pushes left the profile row untouched (requireProfile reads it in nearly every query).
    const after = await t.run(async (ctx) => (await ctx.db.get(profileId))!);
    expect(after).toEqual(before);
    expect(after.personalChangeSeq).toBe(1000);
  });

  test("a workspace continues from its old counter and its row isn't written by edits", async () => {
    const t = setup();
    const owner = await person(t, "seq-ws@example.com");
    const { scope } = await teamWorkspace(owner);
    const docId = await newDoc(owner, scope);
    const wsId = await t.run(async (ctx) => (await ctx.db.query("workspaces").first())!._id);
    await legacyCounter(t, { workspaceId: wsId }, 500);
    expect((await owner.as.query(api.sync.head, { scope })).seq).toBe(500);
    const before = await t.run(async (ctx) => (await ctx.db.get(wsId))!);

    await push(owner, scope, [upsertOp(docId, para(ulid(), "a")), upsertOp(docId, para(ulid(), "b", "W"))]);
    // One seq per scope per batch.
    expect((await owner.as.query(api.sync.head, { scope })).seq).toBe(501);
    await push(owner, scope, [upsertOp(docId, para(ulid(), "c", "X"))]);
    expect((await owner.as.query(api.sync.head, { scope })).seq).toBe(502);
    const pulled = await owner.as.query(api.sync.pull, { scope, cursor: 500 });
    expect(pulled.blocks).toHaveLength(3);
    expect(pulled.head).toBe(502);

    expect(await t.run(async (ctx) => (await ctx.db.get(wsId))!)).toEqual(before);
  });

  test("seqs stay strictly increasing across pushes, page operations and permanent deletion", async () => {
    const t = setup();
    const a = await person(t, "seq-mono@example.com");
    const docId = await newDoc(a);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      await push(a, PERSONAL, [upsertOp(docId, para(ulid(), `line ${i}`, `V${String.fromCharCode(97 + i)}`))]);
      seen.push((await a.as.query(api.sync.head, { scope: PERSONAL })).seq);
    }
    await a.as.mutation(api.documents.create, { scope: PERSONAL, title: "Another" });
    seen.push((await a.as.query(api.sync.head, { scope: PERSONAL })).seq);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]!);
    // Every row's seq is at or below the head.
    const head = seen[seen.length - 1]!;
    const maxRowSeq = await t.run(async (ctx) => Math.max(...(await ctx.db.query("blocks").collect()).map((b) => b.seq), ...(await ctx.db.query("documents").collect()).map((d) => d.seq)));
    expect(maxRowSeq).toBeLessThanOrEqual(head);
  });
});

describe("to-do projections", () => {
  test("re-projecting a done to-do keeps when it was done, and an unchanged task isn't rewritten", async () => {
    const t = setup();
    const a = await person(t, "tasks-perf@example.com");
    const docId = await newDoc(a);
    const todo = { ...para(ulid(), "Water plants"), type: "todo", props: { checked: true } };
    const [made] = await push(a, PERSONAL, [upsertOp(docId, todo as never)]);
    const taskOf = () => t.run(async (ctx) => (await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", todo.id)).unique())!);
    const first = await taskOf();
    expect(first.status).toBe("done");
    expect(first.completedAt).toBeDefined();

    await new Promise((r) => setTimeout(r, 5));
    // A text edit: the title changes, the completion time doesn't.
    const [edited] = await push(a, PERSONAL, [upsertOp(docId, { ...todo, text: [{ type: "text", text: "Water the plants" }] } as never, made!.revision!)]);
    const second = await taskOf();
    expect(second.title).toBe("Water the plants");
    expect(second.completedAt).toBe(first.completedAt);

    await new Promise((r) => setTimeout(r, 5));
    // A move only: nothing the task shows changed, so the row isn't written at all.
    await push(a, PERSONAL, [upsertOp(docId, { ...todo, rank: "W", text: [{ type: "text", text: "Water the plants" }] } as never, edited!.revision!)]);
    const third = await taskOf();
    expect(third.updatedAt).toBe(second.updatedAt);
    expect(third.completedAt).toBe(first.completedAt);
  });
});

describe("reminders", () => {
  test("a reminder moved to a new time goes out again, one left alone doesn't", async () => {
    const t = setup();
    const a = await person(t, "reminder-moved@example.com");
    const docId = await newDoc(a);
    const first = Date.now() + 60_000;
    const todo = { ...para(ulid(), "Call the plumber"), type: "todo", props: { checked: false, reminderAt: first } };
    const [made] = await push(a, PERSONAL, [upsertOp(docId, todo as never)]);
    const taskOf = () => t.run(async (ctx) => (await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", todo.id)).unique())!);
    // The reminder went out.
    const taskId = (await taskOf())._id;
    await t.run(async (ctx) => ctx.db.patch(taskId, { reminderSentAt: Date.now() }));
    // A text edit keeps it sent.
    const [edited] = await push(a, PERSONAL, [upsertOp(docId, { ...todo, text: [{ type: "text", text: "Call the plumber today" }] } as never, made!.revision!)]);
    expect((await taskOf()).reminderSentAt).toBeDefined();
    // A new time makes it due again.
    await push(a, PERSONAL, [upsertOp(docId, { ...todo, text: [{ type: "text", text: "Call the plumber today" }], props: { checked: false, reminderAt: first + 3_600_000 } } as never, edited!.revision!)]);
    const moved = await taskOf();
    expect(moved.reminderAt).toBe(first + 3_600_000);
    expect(moved.reminderSentAt).toBeUndefined();
  });
});

describe("deleting and restoring nested blocks in one batch", () => {
  async function page(a: Person) {
    const docId = await newDoc(a);
    const A = para(ulid(), "A", "V");
    const A1 = para(ulid(), "A1", "V", A.id);
    const A11 = para(ulid(), "A11", "V", A1.id);
    const B = para(ulid(), "B", "W");
    await push(a, PERSONAL, [upsertOp(docId, A), upsertOp(docId, A1), upsertOp(docId, A11), upsertOp(docId, B)]);
    return { docId, A, A1, A11, B };
  }
  const deletedIds = async (t: T) => new Set(await t.run(async (ctx) => (await ctx.db.query("blocks").collect()).filter((b) => b.deletedAt !== undefined).map((b) => b.blockId)));

  test("blocks added or moved earlier in the batch are deleted (or spared) with their new parent", async () => {
    const t = setup();
    const a = await person(t, "subtree@example.com");
    const { docId, A, A1, A11, B } = await page(a);
    const late = para(ulid(), "late child", "X", A1.id);
    const results = await push(a, PERSONAL, [
      // A new block under A1, then B moved under A, then A11 moved out to the top level.
      upsertOp(docId, late),
      upsertOp(docId, { ...B, parentId: A.id }, 1),
      upsertOp(docId, { ...A11, parentId: null, rank: "Y" }, 1),
      // Deleting A takes A1, the late child and B with it; A11 left before the delete and stays.
      { opId: ulid(), kind: "block.delete", documentId: docId, blockId: A.id, baseRevision: null },
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied", "applied"]);
    const gone = await deletedIds(t);
    expect(gone).toEqual(new Set([A.id, A1.id, late.id, B.id]));

    // Restoring A in a later batch brings back exactly what went with it.
    const [restored] = await push(a, PERSONAL, [{ opId: ulid(), kind: "block.restore", documentId: docId, blockId: A.id }]);
    expect(restored!.status).toBe("applied");
    expect((await deletedIds(t)).size).toBe(0);
  });

  test("a hundred deletes of one page in one batch remove every block and its children", async () => {
    const t = setup();
    const a = await person(t, "subtree-bulk@example.com");
    const docId = await newDoc(a);
    const parents = Array.from({ length: 50 }, (_, i) => para(ulid(), `p${i}`, `V${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`));
    const kids = parents.map((p, i) => para(ulid(), `k${i}`, "V", p.id));
    const made = [...(await push(a, PERSONAL, parents.map((b) => upsertOp(docId, b)))), ...(await push(a, PERSONAL, kids.map((b) => upsertOp(docId, b))))];
    expect(made.every((r) => r.status === "applied")).toBe(true);
    const results = await push(a, PERSONAL, [...parents, ...kids].map((b) => ({ opId: ulid(), kind: "block.delete", documentId: docId, blockId: b.id, baseRevision: null })));
    expect(results.every((r) => r.status === "applied" && r.deleted)).toBe(true);
    expect((await deletedIds(t)).size).toBe(100);
    expect((await a.as.query(api.blocks.list, { documentId: docId }))!.blocks).toEqual([]);
  });
});

describe("background jobs read through indexes in bounded batches", () => {
  async function cloneDocs(t: T, count: number, fields: Partial<Doc<"documents">>) {
    return await t.run(async (ctx) => {
      const base = (await ctx.db.query("documents").first())!;
      const { _id, _creationTime, ...rest } = base;
      void _id;
      void _creationTime;
      const ids: Id<"documents">[] = [];
      for (let i = 0; i < count; i++) ids.push(await ctx.db.insert("documents", { ...rest, publicId: ulid(), parentDocumentId: undefined, ...fields }));
      return ids;
    });
  }

  test("trash retention gets past pages it has to skip", async () => {
    vi.useFakeTimers();
    const t = setup();
    await person(t, "trash-perf@example.com");
    const old = Date.now() - 40 * DAY;
    // The oldest hundred already have a deletion queued; the one after them must still be found.
    const queued = await cloneDocs(t, 100, { inTrash: true, deletedAt: old });
    const [last] = await cloneDocs(t, 1, { inTrash: true, deletedAt: old + 1000 });
    const recent = await cloneDocs(t, 1, { inTrash: true, deletedAt: Date.now() - DAY });
    await t.run(async (ctx) => {
      const profileId = (await ctx.db.query("profiles").first())!._id;
      for (const id of queued) {
        await ctx.db.insert("deletionJobs", { kind: "document", targetId: id, requestedBy: profileId, requestedByAdmin: false, reason: "trash_retention", scheduledFor: Date.now() + 365 * DAY, status: "scheduled", progress: 0, createdAt: Date.now() });
      }
    });
    await t.mutation(internal.maintenance.purgeExpiredTrash, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const jobs = await t.run(async (ctx) => await ctx.db.query("deletionJobs").collect());
    expect(jobs.some((j) => j.targetId === last)).toBe(true);
    expect(jobs.some((j) => j.targetId === recent[0])).toBe(false);
  });

  test("tombstone retention removes old tombstones only", async () => {
    const t = setup();
    const a = await person(t, "tomb-perf@example.com");
    const docId = await newDoc(a);
    const [x, y, z] = [para(ulid(), "x", "V"), para(ulid(), "y", "W"), para(ulid(), "z", "X")];
    await push(a, PERSONAL, [upsertOp(docId, x), upsertOp(docId, y), upsertOp(docId, z)]);
    await push(a, PERSONAL, [x, y].map((b) => ({ opId: ulid(), kind: "block.delete", documentId: docId, blockId: b.id, baseRevision: null })));
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", x.id)).unique())!;
      await ctx.db.patch(row._id, { deletedAt: Date.now() - 40 * DAY });
    });
    expect(await t.mutation(internal.maintenance.purgeTombstones, {})).toBe(1);
    const left = await t.run(async (ctx) => (await ctx.db.query("blocks").collect()).map((b) => b.blockId));
    expect(left).not.toContain(x.id);
    expect(left).toEqual(expect.arrayContaining([y.id, z.id]));
  });

  test("housekeeping and presence cleanup clear what has run out and keep the rest", async () => {
    const t = setup();
    const a = await person(t, "house-perf@example.com");
    const { workspaceId } = await teamWorkspace(a);
    await a.as.mutation(api.workspaces.invite, { workspaceId, email: "late@example.com", role: "editor" });
    await a.as.mutation(api.workspaces.invite, { workspaceId, email: "fresh@example.com", role: "editor" });
    const docId = await newDoc(a);
    await a.as.mutation(api.presence.heartbeat, { documentId: docId, sessionId: "session-perf-1" });
    await t.run(async (ctx) => {
      const late = (await ctx.db.query("workspaceInvites").withIndex("by_email", (q) => q.eq("email", "late@example.com")).unique())!;
      await ctx.db.patch(late._id, { expiresAt: Date.now() - 1000 });
      await ctx.db.insert("rateLimits", { bucket: "old", windowStart: Date.now() - 2 * DAY, count: 1 });
      await ctx.db.insert("rateLimits", { bucket: "new", windowStart: Date.now(), count: 1 });
      for (const p of await ctx.db.query("presence").collect()) await ctx.db.patch(p._id, { updatedAt: Date.now() - 20 * 60_000 });
    });
    await t.mutation(internal.maintenance.housekeeping, {});
    await t.mutation(internal.presence.cleanup, {});
    await t.run(async (ctx) => {
      const invites = await ctx.db.query("workspaceInvites").collect();
      expect(invites.find((i) => i.email === "late@example.com")!.status).toBe("expired");
      expect(invites.find((i) => i.email === "fresh@example.com")!.status).toBe("pending");
      expect((await ctx.db.query("rateLimits").collect()).map((r) => r.bucket)).not.toContain("old");
      expect((await ctx.db.query("rateLimits").collect()).map((r) => r.bucket)).toContain("new");
      expect(await ctx.db.query("presence").collect()).toEqual([]);
    });
  });

  test("ending expired plans isn't held up by thousands of Polar plans", async () => {
    const t = setup();
    const a = await person(t, "settle-perf@example.com");
    const profileId = a.profileId as Id<"profiles">;
    const ended = Date.now() - DAY;
    await t.run(async (ctx) => {
      const others = (await ctx.db.query("subscriptions").collect()).filter((s) => s.profileId === profileId);
      for (const s of others) await ctx.db.delete(s._id);
      const base = { ownerType: "user" as const, plan: "pro" as const, interval: "month" as const, status: "active" as const, currentPeriodEnd: ended, createdAt: Date.now(), updatedAt: Date.now() };
      // Rows the old job read first and skipped (Polar ends those itself).
      for (let i = 0; i < 2001; i++) await ctx.db.insert("subscriptions", { ...base, provider: "polar", profileId });
      await ctx.db.insert("subscriptions", { ...base, provider: "manual", profileId });
    });
    const { changed } = await t.mutation(internal.billing.settleExpiredPlans, {});
    expect(changed).toBe(1);
    const manual = await t.run(async (ctx) => (await ctx.db.query("subscriptions").collect()).find((s) => s.provider === "manual")!);
    expect(manual.plan).toBe("free");
  });
});

describe("ending expired workspace plans", () => {
  test("plans already ended don't stall the job or keep it rescheduling", async () => {
    const t = setup();
    const a = await person(t, "settle-ws@example.com");
    const { workspaceId } = await teamWorkspace(a);
    const ended = Date.now() - DAY;
    const wsId = await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!._id);
    await t.run(async (ctx) => {
      const base = { ownerType: "workspace" as const, workspaceId: wsId, currentPeriodEnd: ended, createdAt: Date.now(), updatedAt: Date.now() };
      // 250 plans this job ended on earlier runs: Workspace Free, canceled, their period long over.
      for (let i = 0; i < 250; i++) await ctx.db.insert("subscriptions", { ...base, planId: "workspace_free", status: "canceled", provider: "test" });
      // One paid plan due now.
      await ctx.db.insert("subscriptions", { ...base, planId: "workspace_core_monthly", interval: "month", status: "active", provider: "manual" });
    });
    const scheduledBefore = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length);
    const { changed } = await t.mutation(internal.billing.settleExpiredPlans, {});
    expect(changed).toBe(1);
    // Nothing left to do, so it doesn't schedule itself again.
    const scheduledAfter = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length);
    expect(scheduledAfter).toBe(scheduledBefore);
  });
});

describe("notifications", () => {
  test("a page invitation's expiry is judged by the client's clock, not the query's", async () => {
    const t = setup();
    const owner = await person(t, "inv-owner@example.com");
    const { id: page } = await owner.as.mutation(api.documents.create, { scope: PERSONAL, title: "Garden" });
    await owner.as.mutation(api.sharing.grant, { documentId: page, email: "inv-friend@example.com", role: "viewer" });
    const friend = await person(t, "inv-friend@example.com");
    const item = (await friend.as.query(api.notifications.list, {})).find((n) => n.pageInviteId)!;
    expect(item.pageInviteExpiresAt).toBeGreaterThan(Date.now());
    const later = item.pageInviteExpiresAt! + 1;
    const atLater = (await friend.as.query(api.notifications.list, { now: later })).find((n) => n.id === item.id)!;
    expect(atLater.pageInviteId).toBeNull();
    expect(atLater.pageInviteExpiresAt).toBeNull();
  });
});
