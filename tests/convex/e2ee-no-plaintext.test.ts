// The no-plaintext scan (docs/E2EE_DESIGN.md §11.2, R1): a Personal seeded with marker strings in every
// kind of content goes through a full seal migration, then the core flows run with every switch off; after
// that no table row, stored blob or scheduled job holds any marker, in UTF-8, UTF-16 or base64.
//
// WP3 owns this file; WP4 and WP5 add their flows (share links, exports, MCP, email, AI) as more steps of
// `afterSealing` and more cases below.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { ctx as aad } from "@folevi/local-store/e2ee";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Id, TableNames } from "../../convex/_generated/dataModel";
import { e2eePerson, e2eeRecoveryMethods, e2eeSpace, para, PERSONAL, setup, ulid, type T } from "./helpers";
import { findMarkers, push } from "./e2ee-fixtures";
import { runSealJob, sealerFor } from "./e2ee-device";
import { noPlaintextCases } from "./e2ee-ai-cases";

const SWITCHES = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false } as const;

const M = {
  title: "ZQXJ-TITLE-7f3a",
  body: "ZQXJ-BODY-91c2",
  folder: "ZQXJ-FOLDER-4d0e",
  tag: "ZQXJ-TAG-b6a1",
  comment: "ZQXJ-COMMENT-e83f",
  file: "ZQXJ-FILE-2a77",
  version: "ZQXJ-VERSION-5c19",
  task: "ZQXJ-TASK-0b4d",
  found: "ZQXJ-FOUND-c3e8",
  later: "ZQXJ-LATER-6f20",
};
const MARKERS = Object.values(M);

/** Every row of every table, every stored blob and every scheduled job's arguments, searched for the markers. */
export async function scanForMarkers(t: T, markers: string[]): Promise<string[]> {
  return await t.run(async (ctx) => {
    const hits: string[] = [];
    for (const table of Object.keys(schema.tables) as TableNames[]) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) findMarkers(row, markers, `${table}/${row._id}`, hits);
    }
    for (const blob of await ctx.db.system.query("_storage").collect()) {
      const data = await ctx.storage.get(blob._id);
      if (data) findMarkers(await data.arrayBuffer(), markers, `_storage/${blob._id}`, hits);
    }
    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) findMarkers(job.args, markers, `_scheduled_functions/${job._id}`, hits);
    return hits;
  });
}

/** The seeded Personal: a note with every kind of content holding a marker, made before encryption is on. */
async function seed(t: T, p: Awaited<ReturnType<typeof e2eePerson>>) {
  const docId = ulid();
  const { id: folderId } = await p.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: M.folder });
  const { id: tagId } = await p.as.mutation(api.organization.createTag, { scope: PERSONAL, name: M.tag });
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId, kind: "document", title: M.title, icon: null } }]);
  const todo: WireBlock = { id: ulid(), type: "todo", parentId: null, rank: "W", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: M.task }], props: { checked: false } };
  const body = para(ulid(), M.body);
  const gone = para(ulid(), `${M.body} deleted`, "X");
  await push(p, [body, todo, gone].map((b) => ({ opId: ulid(), kind: "block.upsert" as const, documentId: docId, block: b, baseRevision: null, fields: ["content" as const, "position" as const] })));
  const [goneRow] = await push(p, [{ opId: ulid(), kind: "block.delete", documentId: docId, blockId: gone.id, baseRevision: null }]);
  expect(goneRow!.status).toBe("applied");
  await p.as.mutation(api.organization.setDocumentTags, { documentId: docId, tagIds: [tagId] });
  await p.as.mutation(api.comments.create, { documentId: docId, blockId: body.id, body: [{ type: "text", text: M.comment }] });
  await p.as.mutation(api.documents.createSnapshot, { documentId: docId, reason: "manual", name: M.version });
  // A file with its name and bytes, and the text found in it (as a device would have saved it).
  const fileBlockId = ulid();
  await t.run(async (ctx) => {
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", docId)).unique())!;
    const storageId = await ctx.storage.store(new Blob([new TextEncoder().encode(`%PDF-1.4 ${M.file} bytes`)]));
    const fileId = await ctx.db.insert("files", {
      publicId: ulid(),
      storageId,
      ownerProfileId: doc.ownerProfileId,
      documentId: doc._id,
      uploadedBy: doc.createdBy,
      filename: `${M.file}.pdf`,
      mimeType: "application/pdf",
      size: 30,
      sha256: "0".repeat(64),
      kind: "file",
      status: "ready",
      createdAt: Date.now(),
    });
    await ctx.db.insert("fileTexts", { ownerProfileId: doc.ownerProfileId, documentId: doc._id, fileId, blockId: fileBlockId, source: "pdf", by: "pdf", text: M.found, hash: "0".repeat(64), createdBy: doc.createdBy, updatedAt: Date.now() });
    // A notification from before, quoting the note's title.
    await ctx.db.insert("notifications", { profileId: doc.createdBy, kind: "mention", documentId: doc._id, title: `Someone mentioned you in ${M.title}`, body: M.body, createdAt: Date.now() });
  });
  return { docId, folderId, tagId, bodyId: body.id };
}

