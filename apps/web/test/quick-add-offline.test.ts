// Quick Add with no connection in account mode (lib/quickAddOffline.ts): the to-do is queued on this device
// through the sync engine, where tasks.quickAdd would have put it.
import { describe, expect, test, vi } from "vitest";
import { inboxDocumentId, scopeIdKey, type WireBlock } from "@folevi/editor-schema";
import { quickAddOnDevice, quickAddProps } from "@/lib/quickAddOffline";
import type { SyncEngine } from "@/lib/sync/engine";

function fakeEngine(existing: Record<string, WireBlock[]> = {}) {
  const blocks = new Map(Object.entries(existing));
  const created: string[] = [];
  const engine = {
    documentBlocks: (id: string) => blocks.get(id) ?? [],
    upsertBlock: vi.fn((documentId: string, block: WireBlock) => blocks.set(documentId, [...(blocks.get(documentId) ?? []), block])),
    createDocument: vi.fn((d: { id: string }) => {
      created.push(d.id);
      return d.id;
    }),
    persisted: vi.fn(async () => undefined),
  };
  return { engine: engine as unknown as SyncEngine, raw: engine, blocks, created };
}

const para = (id: string, rank: string, parentId: string | null = null): WireBlock => ({ id, type: "paragraph", parentId, rank, schemaVersion: 1, text: [], props: {} });

describe("Quick Add offline", () => {
  test("the props tasks.quickAdd sets", () => {
    expect(quickAddProps({ title: "x" })).toEqual({ checked: false });
    expect(quickAddProps({ title: "x", dueTime: "09:00" })).toEqual({ checked: false });
    expect(quickAddProps({ title: "x", dueDate: "2026-10-21", dueTime: "09:00", priority: "high", repeat: { repeat: "weekly", repeatEvery: null, repeatDays: "1,3" } })).toEqual({
      checked: false,
      dueDate: "2026-10-21",
      dueTime: "09:00",
      priority: "high",
      repeat: "weekly",
      repeatDays: "1,3",
    });
    expect(quickAddProps({ title: "x", priority: "none" })).toEqual({ checked: false });
  });

  test("goes to the Inbox page (its own id, made on this device) and is saved before it answers", async () => {
    const { engine, raw, blocks, created } = fakeEngine();
    const r = await quickAddOnDevice({ engine, profileId: "p1", deviceId: "web-1" }, { kind: "personal" }, { title: "  Call the printer  ", dueDate: "2026-10-21" });
    const inbox = inboxDocumentId("p1", scopeIdKey({ kind: "personal" }));
    expect(r.documentId).toBe(inbox);
    expect(created).toEqual([inbox]);
    const [block] = blocks.get(inbox)!;
    expect(block).toMatchObject({ id: r.blockId, type: "todo", parentId: null, text: [{ type: "text", text: "Call the printer" }], props: { checked: false, dueDate: "2026-10-21" } });
    expect(raw.upsertBlock).toHaveBeenCalledWith(inbox, block, ["content", "position"], null);
    expect(raw.persisted).toHaveBeenCalled();
  });

  test("on a chosen page it goes after the page's last top-level block", async () => {
    const { engine, blocks } = fakeEngine({ d1: [para("a", "M"), para("b", "T"), para("c", "Z", "b")] });
    const r = await quickAddOnDevice({ engine, profileId: "p1", deviceId: null }, { kind: "workspace", workspaceId: "w1" }, { title: "Ship it", documentId: "d1" });
    expect(r.documentId).toBe("d1");
    const added = blocks.get("d1")!.find((b) => b.id === r.blockId)!;
    expect(added.rank > "T").toBe(true);
    await expect(quickAddOnDevice({ engine, profileId: "p1", deviceId: null }, { kind: "personal" }, { title: "   " })).rejects.toThrow("Write the task first.");
  });
});
