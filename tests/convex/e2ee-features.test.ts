// End-to-end encryption, WP5's server modules (docs/E2EE_DESIGN.md §7, §9.3): readable copies a switch asks
// for (e2ee.mirrors), what arrives for an encrypted space (e2ee.inbox), reminders for sealed to-dos
// (e2ee.reminders) and plain copies published on purpose (e2ee.links), then WP5's flows under a marker scan
// of every table (`noPlaintextCases`, which WP3's e2ee-no-plaintext suite also runs).
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SCHEMA_VERSION } from "@folevi/editor-schema";
import { join, person, setup, teamWorkspace, ulid, type T } from "./helpers";
import { docId, encryptScope, everyRow, mirror, note, openInboxItem, sealDoc, setSwitches, stopGemini } from "./e2ee-ai-helpers";
import { noPlaintextCases } from "./e2ee-ai-cases";

export { noPlaintextCases, type NoPlaintextCase } from "./e2ee-ai-cases";

afterEach(() => {
  stopGemini();
  vi.useRealTimers();
});

async function sealedPersonal(t: T, email: string, opts: Parameters<typeof encryptScope>[2] = {}) {
  const a = await person(t, email);
  const id = await note(a, "A note", ["Some text"]);
  await sealDoc(t, id);
  const space = await encryptScope(t, a, opts);
  return { a, id, ...space, scope: { kind: "personal" as const, profileId: a.profileId as Id<"profiles"> } };
}

