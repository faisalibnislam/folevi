"use client";

// Tidy up: the layered layout (aiOps.tidyChart, layoutFlowchart) top-down or left to right, keeping the
// person's placement when they ask, frames and swimlanes included. The shapes glide to their new places
// (about a quarter of a second, none with reduced motion) and the whole move is one undo step. When the
// result is still hard to read (crossings or overlaps, layoutNeedsHelp), "Tidy up with Foli AI" is offered:
// the model suggests an order, the layout engine applies it, and it shows as a preview first.
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { aiProblem } from "@/components/ai/AiCredits";
import { flowchartDirection, layoutNeedsHelp, layoutStats, serializeFlowchart, type FlowchartData, type FlowDirection } from "../schema";
import { arrangeChart, arrangementChanged, tidyChart, tweenCharts } from "../aiOps";
import type { FlowAiClient } from "../aiClient";
import type { AiPreview } from "./aiPreview";
import type { FlowController, Interaction } from "../controller/types";

const KEEP_KEY = "folevi.flowchart.tidyKeep";
const DURATION = 260;

function readKeep(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) === "1";
  } catch {
    return false;
  }
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ease = (t: number) => 1 - (1 - t) ** 3;

export type Tidy = ReturnType<typeof useTidy>;

export function useTidy(ctrl: FlowController, deps: { preview: AiPreview; ai: FlowAiClient | null; announce?: (text: string) => void }) {
  const { docRef, setLive, commit, fitView } = ctrl;
  const [direction, setDirectionState] = useState<FlowDirection | null>(null);
  const [keepPlacement, setKeepState] = useState(false);
  useEffect(() => setKeepState(readKeep()), []);
  /** After a tidy that still leaves the chart hard to read: what's left, and Foli AI's offer. */
  const [offer, setOffer] = useState<{ crossings: number; overlaps: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anim = useRef<number | null>(null);
  const animating = useRef(false);
  /** Ends a running move at once (a key pressed while the shapes glide: ⌘Z then undoes the whole tidy). */
  const finishNow = useRef<(() => void) | null>(null);

  /** The direction Tidy up uses: the one picked, or the way the chart mostly flows. */
  const currentDirection = (): FlowDirection => direction ?? flowchartDirection(docRef.current);

  const setDirection = (d: FlowDirection) => setDirectionState(d);
  const setKeep = (on: boolean) => {
    setKeepState(on);
    try {
      localStorage.setItem(KEEP_KEY, on ? "1" : "0");
    } catch {
      // A private window: remembered for this canvas only.
    }
  };

  /** Moves from the chart as it is to `next`, then records it as one change. */
  const glide = (next: FlowchartData, done?: (next: FlowchartData) => void) => {
    finishNow.current?.();
    ctrl.flush();
    const before = docRef.current;
    const finish = () => {
      if (anim.current !== null) cancelAnimationFrame(anim.current);
      anim.current = null;
      animating.current = false;
      finishNow.current = null;
      commit(next, { before });
      ctrl.flush();
      fitView(next);
      done?.(next);
    };
    if (reducedMotion() || before.nodes.length > 200 || !arrangementChanged(before, next)) return finish();
    animating.current = true;
    finishNow.current = finish;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      if (t >= 1) return finish();
      setLive(tweenCharts(before, next, ease(t)));
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
  }, []);

  /** Tidy up with the chosen direction and placement. */
  const run = (opts: { direction?: FlowDirection; keepPlacement?: boolean } = {}) => {
    const fc = docRef.current;
    if (fc.nodes.length < 2 || deps.preview.active || animating.current) return;
    const d = opts.direction ?? currentDirection();
    if (opts.direction) setDirectionState(opts.direction);
    setError(null);
    glide(tidyChart(fc, { direction: d, keepPlacement: opts.keepPlacement ?? keepPlacement }), (next) => {
      const stats = layoutStats(next);
      const needs = layoutNeedsHelp(stats, next.edges.length);
      setOffer(needs && deps.ai ? stats : null);
      deps.announce?.(needs ? `Tidied up. ${describe(stats)} remain.` : "Tidied up.");
    });
  };

  /** "Tidy up with Foli AI": the model's order through the layout engine, previewed before it applies. */
  const withAi = async () => {
    const ai = deps.ai;
    if (!ai || busy || deps.preview.active) return;
    const fc = docRef.current;
    if (fc.nodes.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const arrangement = await ai.arrange(serializeFlowchart(fc));
      const next = arrangeChart(docRef.current, arrangement);
      const was = layoutStats(docRef.current);
      const now = layoutStats(next);
      setOffer(null);
      deps.preview.show(next, { title: "Foli AI's arrangement", detail: `${describe(now)}, was ${describe(was).toLowerCase()}`, fit: "chart" });
    } catch (e) {
      setError(aiProblem(e).message);
    } finally {
      setBusy(false);
    }
  };

  /** Hard to read right now (the menu's offer): crossings from the connectors as drawn, and overlapping shapes. */
  const { routed, doc } = ctrl;
  const hardToRead = useMemo(() => {
    if (doc.nodes.length < 3) return false;
    const crossings = routed.reduce((s, r) => s + r.hops.length, 0);
    let overlaps = 0;
    const ns = doc.nodes;
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i]!;
        const b = ns[j]!;
        if (a.x + 4 < b.x + b.w && a.x + a.w > b.x + 4 && a.y + 4 < b.y + b.h && a.y + a.h > b.y + 4) overlaps++;
      }
    return layoutNeedsHelp({ crossings, overlaps }, doc.edges.length);
  }, [routed, doc.nodes, doc.edges.length]);

  const interaction: Interaction = {
    press: () => (animating.current ? "handled" : null),
    keyDown: () => {
      finishNow.current?.();
      return false;
    },
  };

  const element =
    (offer || busy || error) && !deps.preview.active ? (
      <div className="fc-bar fc-tidy-offer" role="status" onPointerDown={(e) => e.stopPropagation()}>
        {busy ? (
          <span className="fc-tidy-offer-text">Foli AI is arranging the chart…</span>
        ) : error ? (
          <span className="fc-tidy-offer-text fc-ai-error-text" role="alert">
            {error}
          </span>
        ) : offer ? (
          <>
            <span className="fc-tidy-offer-text">Still {describe(offer).toLowerCase()} after tidying.</span>
            <button type="button" className="fc-btn fc-btn-text" onClick={() => void withAi()}>
              <AiIcon size={14} className="fc-ai-mark" /> Tidy up with Foli AI
            </button>
          </>
        ) : null}
        {!busy ? (
          <button
            type="button"
            className="fc-btn"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => {
              setOffer(null);
              setError(null);
            }}
          >
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>
    ) : null;

  return { run, withAi, hardToRead, direction: currentDirection, picked: direction, setDirection, keepPlacement, setKeep, busy, interaction, element };
}

/** "3 crossings and 1 overlap". */
function describe(s: { crossings: number; overlaps: number }): string {
  const parts = [s.crossings ? `${s.crossings} crossing${s.crossings === 1 ? "" : "s"}` : "", s.overlaps ? `${s.overlaps} overlap${s.overlaps === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.length ? parts.join(" and ").replace(/^./, (c) => c.toUpperCase()) : "No crossings";
}
