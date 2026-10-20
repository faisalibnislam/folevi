// Writing a move into a library or an account (docs/LOCAL_MODE_PLAN.md §6): through the functions the app
// already uses there, so every check, limit and derived row the backend keeps applies as if the person had
// made the notes there. Folders keep their ids (createFolder takes the client's id), notes and blocks theirs
// (sync.push), collections, properties, views and rows theirs (collections.*), and each call is safe to send
// again.
//
// Notes and blocks go through `ops` (a `NoteWriter`): sync.push straight away by default, or the account's own
// SyncEngine (engineWriter), so a move into an account is sent, retried and kept on this device like any edit.
import { repairWireBlock, ulid, type OpResult, type SyncOp, type WireBlock, type WireDocumentCreate, type WireDocumentPatch, type WireScope } from "@folevi/editor-schema";
import { ConvexError } from "convex/values";
import { api } from "@/lib/convex/api";
import type { SyncEngine } from "@/lib/sync/engine";
import type { MigrationClient, MigrationTarget, SourceFile } from "./types";

const PERSONAL: WireScope = { kind: "personal" };
/** Ops per sync.push (the server takes up to 100). */
const BATCH = 100;

/** How notes and their blocks reach the target. */
export interface NoteWriter {
  createDocument(doc: WireDocumentCreate): Promise<"created" | "exists">;
  updateDocument(documentId: string, patch: WireDocumentPatch): Promise<void>;
  putBlocks(documentId: string, blocks: WireBlock[]): Promise<{ refused: { blockId: string; message: string }[] }>;
}

const upsert = (documentId: string, block: WireBlock): SyncOp => ({ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: null, fields: ["content", "position"] });

/** A block as the backend takes it: what it would refuse repaired (editor-schema repairWireBlock), words kept. */
const repaired = (b: WireBlock) => repairWireBlock(b).block;

function refusal(result: OpResult): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: result.error?.code ?? "rejected", message: result.error?.message ?? "The note couldn't be saved there." });
}

/** sync.push, a batch at a time. */
export function pushWriter(client: MigrationClient, deviceId: string, scope: WireScope = PERSONAL): NoteWriter {
  const push = async (ops: SyncOp[]) => (await client.mutation(api.sync.push, { scope, deviceId, ops: ops as never })) as OpResult[];
  return {
    async createDocument(doc) {
      const [r] = await push([{ opId: ulid(), kind: "document.create", document: doc }]);
      if (!r) throw new Error("The server didn't answer.");
      if (r.status === "applied" || r.status === "duplicate") return "created";
      if (r.status === "conflict" && r.conflict?.reason === "exists") return "exists";
      throw refusal(r);
    },
    async updateDocument(documentId, patch) {
      const [r] = await push([{ opId: ulid(), kind: "document.update", documentId, patch, baseRevision: null }]);
      if (r && r.status !== "applied" && r.status !== "duplicate") throw refusal(r);
    },
    async putBlocks(documentId, blocks) {
      const refused: { blockId: string; message: string }[] = [];
      for (let i = 0; i < blocks.length; i += BATCH) {
        const ops = blocks.slice(i, i + BATCH).map((b) => upsert(documentId, repaired(b)));
        const results = await push(ops);
        for (const [j, r] of results.entries()) {
          if (r.status === "applied" || r.status === "duplicate") continue;
          const blockId = (ops[j] as Extract<SyncOp, { kind: "block.upsert" }>).block.id;
          refused.push({ blockId, message: r.status === "conflict" ? "A different version of this block was already there." : (r.error?.message ?? "The block was refused.") });
        }
      }
      return { refused };
    },
  };
}

/** What engineWriter uses of the account's SyncEngine. */
export type EngineLike = Pick<SyncEngine, "batch" | "createDocument" | "updateDocument" | "upsertBlock" | "hasLocalWork" | "waitsToSync" | "subscribe" | "scheduleFlush" | "whenDocumentOnServer" | "state">;

/** Resolves once nothing the engine holds for the note is still on its way to the server. */
function settled(engine: EngineLike, documentId: string, timeoutMs: number): Promise<void> {
  const busy = () => engine.hasLocalWork(documentId) || engine.waitsToSync(documentId, null);
  if (!busy()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => done(new Error("The server hasn’t answered yet. The move goes on from here when you try again.")), timeoutMs);
    const unsubscribe = engine.subscribe((e) => {
      if (e.type === "state" && !busy()) done();
    });
    engine.scheduleFlush(0);
  });
}

