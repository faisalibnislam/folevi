// Foli AI on both backends (WP11): account mode calls Gemini on the server (a stubbed `fetch`), local mode the
// model on the device or the person's own key (a fake host, lib/local/ai/state.ts). The same model replies go
// in, so the same prompts must come out (built by @folevi/ai-prompts on both sides) and the same checked
// results must come back, in the server's shapes.
import { vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { AiRequest, AiResult } from "../../../apps/web/src/lib/shell/types";
import { configureLocalAiHost, refreshLocalAi } from "../../../apps/web/src/lib/local/ai/state";
import { para, todo } from "../kit";
import { scenario, type ParityBackend } from "../types";

type Responder = (system: string, prompt: string) => string;
interface Sent {
  system: string;
  prompt: string;
  json: boolean;
}

/** The model for this backend: Gemini behind a stubbed fetch, or the local fake host. Returns what was sent. */
async function useModel(b: ParityBackend, respond: Responder): Promise<{ sent: Sent[]; done: () => void }> {
  const sent: Sent[] = [];
  if (b.kind === "convex") {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { systemInstruction?: { parts: { text: string }[] }; contents: { parts: { text?: string }[] }[]; generationConfig?: { responseMimeType?: string } };
        const system = body.systemInstruction?.parts.map((p) => p.text).join("") ?? "";
        const prompt = body.contents.at(-1)!.parts.map((p) => p.text ?? "").join("");
        sent.push({ system, prompt, json: body.generationConfig?.responseMimeType === "application/json" });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: respond(system, prompt) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }), { status: 200 });
      }),
    );
    return {
      sent,
      done: () => {
        vi.unstubAllGlobals();
        delete process.env.GEMINI_API_KEY;
      },
    };
  }
  const ai = {
    capabilities: async () => ({ onDevice: false, keys: { "ai.google": true } }),
    generate: (req: AiRequest, onChunk: (t: string) => void) => {
      const system = req.system ?? "";
      const prompt = req.messages.at(-1)!.content;
      sent.push({ system, prompt, json: req.json === true });
      const text = respond(system, prompt);
      onChunk(text);
      return { done: Promise.resolve<AiResult>({ text, stopReason: "end" }), cancel: () => {} };
    },
  };
  configureLocalAiHost(() => ({ ai, secrets: { has: async () => true, set: async () => {}, delete: async () => {} } }));
  await refreshLocalAi();
  return { sent, done: () => configureLocalAiHost(null) };
}

const TABLE = { rows: [["Item", "Price", "Qty", "Total"], ["Apples", "1.5", "4", "=Price * Qty"], ["Pears", "2", "3", ""]], headerRow: true };
const BOARD = JSON.stringify({ v: 1, notes: [{ id: "s1", text: "Faster sign up", color: "yellow", x: 0, y: 0 }, { id: "s2", text: "Dark mode", color: "blue", x: 200, y: 0 }, { id: "s3", text: "Fewer fields", color: "yellow", x: 0, y: 200 }] });
const CHART = JSON.stringify({ kind: "bar", columns: [{ id: "c1", name: "Month" }, { id: "c2", name: "Sales" }], rows: [["Jan", 10], ["Feb", 12]] });

/** The reply for each kind of request, by its system prompt (the same replies on both backends). */
const reply: Responder = (system, prompt) => {
  if (prompt.includes("Find the action items")) return JSON.stringify({ items: [{ text: "Send the deck", owner: "me", when: "on Monday", quote: "parity will send the deck on Monday." }] });
  if (system.includes("writing assistant") && prompt.includes("Suggest one short, specific title")) return '"Launch plan for May."';
  if (system.includes("writing assistant") && prompt.includes("flashcards")) return JSON.stringify({ cards: [{ q: "When is the launch?", a: "In May." }] });
  if (system.includes("writing assistant")) return "A clearer sentence.";
  if (prompt.includes("Draw a flowchart")) return JSON.stringify({ nodes: [{ id: "a", text: "Start" }, { id: "b", text: "Ship" }], edges: [{ from: "a", to: "b", label: "then" }], direction: "LR" });
  if (prompt.includes("Change the table")) return JSON.stringify({ rows: [["Item", "Price"], ["Apples", "1.5"]], summary: "Removed two columns." });
  if (prompt.includes("Write the formula")) return JSON.stringify({ formula: "=Price * Qty", explanation: "Price times quantity." });
  if (prompt.includes("Explain this table")) return JSON.stringify({ summary: "Two fruits.", points: ["Apples sell more."] });
  if (prompt.includes("Group these notes")) return JSON.stringify({ groups: [{ label: "Onboarding", ids: ["s1", "s3", "ghost"] }, { label: "Look", ids: ["s2"] }] });
  if (prompt.includes("Write this board up")) return JSON.stringify({ title: "Retro", summary: "Good sprint.", nextSteps: ["Ship dark mode", ""] });
  if (prompt.includes("Suggest new ideas")) return JSON.stringify({ ideas: [{ text: "Magic links", color: "green" }, { text: "Dark mode" }] });
  if (system.includes("chart") && !prompt.includes("note")) return JSON.stringify({ kind: "line", sort: "none", reason: "Months run in order." });
  if (prompt.includes('"segments"')) {
    const segments = JSON.parse(/\{"segments":[\s\S]*?\]\}/.exec(prompt)![0]).segments as { i: number; t: string }[];
    return JSON.stringify({ segments: segments.map((s) => ({ i: s.i, t: `ES ${s.t}` })) });
  }
  return "{}";
};

