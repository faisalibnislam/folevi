// Foli AI for the blocks, in local mode (convex/mindmapAi.ts, stickiesAi.ts, tableAi.ts, chartAi.ts,
// wireframeAi.ts): the same requests from @folevi/ai-prompts, the same strict checks on what comes back, run
// on the model active on this device. What the model can't do here (reading a PDF or a photo; wireframes on
// the small on-device model) is refused with a plain message, and the interface doesn't offer it
// (features.ts). Nothing is changed here: the block applies the result as one undoable change.
import { normalizeChart, parseMindmap, parseStickies, type WireframeData } from "@folevi/editor-schema";
import type { PromptRequest } from "@folevi/ai-prompts";
import { AI_MAX_TASKS, EXPAND_MAX, MAP_TEXT, MAX_INSTRUCTION as MAP_INSTRUCTION, MINDMAP_MESSAGES, cleanSummary, expandRequest, mapPromptRequest, mapTasksRequest, parseIdeasReply, parseMapReply, parseTasksReply, summarizeMapRequest, tidyRequest } from "@folevi/ai-prompts/mindmap";
import { MAX_INSTRUCTION as TABLE_INSTRUCTION, TABLE_MESSAGES, parseExplainReply, parseFormulaReply, parseTableReply, tableCleanRequest, tableEditRequest, tableExplainRequest, tableFormulaRequest, tableOf } from "@folevi/ai-prompts/table";
import { STICKIES_MESSAGES, MAX_TASKS as STICKY_TASKS, boardForPrompt, boardSummaryRequest, boardTasksRequest, clusterRequest, ideasRequest, labelledGroups, parseClusters, parseIdeas, parseSummary, parseTasks, parseWriteUp, promptBoardOf, writeUpRequest } from "@folevi/ai-prompts/stickies";
import { CHART_MESSAGES, MAX_CHART, MAX_INSTRUCTION as CHART_INSTRUCTION, NOTE_CHARS as CHART_NOTE_CHARS, chartTaskRequest, fromWordsRequest, parseChartDraft, parseChartPatch } from "@folevi/ai-prompts/chart";
import { AI_MAX_SCREENS, MAX_INSTRUCTION as WIREFRAME_INSTRUCTION, WIREFRAME_MESSAGES, drawRequest, parseWireframeReply, refineRequest, screenForPrompt, variationCount, varyRequest } from "@folevi/ai-prompts/wireframe";
import { MAX_QUESTION } from "@folevi/ai-prompts/ask";
import { api } from "@/lib/convex/api";
import { fail } from "../../errors";
import { defineLocal, type LocalActionCtx } from "../../registry";
import { checkScope } from "../../functions/shared";
import { memoryFor, noteMarkdown, read, readableNote, requireAiProfile } from "../common";
import { clip, localAi, textBudget } from "../provider";
import type { AiFeature } from "../features";
import { OFF_HERE } from "../provider";

/** The gates every block request passes (ai.begin's that apply here), then one call to the model. */
async function run(ctx: LocalActionCtx, feature: AiFeature, req: PromptRequest): Promise<string> {
  await read(ctx, (db) => requireAiProfile(db));
  await localAi.active(feature);
  const memory = await read(ctx, (db) => memoryFor(db));
  return (await localAi.generate(req, { memory })).text;
}

/** The gates only (before reading what a request needs). */
async function gate(ctx: LocalActionCtx, feature: AiFeature) {
  await read(ctx, (db) => requireAiProfile(db));
  return await localAi.active(feature);
}

// ---- mind maps --------------------------------------------------------------------------------------------

