"use client";

// Foli AI's flowchart requests, as the signed-in person in the current place (the note's scope decides on the
// server; in local mode the same functions run on this device, lib/local/ai/functions/blocks.ts). Every
// result is only data: the canvas previews it and applies it as one change.
//
// Development builds also honour `window.__foleviTestFlowchartAi`, the e2e suite's scripted model
// (e2e/flowchart-ai.spec.ts): it answers instead of the server, so the previews, Apply and undo can be
// tested without Gemini. The builds people get never read it (lib/testHooks.ts).
import { useMemo } from "react";
import { useAction } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import type { AiArrangement, AiDraft, AiExplanation, AiExtension, AiLabelSuggestions } from "./aiOps";
import { TEST_HOOKS } from "@/lib/testHooks";

export type FlowAiTask = "draw" | "fromText" | "extend" | "explain" | "labels" | "arrange";
type TestModel = (task: FlowAiTask, args: Record<string, unknown>) => unknown;
declare global {
  interface Window {
    __foleviTestFlowchartAi?: TestModel;
  }
}

function testModel(): TestModel | null {
  if (!TEST_HOOKS || typeof window === "undefined") return null;
  return typeof window.__foleviTestFlowchartAi === "function" ? window.__foleviTestFlowchartAi : null;
}

/** Runs the scripted model when there is one (development only), the server otherwise. */
async function viaTest<T>(task: FlowAiTask, args: Record<string, unknown>, real: () => Promise<T>): Promise<T> {
  const test = testModel();
  if (!test) return real();
  const out = await test(task, args);
  if (out instanceof Error) throw out;
  return out as T;
}

export interface FlowAiClient {
  draw(mode: "create" | "update", instruction: string, current?: string): Promise<AiDraft>;
  fromText(o: { text?: string; documentId?: string; instruction?: string }): Promise<AiDraft>;
  extend(data: string, nodeIds: string[], kind: "next" | "branches", instruction?: string): Promise<AiExtension>;
  explain(data: string): Promise<AiExplanation>;
  labels(data: string): Promise<AiLabelSuggestions>;
  arrange(data: string): Promise<AiArrangement>;
}

/** The requests for one flowchart block (`documentId`: the note it is in, for the scope and credits). */
export function useFlowAiClient(documentId?: string): FlowAiClient {
  const { scope } = useAppState();
  const draw = useAction(api.ai.flowchart);
  const fromText = useAction(api.flowchartAi.fromText);
  const extend = useAction(api.flowchartAi.extend);
  const explain = useAction(api.flowchartAi.explain);
  const labels = useAction(api.flowchartAi.labels);
  const arrange = useAction(api.flowchartAi.arrange);
  return useMemo<FlowAiClient>(
    () => ({
      draw: (mode, instruction, current) => viaTest("draw", { mode, instruction, current }, () => draw({ scope, mode, instruction, current })),
      fromText: (o) => viaTest("fromText", o, () => fromText({ scope, text: o.text, documentId: o.documentId, instruction: o.instruction })),
      extend: (data, nodeIds, kind, instruction) => viaTest("extend", { data, nodeIds, kind, instruction }, () => extend({ scope, data, nodeIds, kind, instruction, documentId })),
      explain: (data) => viaTest("explain", { data }, () => explain({ scope, data, documentId })),
      labels: (data) => viaTest("labels", { data }, () => labels({ scope, data, documentId })),
      arrange: (data) => viaTest("arrange", { data }, () => arrange({ scope, data, documentId })),
    }),
    [scope, documentId, draw, fromText, extend, explain, labels, arrange],
  );
}
