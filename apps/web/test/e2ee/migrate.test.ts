// @vitest-environment edge-runtime
// The background migration (docs/E2EE_DESIGN.md §6.9, §11.1 WP8) against the real server functions in
// convex-test: a seeded Personal sealed by the runner (notes, comments, versions, folder names), resumed by a
// second device after a lease lapses (including a note left half done), an edit from another device waiting
// while a note is converted, and unsealing back to Standard.
import { describe, expect, test, vi } from "vitest";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Sealer } from "@/lib/e2ee/seal";
import { runJob } from "@/lib/e2ee/migrate/runner";
import { sealDocument } from "@/lib/e2ee/migrate/seal";
import { resealDocument, rotateNote } from "@/lib/e2ee/migrate/reseal";
import { hex } from "@/lib/e2ee/migrate/env";
import { ctx as aad, importAead, openFileStream, sealFileStream, sha256 } from "@folevi/local-store/e2ee";
import type { MigrateEnv } from "@/lib/e2ee/migrate/env";
import { convexHelpers, innerOf, TestKeyRing, type Person, type T } from "./wp8Fakes";

const { helpers, fixtures } = await convexHelpers();
const { e2eePerson, e2eeRecoveryMethods, e2eeSpace, para, PERSONAL, setup, ulid } = helpers;
const { push } = fixtures;

// The first call loads the whole backend into convex-test: slow on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const SWITCHES = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false } as const;

async function encryptedPersonal(t: T, email: string) {
  const p = await e2eePerson(t, email);
  await e2eeRecoveryMethods(p);
  const space = await e2eeSpace(p, PERSONAL);
  const keyring = new TestKeyRing(new Map([[1, space.sk]]), space.scopeId);
  return { p, space, keyring };
}

function envOf(p: { as: unknown }, keyring: TestKeyRing, scopeId: string, deviceId: string, o: Partial<MigrateEnv> = {}): MigrateEnv {
  return { server: innerOf(p.as), sealer: new Sealer(keyring), keyring, deviceId, space: { scope: PERSONAL, scopeId }, ...o };
}

async function docRow(t: T, publicId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
}

async function blockRows(t: T, documentId: Id<"documents">) {
  return await t.run(async (ctx) => await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect());
}

/** A plain note with text and a to-do, made before encryption was on. */
async function plainNote(p: Person, title: string, body: string) {
  const id = ulid();
  const todo: WireBlock = { id: ulid(), type: "todo", parentId: null, rank: "W", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: `${body} task` }], props: { checked: false } };
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }]);
  await push(p, [para(ulid(), body), todo].map((b) => ({ opId: ulid(), kind: "block.upsert" as const, documentId: id, block: b, baseRevision: null, fields: ["content" as const, "position" as const] })));
  return id;
}

async function job(_p: { as: unknown }, migrationId: string) {
  return { id: migrationId, direction: "seal" as const, scopeOf: "space" as const, rootId: null };
}

