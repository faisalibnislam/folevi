// Changes Foli AI can propose to someone's notes: make a folder, write a note (in a folder), move a note
// into a folder. Foli AI never changes anything itself: it returns these as a proposal, the person checks
// them, and applying them goes through `aiActions.apply` (or the local backend's own), which checks
// everything again. Shared by the server (convex/lib/aiActions.ts adds the validator) and the local backend.

export const MAX_ACTIONS = 12;
export const MAX_NOTE_MARKDOWN = 60_000;

/** Where a note goes: an existing folder (its id), or one made in the same proposal (its name). */
export interface FolderRef {
  folderId?: string;
  folderName?: string;
}

export type AiAction =
  | { type: "createFolder"; name: string }
  | ({ type: "createNote"; title: string; markdown: string } & FolderRef)
  | ({ type: "moveNote"; noteId: string; noteTitle: string } & FolderRef);

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "");

/**
 * The model's plan, checked: only these three kinds of change, folders that exist (matched by id or name)
 * or are made in the same plan, and only notes the model was shown (so it can't name others). Anything
 * that doesn't fit is dropped.
 */
export function checkPlan(
  raw: unknown,
  folders: { id: string; name: string }[],
  notes: { id: string; title: string }[],
): AiAction[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { actions?: unknown }).actions) ? (raw as { actions: unknown[] }).actions : [];
  const out: AiAction[] = [];
  const newFolders = new Set<string>();
  const byName = new Map(folders.map((f) => [f.name.trim().toLowerCase(), f]));
  const byId = new Map(folders.map((f) => [f.id, f]));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const folderRef = (a: Record<string, unknown>): FolderRef | null => {
    const id = clip(a.folderId, 64);
    if (id && byId.has(id)) return { folderId: id, folderName: byId.get(id)!.name };
    const name = clip(a.folderName ?? a.folder, 80);
    if (!name) return id ? null : {};
    const existing = byName.get(name.toLowerCase());
    if (existing) return { folderId: existing.id, folderName: existing.name };
    return newFolders.has(name.toLowerCase()) ? { folderName: name } : null;
  };
  // Folders first, so notes later in the plan can go into them.
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (a.type !== "createFolder") continue;
    const name = clip(a.name, 80);
    if (!name || byName.has(name.toLowerCase()) || newFolders.has(name.toLowerCase())) continue;
    newFolders.add(name.toLowerCase());
    out.push({ type: "createFolder", name });
  }
  for (const item of list) {
    if (out.length >= MAX_ACTIONS) break;
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (a.type === "createNote") {
      const title = clip(a.title, 200);
      const markdown = clip(a.markdown, MAX_NOTE_MARKDOWN);
      const ref = folderRef(a);
      if (!title || ref === null) continue;
      out.push({ type: "createNote", title, markdown, ...ref });
    } else if (a.type === "moveNote") {
      const note = noteById.get(clip(a.noteId, 64));
      const ref = folderRef(a);
      if (!note || !ref || (!ref.folderId && !ref.folderName)) continue;
      out.push({ type: "moveNote", noteId: note.id, noteTitle: note.title, ...ref });
    }
  }
  return out.slice(0, MAX_ACTIONS);
}

export const ACT_SYSTEM = [
  "You plan changes to the person's notes in Folevi, a notes app. The person asked you to do something (write notes, put notes in a folder, make a folder).",
  "Reply with JSON only, shaped {\"reply\": string, \"actions\": [...]}. Each action is one of:",
  '{"type":"createFolder","name":"..."}',
  '{"type":"createNote","title":"...","markdown":"...","folderId":"..."} (or "folderName" for a folder made in this plan; leave both out for no folder)',
  '{"type":"moveNote","noteId":"...","folderId":"..."} (or "folderName" for a folder made in this plan)',
  "Use the ids given below exactly; never invent note or folder ids. Only move notes listed under <notes>. Prefer an existing folder whose name matches over making a new one.",
  "A note's markdown is its body (no title heading): headings, lists, paragraphs and links in Markdown, written from the conversation and the notes, complete and well organized.",
  "`reply` is one or two short sentences saying what will happen once the person applies the changes. Write in the person's language. Do not claim anything has been done yet.",
  "If the request can't be done with these actions, return no actions and say so in `reply`.",
].join("\n");

/** What's said when the plan has changes and the model gave no reply of its own. */
export const ACT_READY = "Here's what I'll change. Check it, then apply.";
/** What's said when no change could be worked out and the model gave no reply of its own. */
export const ACT_NOTHING = "I couldn't work out what to change from that. Say which notes to write, or which folder to use.";

/** The plan's reply as shown with it: the model's own `reply` (at most 1,000 characters), or a plain line. */
export function actReply(parsed: unknown, actions: AiAction[]): string {
  const reply = typeof (parsed as { reply?: unknown })?.reply === "string" ? String((parsed as { reply: string }).reply).slice(0, 1000) : "";
  return actions.length ? reply || ACT_READY : reply || ACT_NOTHING;
}

/** The model's raw plan as JSON (null when it isn't JSON), for checkPlan and actReply. */
export function parsePlan(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