export const scenarios = [
  scenario({
    name: "Foli AI: writing help, flowcharts, tables, sticky notes, charts, to-dos and translation send the same prompts and return the same checked results",
    // The drivers sign in under different names ("parity", "Test"); who the to-dos can go to is still the one person.
    ignore: ["displayName"],
    async run(b, k) {
      const note = await k.newNote("note", { title: "Launch plan" });
      await k.upsert(note, [para(k.id("p1"), "parity will send the deck on Monday. We launch in May with a small beta.", "a1"), todo(k.id("t1"), "Book the venue", "a2")]);
      const model = await useModel(b, reply);
      try {
        const scope = b.scope;
        const out = {
          title: await b.action(api.ai.write, { scope, task: "title", documentId: note }),
          improve: await b.action(api.ai.write, { scope, task: "improve", text: "A sentence that could be clearer." }),
          flashcards: await b.action(api.ai.write, { scope, task: "flashcards", text: "We launch in May." }),
          summarizeNote: await b.action(api.ai.write, { scope, task: "summarize", documentId: note }),
          flowchart: await b.action(api.ai.flowchart, { scope, mode: "create", instruction: "How we ship" }),
          tableEdit: await b.action(api.tableAi.edit, { scope, table: TABLE, instruction: "Keep only item and price" }),
          tableFormula: await b.action(api.tableAi.formula, { scope, table: TABLE, instruction: "total", row: 2, column: 3 }),
          tableExplain: await b.action(api.tableAi.explain, { scope, table: TABLE }),
          cluster: await b.action(api.stickiesAi.cluster, { scope, board: BOARD }),
          ideas: await b.action(api.stickiesAi.ideas, { scope, board: BOARD }),
          writeUp: await b.action(api.stickiesAi.writeUp, { scope, board: BOARD }),
          chart: await b.action(api.chartAi.assist, { scope, task: "suggest", chart: CHART }),
          todos: await b.action(api.aiTodos.find, { scope, documentId: note }),
          translate: await b.action(api.aiStudy.translateNote, { scope, documentId: note, language: "Spanish", output: "replace" }),
          // What reached the model, call by call.
          sent: model.sent,
        };
        return out;
      } finally {
        model.done();
      }
    },
  }),
  scenario({
    name: "Foli AI: refusals before anything is sent read the same",
    async run(b) {
      const model = await useModel(b, reply);
      const refusal = async (p: Promise<unknown>) => {
        try {
          await p;
          return null;
        } catch (e) {
          const d = (e as { data?: { code?: string; message?: string } }).data;
          return d ? { code: d.code, message: d.message } : String(e);
        }
      };
      try {
        const scope = b.scope;
        return {
          noText: await refusal(b.action(api.ai.write, { scope, task: "improve", text: "  " })),
          unknown: await refusal(b.action(api.ai.write, { scope, task: "nope" })),
          noFlow: await refusal(b.action(api.ai.flowchart, { scope, mode: "update", instruction: "Add a step" })),
          emptyTable: await refusal(b.action(api.tableAi.explain, { scope, table: { rows: [[""]], headerRow: false } })),
          tinyBoard: await refusal(b.action(api.stickiesAi.cluster, { scope, board: JSON.stringify({ v: 1, notes: [] }) })),
          noChart: await refusal(b.action(api.chartAi.assist, { scope, task: "suggest", chart: "{}" })),
          noMap: await refusal(b.action(api.mindmapAi.summarize, { scope, data: "{}" })),
          noQuestion: await refusal(b.action(api.ai.ask, { scope, question: " " })),
          sent: model.sent.length,
        };
      } finally {
        model.done();
      }
    },
  }),
];
