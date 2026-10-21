// The seal and unseal migrations on the server (docs/E2EE_DESIGN.md §5.3 e2ee.migrate, §6.9, §11.2): a
// device seals a seeded Personal note by note, the server purges what it derived, leases lapse and
// resume, other devices wait while a note is converted, and unsealing brings the server's derived data back.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { e2eePerson, e2eeRecoveryMethods, e2eeSpace, para, PERSONAL, setup, ulid, type T } from "./helpers";
import { push } from "./e2ee-fixtures";
import { runSealJob, sealerFor, sealNote, unsealNote } from "./e2ee-device";

const SWITCHES = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false } as const;

async function encryptedPersonal(t: T, email: string) {
  const p = await e2eePerson(t, email);
  await e2eeRecoveryMethods(p);
  const space = await e2eeSpace(p, PERSONAL);
  const sealer = await sealerFor(space.sk, space.scopeId);
  return { p, sealer };
}

async function docRow(t: T, publicId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
}

/** A plain note with a to-do, a page link and some text, made before encryption is on. */
async function plainNote(p: { as: never } | Awaited<ReturnType<typeof e2eePerson>>, title: string, body: string, linkTo?: string) {
  const id = ulid();
  const todo: WireBlock = { id: ulid(), type: "todo", parentId: null, rank: "W", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: `${body} task` }], props: { checked: false } };
  const blocks: WireBlock[] = [para(ulid(), body), todo];
  if (linkTo) blocks.push({ id: ulid(), type: "paragraph", parentId: null, rank: "X", schemaVersion: SCHEMA_VERSION, text: [{ type: "pageLink", documentId: linkTo, label: "x" } as never], props: {} });
  const q = p as Awaited<ReturnType<typeof e2eePerson>>;
  await push(q, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }]);
  await push(q, blocks.map((b) => ({ opId: ulid(), kind: "block.upsert" as const, documentId: id, block: b, baseRevision: null, fields: ["content" as const, "position" as const] })));
  return id;
}