describe("no plaintext left on the server", () => {
  test("after a full seal migration and the core flows with every switch off, no marker remains anywhere", async () => {
    const t = setup();
    const p = await e2eePerson(t, "no-plaintext@example.com");
    await e2eeRecoveryMethods(p);
    const space = await e2eeSpace(p, PERSONAL);
    const sealer = await sealerFor(space.sk, space.scopeId);
    const seeded = await seed(t, p);
    // The scan sees the markers before (it would catch a leak).
    expect((await scanForMarkers(t, MARKERS)).length).toBeGreaterThan(5);

    const { migrationId } = await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: SWITCHES });
    await runSealJob(t, p, sealer, migrationId!, "device-scan-00001");
    // Cleanup on the device: folder and tag names sealed.
    await p.as.mutation(api.e2ee.content.renameFolder, { folderId: seeded.folderId, sealedName: await sealer.sealSpaceName("folder", seeded.folderId, M.folder) });
    await p.as.mutation(api.e2ee.content.updateTag, { tagId: seeded.tagId, sealedName: await sealer.sealSpaceName("tag", seeded.tagId, M.tag), nameMac: await sealer.tagMac(M.tag) });

    // The core flows afterwards, all sealed: an edit, a new note, a comment, a version, a record, a file.
    await push(p, [await sealer.upsert(seeded.docId, para(ulid(), M.later, "Y"), null)]);
    const another = ulid();
    await push(p, [await sealer.createOp(another, { title: M.later })]);
    const threadId = ulid();
    const commentId = ulid();
    await p.as.mutation(api.e2ee.content.createComment, { documentId: seeded.docId, threadId, commentId, sealedBody: await sealer.sealNoteRecord(seeded.docId, aad.comment(seeded.docId, commentId), [{ type: "text", text: M.later }]), mentions: [p.profileId] });
    await p.as.mutation(api.documents.createSnapshot, { documentId: seeded.docId, reason: "manual" });
    await p.as.mutation(api.e2ee.content.putRecord, { scope: PERSONAL, kind: "collection", recordId: ulid(), documentId: seeded.docId, sealed: await sealer.sealNoteRecord(seeded.docId, aad.spaceRecord(space.scopeId, "collection", "x"), { name: M.later }), keyVersion: 1, baseRev: 0 });
    const fileId = ulid();
    const file = await sealer.sealFileBytes(seeded.docId, fileId, new TextEncoder().encode(`${M.later} bytes`), { name: `${M.later}.txt`, mime: "text/plain" });
    const { intentId } = await p.as.mutation(api.e2ee.files.generateUploadUrl, { documentId: seeded.docId, kind: "file", declaredSize: file.bytes.byteLength });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([file.bytes])));
    await p.as.action(api.e2ee.files.commit, { intentId, documentId: seeded.docId, fileId, storageId, sealed: file.row, size: file.bytes.byteLength, sha256: file.sha256 });

    const hits = await scanForMarkers(t, MARKERS);
    expect(hits).toEqual([]);
    // And the content is all still there for the device.
    const doc = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", seeded.docId)).unique())!);
    expect(await sealer.openTitle(seeded.docId, doc.sealedTitle!)).toBe(M.title);
    const notif = await t.run(async (ctx) => await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", p.profileId as Id<"profiles">)).collect());
    expect(notif.find((n) => n.documentId === doc._id)?.sealedDocument).toBe(true);
  });
});

// WP5's flows (Foli AI with provided context, email, MCP, webhooks, digests, reminders, published copies…)
// under this suite's full scan: tables, stored blobs and scheduled jobs. A case may name tables where its
// markers are readable on purpose (a switch's copies); hits anywhere else fail.
describe("no plaintext left by the AI, integration and inbound flows (WP5's cases)", () => {
  for (const c of noPlaintextCases) {
    test(c.name, async () => {
      const t = setup();
      const { markers, allowedIn } = await c.run(t);
      const hits = (await scanForMarkers(t, markers)).filter((h) => !allowedIn.includes(h.split("/")[0]!));
      expect(hits).toEqual([]);
    });
  }
});
