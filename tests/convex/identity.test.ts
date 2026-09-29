// Identity: Personal (not a workspace), sharing from it, team logos and profile pictures (upload
// authorization, replacement cleanup and what mine()/me() expose).
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { inWorkspace, join as joinWorkspace, person, PERSONAL, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

// A valid 1×1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Runs the real upload flow (intent → stored bytes → verified finalize) and returns the file's public id. */
async function upload(t: T, p: Person, kind: "avatar" | "logo", workspaceId?: string): Promise<string> {
  const scope = workspaceId ? inWorkspace(workspaceId) : undefined;
  const { intentId } = await p.as.mutation(api.files.generateUploadUrl, { scope, filename: "me.png", size: PNG.length, mimeType: "image/png", kind });
  const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([PNG], { type: "image/png" })));
  const res = await p.as.action(api.files.finalize, { intentId, storageId, sha256: await sha256(PNG) });
  return res.fileId;
}

async function join(t: T, owner: Person, member: Person, workspaceId: string, email: string, role: "editor" | "admin" | "viewer" = "editor") {
  await joinWorkspace(t, owner, member, email, workspaceId, role);
}

async function fileCount(t: T): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.query("files").collect()).length);
}

describe("Personal is not a workspace", () => {
  test("a new account has Personal and no workspace; team workspaces can be renamed", async () => {
    const t = setup();
    const a = await person(t, "name-a@example.com");
    expect(await a.as.query(api.workspaces.mine, {})).toEqual([]);
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    await a.as.mutation(api.workspaces.rename, { workspaceId: teamId, name: "Crew 2" });
    expect((await a.as.query(api.workspaces.mine, {})).map((w) => [w.name, w.role])).toEqual([["Crew 2", "owner"]]);
  });

  test("onboarding needs no workspace name", async () => {
    const t = setup();
    const a = await person(t, "name-onboard@example.com");
    await a.as.mutation(api.users.completeOnboardingStep, { step: "workspace", workspaceName: "Something else" });
    expect(await a.as.query(api.workspaces.mine, {})).toEqual([]);
    const me = await a.as.query(api.users.me, {});
    expect(me.state === "ready" && me.profile.onboardingStep).toBe("uses");
  });
});

describe("sharing from Personal", () => {
  test("Personal takes no members: people are added to pages (guests)", async () => {
    const t = setup();
    const owner = await person(t, "collab-owner@example.com");
    const guest = await person(t, "collab-guest@example.com");
    const { id: docId } = await owner.as.mutation(api.documents.create, { scope: PERSONAL, title: "Garden plan" });
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "collab-guest@example.com", role: "editor" });
    // The guest sees the page, marked as someone else's Personal, and nothing else of it.
    const got = await guest.as.query(api.documents.get, { documentId: docId });
    expect(got).toMatchObject({ access: "write", isMember: false, document: { workspaceId: null, ownerProfileId: owner.profileId } });
    expect(await guest.as.query(api.workspaces.mine, {})).toEqual([]);
    const shared = await guest.as.query(api.sharing.sharedWithMe, {});
    expect(shared.find((d) => d.id === docId)).toMatchObject({ workspaceName: null, ownerName: "collab-owner", role: "editor" });
  });

  test("unassigned tasks in Personal are the owner's; a guest can be assigned, a stranger can't", async () => {
    const t = setup();
    const owner = await person(t, "collab-tasks@example.com");
    const guest = await person(t, "collab-tasks2@example.com");
    await person(t, "collab-stranger@example.com");
    const r = await owner.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "Water the plants", today: "2026-09-25" });
    const view = { scope: PERSONAL, view: "mine" as const, today: "2026-09-25" };
    expect((await owner.as.query(api.tasks.list, view)).map((x) => x.blockId)).toContain(r.blockId);
    // The guest's "Personal" is their own: the owner's tasks are never listed there.
    expect((await guest.as.query(api.tasks.list, view)).map((x) => x.blockId)).not.toContain(r.blockId);
    const strangerId = await t.run(async (ctx) => (await ctx.db.query("profiles").collect()).find((p) => p.email === "collab-stranger@example.com")!._id);
    await expect(owner.as.mutation(api.tasks.update, { blockId: r.blockId, assigneeId: strangerId })).rejects.toThrow(/able to see this note/);
    await owner.as.mutation(api.sharing.grant, { documentId: r.documentId, email: "collab-tasks2@example.com", role: "editor" });
    await owner.as.mutation(api.tasks.update, { blockId: r.blockId, assigneeId: guest.profileId });
    // Assigned away, it's no longer the owner's.
    expect((await owner.as.query(api.tasks.list, view)).map((x) => x.blockId)).not.toContain(r.blockId);
  });
});

