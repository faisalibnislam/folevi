// A device that runs the migration (docs/E2EE_DESIGN.md §6.9) for the WP3 tests: seals and unseals notes
// through e2ee.migrate with the Sealer of e2ee-fixtures.ts, the way WP8's migrate/runner.ts will.
import { canonicalJson, type WireBlock } from "@folevi/editor-schema";
import { ctx as aad, deriveSpaceKeys } from "@folevi/local-store/e2ee";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { T } from "./helpers";
import { Sealer } from "./e2ee-fixtures";

type As = { mutation: (ref: never, args: never) => Promise<unknown>; query: (ref: never, args: never) => Promise<unknown>; action: (ref: never, args: never) => Promise<unknown> };
type Who = { as: unknown; profileId: string };

const m = (p: Who) => (p.as as As).mutation as unknown as (ref: unknown, args: unknown) => Promise<never>;
const q = (p: Who) => (p.as as As).query as unknown as (ref: unknown, args: unknown) => Promise<never>;
const a = (p: Who) => (p.as as As).action as unknown as (ref: unknown, args: unknown) => Promise<never>;

/** A Sealer for a space whose key `sk` WP2's setUp stored. */
export async function sealerFor(sk: Uint8Array, scopeId: string): Promise<Sealer> {
  return new Sealer({ keys: await deriveSpaceKeys(sk.slice()), scope: scopeId });
}

async function allBlocks(p: Who, documentId: string) {
  const out: { block: WireBlock & { sealed?: { c: ArrayBuffer; collapsed?: true } }; revision: number; deleted: boolean }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = (await q(p)(api.e2ee.migrate.plainBlocks, { documentId, cursor })) as { blocks: typeof out; cursor: string; isDone: boolean };
    out.push(...page.blocks);
    if (page.isDone) return out;
    cursor = page.cursor;
  }
}

/** Seals one note: begin, blocks, title and look, comments, then finish with its records. */
export async function sealNote(t: T, p: Who, sealer: Sealer, documentId: string, deviceId: string) {
  await m(p)(api.e2ee.migrate.beginDocument, {
    documentId,
    deviceId,
    noteKey: { documentId, version: 1, wrappedBy: "space", spaceVersion: sealer.spaceVersion, wrapped: await sealer.wrappedNoteKey(documentId) },
  });
  const rows = await allBlocks(p, documentId);
  for (let i = 0; i < rows.length; i += 200) {
    const batch = [];
    for (const r of rows.slice(i, i + 200)) {
      const sealedBlock = (await sealer.sealBlock(documentId, r.block)) as unknown as { sealed: { c: ArrayBuffer; mac: string; k: number; collapsed?: true; syncedSource?: string; mentions?: string[] } };
      const s = sealedBlock.sealed;
      batch.push({ blockId: r.block.id, revision: r.revision, sealed: { c: s.c, mac: s.mac, k: s.k, ...(s.collapsed ? { collapsed: true } : {}) }, ...(s.syncedSource ? { syncedSource: s.syncedSource } : {}), ...(s.mentions ? { mentionIds: s.mentions } : {}) });
    }
    await m(p)(api.e2ee.migrate.sealBlocks, { documentId, deviceId, blocks: batch });
  }
  const got = (await q(p)(api.documents.get, { documentId })) as { document: { title: string; icon: string | null; cover: unknown; style: unknown } };
  const d = got.document;
  const fileIds = await t.run(async (ctx) => {
    const doc = await ctx.db.query("documents").withIndex("by_public_id", (x) => x.eq("publicId", documentId)).unique();
    return (await ctx.db.query("files").withIndex("by_document", (x) => x.eq("documentId", doc!._id)).collect()).map((f) => f.publicId);
  });
  await m(p)(api.e2ee.migrate.sealDocumentFields, {
    documentId,
    deviceId,
    sealedTitle: { c: await sealer.sealField(documentId, "title", d.title), mac: await sealer.titleMac(documentId, d.title) },
    sealedAppearance: await sealer.sealField(documentId, "appearance", { icon: d.icon, cover: d.cover, style: d.style }),
    fileIds,
  });
  const extras = (await q(p)(api.e2ee.migrate.plainExtras, { documentId })) as {
    fileTexts: { blockId: string; text: string }[];
    collections: { id: string }[];
    comments: { commentId: string; body?: unknown }[];
  };
  const comments = [];
  for (const c of extras.comments) if (c.body !== undefined) comments.push({ commentId: c.commentId, sealedBody: await sealer.sealNoteRecord(documentId, aad.comment(documentId, c.commentId), canonicalJson(c.body)) });
  if (comments.length) await m(p)(api.e2ee.migrate.sealComments, { documentId, deviceId, comments });
  const records = [];
  for (const f of extras.fileTexts) records.push({ kind: "fileText", recordId: `ft:${f.blockId}`, sealed: await sealer.sealNoteRecord(documentId, aad.fileText(documentId, f.blockId), f), keyVersion: 1 });
  for (const c of extras.collections) records.push({ kind: "collection", recordId: c.id, sealed: await sealer.sealNoteRecord(documentId, aad.spaceRecord(sealer.space.scope, "collection", c.id), c), keyVersion: 1 });
  await m(p)(api.e2ee.migrate.finishDocument, { documentId, deviceId, records });
}

