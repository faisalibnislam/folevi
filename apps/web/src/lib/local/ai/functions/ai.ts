// ai.* in local mode (convex/ai.ts): live answers (startStream, stream, cancelStream), Ask AI, writing help,
// Catch me up and flowcharts, run on the model active on this device (provider.ts) with the server's own
// prompts and reply checks (@folevi/ai-prompts). No credits: the person's device or key does the work.
import { briefRequest, BRIEF_EMPTY, citedIndexes, cleanToday, MAX_QUESTION } from "@folevi/ai-prompts/ask";
import { PromptError } from "@folevi/ai-prompts";
import { projectTask } from "@folevi/editor-schema";
import { finishWriting, needsInstruction, needsSelection, readsNoteWith, taskSpec, textOrNote, usesFlashLite, writingRequest, writingTask } from "@folevi/ai-prompts/writing";
import { flowchartForPrompt, flowchartRequest, parseFlowchartDraft } from "@folevi/ai-prompts/flowchart";
import { api } from "@/lib/convex/api";
import type { Id } from "@/lib/convex/api";
import { fail } from "../../errors";
import { defineLocal } from "../../registry";
import { checkScope, toWireBlock } from "../../functions/shared";
import { answerFromNotes, streamInto, type AnswerSink } from "../answer";
import { memoryFor, noteMarkdown, read, readableNote, requireAiProfile } from "../common";
import { clip, localAi, textBudget } from "../provider";
import { cancelStream, claimStream, createStream, readStream, streamKey, writeStream } from "../streams";

const MAX_TEXT = 24_000;
const FOCUS_CHARS = 30_000;

/** A model's reply that can't be used: the same refusal the server gives (lib/ai/studyTools.ts orFail). */
export function orFail<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof PromptError) fail(e.code, e.message);
    throw e;
  }
}

/** The stream a request writes into, claimed before the model is called (convex/ai.ts claimStream). */
export function claim(id: string | undefined): AbortSignal | undefined {
  if (!id) return undefined;
  const signal = claimStream(id);
  if (!signal) fail("not_found", "That AI request has expired. Try again.");
  return signal;
}

/** A sink writing into a stream (convex/ai.ts streamSink). */
export function streamSink(id: string, signal: AbortSignal | undefined): AnswerSink {
  return {
    write: (text) => writeStream(id, text),
    finish: (text) => void writeStream(id, text, "done"),
    fail: (written) => void writeStream(id, written, "error"),
    signal,
  };
}

defineLocal(api.ai.startStream, "mutation", async (ctx) => {
  await requireAiProfile(ctx.db);
  return createStream(ctx.now()) as Id<"aiStreams">;
});

defineLocal(api.ai.stream, "query", async (ctx, args) => {
  ctx.watch?.(streamKey(args.id));
  return readStream(args.id);
});

defineLocal(api.ai.cancelStream, "mutation", async (_ctx, args) => {
  cancelStream(args.id);
  return null;
});

defineLocal(api.ai.ask, "action", async (ctx, args) => {
  checkScope(args.scope);
  const question = args.question.trim().slice(0, MAX_QUESTION);
  if (!question) fail("invalid_argument", "Ask a question first.");
  await read(ctx, (db) => requireAiProfile(db));
  await localAi.active("ask");
  const history = (args.history ?? []).slice(-6).map((t) => ({ role: t.role, text: t.text.slice(0, 3000) }));
  const signal = claim(args.streamId);
  const out = await answerFromNotes(ctx, {
    question,
    history,
    documentIds: args.documentId ? [args.documentId] : [],
    notesOnly: args.range === "note",
    folderId: args.folderId,
    sink: args.streamId ? streamSink(args.streamId, signal) : undefined,
  });
  if (out.actions) return { answer: out.answer, sources: [], actions: out.actions };
  return {
    answer: out.answer,
    sources: out.notes.map((n, i) => ({ id: n.id, title: n.title, i })).filter((n) => out.cited.has(n.i)).map(({ id, title }) => ({ id, title })),
  };
});

