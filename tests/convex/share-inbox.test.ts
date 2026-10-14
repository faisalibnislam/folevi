// Save to Folevi (the share page): the Inbox a shared note is filed under, and a note filed there through
// the sync engine the way the share page does it (a page under the Inbox, with a card at the Inbox's end).
import { describe, expect, test } from "vitest";
import { inboxDocumentId, scopeIdKey, SCHEMA_VERSION } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid } from "./helpers";

describe("tasks.inbox", () => {
  test("makes the Inbox once, at its deterministic id, and says where its last line is", async () => {
    const t = setup();
    const me = await person(t, "sharer@example.com");
    const first = await me.as.mutation(api.tasks.inbox, { scope: PERSONAL });
    expect(first).toEqual({ documentId: inboxDocumentId(me.profileId, scopeIdKey(PERSONAL)), lastRank: null });
    await me.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-share",
      ops: [{ opId: ulid(), kind: "block.upsert", documentId: first.documentId, block: para(ulid(), "Buy milk", "M"), baseRevision: null, fields: ["content", "position"] }] as never,
    });
    expect(await me.as.mutation(api.tasks.inbox, { scope: PERSONAL })).toEqual({ documentId: first.documentId, lastRank: "M" });
  });

  test("brings the Inbox back from Trash, and a shared note filed under it lands there", async () => {
    const t = setup();
    const me = await person(t, "sharer2@example.com");
    const { documentId: inbox } = await me.as.mutation(api.tasks.inbox, { scope: PERSONAL });
    await me.as.mutation(api.documents.moveToTrash, { documentId: inbox });
    const again = await me.as.mutation(api.tasks.inbox, { scope: PERSONAL });
    expect(again.documentId).toBe(inbox);
    const doc = await me.as.query(api.documents.get, { documentId: inbox });
    expect(doc?.inTrash).toBe(false);

    const noteId = ulid();
    const results = await me.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-share",
      ops: [
        { opId: ulid(), kind: "document.create", document: { id: noteId, parentDocumentId: inbox, folderId: null, kind: "document", title: "Shared page", icon: null } },
        { opId: ulid(), kind: "block.upsert", documentId: noteId, block: { id: ulid(), type: "bookmark", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [], props: { url: "https://example.com/" } }, baseRevision: null, fields: ["content", "position"] },
        { opId: ulid(), kind: "block.upsert", documentId: inbox, block: { id: ulid(), type: "page", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [], props: { documentId: noteId, display: "card", titleCache: "Shared page" } }, baseRevision: null, fields: ["content", "position"] },
      ] as never,
    });
    expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
  });

  test("a workspace member who can only view can't have an Inbox made there", async () => {
    const t = setup();
    const owner = await person(t, "owner-share@example.com");
    const viewer = await person(t, "viewer-share@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, viewer, "viewer-share@example.com", workspaceId, "viewer");
    await expect(viewer.as.mutation(api.tasks.inbox, { scope })).rejects.toThrow();
    expect((await owner.as.mutation(api.tasks.inbox, { scope })).documentId).toBe(inboxDocumentId(owner.profileId, workspaceId));
  });
});
