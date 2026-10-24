// Revision 11 through the bridge host: declining invitations, the support form, folder locks, a note's changes
// block by block, All folders, and Foli AI drafts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import type { ChangeDiffValue, FolderCardsValue, Reply, SessionValue } from "@/lib/engine/protocol";
import { Posts, rig, type Rig } from "./fakes";

const setUpSpace = vi.fn(async () => undefined);
vi.mock("@/lib/e2ee/keys", () => ({ setup: { setUpSpace } }));

const PLACE = "acct:user_1";
let host: BridgeHost;
let r: Rig;
let n = 0;
let keys = false;
const send = async (m: Record<string, unknown>) => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
const ok = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
};
const code = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  return reply.ok ? null : reply.error.code;
};
const query = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "query", place: PLACE, name, args });
const command = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "command", place: PLACE, name, args });
const refused = (name: string, args: Record<string, unknown>) => code({ kind: "command", place: PLACE, name, args });

beforeEach(() => {
  keys = false;
  setUpSpace.mockClear();
  host = new BridgeHost({ post: new Posts().post, schedule: () => undefined, marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  host.attach({ ...r.deps(), hasKeys: () => keys });
  n = 0;
});
afterEach(() => {
  host.dispose();
  resetNoteHost();
  resetGates();
});

describe("invitations and support", () => {
  it("invite.decline by id or by token", async () => {
    await command("invite.decline", { kind: "workspace", inviteId: "winv_1" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "workspaces:declineInvite", args: { inviteId: "winv_1" } });
    await command("invite.decline", { kind: "page", token: "tok_1" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "sharing:declinePageInvite", args: { token: "tok_1" } });
    expect(await refused("invite.decline", { kind: "page" })).toBe("invalid_args");
    expect(await refused("invite.decline", { kind: "page", inviteId: "a", token: "b" })).toBe("invalid_args");
  });

  it("support.send files through Convex and passes the server's refusals on", async () => {
    r.client.mutate = () => ({ status: "received", number: 1042 });
    expect(await command("support.send", { topic: "sync", message: "It didn't sync after I came back online." })).toEqual({ number: 1042 });
    expect(r.client.mutations.at(-1)).toEqual({ name: "support:submitFromApp", args: { topic: "sync", message: "It didn't sync after I came back online.", name: "" } });
    r.client.mutate = () => {
      throw new ConvexError({ code: "rate_limited", message: "Wait a while." });
    };
    expect(await refused("support.send", { topic: "sync", message: "Again, it didn't sync." })).toBe("rate_limited");
    expect(await query("support.topics")).toMatchObject({ topics: expect.arrayContaining([{ id: "sync", label: "Sync and offline" }]) });
  });
});

describe("folder locks", () => {
  it("session says where locks are offered", async () => {
    let s = (await query("session")) as SessionValue;
    expect(s.spaces.map((x) => [x.id, x.canLock, x.level])).toEqual([["personal", false, "standard"], ["ws1", false, "standard"], ["ws_vault", false, "standard"]]);
    host.dispose();
    host = new BridgeHost({ post: new Posts().post, schedule: () => undefined, marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
    keys = true;
    r.encrypted.add("ws_vault");
    host.attach({ ...r.deps(), hasKeys: () => keys });
    s = (await query("session")) as SessionValue;
    expect(s.spaces.map((x) => [x.id, x.canLock, x.level])).toEqual([["personal", true, "standard"], ["ws1", true, "standard"], ["ws_vault", true, "encrypted"]]);
  });

  it("folder.lock makes the space's key first when it has none", async () => {
    keys = true;
    let first = true;
    r.client.mutate = () => {
      if (first) {
        first = false;
        throw new ConvexError({ code: "e2ee_not_set_up", message: "No key yet." });
      }
      return null;
    };
    await command("folder.lock", { id: "f1", locked: true, space: "ws1" });
    expect(setUpSpace).toHaveBeenCalledWith({ kind: "workspace", workspaceId: "ws1" });
    expect(r.client.mutations.map((m) => m.name)).toEqual(["e2ee/content:setFolderLocked", "e2ee/content:setFolderLocked"]);
    // Without keys the refusal goes to native (it shows encryption setup first).
    keys = false;
    first = true;
    expect(await refused("folder.lock", { id: "f1", locked: true })).toBe("e2ee_not_set_up");
  });
});

describe("All folders", () => {
  it("every folder in tree order, with where it is and its lock", async () => {
    r.client.answer("organization:sidebar", {
      folders: [
        { id: "f2", name: "Japan", color: null, parentFolderId: "f1", rank: "a" },
        { id: "f1", name: "Trips", color: "moss", parentFolderId: null, rank: "a" },
        { id: "f3", name: "Kyoto", color: null, parentFolderId: "f2", rank: "a", locked: true },
        { id: "f4", name: "Work", color: null, parentFolderId: null, rank: "b" },
      ],
      tags: [],
    });
    r.client.answer("organization:index", { folders: [{ id: "f2", name: "Japan", color: null, parentFolderId: "f1", rank: "a", createdAt: 5, updatedAt: 9, documentCount: 5, previews: [] }], tags: [] });
    const v = (await query("folders.cards", { all: true })) as FolderCardsValue;
    expect(v.folders.map((f) => [f.name, f.path, f.locked, f.createdAt])).toEqual([
      ["Trips", null, false, 0],
      ["Japan", "Trips", false, 5],
      ["Kyoto", "Trips / Japan", true, 0],
      ["Work", null, false, 0],
    ]);
    const top = (await query("folders.cards")) as FolderCardsValue;
    expect(top.folders.map((f) => f.name)).toEqual(["Trips", "Work"]);
  });
});

describe("changes.diff", () => {
  it("the changed lines, word by word when the version from before is known", async () => {
    const para = (id: string, text: string) => ({ id, parentId: null, rank: "a" + id, type: "paragraph", props: {}, text: [{ type: "text", text }] });
    r.client.answer("changes:list", { notes: [{ id: "d1", title: "Kyoto" }], people: {} });
    r.client.answer("changes:note", {
      blocks: [para("b1", "Day two: Fushimi Inari at dawn"), para("b2", "Book the ryokan")],
      previous: [para("b1", "Day two: Fushimi Inari")],
      authors: [["b1", "p:kim", 10], ["b2", "p:kim", 11]],
      removed: [],
      kinds: [["b1", "edited"], ["b2", "added"]],
      more: false,
      canUndo: true,
      people: { "p:kim": { name: "Kim" } },
    });
    const v = (await query("changes.diff", { id: "d1" })) as ChangeDiffValue;
    expect(v).toMatchObject({ id: "d1", title: "Kyoto", truncated: false, encrypted: false, canUndo: true });
    expect(v.blocks).toEqual([
      { id: "b1", change: "changed", t: "paragraph", x: "Day two: Fushimi Inari at dawn", before: "Day two: Fushimi Inari", parts: [{ kind: "same", text: "Day two: Fushimi Inari" }, { kind: "added", text: " at dawn" }], who: "Kim", at: 10 },
      { id: "b2", change: "added", t: "paragraph", x: "Book the ryokan", who: "Kim", at: 11 },
    ]);
  });
});

describe("Foli AI drafts", () => {
  it("ai.generate writes; ai.saveDraft saves where you are", async () => {
    r.client.act = () => ({ text: "## Wins", title: "Weekly review" });
    expect(await command("ai.generate", { kind: "template", instruction: " A weekly review " })).toEqual({ title: "Weekly review", text: "## Wins" });
    expect(r.client.actions.at(-1)).toEqual({ name: "ai:write", args: { scope: { kind: "personal" }, task: "template", instruction: "A weekly review" } });
    r.client.mutate = () => ({ id: "d9" });
    expect(await command("ai.saveDraft", { kind: "note", title: "Plan", text: "Hello", space: "ws1", folderId: "f1" })).toEqual({ id: "d9" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "aiWriting:saveDraft", args: { scope: { kind: "workspace", workspaceId: "ws1" }, kind: "note", title: "Plan", markdown: "Hello", folderId: "f1" } });
    expect(await refused("ai.generate", { kind: "template", instruction: "  " })).toBe("invalid_args");
  });
});
