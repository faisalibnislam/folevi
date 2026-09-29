// Sync routing (docs/SYNC_PROTOCOL.md §Routing): ops are authorized per document, not per batch scope.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { BUILT_IN_TEMPLATES, builtInTemplateBlocks } from "../../convex/lib/templates";
import { validateWireBlock } from "@folevi/editor-schema";
import { inWorkspace, join, para, person, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
type ScopeArg = typeof PERSONAL | ReturnType<typeof inWorkspace>;

async function create(p: Person, routing: ScopeArg, document: Record<string, unknown>) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope: routing,
    deviceId: "device-routing",
    ops: [{ opId: ulid(), kind: "document.create", document: { parentDocumentId: null, folderId: null, kind: "document", title: "Doc", icon: null, id: ulid(), ...document } as never }],
  });
  return r!;
}

async function upsertVia(p: Person, routing: ScopeArg, documentId: string, block: ReturnType<typeof para>, baseRevision: number | null = null) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope: routing,
    deviceId: "device-routing",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision, fields: ["content", "position"] }],
  });
  return r!;
}

async function blocksOf(p: Person, documentId: string) {
  return (await p.as.query(api.blocks.list, { documentId }))!.blocks;
}

async function joinTeam(t: T, owner: Person, member: Person, email: string, role: "editor" | "viewer" = "editor") {
  const { workspaceId } = await teamWorkspace(owner);
  await join(t, owner, member, email, workspaceId, role);
  return workspaceId;
}

