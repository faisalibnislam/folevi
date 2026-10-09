// The agent's tools (docs/AI_ASSISTANT.md, "Tools and the agent"): one registry the model sees through
// function calling (toolDeclarations) and the agent runs through `runTool`. Every tool checks its
// arguments against its schema first, and runs as the person through the host (convex/aiAgent.ts): read
// tools read only what they can open, write tools only propose (a preview the person approves; nothing is
// changed here). A tool never throws to the agent: a refusal comes back as `{ error }` the model can act on.
import type { SourceNote } from "../../../ai";
import type { ToolDeclaration } from "../provider";
import { calculate, MAX_EXPRESSION } from "./calculate";
import { MAX_EDITS, MAX_ITEMS, MAX_MERGE, MAX_OP_MARKDOWN, MAX_TAGS, OP_KINDS, type AgentOp, type OpKind } from "./ops";
import { findRelated } from "./related";
import { checkArgs, type ObjectSchema } from "./schema";
import { untrusted } from "./untrusted";

/** What tools run through: the database as the person, search, and proposals (convex/aiAgent.ts). */
export interface ToolHost {
  /** A read tool's database part (lib/ai/tools/read.ts READERS), as the person. */
  inspect(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Hybrid search over the place's notes the person can open (aiIndex.hybridSearch). */
  search(input: { question: string; queries: string[]; limit: number; folderId?: string; exclude?: string }): Promise<SourceNote[]>;
  /** The knowledge graph's related notes (aiGraph.related), as the person. */
  graphRelated?(noteId: string): Promise<{ id: string; title: string; reasons: string[] }[]>;
  /** The knowledge graph's likely duplicates (aiGraph.duplicates), of one note or the whole place. */
  graphDuplicates?(noteId?: string): Promise<{ a: { id: string; title: string }; b: { id: string; title: string }; score: number }[]>;
  /** A write tool's proposal (lib/ai/tools/propose.ts PROPOSERS), as the person. */
  propose(kind: OpKind, args: Record<string, unknown>, earlier: AgentOp[]): Promise<AgentOp>;
}

/** One line of what the agent did, for the chat ("Searched notes", "Read 3 notes"). */
export interface AgentStep {
  tool: string;
  /** Notes read, results found or changes proposed. */
  count: number;
  ok: boolean;
}

export interface ToolOutcome {
  /** What the model gets back (as a functionResponse). */
  response: Record<string, unknown>;
  step: AgentStep;
  /** A write tool's proposal. */
  op?: AgentOp;
}

interface Tool {
  name: string;
  description: string;
  parameters: ObjectSchema;
  kind: "read" | "write" | "unavailable";
  run(host: ToolHost, args: Record<string, unknown>, ops: AgentOp[]): Promise<{ response: Record<string, unknown>; count: number; op?: AgentOp }>;
}

const id = (what: string) => ({ type: "string" as const, description: what, maxLength: 64, minLength: 1 });
const markdown = (what: string) => ({ type: "string" as const, description: what, maxLength: MAX_OP_MARKDOWN });
const folderArgs = {
  folderId: { type: "string" as const, description: "An existing folder's id (from list_folders), or the id of a folder proposed with create_folder. \"none\" for no folder.", maxLength: 64 },
  folderName: { type: "string" as const, description: "Or the folder's name (an existing folder, or one proposed with create_folder).", maxLength: 80 },
};

/** Search results as the model sees them: ids, titles, and excerpts wrapped as untrusted. */
function hits(notes: { id: string; title: string; excerpt: string }[]) {
  return notes.map((n) => ({ id: n.id, title: n.title, excerpt: untrusted("note", { id: n.id, title: n.title }, n.excerpt) }));
}

const unavailable = (name: string, description: string, parameters: ObjectSchema, what: string): Tool => ({
  name,
  description,
  parameters,
  kind: "unavailable",
  run: async () => ({ response: { error: `${what} isn't available yet. Tell the person, and carry on without it.` }, count: 0 }),
});

/** A write tool: it checks the arguments, then asks the host for a proposal. */
const writeTool = (name: OpKind, description: string, parameters: ObjectSchema): Tool => ({
  name,
  description: `${description} This only proposes the change: the person reviews and approves it before anything happens.`,
  parameters,
  kind: "write",
  async run(host, args, ops) {
    const op = await host.propose(name, args, ops);
    return { response: { proposed: { id: op.id, summary: op.summary }, note: "Proposed, not done. It happens only if the person approves it." }, count: 1, op };
  },
});

export const TOOLS: Tool[] = [
  {
    name: "search_notes",
    description: "Search the person's notes here (keyword and meaning). Returns note ids, titles and short excerpts.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in a few words.", maxLength: 300, minLength: 1 },
        folderId: { type: "string", description: "Only notes in this folder.", maxLength: 64 },
        limit: { type: "integer", description: "At most this many notes (1 to 10, default 8).", minimum: 1, maximum: 10 },
      },
      required: ["query"],
    },
    kind: "read",
    async run(host, args) {
      const query = String(args.query);
      const found = (await host.search({ question: query, queries: [query], limit: Number(args.limit ?? 8), folderId: args.folderId as string | undefined })).filter((n) => !n.recent);
      if (!found.length) return { response: { notes: [], note: "No notes matched." }, count: 0 };
      return { response: { notes: hits(found.map((n) => ({ id: n.id, title: n.title, excerpt: n.text.replace(/\s+/g, " ").slice(0, 600) }))) }, count: found.length };
    },
  },
  {
    name: "get_note",
    description: "Read one note: its title, folder and blocks, each line starting with the block's id in brackets (use those ids with update_note).",
    parameters: { type: "object", properties: { noteId: id("The note's id."), maxChars: { type: "integer", description: "Characters to read (default 12000, at most 20000).", minimum: 500, maximum: 20_000 } }, required: ["noteId"] },
    kind: "read",
    run: async (host, args) => ({ response: await host.inspect("get_note", args), count: 1 }),
  },
  {
    name: "get_notes",
    description: "Read up to 5 notes at once (shorter than get_note for each).",
    parameters: { type: "object", properties: { noteIds: { type: "array", items: id("A note id."), minItems: 1, maxItems: 5 } }, required: ["noteIds"] },
    kind: "read",
    async run(host, args) {
      const r = await host.inspect("get_notes", args);
      return { response: r, count: Array.isArray(r.notes) ? r.notes.length : 0 };
    },
  },
  {
    name: "list_folders",
    description: "List the folders here (ids and names).",
    parameters: { type: "object", properties: {} },
    kind: "read",
    async run(host, args) {
      const r = await host.inspect("list_folders", args);
      return { response: r, count: Array.isArray(r.folders) ? r.folders.length : 0 };
    },
  },
  {
    name: "list_tags",
    description: "List the tags here (ids and names).",
    parameters: { type: "object", properties: {} },
    kind: "read",
    async run(host, args) {
      const r = await host.inspect("list_tags", args);
      return { response: r, count: Array.isArray(r.tags) ? r.tags.length : 0 };
    },
  },
  {
    name: "find_related",
    description: "Find notes about the same things as a given note.",
    parameters: { type: "object", properties: { noteId: id("The note's id."), limit: { type: "integer", description: "At most this many (1 to 10, default 5).", minimum: 1, maximum: 10 } }, required: ["noteId"] },
    kind: "read",
    async run(host, args) {
      const note = (await host.inspect("related_seed", { noteId: args.noteId })) as { id: string; title: string; text: string };
      const related = await findRelated(host, { note, limit: Number(args.limit ?? 5) });
      return { response: { notes: hits(related) }, count: related.length };
    },
  },
  {
    name: "find_duplicates",
    description: "Find notes that look like duplicates (similar titles and text), here or of one given note.",
    parameters: { type: "object", properties: { noteId: { type: "string", description: "Only duplicates of this note.", maxLength: 64 }, limit: { type: "integer", description: "At most this many pairs (default 10).", minimum: 1, maximum: 20 } } },
    kind: "read",
    async run(host, args) {
      // The knowledge graph's pairs (content close in meaning, titles alike) where there is one; otherwise
      // title and text similarity over recent notes.
      const graph = host.graphDuplicates ? await host.graphDuplicates((args.noteId as string | undefined) || undefined).catch(() => []) : [];
      if (graph.length) {
        const pairs = graph.slice(0, Number(args.limit ?? 10)).map((p) => ({ a: { id: p.a.id, title: p.a.title }, b: { id: p.b.id, title: p.b.title }, similarity: p.score }));
        return { response: { pairs }, count: pairs.length };
      }
      const r = await host.inspect("find_duplicates", args);
      return { response: r, count: Array.isArray(r.pairs) ? r.pairs.length : 0 };
    },
  },
  {
    name: "compare_notes",
    description: "Read two notes side by side with how similar they are.",
    parameters: { type: "object", properties: { noteIds: { type: "array", items: id("A note id."), minItems: 2, maxItems: 2 } }, required: ["noteIds"] },
    kind: "read",
    run: async (host, args) => ({ response: await host.inspect("compare_notes", args), count: 2 }),
  },
  {
    name: "get_workspace_context",
    description: "Where you are: today's date, the place (Personal or a workspace), what the conversation is about, counts of folders and tags, and the most recently edited notes.",
    parameters: { type: "object", properties: {} },
    kind: "read",
    run: async (host, args) => ({ response: await host.inspect("get_workspace_context", args), count: 0 }),
  },
  {
    name: "calculate",
    description: "Work out arithmetic exactly (+ - * / % ^, parentheses, sqrt, abs, round(x, digits), floor, ceil, min, max, sum, avg, log, ln, exp, pi, e). Always use this instead of doing arithmetic yourself.",
    parameters: { type: "object", properties: { expression: { type: "string", description: "For example (1250 * 12) / 7.", maxLength: MAX_EXPRESSION, minLength: 1 } }, required: ["expression"] },
    kind: "read",
    async run(_host, args) {
      const r = calculate(String(args.expression));
      return { response: r.ok ? { result: r.value } : { error: r.error }, count: 0 };
    },
  },
  unavailable("read_attachment", "Read a file attached to a note (PDF, image, spreadsheet).", { type: "object", properties: { fileId: id("The file's id.") }, required: ["fileId"] }, "Reading attachments"),
  unavailable("search_web", "Search the web.", { type: "object", properties: { query: { type: "string", description: "What to look for.", maxLength: 300, minLength: 1 } }, required: ["query"] }, "Web search"),

  writeTool("create_note", "Propose a new note.", {
    type: "object",
    properties: { title: { type: "string", description: "Its title.", maxLength: 200, minLength: 1 }, markdown: markdown("Its body in Markdown (no title heading)."), ...folderArgs },
    required: ["title", "markdown"],
  }),
  writeTool("update_note", "Propose block-level edits to a note: replace a block, insert new blocks after one (or at the top), or delete a block. Use block ids from get_note. Put all edits to one note in one call.", {
    type: "object",
    properties: {
      noteId: id("The note's id."),
      edits: {
        type: "array",
        minItems: 1,
        maxItems: MAX_EDITS,
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["replace", "insert", "delete"] },
            blockId: { type: "string", description: "The block to replace or delete.", maxLength: 64 },
            afterBlockId: { type: "string", description: "insert: the block to insert after (leave out to insert at the top).", maxLength: 64 },
            markdown: markdown("replace and insert: the new content in Markdown (it may become several blocks)."),
          },
          required: ["action"],
        },
      },
    },
    required: ["noteId", "edits"],
  }),
  writeTool("append_to_note", "Propose adding Markdown to the end of a note.", {
    type: "object",
    properties: { noteId: id("The note's id."), markdown: markdown("What to add, in Markdown.") },
    required: ["noteId", "markdown"],
  }),
  writeTool("rename_note", "Propose a new title for a note.", {
    type: "object",
    properties: { noteId: id("The note's id."), title: { type: "string", description: "The new title.", maxLength: 200, minLength: 1 } },
    required: ["noteId", "title"],
  }),
  writeTool("move_note", "Propose moving a note into a folder (or out of its folder).", {
    type: "object",
    properties: { noteId: id("The note's id."), ...folderArgs },
    required: ["noteId"],
  }),
  writeTool("create_folder", "Propose a new folder.", {
    type: "object",
    properties: { name: { type: "string", description: "Its name.", maxLength: 80, minLength: 1 } },
    required: ["name"],
  }),
  writeTool("add_tags", "Propose tags for a note (new tags are created).", {
    type: "object",
    properties: { noteId: id("The note's id."), tags: { type: "array", items: { type: "string", maxLength: 40, minLength: 1 }, minItems: 1, maxItems: MAX_TAGS } },
    required: ["noteId", "tags"],
  }),
  writeTool("create_checklist", "Propose a checklist: added to the end of a note (noteId), or as a new note (title).", {
    type: "object",
    properties: {
      title: { type: "string", description: "A heading for it, or the new note's title.", maxLength: 200 },
      items: { type: "array", items: { type: "string", maxLength: 300, minLength: 1 }, minItems: 1, maxItems: MAX_ITEMS },
      noteId: { type: "string", description: "Add it to this note.", maxLength: 64 },
      ...folderArgs,
    },
    required: ["items"],
  }),
  writeTool("create_tasks", "Propose tasks (to-dos with optional due dates): added to the end of a note (noteId), or as a new note (title).", {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        minItems: 1,
        maxItems: MAX_ITEMS,
        items: { type: "object", properties: { title: { type: "string", maxLength: 300, minLength: 1 }, dueDate: { type: "string", description: "YYYY-MM-DD", maxLength: 10 } }, required: ["title"] },
      },
      noteId: { type: "string", description: "Add them to this note.", maxLength: 64 },
      title: { type: "string", description: "Or the title of a new note for them.", maxLength: 200 },
      ...folderArgs,
    },
    required: ["tasks"],
  }),
  writeTool("merge_notes", "Propose merging notes into one: each source's content is added to the end of the target under its title, then the sources go to Trash.", {
    type: "object",
    properties: { targetId: id("The note to keep."), sourceIds: { type: "array", items: id("A note to merge in."), minItems: 1, maxItems: MAX_MERGE } },
    required: ["targetId", "sourceIds"],
  }),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
