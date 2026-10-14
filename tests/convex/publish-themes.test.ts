// Themed publishing: a public link's page can take a curated look (Article, Docs, Minimal) instead of the
// note's own style. The look is stored on the link, checked on the server, and returned with the page.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { join, para, person, PERSONAL, setup, teamWorkspace, inWorkspace, ulid, type ScopeArg } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
const secret = "a".repeat(64);

async function note(p: Person, scope: ScopeArg, title: string) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-publish",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      { opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), "Tides follow the moon."), baseRevision: null, fields: ["content", "position"] },
    ] as never,
  });
  return id;
}

describe("publishing themes", () => {
  test("a link keeps the look it was made with, the page gets it, and it can be changed", async () => {
    const t = setup();
    const a = await person(t, "publish@example.com");
    const docId = await note(a, PERSONAL, "Tides");
    const plain = await a.as.mutation(api.sharing.createPublicLink, { documentId: docId });
    const article = await a.as.mutation(api.sharing.createPublicLink, { documentId: docId, theme: "article", allowIndexing: true });
    const open = async (token: string) => {
      const r = await t.mutation(api.sharing.openPublicLink, { token, serverSecret: secret, clientKey: "client-publish" });
      if (r.status !== "ok") throw new Error(r.status);
      return r;
    };
    expect((await open(plain.token)).theme).toBe("note");
    const page = await open(article.token);
    expect(page.theme).toBe("article");
    // Search engines get a description only when the owner let them find the page.
    expect(page.description).toEqual(expect.any(String));
    expect((await open(plain.token)).description).toBeNull();

    const links = (await a.as.query(api.sharing.get, { documentId: docId }))!.links;
    expect(Object.fromEntries(links.map((l) => [l.id, l.theme]))).toEqual({ [plain.id]: "note", [article.id]: "article" });

    await a.as.mutation(api.sharing.setPublicLinkTheme, { linkId: plain.id, theme: "docs" });
    expect((await open(plain.token)).theme).toBe("docs");
    await a.as.mutation(api.sharing.setPublicLinkTheme, { linkId: plain.id, theme: "note" });
    expect((await open(plain.token)).theme).toBe("note");
    const row = await t.run(async (ctx) => await ctx.db.query("publicLinks").withIndex("by_public_id", (q) => q.eq("publicId", plain.id)).unique());
    // The note's own style is the default: nothing stored.
    expect(row!.theme).toBeUndefined();
  });

  test("only known looks are accepted, and only by someone who manages the page", async () => {
    const t = setup();
    const owner = await person(t, "publish-owner@example.com");
    const viewer = await person(t, "publish-viewer@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Press");
    await join(t, owner, viewer, "publish-viewer@example.com", workspaceId, "viewer");
    const docId = await note(owner, inWorkspace(workspaceId), "Launch notes");
    await expect(owner.as.mutation(api.sharing.createPublicLink, { documentId: docId, theme: "neon" as never })).rejects.toThrow(/Validator error/);
    const link = await owner.as.mutation(api.sharing.createPublicLink, { documentId: docId, theme: "minimal" });
    await expect(owner.as.mutation(api.sharing.setPublicLinkTheme, { linkId: link.id, theme: "glitter" as never })).rejects.toThrow(/Validator error/);
    await expect(viewer.as.mutation(api.sharing.setPublicLinkTheme, { linkId: link.id, theme: "article" })).rejects.toThrow();
    await owner.as.mutation(api.sharing.revokePublicLink, { linkId: link.id });
    await expect(owner.as.mutation(api.sharing.setPublicLinkTheme, { linkId: link.id, theme: "article" })).rejects.toThrow(/Link not found/);
  });
});
