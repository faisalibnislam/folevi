// Answering a question from the person's notes in local mode: convex/ai.ts answerFromNotes, step for step, with
// the library's own search in place of the server's index. The notes asked about come first; unless the
// question is only about them, the model turns it into search terms (the fast call), the library's full-text
// index finds notes, and their text goes to the answer with [n] citations. A request to change notes gets a
// plan instead, which the person checks before anything changes (aiActions.apply), where the model has room
// for it. Prompts come from @folevi/ai-prompts, exactly as the server builds them.
import { actRequest, answerRequest, citedIndexes, parseAct, parseQueries, searchTermsRequest, type SourceNote } from "@folevi/ai-prompts/ask";
import { actReply, checkPlan, type AiAction } from "@folevi/ai-prompts/actions";
import { takeRemember, type MemoryKind } from "@folevi/ai-prompts/memory";
import { splitFollowUps } from "@folevi/ai-prompts/ask";
import { api } from "@/lib/convex/api";
import type { LocalActionCtx } from "../registry";
import { memoryFor, noteMarkdown, read, readableNote } from "./common";
import { clip, estimateTokens, localAi, textBudget } from "./provider";
import { localAiState } from "./state";

/** Per note found by search (convex/ai.ts NOTE_CHARS), and all of them together (SOURCES_TOKENS). */
const NOTE_CHARS = 6_000;
const SOURCES_TOKENS = 12_000;
const FOCUS_CHARS = 30_000;
/** How often the text so far is written while it streams (convex/ai.ts FLUSH_MS). */
const FLUSH_MS = 90;

/** Where a streamed answer goes (convex/ai.ts AnswerSink). */
export interface AnswerSink {
  write(text: string): boolean;
  finish(text: string): void;
  fail(written: string): void;
  phase?(phase: string): void;
  shown?(text: string): string;
  signal?: AbortSignal;
}

export interface LocalAnswerInput {
  question: string;
  history: { role: "user" | "assistant"; text: string }[];
  documentIds: string[];
  notesOnly: boolean;
  folderId?: string;
  sink?: AnswerSink;
  chat?: boolean;
  remember?: boolean;
}

export interface LocalAnswerOutput {
  answer: string;
  notes: SourceNote[];
  cited: Set<number>;
  actions?: AiAction[];
  suggestions: string[];
  memory?: { kind: MemoryKind; text: string } | null;
  stopped: boolean;
}

/** Runs a request into a sink, the text so far written at most every 90 ms, then settled (streamInto). */
export async function streamInto(sink: AnswerSink | undefined, req: Parameters<typeof localAi.generate>[0], memory: string | null): Promise<{ text: string; stopped: boolean }> {
  if (!sink) {
    const out = await localAi.generate(req, { memory });
    return { text: out.text, stopped: out.stopped };
  }
  let last = 0;
  let written = "";
  try {
    const out = await localAi.generate(req, {
      memory,
      signal: sink.signal,
      onDelta: (soFar) => {
        const now = Date.now();
        const shown = sink.shown ? sink.shown(soFar) : soFar;
        if (now - last < FLUSH_MS || shown === written) return true;
        last = now;
        written = shown;
        return sink.write(shown);
      },
    });
    sink.finish(sink.shown ? sink.shown(out.text) : out.text);
    return { text: out.text, stopped: out.stopped };
  } catch (e) {
    sink.fail(written);
    throw e;
  }
}

/** Fits passages into a token budget, best first (convex/lib/ai/retrieval.ts fitToBudget). */
export function fitToBudget<T extends { text: string }>(items: readonly T[], budget: number, perItem = Infinity): T[] {
  const out: T[] = [];
  let left = budget;
  for (const item of items) {
    if (left <= 0) break;
    const cap = Math.min(left, perItem) * 4;
    let text = item.text;
    if (text.length > cap) {
      const cut = text.lastIndexOf(" ", cap);
      text = `${text.slice(0, cut > cap * 0.6 ? cut : cap).trimEnd()}…`;
      if (text.length < 200 && item.text.length > 200) break;
    }
    out.push({ ...item, text });
    left -= estimateTokens(text);
  }
  return out;
}

