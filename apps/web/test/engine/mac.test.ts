// Revision 8 through the bridge host: a note from text, a banner's actions, moving notes between places, batch
// titles, research, the agent's changes, the profile picture, the new editor commands, and encrypted links.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { registerNote, resetNoteHost, focusMode } from "@/lib/engine/noteHost";
import { currentGate, resetGates } from "@/lib/engine/gates";
import { snoozeUntil } from "@/lib/engine/commandsMac";
import { onAppOrigin } from "@/lib/engine/commandsAccount";
import { runEditorCommand, type NativeNoteOptions } from "@/lib/engine/editorCommands";
import type { NotesMetaValue, PlaceMovePreview, Reply, ResearchValue } from "@/lib/engine/protocol";
import { Posts, rig, type Rig } from "./fakes";

const moveRuns: unknown[] = [];
vi.mock("@/components/places/MovePlaces", () => ({
  startPlaceMove: async (o: { move: unknown; onProgress?: (p: unknown) => void }) => {
    moveRuns.push(o.move);
    o.onProgress?.({ phase: "notes", notesDone: 3, notesTotal: 10, filesDone: 0, current: null, waitingUntil: null });
    return { kind: "done", state: { notes: { a: 1, b: 2 }, problems: [] } };
  },
}));

const PLACE = "acct:user_1";
let host: BridgeHost;
let r: Rig;
let n = 0;
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