defineLocal(api.ai.write, "action", async (ctx, args) => {
  checkScope(args.scope);
  const task = writingTask(args.task);
  if (!task) fail("invalid_argument", "Unknown AI action.");
  const text = (args.text ?? "").slice(0, MAX_TEXT);
  const instruction = (args.instruction ?? "").trim().slice(0, MAX_QUESTION);
  if ((needsSelection(task) || (textOrNote(task) && !args.documentId)) && !text.trim()) fail("invalid_argument", "Select some text first.");
  if (needsInstruction(task) && !instruction) fail("invalid_argument", task === "page" || task === "template" ? "Describe what to write first." : "Tell the AI what to write.");
  await read(ctx, (db) => requireAiProfile(db));
  const active = await localAi.active("write");
  const fast = usesFlashLite(task, text);
  const readsThisNote = Boolean(args.documentId && readsNoteWith(task, text));
  const json = Boolean(taskSpec(task).json);
  const signal = claim(args.streamId);
  // On the device the note is cut to what fits beside the instructions and the answer.
  const budget = textBudget(active, { serverChars: FOCUS_CHARS, overheadChars: 1_600 + instruction.length + (readsThisNote ? 0 : text.length), answerTokens: taskSpec(task).maxOutputTokens });
  const { note, memory } = await read(ctx, async (db) => {
    const doc = readsThisNote ? await readableNote(db, args.documentId!) : null;
    return { note: doc ? { id: doc.id, title: doc.title || "Untitled", text: clip(await noteMarkdown(db, doc, FOCUS_CHARS), budget) } : null, memory: await memoryFor(db) };
  });
  const req = writingRequest({ task, note, text: readsThisNote ? text : clip(text, budget || MAX_TEXT), instruction, language: args.language }, fast);
  if (json || !args.streamId) {
    const out = await localAi.generate(req, { memory, signal });
    try {
      const done = orFail(() => finishWriting(task, out.text));
      if (args.streamId) writeStream(args.streamId, done.text, "done");
      return done;
    } catch (e) {
      if (args.streamId) writeStream(args.streamId, "", "error");
      throw e;
    }
  }
  const out = await streamInto(streamSink(args.streamId, signal), req, memory);
  return orFail(() => finishWriting(task, out.text));
});

defineLocal(api.ai.flowchart, "action", async (ctx, args) => {
  checkScope(args.scope);
  const instruction = args.instruction.trim().slice(0, MAX_QUESTION);
  if (!instruction) fail("invalid_argument", args.mode === "create" ? "Describe the process first." : "Say what to change.");
  const current = args.mode === "update" ? flowchartForPrompt(args.current ?? "") : null;
  if (args.mode === "update" && !current) fail("invalid_argument", "There's no flowchart to update yet.");
  await read(ctx, (db) => requireAiProfile(db));
  await localAi.active("flowchart");
  const memory = await read(ctx, (db) => memoryFor(db));
  const raw = (await localAi.generate(flowchartRequest({ mode: args.mode, instruction, current }), { memory })).text;
  const draft = parseFlowchartDraft(raw);
  if (!draft) fail("invalid_argument", "The AI couldn't draw a flowchart from that. Try describing the steps.");
  return draft;
});

/** Recently edited notes and open tasks (convex/ai.ts recent), from the library. */
async function recent(ctx: Parameters<Parameters<typeof read>[1]>[0], now: number, perNote: number) {
  const since = now - 7 * 86_400_000;
  const docs = (await ctx.list("documents")).filter((d) => d.updatedAt > since).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  const notes: { id: string; title: string; text: string }[] = [];
  for (const d of docs) {
    if (notes.length >= 8) break;
    if (d.inTrash || d.archivedAt || d.kind === "template" || d.pending) continue;
    notes.push({ id: d.id, title: d.title || "Untitled", text: d.searchText.slice(0, perNote) });
  }
  return notes;
}

/** Open tasks, overdue and soon-due first, then undated (convex/ai.ts recent), with their note's title. */
async function openTasks(db: Parameters<Parameters<typeof read>[1]>[0]) {
  const rows: { title: string; due: string | null; note: string; made: number }[] = [];
  for (const doc of await db.list("documents")) {
    if (doc.kind === "template" || doc.inTrash || doc.pending) continue;
    for (const block of await db.list("blocks", doc.id)) {
      if (block.deletedAt !== null || block.type !== "todo") continue;
      const task = projectTask(toWireBlock(block), doc.id);
      if (!task || task.status !== "open") continue;
      rows.push({ title: task.title.slice(0, 200), due: task.dueDate ?? null, note: doc.title || "Untitled", made: block.createdAt });
    }
  }
  return rows
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.made - b.made)
    .slice(0, 20)
    .map(({ title, due, note }) => ({ title, due, note }));
}

defineLocal(api.ai.brief, "action", async (ctx, args) => {
  checkScope(args.scope);
  await read(ctx, (db) => requireAiProfile(db));
  const active = await localAi.active("brief");
  const signal = claim(args.streamId);
  const today = cleanToday(args.today);
  // On the device the notes share what room there is (the server sends up to 2,500 characters of each).
  const perNote = active.provider === "on-device" ? Math.max(200, Math.floor(textBudget(active, { serverChars: 8 * 2_500, overheadChars: 2_400, answerTokens: 1024 }) / 10)) : 2_500;
  const { notes, memory, open } = await read(ctx, async (db) => ({ notes: await recent(db, ctx.now(), perNote), memory: await memoryFor(db), open: await openTasks(db) }));
  if (!notes.length && !open.length) {
    if (args.streamId) writeStream(args.streamId, BRIEF_EMPTY, "done");
    return { answer: BRIEF_EMPTY, sources: [] };
  }
  const req = briefRequest({ today, notes, tasks: open });
  const { text: answer } = await streamInto(args.streamId ? streamSink(args.streamId, signal) : undefined, req, memory);
  const cited = citedIndexes(answer);
  return { answer, sources: notes.map((n, i) => ({ id: n.id, title: n.title, i })).filter((n) => cited.has(n.i)).map(({ id, title }) => ({ id, title })) };
});