/** Unseals one note: begin, blocks, title and look, comments, then finish with its collections and found text. */
export async function unsealNote(p: Who, sealer: Sealer, documentId: string, deviceId: string, opened: { title: string }) {
  await m(p)(api.e2ee.migrate.beginDocument, { documentId, deviceId });
  const rows = await allBlocks(p, documentId);
  const blocks = [];
  for (const r of rows) blocks.push({ blockId: r.block.id, revision: r.revision, block: await sealer.openBlock(documentId, r.block) });
  for (let i = 0; i < blocks.length; i += 200) await m(p)(api.e2ee.migrate.unsealBlocks, { documentId, deviceId, blocks: blocks.slice(i, i + 200) });
  await m(p)(api.e2ee.migrate.unsealDocumentFields, { documentId, deviceId, title: opened.title, icon: null, cover: { kind: "none" }, style: { font: "serif", width: "wide", background: "paper", accent: "accent", card: "folio" } });
  const extras = (await q(p)(api.e2ee.migrate.plainExtras, { documentId })) as { comments: { commentId: string; sealedBody?: { c: ArrayBuffer } }[] };
  const comments = [];
  for (const c of extras.comments) if (c.sealedBody) comments.push({ commentId: c.commentId, body: JSON.parse(await sealer.openNoteRecord(documentId, aad.comment(documentId, c.commentId), c.sealedBody.c)) });
  if (comments.length) await m(p)(api.e2ee.migrate.unsealComments, { documentId, deviceId, comments });
  await m(p)(api.e2ee.migrate.finishUnseal, { documentId, deviceId, collections: [], fileTexts: [] });
}

/** Runs a whole seal job: every phase, as one device. */
export async function runSealJob(t: T, p: Who, sealer: Sealer, migrationId: string, deviceId: string, opts: { files?: boolean } = {}) {
  for (let round = 0; round < 50; round++) {
    const work = (await m(p)(api.e2ee.migrate.claim, { migrationId, deviceId })) as { busy: boolean; phase: string; documents: string[]; snapshots: { snapshotId: string; documentId: string }[]; files: { fileId: string; documentId: string }[] };
    if (work.busy) throw new Error("lease held elsewhere");
    if (work.phase === "done") return;
    if (work.phase === "documents") {
      for (const id of work.documents) await sealNote(t, p, sealer, id, deviceId);
      if (!work.documents.length) await m(p)(api.e2ee.migrate.finishPhase, { migrationId, phase: "documents" });
    } else if (work.phase === "history") {
      for (const x of work.snapshots) await sealSnapshot(p, sealer, x.snapshotId, x.documentId);
      if (!work.snapshots.length) await m(p)(api.e2ee.migrate.finishPhase, { migrationId, phase: "history" });
    } else if (work.phase === "files") {
      for (const x of work.files) if (opts.files !== false) await sealFile(t, p, sealer, x.fileId);
      if (!work.files.length) await m(p)(api.e2ee.migrate.finishPhase, { migrationId, phase: "files" });
    } else if (work.phase === "cleanup") {
      await m(p)(api.e2ee.migrate.finishPhase, { migrationId, phase: "cleanup" });
    }
  }
  throw new Error("the job didn't finish");
}

/** Seals one version from its plaintext content (snapshotContent) into a SealedVersionContent. */
export async function sealSnapshot(p: Who, sealer: Sealer, snapshotId: string, documentId: string) {
  const got = (await q(p)(api.documents.snapshotContent, { snapshotId })) as { content: string | null };
  const parsed = JSON.parse(got.content!) as { title: string; icon: string | null; style?: unknown; blocks: WireBlock[] };
  const b64 = (u: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(u))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const blocks = [];
  for (const b of parsed.blocks) {
    const s = (await sealer.sealBlock(documentId, b)) as unknown as { sealed: { c: ArrayBuffer; mac: string; k: number; collapsed?: true } };
    blocks.push({ id: b.id, parentId: b.parentId, rank: b.rank, c: b64(s.sealed.c), k: s.sealed.k, mac: s.sealed.mac, ...(s.sealed.collapsed ? { collapsed: true } : {}) });
  }
  const content = {
    e2ee: 1,
    title: { c: b64(await sealer.sealField(documentId, "title", parsed.title)), k: 1 },
    appearance: { c: b64(await sealer.sealField(documentId, "appearance", { icon: parsed.icon, style: parsed.style ?? null })), k: 1 },
    blocks,
  };
  await m(p)(api.e2ee.migrate.sealSnapshot, { snapshotId, content });
}

/** Seals one file's bytes: an upload intent, the ciphertext stored, then replaceBlob. */
export async function sealFile(t: T, p: Who, sealer: Sealer, fileId: string) {
  const { documentId, plain } = await t.run(async (ctx) => {
    const f = await ctx.db.query("files").withIndex("by_public_id", (x) => x.eq("publicId", fileId)).unique();
    const doc = await ctx.db.get(f!.documentId as Id<"documents">);
    const blob = await ctx.storage.get(f!.storageId);
    return { documentId: doc!.publicId, plain: new Uint8Array(await blob!.arrayBuffer()), kind: f!.kind };
  });
  const sealed = await sealer.sealFileBytes(documentId, fileId, plain, { name: "file.bin", mime: "application/octet-stream" });
  const { intentId } = (await m(p)(api.e2ee.files.generateUploadUrl, { documentId, kind: "file", declaredSize: sealed.bytes.byteLength })) as { intentId: string };
  const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([sealed.bytes])));
  await a(p)(api.e2ee.files.replaceBlob, { intentId, fileId, storageId, size: sealed.bytes.byteLength, sha256: sealed.sha256, sealed: sealed.row });
}
