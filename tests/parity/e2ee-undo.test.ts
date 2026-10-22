// Changes in an encrypted workspace (docs/E2EE_DESIGN.md §6.7, WP7): an editor changes a line in a sealed note;
// the owner's Changes view shows what it was (changes.note's previousSealed, opened on the device) and the
// owner undoes it on the device (the server's changes.undo answers e2ee_device_only for sealed notes).
// Against the real Convex functions (convex-test), two people, two routers, the same workspace key.
import { SCHEMA_VERSION, ulid, type SyncOp, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { describe, expect, test } from "vitest";
import { join, person, setup, teamWorkspace } from "../convex/helpers";
import { encryptedSpace } from "../convex/e2ee-fixtures";
import { api } from "../../convex/_generated/api";
import { E2eeRouterClient } from "../../apps/web/src/lib/e2ee/router/client";
import { ParityKeyRing, TestInner, UnlockedSession } from "./drivers/e2ee";

const para = (id: string, text: string, rank: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: {} });

async function routerFor(as: ConstructorParameters<typeof TestInner>[0], keys: ConstructorParameters<typeof ParityKeyRing>[0], scopeId: string, place: WireScope) {
  const inner = new TestInner(as);
  const router = new E2eeRouterClient(inner as never, { session: new UnlockedSession(), keyring: new ParityKeyRing(keys, scopeId), persist: () => false, locks: null });
  await router.ready();
  await router.replicas.open(place);
  await router.replicas.get(place)!.whenSynced();
  router.setScope(place);
  const catchUp = async () => {
    await inner.refreshAll();
    await router.replicas.get(place)?.catchUp?.();
  };
  return { router, catchUp };
}

describe("Changes in an encrypted workspace", () => {
  test("an editor changes a line; the owner sees what it was and undoes it on the device", async () => {
    const t = setup();
    const owner = await person(t, "owner-undo@example.com");
    const ws = await teamWorkspace(owner as never);
    const editor = await person(t, "editor-undo@example.com");
    await join(t, owner as never, editor as never, "editor-undo@example.com", ws.workspaceId, "editor");
    const place: WireScope = { kind: "workspace", workspaceId: ws.workspaceId };
    const space = await encryptedSpace(t, owner as never, { level: "full", workspaceId: ws.workspaceId });
    const a = await routerFor(owner.as, space.keys, space.scope, place);
    const doc = ulid();
    const line = ulid();
    const push = async (r: E2eeRouterClient, ops: SyncOp[]) => (await r.mutation(api.sync.push, { scope: place, deviceId: "parity-device-1", ops: ops as never })) as { status: string }[];
    const created = await push(a.router, [
      { opId: ulid(), kind: "document.create", document: { id: doc, parentDocumentId: null, folderId: null, kind: "document", title: "Plan", icon: "📝", scope: place } },
      { opId: ulid(), kind: "block.upsert", documentId: doc, block: para(line, "ZQXJ-ORIGINAL line", "a"), baseRevision: null, fields: ["content", "position"] },
    ]);
    expect(created.map((r) => r.status)).toEqual(["applied", "applied"]);
    // The owner has looked at the note as it is now (the version Changes compares with).
    await a.router.mutation(api.documents.recordView, { documentId: doc });
    await a.router.mutation(api.changes.markSeen, { documentIds: [doc] });

    // The editor, on their own device with the workspace key, changes the line.
    const b = await routerFor(editor.as, space.keys, space.scope, place);
    await b.catchUp();
    const edited = await push(b.router, [{ opId: ulid(), kind: "block.upsert", documentId: doc, block: { ...para(line, "ZQXJ-EDITED by the editor", "a"), revision: 1 }, baseRevision: 1, fields: ["content"] }]);
    expect(edited[0]!.status).toBe("applied");

    // The owner's Changes view: the line now, and as it was, both opened here.
    await a.catchUp();
    const note = (await a.router.query(api.changes.note, { documentId: doc })) as { blocks: WireBlock[]; previous: WireBlock[] | null; canUndo: boolean; previousSealed?: unknown } | null;
    expect(note?.canUndo).toBe(true);
    expect(note!.previousSealed).toBeUndefined();
    expect(note!.blocks.map((x) => x.text)).toEqual([[{ type: "text", text: "ZQXJ-EDITED by the editor" }]]);
    expect(note!.previous!.map((x) => x.text)).toEqual([[{ type: "text", text: "ZQXJ-ORIGINAL line" }]]);

    // Undo, on the device.
    const undone = (await a.router.mutation(api.changes.undo, { documentId: doc })) as { undoVersionId: string | null; reverted: number };
    expect(undone.reverted).toBe(1);
    expect(undone.undoVersionId).toBeTruthy();
    await a.catchUp();
    const listed = (await a.router.query(api.blocks.list, { documentId: doc })) as { blocks: WireBlock[] };
    expect(listed.blocks.map((x) => x.text)).toEqual([[{ type: "text", text: "ZQXJ-ORIGINAL line" }]]);
    // The editor sees it too.
    await b.catchUp();
    const theirs = (await b.router.query(api.blocks.list, { documentId: doc })) as { blocks: WireBlock[] };
    expect(theirs.blocks.map((x) => x.text)).toEqual([[{ type: "text", text: "ZQXJ-ORIGINAL line" }]]);
    // Nothing readable on the server.
    const rows = await t.run(async (ctx) => JSON.stringify(await ctx.db.query("blocks").collect()));
    expect(rows).not.toContain("ZQXJ");
    await a.router.dispose();
    await b.router.dispose();
  }, 60_000);
});