beforeEach(() => {
  host = new BridgeHost({ post: new Posts().post, schedule: () => undefined, marker: { platform: "macos", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  host.attach(
    r.deps({
      places: {
        current: PLACE,
        places: [
          { id: PLACE, kind: "account", name: "Faisal", email: "f@x", avatarUrl: null, syncs: null, workspaces: [], unread: 0, reminders: 0, waiting: 0 },
          { id: "acct:user_2", kind: "account", name: "Work", email: "w@x", avatarUrl: null, syncs: null, workspaces: [{ id: "ws9", name: "Acme", logoUrl: null, planName: null }], unread: 0, reminders: 0, waiting: 0 },
          { id: "library", kind: "library", name: "On this device", email: null, avatarUrl: null, syncs: "iCloud", workspaces: [], unread: 0, reminders: 0, waiting: 0 },
        ],
      },
    }),
  );
  n = 0;
  moveRuns.length = 0;
});
afterEach(() => {
  host.dispose();
  resetNoteHost();
  resetGates();
});

describe("R8.5 to R8.8", () => {
  it("note.create from text: the first line is the title, through imports.importText", async () => {
    r.client.mutate = () => ({ document: { id: "d77" } });
    expect(await command("note.create", { text: "Groceries\nMilk\nRice", open: true })).toEqual({ id: "d77" });
    expect(r.client.mutations[0]).toEqual({ name: "imports:importText", args: { scope: { kind: "personal" }, filename: "Groceries", content: "Milk\n\nRice", format: "text" } });
    expect(r.navigations).toEqual(["/d/d77"]);
  });

  it("notification.act: reply through the outbox, done and snooze on the reminder's task", async () => {
    r.client.answer("notifications:list", [{ id: "n1", kind: "comment", documentId: "d1", threadId: "th1", blockId: null }, { id: "n2", kind: "reminder", documentId: "d1", threadId: null, blockId: "blk9" }]);
    await command("notification.act", { id: "n1", action: "reply", text: " Friday works " });
    expect(r.outbox.entries[0]).toMatchObject({ name: "comments.reply", args: { threadId: "th1", body: [{ type: "text", text: "Friday works" }] } });
    await command("notification.act", { id: "n2", action: "done" });
    expect(r.client.mutations.find((m) => m.name === "tasks:update")!.args).toEqual({ blockId: "blk9", checked: true });
    await command("notification.act", { id: "n2", action: "snooze-hour" });
    expect(r.client.mutations.filter((m) => m.name === "tasks:update").at(-1)!.args).toMatchObject({ blockId: "blk9", reminderAt: expect.any(Number) });
    expect(await code({ kind: "command", place: PLACE, name: "notification.act", args: { id: "n1", action: "explode" } })).toBe("invalid_args");
  });

  it("snooze times", () => {
    const at = new Date(2026, 9, 24, 15, 30);
    expect(snoozeUntil("snooze-hour", at)).toBe(at.getTime() + 3_600_000);
    expect(new Date(snoozeUntil("snooze-evening", at)).getHours()).toBe(18);
    expect(new Date(snoozeUntil("snooze-evening", new Date(2026, 9, 24, 20))).getDate()).toBe(25);
    expect(new Date(snoozeUntil("snooze-tomorrow", at))).toEqual(new Date(2026, 9, 25, 9, 0));
  });

  it("places.move.preview and places.move, its progress as the placeMove gate", async () => {
    const v = (await query("places.move.preview", { folders: ["f1"], notes: ["d1", "d2"] })) as PlaceMovePreview;
    expect(v.destinations.map((d) => d.value)).toEqual(["acct:user_2|personal", "acct:user_2|ws:ws9", "library|personal"]);
    expect(v).toMatchObject({ folders: 1, notes: 2, everything: false, to: { value: "acct:user_2|personal" } });
    const res = await command("places.move", { to: "acct:user_2|ws:ws9", folders: ["f1"], copy: true });
    expect(res).toEqual({ status: "done", notes: 2, problems: 0 });
    expect(moveRuns[0]).toMatchObject({ to: { place: "acct:user_2", scope: { kind: "workspace", workspaceId: "ws9" } }, pick: { folders: ["f1"], notes: [] }, mode: "copy", versions: true });
    expect(currentGate().gate).toBe("loading");
    expect((await code({ kind: "command", place: PLACE, name: "places.move", args: { to: "acct:nobody|personal", copy: true } }))).toBe("not_found");
  });

  it("notes.meta: current titles, missing ones marked", async () => {
    r.client.answer("documents:titles", { d1: { title: "Renamed", icon: null, inTrash: false } });
    expect(((await query("notes.meta", { ids: ["d1", "d2"] })) as NotesMetaValue).notes).toEqual([{ id: "d1", found: true, title: "Renamed", icon: null, inTrash: false }, { id: "d2", found: false, title: "", icon: null, inTrash: false }]);
  });
});

describe("Foli AI: research and the agent's changes", () => {
  it("research mode, its jobs, cancel and save", async () => {
    r.client.act = () => new Promise(() => undefined);
    await command("ai.send", { conversationId: "c1", text: "Leaves in Kyoto", mode: "research" });
    expect(r.client.actions[0]).toMatchObject({ name: "aiResearch:start", args: { conversationId: "c1", text: "Leaves in Kyoto" } });
    r.client.answer("aiResearch:forConversation", [{ id: "res1", messageId: "m1", question: "q", status: "done", steps: [{ kind: "search", label: "Searching", status: "done", count: 3 }], sources: [{ n: 1, kind: "web", url: "https://x", title: "X", domain: "x" }], noteId: null, error: null, credits: 4, createdAt: 1, finishedAt: 2 }]);
    const v = (await query("ai.research", { conversationId: "c1" })) as ResearchValue;
    expect(v.jobs[0]).toMatchObject({ id: "res1", steps: [{ count: 3 }], sources: [{ kind: "web", noteId: null, url: "https://x" }] });
    r.client.mutate = (name) => (name === "aiResearch:saveAsNote" ? { id: "d5" } : null);
    expect(await command("ai.researchSave", { researchId: "res1" })).toEqual({ id: "d5" });
    await command("ai.researchCancel", { researchId: "res1" });
    expect(r.client.mutations.map((m) => m.name)).toEqual(["aiResearch:saveAsNote", "aiResearch:cancel"]);
  });

  it("approve, discard and undo the agent's run", async () => {
    r.client.act = (name) => (name === "aiAgent:undo" ? { status: "changed", changed: [{ key: "d1", label: "Kyoto" }] } : { status: "done" });
    await command("ai.agentApprove", { runId: "run1", operationIds: ["op1", "op2"] });
    expect(r.client.actions[0]).toEqual({ name: "aiAgent:approve", args: { runId: "run1", operationIds: ["op1", "op2"] } });
    expect(await command("ai.agentUndo", { runId: "run1" })).toEqual({ status: "changed", changed: ["Kyoto"] });
    await command("ai.agentUndo", { runId: "run1", force: "rest" });
    expect(r.client.actions.at(-1)!.args).toEqual({ runId: "run1", changed: "rest" });
    await command("ai.agentDiscard", { runId: "run1" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "aiAgent:discard", args: { runId: "run1" } });
  });
});

describe("the profile picture and encrypted links", () => {
  it("settings.setAvatar refuses what the web refuses, before uploading", async () => {
    expect(await code({ kind: "command", place: PLACE, name: "settings.setAvatar", args: { data: "", mimeType: "image/png" } })).toBe("invalid_args");
    expect(await code({ kind: "command", place: PLACE, name: "settings.setAvatar", args: { data: "AAAA", mimeType: "image/tiff" } })).toBe("invalid_args");
  });

  it("encrypted links use Folevi's own address", () => {
    expect(onAppOrigin("capacitor://localhost/s/abc#k=xyz")).toBe("https://app.folevi.com/s/abc#k=xyz");
  });
});

describe("R8.9 editor commands", () => {
  const options = (over: Partial<NativeNoteOptions> = {}): NativeNoteOptions => ({ documentId: "d1", editor: null, readOnly: false, title: "", ready: true, panel: "style", openPanel: () => undefined, closePanel: () => undefined, menu: {}, scrollEl: null, ...over });

  it("focus.toggle and note.lock; editor.state says focus, locked and canLock", () => {
    let closed = 0;
    let locked = 0;
    const o = options({ closePanel: () => closed++, lock: () => locked++, locked: true });
    runEditorCommand(o, "focus.toggle", {});
    expect(focusMode()).toBe(true);
    expect(closed).toBe(1);
    expect(runEditorCommand(o, "state", {})).toMatchObject({ focus: true, locked: true, canLock: true });
    runEditorCommand(o, "note.lock", {});
    expect(locked).toBe(1);
    runEditorCommand(o, "focus.toggle", {});
    expect(focusMode()).toBe(false);
    expect(() => runEditorCommand(options(), "note.lock", {})).toThrow("Lock isn't offered");
    expect(() => runEditorCommand(options(), "block.move", { dir: "up" })).toThrow();
  });

  it("the host sends them to the open note", async () => {
    const seen: string[] = [];
    registerNote({ noteId: "d1", run: (name) => (seen.push(name), { ok: true }), state: () => ({ noteId: "d1", focused: true, canEdit: true, block: "paragraph", marks: [], link: false, undo: false, redo: false, focus: false, locked: false, canLock: false }), panel: () => null });
    for (const name of ["block.move", "block.duplicate", "focus.toggle", "note.lock"]) await ok({ kind: "editor", name, args: name === "block.move" ? { dir: "down" } : {} });
    expect(seen).toEqual(["block.move", "block.duplicate", "focus.toggle", "note.lock"]);
  });
});
