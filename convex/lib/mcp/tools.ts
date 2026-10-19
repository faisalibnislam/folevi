// The tools Folevi's MCP server offers: what each is for (static text, never anything a person wrote),
// its input schema, the OAuth scope it needs and how clients should treat it (annotations). The database
// side lives in convex/mcp.ts. Writes only add (new notes, appended blocks, new tasks) or change a task's
// own fields; nothing deletes, moves, shares or publishes.
import type { McpScope } from "./config";
import { MINDMAP_MARKDOWN_HINT, WIREFRAME_MARKDOWN_HINT } from "@folevi/editor-schema";

export const MAX_MARKDOWN = 20_000;
/** A new note can be longer than an addition (a clipped article, a long write-up). */
export const MAX_CREATE_MARKDOWN = 100_000;
export const MAX_NOTE_CHARS = 40_000;

type Schema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  /** Other scopes that also allow it (list_places: any connection may see where it can work). */
  alsoWith?: McpScope[];
  /** Changes nothing (reads), or changes notes/tasks. */
  kind: "read" | "write";
  /** Writes that change what's already there (not allowed when the person chose "Only add new things"). */
  changesExisting?: boolean;
  idempotent?: boolean;
  inputSchema: Schema;
}

const PLACE = { type: "string", description: 'Where to look or write: "personal", or a workspace id from list_places. Leave out for all places (reads) or your Personal (writes).', maxLength: 64 };
const NOTE_ID = { type: "string", description: "A note id from search_notes, list_recent_notes or a link to the note (app.folevi.com/d/<id> or folevi://d/<id>).", maxLength: 64 };
const DATE = { type: "string", description: "A date as YYYY-MM-DD.", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const TIME = { type: "string", description: "A time as HH:MM (24-hour), only with a date.", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" };
const REPEAT = { type: "string", enum: ["none", "daily", "weekdays", "weekly", "monthly", "yearly"], description: "How it repeats: checking it off brings it back at the next date (none stops repeating)." };

const object = (properties: Schema, required: string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
/** How Markdown makes a sticky notes board (packages/editor-schema stickiesFromFence). */
const STICKIES_FENCE = ' A ```stickies fenced block makes a sticky notes board: one idea per line, "## Label" lines start labelled groups, an optional [pink] (yellow, orange, pink, purple, blue, green, gray) colour first and #tags last.';
const MINDMAP_FENCE = ` ${MINDMAP_MARKDOWN_HINT}`;
/** How Markdown makes a wireframe (packages/editor-schema wireframeFromFence). */
const WIREFRAME_FENCE = ` ${WIREFRAME_MARKDOWN_HINT}`;

export const TOOLS: ToolDef[] = [
  {
    name: "list_places",
    title: "List places",
    description: "The places this connection can use: your Personal and any workspaces you allowed, with their ids.",
    scope: "notes:read",
    alsoWith: ["notes:write", "tasks:read", "tasks:write"],
    kind: "read",
    inputSchema: object({}),
  },
  {
    name: "search_notes",
    title: "Search notes",
    description: "Finds notes whose title, text, attachments or tags match the query. Returns ids, titles, a short snippet and a link.",
    scope: "notes:read",
    kind: "read",
    inputSchema: object(
      {
        query: { type: "string", description: "Words to look for.", minLength: 1, maxLength: 200 },
        place: PLACE,
        limit: { type: "integer", description: "At most this many results (1 to 20, default 10).", minimum: 1, maximum: 20 },
      },
      ["query"],
    ),
  },
  {
    name: "get_note",
    title: "Read a note",
    description: "Returns one note as Markdown, with its title, folder, tags and link. Long notes are cut at maxChars.",
    scope: "notes:read",
    kind: "read",
    inputSchema: object({ noteId: NOTE_ID, maxChars: { type: "integer", description: `Characters of Markdown to return (default and maximum ${MAX_NOTE_CHARS}).`, minimum: 200, maximum: MAX_NOTE_CHARS } }, ["noteId"]),
  },
  {
    name: "list_recent_notes",
    title: "Recent notes",
    description: "The most recently edited notes, newest first.",
    scope: "notes:read",
    kind: "read",
    inputSchema: object({ place: PLACE, limit: { type: "integer", description: "1 to 50 (default 15).", minimum: 1, maximum: 50 } }),
  },
  {
    name: "list_folders",
    title: "List folders",
    description: "Folders in a place, with ids to file new notes into. Folders can nest: each one has its path, like \"Work / Clients\".",
    scope: "notes:read",
    kind: "read",
    inputSchema: object({ place: PLACE }),
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "Tags in a place.",
    scope: "notes:read",
    kind: "read",
    inputSchema: object({ place: PLACE }),
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description: "To-dos from your notes: today (due today or overdue), upcoming, inbox (no date), all open, completed, or mine (assigned to you).",
    scope: "tasks:read",
    kind: "read",
    inputSchema: object({
      view: { type: "string", enum: ["today", "upcoming", "inbox", "all", "completed", "mine"], description: "Which tasks (default today)." },
      place: PLACE,
    }),
  },
  {
    name: "create_note",
    title: "Create a note",
    description: "Creates a new note from Markdown. Without folderId or inInbox it's an ordinary note in Drafts, which is what people usually want. Returns its id and link.",
    scope: "notes:write",
    kind: "write",
    inputSchema: object(
      {
        title: { type: "string", description: "The note's title.", minLength: 1, maxLength: 200 },
        markdown: { type: "string", description: "The note's content in Markdown (headings, lists, to-dos with - [ ], tables, code). Don't start with the title as a heading: the title is shown above the content already." + STICKIES_FENCE + MINDMAP_FENCE + WIREFRAME_FENCE, maxLength: MAX_CREATE_MARKDOWN },
        place: PLACE,
        folderId: { type: "string", description: "A folder id from list_folders (same place).", maxLength: 64 },
        inInbox: { type: "boolean", description: "Only when the person asks for their Inbox: files the note as a page inside the Inbox page instead of Drafts (not with folderId)." },
      },
      ["title", "markdown"],
    ),
  },
  {
    name: "append_to_note",
    title: "Add to a note",
    description:
      "Adds Markdown to the end of an existing note. What's already in the note stays as it is; a version is saved first. If the person asked to review changes to existing notes, nothing changes yet: the answer has proposed: true, and the addition waits in Folevi's Changes page for them to accept or reject. Tell them so.",
    scope: "notes:write",
    kind: "write",
    inputSchema: object({ noteId: NOTE_ID, markdown: { type: "string", description: "What to add, in Markdown." + STICKIES_FENCE + MINDMAP_FENCE + WIREFRAME_FENCE, minLength: 1, maxLength: MAX_MARKDOWN } }, ["noteId", "markdown"]),
  },
  {
    name: "add_task",
    title: "Add a task",
    description: "Adds a to-do to the end of a note, or to your Inbox page when no note is given.",
    scope: "tasks:write",
    kind: "write",
    inputSchema: object(
      {
        text: { type: "string", description: "What needs doing.", minLength: 1, maxLength: 500 },
        dueDate: DATE,
        dueTime: TIME,
        priority: { type: "string", enum: ["none", "low", "medium", "high"] },
        repeat: REPEAT,
        noteId: NOTE_ID,
        place: PLACE,
      },
      ["text"],
    ),
  },
  {
    name: "complete_task",
    title: "Complete a task",
    description: "Checks off a to-do (or unchecks it with done: false). Use a taskId from list_tasks.",
    scope: "tasks:write",
    kind: "write",
    changesExisting: true,
    idempotent: true,
    inputSchema: object({ taskId: { type: "string", description: "The task id from list_tasks.", maxLength: 64 }, done: { type: "boolean", description: "Default true." } }, ["taskId"]),
  },
  {
    name: "update_task",
    title: "Update a task",
    description: "Changes a to-do's due date, time, priority or repeat. The to-do's text isn't changed.",
    scope: "tasks:write",
    kind: "write",
    changesExisting: true,
    idempotent: true,
    inputSchema: object(
      {
        taskId: { type: "string", description: "The task id from list_tasks.", maxLength: 64 },
        dueDate: { anyOf: [DATE, { type: "null" }], description: "New due date, or null to clear it." },
        dueTime: { anyOf: [TIME, { type: "null" }], description: "New time, or null to clear it." },
        priority: { type: "string", enum: ["none", "low", "medium", "high"] },
        repeat: REPEAT,
      },
      ["taskId"],
    ),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Whether a connection with these scopes may list and call the tool. */
export function toolAllowed(t: ToolDef, scopes: readonly string[]): boolean {
  return scopes.includes(t.scope) || (t.alsoWith ?? []).some((s) => scopes.includes(s));
}

/** A tool as tools/list describes it (annotations tell clients which ones change things). */
export function describeTool(t: ToolDef): Record<string, unknown> {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.kind === "read",
      destructiveHint: false,
      idempotentHint: t.kind === "read" || t.idempotent === true,
      openWorldHint: false,
    },
  };
}

/**
 * Checks arguments against a tool's schema (the subset Folevi's schemas use: object with known properties,
 * string length/pattern/enum, integer range, boolean, nullable). Returns a message for the first problem.
 */
export function checkArgs(t: ToolDef, args: unknown): string | null {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return "Arguments must be an object.";
  const a = args as Record<string, unknown>;
  const schema = t.inputSchema as { properties: Record<string, Schema>; required: string[] };
  for (const key of Object.keys(a)) if (!(key in schema.properties)) return `Unknown argument "${key}".`;
  for (const key of schema.required) if (a[key] === undefined) return `"${key}" is required.`;
  for (const [key, spec] of Object.entries(schema.properties)) {
    const value = a[key];
    if (value === undefined) continue;
    const problem = checkValue(key, value, spec);
    if (problem) return problem;
  }
  return null;
}

function checkValue(key: string, value: unknown, spec: Schema): string | null {
  if (Array.isArray(spec.anyOf)) {
    return (spec.anyOf as Schema[]).some((s) => checkValue(key, value, s) === null) ? null : `"${key}" isn't valid.`;
  }
  switch (spec.type) {
    case "null":
      return value === null ? null : `"${key}" must be null.`;
    case "boolean":
      return typeof value === "boolean" ? null : `"${key}" must be true or false.`;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return `"${key}" must be a whole number.`;
      if (typeof spec.minimum === "number" && value < spec.minimum) return `"${key}" must be at least ${spec.minimum}.`;
      if (typeof spec.maximum === "number" && value > spec.maximum) return `"${key}" must be at most ${spec.maximum}.`;
      return null;
    case "string":
      if (typeof value !== "string") return `"${key}" must be text.`;
      if (typeof spec.minLength === "number" && value.trim().length < spec.minLength) return `"${key}" can't be empty.`;
      if (typeof spec.maxLength === "number" && value.length > spec.maxLength) return `"${key}" is too long (at most ${spec.maxLength} characters).`;
      if (Array.isArray(spec.enum) && !spec.enum.includes(value)) return `"${key}" must be one of: ${(spec.enum as string[]).join(", ")}.`;
      if (typeof spec.pattern === "string" && !new RegExp(spec.pattern).test(value)) return `"${key}" isn't in the right format (${spec.description as string})`;
      return null;
    default:
      return null;
  }
}

/** The weekly review prompt (prompts/get). */
export const PROMPTS = [
  {
    name: "weekly_review",
    title: "Weekly review",
    description: "Look back at the week's notes and open tasks, and plan the next one.",
  },
];

export function weeklyReviewMessages(): { role: "user"; content: { type: "text"; text: string } }[] {
  return [
    {
      role: "user",
      content: {
        type: "text",
        text:
          "Help me with my weekly review in Folevi. Use list_recent_notes to see what I worked on this week and list_tasks " +
          "(views today, upcoming and inbox) for what's open. Summarise what got done, list what's overdue or undated, " +
          "and suggest three priorities for next week. Ask before adding or changing anything.",
      },
    },
  ];
}

/** Markdown without a first heading that only repeats the note's title (the title is shown above it). */
export function withoutTitleHeading(markdown: string, title: string): string {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const m = /^\s*#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(markdown);
  return m && key(m[1]!) === key(title) && key(title) ? markdown.slice(m[0].length) : markdown;
}
