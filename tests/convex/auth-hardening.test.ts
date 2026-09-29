// Auth hardening: the signed client IP that keys Better Auth's rate limits, and page-scoped uploads.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, clientIpSignature, verifiedClientIp, withTrustedClientIp } from "../../convex/lib/clientIp";
import { inWorkspace, person, PERSONAL, setup, ulid } from "./helpers";

const SECRET = "test-server-secret";

async function signedHeaders(ip: string, ts = Date.now(), secret = SECRET) {
  return new Headers({ [CLIENT_IP_HEADER]: ip, [CLIENT_IP_SIGNATURE_HEADER]: `${ts}.${await clientIpSignature(secret, ip, ts)}` });
}

describe("trusted client IP", () => {
  test("accepts an IP signed by the web server", async () => {
    expect(await verifiedClientIp(await signedHeaders("203.0.113.7"), SECRET)).toBe("203.0.113.7");
    expect(await verifiedClientIp(await signedHeaders("2001:db8::1"), SECRET)).toBe("2001:db8::1");
  });

  test("rejects unsigned, forged, stale or malformed values", async () => {
    expect(await verifiedClientIp(new Headers({ [CLIENT_IP_HEADER]: "203.0.113.7" }), SECRET)).toBeNull();
    expect(await verifiedClientIp(await signedHeaders("203.0.113.7", Date.now(), "other-secret"), SECRET)).toBeNull();
    expect(await verifiedClientIp(await signedHeaders("203.0.113.7", Date.now() - 5 * 60_000), SECRET)).toBeNull();
    const swapped = await signedHeaders("203.0.113.7");
    swapped.set(CLIENT_IP_HEADER, "198.51.100.1");
    expect(await verifiedClientIp(swapped, SECRET)).toBeNull();
    expect(await verifiedClientIp(await signedHeaders("not-an-ip<script>"), SECRET)).toBeNull();
    expect(await verifiedClientIp(await signedHeaders("203.0.113.7"), undefined)).toBeNull();
  });

  test("strips every caller-supplied forwarded IP before Better Auth sees the request", async () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4", [CLIENT_IP_HEADER]: "1.2.3.4" });
    const direct = await withTrustedClientIp(new Request("https://example.convex.site/api/auth/sign-in/email", { method: "POST", headers }), SECRET);
    expect(direct.headers.get("x-forwarded-for")).toBeNull();
    expect(direct.headers.get("x-real-ip")).toBeNull();
    expect(direct.headers.get(CLIENT_IP_HEADER)).toBeNull();

    const signed = await signedHeaders("203.0.113.7");
    signed.set("x-forwarded-for", "1.2.3.4");
    const proxied = await withTrustedClientIp(new Request("https://example.convex.site/api/auth/sign-in/email", { method: "POST", headers: signed }), SECRET);
    expect(proxied.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
    expect(proxied.headers.get(CLIENT_IP_SIGNATURE_HEADER)).toBeNull();
    expect(proxied.headers.get("x-forwarded-for")).toBeNull();
  });
});

describe("uploads into shared pages", () => {
  async function createDoc(p: Awaited<ReturnType<typeof person>>, title: string) {
    const id = ulid();
    await p.as.mutation(api.sync.push, {
      scope: p.scope,
      deviceId: "device-upload",
      ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } as never }],
    });
    return id;
  }
  const upload = { filename: "photo.png", size: 1024, mimeType: "image/png", kind: "image" as const };

  test("someone with edit access to a page can upload into it; a commenter or stranger can't", async () => {
    const t = setup();
    const owner = await person(t, "upload-owner@example.com");
    const editor = await person(t, "upload-editor@example.com");
    const commenter = await person(t, "upload-commenter@example.com");
    const stranger = await person(t, "upload-stranger@example.com");
    const docId = await createDoc(owner, "Shared page");
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "upload-editor@example.com", role: "editor" });
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "upload-commenter@example.com", role: "commenter" });

    // The guest's own scope is what their client sends; the page decides where the file lives.
    const ok = await editor.as.mutation(api.files.generateUploadUrl, { scope: editor.scope, documentId: docId, ...upload });
    expect(ok.uploadUrl).toBeTruthy();
    await expect(commenter.as.mutation(api.files.generateUploadUrl, { scope: commenter.scope, documentId: docId, ...upload })).rejects.toThrow();
    await expect(stranger.as.mutation(api.files.generateUploadUrl, { scope: stranger.scope, documentId: docId, ...upload })).rejects.toThrow();
    // Without a page, uploads need editor membership of the named workspace…
    const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Uploads" });
    await expect(stranger.as.mutation(api.files.generateUploadUrl, { scope: inWorkspace(teamId), ...upload })).rejects.toThrow(/Workspace not found/);
    // …and "Personal" is always the caller's own.
    expect((await stranger.as.mutation(api.files.generateUploadUrl, { scope: PERSONAL, ...upload })).uploadUrl).toBeTruthy();
    const intents = await t.run(async (ctx) => await ctx.db.query("uploadIntents").collect());
    const strangers = intents.filter((i) => i.profileId === stranger.profileId);
    expect(strangers.every((i) => i.ownerProfileId === stranger.profileId && i.workspaceId === undefined)).toBe(true);
  });
});
