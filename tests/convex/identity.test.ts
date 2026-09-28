// Workspace identity: the fixed "Personal" name, collaborators in personal workspaces, team logos and
// profile pictures (upload authorization, replacement cleanup and what mine()/me() expose).
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { person, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

// A valid 1×1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Runs the real upload flow (intent → stored bytes → verified finalize) and returns the file's public id. */
async function upload(t: T, p: Person, kind: "avatar" | "logo", workspaceId: string): Promise<string> {
  const { intentId } = await p.as.mutation(api.files.generateUploadUrl, { workspaceId, filename: "me.png", size: PNG.length, mimeType: "image/png", kind });
  const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([PNG], { type: "image/png" })));
  const res = await p.as.action(api.files.finalize, { intentId, storageId, sha256: await sha256(PNG) });
  return res.fileId;
}

async function join(owner: Person, member: Person, workspaceId: string, email: string, role: "editor" | "admin" | "viewer" = "editor") {
  await owner.as.mutation(api.workspaces.invite, { workspaceId, email, role });
  const invite = (await member.as.query(api.notifications.list, {})).find((n) => n.kind === "invite" && !n.readAt)!;
  await member.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
}

async function fileCount(t: T): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.query("files").collect()).length);
}

describe("personal workspace name", () => {
  test("new personal workspaces are called Personal and can't be renamed; teams can", async () => {
    const t = setup();
    const a = await person(t, "name-a@example.com");
    const [personal] = await a.as.query(api.workspaces.mine, {});
    expect(personal).toMatchObject({ kind: "personal", name: "Personal" });
    await expect(a.as.mutation(api.workspaces.rename, { workspaceId: a.workspaceId, name: "My place" })).rejects.toThrow(/always called Personal/);
    // Changing only the icon still works.
    await a.as.mutation(api.workspaces.rename, { workspaceId: a.workspaceId, name: "Personal", icon: "🌿" });
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    await a.as.mutation(api.workspaces.rename, { workspaceId: teamId, name: "Crew 2" });
    expect((await a.as.query(api.workspaces.mine, {})).map((w) => w.name).sort()).toEqual(["Crew 2", "Personal"]);
  });

  test("onboarding keeps the personal workspace's name", async () => {
    const t = setup();
    const a = await person(t, "name-onboard@example.com");
    await a.as.mutation(api.users.completeOnboardingStep, { step: "workspace", workspaceName: "Something else" });
    expect((await a.as.query(api.workspaces.mine, {}))[0]!.name).toBe("Personal");
    const me = await a.as.query(api.users.me, {});
    expect(me.state === "ready" && me.profile.onboardingStep).toBe("appearance");
  });

  test("the migration renames existing personal workspaces only", async () => {
    const t = setup();
    const a = await person(t, "name-mig@example.com");
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    await t.run(async (ctx) => {
      for (const w of await ctx.db.query("workspaces").collect()) if (w.kind === "personal") await ctx.db.patch(w._id, { name: "Name's Folio" });
    });
    const r = await t.mutation(internal.migrations.renamePersonalWorkspaces, {});
    expect(r).toEqual({ updated: 1, done: true });
    const names = Object.fromEntries((await a.as.query(api.workspaces.mine, {})).map((w) => [w.id, w.name]));
    expect(names[a.workspaceId]).toBe("Personal");
    expect(names[teamId]).toBe("Crew");
  });
});

