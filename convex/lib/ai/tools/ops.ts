// What an agent run proposes to change (docs/AI_ASSISTANT.md, "Tools and the agent"). Write tools never
// change anything: each call becomes one of these operations, stored on the run (`aiRuns`) and shown as a
// preview. Only the person's approval executes them (aiAgent.approve), and each one keeps what Undo needs.
import { v, type Infer } from "convex/values";

export const OP_KINDS = [
  "create_note",
  "update_note",
  "append_to_note",
  "rename_note",
  "move_note",
  "create_folder",
  "add_tags",
  "create_checklist",
  "create_tasks",
  "merge_notes",
] as const;
export type OpKind = (typeof OP_KINDS)[number];

/** Operations one run may propose. */
export const MAX_OPS = 20;
/** Markdown one operation may write. */
export const MAX_OP_MARKDOWN = 20_000;
/** Block edits one update_note call may make (a long note is edited in several calls: they add up). */
export const MAX_EDITS = 40;
/** Block edits one run may make to one note, over all its update_note calls. */
export const MAX_NOTE_EDITS = 400;
/**
 * The most a run's operations may hold, as stored (UTF-8 JSON): the aiRuns row has to stay well under
 * Convex's 1 MiB document limit.
 */
export const MAX_RUN_BYTES = 700_000;
/** Items one checklist or task list may hold. */
export const MAX_ITEMS = 50;
/** Notes one merge may fold into another. */
export const MAX_MERGE = 5;
/** Tags one add_tags may add. */
export const MAX_TAGS = 5;

const vOpKind = v.union(...OP_KINDS.map((k) => v.literal(k)));

export const vBlockEdit = v.object({
  action: v.union(v.literal("replace"), v.literal("insert"), v.literal("delete")),
  /** The block replaced or deleted. */
  blockId: v.optional(v.string()),
  /** Where new blocks go: after this block (null: at the top of the note). */
  afterBlockId: v.optional(v.union(v.string(), v.null())),
  markdown: v.optional(v.string()),
  /** The block's text when it was proposed (the preview's "before"). */
  before: v.optional(v.string()),
  /** The block's content revision when it was proposed; a different one at approval means it changed. */
  baseRev: v.optional(v.number()),
});
export type BlockEdit = Infer<typeof vBlockEdit>;

export const vOpStatus = v.union(v.literal("proposed"), v.literal("skipped"), v.literal("applied"), v.literal("failed"));

/**
 * One proposed change. `id` is its idempotency key (a ULID): executing it twice never does it twice, and
 * the sync operations it writes carry ids made from it. What it changes is named by public ids; what it
 * found at proposal time (`fromTitle`, `fromFolderId`, `baseContentSeq`, block `baseRev`) is checked again
 * before it runs.
 */
