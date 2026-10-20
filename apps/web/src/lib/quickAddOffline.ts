// Quick Add with no connection, in account mode: the task is written on this device through the sync engine,
// like a share (lib/share/save.ts), and goes to the server with the rest of the queue when the connection is
// back. tasks.quickAdd (convex/tasks.ts) does the same on the server when online: a to-do block at the end of
// the chosen page, or of the place's Inbox page (its deterministic id, made here if this device never had it).
import { rankBetween, SCHEMA_VERSION, ulid, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { inboxPage, type ShareSaver } from "@/lib/share/save";

export interface QuickAddTaskInput {
  title: string;
  dueDate?: string;
  dueTime?: string;
  priority?: "none" | "low" | "medium" | "high";
  repeat?: { repeat: string | null; repeatEvery: number | null; repeatDays: string | null };
  /** The page it goes on; the Inbox when absent. */
  documentId?: string;
}

/** The to-do block's props, as tasks.quickAdd sets them. */
export function quickAddProps(input: QuickAddTaskInput): Record<string, unknown> {
  const props: Record<string, unknown> = { checked: false };
  if (input.dueDate) props.dueDate = input.dueDate;
  if (input.dueDate && input.dueTime) props.dueTime = input.dueTime;
  if (input.priority && input.priority !== "none") props.priority = input.priority;
  if (input.repeat) for (const [k, v] of Object.entries(input.repeat)) if (v !== null) props[k] = v;
  return props;
}

/** Adds the task on this device (the engine sends it later). Same answer as tasks.quickAdd. */
export async function quickAddOnDevice(saver: Omit<ShareSaver, "online" | "prepareInbox">, scope: WireScope, input: QuickAddTaskInput): Promise<{ blockId: string; documentId: string }> {
  const title = input.title.trim().slice(0, 500);
  if (!title) throw new Error("Write the task first.");
  const { engine } = saver;
  // Offline: no server to ask, so prepareInbox is never called.
  const documentId = input.documentId ?? (await inboxPage({ ...saver, online: false, prepareInbox: () => Promise.reject(new Error("offline")) }, scope)).documentId;
  const last = engine
    .documentBlocks(documentId)
    .filter((b) => b.parentId === null)
    .reduce<string | null>((m, b) => (m === null || b.rank > m ? b.rank : m), null);
  const block: WireBlock = {
    id: ulid(),
    type: "todo",
    parentId: null,
    rank: rankBetween(last, null),
    schemaVersion: SCHEMA_VERSION,
    text: [{ type: "text", text: title }],
    props: quickAddProps(input),
  };
  engine.upsertBlock(documentId, block, ["content", "position"], null);
  await engine.persisted();
  return { blockId: block.id, documentId };
}