/**
 * Notes and blocks through the account's SyncEngine (plan §6.1 step 3): queued, kept on this device and sent
 * like any edit, then checked against the server's copy (blocks.list), so what it refused is reported.
 * A Daily Note goes through sync.push itself, where "there's one for that date already" can be told apart.
 */
export function engineWriter(engine: EngineLike, client: MigrationClient, deviceId: string, timeoutMs = 120_000): NoteWriter {
  const direct = pushWriter(client, deviceId);
  return {
    async createDocument(doc) {
      if (doc.kind === "daily") return await direct.createDocument(doc);
      // The engine gives a note without an icon a random one; null is kept by sending it straight.
      if (!doc.icon) return await direct.createDocument(doc);
      engine.createDocument(doc);
      await engine.whenDocumentOnServer(doc.id, timeoutMs);
      return "created";
    },
    async updateDocument(documentId, patch) {
      engine.updateDocument(documentId, patch, null);
      await settled(engine, documentId, timeoutMs);
    },
    async putBlocks(documentId, blocks) {
      const errorsBefore = engine.state.errors.length;
      engine.batch(() => {
        for (const b of blocks) engine.upsertBlock(documentId, b, ["content", "position"], null);
      });
      await settled(engine, documentId, timeoutMs);
      const there = await client.query(api.blocks.list, { documentId });
      const ids = new Set((there?.blocks ?? []).map((b) => b.id));
      const errors = engine.state.errors.slice(errorsBefore);
      const why = errors.length ? (errors[errors.length - 1]!.message ?? errors[errors.length - 1]!.code) : "The server didn’t keep this block.";
      return { refused: blocks.filter((b) => !ids.has(b.id)).map((b) => ({ blockId: b.id, message: why })) };
    },
  };
}

export interface ClientTargetOptions {
  deviceId: string;
  scope?: WireScope;
  /** Stores an attachment for the note there: an upload (accountUpload), or the library's putFile. */
  putFile: (file: SourceFile, documentId: string) => Promise<string>;
  /** How notes and blocks go (default: sync.push straight away). */
  notes?: NoteWriter;
}

