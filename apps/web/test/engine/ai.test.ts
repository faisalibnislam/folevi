// Revision 7 through the bridge host: Foli AI's conversations, a conversation's messages, the answer streaming
// as a live view, and the chat commands (a send replies at once; the answer arrives through the views).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import type { ChatConversationValue, ChatConversationsValue, ChatSendResult, Reply } from "@/lib/engine/protocol";
import { Posts, rig, type Rig } from "./fakes";

const PLACE = "acct:user_1";
let posts: Posts;
let host: BridgeHost;
let r: Rig;
let n = 0;
const send = async (m: Record<string, unknown>) => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
const ok = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
};
const query = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "query", place: PLACE, name, args });
const command = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "command", place: PLACE, name, args });
const settle = async () => {
  await new Promise((res) => setTimeout(res, 0));
  host.flush();
};

const message = (id: string, over: Record<string, unknown> = {}) => ({ id, role: "assistant", text: "Hi", citations: [{ n: 1, noteId: "d1", title: "Kyoto" }], webCitations: [], searchEntryPoints: [], suggestions: [], status: "done", live: false, phase: null, error: null, credits: 1, attachments: [], actions: null, actionsOutcome: null, agent: null, memory: null, createdAt: 1, ...over });

beforeEach(() => {
  posts = new Posts();
  host = new BridgeHost({ post: posts.post, schedule: () => undefined, marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  host.attach(r.deps());
  n = 0;
});
afterEach(() => {
  host.dispose();
  resetNoteHost();
  resetGates();
});

describe("Foli AI chat", () => {
  it("conversations: pinned and recent, or one page of matches", async () => {
    const row = (id: string, pinned: boolean) => ({ id, title: id, pinned, context: "note", lastMessageAt: 1, createdAt: 1, shared: false, workspace: false });
    r.client.answer("aiChat:pinned", [row("p1", true)]);
    r.client.answer("aiChat:list", (args: Record<string, unknown>) => (args.search ? { page: [row("p1", true), row("r9", false)], isDone: true, continueCursor: "" } : { page: [row("r1", false)], isDone: false, continueCursor: "x" }));
    const v = (await query("ai.conversations")) as ChatConversationsValue;
    expect([v.pinned.map((c) => c.id), v.recent.map((c) => c.id), v.more]).toEqual([["p1"], ["r1"], true]);
    const s = (await query("ai.conversations", { search: "kyoto" })) as ChatConversationsValue;
    expect([s.pinned.map((c) => c.id), s.recent.map((c) => c.id), s.more]).toEqual([["p1"], ["r9"], false]);
  });

  it("a conversation's messages, and the answer streaming as a live view; nothing is kept on the device", async () => {
    r.client.answer("aiChat:get", { conversation: { id: "c1", title: "Trip", pinned: false, ephemeral: false, scope: { kind: "workspace", workspaceId: "ws1" }, context: { kind: "note", items: [] }, shared: false, canShare: true, createdAt: 1, lastMessageAt: 2 }, messages: [message("m1", { actions: [{ type: "createFolder", name: "Trips" }] }), message("m2", { status: "streaming", live: true, text: "" })] });
    const v = (await query("ai.conversation", { conversationId: "c1" })) as ChatConversationValue;
    expect(v.conversation).toMatchObject({ id: "c1", space: "ws1", context: "note" });
    expect(v.messages[0]).toMatchObject({ citations: [{ n: 1, noteId: "d1", title: "Kyoto", blockId: null }], actions: [{ type: "createFolder", title: "Trips", folderName: "Trips" }] });
    expect(v.messages[1]).toMatchObject({ live: true, status: "streaming" });

    r.client.answer("aiChat:streamText", { text: "Nov" });
    await ok({ kind: "watch", sub: "st", place: PLACE, name: "ai.stream", args: { messageId: "m2" } });
    await settle();
    r.client.answer("aiChat:streamText", { text: "November is mild" });
    await settle();
    r.client.answer("aiChat:streamText", null);
    await settle();
    expect(posts.updates("st").map((u) => (u.value as { text: string | null }).text)).toEqual(["Nov", "November is mild", null]);
    expect(r.kept.writes.filter((w) => w.name.startsWith("aiChat"))).toEqual([]);
    r.client.answer("aiChat:get", null);
    expect(await query("ai.conversation", { conversationId: "gone" })).toEqual({ found: false, conversation: null, messages: [] });
  });

  it("ai.send replies at once with the conversation; a request to change notes goes to the agent", async () => {
    let release!: () => void;
    r.client.act = () => new Promise((res) => (release = () => res({ messageId: "m9", status: "done" })));
    const res = (await command("ai.send", { text: "What's due?", context: { kind: "folder", ids: ["f1"] }, web: true })) as ChatSendResult;
    expect(res.messageId).toBeNull();
    expect(res.conversationId).toMatch(/^[0-9A-Z]{26}$/);
    expect(r.client.actions[0]).toMatchObject({ name: "aiChat:send", args: { scope: { kind: "personal" }, conversationId: res.conversationId, text: "What's due?", context: { kind: "folder", ids: ["f1"] }, web: true } });
    release();
    await command("ai.send", { conversationId: "c1", text: "Rewrite the headings in this note" });
    expect(r.client.actions[1]!.name).toBe("aiAgent:send");
    await command("ai.send", { conversationId: "c1", text: "Rewrite the headings", mode: "ask" });
    expect(r.client.actions[2]!.name).toBe("aiChat:send");
  });

  it("a send that fails outright is a toast", async () => {
    const { ConvexError } = await import("convex/values");
    r.client.act = () => Promise.reject(new ConvexError({ code: "rate_limited", message: "Slow down a little." }));
    await command("ai.send", { text: "Hi" });
    await settle();
    expect(posts.events("toast")[0]!.data).toMatchObject({ message: "Slow down a little.", tone: "error" });
  });

  it("the other chat commands", async () => {
    r.client.mutate = (name) => (name === "aiChat:saveAsNote" ? { id: "d9" } : name === "aiActions:apply" ? { folders: [{ id: "f9", name: "Trips" }], notes: [], moved: 0 } : null);
    r.client.answer("aiChat:get", { conversation: { scope: { kind: "personal" } }, messages: [{ id: "m1", actions: [{ type: "createFolder", name: "Trips" }] }] });
    await command("ai.stop", { messageId: "m2" });
    await command("ai.rename", { conversationId: "c1", title: "Kyoto" });
    await command("ai.pin", { conversationId: "c1", pinned: true });
    expect(await command("ai.saveAsNote", { conversationId: "c1", messageId: "m1" })).toEqual({ id: "d9" });
    await command("ai.actions", { conversationId: "c1", messageId: "m1", apply: true });
    await command("ai.actions", { conversationId: "c1", messageId: "m1", apply: false });
    await command("ai.memory", { messageId: "m1", save: false });
    await command("ai.remove", { conversationId: "c1" });
    expect(r.client.mutations.map((m) => m.name)).toEqual(["aiChat:stop", "aiChat:rename", "aiChat:setPinned", "aiChat:saveAsNote", "aiActions:apply", "aiChat:setActionsOutcome", "aiChat:setActionsOutcome", "aiMemory:dismissProposal", "aiChat:remove"]);
    expect(r.client.mutations[5]!.args).toEqual({ messageId: "m1", outcome: { kind: "applied", folders: [{ id: "f9", name: "Trips" }], notes: [], moved: 0 } });
    await command("ai.regenerate", { conversationId: "c1" });
    await command("ai.edit", { conversationId: "c1", messageId: "m1", text: "Again?" });
    expect(r.client.actions.map((a) => a.name)).toEqual(["aiChat:regenerate", "aiChat:edit"]);
  });
});