describe("e2ee.mirrors", () => {
  test("put needs the switch, a sealed unlocked note and write access; hashes list what's stored", async () => {
    const t = setup();
    const { a, id, scopeKey } = await sealedPersonal(t, "m-put@example.com");
    const b = await person(t, "m-put-b@example.com");
    const copy = { scope: a.scope, purpose: "search" as const, documentId: id, title: "T", text: "text", contentHash: "h1" };
    await expect(a.as.mutation(api.e2ee.mirrors.put, copy)).rejects.toThrow(/turned off for this space/);
    await setSwitches(t, scopeKey, { searchEverywhere: true, apps: true });
    expect(await a.as.mutation(api.e2ee.mirrors.put, copy)).toEqual({ changed: true });
    expect(await a.as.mutation(api.e2ee.mirrors.put, copy)).toEqual({ changed: false });
    await expect(b.as.mutation(api.e2ee.mirrors.put, { ...copy, scope: b.scope })).rejects.toThrow(/not found/i);
    // Only the purpose's own fields are kept (search copies have no tasks).
    await a.as.mutation(api.e2ee.mirrors.put, { ...copy, contentHash: "h2", tasks: [{ blockId: "x", text: "t", done: false }] });
    const rows = await t.run(async (ctx) => await ctx.db.query("e2eeMirrors").collect());
    expect(rows.length).toBe(1);
    expect(rows[0]!.tasks).toBeUndefined();
    const page = await a.as.query(api.e2ee.mirrors.hashes, { scope: a.scope, purpose: "search" });
    expect(page).toEqual({ items: [{ documentId: id, contentHash: "h2" }], cursor: null });
    // A plain note needs no copy; a locked one never has one.
    const plain = await t.run(async (ctx) => (await ctx.db.query("documents").collect()).find((d) => d.sealedAt === undefined && d.kind === "document")!.publicId);
    await expect(a.as.mutation(api.e2ee.mirrors.put, { ...copy, documentId: plain })).rejects.toThrow(/isn't encrypted/);
    const row = await docId(t, id);
    await t.run(async (ctx) => ctx.db.patch(row, { locked: true }));
    await expect(a.as.mutation(api.e2ee.mirrors.put, { ...copy, contentHash: "h3" })).rejects.toThrow(/always fully encrypted/);
  });

  test("remove and purge delete copies, and for Foli AI what was built from them", async () => {
    const t = setup();
    const { a, id, scopeKey, scope } = await sealedPersonal(t, "m-purge@example.com", { switches: { backgroundAi: true, apps: true } });
    const doc = await docId(t, id);
    await mirror(t, id, "ai", { title: "T", text: "x" });
    await mirror(t, id, "apps", { title: "T", text: "x" });
    await t.run(async (ctx) => {
      await ctx.db.insert("aiChunks", { ownerProfileId: a.profileId as Id<"profiles">, documentId: doc, chunkIndex: 0, text: "chunk", blockIds: [], contentHash: "c", embedding: new Array(768).fill(0), embeddingModel: "m", indexedAt: 1 } as never);
    });
    // Purge refuses to run while the switch is still on (turned on again meanwhile).
    expect(await t.mutation(internal.e2ee.mirrors.purge, { scope, purpose: "ai" })).toEqual({ deleted: 0, done: true });
    await setSwitches(t, scopeKey, { backgroundAi: false });
    await t.mutation(internal.e2ee.mirrors.purge, { scope, purpose: "ai" });
    const left = await t.run(async (ctx) => ({ mirrors: await ctx.db.query("e2eeMirrors").collect(), chunks: await ctx.db.query("aiChunks").collect() }));
    expect(left.mirrors.map((m) => m.purpose)).toEqual(["apps"]);
    expect(left.chunks).toEqual([]);
    expect(await a.as.mutation(api.e2ee.mirrors.remove, { purpose: "apps", documentId: id })).toEqual({ removed: true });
  });
});

describe("e2ee.inbox", () => {
  test("waiting, open and markApplied for the person an item is for; others don't see it; expiry", async () => {
    const t = setup();
    const owner = await person(t, "i-owner@example.com");
    const member = await person(t, "i-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "i-member@example.com", workspaceId, "editor");
    const space = await encryptScope(t, owner, { workspaceId, switches: { apps: true } });
    const wsId = await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!._id);
    const { publicId } = await t.run(async (ctx) => {
      const { sealToInbox } = await import("../../convex/lib/e2ee/inboxSeal");
      return await sealToInbox(ctx, { kind: "workspace", workspaceId: wsId }, "app", { kind: "app", tool: "create_note", app: { name: "x", device: "d", reason: "mcp" }, args: { markdown: "hi" }, documentId: "doc1", profileId: owner.profileId, at: 1 }, { for: owner.profileId as Id<"profiles">, targetDocumentId: "doc1" });
    });
    expect((await owner.as.query(api.e2ee.inbox.waiting, { scope })).map((i) => i.id)).toEqual([publicId]);
    expect(await member.as.query(api.e2ee.inbox.waiting, { scope })).toEqual([]);
    await expect(member.as.query(api.e2ee.inbox.open, { inboxId: publicId })).rejects.toThrow(/isn't waiting/);
    const opened = await owner.as.query(api.e2ee.inbox.open, { inboxId: publicId });
    expect(opened.scopeId).toBe(space.scopeId);
    expect(await openInboxItem(t, space.inbox, space.scopeId, publicId)).toMatchObject({ tool: "create_note", documentId: "doc1" });
    await expect(owner.as.mutation(api.e2ee.inbox.markApplied, { inboxId: publicId, createdDocumentId: "other" })).rejects.toThrow(/isn't the note/);
    expect(await owner.as.mutation(api.e2ee.inbox.markApplied, { inboxId: publicId, createdDocumentId: "doc1" })).toEqual({ applied: true });
    const row = await t.run(async (ctx) => (await ctx.db.query("e2eeInbox").collect())[0]!);
    expect(row.status).toBe("applied");
    expect(row.size).toBe(0);
    expect(await owner.as.query(api.e2ee.inbox.waiting, { scope })).toEqual([]);
    await t.run(async (ctx) => ctx.db.patch(row._id, { expiresAt: Date.now() - 1 }));
    expect(await t.mutation(internal.e2ee.inbox.expire, {})).toBe(1);
  });

  test("an item can't be sealed for a space without a key", async () => {
    const t = setup();
    const a = await person(t, "i-nokey@example.com");
    await expect(
      t.run(async (ctx) => {
        const { sealToInbox } = await import("../../convex/lib/e2ee/inboxSeal");
        await sealToInbox(ctx, { kind: "personal", profileId: a.profileId as Id<"profiles"> }, "clip", { kind: "clip", title: "x", markdown: "y", documentId: "d" });
      }),
    ).rejects.toThrow(/isn't set up/);
  });
});

describe("e2ee.reminders", () => {
  test("put and process: generic text without previews, the device's preview with them", async () => {
    const t = setup();
    const { a, id, scopeKey } = await sealedPersonal(t, "r-put@example.com");
    const reminded = async () => (await t.run(async (ctx) => await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", a.profileId as Id<"profiles">)).collect())).filter((n) => n.sealedDocument);
    await a.as.mutation(api.e2ee.reminders.put, { documentId: id, blockId: "b1", profileId: a.profileId, remindAt: Date.now() - 1000, preview: { title: "Call Sam", note: "Plans" } });
    // Previews off: the preview isn't even stored.
    expect((await t.run(async (ctx) => (await ctx.db.query("e2eeReminders").collect())[0]!)).preview).toBeUndefined();
    expect((await t.mutation(internal.e2ee.reminders.process, {})).sent).toBe(1);
    expect((await reminded()).map((n) => n.title)).toEqual(["A reminder is due"]);
    // Sent once.
    expect((await t.mutation(internal.e2ee.reminders.process, {})).due).toBe(0);
    await setSwitches(t, scopeKey, { notificationPreviews: true });
    await a.as.mutation(api.e2ee.reminders.put, { documentId: id, blockId: "b1", profileId: a.profileId, remindAt: Date.now() - 500, preview: { title: "Call Sam", note: "Plans" } });
    await t.mutation(internal.e2ee.reminders.process, {});
    expect((await reminded()).map((n) => n.title)).toContain("Reminder: Call Sam");
    expect(await a.as.mutation(api.e2ee.reminders.remove, { documentId: id, blockId: "b1" })).toEqual({ removed: 1 });
  });

  test("only someone who can read the note may be reminded; only sealed notes use these rows", async () => {
    const t = setup();
    const { a, id } = await sealedPersonal(t, "r-who@example.com");
    const b = await person(t, "r-who-b@example.com");
    await expect(a.as.mutation(api.e2ee.reminders.put, { documentId: id, blockId: "b1", profileId: b.profileId, remindAt: Date.now() + 60_000 })).rejects.toThrow(/can't be reminded/);
    await expect(b.as.mutation(api.e2ee.reminders.put, { documentId: id, blockId: "b1", profileId: b.profileId, remindAt: Date.now() + 60_000 })).rejects.toThrow(/can't change/);
  });
});

describe("e2ee.links", () => {
  test("publishCopy stores a plain copy (a plainCopy link), publishing again replaces it, unpublish removes it", async () => {
    const t = setup();
    const { a, id } = await sealedPersonal(t, "l-pub@example.com");
    const block = { id: ulid(), type: "paragraph", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Published words" }], props: {} };
    const first = await a.as.mutation(api.e2ee.links.publishCopy, { documentId: id, copy: { title: "Public", blocks: [block] } });
    expect(first.token).toBeTruthy();
    const link = await t.run(async (ctx) => (await ctx.db.query("publicLinks").withIndex("by_public_id", (q) => q.eq("publicId", first.linkId)).unique())!);
    expect(link.plainCopy).toBe(true);
    const { publishedCopy } = await import("../../convex/e2ee/links");
    const read = await t.run(async (ctx) => await publishedCopy(ctx, link));
    expect(read?.title).toBe("Public");
    expect(read?.blocks[0]?.id).toBe(block.id);
    await a.as.mutation(api.e2ee.links.publishCopy, { documentId: id, linkId: first.linkId, copy: { title: "Public 2", blocks: [] } });
    expect((await t.run(async (ctx) => await ctx.db.query("e2eePublishedCopies").collect())).map((c) => c.title)).toEqual(["Public 2"]);
    // Invalid blocks are refused; a plain note publishes as usual.
    await expect(a.as.mutation(api.e2ee.links.publishCopy, { documentId: id, copy: { title: "x", blocks: [{ ...block, type: "no-such-block" }] } })).rejects.toThrow(/isn't valid/);
    expect(await a.as.mutation(api.e2ee.links.unpublish, { linkId: first.linkId })).toEqual({ removed: true });
    const left = await t.run(async (ctx) => ({ copies: await ctx.db.query("e2eePublishedCopies").collect(), chunks: await ctx.db.query("e2eePublishedChunks").collect(), link: await ctx.db.get(link._id) }));
    expect(left.copies).toEqual([]);
    expect(left.chunks).toEqual([]);
    expect(left.link?.revokedAt).toBeDefined();
  });

  test("only the note's managers publish, and never a locked note", async () => {
    const t = setup();
    const { a, id } = await sealedPersonal(t, "l-who@example.com");
    const b = await person(t, "l-who-b@example.com");
    await expect(b.as.mutation(api.e2ee.links.publishCopy, { documentId: id, copy: { title: "x", blocks: [] } })).rejects.toThrow();
    const row = await docId(t, id);
    await t.run(async (ctx) => ctx.db.patch(row, { locked: true }));
    await expect(a.as.mutation(api.e2ee.links.publishCopy, { documentId: id, copy: { title: "x", blocks: [] } })).rejects.toThrow(/always fully encrypted/);
  });
});

describe("no plaintext (WP5 flows)", () => {
  const tables = Object.keys((schema as unknown as { tables: Record<string, unknown> }).tables);
  for (const c of noPlaintextCases) {
    test(c.name, async () => {
      const t = setup();
      const { markers, allowedIn } = await c.run(t);
      const scanned = await everyRow(t, tables.filter((x) => !allowedIn.includes(x)));
      for (const m of markers) {
        expect(scanned, `marker ${m}`).not.toContain(m);
        expect(scanned, `marker ${m} (base64)`).not.toContain(btoa(m));
      }
      const scheduled = await t.run(async (ctx) => JSON.stringify(await ctx.db.system.query("_scheduled_functions").collect()));
      for (const m of markers) expect(scheduled, `marker ${m} in the scheduler`).not.toContain(m);
    });
  }
});
