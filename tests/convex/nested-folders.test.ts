// Nested folders: folders inside folders, up to five levels, within one Personal or workspace.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_FOLDER_DEPTH } from "@folevi/editor-schema";
import { join, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function folder(p: Person, name: string, parentFolderId?: string, scope: ScopeArg = PERSONAL) {
  return (await p.as.mutation(api.organization.createFolder, { scope, name, parentFolderId })).id;
}

async function tree(p: Person, scope: ScopeArg = PERSONAL) {
  const { folders } = await p.as.query(api.organization.sidebar, { scope });
  const byId = new Map(folders.map((f) => [f.id, f]));
  return new Map(folders.map((f) => [f.name, f.parentFolderId ? byId.get(f.parentFolderId)!.name : null]));
}

async function newDoc(p: Person, title: string, folderId: string | null, scope: ScopeArg = PERSONAL) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-nested-folders",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

const inFolder = async (p: Person, folderId: string, scope: ScopeArg = PERSONAL) =>
  (await p.as.query(api.documents.list, { scope, view: "folder", folderId, paginationOpts: { numItems: 50, cursor: null } })).page.map((d) => d.title).sort();

describe("nested folders", () => {
  test(`folders nest up to ${MAX_FOLDER_DEPTH} levels`, async () => {
    const t = setup();
    const a = await person(t, "nest-depth@example.com");
    const chain: string[] = [];
    for (let i = 1; i <= MAX_FOLDER_DEPTH; i++) chain.push(await folder(a, `Level ${i}`, chain[i - 2]));
    expect((await tree(a)).get(`Level ${MAX_FOLDER_DEPTH}`)).toBe(`Level ${MAX_FOLDER_DEPTH - 1}`);
    await expect(folder(a, "Too deep", chain[MAX_FOLDER_DEPTH - 1])).rejects.toThrow(/nested up to 5 levels/);

    // Moving counts what's inside the folder too: a folder with a subfolder fits one level higher only.
    const pair = await folder(a, "Pair");
    await folder(a, "Pair child", pair);
    await expect(a.as.mutation(api.organization.moveFolder, { folderId: pair, parentFolderId: chain[MAX_FOLDER_DEPTH - 2]! })).rejects.toThrow(/nested up to 5 levels/);
    await a.as.mutation(api.organization.moveFolder, { folderId: pair, parentFolderId: chain[MAX_FOLDER_DEPTH - 3]! });
    const after = await tree(a);
    expect(after.get("Pair")).toBe(`Level ${MAX_FOLDER_DEPTH - 2}`);
    expect(after.get("Pair child")).toBe("Pair");
    // Back to the top level.
    await a.as.mutation(api.organization.moveFolder, { folderId: pair, parentFolderId: null });
    expect((await tree(a)).get("Pair")).toBeNull();
  });

  test("a folder can't move into itself or one of its subfolders", async () => {
    const t = setup();
    const a = await person(t, "nest-cycle@example.com");
    const work = await folder(a, "Work");
    const clients = await folder(a, "Clients", work);
    const acme = await folder(a, "Acme", clients);
    await expect(a.as.mutation(api.organization.moveFolder, { folderId: work, parentFolderId: work })).rejects.toThrow(/inside itself/);
    await expect(a.as.mutation(api.organization.moveFolder, { folderId: work, parentFolderId: acme })).rejects.toThrow(/inside itself/);
    await expect(a.as.mutation(api.organization.moveFolder, { folderId: clients, parentFolderId: acme })).rejects.toThrow(/inside itself/);
    // Sideways and up are fine.
    await a.as.mutation(api.organization.moveFolder, { folderId: acme, parentFolderId: work });
    expect((await tree(a)).get("Acme")).toBe("Work");
  });

  test("folders nest only inside their own Personal or workspace", async () => {
    const t = setup();
    const a = await person(t, "nest-scope@example.com");
    const b = await person(t, "nest-scope-b@example.com");
    const { workspaceId, scope } = await teamWorkspace(a, "Studio");
    const mine = await folder(a, "Mine");
    const team = await folder(a, "Team folder", undefined, scope);
    const theirs = await folder(b, "Theirs");
    // A Personal folder can't go into a workspace folder (or the other way), nor into someone else's folder.
    await expect(a.as.mutation(api.organization.moveFolder, { folderId: mine, parentFolderId: team })).rejects.toThrow(/Folder not found/);
    await expect(a.as.mutation(api.organization.moveFolder, { folderId: team, parentFolderId: mine })).rejects.toThrow(/Folder not found/);
    await expect(a.as.mutation(api.organization.moveFolder, { folderId: mine, parentFolderId: theirs })).rejects.toThrow(/Folder not found/);
    await expect(folder(a, "Sneaky", team)).rejects.toThrow(/Folder not found/);
    await expect(folder(a, "Sneaky", mine, scope)).rejects.toThrow(/Folder not found/);

    // Folder access is the workspace's as before: viewers can't add or move folders, editors can.
    const viewer = await person(t, "nest-viewer@example.com");
    const editor = await person(t, "nest-editor@example.com");
    await join(t, a, viewer, "nest-viewer@example.com", workspaceId, "viewer");
    await join(t, a, editor, "nest-editor@example.com", workspaceId, "editor");
    await expect(folder(viewer, "Nope", team, scope)).rejects.toThrow(/permission/);
    const sub = await folder(editor, "Sub", team, scope);
    await expect(viewer.as.mutation(api.organization.moveFolder, { folderId: sub, parentFolderId: null })).rejects.toThrow(/Folder not found|permission/);
    expect((await tree(viewer, scope)).get("Sub")).toBe("Team folder");
  });

  test("deleting a folder moves its notes to Drafts and its subfolders up a level", async () => {
    const t = setup();
    const a = await person(t, "nest-delete@example.com");
    const work = await folder(a, "Work");
    const clients = await folder(a, "Clients", work);
    const acme = await folder(a, "Acme", clients);
    const beta = await folder(a, "Beta", clients);
    await newDoc(a, "Client list", clients);
    await newDoc(a, "Acme brief", acme);

    await a.as.mutation(api.organization.deleteFolder, { folderId: clients });
    const after = await tree(a);
    expect(after.has("Clients")).toBe(false);
    expect(after.get("Acme")).toBe("Work");
    expect(after.get("Beta")).toBe("Work");
    // The subfolders keep their notes; the deleted folder's own notes are in Drafts.
    expect(await inFolder(a, acme)).toEqual(["Acme brief"]);
    expect(await inFolder(a, beta)).toEqual([]);
    const drafts = await a.as.query(api.documents.list, { scope: PERSONAL, view: "unsorted", paginationOpts: { numItems: 100, cursor: null } });
    expect(drafts.page.map((d) => d.title)).toContain("Client list");

    // A top-level folder's subfolders become top-level folders.
    await a.as.mutation(api.organization.deleteFolder, { folderId: work });
    const top = await tree(a);
    expect(top.get("Acme")).toBeNull();
    expect(top.get("Beta")).toBeNull();
  });

  test("notes file into nested folders through sync, and exports keep the folder path", async () => {
    const t = setup();
    const a = await person(t, "nest-sync@example.com");
    const work = await folder(a, "Work");
    const clients = await folder(a, "Clients", work);
    const acme = await folder(a, "Acme", clients);
    const id = await newDoc(a, "Kickoff", clients);
    expect(await inFolder(a, clients)).toEqual(["Kickoff"]);

    // An older client's update (folderId only, nothing about nesting) moves it deeper.
    const [moved] = await a.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-nested-folders",
      ops: [{ opId: ulid(), kind: "document.update", documentId: id, patch: { folderId: acme }, baseRevision: null }],
    });
    expect(moved!.status).toBe("applied");
    expect(await inFolder(a, acme)).toEqual(["Kickoff"]);
    expect(await inFolder(a, clients)).toEqual([]);

    const page = await t.query(internal.exports.documentPage, { profileId: a.profileId as Id<"profiles">, scope: { kind: "personal", profileId: a.profileId as Id<"profiles"> }, cursor: null });
    expect(page.docs.find((d) => d.id === id)?.folderPath).toEqual(["Work", "Clients", "Acme"]);
  });
});
