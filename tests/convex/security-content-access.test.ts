// Security audit 2026-11-26, restricted pages (convex/lib/auth.ts): who a restriction lets in, who manages
// it, and how deep pages nest. Each test is a hole the audit found and closed.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { join, person, setup, teamWorkspace, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

/** convex/lib/auth.ts MAX_PAGE_DEPTH. */
const MAX_PAGE_DEPTH = 32;

async function newPage(p: Person, scope: ScopeArg, title = "Page", parentDocumentId?: string) {
  const { id } = await p.as.mutation(api.documents.create, { scope, title, ...(parentDocumentId ? { parentDocumentId } : {}) });
  return id;
}

async function world(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const member = await person(t, `${prefix}-member@example.com`);
  const ally = await person(t, `${prefix}-ally@example.com`);
  const guest = await person(t, `${prefix}-guest@example.com`);
  const { workspaceId, scope } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, member, `${prefix}-member@example.com`, workspaceId, "editor");
  await join(t, owner, ally, `${prefix}-ally@example.com`, workspaceId, "editor");
  return { owner, member, ally, guest, workspaceId, scope, guestEmail: `${prefix}-guest@example.com`, allyEmail: `${prefix}-ally@example.com`, memberEmail: `${prefix}-member@example.com` };
}

const accessOf = async (p: Person, documentId: string) => (await p.as.query(api.documents.get, { documentId }))?.access ?? "none";

describe("a grant on an open page doesn't reach into a restricted page under it", () => {
  test("sharing the open parent gives nobody the restricted sub-page", async () => {
    const t = setup();
    const w = await world(t, "reach");
    const wiki = await newPage(w.owner, w.scope, "Wiki");
    const salaries = await newPage(w.owner, w.scope, "Salaries", wiki);
    const deeper = await newPage(w.owner, w.scope, "2026 round", salaries);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: salaries, mode: "restricted" });
    expect(await accessOf(w.member, salaries)).toBe("none");
    // A member who can edit the open parent shares it: with a guest (a second account of theirs, say) and
    // with another member. Neither gets into the restricted page or what's under it.
    await w.member.as.mutation(api.sharing.grant, { documentId: wiki, email: w.guestEmail, role: "editor" });
    await w.member.as.mutation(api.sharing.grant, { documentId: wiki, email: w.allyEmail, role: "editor" });
    expect(await accessOf(w.guest, wiki)).toBe("write");
    for (const who of [w.guest, w.ally]) {
      expect(await accessOf(who, salaries)).toBe("none");
      expect(await accessOf(who, deeper)).toBe("none");
      expect(await who.as.query(api.blocks.list, { documentId: salaries })).toBeNull();
    }
    // Nor are they people the restricted page can mention.
    const names = (await w.owner.as.query(api.comments.mentionable, { documentId: salaries })).map((p) => p.profileId);
    expect(names).not.toContain(w.guest.profileId);
    expect(names).not.toContain(w.ally.profileId);
  });

  test("a grant on the restricted page, or on a page inside it, still reaches the pages below", async () => {
    const t = setup();
    const w = await world(t, "inside");
    const wiki = await newPage(w.owner, w.scope, "Wiki");
    const salaries = await newPage(w.owner, w.scope, "Salaries", wiki);
    const round = await newPage(w.owner, w.scope, "2026 round", salaries);
    const sheet = await newPage(w.owner, w.scope, "Sheet", round);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: salaries, mode: "restricted" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: salaries, email: w.guestEmail, role: "viewer" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: round, email: w.allyEmail, role: "editor" });
    expect(await accessOf(w.guest, salaries)).toBe("read");
    expect(await accessOf(w.guest, sheet)).toBe("read");
    // The grant on a page between the restricted page and the target reaches down, not up.
    expect(await accessOf(w.ally, sheet)).toBe("write");
    expect(await accessOf(w.ally, salaries)).toBe("none");
  });
});