defineLocal(api.mindmapAi.generate, "action", async (ctx, args) => {
  checkScope(args.scope);
  const instruction = (args.instruction ?? "").trim().slice(0, MAP_INSTRUCTION);
  let req: PromptRequest;
  if (args.source === "prompt") {
    if (!instruction) fail("invalid_argument", MINDMAP_MESSAGES.noTopic);
    req = mapPromptRequest({ source: "prompt", instruction });
  } else if (args.source === "text") {
    const text = (args.text ?? "").trim().slice(0, MAP_TEXT);
    if (!text) fail("invalid_argument", MINDMAP_MESSAGES.noText);
    const active = await gate(ctx, "mindmap");
    req = mapPromptRequest({ source: "text", instruction, text: clip(text, textBudget(active, { serverChars: MAP_TEXT, overheadChars: 1_500 + instruction.length, answerTokens: 1_500 })) });
  } else if (args.source === "note") {
    if (!args.documentId) fail("invalid_argument", MINDMAP_MESSAGES.noNote);
    const active = await gate(ctx, "mindmap");
    const budget = textBudget(active, { serverChars: 30_000, overheadChars: 1_500 + instruction.length, answerTokens: 1_500 });
    const note = await read(ctx, async (db) => {
      const doc = await readableNote(db, args.documentId!);
      return { title: doc.title || "Untitled", text: await noteMarkdown(db, doc) };
    });
    if (!note.text.trim()) fail("invalid_argument", MINDMAP_MESSAGES.emptyNote);
    req = mapPromptRequest({ source: "note", instruction, note: { title: note.title, text: clip(note.text, budget) } });
  } else {
    // Reading a PDF needs the server's model (Gemini reads the file); local mode doesn't offer it.
    fail("forbidden", OFF_HERE, { reason: "ai_not_included" });
  }
  const data = parseMapReply(await run(ctx, "mindmap", req), { layout: args.layout });
  if (!data) fail("invalid_argument", MINDMAP_MESSAGES.mapFailed);
  return { data };
});

defineLocal(api.mindmapAi.expand, "action", async (ctx, args) => {
  checkScope(args.scope);
  const built = expandRequest(args.data, args.nodeId);
  if (!built) fail("invalid_argument", parseMindmap(args.data.slice(0, 250_000)).nodes.some((n) => n.id === args.nodeId) ? MINDMAP_MESSAGES.noMap : MINDMAP_MESSAGES.ideaGone);
  const ideas = parseIdeasReply(await run(ctx, "mindmap", built.request), built.at.children, EXPAND_MAX);
  if (!ideas.length) fail("invalid_argument", MINDMAP_MESSAGES.expandFailed);
  return { ideas };
});

defineLocal(api.mindmapAi.summarize, "action", async (ctx, args) => {
  checkScope(args.scope);
  const req = summarizeMapRequest(args.data);
  if (!req) fail("invalid_argument", MINDMAP_MESSAGES.noMap);
  const markdown = cleanSummary(await run(ctx, "mindmap", req));
  if (!markdown) fail("invalid_argument", MINDMAP_MESSAGES.summaryFailed);
  return { markdown };
});

defineLocal(api.mindmapAi.tasks, "action", async (ctx, args) => {
  checkScope(args.scope);
  const req = mapTasksRequest(args.data, args.nodeIds);
  if (!req) fail("invalid_argument", MINDMAP_MESSAGES.noMap);
  const list = parseTasksReply(await run(ctx, "mindmap", req)).slice(0, AI_MAX_TASKS);
  if (!list.length) fail("invalid_argument", MINDMAP_MESSAGES.tasksFailed);
  return { tasks: list };
});

defineLocal(api.mindmapAi.tidy, "action", async (ctx, args) => {
  checkScope(args.scope);
  const current = parseMindmap(args.data.slice(0, 250_000));
  const req = tidyRequest(args.data);
  if (!req) fail("invalid_argument", MINDMAP_MESSAGES.noMap);
  const data = parseMapReply(await run(ctx, "mindmap", req), { keep: current });
  if (!data) fail("invalid_argument", MINDMAP_MESSAGES.tidyFailed);
  return { data };
});

// ---- tables ------------------------------------------------------------------------------------------------

function table(args: { table: { rows: string[][]; headerRow: boolean; totalsRow?: boolean } }) {
  const t = tableOf(args.table);
  if (!t) fail("invalid_argument", TABLE_MESSAGES.empty);
  return t;
}

