// The upload queue (lib/sync/uploads.ts) and pages made on this device: a file for a page the server doesn't
// have yet (made offline, a share the iOS app kept, a scan into a new note) waits for the page's create
// instead of asking for an upload address the server would refuse ("Document not found"), and a file is
// never let go for a failure that can pass.
import { File } from "node:buffer";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import type { SyncOp, WireScope } from "@folevi/editor-schema";
import { SyncEngine } from "@/lib/sync/engine";
import { localDb } from "@/lib/sync/db";
import { enqueueUpload, Uploader } from "@/lib/sync/uploads";

const PERSONAL: WireScope = { kind: "personal" };
/** Node's File (jsdom's doesn't survive fake-indexeddb's structured clone; a browser's does). */
const file = (bits: string, name: string, type: string) => new File([bits], name, { type }) as unknown as globalThis.File;

/** A stand-in server: sync pushes, upload addresses (only for pages it has), uploads and finalize. */
function fakeServer() {
  const pages = new Set<string>();
  const asked: string[] = [];
  let failNext: unknown = null;
  const client = {
    mutation: vi.fn(async (_fn: unknown, args: { ops?: SyncOp[]; documentId?: string }) => {
      if (args.ops) {
        return args.ops.map((o) => {
          if (o.kind === "document.create") pages.add(o.document.id);
          return { opId: o.opId, status: "applied", revision: 1, ...(o.kind === "block.upsert" ? { block: { ...o.block, revision: 1 } } : {}) };
        });
      }
      asked.push(args.documentId ?? "");
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      if (!args.documentId || !pages.has(args.documentId)) throw new ConvexError({ code: "not_found", message: "Document not found." });
      return { uploadUrl: "https://upload.test/u", intentId: `intent-${asked.length}` };
    }),
    action: vi.fn(async () => ({ fileId: "file-1" })),
  } as unknown as ConvexReactClient;
  return { client, pages, asked, failWith: (e: unknown) => (failNext = e) };
}

const image = (id: string) => ({ id, type: "image", parentId: null, rank: "V", schemaVersion: 1, text: [], props: { uploadId: null } });

async function setUp(account: string) {
  const server = fakeServer();
  const engine = await SyncEngine.open(server.client, account, PERSONAL, `${account}-device`);
  const errors: string[] = [];
  const uploader = new Uploader(server.client, account, engine, (m) => errors.push(m));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ storageId: "storage-1" }), { status: 200 })));
  return { server, engine, uploader, errors };
}

/** Runs the uploader once and waits for it (kick is a timer). */
async function pass(uploader: Uploader) {
  await (uploader as unknown as { run(): Promise<void> }).run();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploads for pages made on this device", () => {
  test("a file in a page made offline waits for the page, then uploads, without a failed try", async () => {
    const { server, engine, uploader, errors } = await setUp("acct-upload-1");
    engine.setOnline(false);
    engine.createDocument({ id: "doc-offline", parentDocumentId: null, folderId: null, kind: "document", title: "Receipt", icon: null });
    const uploadId = await enqueueUpload("acct-upload-1", engine, { documentId: "doc-offline", blockId: "img-1", file: file("png", "receipt.png", "image/png"), kind: "image" });
    engine.upsertBlock("doc-offline", image("img-1"), ["content", "position"]);

    // Online again, but the page's create hasn't gone yet: no upload address is asked for.
    await pass(uploader);
    expect(server.asked).toEqual([]);
    const db = await localDb("acct-upload-1");
    expect((await db.get("uploads", uploadId))?.attempts).toBe(0);

    // The page reaches the server; the file goes, and the image block with it.
    engine.setOnline(true);
    await engine.flush();
    expect(server.pages.has("doc-offline")).toBe(true);
    await pass(uploader);
    expect(server.asked).toEqual(["doc-offline"]);
    expect(await db.get("uploads", uploadId)).toBeUndefined();
    expect(engine.state.uploads.find((u) => u.uploadId === uploadId)?.state ?? "done").toBe("done");
    await engine.flush();
    expect(engine.documentBlocks("doc-offline").map((b) => b.id)).toContain("img-1");
    expect(errors).toEqual([]);
    uploader.stop();
  });

  test("a failure that can pass (the network, the server having a moment) never lets the file go", async () => {
    const { server, engine, uploader, errors } = await setUp("acct-upload-2");
    engine.setOnline(true);
    const uploadId = await enqueueUpload("acct-upload-2", engine, { documentId: "doc-there", blockId: "img-2", file: file("jpg", "scan.jpg", "image/jpeg"), kind: "image" });
    server.pages.add("doc-there");
    const db = await localDb("acct-upload-2");
    const record = (await db.get("uploads", uploadId))!;
    // Its ninth try, and the server is down.
    await db.put("uploads", { ...record, attempts: 8 });
    server.failWith(new Error("fetch failed"));
    await pass(uploader);
    expect((await db.get("uploads", uploadId))?.attempts).toBe(9);
    expect(errors).toEqual([]);
    expect(engine.state.uploads.some((u) => u.uploadId === uploadId)).toBe(true);
    uploader.stop();
  });

  test("a page that's gone (not found again and again once it's on the server) lets the file go, saying so", async () => {
    const { server, engine, uploader, errors } = await setUp("acct-upload-3");
    engine.setOnline(true);
    const uploadId = await enqueueUpload("acct-upload-3", engine, { documentId: "doc-deleted", blockId: "img-3", file: file("gif", "a.gif", "image/gif"), kind: "image" });
    const db = await localDb("acct-upload-3");
    await db.put("uploads", { ...(await db.get("uploads", uploadId))!, attempts: 7 });
    await pass(uploader);
    expect(server.asked).toEqual(["doc-deleted"]);
    expect(await db.get("uploads", uploadId)).toBeUndefined();
    expect(errors).toEqual(["Document not found."]);
    uploader.stop();
  });
});