describe("workspace logos", () => {
  test("owners and admins set a team logo; replacing and removing delete the old file", async () => {
    const t = setup();
    const a = await person(t, "logo-a@example.com");
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    const logoOf = async () => (await a.as.query(api.workspaces.mine, {})).find((w) => w.id === teamId)!;
    expect((await logoOf()).logoUrl).toBeNull();
    const first = await upload(t, a, "logo", teamId);
    await a.as.mutation(api.workspaces.setLogo, { workspaceId: teamId, fileId: first });
    const withLogo = await logoOf();
    expect(withLogo.logoUrl).toMatch(new RegExp(`/files/${first}\\?exp=\\d+&sig=[0-9a-f]+$`));
    expect(withLogo.storageUsedBytes).toBe(PNG.length);
    const before = await fileCount(t);
    const second = await upload(t, a, "logo", teamId);
    await a.as.mutation(api.workspaces.setLogo, { workspaceId: teamId, fileId: second });
    expect(await fileCount(t)).toBe(before); // one added, the old one deleted
    expect((await logoOf()).logoUrl).toContain(`/files/${second}?`);
    expect((await logoOf()).storageUsedBytes).toBe(PNG.length);
    await a.as.mutation(api.workspaces.removeLogo, { workspaceId: teamId });
    expect(await fileCount(t)).toBe(before - 1);
    expect(await logoOf()).toMatchObject({ logoUrl: null, storageUsedBytes: 0 });
  });

  test("editors can't set a team logo", async () => {
    const t = setup();
    const a = await person(t, "logo-owner@example.com");
    const b = await person(t, "logo-editor@example.com");
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    await join(t, a, b, teamId, "logo-editor@example.com");
    await expect(upload(t, b, "logo", teamId)).rejects.toThrow(/forbidden|permission|admin/i);
    const fileId = await upload(t, a, "logo", teamId);
    await expect(b.as.mutation(api.workspaces.setLogo, { workspaceId: teamId, fileId })).rejects.toThrow();
    await expect(b.as.mutation(api.workspaces.removeLogo, { workspaceId: teamId })).rejects.toThrow();
  });

  test("a logo needs a workspace, and an avatar can't be used as a logo", async () => {
    const t = setup();
    const a = await person(t, "logo-personal@example.com");
    await expect(upload(t, a, "logo")).rejects.toThrow(/belong to a workspace/);
    await expect(a.as.mutation(api.files.generateUploadUrl, { scope: PERSONAL, filename: "l.png", size: PNG.length, mimeType: "image/png", kind: "logo" })).rejects.toThrow(/belong to a workspace/);
    const avatar = await upload(t, a, "avatar");
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    await expect(a.as.mutation(api.workspaces.setLogo, { workspaceId: teamId, fileId: avatar })).rejects.toThrow(/wasn't found/);
  });

  test("logos and avatars are small images only", async () => {
    const t = setup();
    const a = await person(t, "logo-size@example.com");
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    const big = { filename: "big.png", size: 3 * 1024 * 1024, mimeType: "image/png" };
    await expect(a.as.mutation(api.files.generateUploadUrl, { scope: inWorkspace(teamId), kind: "logo", ...big })).rejects.toThrow(/up to 2 MB/);
    await expect(a.as.mutation(api.files.generateUploadUrl, { kind: "avatar", ...big })).rejects.toThrow(/up to 2 MB/);
    // Bytes that aren't an image are refused at finalize, whatever the declared type.
    const text = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const { intentId } = await a.as.mutation(api.files.generateUploadUrl, { scope: inWorkspace(teamId), kind: "logo", filename: "x.png", size: text.length, mimeType: "image/png" });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([text])));
    await expect(a.as.action(api.files.finalize, { intentId, storageId, sha256: await sha256(text) })).rejects.toThrow(/PNG, JPEG, GIF or WebP/);
  });
});

describe("profile pictures", () => {
  test("your avatar shows on your profile and is a Personal file (counted in personal storage only)", async () => {
    const t = setup();
    const a = await person(t, "avatar-a@example.com");
    const b = await person(t, "avatar-b@example.com");
    const meA = async () => {
      const me = await a.as.query(api.users.me, {});
      if (me.state !== "ready") throw new Error(me.state);
      return me.profile;
    };
    expect((await meA()).avatarUrl).toBeNull();
    // The client's scope is ignored for avatars: they're always your Personal files.
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    const fileId = await upload(t, a, "avatar", teamId);
    await a.as.mutation(api.users.setAvatar, { fileId });
    const avatarUrl = (await meA()).avatarUrl;
    expect(avatarUrl).toContain(`/files/${fileId}?`);
    expect((await a.as.query(api.billing.mine, {})).storageUsedBytes).toBe(PNG.length);
    expect((await a.as.query(api.workspaces.mine, {})).find((w) => w.id === teamId)).toMatchObject({ logoUrl: null, storageUsedBytes: 0 });
    await t.run(async (ctx) => {
      const f = (await ctx.db.query("files").collect()).find((x) => x.publicId === fileId)!;
      expect(f.ownerProfileId).toBe(a.profileId);
      expect(f.workspaceId).toBeUndefined();
    });
    // Someone else can't claim your upload as their avatar.
    await expect(b.as.mutation(api.users.setAvatar, { fileId })).rejects.toThrow(/wasn't found/);

    const before = await fileCount(t);
    const next = await upload(t, a, "avatar");
    await a.as.mutation(api.users.setAvatar, { fileId: next });
    expect(await fileCount(t)).toBe(before);
    await a.as.mutation(api.users.removeAvatar, {});
    expect((await meA()).avatarUrl).toBeNull();
    expect(await fileCount(t)).toBe(before - 1);
    expect((await a.as.query(api.billing.mine, {})).storageUsedBytes).toBe(0);
  });

  test("avatars and logos can't be attached to a page", async () => {
    const t = setup();
    const a = await person(t, "avatar-doc@example.com");
    await expect(
      a.as.mutation(api.files.generateUploadUrl, { scope: PERSONAL, documentId: "01J00000000000000000000000", kind: "avatar", filename: "a.png", size: 10, mimeType: "image/png" }),
    ).rejects.toThrow(/can't be attached/);
  });
});