export function clientTarget(client: MigrationClient, opts: ClientTargetOptions): MigrationTarget {
  const scope = opts.scope ?? PERSONAL;
  const notes = opts.notes ?? pushWriter(client, opts.deviceId, scope);
  return {
    async profileId() {
      const me = await client.query(api.users.me, {});
      if (me.state !== "ready") throw new Error("Sign in again to go on.");
      return me.profile.id;
    },
    async inbox() {
      return await client.mutation(api.tasks.inbox, { scope, deviceId: opts.deviceId });
    },
    async createFolder(f) {
      await client.mutation(api.organization.createFolder, { scope, id: f.id, name: f.name, ...(f.parentFolderId ? { parentFolderId: f.parentFolderId } : {}) });
      if (f.color) await client.mutation(api.organization.setFolderColor, { folderId: f.id, color: f.color }).catch(() => undefined);
    },
    async ensureTag(t) {
      return (await client.mutation(api.organization.createTag, { scope, name: t.name, color: t.color })).id;
    },
    createDocument: (doc) => notes.createDocument(doc),
    updateDocument: (id, patch) => notes.updateDocument(id, patch),
    putBlocks: (id, blocks) => notes.putBlocks(id, blocks),
    async setStarred(documentId, starred) {
      await client.mutation(api.documents.setStarred, { documentId, starred });
    },
    async setArchived(documentId, archived) {
      await client.mutation(api.documents.setArchived, { documentId, archived });
    },
    async setTags(documentId, tagIds) {
      await client.mutation(api.organization.setDocumentTags, { documentId, tagIds });
    },
    async moveToTrash(documentId) {
      await client.mutation(api.documents.moveToTrash, { documentId });
    },
    async putCollection(c) {
      await client.mutation(api.collections.create, { documentId: c.hostDocumentId, id: c.id, name: c.name });
      const now = await client.query(api.collections.get, { collectionId: c.id });
      if (!now) throw new Error("The collection couldn't be made there.");
      if (now.name !== c.name) await client.mutation(api.collections.rename, { collectionId: c.id, name: c.name });
      const have = new Set(now.properties.map((p) => p.id));
      // Properties in their order: plain ones first, so a formula finds the properties it names.
      const plain = c.properties.filter((p) => p.type !== "formula");
      const formulas = c.properties.filter((p) => p.type === "formula");
      for (const p of [...plain, ...formulas]) {
        if (have.has(p.id)) continue;
        await client.mutation(api.collections.addProperty, {
          collectionId: c.id,
          id: p.id,
          name: p.name,
          type: p.type as never,
          ...(p.type === "formula" ? { formula: "" } : {}),
          ...(p.numberFormat && (p.type === "number" || p.type === "formula") ? { numberFormat: p.numberFormat as never } : {}),
        });
      }
      for (const p of c.properties) {
        const patch: Record<string, unknown> = {};
        if ((p.type === "select" || p.type === "multiSelect") && p.options.length) patch.options = p.options;
        if (p.type === "formula" && p.formula) patch.formula = p.formula;
        if (Object.keys(patch).length) await client.mutation(api.collections.updateProperty, { collectionId: c.id, propertyId: p.id, ...patch } as never);
      }
      // The ones made with it that the source doesn't have (a new collection's Status and Date) go.
      const wanted = new Set(c.properties.map((p) => p.id));
      for (const p of now.properties) if (!wanted.has(p.id)) await client.mutation(api.collections.deleteProperty, { collectionId: c.id, propertyId: p.id });
      const views = new Set(now.views.map((vw) => vw.id));
      for (const vw of c.views) {
        if (!views.has(vw.id)) await client.mutation(api.collections.addViewToCollection, { collectionId: c.id, id: vw.id, name: vw.name, type: vw.type as never });
        await client.mutation(api.collections.updateView, { collectionId: c.id, viewId: vw.id, name: vw.name, config: vw.config as never });
      }
      const wantedViews = new Set(c.views.map((vw) => vw.id));
      if (wantedViews.size) for (const vw of now.views) if (!wantedViews.has(vw.id)) await client.mutation(api.collections.deleteView, { collectionId: c.id, viewId: vw.id }).catch(() => undefined);
    },
    async addRow(collectionId, row) {
      await client.mutation(api.collections.addRow, { collectionId, id: row.id, documentId: row.documentId, title: row.title, values: row.values });
    },
    putFile: opts.putFile,
    async saveFileText(documentId, t) {
      await client.mutation(api.fileText.save, {
        documentId,
        blockId: t.blockId,
        ...(t.fileId ? { fileId: t.fileId } : {}),
        source: t.source,
        text: t.text,
        ...(t.pageStarts?.length ? { pageStarts: t.pageStarts } : {}),
        ...(t.source === "handwriting" ? { hash: t.hash } : {}),
      });
    },
    async importVersion(documentId, v) {
      await client.mutation(api.documents.importSnapshot, {
        documentId,
        id: v.id,
        title: v.title,
        icon: v.icon,
        ...(v.style ? { style: v.style } : {}),
        blocks: v.blocks.map(({ revision: _revision, ...b }) => b),
        createdAt: v.createdAt,
        ...(v.name ? { name: v.name } : {}),
      });
    },
  };
}

/** The upload kind an attachment goes up as (files.generateUploadUrl). */
export function uploadKind(kind: SourceFile["kind"]): "image" | "file" | "audio" | "cover" {
  return kind;
}

/**
 * An attachment into an account, the way the app's uploader sends one (lib/sync/uploads.ts uploadFileNow):
 * an upload address, the bytes, then finalize, which checks them. `sendBytes` is the POST (tests store the
 * bytes another way).
 */
export function accountUpload(
  client: MigrationClient,
  sendBytes: (uploadUrl: string, blob: Blob, mimeType: string) => Promise<string> = postBytes,
  sha256: (blob: Blob) => Promise<string> = sha256Hex,
): ClientTargetOptions["putFile"] {
  return async (file, documentId) => {
    const { uploadUrl, intentId } = await client.mutation(api.files.generateUploadUrl, { documentId, filename: file.name, size: file.blob.size, mimeType: file.mimeType, kind: uploadKind(file.kind) });
    const storageId = await sendBytes(uploadUrl, file.blob, file.mimeType);
    const result = await client.action(api.files.finalize, { intentId, storageId: storageId as never, sha256: file.sha256 ?? (await sha256(file.blob)) });
    return result.fileId;
  };
}

async function postBytes(uploadUrl: string, blob: Blob, mimeType: string): Promise<string> {
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mimeType }, body: blob });
  if (!res.ok) throw new Error(`The upload failed (${res.status}).`);
  return ((await res.json()) as { storageId: string }).storageId;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** An attachment into a library (the LocalClient's putFile, with the server's checks). */
export function libraryPutFile(local: { putFile(blob: Blob, meta: { name: string; mimeType: string; kind: string; documentId?: string | null }): Promise<{ fileId: string }> }): ClientTargetOptions["putFile"] {
  return async (file, documentId) => (await local.putFile(file.blob, { name: file.name, mimeType: file.mimeType, kind: file.kind, documentId })).fileId;
}