describe("collaborators in personal workspaces", () => {
  test("people can be invited to a personal workspace and join it", async () => {
    const t = setup();
    const owner = await person(t, "collab-owner@example.com");
    const guest = await person(t, "collab-guest@example.com");
    await join(owner, guest, owner.workspaceId, "collab-guest@example.com");
    const notes = await guest.as.query(api.notifications.list, {});
    expect(notes.find((n) => n.kind === "invite")?.title).toMatch(/collab-owner’s personal workspace/);
    const theirs = (await guest.as.query(api.workspaces.mine, {})).find((w) => w.id === owner.workspaceId);
    expect(theirs).toMatchObject({ kind: "personal", role: "editor", isDefault: false });
    // Told apart from the guest's own "Personal" by the owner's name; your own has none.
    expect(theirs?.ownerName).toBeTruthy();
    expect((await guest.as.query(api.workspaces.mine, {})).find((w) => w.id === guest.workspaceId)?.ownerName).toBeNull();
    const members = await owner.as.query(api.workspaces.members, { workspaceId: owner.workspaceId });
    expect(members.members).toHaveLength(2);
    // Still can't change hands.
    await expect(owner.as.mutation(api.workspaces.transferOwnership, { workspaceId: owner.workspaceId, profileId: guest.profileId })).rejects.toThrow(/can't be transferred/);
    // A collaborator can leave.
    await guest.as.mutation(api.workspaces.removeMember, { workspaceId: owner.workspaceId, profileId: guest.profileId });
    expect((await guest.as.query(api.workspaces.mine, {})).map((w) => w.id)).not.toContain(owner.workspaceId);
  });

  test("unassigned tasks count as the owner's, not a collaborator's", async () => {
    const t = setup();
    const owner = await person(t, "collab-tasks@example.com");
    const guest = await person(t, "collab-tasks2@example.com");
    await join(owner, guest, owner.workspaceId, "collab-tasks2@example.com");
    const r = await owner.as.mutation(api.tasks.quickAdd, { workspaceId: owner.workspaceId, title: "Water the plants", today: "2026-09-25" });
    const view = { workspaceId: owner.workspaceId, view: "mine" as const, today: "2026-09-25" };
    expect((await owner.as.query(api.tasks.list, view)).map((x) => x.blockId)).toContain(r.blockId);
    expect((await guest.as.query(api.tasks.list, view)).map((x) => x.blockId)).not.toContain(r.blockId);
    await owner.as.mutation(api.tasks.update, { blockId: r.blockId, assigneeId: guest.profileId });
    expect((await guest.as.query(api.tasks.list, view)).map((x) => x.blockId)).toContain(r.blockId);
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
    await join(a, b, teamId, "logo-editor@example.com");
    await expect(upload(t, b, "logo", teamId)).rejects.toThrow(/forbidden|permission|admin/i);
    const fileId = await upload(t, a, "logo", teamId);
    await expect(b.as.mutation(api.workspaces.setLogo, { workspaceId: teamId, fileId })).rejects.toThrow();
    await expect(b.as.mutation(api.workspaces.removeLogo, { workspaceId: teamId })).rejects.toThrow();
  });

  test("a personal workspace can't have a logo, and an avatar can't be used as a logo", async () => {
    const t = setup();
    const a = await person(t, "logo-personal@example.com");
    await expect(upload(t, a, "logo", a.workspaceId)).rejects.toThrow(/profile picture/);
    const avatar = await upload(t, a, "avatar", a.workspaceId);
    await expect(a.as.mutation(api.workspaces.setLogo, { workspaceId: a.workspaceId, fileId: avatar })).rejects.toThrow(/profile picture/);
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    await expect(a.as.mutation(api.workspaces.setLogo, { workspaceId: teamId, fileId: avatar })).rejects.toThrow(/wasn't found/);
  });

  test("logos and avatars are small images only", async () => {
    const t = setup();
    const a = await person(t, "logo-size@example.com");
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    const big = { filename: "big.png", size: 3 * 1024 * 1024, mimeType: "image/png" };
    await expect(a.as.mutation(api.files.generateUploadUrl, { workspaceId: teamId, kind: "logo", ...big })).rejects.toThrow(/up to 2 MB/);
    await expect(a.as.mutation(api.files.generateUploadUrl, { workspaceId: a.workspaceId, kind: "avatar", ...big })).rejects.toThrow(/up to 2 MB/);
    // Bytes that aren't an image are refused at finalize, whatever the declared type.
    const text = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const { intentId } = await a.as.mutation(api.files.generateUploadUrl, { workspaceId: teamId, kind: "logo", filename: "x.png", size: text.length, mimeType: "image/png" });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([text])));
    await expect(a.as.action(api.files.finalize, { intentId, storageId, sha256: await sha256(text) })).rejects.toThrow(/PNG, JPEG, GIF or WebP/);
  });
});

describe("profile pictures", () => {
  test("your avatar shows on your profile and as your personal workspace's picture, also for collaborators", async () => {
    const t = setup();
    const a = await person(t, "avatar-a@example.com");
    const b = await person(t, "avatar-b@example.com");
    await join(a, b, a.workspaceId, "avatar-b@example.com", "viewer");
    const meA = async () => {
      const me = await a.as.query(api.users.me, {});
      if (me.state !== "ready") throw new Error(me.state);
      return me.profile;
    };
    expect((await meA()).avatarUrl).toBeNull();
    // The client's workspace id is ignored for avatars: they always live in your personal workspace.
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    const fileId = await upload(t, a, "avatar", teamId);
    await a.as.mutation(api.users.setAvatar, { fileId });
    const avatarUrl = (await meA()).avatarUrl;
    expect(avatarUrl).toContain(`/files/${fileId}?`);
    const mine = await a.as.query(api.workspaces.mine, {});
    expect(mine.find((w) => w.id === a.workspaceId)).toMatchObject({ logoUrl: avatarUrl, storageUsedBytes: PNG.length });
    expect(mine.find((w) => w.id === teamId)!.logoUrl).toBeNull();
    // A collaborator sees the owner's avatar for that workspace, and their own avatar isn't involved.
    const theirs = await b.as.query(api.workspaces.mine, {});
    expect(theirs.find((w) => w.id === a.workspaceId)!.logoUrl).toBe(avatarUrl);
    expect(theirs.find((w) => w.id === b.workspaceId)!.logoUrl).toBeNull();
    // Someone else can't claim your upload as their avatar.
    await expect(b.as.mutation(api.users.setAvatar, { fileId })).rejects.toThrow(/wasn't found/);

    const before = await fileCount(t);
    const next = await upload(t, a, "avatar", a.workspaceId);
    await a.as.mutation(api.users.setAvatar, { fileId: next });
    expect(await fileCount(t)).toBe(before);
    await a.as.mutation(api.users.removeAvatar, {});
    expect((await meA()).avatarUrl).toBeNull();
    expect(await fileCount(t)).toBe(before - 1);
    expect((await a.as.query(api.workspaces.mine, {})).find((w) => w.id === a.workspaceId)).toMatchObject({ logoUrl: null, storageUsedBytes: 0 });
  });

  test("avatars and logos can't be attached to a page", async () => {
    const t = setup();
    const a = await person(t, "avatar-doc@example.com");
    await expect(
      a.as.mutation(api.files.generateUploadUrl, { workspaceId: a.workspaceId, documentId: "01J00000000000000000000000", kind: "avatar", filename: "a.png", size: 10, mimeType: "image/png" }),
    ).rejects.toThrow(/can't be attached/);
  });
});