defineLocal(api.tableAi.edit, "action", async (ctx, args) => {
  checkScope(args.scope);
  const instruction = args.instruction.trim().slice(0, TABLE_INSTRUCTION);
  if (!instruction) fail("invalid_argument", TABLE_MESSAGES.noEdit);
  const reply = parseTableReply(await run(ctx, "table", tableEditRequest(table(args), instruction)));
  if (!reply) fail("invalid_argument", TABLE_MESSAGES.editFailed);
  return reply;
});

defineLocal(api.tableAi.clean, "action", async (ctx, args) => {
  checkScope(args.scope);
  const reply = parseTableReply(await run(ctx, "table", tableCleanRequest(table(args))));
  if (!reply) fail("invalid_argument", TABLE_MESSAGES.cleanFailed);
  return reply;
});

defineLocal(api.tableAi.formula, "action", async (ctx, args) => {
  checkScope(args.scope);
  const instruction = args.instruction.trim().slice(0, TABLE_INSTRUCTION);
  if (!instruction) fail("invalid_argument", TABLE_MESSAGES.noFormula);
  const t = table(args);
  const row = Math.trunc(args.row);
  const column = Math.trunc(args.column);
  if (row < 0 || column < 0 || row >= t.rows.length || column >= (t.rows[0]?.length ?? 0)) fail("invalid_argument", TABLE_MESSAGES.pickCell);
  const reply = parseFormulaReply(await run(ctx, "table", tableFormulaRequest(t, row, column, instruction)), t, row, column);
  if (!reply) fail("invalid_argument", TABLE_MESSAGES.formulaFailed);
  return reply;
});

defineLocal(api.tableAi.explain, "action", async (ctx, args) => {
  checkScope(args.scope);
  const reply = parseExplainReply(await run(ctx, "table", tableExplainRequest(table(args))));
  if (!reply) fail("invalid_argument", TABLE_MESSAGES.explainFailed);
  return reply;
});

// ---- sticky notes ------------------------------------------------------------------------------------------

function board(data: string, min: number, only?: readonly string[]) {
  const b = promptBoardOf(data, min, only);
  if ("refusal" in b) fail("invalid_argument", b.refusal);
  return b.board;
}

defineLocal(api.stickiesAi.cluster, "action", async (ctx, args) => {
  checkScope(args.scope);
  const b = board(args.board, 2);
  const groups = parseClusters(await run(ctx, "stickies", clusterRequest(b)), b.ids);
  if (groups === null) fail("invalid_argument", STICKIES_MESSAGES.clusterFailed);
  return { groups };
});

defineLocal(api.stickiesAi.summarize, "action", async (ctx, args) => {
  checkScope(args.scope);
  const summary = parseSummary(await run(ctx, "stickies", boardSummaryRequest(board(args.board, 1))));
  if (summary === null) fail("invalid_argument", STICKIES_MESSAGES.summaryFailed);
  return { summary };
});

defineLocal(api.stickiesAi.ideas, "action", async (ctx, args) => {
  checkScope(args.scope);
  const instruction = (args.instruction ?? "").trim().slice(0, MAX_QUESTION);
  const b = boardForPrompt(args.board);
  if (!b && !instruction) fail("invalid_argument", STICKIES_MESSAGES.noTopic);
  const existing = parseStickies(args.board.slice(0, 250_000)).notes.map((n) => n.text);
  const ideas = parseIdeas(await run(ctx, "stickies", ideasRequest(b, instruction)), existing);
  if (ideas === null) fail("invalid_argument", STICKIES_MESSAGES.ideasFailed);
  return { ideas };
});

defineLocal(api.stickiesAi.photo, "action", async (ctx, args) => {
  checkScope(args.scope);
  void args;
  // Reading a photo needs a model that sees images; local mode doesn't offer it yet.
  await gate(ctx, "stickiesPhoto");
  fail("unsupported_file", STICKIES_MESSAGES.noVision);
});

defineLocal(api.stickiesAi.tasks, "action", async (ctx, args) => {
  checkScope(args.scope);
  if (!args.noteIds.length) fail("invalid_argument", STICKIES_MESSAGES.chooseNotes);
  const b = board(args.board, 1, args.noteIds.slice(0, STICKY_TASKS));
  const tasks = parseTasks(await run(ctx, "stickies", boardTasksRequest(b)), b.ids);
  if (tasks === null) fail("invalid_argument", STICKIES_MESSAGES.tasksFailed);
  return { tasks };
});