describe("sync routing across scopes", () => {
  test("a guest with an editor grant edits a page in someone else's Personal through their own queue", async () => {
    const t = setup();
    const owner = await person(t, "route-owner@example.com");
    const guest = await person(t, "route-guest@example.com");
    const docId = (await create(owner, PERSONAL, { title: "Shared plan" })).document!.id;
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "route-guest@example.com", role: "editor" });

    // The guest's batch is routed through their own Personal; the op still lands in the owner's page.
    const block = para(ulid(), "Guest was here");
    const r = await upsertVia(guest, PERSONAL, docId, block);
    expect(r.status).toBe("applied");
    expect((await blocksOf(owner, docId)).find((b) => b.id === block.id)?.text).toEqual([{ type: "text", text: "Guest was here" }]);

    // The change is stamped on the owner's Personal sequence (the owner pulling sees it), not the guest's.
    const head = (await owner.as.query(api.sync.head, { scope: PERSONAL })).seq;
    const guestHead = (await guest.as.query(api.sync.head, { scope: PERSONAL })).seq;
    const edit = await upsertVia(guest, PERSONAL, docId, { ...block, text: [{ type: "text", text: "Guest edited" }] }, r.revision!);
    expect(edit.status).toBe("applied");
    const pulled = await owner.as.query(api.sync.pull, { scope: PERSONAL, cursor: head });
    expect(pulled.blocks.map((b) => b.block.id)).toContain(block.id);
    expect((await guest.as.query(api.sync.head, { scope: PERSONAL })).seq).toBe(guestHead);
    // The guest's own Personal feed never carries the owner's rows.
    const guestPull = await guest.as.query(api.sync.pull, { scope: PERSONAL, cursor: 0, limit: 500 });
    expect(guestPull.documents.map((d) => d.id)).not.toContain(docId);

    // Replays stay idempotent across routing.
    const opId = ulid();
    const again = para(ulid(), "once");
    const first = await guest.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-routing",
      ops: [{ opId, kind: "block.upsert", documentId: docId, block: again, baseRevision: null, fields: ["content", "position"] }],
    });
    const second = await guest.as.mutation(api.sync.push, {
      scope: inWorkspace(ulid()), // routed differently (a workspace they aren't in) the second time: still a duplicate
      deviceId: "device-routing",
      ops: [{ opId, kind: "block.upsert", documentId: docId, block: again, baseRevision: null, fields: ["content", "position"] }],
    });
    expect(first[0]!.status).toBe("applied");
    expect(second[0]!.status).toBe("duplicate");
  });

  test("viewer/commenter grants and strangers are still rejected per op", async () => {
    const t = setup();
    const owner = await person(t, "route-owner2@example.com");
    const viewer = await person(t, "route-viewer@example.com");
    const stranger = await person(t, "route-stranger@example.com");
    const docId = (await create(owner, PERSONAL, { title: "Read only" })).document!.id;
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "route-viewer@example.com", role: "commenter" });
    const denied = await upsertVia(viewer, PERSONAL, docId, para(ulid(), "nope"));
    expect(denied.status).toBe("rejected");
    expect(denied.error?.code).toBe("forbidden");
    // Someone else's Personal reads as missing, never as "forbidden".
    const hidden = await upsertVia(stranger, PERSONAL, docId, para(ulid(), "nope"));
    expect(hidden.status).toBe("rejected");
    expect(hidden.error?.code).toBe("not_found");
  });

  test("guests can't add pages to someone else's Personal or a workspace they don't belong to", async () => {
    const t = setup();
    const owner = await person(t, "route-owner3@example.com");
    const guest = await person(t, "route-guest3@example.com");
    const docId = (await create(owner, PERSONAL, { title: "Shared" })).document!.id;
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "route-guest3@example.com", role: "editor" });
    const nested = await create(guest, PERSONAL, { parentDocumentId: docId, title: "Sub" });
    expect(nested.status).toBe("rejected");
    expect(nested.error?.code).toBe("forbidden");
    const { workspaceId: ownerTeam } = await teamWorkspace(owner);
    for (const named of [{ workspaceId: ownerTeam }, { scope: inWorkspace(ownerTeam) }]) {
      const direct = await create(guest, PERSONAL, { ...named, title: "Sneaky" });
      expect(direct.status).toBe("rejected");
      expect(direct.error?.code).toBe("not_found");
    }
    // Naming Personal is always the caller's own Personal.
    const own = await create(guest, inWorkspace(ownerTeam), { scope: PERSONAL, title: "Mine" });
    expect(own.status).toBe("applied");
    expect(own.document).toMatchObject({ workspaceId: null, ownerProfileId: guest.profileId });
    // A malformed scope is refused rather than guessed (push validates it; pushJson checks it by hand).
    await expect(create(guest, PERSONAL, { scope: { kind: "elsewhere" }, title: "?" })).rejects.toThrow(/Validator/);
    const raw = await guest.as.mutation(api.sync.pushJson, {
      scope: PERSONAL,
      deviceId: "device-routing",
      payload: JSON.stringify([{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: null, folderId: null, kind: "document", title: "?", icon: null, scope: { kind: "workspace" } } }]),
    });
    expect(JSON.parse(raw)[0]).toMatchObject({ status: "rejected", error: { code: "invalid_argument" } });
  });

  test("creates follow their parent or explicit scope, not the routing scope", async () => {
    const t = setup();
    const owner = await person(t, "route-owner4@example.com");
    const member = await person(t, "route-member4@example.com");
    const teamId = await joinTeam(t, owner, member, "route-member4@example.com");
    // Queued while the team was selected, sent after switching back to Personal.
    const explicit = await create(member, PERSONAL, { scope: inWorkspace(teamId), title: "Team page" });
    expect(explicit.status).toBe("applied");
    expect(explicit.document!.workspaceId).toBe(teamId);
    expect(explicit.document!.ownerProfileId).toBeNull();
    // Older clients name the workspace with `workspaceId`.
    const legacy = await create(member, PERSONAL, { workspaceId: teamId, title: "Team page 2" });
    expect(legacy.document!.workspaceId).toBe(teamId);
    const child = await create(member, PERSONAL, { parentDocumentId: explicit.document!.id, title: "Team child" });
    expect(child.status).toBe("applied");
    expect(child.document!.workspaceId).toBe(teamId);
    const plain = await create(member, PERSONAL, { title: "Mine" });
    expect(plain.document).toMatchObject({ workspaceId: null, ownerProfileId: member.profileId });
    // Pages can't be re-parented across scopes (Personal ↔ workspace), either way.
    for (const [doc, parent] of [
      [plain, explicit],
      [explicit, plain],
    ] as const) {
      const [moved] = await member.as.mutation(api.sync.push, {
        scope: PERSONAL,
        deviceId: "device-routing",
        ops: [{ opId: ulid(), kind: "document.update", documentId: doc.document!.id, patch: { parentDocumentId: parent.document!.id }, baseRevision: doc.revision! }],
      });
      expect(moved!.status).toBe("rejected");
      expect(moved!.error?.code).toBe("invalid_argument");
    }
    // Nor can a Personal page go into a workspace folder.
    const { id: teamFolder } = await member.as.mutation(api.organization.createFolder, { scope: inWorkspace(teamId), name: "Team folder" });
    await expect(member.as.mutation(api.documents.move, { documentId: plain.document!.id, folderId: teamFolder })).rejects.toThrow(/Folder not found/);
  });

  test("one batch may mix documents from several scopes; a stale routing workspace doesn't fail it", async () => {
    const t = setup();
    const owner = await person(t, "route-owner5@example.com");
    const member = await person(t, "route-member5@example.com");
    const teamId = await joinTeam(t, owner, member, "route-member5@example.com");
    const teamDoc = (await create(member, inWorkspace(teamId), { title: "Team" })).document!.id;
    const ownDoc = (await create(member, PERSONAL, { title: "Own" })).document!.id;
    const results = await member.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-routing",
      ops: [
        { opId: ulid(), kind: "block.upsert", documentId: teamDoc, block: para(ulid(), "team"), baseRevision: null, fields: ["content", "position"] },
        { opId: ulid(), kind: "block.upsert", documentId: ownDoc, block: para(ulid(), "own"), baseRevision: null, fields: ["content", "position"] },
      ],
    });
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);

    // Removed from the team while ops were queued with the team as routing workspace.
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId: teamId, profileId: member.profileId });
    const later = await member.as.mutation(api.sync.push, {
      scope: inWorkspace(teamId),
      deviceId: "device-routing",
      ops: [
        { opId: ulid(), kind: "block.upsert", documentId: teamDoc, block: para(ulid(), "gone"), baseRevision: null, fields: ["content", "position"] },
        { opId: ulid(), kind: "block.upsert", documentId: ownDoc, block: para(ulid(), "still mine"), baseRevision: null, fields: ["content", "position"] },
        { opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: null, folderId: null, kind: "document", title: "Orphan", icon: null } },
      ],
    });
    expect(later.map((r) => r.status)).toEqual(["rejected", "applied", "rejected"]);
    expect(later[0]!.error?.code).toBe("not_found");
  });

  test("every built-in template is valid, uses an outlined icon name, and creates a page", async () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BUILT_IN_TEMPLATES.map((x) => x.key)).size).toBe(BUILT_IN_TEMPLATES.length);
    const t = setup();
    const a = await person(t, "route-all-templates@example.com");
    for (const tpl of BUILT_IN_TEMPLATES) {
      expect(tpl.icon, tpl.key).toMatch(/^[a-z][a-z-]*$/);
      for (const block of builtInTemplateBlocks(tpl.key)!) expect(validateWireBlock(block), `${tpl.key}: ${block.type}`).toEqual([]);
      const r = await create(a, PERSONAL, { title: tpl.name, templateId: `builtin:${tpl.key}` });
      expect(r.status, tpl.key).toBe("applied");
    }
  });

  test("admin-disabled built-in templates and unreadable templates are rejected server-side", async () => {
    const t = setup();
    const a = await person(t, "route-templates@example.com");
    const known = `builtin:${BUILT_IN_TEMPLATES[0]!.key}`;
    const fine = await create(a, PERSONAL, { templateId: known });
    expect(fine.status).toBe("applied");
    await t.run(async (ctx) => {
      await ctx.db.insert("builtInTemplates", { key: known.slice(8), name: "x", description: "x", icon: "x", enabled: false, rank: "V", updatedAt: Date.now() });
    });
    const off = await create(a, PERSONAL, { templateId: known });
    expect(off.status).toBe("rejected");
    expect(off.error?.code).toBe("not_found");
    const bogus = await create(a, PERSONAL, { templateId: ulid() });
    expect(bogus.status).toBe("rejected");
  });
});

