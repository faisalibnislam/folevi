// Revision 11's views: the support form's topics (R13.5) and a note's changes block by block (R9.2, the Changes
// card's body: components/views/ChangesView.tsx ChangeCard, drawn from text).
import { buildPreview, plainText, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { diffVersions, type BlockChange } from "@/lib/history/diff";
import { FORM_TOPICS, TOPIC_LABELS } from "@/lib/support";
import { source, type ValueViewDef } from "./views";
import { id, only } from "./validate";
import type { ChangeDiffBlock, ChangeDiffValue, ViewName } from "./protocol";

type Args = Record<string, unknown>;

const supportTopics: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, []), {}),
  create: () => ({ signals: [], compute: () => ({ value: { topics: FORM_TOPICS.map((t) => ({ id: t, label: TOPIC_LABELS[t] })) }, stale: false, error: null }) }),
};

type Attribution = [string, string, number][];
type NoteChangesData = {
  blocks: WireBlock[];
  previous: WireBlock[] | null;
  authors: Attribution;
  removed: Attribution;
  kinds: [string, "added" | "edited" | "removed"][];
  more: boolean;
  canUndo: boolean;
  seenVersionId?: string | null;
  previousSealed?: unknown;
  people: Record<string, { name?: string }>;
} | null;
type ChangesListData = { notes: { id: string; title?: string | null }[] } | null;

/** Longest text a changed line carries (a very long paragraph is cut, not dropped). */
const MAX_TEXT = 4000;

/** A block as a line of text, with the shape a preview line has. */
function lineOf(b: WireBlock): Pick<ChangeDiffBlock, "t" | "x" | "l" | "c"> {
  const line = buildPreview([{ block: b, depth: 0 }])[0] ?? { t: b.type, x: "" };
  const text = plainText(b.text);
  return { t: line.t, x: text ? text.slice(0, MAX_TEXT) : line.x, ...(line.l !== undefined ? { l: line.l } : {}), ...(line.c !== undefined ? { c: line.c } : {}) };
}

/** The changed blocks of a note since the person last looked, in reading order. */
export function changeDiffValue(noteId: string, title: string, d: NonNullable<NoteChangesData>): ChangeDiffValue {
  const encrypted = "previousSealed" in d || "seenVersionId" in d;
  const base = { id: noteId, title, truncated: Boolean(d.more), encrypted, canUndo: Boolean(d.canUndo) };
  if (encrypted) return { ...base, blocks: [] };
  const name = (key: string | null) => (key ? (d.people[key]?.name ?? null) : null);
  let blocks: WireBlock[];
  let changes: Map<string, BlockChange>;
  if (d.previous) {
    const diff = diffVersions(d.previous, d.blocks, d.authors, d.removed);
    blocks = diff.blocks.filter((b) => diff.changes.has(b.id));
    changes = diff.changes;
  } else {
    const kinds = new Map(d.kinds);
    const by = new Map(d.authors.map(([blockId, key, at]) => [blockId, [key, at] as const]));
    changes = new Map(d.blocks.map((b) => [b.id, { kind: kinds.get(b.id) === "added" ? "added" : "edited", author: by.get(b.id)?.[0] ?? null, at: by.get(b.id)?.[1] ?? null } as BlockChange]));
    blocks = d.blocks;
  }
  const before = new Map((d.previous ?? []).map((b) => [b.id, b]));
  const out: ChangeDiffBlock[] = blocks.map((b) => {
    const c = changes.get(b.id)!;
    const old = before.get(b.id);
    return {
      id: b.id,
      change: c.kind === "edited" ? "changed" : c.kind,
      ...lineOf(b),
      ...(c.kind === "edited" && old ? { before: plainText(old.text).slice(0, MAX_TEXT) } : {}),
      ...(c.parts ? { parts: c.parts.map((p) => ({ kind: p.kind, text: p.text })) } : {}),
      who: name(c.author),
      at: c.at,
    };
  });
  return { ...base, blocks: out };
}

const changesDiff: ValueViewDef = {
  kind: "value",
  parse: (args: Args) => (only(args, ["id"]), { id: id(args, "id") }),
  create: (ctx, args) => {
    const noteId = args.id as string;
    const detail = source<NoteChangesData>(ctx, api.changes.note, { documentId: noteId }, null);
    const list = source<ChangesListData>(ctx, api.changes.list, {}, null);
    return {
      signals: [detail, list],
      compute: () => {
        const s = detail.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        const title = list.snapshot().value?.notes.find((n) => n.id === noteId)?.title ?? "";
        // Nothing to show (never opened, or no access): an empty list.
        if (s.value === null) return { value: { id: noteId, title, blocks: [], truncated: false, encrypted: false, canUndo: false }, stale: s.stale, error: null };
        return { value: changeDiffValue(noteId, title, s.value), stale: s.stale, error: null };
      },
    };
  },
};

export const EXTRA_VALUE_VIEWS = {
  "support.topics": supportTopics,
  "changes.diff": changesDiff,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
