// Sync routing (docs/SYNC_PROTOCOL.md §Routing): ops are authorized per document, not per batch workspace.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { BUILT_IN_TEMPLATES, builtInTemplateBlocks } from "../../convex/lib/templates";
import { validateWireBlock } from "@folevi/editor-schema";
import { para, person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function create(p: Person, routing: string, document: Record<string, unknown>) {
  const [r] = await p.as.mutation(api.sync.push, {
    workspaceId: routing,
    deviceId: "device-routing",
    ops: [{ opId: ulid(), kind: "document.create", document: { parentDocumentId: null, folderId: null, kind: "document", title: "Doc", icon: null, id: ulid(), ...document } as never }],
  });
  return r!;
}

async function upsertVia(p: Person, routing: string, documentId: string, block: ReturnType<typeof para>, baseRevision: number | null = null) {
  const [r] = await p.as.mutation(api.sync.push, {
    workspaceId: routing,
    deviceId: "device-routing",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision, fields: ["content", "position"] }],
  });
  return r!;
}

async function blocksOf(p: Person, documentId: string) {
  return (await p.as.query(api.blocks.list, { documentId }))!.blocks;
}

async function joinTeam(t: T, owner: Person, member: Person, email: string, role: "editor" | "viewer" = "editor") {
  const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Team" });
  await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email, role });
  const invite = (await member.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")!;
  await member.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
  void t;
  return teamId;
}

describe("sync routing across workspaces", () => {
  test("a guest with an editor grant edits a page in someone else's workspace through their own queue", async () => {
    const t = setup();
    const owner = await person(t, "route-owner@example.com");
    const guest = await person(t, "route-guest@example.com");
    const docId = (await create(owner, owner.workspaceId, { title: "Shared plan" })).document!.id;
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "route-guest@example.com", role: "editor" });

    // The guest's batch is routed through their own workspace; the op still lands in the owner's page.
    const block = para(ulid(), "Guest was here");
    const r = await upsertVia(guest, guest.workspaceId, docId, block);
    expect(r.status).toBe("applied");
    expect((await blocksOf(owner, docId)).find((b) => b.id === block.id)?.text).toEqual([{ type: "text", text: "Guest was here" }]);

    // The change is stamped on the document's workspace sequence (members pulling see it).
    const head = (await owner.as.query(api.sync.head, { workspaceId: owner.workspaceId })).seq;
    const edit = await upsertVia(guest, guest.workspaceId, docId, { ...block, text: [{ type: "text", text: "Guest edited" }] }, r.revision!);
    expect(edit.status).toBe("applied");
    const pulled = await owner.as.query(api.sync.pull, { workspaceId: owner.workspaceId, cursor: head });
    expect(pulled.blocks.map((b) => b.block.id)).toContain(block.id);

    // Replays stay idempotent across routing.
    const opId = ulid();
    const again = para(ulid(), "once");
    const first = await guest.as.mutation(api.sync.push, {
      workspaceId: guest.workspaceId,
      deviceId: "device-routing",
      ops: [{ opId, kind: "block.upsert", documentId: docId, block: again, baseRevision: null, fields: ["content", "position"] }],
    });
    const second = await guest.as.mutation(api.sync.push, {
      workspaceId: owner.workspaceId, // routed differently the second time: still a duplicate
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
    const docId = (await create(owner, owner.workspaceId, { title: "Read only" })).document!.id;
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "route-viewer@example.com", role: "commenter" });
    const denied = await upsertVia(viewer, viewer.workspaceId, docId, para(ulid(), "nope"));
    expect(denied.status).toBe("rejected");
    expect(denied.error?.code).toBe("forbidden");
    const hidden = await upsertVia(stranger, owner.workspaceId, docId, para(ulid(), "nope"));
    expect(hidden.status).toBe("rejected");
    expect(hidden.error?.code).toBe("not_found");
  });

  test("guests can't add pages to a workspace they don't belong to", async () => {
    const t = setup();
    const owner = await person(t, "route-owner3@example.com");
    const guest = await person(t, "route-guest3@example.com");
    const docId = (await create(owner, owner.workspaceId, { title: "Shared" })).document!.id;
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "route-guest3@example.com", role: "editor" });
    const nested = await create(guest, guest.workspaceId, { parentDocumentId: docId, title: "Sub" });
    expect(nested.status).toBe("rejected");
    expect(nested.error?.code).toBe("forbidden");
    const direct = await create(guest, guest.workspaceId, { workspaceId: owner.workspaceId, title: "Sneaky" });
    expect(direct.status).toBe("rejected");
    expect(direct.error?.code).toBe("not_found");
  });

  test("creates follow their parent or explicit workspace, not the routing workspace", async () => {
    const t = setup();
    const owner = await person(t, "route-owner4@example.com");
    const member = await person(t, "route-member4@example.com");
    const teamId = await joinTeam(t, owner, member, "route-member4@example.com");
    // Queued while the team was selected, sent after switching back to the personal workspace.
    const explicit = await create(member, member.workspaceId, { workspaceId: teamId, title: "Team page" });
    expect(explicit.status).toBe("applied");
    expect(explicit.document!.workspaceId).toBe(teamId);
    const child = await create(member, member.workspaceId, { parentDocumentId: explicit.document!.id, title: "Team child" });
    expect(child.status).toBe("applied");
    expect(child.document!.workspaceId).toBe(teamId);
    const plain = await create(member, member.workspaceId, { title: "Mine" });
    expect(plain.document!.workspaceId).toBe(member.workspaceId);
    // Pages can't be re-parented across workspaces.
    const [moved] = await member.as.mutation(api.sync.push, {
      workspaceId: member.workspaceId,
      deviceId: "device-routing",
      ops: [{ opId: ulid(), kind: "document.update", documentId: plain.document!.id, patch: { parentDocumentId: explicit.document!.id }, baseRevision: plain.revision! }],
    });
    expect(moved!.status).toBe("rejected");
    expect(moved!.error?.code).toBe("invalid_argument");
  });

  test("one batch may mix documents from several workspaces; a stale routing workspace doesn't fail it", async () => {
    const t = setup();
    const owner = await person(t, "route-owner5@example.com");
    const member = await person(t, "route-member5@example.com");
    const teamId = await joinTeam(t, owner, member, "route-member5@example.com");
    const teamDoc = (await create(member, teamId, { title: "Team" })).document!.id;
    const ownDoc = (await create(member, member.workspaceId, { title: "Own" })).document!.id;
    const results = await member.as.mutation(api.sync.push, {
      workspaceId: member.workspaceId,
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
      workspaceId: teamId,
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
      const r = await create(a, a.workspaceId, { title: tpl.name, templateId: `builtin:${tpl.key}` });
      expect(r.status, tpl.key).toBe("applied");
    }
  });

  test("admin-disabled built-in templates and unreadable templates are rejected server-side", async () => {
    const t = setup();
    const a = await person(t, "route-templates@example.com");
    const known = `builtin:${BUILT_IN_TEMPLATES[0]!.key}`;
    const fine = await create(a, a.workspaceId, { templateId: known });
    expect(fine.status).toBe("applied");
    await t.run(async (ctx) => {
      await ctx.db.insert("builtInTemplates", { key: known.slice(8), name: "x", description: "x", icon: "x", enabled: false, rank: "V", updatedAt: Date.now() });
    });
    const off = await create(a, a.workspaceId, { templateId: known });
    expect(off.status).toBe("rejected");
    expect(off.error?.code).toBe("not_found");
    const bogus = await create(a, a.workspaceId, { templateId: ulid() });
    expect(bogus.status).toBe("rejected");
  });
});

