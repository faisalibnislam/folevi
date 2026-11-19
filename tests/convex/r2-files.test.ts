// Files on R2, first stage (convex/r2Files.ts): a stored blob is copied to R2 once and recorded after R2
// confirms its size; the /files/ route then redirects to a short-lived R2 link (after its access check and
// the fair-use count); when the Convex blob goes, the sweep deletes the R2 copy. Without R2 settings
// nothing changes.
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signFileUrl } from "../../convex/lib/fileUrls";
import { person, setup, ulid, type T } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function withR2() {
  vi.stubEnv("R2_ACCOUNT_ID", "acct");
  vi.stubEnv("R2_ACCESS_KEY_ID", "key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "folevi-test");
  // A fake R2: objects by path; every request must be signed.
  const objects = new Map<string, Uint8Array>();
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname });
    expect(url.host).toBe("acct.r2.cloudflarestorage.com");
    expect(String((init?.headers as Record<string, string>)?.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=key\//);
    if (method === "PUT") {
      objects.set(url.pathname, new Uint8Array(init!.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    if (method === "HEAD") {
      const o = objects.get(url.pathname);
      return o ? new Response(null, { status: 200, headers: { "content-length": String(o.length) } }) : new Response(null, { status: 404 });
    }
    if (method === "DELETE") {
      objects.delete(url.pathname);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 400 });
  });
  return { objects, calls };
}

async function storedFile(t: T, content: string) {
  await person(t, "r2@example.com");
  const publicId = ulid();
  const storageId = await t.run(async (ctx) => {
    const profile = (await ctx.db.query("profiles").first())!;
    const storageId = await ctx.storage.store(new Blob([content], { type: "application/pdf" }));
    await ctx.db.insert("files", { publicId, storageId, ownerProfileId: profile._id, uploadedBy: profile._id, filename: "Plan.pdf", mimeType: "application/pdf", size: content.length, sha256: "x", kind: "file", status: "ready", createdAt: Date.now() });
    return storageId;
  });
  return { publicId, storageId };
}

async function link(fileId: string) {
  const exp = Date.now() + 60_000;
  return `/files/${fileId}?exp=${exp}&sig=${await signFileUrl(`${fileId}:${exp}`)}`;
}

describe("files on R2", () => {
  test("without R2 settings the route serves the bytes from Convex, as before", async () => {
    const t = setup();
    const { publicId } = await storedFile(t, "%PDF-1.4 hello");
    const res = await t.fetch(await link(publicId));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-1.4 hello");
    expect(await t.run(async (ctx) => ctx.db.query("r2Blobs").collect())).toHaveLength(0);
  });

  test("copied and verified once, then downloads redirect to a signed R2 link", async () => {
    const t = setup();
    const r2 = withR2();
    const { publicId, storageId } = await storedFile(t, "%PDF-1.4 hello");
    // Not copied yet: still served by Convex.
    expect((await t.fetch(await link(publicId))).status).toBe(200);
    expect(await t.action(internal.r2Files.copy, { storageId })).toEqual({ copied: true });
    expect(await t.action(internal.r2Files.copy, { storageId })).toEqual({ copied: false });
    expect(r2.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(r2.objects.get(`/folevi-test/blobs/${storageId}`)?.length).toBe(14);

    const res = await t.fetch(await link(publicId));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.host).toBe("acct.r2.cloudflarestorage.com");
    expect(location.pathname).toBe(`/folevi-test/blobs/${storageId}`);
    expect(location.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(location.searchParams.get("response-content-disposition")).toMatch(/^inline; filename="Plan.pdf"/);
    expect(Number(location.searchParams.get("X-Amz-Expires"))).toBe(300);
    // The redirect still counts toward the fair-use allowance.
    const used = await t.run(async (ctx) => (await ctx.db.query("downloadUsage").collect()).reduce((n, r) => n + r.bytes, 0));
    expect(used).toBe(14 * 2);
  });

  test("a bad link is refused before anything is looked up", async () => {
    const t = setup();
    withR2();
    const { publicId } = await storedFile(t, "%PDF-1.4 hello");
    expect((await t.fetch(`/files/${publicId}?exp=${Date.now() + 60_000}&sig=nope`)).status).toBe(404);
  });

  test("the sweep deletes the R2 copy once the Convex blob is gone", async () => {
    const t = setup();
    const r2 = withR2();
    const { storageId } = await storedFile(t, "%PDF-1.4 hello");
    await t.action(internal.r2Files.copy, { storageId });
    expect(await t.action(internal.r2Files.sweep, {})).toEqual({ deleted: 0 });
    await t.run(async (ctx) => ctx.storage.delete(storageId as Id<"_storage">));
    expect(await t.action(internal.r2Files.sweep, {})).toEqual({ deleted: 1 });
    expect(r2.objects.size).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.query("r2Blobs").collect())).toHaveLength(0);
  });

  test("the backfill schedules one copy per blob not yet copied", async () => {
    const t = setup();
    withR2();
    await storedFile(t, "%PDF-1.4 one");
    expect(await t.mutation(internal.r2Files.backfill, {})).toEqual({ scheduled: 1, done: true });
  });
});
