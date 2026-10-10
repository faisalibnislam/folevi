/*
 * The home page note's starting content, as editor blocks. The server draws it as static HTML (HeroStaticBody,
 * with the editor's classes, so it looks exactly like the editor); the editable note loads the same blocks
 * into the real editor (HeroEditor). Nothing is saved: a reload starts from here again.
 */

export type SeedInline = { text: string; code?: boolean };

export type SeedBlock =
  | { id: string; type: "paragraph"; text: SeedInline[] }
  | { id: string; type: "heading"; level: 1 | 2 | 3; text: SeedInline[] }
  | { id: string; type: "todo"; checked: boolean; dueDate?: string; text: SeedInline[] }
  | { id: string; type: "callout"; text: SeedInline[] };

export const HERO_SEED: SeedBlock[] = [
  {
    id: "hero-intro",
    type: "paragraph",
    text: [
      {
        text: "Write notes, keep your tasks next to them and link pages together. Folevi saves every change on your device first, so you can write offline, and it syncs when you reconnect.",
      },
    ],
  },
  { id: "hero-try", type: "heading", level: 1, text: [{ text: "First things to try" }] },
  { id: "hero-todo-offline", type: "todo", checked: true, text: [{ text: "Write a page while offline" }] },
  { id: "hero-todo-style", type: "todo", checked: true, text: [{ text: "Pick a theme for this note" }] },
  { id: "hero-todo-link", type: "todo", checked: false, text: [{ text: "Link another page with " }, { text: "[[", code: true }] },
  { id: "hero-todo-date", type: "todo", checked: false, dueDate: "2026-10-09", text: [{ text: "Give a to-do a due date" }] },
  {
    id: "hero-callout",
    type: "callout",
    text: [{ text: "Everything you type is saved on this device first. When the status says Saved, the server has it." }],
  },
];

/** The due date chip's text, as the editor writes it ("Oct 9"), fixed to English so the server and browser agree. */
export function seedDueLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: { type: string }[] };

const inline = (parts: SeedInline[]): PMNode[] => parts.map((p) => ({ type: "text", text: p.text, ...(p.code ? { marks: [{ type: "code" }] } : {}) }));

/** The seed as the editor's document (ProseMirror JSON). */
export function seedDoc(): PMNode {
  return {
    type: "doc",
    content: HERO_SEED.map((b): PMNode => {
      const attrs: Record<string, unknown> = { id: b.id, depth: 0 };
      if (b.type === "heading") attrs.level = b.level;
      if (b.type === "todo") {
        attrs.checked = b.checked;
        if (b.dueDate) attrs.dueDate = b.dueDate;
      }
      if (b.type === "callout") attrs.tone = "note";
      return { type: b.type, attrs, content: inline(b.text) };
    }),
  };
}