describe("making a page under someone else's restricted page gives no hold on it", () => {
  test("a person taken off a restricted page loses the sub-pages they made there", async () => {
    const t = setup();
    const w = await world(t, "maker");
    const project = await newPage(w.owner, w.scope, "Project");
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: project, mode: "restricted" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: project, email: w.memberEmail, role: "editor" });
    const notes = await newPage(w.member, w.scope, "Meeting notes", project);
    expect(await accessOf(w.member, notes)).toBe("write");
    await w.owner.as.mutation(api.sharing.revoke, { documentId: project, profileId: w.member.profileId });
    expect(await accessOf(w.member, project)).toBe("none");
    expect(await accessOf(w.member, notes)).toBe("none");
    await expect(w.member.as.mutation(api.sharing.createPublicLink, { documentId: notes })).rejects.toThrow(/not found/i);
  });

  test("whoever made the restricted page manages it and what's under it", async () => {
    const t = setup();
    const w = await world(t, "keeper");
    const plan = await newPage(w.member, w.scope, "My plan");
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: plan, mode: "restricted" });
    const sub = await newPage(w.owner, w.scope, "Added by the owner", plan);
    expect(await accessOf(w.member, plan)).toBe("manage");
    expect(await accessOf(w.member, sub)).toBe("manage");
    expect(await accessOf(w.ally, sub)).toBe("none");
  });
});

describe("pages nest only so deep, and a walk that can't finish refuses", () => {
  test("a restriction far above still holds (it used to be lost past 12 pages)", async () => {
    const t = setup();
    const w = await world(t, "deep");
    let top = "";
    let last: string | undefined;
    for (let i = 0; i < 14; i++) {
      last = await newPage(w.owner, w.scope, `Level ${i}`, last);
      if (i === 0) top = last;
    }
    const vault = await newPage(w.owner, w.scope, "Vault");
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: vault, mode: "restricted" });
    await w.owner.as.mutation(api.documents.move, { documentId: top, parentDocumentId: vault });
    expect(await accessOf(w.member, last!)).toBe("none");
    expect(await accessOf(w.owner, last!)).toBe("manage");
    expect((await w.member.as.query(api.documents.children, { documentId: top }).catch(() => null)) ?? null).toBeNull();
  });

  test("creating or moving a page deeper than pages go is refused", async () => {
    const t = setup();
    const w = await world(t, "limit");
    let last: string | undefined;
    const chain: string[] = [];
    for (let i = 0; i < MAX_PAGE_DEPTH; i++) {
      last = await newPage(w.owner, w.scope, `Level ${i}`, last);
      chain.push(last);
    }
    await expect(newPage(w.owner, w.scope, "One too many", last)).rejects.toThrow(/nested any deeper/);
    // A page with a sub-page fits under the page before last only without that sub-page.
    const pair = await newPage(w.owner, w.scope, "Pair");
    await newPage(w.owner, w.scope, "Pair's sub-page", pair);
    await expect(w.owner.as.mutation(api.documents.move, { documentId: pair, parentDocumentId: chain[MAX_PAGE_DEPTH - 2]! })).rejects.toThrow(/nested any deeper/);
    await w.owner.as.mutation(api.documents.move, { documentId: pair, parentDocumentId: chain[MAX_PAGE_DEPTH - 3]! });
  });

  test("a page nested deeper than that (older data) is closed to everyone but the workspace's managers", async () => {
    const t = setup();
    const w = await world(t, "over");
    const ids: string[] = [];
    for (let i = 0; i < MAX_PAGE_DEPTH + 2; i++) ids.push(await newPage(w.owner, w.scope, `Loose ${i}`));
    await w.owner.as.mutation(api.sharing.grant, { documentId: ids[ids.length - 1]!, email: w.guestEmail, role: "editor" });
    // Chained directly in the database, the way no function allows any more.
    await t.run(async (ctx) => {
      const rows: Id<"documents">[] = [];
      for (const id of ids) rows.push((await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!._id);
      for (let i = 1; i < rows.length; i++) await ctx.db.patch(rows[i]!, { parentDocumentId: rows[i - 1]! });
    });
    const deepest = ids[ids.length - 1]!;
    expect(await accessOf(w.member, deepest)).toBe("none");
    expect(await accessOf(w.guest, deepest)).toBe("none");
    expect(await accessOf(w.owner, deepest)).toBe("manage");
    // A page that does fit is as open as before.
    expect(await accessOf(w.member, ids[3]!)).toBe("write");
  });
});
