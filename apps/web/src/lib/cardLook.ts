// Shared (server + client): which stationery look a note's card takes (DocumentCard.tsx, the native
// WebNoteCard, and shared links' preview image).

/**
 * How a note's card looks, chosen from what the note is (the first that fits): starred, a binder clip; pages
 * inside, sheets fanned behind; tabs, a tab divider; mostly attachments, a pocket; mostly a canvas, graph paper;
 * mostly a list, an index card; a template, a typed memo; anything else, a spiral-bound page. Its theme (spine
 * artwork, colours, fonts) shows in every look. `shape` is derived from its content (derive.ts deriveShape).
 */
export type CardLook = "spiral" | "clip" | "stack" | "tabs" | "pocket" | "graph" | "index" | "memo";

export function noteLook(note: { starred?: boolean; shape?: string | null; kind?: string }): CardLook {
  if (note.starred) return "clip";
  switch (note.shape) {
    case "pages": return "stack";
    case "tabs": return "tabs";
    case "pocket": return "pocket";
    case "canvas": return "graph";
    case "list": return "index";
  }
  return note.kind === "template" ? "memo" : "spiral";
}