describe("derived label caches", () => {
  test("renaming a page refreshes page-block title caches and inline link labels without conflicts", async () => {
    const t = setup();
    const a = await person(t, "labels@example.com");
    const parent = (await create(a, a.workspaceId, { title: "Parent" })).document!.id;
    const child = await create(a, a.workspaceId, { parentDocumentId: parent, title: "Old name" });
    const childId = child.document!.id;
    const pageBlock = { id: ulid(), type: "page", parentId: null, rank: "G", schemaVersion: para("x", "").schemaVersion, text: [], props: { documentId: childId, display: "card", titleCache: "Old name" } };
    const linkBlock = { ...para(ulid(), "", "V"), text: [{ type: "text", text: "See " }, { type: "pageLink", documentId: childId, label: "Old name" }] };
    const r1 = await upsertVia(a, a.workspaceId, parent, pageBlock as never);
    const r2 = await upsertVia(a, a.workspaceId, parent, linkBlock as never);
    expect([r1.status, r2.status]).toEqual(["applied", "applied"]);

    const [renamed] = await a.as.mutation(api.sync.push, {
      workspaceId: a.workspaceId,
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
    const edit = await upsertVia(a, a.workspaceId, parent, { ...linkBlock, text: [{ type: "text", text: "Read " }, { type: "pageLink", documentId: childId, label: "New name" }] } as never, r2.revision!);
    expect(edit.status).toBe("applied");
  });
});
