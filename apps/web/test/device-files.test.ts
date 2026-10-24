// Attachments of the device copy (lib/sync/deviceFiles.ts, docs/NATIVE_APP_PLAN.md §11.5): small files always,
// large ones only on Wi-Fi and within the budget (least recently used go first), sealed ones never.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { localDb, copyFileKeys } from "@/lib/sync/db";
import { DeviceFiles, evictionOrder, fileIdsOf, keptFileUrl, largeDownloadsAllowed, planDownload, SMALL_FILE, type KeptFile } from "@/lib/sync/deviceFiles";

/** Cache Storage in memory (jsdom has none). */
function fakeCaches() {
  const all = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    let c = all.get(name);
    if (!c) all.set(name, (c = new Map()));
    const store = c;
    return {
      put: async (k: string, r: Response) => void store.set(k, r),
      match: async (k: string) => store.get(k)?.clone(),
      delete: async (k: string) => store.delete(k),
    };
  };
  return { all, api: { open, delete: async (name: string) => all.delete(name), keys: async () => [...all.keys()] } };
}

let caches: ReturnType<typeof fakeCaches>;
beforeEach(() => {
  caches = fakeCaches();
  (globalThis as { caches?: unknown }).caches = caches.api;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => `blob:kept-${Math.random()}`;
});
afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
});

const MB = 1024 * 1024;
const image = (id: string, fileId: string): WireBlock => ({ id, type: "image", parentId: null, rank: id, schemaVersion: 1, text: [], props: { fileId } });

describe("which attachments come", () => {
  test("small always, large only when allowed and within the limits, sealed never", () => {
    expect(planDownload({ size: 200_000, mimeType: "image/png" }, false)).toBe("small");
    expect(planDownload({ size: 5 * MB, mimeType: "image/jpeg" }, false)).toBe("skip");
    expect(planDownload({ size: 5 * MB, mimeType: "image/jpeg" }, true)).toBe("large");
    expect(planDownload({ size: 12 * MB, mimeType: "image/jpeg" }, true)).toBe("skip");
    expect(planDownload({ size: 20 * MB, mimeType: "application/pdf" }, true)).toBe("large");
    expect(planDownload({ size: 30 * MB, mimeType: "application/pdf" }, true)).toBe("skip");
    expect(planDownload({ size: 10, mimeType: "image/png", sealed: { k: 1 } }, true)).toBe("skip");
  });

  test("large downloads: Wi-Fi or wired yes, cellular and Data Saver no, phones without a connection type no", () => {
    expect(largeDownloadsAllowed({ connection: { type: "wifi" } })).toBe(true);
    expect(largeDownloadsAllowed({ connection: { type: "cellular" } })).toBe(false);
    expect(largeDownloadsAllowed({ connection: { type: "wifi", saveData: true } })).toBe(false);
    expect(largeDownloadsAllowed({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140" })).toBe(true);
    expect(largeDownloadsAllowed({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Mobile/15E148 FoleviiOS/1.0" })).toBe(false);
  });

  test("eviction takes the least recently used large files until the rest fit", () => {
    const files: Pick<KeptFile, "fileId" | "size" | "kind" | "usedAt">[] = [
      { fileId: "old", size: 6 * MB, kind: "large", usedAt: 1 },
      { fileId: "mid", size: 6 * MB, kind: "large", usedAt: 2 },
      { fileId: "new", size: 6 * MB, kind: "large", usedAt: 3 },
      { fileId: "small", size: SMALL_FILE, kind: "small", usedAt: 0 },
    ];
    expect(evictionOrder(files, 13 * MB)).toEqual(["old"]);
    expect(evictionOrder(files, 6 * MB)).toEqual(["old", "mid"]);
    expect(evictionOrder(files, 100 * MB)).toEqual([]);
  });

  test("a note's attachments are its blocks' file ids", () => {
    expect(fileIdsOf([image("a", "FILE_one_123"), image("b", "FILE_one_123"), { ...image("c", "x"), props: {} }])).toEqual(["FILE_one_123"]);
  });
});

describe("downloading", () => {
  async function setup(large: boolean, budget = 1024 * MB) {
    const accountKey = `files-acct-${Math.random().toString(36).slice(2)}`;
    const db = await localDb(accountKey);
    await db.put("blocks", { documentId: "DOC", blocks: [image("a", "FILE_small_1"), image("b", "FILE_large_1"), image("c", "FILE_large_2"), image("d", "FILE_sealed_1")], cachedAt: 1, head: 1, by: "copy" });
    const info: Record<string, { url: string; mimeType: string; filename: string; size: number; width: null; height: null; sealed?: unknown }> = {
      FILE_small_1: { url: "https://x/small", mimeType: "image/png", filename: "s.png", size: 100_000, width: null, height: null },
      FILE_large_1: { url: "https://x/l1", mimeType: "application/pdf", filename: "l1.pdf", size: 5 * MB, width: null, height: null },
      FILE_large_2: { url: "https://x/l2", mimeType: "application/pdf", filename: "l2.pdf", size: 5 * MB, width: null, height: null },
      FILE_sealed_1: { url: "https://x/sealed", mimeType: "image/png", filename: "", size: 10, width: null, height: null, sealed: { k: 1 } },
    };
    const fetched: string[] = [];
    let now = 1000;
    const files = new DeviceFiles({
      accountKey,
      client: {
        query: async (ref: FunctionReference<"query">, args: Record<string, unknown>) => {
          expect(getFunctionName(ref)).toBe(getFunctionName(api.files.urls));
          return Object.fromEntries((args.fileIds as string[]).map((id) => [id, info[id]]));
        },
      },
      largeAllowed: () => large,
      budget: async () => budget,
      fetchFile: async (url) => {
        fetched.push(url);
        return new Blob(["bytes of " + url]);
      },
      now: () => ++now,
    });
    return { accountKey, files, fetched };
  }

  test("on cellular only the small one comes; the sealed one never", async () => {
    const { accountKey, files, fetched } = await setup(false);
    await files.queue(["DOC"]);
    await files.run();
    expect(fetched).toEqual(["https://x/small"]);
    expect(await keptFileUrl(accountKey, "FILE_small_1")).toMatchObject({ filename: "s.png", mimeType: "image/png" });
    expect(await keptFileUrl(accountKey, "FILE_large_1")).toBeNull();
  });

  test("on Wi-Fi the large ones come too, within the budget (the least recently used goes)", async () => {
    const { accountKey, files, fetched } = await setup(true, 6 * MB);
    await files.queue(["DOC"]);
    await files.run();
    expect(fetched.sort()).toEqual(["https://x/l1", "https://x/l2", "https://x/small"]);
    const kept = ((await (await localDb(accountKey)).getAll("meta", copyFileKeys())) as KeptFile[]).map((f) => f.fileId).sort();
    expect(kept).toEqual(["FILE_large_2", "FILE_small_1"]);
    await files.clear();
    expect(await (await localDb(accountKey)).getAll("meta", copyFileKeys())).toEqual([]);
    expect(await keptFileUrl(accountKey, "FILE_small_1")).toBeNull();
  });
});