describe("Personal sync", () => {
  test("push and pull in Personal: the owner's feed, in commit order, with tombstones, invisible to others", async () => {
    const t = setup();
    const a = await person(t, "psync-a@example.com");
    const b = await person(t, "psync-b@example.com");
    const start = (await a.as.query(api.sync.head, { scope: PERSONAL })).seq;
    expect(start).toBeGreaterThan(0); // the seed content was stamped on the Personal counter
    const doc = (await create(a, PERSONAL, { title: "Ordered" })).document!;
    const one = para(ulid(), "one", "G");
    const two = para(ulid(), "two", "V");
    await upsertVia(a, PERSONAL, doc.id, one);
    await upsertVia(a, PERSONAL, doc.id, two);
    const [deleted] = await a.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-routing",
      ops: [{ opId: ulid(), kind: "block.delete", documentId: doc.id, blockId: one.id, baseRevision: null }],
    });
    expect(deleted!.status).toBe("applied");

    const pulled = await a.as.query(api.sync.pull, { scope: PERSONAL, cursor: start });
    expect(pulled.hasMore).toBe(false);
    expect(pulled.nextCursor).toBe(pulled.head);
    expect(pulled.documents.map((d) => d.id)).toContain(doc.id);
    const byId = new Map(pulled.blocks.map((x) => [x.block.id, x]));
    expect(byId.get(one.id)?.deleted).toBe(true);
    expect(byId.get(two.id)?.deleted).toBe(false);
    // Seq never goes backwards and every change advanced the head.
    expect(pulled.head).toBeGreaterThan(start);

    // Pages of a small limit walk everything exactly once, in order.
    const seen: string[] = [];
    let cursor = 0;
    for (let i = 0; i < 50; i++) {
      const page = await a.as.query(api.sync.pull, { scope: PERSONAL, cursor, limit: 5 });
      seen.push(...page.documents.map((d) => d.id));
      expect(page.nextCursor).toBeGreaterThanOrEqual(cursor);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(seen).toContain(doc.id);

    // Another person's Personal feed has none of this.
    const other = await b.as.query(api.sync.pull, { scope: PERSONAL, cursor: 0, limit: 500 });
    expect(other.documents.map((d) => d.id)).not.toContain(doc.id);
    expect(other.blocks.map((x) => x.block.id)).not.toContain(two.id);
  });
});