describe("seal migration", () => {
  test("a device seals every note of a Personal; the server's derived plaintext goes", async () => {
    const t = setup();
    const { p, sealer } = await encryptedPersonal(t, "migrate-seal@example.com");
    const target = await plainNote(p, "ZQXJ-TITLE-target", "ZQXJ-BODY-target");
    const linking = await plainNote(p, "ZQXJ-TITLE-linking", "ZQXJ-BODY-linking", target);
    await p.as.mutation(api.documents.createSnapshot, { documentId: linking, reason: "manual" });
    const before = await docRow(t, linking);
    expect(before.searchText).toContain("ZQXJ-BODY-linking");
    const tasksBefore = await t.run(async (ctx) => await ctx.db.query("tasks").withIndex("by_document", (q) => q.eq("documentId", before._id)).collect());
    expect(tasksBefore).toHaveLength(1);

    const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    expect(migrationId).toBeTruthy();
    // While enabling, plaintext writes are refused (the device seals a note first).
    const [refused] = await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: linking, block: para(ulid(), "late"), baseRevision: null, fields: ["content", "position"] }]);
    expect(refused!.error!.code).toBe("e2ee_required");

    await runSealJob(t, p, sealer, migrationId!, "device-migrator-1");

    const after = await docRow(t, linking);
    expect(after.sealedAt).toBeTypeOf("number");
    expect(after.sealing).toBeUndefined();
    expect(after.title).toBe("");
    expect(after.searchText).toBe("");
    expect(after.excerpt).toBe("");
    const left = await t.run(async (ctx) => ({
      tasks: await ctx.db.query("tasks").withIndex("by_document", (q) => q.eq("documentId", after._id)).collect(),
      links: await ctx.db.query("documentLinks").withIndex("by_source", (q) => q.eq("sourceDocumentId", after._id)).collect(),
      blocks: await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", after._id)).collect(),
      snaps: await ctx.db.query("documentSnapshots").withIndex("by_document", (q) => q.eq("documentId", after._id)).collect(),
      space: await ctx.db.query("e2eeSpaces").withIndex("by_scope_key", (q) => q.eq("scopeKey", `p:${p.profileId}`)).unique(),
      job: await ctx.db.get(migrationId as Id<"e2eeMigrations">),
      docs: await ctx.db.query("documents").withIndex("by_owner_created", (q) => q.eq("ownerProfileId", p.profileId as Id<"profiles">)).collect(),
    }));
    expect(left.tasks).toHaveLength(0);
    expect(left.links).toHaveLength(0);
    expect(left.blocks.every((b) => b.sealed !== undefined && b.type === "sealed")).toBe(true);
    expect(left.snaps.every((s) => s.sealed === true && s.title === "")).toBe(true);
    expect(left.space!.state).toBe("on");
    expect(left.space!.migrationId).toBeUndefined();
    expect(left.job!.phase).toBe("done");
    expect(left.job!.done).toBeGreaterThanOrEqual(2);
    // Every note of the space (the seeded ones too) is sealed.
    expect(left.docs.filter((d) => d.sealedAt === undefined).map((d) => d.title)).toEqual([]);
    expect(JSON.stringify(left.blocks.map((b) => [b.text, b.props])) + JSON.stringify(left.docs.map((d) => [d.title, d.searchText, d.excerpt, d.preview]))).not.toContain("ZQXJ");

    // The device reads it back: titles and blocks open.
    const listed = (await p.as.query(api.blocks.list, { documentId: target }))!.blocks as never[];
    const opened = await Promise.all(listed.map((b) => sealer.openBlock(target, b)));
    expect(opened.map((b) => (b.text[0] as { text?: string } | undefined)?.text)).toContain("ZQXJ-BODY-target");
  });

  test("a lapsed lease lets another device carry on; a note held by one device makes others wait", async () => {
    const t = setup();
    const { p, sealer } = await encryptedPersonal(t, "migrate-lease@example.com");
    const note = await plainNote(p, "Lease", "Body");
    const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    const first = await p.as.mutation(api.e2ee.migrate.claim, { migrationId: migrationId!, deviceId: "device-a-000001" });
    expect(first.busy).toBe(false);
    expect(first.documents).toContain(note);
    // Another device while the lease is held: busy.
    expect((await p.as.mutation(api.e2ee.migrate.claim, { migrationId: migrationId!, deviceId: "device-b-000001" })).busy).toBe(true);
    // Device A starts the note, then goes away.
    await p.as.mutation(api.e2ee.migrate.beginDocument, { documentId: note, deviceId: "device-a-000001", noteKey: { documentId: note, version: 1, wrappedBy: "space", spaceVersion: 1, wrapped: await sealer.wrappedNoteKey(note) } });
    await expect(push(p, [await sealer.upsert(note, para(ulid(), "meanwhile"), null)], "device-c-000001")).rejects.toThrow(/e2ee_busy|Encrypting/);
    // Both leases lapse (two minutes).
    await t.run(async (ctx) => {
      await ctx.db.patch(migrationId as Id<"e2eeMigrations">, { leaseUntil: Date.now() - 1 });
      const d = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", note)).unique();
      await ctx.db.patch(d!._id, { sealing: { by: "device-a-000001", until: Date.now() - 1 } });
    });
    const second = await p.as.mutation(api.e2ee.migrate.claim, { migrationId: migrationId!, deviceId: "device-b-000001" });
    expect(second.busy).toBe(false);
    // The half-done note is offered again.
    expect(second.documents).toContain(note);
    await runSealJob(t, p, sealer, migrationId!, "device-b-000001");
    expect((await docRow(t, note)).sealedAt).toBeTypeOf("number");
  });

  test("finishing refuses a note with blocks not sealed yet (a block written after the device read it)", async () => {
    const t = setup();
    const { p, sealer } = await encryptedPersonal(t, "migrate-cas@example.com");
    const note = await plainNote(p, "CAS", "Body");
    await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    const deviceId = "device-cas-00001";
    await p.as.mutation(api.e2ee.migrate.beginDocument, { documentId: note, deviceId, noteKey: { documentId: note, version: 1, wrappedBy: "space", spaceVersion: 1, wrapped: await sealer.wrappedNoteKey(note) } });
    await expect(p.as.mutation(api.e2ee.migrate.finishDocument, { documentId: note, deviceId, records: [] })).rejects.toThrow();
    // A stale revision is skipped, not overwritten.
    const blocks = (await p.as.query(api.e2ee.migrate.plainBlocks, { documentId: note })).blocks;
    const sealedBlock = (await sealer.sealBlock(note, blocks[0]!.block)) as unknown as { sealed: { c: ArrayBuffer; mac: string; k: number } };
    const r = await p.as.mutation(api.e2ee.migrate.sealBlocks, { documentId: note, deviceId, blocks: [{ blockId: blocks[0]!.block.id, revision: blocks[0]!.revision + 5, sealed: { c: sealedBlock.sealed.c, mac: sealedBlock.sealed.mac, k: sealedBlock.sealed.k } }] });
    expect(r.skipped).toEqual([blocks[0]!.block.id]);
    await sealNote(t, p, sealer, note, deviceId);
    expect((await docRow(t, note)).sealedAt).toBeTypeOf("number");
  });
});

