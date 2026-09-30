import { BUILT_IN_TEMPLATES, type BlockSpec } from "@/lib/templates";

/*
 * The public template gallery (/template-gallery). Every page is built from the built-in templates in
 * convex/lib/templates.ts, the same blocks the app creates, so nothing here can drift from the product.
 * Admins can turn a built-in template off in the app; the gallery pages re-check that hourly and hide it
 * (templateAvailability.ts).
 */

/** The day the gallery's pages last changed (YYYY-MM-DD). Change it with convex/lib/templates.ts or these pages. */
export const TEMPLATE_GALLERY_UPDATED = "2026-09-30";

export type GalleryTemplate = {
  key: string;
  name: string;
  /** Sentence case, as people search for it ("Meeting notes"). */
  searchName: string;
  description: string;
  icon: string;
  group: TemplateGroupId;
  blocks: BlockSpec[];
};

export type TemplateGroupId = "everyday" | "work" | "thinking" | "life" | "more";

/** The groups follow the order and comments in convex/lib/templates.ts. */
export const TEMPLATE_GROUPS: Array<{ id: TemplateGroupId; name: string; lede: string; keys: string[] }> = [
  { id: "everyday", name: "Everyday", lede: "Days, weeks and months, and the habits in between.", keys: ["daily-page", "weekly-reset", "monthly-review", "journal", "habit-tracker"] },
  {
    id: "work",
    name: "Work",
    lede: "Meetings, projects, decisions and the people you work with.",
    keys: ["meeting-notes", "one-on-one", "standup", "project-brief", "product-spec", "decision-record", "retrospective", "okrs", "bug-report", "client-brief", "interview-notes"],
  },
  { id: "thinking", name: "Thinking and learning", lede: "Ideas, reading, classes, research and drafts.", keys: ["brainstorm", "reading-notes", "class-notes", "research-notes", "writing-draft"] },
  { id: "life", name: "Life", lede: "Trips, meals, workouts, money and parties.", keys: ["travel-plan", "recipe", "workout-log", "budget", "event-plan"] },
];

/** Names that don't read well lower-cased word by word. */
const SEARCH_NAMES: Record<string, string> = {
  "one-on-one": "1:1 meeting",
  okrs: "Goals and OKRs",
};

function sentenceCase(name: string): string {
  return name
    .split(" ")
    .map((word, i) => (i === 0 || /^[A-Z0-9&:]{2,}s?$/.test(word) ? word : word.toLowerCase()))
    .join(" ")
    .replace(/ & /g, " and ");
}

function groupOf(key: string): TemplateGroupId {
  return TEMPLATE_GROUPS.find((g) => g.keys.includes(key))?.id ?? "more";
}

export const GALLERY_TEMPLATES: GalleryTemplate[] = BUILT_IN_TEMPLATES.map((t) => ({
  key: t.key,
  name: t.name,
  searchName: SEARCH_NAMES[t.key] ?? sentenceCase(t.name),
  description: t.description,
  icon: t.icon,
  group: groupOf(t.key),
  blocks: t.blocks(),
}));

/** Groups with their templates; a template added to the catalog without a group lands in "More". */
export function galleryGroups(list: GalleryTemplate[] = GALLERY_TEMPLATES): Array<{ id: TemplateGroupId; name: string; lede: string; templates: GalleryTemplate[] }> {
  const groups = TEMPLATE_GROUPS.map((g) => ({ id: g.id, name: g.name, lede: g.lede, templates: list.filter((t) => t.group === g.id) })).filter((g) => g.templates.length > 0);
  const more = list.filter((t) => t.group === "more");
  return more.length ? [...groups, { id: "more" as const, name: "More", lede: "More starting points.", templates: more }] : groups;
}

export function templateByKey(key: string): GalleryTemplate | undefined {
  return GALLERY_TEMPLATES.find((t) => t.key === key);
}

export const templatePath = (key: string) => `/template-gallery/${key}`;

/** Plain text of a block's inline Markdown (for summaries and the Open Graph image). */
export function plainText(md: string | undefined): string {
  return (md ?? "")
    .replace(/\*\*|__|`/g, "")
    .replace(/[*_](\S[^*_]*)[*_]/g, "$1")
    .trim();
}

/** Headings in order (level 2 first; templates with only level 3 headings use those). */
export function templateSections(t: GalleryTemplate): string[] {
  const all: BlockSpec[] = [];
  const walk = (list: BlockSpec[]) => list.forEach((b) => (all.push(b), b.children && walk(b.children)));
  walk(t.blocks);
  const heads = all.filter((b) => b.type === "heading");
  const top = Math.min(...heads.map((b) => Number(b.props?.level ?? 2)));
  return heads.filter((b) => Number(b.props?.level ?? 2) === top).map((b) => plainText(b.md));
}

/** What the template is made of, counted from its blocks. */
export function templateStats(t: GalleryTemplate): { todos: number; tables: number; toggles: number; callouts: number } {
  const stats = { todos: 0, tables: 0, toggles: 0, callouts: 0 };
  const walk = (list: BlockSpec[]) =>
    list.forEach((b) => {
      if (b.type === "todo") stats.todos++;
      if (b.type === "table") stats.tables++;
      if (b.type === "toggle") stats.toggles++;
      if (b.type === "callout") stats.callouts++;
      if (b.children) walk(b.children);
    });
  walk(t.blocks);
  return stats;
}

/** "a, b and c" */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
