// Shared AI conversations (docs/AI_ASSISTANT.md, "Sharing"; convex/aiSharing.ts): which notes a
// conversation depends on. A workspace member sees a shared conversation only while they can open every
// one of them, so this errs on the side of including a note: what the answers cite, what the conversation
// is about, notes whose files were attached, notes an answer proposed to move, and notes an agent run read,
// changed, merged or made.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** At most this many notes are kept for a conversation (more, and it can't be shared). */
export const MAX_NOTE_REFS = 300;
/** Messages read when working out a conversation's notes (a conversation holds at most 400). */
const MESSAGES_READ = 401;

/** The notes one message depends on (public ids): citations, proposed moves and what they made. */
export function messageNoteIds(m: Pick<Doc<"aiMessages">, "citations" | "actions" | "actionsOutcome">): string[] {
  const out: string[] = [];
  for (const c of m.citations ?? []) out.push(c.noteId);
  for (const a of m.actions ?? []) if (a.type === "moveNote") out.push(a.noteId);
  if (m.actionsOutcome?.kind === "applied") for (const n of m.actionsOutcome.notes) out.push(n.id);
  return out;
}

/** The notes an agent run depends on: the ones it changes, merges in, and made. */
export function runNoteIds(run: Pick<Doc<"aiRuns">, "operations">): string[] {
  const out: string[] = [];
  for (const o of run.operations) {
    if (o.noteId) out.push(o.noteId);
    for (const s of o.sources ?? []) out.push(s.id);
    if (o.result?.noteId) out.push(o.result.noteId);
  }
  return out;
}

/** The notes a research job's report drew on. */
export function researchNoteIds(job: Pick<Doc<"aiResearch">, "sources">): string[] {
  return (job.sources ?? []).flatMap((s) => (s.kind === "note" ? [s.id] : []));
}

/**
 * Every note some of a conversation's messages depend on: the conversation's own notes (what it's about),
 * each message's, their agent runs' and research jobs', and the notes of attached note files (a chat upload
 * belongs to no note). Deduplicated, in order of first appearance.
 */
export async function conversationNoteIds(ctx: Ctx, c: Doc<"aiConversations">, messages: Doc<"aiMessages">[]): Promise<string[]> {
  const ids: string[] = [];
  if (c.context.kind === "note" || c.context.kind === "notes") ids.push(...c.context.ids);
  const files = new Map<Id<"files">, string | null>();
  for (const m of messages) {
    ids.push(...messageNoteIds(m));
    if (m.agent?.runId) {
      const run = await ctx.db.get(m.agent.runId);
      if (run) ids.push(...runNoteIds(run));
    }
    for (const id of m.attachments ?? []) {
      if (!files.has(id)) {
        const f = await ctx.db.get(id);
        const doc = f?.documentId ? await ctx.db.get(f.documentId) : null;
        files.set(id, doc?.publicId ?? null);
      }
      const noteId = files.get(id);
      if (noteId) ids.push(noteId);
    }
  }
  const jobs = await ctx.db
    .query("aiResearch")
    .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
    .take(200);
  for (const j of jobs) ids.push(...researchNoteIds(j));
  return [...new Set(ids)];
}

/** All of a conversation's notes, from every message it holds. */
export async function allNoteIds(ctx: Ctx, c: Doc<"aiConversations">): Promise<string[]> {
  const messages = await ctx.db
    .query("aiMessages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
    .take(MESSAGES_READ);
  return await conversationNoteIds(ctx, c, messages);
}

/**
 * A shared conversation changed (an answer settled, a run finished, what it's about changed): works its
 * notes out again, so members see it only while they can open all of them. Not shared: nothing to do.
 */
export async function refreshNoteRefs(ctx: MutationCtx, conversationId: Id<"aiConversations">): Promise<void> {
  const c = await ctx.db.get(conversationId);
  if (!c || c.sharedWith !== "workspace") return;
  await ctx.db.patch(c._id, { noteRefs: (await allNoteIds(ctx, c)).slice(0, MAX_NOTE_REFS + 1) });
}