/** Every write tool is a kind of operation (lib/ai/tools/ops.ts). */
export const WRITE_TOOLS = new Set<string>(OP_KINDS);

/** What the model is offered (function declarations). */
export function toolDeclarations(): ToolDeclaration[] {
  // A tool without arguments declares none (an empty object schema is refused).
  return TOOLS.map((t) => ({ name: t.name, description: t.description, ...(Object.keys(t.parameters.properties).length ? { parameters: t.parameters as unknown as Record<string, unknown> } : {}) }));
}

/** A refusal's message: a ConvexError's (lib/errors.ts fail), or a general one (never a stack). */
function errorText(e: unknown): string {
  const data = (e as { data?: { message?: unknown } })?.data;
  if (data && typeof data.message === "string") return data.message.slice(0, 300);
  return "That didn't work.";
}

/**
 * Runs one tool call as the person: unknown tools and bad arguments are refused, errors come back as
 * `{ error }`. `ops` are the run's proposals so far (a write tool adds to them through the outcome).
 */
export async function runTool(host: ToolHost, call: { name: string; args: Record<string, unknown> }, ops: AgentOp[]): Promise<ToolOutcome> {
  const tool = BY_NAME.get(call.name);
  if (!tool) return { response: { error: `There's no tool called ${call.name}.` }, step: { tool: "unknown", count: 0, ok: false } };
  const checked = checkArgs(tool.parameters, call.args);
  if (!checked.ok) return { response: { error: checked.error }, step: { tool: tool.name, count: 0, ok: false } };
  try {
    const r = await tool.run(host, checked.value, ops);
    return { response: r.response, step: { tool: tool.name, count: r.count, ok: tool.kind !== "unavailable" && !("error" in r.response) }, ...(r.op ? { op: r.op } : {}) };
  } catch (e) {
    return { response: { error: errorText(e) }, step: { tool: tool.name, count: 0, ok: false } };
  }
}