describe("the migration runner", () => {
  test("seals every note, comment, version and folder name of a Personal; the device opens them again", async () => {
    const t = setup();
    const { p, space, keyring } = await encryptedPersonal(t, "wp8-seal@example.com");
    const a = await plainNote(p, "ZQXJ-TITLE-a", "ZQXJ-BODY-a");
    const b = await plainNote(p, "ZQXJ-TITLE-b", "ZQXJ-BODY-b");
    await p.as.mutation(api.comments.create, { documentId: a, body: [{ type: "text", text: "ZQXJ-COMMENT-a" }] } as never);
    await p.as.mutation(api.documents.createSnapshot, { documentId: b, reason: "manual" });
    const { id: folderId } = await p.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "ZQXJ-FOLDER-x" });

    const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    const env = envOf(p, keyring, space.scopeId, "device-wp8-seal-01");
    const items: string[] = [];
    const result = await runJob(env, await job(p, migrationId!), { onItem: (kind, id, ok) => items.push(`${kind}:${ok ? "ok" : "failed"}`) });
    expect(result).toBe("done");
    expect(items.filter((i) => i === "documents:ok").length).toBeGreaterThanOrEqual(2);
    expect(items).toContain("history:ok");
    expect(items.some((i) => i.endsWith("failed"))).toBe(false);

    for (const [id, title, body] of [[a, "ZQXJ-TITLE-a", "ZQXJ-BODY-a"], [b, "ZQXJ-TITLE-b", "ZQXJ-BODY-b"]] as const) {
      const row = await docRow(t, id);
      expect(row.sealedAt).toBeTypeOf("number");
      expect(row.title).toBe("");
      expect(row.searchText).toBe("");
      const rows = await blockRows(t, row._id);
      expect(rows.every((r) => r.sealed !== undefined && r.type === "sealed")).toBe(true);
      // What the device sealed, the device opens.
      const opened = await Promise.all(rows.map((r) => new Sealer(keyring).openBlock(id, { id: r.blockId, parentId: null, rank: r.rank, sealed: r.sealed! })));
      expect(opened.map((o) => (o.text as { text?: string }[]).map((n) => n.text).join("")).sort()).toEqual([body, `${body} task`].sort());
      expect(await new Sealer(keyring).openTitle(id, row.sealedTitle!.c)).toBe(title);
    }
    const scan = await t.run(async (ctx) => ({
      comments: await ctx.db.query("comments").collect(),
      snaps: await ctx.db.query("documentSnapshots").collect(),
      folder: await ctx.db.query("folders").withIndex("by_public_id", (q) => q.eq("publicId", folderId)).unique(),
      space: await ctx.db.query("e2eeSpaces").collect(),
    }));
    expect(scan.comments.every((c) => c.sealedBody !== undefined && JSON.stringify(c.body) === "[]")).toBe(true);
    expect(scan.snaps.every((s) => s.sealed === true && s.title === "")).toBe(true);
    expect(scan.folder!.name).toBe("");
    expect(await new Sealer(keyring).openFolderName(PERSONAL, space.scopeId, folderId, scan.folder!.sealedName!.c)).toBe("ZQXJ-FOLDER-x");
    expect(scan.space[0]!.state).toBe("on");
  });

  test("a lapsed lease lets another device carry on, finishing a note the first one left half done", async () => {
    const t = setup();
    const { p, space, keyring } = await encryptedPersonal(t, "wp8-lease@example.com");
    const a = await plainNote(p, "First", "one");
    const b = await plainNote(p, "Second", "two");
    const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });

    // Device 1 claims, starts note b (key stored, one block sealed) and is closed.
    const one = envOf(p, keyring, space.scopeId, "device-wp8-lease-1");
    await p.as.mutation(api.e2ee.migrate.claim, { migrationId: migrationId!, deviceId: one.deviceId });
    const nk = await keyring.newNoteKey(b, PERSONAL);
    await p.as.mutation(api.e2ee.migrate.beginDocument, { documentId: b, deviceId: one.deviceId, noteKey: { documentId: b, version: 1, wrappedBy: "space", spaceVersion: nk.spaceVersion, wrapped: nk.wrapped.buffer.slice(0) as ArrayBuffer } });
    const first = (await p.as.query(api.e2ee.migrate.plainBlocks, { documentId: b })).blocks[0]!;
    const sealed = (await one.sealer.sealBlock(b, first.block as WireBlock)).sealed;
    await p.as.mutation(api.e2ee.migrate.sealBlocks, { documentId: b, deviceId: one.deviceId, blocks: [{ blockId: first.block.id, revision: first.revision, sealed: { c: sealed.c, mac: sealed.mac, k: sealed.k } }] });

    // Device 2 (another key ring: it learns note b's key from the server) waits while the lease holds.
    const ring2 = keyring.sibling();
    const two = envOf(p, ring2, space.scopeId, "device-wp8-lease-2");
    expect(await runJob(two, await job(p, migrationId!))).toBe("busy");

    // Both leases lapse (two minutes).
    await t.run(async (ctx) => {
      await ctx.db.patch(migrationId as Id<"e2eeMigrations">, { leaseUntil: Date.now() - 1 });
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", b)).unique())!;
      await ctx.db.patch(doc._id, { sealing: { by: one.deviceId, until: Date.now() - 1 } });
    });
    expect(await runJob(two, await job(p, migrationId!))).toBe("done");
    for (const id of [a, b]) {
      const row = await docRow(t, id);
      expect(row.sealedAt).toBeTypeOf("number");
      const rows = await blockRows(t, row._id);
      // Note b's key is the one device 1 stored (device 2 used it): every block opens with it.
      const texts = await Promise.all(rows.map(async (r) => (await new Sealer(ring2).openBlock(id, { id: r.blockId, parentId: null, rank: r.rank, sealed: r.sealed! })).text));
      expect(texts.length).toBe(2);
    }
    expect((await docRow(t, b)).sealedAt).toBeTypeOf("number");
    expect(ring2.wraps(b).map((w) => w.version)).toEqual([1]);
  });

  test("another device's edit waits while a note is converted, then goes in sealed", async () => {
    const t = setup();
    const { p, space, keyring } = await encryptedPersonal(t, "wp8-edit@example.com");
    const a = await plainNote(p, "Busy", "text");
    await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    let tried: unknown = null;
    const env = envOf(p, keyring, space.scopeId, "device-wp8-edit-01", {
      server: innerOf(p.as, {
        async beforeMutation(name) {
          if (name !== "e2ee/migrate:sealDocumentFields" || tried) return;
          // The note is held: an edit from another device now is refused for the whole batch (and retried).
          tried = await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: a, block: para(ulid(), "late edit"), baseRevision: null, fields: ["content", "position"] }], "device-other-002").catch((e) => e);
        },
      }),
    });
    await sealDocument(env, a);
    expect((tried as { data?: { code?: string } }).data?.code).toBe("e2ee_busy");
    expect((await docRow(t, a)).sealedAt).toBeTypeOf("number");
    // Afterwards a plaintext edit is refused (an old client); sealed edits go in.
    const [refused] = await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: a, block: para(ulid(), "plain"), baseRevision: null, fields: ["content", "position"] }], "device-other-002");
    expect(refused!.error!.code).toBe("e2ee_required");
    const late = await env.sealer.sealBlock(a, para(ulid(), "late edit"));
    const [ok] = await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: a, block: late as never, baseRevision: null, fields: ["content", "position"] }], "device-other-002");
    expect(ok!.status).toBe("applied");
  });

  test("seal then unseal round trip: notes, versions, folder names, study schedules and Foli AI memories come back", async () => {
    const t: T = setup();
    const { p, space, keyring } = await encryptedPersonal(t, "wp8-unseal@example.com");
    const a = await plainNote(p, "ZQXJ-TITLE-u", "ZQXJ-BODY-u");
    const card: WireBlock = { id: ulid(), type: "toggle", parentId: null, rank: "X", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "ZQXJ-CARD-q" }], props: { collapsed: false, study: "card" } };
    await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: a, block: card, baseRevision: null, fields: ["content", "position"] }]);
    await p.as.mutation(api.study.review, { blockId: card.id, rating: "good", lastReview: null } as never);
    await p.as.mutation(api.documents.createSnapshot, { documentId: a, reason: "manual" });
    const { id: folderId } = await p.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "ZQXJ-FOLDER-u" });
    await p.as.mutation(api.aiMemory.add, { kind: "instruction", text: "ZQXJ-MEMORY-u" });
    const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    const env = envOf(p, keyring, space.scopeId, "device-wp8-unseal-1");
    expect(await runJob(env, await job(p, migrationId!))).toBe("done");
    const sealedState = await t.run(async (ctx) => ({
      study: await ctx.db.query("studyReviews").collect(),
      memories: await ctx.db.query("aiMemories").collect(),
      records: await ctx.db.query("e2eeRecords").collect(),
    }));
    expect((await docRow(t, a)).searchText).toBe("");
    // Schedules and memories moved into this person's sealed records; nothing readable is left.
    expect(sealedState.study).toHaveLength(0);
    expect(sealedState.memories).toHaveLength(0);
    expect(sealedState.records.filter((r) => r.kind === "studyReview")).toHaveLength(1);
    expect(sealedState.records.filter((r) => r.kind === "aiMemory")).toHaveLength(1);
    expect(JSON.stringify(sealedState)).not.toContain("ZQXJ-MEMORY-u");

    const wraps = (await p.as.query(api.e2ee.keys.listWraps, {})) as { publicId: string; kind: string }[];
    await p.as.mutation(api.e2ee.keys.getWrap, { kind: "recoveryKey" });
    const lowered = await p.as.mutation(api.e2ee.spaces.lower, { scope: PERSONAL, level: "standard", recheckedWrapId: wraps.find((w) => w.kind === "recoveryKey")!.publicId });
    const failed = new Map<string, string>();
    expect(await runJob(env, { id: lowered.migrationId!, direction: "unseal", scopeOf: "space", rootId: null }, { failed })).toBe("done");
    expect(failed.size).toBe(0);
    const row = await docRow(t, a);
    expect(row.sealedAt).toBeUndefined();
    expect(row.title).toBe("ZQXJ-TITLE-u");
    expect(row.searchText).toContain("ZQXJ-BODY-u");
    const after = await t.run(async (ctx) => ({
      tasks: await ctx.db.query("tasks").withIndex("by_document", (q) => q.eq("documentId", row._id)).collect(),
      snaps: await ctx.db.query("documentSnapshots").withIndex("by_document", (q) => q.eq("documentId", row._id)).collect(),
      folder: await ctx.db.query("folders").withIndex("by_public_id", (q) => q.eq("publicId", folderId)).unique(),
      study: await ctx.db.query("studyReviews").collect(),
      memories: await ctx.db.query("aiMemories").collect(),
      space: await ctx.db.query("e2eeSpaces").first(),
    }));
    expect(after.tasks).toHaveLength(1);
    expect(after.snaps.every((s) => !s.sealed && s.title === "ZQXJ-TITLE-u")).toBe(true);
    expect(after.folder!.name).toBe("ZQXJ-FOLDER-u");
    expect(after.folder!.sealedName).toBeUndefined();
    expect(after.study.map((r) => r.blockId)).toEqual([card.id]);
    expect(after.memories.map((m) => m.text)).toEqual(["ZQXJ-MEMORY-u"]);
    expect(after.space!.state).toBe("off");
  });

  test("a note's key changes: its blocks and its files' keys move to the new key; the old one isn't needed", async () => {
    const t: T = setup();
    const { p, space, keyring } = await encryptedPersonal(t, "wp8-rotate@example.com");
    const a = await plainNote(p, "Rotated", "ZQXJ-BODY-r");
    const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    const env = envOf(p, keyring, space.scopeId, "device-wp8-rotate-1");
    expect(await runJob(env, await job(p, migrationId!))).toBe("done");
    // A sealed file of the note (as e2ee.files.commit stores one).
    const fileId = ulid();
    const plain = new TextEncoder().encode("ZQXJ-FILE-r");
    const { raw, wrapped, k } = await env.sealer.newFileKey(a, fileId);
    const meta = await Sealer.sealFileMeta(raw, a, fileId, { name: "r.txt", mime: "text/plain", width: null, height: null, sha256: "" });
    const envelope = await sealFileStream(await importAead(raw.slice()), aad.file(fileId), plain);
    raw.fill(0);
    const { intentId } = await p.as.mutation(api.e2ee.files.generateUploadUrl, { documentId: a, kind: "file", declaredSize: envelope.length });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([envelope as Uint8Array<ArrayBuffer>])));
    await p.as.action(api.e2ee.files.commit, { intentId, documentId: a, fileId, storageId, sealed: { key: wrapped, meta, k, plainSize: plain.length }, size: envelope.length, sha256: hex(sha256(envelope)) });

    const v2 = await rotateNote(env, { accountKeys: () => p.account, profileId: p.profileId }, a);
    expect(v2).toBe(2);
    expect(((await p.as.query(api.e2ee.files.oldKeyFiles, { documentId: a })) as unknown[]).length).toBe(1);
    expect(await resealDocument(env, a)).toBe(true);
    expect(await p.as.query(api.e2ee.files.oldKeyFiles, { documentId: a })).toEqual([]);
    const rows = await t.run(async (ctx) => {
      const d = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", a)).unique())!;
      return { blocks: await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect(), file: (await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", fileId)).unique())! };
    });
    expect(rows.blocks.every((b) => b.sealed!.k === 2)).toBe(true);
    expect(rows.file.sealed!.k).toBe(2);
    // The rewrapped key opens the same bytes.
    const key = await env.sealer.openFileKey(a, fileId, rows.file.sealed!.key);
    const bytes = await openFileStream(await importAead(key), aad.file(fileId), envelope);
    expect(new TextDecoder().decode(bytes)).toBe("ZQXJ-FILE-r");
  });
});
