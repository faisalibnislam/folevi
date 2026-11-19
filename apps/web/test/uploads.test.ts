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
import { completedUploadFor, enqueueUpload, imageFileSize, localPreviewUrl, onUploadAbandoned, PREVIEW_RELEASE_MS, retryUploads, Uploader } from "@/lib/sync/uploads";

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

// The editor audit's upload findings (M15, M19, M3, M7, M1): an interrupted upload goes again as soon as it can,
// a preview is let go even when no view is left to do it, a finished upload can be found again by its block,
// a picture's size is read before it's uploaded, and a file let go for good is offered back first.
describe("an interrupted upload doesn't sit out its wait when it could go", () => {
  /** An upload that failed a few times: its next try is minutes away. */
  async function waiting(account: string, block: string) {
    const made = await setUp(account);
    made.engine.setOnline(true);
    made.server.pages.add("doc-there");
    const uploadId = await enqueueUpload(account, made.engine, { documentId: "doc-there", blockId: block, file: file("jpg", "photo.jpg", "image/jpeg"), kind: "image" });
    const db = await localDb(account);
    // (The uploader's first pass of a session tries everything: that one is spent here.)
    await db.put("uploads", { ...(await db.get("uploads", uploadId))!, attempts: 4, nextAttemptAt: Date.now() + 9 * 60_000 });
    (made.uploader as unknown as { eager: boolean }).eager = false;
    return { ...made, uploadId, db };
  }

  test("an ordinary pass leaves it waiting", async () => {
    const { server, uploader, uploadId, db } = await waiting("acct-upload-4", "img-4");
    await pass(uploader);
    expect(server.asked).toEqual([]);
    expect(await db.get("uploads", uploadId)).toBeDefined();
    uploader.stop();
  });

  test("the connection coming back tries it at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { server, uploader, uploadId, db } = await waiting("acct-upload-5", "img-5");
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(async () => expect(await db.get("uploads", uploadId)).toBeUndefined());
      expect(server.asked).toEqual(["doc-there"]);
      uploader.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  test("so does Retry now (retryUploads), and a new session's first pass", async () => {
    const { server, uploader, uploadId, db } = await waiting("acct-upload-6", "img-6");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      retryUploads();
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(async () => expect(await db.get("uploads", uploadId)).toBeUndefined());
    } finally {
      vi.useRealTimers();
    }
    expect(server.asked).toEqual(["doc-there"]);
    uploader.stop();

    // Opened again (a new uploader): what waited goes on its first pass.
    const again = await waiting("acct-upload-7", "img-7");
    const fresh = new Uploader(again.server.client, "acct-upload-7", again.engine, () => undefined);
    await pass(fresh);
    expect(again.server.asked).toEqual(["doc-there"]);
    fresh.stop();
    again.uploader.stop();
  });

  test("a stopped uploader no longer hears the connection or Retry now", async () => {
    const { server, uploader } = await waiting("acct-upload-8", "img-8");
    uploader.stop();
    retryUploads();
    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 5));
    expect(server.asked).toEqual([]);
  });

  test("small files go before large ones", async () => {
    const { server, engine, uploader } = await setUp("acct-upload-9");
    engine.setOnline(true);
    server.pages.add("doc-a");
    server.pages.add("doc-b");
    await enqueueUpload("acct-upload-9", engine, { documentId: "doc-a", blockId: "big", file: file("x".repeat(5000), "talk.m4a", "audio/mp4"), kind: "audio" });
    await enqueueUpload("acct-upload-9", engine, { documentId: "doc-b", blockId: "small", file: file("x", "photo.jpg", "image/jpeg"), kind: "image" });
    await pass(uploader);
    expect(server.asked).toEqual(["doc-b", "doc-a"]);
    uploader.stop();
  });
});

describe("what a finished or abandoned upload leaves behind", () => {
  test("its preview is let go even when no view is there to do it, and its file can be found by its block", async () => {
    const made = vi.fn(() => "blob:preview-1");
    const revoked = vi.fn();
    Object.assign(URL, { createObjectURL: made, revokeObjectURL: revoked });
    const { server, engine, uploader } = await setUp("acct-upload-10");
    engine.setOnline(true);
    server.pages.add("doc-there");
    const uploadId = await enqueueUpload("acct-upload-10", engine, { documentId: "doc-there", blockId: "img-10", file: file("png", "a.png", "image/png"), kind: "image" });
    expect(await localPreviewUrl("acct-upload-10", uploadId)).toBe("blob:preview-1");
    expect(completedUploadFor("doc-there", "img-10")).toBeNull();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await pass(uploader);
      expect(revoked).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(PREVIEW_RELEASE_MS + 1);
    } finally {
      vi.useRealTimers();
    }
    expect(revoked).toHaveBeenCalledWith("blob:preview-1");
    // Nothing is kept for it any more: no saved copy, no address.
    expect(await localPreviewUrl("acct-upload-10", uploadId)).toBeNull();
    // The block it was for (taken out by an undo meanwhile, say) can still be given its file.
    expect(completedUploadFor("doc-there", "img-10")).toBe("file-1");
    expect(completedUploadFor("another-doc", "img-10")).toBeNull();
    uploader.stop();
  });

  test("a file let go for good is offered back, with its bytes, before its saved copy is deleted", async () => {
    const { server, engine, uploader, errors } = await setUp("acct-upload-11");
    engine.setOnline(true);
    server.pages.add("doc-there");
    await enqueueUpload("acct-upload-11", engine, { documentId: "doc-there", blockId: "rec-11", file: file("sound", "Recording.m4a", "audio/mp4"), kind: "audio" });
    const offered: { filename: string; size: number; kind: string }[] = [];
    const stop = onUploadAbandoned((f) => offered.push({ filename: f.filename, size: f.blob.size, kind: f.kind }));
    server.failWith(new ConvexError({ code: "quota_exceeded", message: "Your storage is full." }));
    await pass(uploader);
    stop();
    expect(offered).toEqual([{ filename: "Recording.m4a", size: 5, kind: "audio" }]);
    expect(errors).toEqual(["Your storage is full."]);
    uploader.stop();
  });
});

describe("a picture's size, read before it's uploaded", () => {
  test("from the decoded bitmap", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close })));
    expect(await imageFileSize(new Blob(["x"]))).toEqual({ width: 4000, height: 3000 });
    expect(close).toHaveBeenCalled();
  });

  test("null for bytes that aren't a picture", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("not an image"))));
    vi.stubGlobal(
      "Image",
      class {
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    expect(await imageFileSize(new Blob(["x"]))).toBeNull();
  });
});