describe("derived label caches", () => {
  test("renaming a page refreshes page-block title caches and inline link labels without conflicts", async () => {
    const t = setup();
    const a = await person(t, "labels@example.com");
    const parent = (await create(a, PERSONAL, { title: "Parent" })).document!.id;
    const child = await create(a, PERSONAL, { parentDocumentId: parent, title: "Old name" });
    const childId = child.document!.id;
    const pageBlock = { id: ulid(), type: "page", parentId: null, rank: "G", schemaVersion: para("x", "").schemaVersion, text: [], props: { documentId: childId, display: "card", titleCache: "Old name" } };
    const linkBlock = { ...para(ulid(), "", "V"), text: [{ type: "text", text: "See " }, { type: "pageLink", documentId: childId, label: "Old name" }] };
    const r1 = await upsertVia(a, PERSONAL, parent, pageBlock as never);
    const r2 = await upsertVia(a, PERSONAL, parent, linkBlock as never);
    expect([r1.status, r2.status]).toEqual(["applied", "applied"]);

    const [renamed] = await a.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-routing",
      ops: [{ opId: ulid(), kind: "document.update", documentId: childId, patch: { title: "New name", icon: "🌿" }, baseRevision: child.revision! }],
    });
    expect(renamed!.status).toBe("applied");
    const blocks = await blocksOf(a, parent);
    const page = blocks.find((b) => b.id === pageBlock.id)!;
    expect(page.props).toMatchObject({ titleCache: "New name", iconCache: "🌿" });
    const link = blocks.find((b) => b.id === linkBlock.id)!;
    expect(link.text[1]).toMatchObject({ type: "pageLink", label: "New name" });

    // A concurrent content edit based on the pre-rename revision still applies (labels aren't content).
    const edit = await upsertVia(a, PERSONAL, parent, { ...linkBlock, text: [{ type: "text", text: "Read " }, { type: "pageLink", documentId: childId, label: "New name" }] } as never, r2.revision!);
    expect(edit.status).toBe("applied");
  });
});
