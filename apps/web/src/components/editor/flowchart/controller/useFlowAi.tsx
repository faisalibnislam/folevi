"use client";

// Foli AI that builds and extends the chart: draw it from a description, change it, make it from a note, a
// list or selected text, and add the next steps or the missing branches around the selected shapes. Each
// request runs here (aiClient.ts) and its result opens as a preview on the canvas (interactions/aiPreview),
// applied as one undo step. Used by the Foli AI panel (FlowchartAi.tsx), the right-click menu and the
// selection bar; a request started from a menu shows its progress and any problem in a small bar.
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { AiIcon } from "@/components/ai/AiIcon";
import { draftChart, placeExtension, type AiDraft } from "../aiOps";
import { flowchartDirection, serializeFlowchart } from "../schema";
import type { FlowAiClient } from "../aiClient";
import type { AiPreview } from "../interactions/aiPreview";
import type { FlowController } from "./types";

export type FlowAi = ReturnType<typeof useFlowAi>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function useFlowAi(ctrl: FlowController, deps: { preview: AiPreview; client: FlowAiClient | null }) {
  const { docRef } = ctrl;
  const { preview, client } = deps;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AiProblem | null>(null);
  /** Where the request came from: the panel shows its own progress, a menu uses the status bar. */
  const [from, setFrom] = useState<"panel" | "menu">("panel");
  const running = useRef(false);

  const run = async (label: string, origin: "panel" | "menu", work: (c: FlowAiClient) => Promise<void>): Promise<boolean> => {
    if (!client || running.current || preview.active) return false;
    running.current = true;
    setFrom(origin);
    setBusy(label);
    setError(null);
    try {
      await work(client);
      return true;
    } catch (e) {
      setError(aiProblem(e));
      return false;
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  /** A drawn chart as a preview: new from scratch, or the current one changed. */
  const showDraft = (draft: AiDraft, mode: "create" | "update", title?: string) => {
    const current = docRef.current;
    const next = draftChart(draft, current, mode);
    const before = new Map(current.nodes.map((n) => [n.id, n]));
    const changed = mode === "update" ? next.nodes.filter((n) => !before.has(n.id) || before.get(n.id)!.text !== n.text || before.get(n.id)!.shape !== n.shape).map((n) => n.id) : [];
    const groups = next.frames.length + next.pools.reduce((s, p) => s + p.lanes.length, 0);
    const detail =
      mode === "create"
        ? `${plural(next.nodes.length, "shape")}${groups ? `, ${plural(next.frames.length, "frame")}${next.pools.length ? ` and ${plural(next.pools[0]!.lanes.length, "lane")}` : ""}` : ""}${current.nodes.length ? ", in place of this chart" : ""}`
        : `${plural(changed.length, "new or changed shape")}, ${plural(Math.max(0, current.nodes.length - next.nodes.filter((n) => before.has(n.id)).length), "removed")}`;
    preview.show(next, { title: title ?? (mode === "create" ? "Foli AI's flowchart" : "Foli AI's changes"), detail, highlight: changed, fit: "chart" });
  };

  const draw = (mode: "create" | "update", instruction: string) =>
    run(mode === "create" ? "Drawing your flowchart…" : "Updating the flowchart…", "panel", async (c) => {
      const draft = await c.draw(mode, instruction, mode === "update" ? serializeFlowchart(docRef.current) : undefined);
      showDraft(draft, mode);
    });

  /** A chart from a note (`documentId`), a list or selected text (`text`), in place of an empty chart. */
  const fromText = (o: { text?: string; documentId?: string; instruction?: string }, origin: "panel" | "menu" = "panel") =>
    run(o.text ? "Drawing a flowchart from the text…" : "Drawing a flowchart from the note…", origin, async (c) => {
      const draft = await c.fromText(o);
      showDraft(draft, "create", o.text ? "Foli AI's flowchart from the text" : "Foli AI's flowchart from the note");
    });

  /** The next steps after the selected shapes, or their missing branches. */
  const extend = (kind: "next" | "branches", nodeIds: string[], origin: "panel" | "menu" = "menu", instruction?: string) =>
    run(kind === "next" ? "Adding the next steps…" : "Filling in the missing branches…", origin, async (c) => {
      const fc = docRef.current;
      const ext = await c.extend(serializeFlowchart(fc), nodeIds, kind, instruction);
      const placed = placeExtension(docRef.current, ext, nodeIds, flowchartDirection(docRef.current));
      if (!placed) throw new Error(kind === "next" ? "Foli AI had no next steps to add." : "Foli AI found no missing branches to add.");
      const parts = [placed.nodes.length ? plural(placed.nodes.length, "new shape") : "", placed.edges.length ? plural(placed.edges.length, "connector") : "", placed.labelled.length ? plural(placed.labelled.length, "branch label") : ""].filter(Boolean);
      preview.show(placed.doc, { title: kind === "next" ? "Foli AI's next steps" : "Foli AI's missing branches", detail: parts.join(", "), highlight: placed.nodes, fit: "highlight" });
    });

  const dismiss = () => setError(null);

  /** Progress and problems of a request started from a menu (the panel shows its own). */
  const element =
    from === "menu" && (busy || error) && !preview.active ? (
      <div className="fc-bar fc-ai-status-bar" role="status" onPointerDown={(e) => e.stopPropagation()}>
        <AiIcon size={14} className={`fc-ai-mark flex-none ${busy ? "animate-pulse motion-reduce:animate-none" : ""}`} />
        {busy ? (
          <span className="fc-tidy-offer-text">{busy}</span>
        ) : (
          <span className="fc-tidy-offer-text fc-ai-error-text" role="alert">
            {error!.message}
          </span>
        )}
        {!busy ? (
          <button type="button" className="fc-btn" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>
    ) : null;

  return { available: client !== null, busy, error: from === "panel" ? error : null, draw, fromText, extend, dismiss, element };
}