/** Drops passages another, better-ranked one already has (retrieval.ts dedupePassages). */
function dedupe<T extends { text: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Notes for a question, best first (convex/ai.ts gather, keyword half): each query through the library's
 * full-text search (search.documents), notes matching more queries first; never in Trash, archived, a
 * template or `exclude`; only `folderId`'s when given. Nothing matched: the most recent notes, marked `recent`.
 */
export async function gather(ctx: LocalActionCtx, o: { queries: string[]; exclude?: string; limit: number; folderId?: string; budgetTokens: number }): Promise<SourceNote[]> {
  const score = new Map<string, { hits: number; rank: number }>();
  let rank = 0;
  for (const q of o.queries.slice(0, 4)) {
    const text = q.trim().slice(0, 200);
    if (!text) continue;
    const found = await ctx.runQuery(api.search.documents, { scope: { kind: "personal" }, query: text, limit: 12, ...(o.folderId ? { folderId: o.folderId } : {}) });
    for (const d of found) {
      const cur = score.get(d.id);
      if (cur) cur.hits++;
      else score.set(d.id, { hits: 1, rank: rank++ });
    }
  }
  const ids = [...score.entries()].sort(([, a], [, b]) => b.hits - a.hits || a.rank - b.rank).map(([id]) => id);
  return await read(ctx, async (db) => {
    const ok = (d: { inTrash: boolean; archivedAt: number | null; kind: string; id: string; folderId: string | null; pending?: unknown }) =>
      !d.inTrash && !d.archivedAt && d.kind !== "template" && d.id !== o.exclude && !d.pending && (!o.folderId || d.folderId === o.folderId);
    const out: SourceNote[] = [];
    for (const id of ids) {
      if (out.length >= o.limit) break;
      const d = await db.get("documents", id);
      if (!d || !ok(d)) continue;
      out.push({ id: d.id, title: d.title || "Untitled", text: d.searchText.slice(0, NOTE_CHARS) });
    }
    if (out.length) return fitToBudget(dedupe(out), o.budgetTokens, Math.ceil(NOTE_CHARS / 4));
    // Nothing matched: in a folder its most recently edited notes, otherwise the newest notes (the server's
    // index order), marked as such.
    const all = (await db.list("documents")).filter((d) => !d.inTrash && !d.pending);
    const recent = o.folderId
      ? all.filter((d) => d.folderId === o.folderId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)
      : all.sort((a, b) => b.createdAt - a.createdAt || b.ordinal - a.ordinal).slice(0, 10);
    for (const d of recent) {
      if (out.length >= o.limit) break;
      if (!ok(d)) continue;
      out.push({ id: d.id, title: d.title || "Untitled", text: d.searchText.slice(0, NOTE_CHARS), recent: true });
    }
    return fitToBudget(out, o.budgetTokens, Math.ceil(NOTE_CHARS / 4));
  });
}

/** The folders a plan may name (aiActions.folders). */
async function folders(ctx: LocalActionCtx): Promise<{ id: string; name: string }[]> {
  return await read(ctx, async (db) =>
    (await db.list("folders"))
      .filter((f) => f.deletedAt === null)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
      .slice(0, 200)
      .map((f) => ({ id: f.id, name: f.name })),
  );
}

/** convex/ai.ts answerFromNotes, on this device. */
export async function answerFromNotes(ctx: LocalActionCtx, input: LocalAnswerInput): Promise<LocalAnswerOutput> {
  const { question, history, sink } = input;
  const active = await localAi.active(input.chat ? "chat" : "ask");
  const memory = await read(ctx, (db) => memoryFor(db));
  const onDevice = active.provider === "on-device";
  // On the device every note shares the little room there is: the notes asked about, then what search found.
  const sourcesTokens = onDevice ? Math.max(300, Math.floor(textBudget(active, { serverChars: SOURCES_TOKENS * 4, overheadChars: 2_400 + question.length + history.reduce((n, t) => n + t.text.length, 0), answerTokens: 900 }) / 4)) : SOURCES_TOKENS;
  const focusChars = onDevice ? Math.min(FOCUS_CHARS, Math.floor((sourcesTokens * 4) / Math.max(1, input.documentIds.length))) : FOCUS_CHARS;
  const notes: SourceNote[] = await read(ctx, async (db) => {
    const out: SourceNote[] = [];
    for (const id of input.documentIds) {
      const doc = await readableNote(db, id);
      out.push({ id: doc.id, title: doc.title || "Untitled", text: clip(await noteMarkdown(db, doc, FOCUS_CHARS), focusChars) });
    }
    return out;
  });
  let act = false;
  let queries: string[] = [question];
  if (!input.notesOnly) {
    sink?.phase?.("searching");
    const raw = (await localAi.generate(searchTermsRequest({ question, history }), { signal: sink?.signal })).text;
    act = parseAct(raw) && localAiState().features.actions;
    queries = parseQueries(raw, question);
    const seen = new Set(notes.map((n) => n.id));
    const left = Math.max(200, sourcesTokens - notes.reduce((n, x) => n + estimateTokens(x.text), 0));
    for (const n of await gather(ctx, { queries, exclude: input.documentIds[0], limit: onDevice ? 4 : 8, folderId: input.folderId, budgetTokens: left })) if (!seen.has(n.id)) notes.push(n);
    sink?.phase?.("reading");
  }

  if (act) {
    const known = await folders(ctx);
    if (input.folderId) {
      const seen = new Set(notes.map((n) => n.id));
      for (const n of await gather(ctx, { queries, exclude: input.documentIds[0], limit: 8, budgetTokens: SOURCES_TOKENS })) if (!seen.has(n.id)) notes.push(n);
    }
    const raw = (await localAi.generate(actRequest({ folders: known, notes, history, question, folderId: input.folderId }), { memory, signal: sink?.signal })).text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const actions = checkPlan(parsed, known, notes);
    const answer = actReply(parsed, actions);
    sink?.finish(answer);
    return { answer, notes: [], cited: new Set(), actions, suggestions: [], stopped: false };
  }

  sink?.phase?.("writing");
  const req = answerRequest({ notes, question, history, notesOnly: input.notesOnly, focused: input.documentIds.length > 0, chat: input.chat, remember: input.chat && input.remember });
  const { text: raw, stopped } = await streamInto(sink, req, memory);
  const proposal = input.chat && input.remember ? takeRemember(raw) : { text: raw, memory: null };
  const { answer, suggestions } = input.chat ? splitFollowUps(proposal.text) : { answer: raw, suggestions: [] };
  return { answer, notes, cited: citedIndexes(answer), suggestions, ...(proposal.memory ? { memory: proposal.memory } : {}), stopped };
}