defineLocal(api.stickiesAi.writeUp, "action", async (ctx, args) => {
  checkScope(args.scope);
  const b = board(args.board, 1);
  const out = parseWriteUp(await run(ctx, "stickies", writeUpRequest(b, labelledGroups(args.board))));
  if (out === null) fail("invalid_argument", STICKIES_MESSAGES.writeUpFailed);
  return out;
});

// ---- charts ------------------------------------------------------------------------------------------------

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

defineLocal(api.chartAi.assist, "action", async (ctx, args) => {
  checkScope(args.scope);
  const chart = normalizeChart(safeJson(args.chart.slice(0, MAX_CHART)));
  if (!chart.columns.length || !chart.rows.length) fail("invalid_argument", CHART_MESSAGES.noData);
  const patch = parseChartPatch(args.task, await run(ctx, "chart", chartTaskRequest(args.task, chart)), chart);
  if (!patch) fail("invalid_argument", CHART_MESSAGES.taskFailed);
  return patch;
});

defineLocal(api.chartAi.fromWords, "action", async (ctx, args) => {
  checkScope(args.scope);
  const instruction = args.instruction.trim().slice(0, CHART_INSTRUCTION);
  if (!instruction) fail("invalid_argument", CHART_MESSAGES.noInstruction);
  const active = await gate(ctx, "chart");
  const budget = textBudget(active, { serverChars: CHART_NOTE_CHARS, overheadChars: 2_000 + instruction.length, answerTokens: 2_048 });
  const note = args.documentId
    ? await read(ctx, async (db) => {
        const doc = await readableNote(db, args.documentId!);
        return { title: doc.title || "Untitled", text: clip(await noteMarkdown(db, doc), Math.min(CHART_NOTE_CHARS, budget)) };
      })
    : null;
  const data = parseChartDraft(await run(ctx, "chart", fromWordsRequest(instruction, note)));
  if (!data) fail("invalid_argument", note ? CHART_MESSAGES.noNumbersInNote : CHART_MESSAGES.noNumbers);
  return { data };
});

// ---- wireframes --------------------------------------------------------------------------------------------

async function screens(ctx: LocalActionCtx, req: PromptRequest, count: number, frame: "phone" | "tablet" | "browser" | "plain" | undefined): Promise<WireframeData> {
  const wf = parseWireframeReply(await run(ctx, "wireframe", req), { frame, maxScreens: count });
  if (!wf) fail("invalid_argument", WIREFRAME_MESSAGES.failed);
  return wf;
}

defineLocal(api.wireframeAi.draw, "action", async (ctx, args) => {
  checkScope(args.scope);
  const instruction = args.instruction.trim().slice(0, WIREFRAME_INSTRUCTION);
  if (!instruction) fail("invalid_argument", WIREFRAME_MESSAGES.noDescription);
  const frame = args.frame ?? "phone";
  return await screens(ctx, drawRequest(instruction, frame), AI_MAX_SCREENS, frame);
});

defineLocal(api.wireframeAi.vary, "action", async (ctx, args) => {
  checkScope(args.scope);
  const current = screenForPrompt(args.screen);
  if (!current) fail("invalid_argument", WIREFRAME_MESSAGES.noVaryScreen);
  const count = variationCount(args.count);
  const instruction = (args.instruction ?? "").trim().slice(0, WIREFRAME_INSTRUCTION);
  return await screens(ctx, varyRequest(current, count, instruction), count, current.frame);
});

defineLocal(api.wireframeAi.refine, "action", async (ctx, args) => {
  checkScope(args.scope);
  const instruction = args.instruction.trim().slice(0, WIREFRAME_INSTRUCTION);
  if (!instruction) fail("invalid_argument", WIREFRAME_MESSAGES.noChange);
  const current = screenForPrompt(args.screen);
  if (!current) fail("invalid_argument", WIREFRAME_MESSAGES.noRefineScreen);
  return await screens(ctx, refineRequest(current, instruction), 1, current.frame);
});