describe("unseal migration", () => {
  test("lowering to Standard unseals note by note and the server derives again", async () => {
    const t = setup();
    const { p, sealer } = await encryptedPersonal(t, "migrate-unseal@example.com");
    const note = await plainNote(p, "ZQXJ-TITLE-unseal", "ZQXJ-BODY-unseal");
    const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    await runSealJob(t, p, sealer, migrationId!, "device-unseal-001");
    expect((await docRow(t, note)).searchText).toBe("");
    // Lowering asks for a recovery method checked in the last ten minutes.
    const wraps = await p.as.query(api.e2ee.keys.listWraps, {});
    const wrap = (wraps as { publicId: string; kind: string }[]).find((w) => w.kind === "recoveryKey")!;
    await p.as.mutation(api.e2ee.keys.getWrap, { kind: "recoveryKey" });
    const lowered = await p.as.mutation(api.e2ee.spaces.lower, { scope: PERSONAL, level: "standard", recheckedWrapId: wrap.publicId });
    expect(lowered.migrationId).toBeTruthy();
    await unsealNote(p, sealer, note, "device-unseal-001", { title: "ZQXJ-TITLE-unseal" });
    const after = await docRow(t, note);
    expect(after.sealedAt).toBeUndefined();
    expect(after.title).toBe("ZQXJ-TITLE-unseal");
    expect(after.searchText).toContain("ZQXJ-BODY-unseal");
    const tasks = await t.run(async (ctx) => await ctx.db.query("tasks").withIndex("by_document", (q) => q.eq("documentId", after._id)).collect());
    expect(tasks).toHaveLength(1);
  });
});

describe("locks in a Standard space", () => {
  test("locking a folder seals only its notes; moving a plain note into it is refused until sealed", async () => {
    const t = setup();
    const p = await e2eePerson(t, "migrate-lock@example.com");
    await e2eeRecoveryMethods(p);
    const space = await e2eeSpace(p, PERSONAL);
    const sealer = await sealerFor(space.sk, space.scopeId);
    const { id: folderId } = await p.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Private" });
    const inside = await plainNote(p, "ZQXJ-TITLE-inside", "ZQXJ-BODY-inside");
    const outside = await plainNote(p, "Outside", "Plain body");
    await push(p, [{ opId: ulid(), kind: "document.update", documentId: inside, patch: { folderId }, baseRevision: null }]);
    const { migrationId } = await p.as.mutation(api.e2ee.content.setFolderLocked, { folderId, locked: true });
    expect(migrationId).toBeTruthy();
    expect((await docRow(t, inside)).lockedVia).toBeDefined();
    await runSealJob(t, p, sealer, migrationId!, "device-lock-0001");
    expect((await docRow(t, inside)).sealedAt).toBeTypeOf("number");
    expect((await docRow(t, outside)).sealedAt).toBeUndefined();
    // The plain note can't go into the locked folder; new notes there must be sealed.
    const [move] = await push(p, [{ opId: ulid(), kind: "document.update", documentId: outside, patch: { folderId }, baseRevision: null }]);
    expect(move!.error!.code).toBe("e2ee_required");
    const [plainCreate] = await push(p, [{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: null, folderId, kind: "document", title: "x", icon: null } }]);
    expect(plainCreate!.error!.code).toBe("e2ee_required");
    const sealedId = ulid();
    const [sealedCreate] = await push(p, [await sealer.createOp(sealedId, { title: "Secret", folderId })]);
    expect(sealedCreate!.status).toBe("applied");
    expect((await docRow(t, sealedId)).lockedVia).toBeDefined();
    // Elsewhere in the Standard space plain notes work as before.
    const [plainOk] = await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: outside, block: para(ulid(), "still fine"), baseRevision: null, fields: ["content", "position"] }]);
    expect(plainOk!.status).toBe("applied");
  });
});