export const vAgentOp = v.object({
  id: v.string(),
  kind: vOpKind,
  /** One line for the preview ("Rename “Plans” to “Trip plans”"). */
  summary: v.string(),
  status: vOpStatus,
  error: v.optional(v.string()),

  noteId: v.optional(v.string()),
  noteTitle: v.optional(v.string()),
  /** The folder a note goes into (an existing one), or the folder a create_folder makes (its name). */
  folderId: v.optional(v.union(v.string(), v.null())),
  folderName: v.optional(v.string()),
  /** The create_folder operation (in the same run) whose folder this one uses. */
  folderOp: v.optional(v.string()),
  title: v.optional(v.string()),
  markdown: v.optional(v.string()),
  edits: v.optional(v.array(vBlockEdit)),
  tags: v.optional(v.array(v.string())),
  items: v.optional(v.array(v.object({ text: v.string(), dueDate: v.optional(v.string()) }))),
  sources: v.optional(v.array(v.object({ id: v.string(), title: v.string() }))),

  /** What it was proposed against. */
  fromTitle: v.optional(v.string()),
  fromFolderId: v.optional(v.union(v.string(), v.null())),
  fromFolderName: v.optional(v.string()),
  baseContentSeq: v.optional(v.number()),

  /** What it did: for the report's links, verification and Undo. */
  result: v.optional(
    v.object({
      noteId: v.optional(v.string()),
      folderId: v.optional(v.string()),
      title: v.optional(v.string()),
      /** The note's folder before a move (null: none). */
      movedFrom: v.optional(v.union(v.string(), v.null())),
      /** add_tags: the tags it attached, and those of them it created. */
      tagIds: v.optional(v.array(v.string())),
      createdTagIds: v.optional(v.array(v.string())),
      /** merge_notes: the notes it moved to Trash. */
      trashed: v.optional(v.array(v.string())),
      /** merge_notes: files the merged blocks show, moved from their note (`from`) to the target. */
      movedFiles: v.optional(v.array(v.object({ fileId: v.string(), from: v.string() }))),
      /** create_folder: false when a folder of that name already existed and was used instead. */
      created: v.optional(v.boolean()),
      /** A created note's contentSeq right after (a different one at Undo means it was edited since). */
      contentSeq: v.optional(v.number()),
    }),
  ),
  verified: v.optional(v.boolean()),
  /** Undo: done, or left as it was (changed since, and the person chose to keep it). */
  undone: v.optional(v.union(v.literal("done"), v.literal("kept"))),
});
export type AgentOp = Infer<typeof vAgentOp>;

/** A note the run changed: the version saved before its first change, and how it was left. */
export const vRunNote = v.object({
  noteId: v.string(),
  title: v.string(),
  /** The documentSnapshots version (reason "ai_run") saved before the run changed it. */
  snapshotId: v.string(),
  contentSeqAfter: v.number(),
  titleAfter: v.string(),
  restored: v.optional(v.union(v.literal("done"), v.literal("kept"))),
});
export type RunNote = Infer<typeof vRunNote>;

export const vRunStatus = v.union(
  v.literal("preview"),
  v.literal("discarded"),
  v.literal("executing"),
  v.literal("done"),
  v.literal("partial"),
  v.literal("failed"),
  v.literal("undoing"),
  v.literal("undone"),
);
export type RunStatus = Infer<typeof vRunStatus>;

/** Operations that change an existing note's text or title: a version of it is saved first. */
export function changesNote(op: Pick<AgentOp, "kind" | "noteId">): boolean {
  if (op.kind === "update_note" || op.kind === "append_to_note" || op.kind === "rename_note" || op.kind === "merge_notes") return true;
  return (op.kind === "create_checklist" || op.kind === "create_tasks") && Boolean(op.noteId);
}

/** Quotes a title for a summary line. */
export const q = (s: string) => `“${s.replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled"}”`;

/** A run's operations as stored, in bytes (UTF-8 JSON). */
export function runBytes(ops: AgentOp[]): number {
  return new TextEncoder().encode(JSON.stringify(ops)).length;
}

/** "Edit “Plans” (3 changes)" */
export const editSummary = (title: string, n: number) => `Edit ${q(title)} (${n} change${n === 1 ? "" : "s"})`;

/**
 * Adds a proposal to a run's operations. A further update_note to a note the run already edits joins that
 * operation (a long note is edited in batches, reviewed and undone as one change): a block edited again
 * takes the newer edit, the rest are added in order. Returns the operation the proposal ended up in.
 */
export function addOp(ops: AgentOp[], op: AgentOp): AgentOp {
  const same = op.kind === "update_note" ? ops.find((o) => o.kind === "update_note" && o.noteId === op.noteId) : undefined;
  if (!same) {
    ops.push(op);
    return op;
  }
  const edits = [...(same.edits ?? [])];
  for (const e of op.edits ?? []) {
    const at = e.action === "insert" ? -1 : edits.findIndex((x) => x.action !== "insert" && x.blockId === e.blockId);
    if (at >= 0) edits[at] = e;
    else edits.push(e);
  }
  const merged: AgentOp = { ...same, edits, summary: editSummary(same.noteTitle ?? "Untitled", edits.length) };
  ops[ops.indexOf(same)] = merged;
  return merged;
}
