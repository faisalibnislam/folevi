// Live carets: selections sent through presence (block ids and offsets only), readable by the people who
// can read the note, and gone when the session leaves or goes stale.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { inWorkspace, join, para, person, setup, teamWorkspace, ulid, type T } from "./helpers";

async function sharedPage(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const viewer = await person(t, `${prefix}-viewer@example.com`);
  const outsider = await person(t, `${prefix}-outsider@example.com`);
  const { workspaceId } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, viewer, `${prefix}-viewer@example.com`, workspaceId, "viewer");
  const documentId = ulid();
  const line = para(ulid(), "A line to point at");
  await owner.as.mutation(api.sync.push, {
    scope: inWorkspace(workspaceId),
    deviceId: `device-${ulid()}`,
    ops: [
      { opId: ulid(), kind: "document.create", document: { id: documentId, parentDocumentId: null, folderId: null, kind: "document", title: "Plan", icon: null } },
      { opId: ulid(), kind: "block.upsert", documentId, block: line, baseRevision: null, fields: ["content", "position"] },
    ] as never,
  });
  return { owner, viewer, outsider, documentId, blockId: line.id };
}

const at = (blockId: string, offset: number) => ({ blockId, offset });

describe("live carets", () => {
  test("a member's caret reaches the others in the note, with their name and colour, never their own", async () => {
    const t = setup();
    const { owner, viewer, documentId, blockId } = await sharedPage(t, "caret-see");
    await owner.as.mutation(api.presence.setCursor, { documentId, sessionId: "owner-tab", cursor: { anchor: at(blockId, 2), head: at(blockId, 6) } });
    // Someone who may only read the note can still show where they are.
    await viewer.as.mutation(api.presence.setCursor, { documentId, sessionId: "viewer-tab", cursor: { anchor: at(blockId, 0), head: at(blockId, 0), block: true } });

    const seen = await viewer.as.query(api.presence.cursors, { documentId });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: "caret-see-owner", anchor: at(blockId, 2), head: at(blockId, 6), block: false });
    expect(seen[0]!.color).toMatch(/^[a-z]+$/);
    const theirs = await owner.as.query(api.presence.cursors, { documentId });
    expect(theirs.map((c) => [c.name, c.block])).toEqual([["caret-see-viewer", true]]);

    // Moving updates the same row; null removes it.
    await owner.as.mutation(api.presence.setCursor, { documentId, sessionId: "owner-tab", cursor: { anchor: at(blockId, 9), head: at(blockId, 9) } });
    expect((await viewer.as.query(api.presence.cursors, { documentId }))[0]!.head).toEqual(at(blockId, 9));
    await owner.as.mutation(api.presence.setCursor, { documentId, sessionId: "owner-tab", cursor: null });
    expect(await viewer.as.query(api.presence.cursors, { documentId })).toEqual([]);

    // Leaving the note takes the caret with it.
    await viewer.as.mutation(api.presence.leave, { documentId, sessionId: "viewer-tab" });
    expect(await owner.as.query(api.presence.cursors, { documentId })).toEqual([]);
  });

  test("only ids and offsets, within limits: text, odd ids and impossible offsets are refused", async () => {
    const t = setup();
    const { owner, documentId, blockId } = await sharedPage(t, "caret-limits");
    const send = (cursor: unknown, sessionId = "tab") => owner.as.mutation(api.presence.setCursor, { documentId, sessionId, cursor: cursor as never });
    await expect(send({ anchor: at("some words of the note", 0), head: at(blockId, 0) })).rejects.toThrow(/block id/);
    await expect(send({ anchor: at("x".repeat(65), 0), head: at(blockId, 0) })).rejects.toThrow(/block id/);
    await expect(send({ anchor: at(blockId, -1), head: at(blockId, 0) })).rejects.toThrow(/offset/);
    await expect(send({ anchor: at(blockId, 1.5), head: at(blockId, 0) })).rejects.toThrow(/offset/);
    await expect(send({ anchor: at(blockId, 0), head: at(blockId, 2_000_000) })).rejects.toThrow(/offset/);
    await expect(send({ anchor: at(blockId, 0), head: at(blockId, 0), text: "hello" })).rejects.toThrow();
    await expect(send({ anchor: at(blockId, 0), head: at(blockId, 0) }, "s".repeat(65))).rejects.toThrow(/session/);
    // Nothing was stored, and the row holds no text at all.
    await send({ anchor: at(blockId, 3), head: at(blockId, 4) });
    const rows = await t.run(async (ctx) => await ctx.db.query("presenceCursors").collect());
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["_creationTime", "_id", "anchorBlockId", "anchorOffset", "block", "documentId", "headBlockId", "headOffset", "profileId", "sessionKey", "updatedAt"]);
  });

  test("people who can't open the note can neither send a caret into it nor see the carets in it", async () => {
    const t = setup();
    const { owner, outsider, documentId, blockId } = await sharedPage(t, "caret-access");
    await outsider.as.mutation(api.presence.setCursor, { documentId, sessionId: "out", cursor: { anchor: at(blockId, 0), head: at(blockId, 1) } });
    expect(await t.run(async (ctx) => await ctx.db.query("presenceCursors").collect())).toEqual([]);
    await owner.as.mutation(api.presence.setCursor, { documentId, sessionId: "own", cursor: { anchor: at(blockId, 0), head: at(blockId, 1) } });
    expect(await outsider.as.query(api.presence.cursors, { documentId })).toEqual([]);
    // A note that doesn't exist is quietly nothing too.
    expect(await outsider.as.query(api.presence.cursors, { documentId: ulid() })).toEqual([]);
  });

  test("the sweep removes carets nobody has touched for ten minutes; a resting caret is kept alive by the heartbeat", async () => {
    const t = setup();
    const { owner, viewer, documentId, blockId } = await sharedPage(t, "caret-sweep");
    await owner.as.mutation(api.presence.setCursor, { documentId, sessionId: "a", cursor: { anchor: at(blockId, 0), head: at(blockId, 0) } });
    await viewer.as.mutation(api.presence.setCursor, { documentId, sessionId: "b", cursor: { anchor: at(blockId, 1), head: at(blockId, 1) } });
    await t.run(async (ctx) => {
      for (const c of await ctx.db.query("presenceCursors").collect()) await ctx.db.patch(c._id, { updatedAt: Date.now() - 9 * 60_000 });
    });
    // The owner is still here (a heartbeat), the viewer's tab went away without saying so.
    await owner.as.mutation(api.presence.heartbeat, { documentId, sessionId: "a" });
    await t.run(async (ctx) => {
      for (const c of await ctx.db.query("presenceCursors").collect()) if (c.updatedAt < Date.now() - 60_000) await ctx.db.patch(c._id, { updatedAt: Date.now() - 20 * 60_000 });
    });
    await t.mutation(internal.presence.cleanup, {});
    const left = await viewer.as.query(api.presence.cursors, { documentId });
    expect(left.map((c) => c.name)).toEqual(["caret-sweep-owner"]);
  });
});
