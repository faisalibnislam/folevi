"use client";

// Foli AI's previews on the canvas: a result (a drawn chart, new steps, an arrangement) is shown in place
// before anything is saved, with what's new outlined, and a bar to Apply it (one undo step) or Discard it.
// While a preview shows, the canvas only pans and zooms: presses, double-clicks, the right-click menu and
// keys belong to the preview (Enter applies, Esc discards), and the toolbar rests (flowchart-ai.css). A
// change still waiting to be saved is written first, so the preview itself is never saved; a change to the
// chart from elsewhere (another device, the note's own undo) drops the preview, since it was made from the
// chart as it was.
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { haptic } from "@/lib/nativeApp";
import { NO_SELECTION, boxOf } from "../ops";
import type { FlowchartData } from "../schema";
import type { FlowController, Interaction } from "../controller/types";

export interface AiPreviewOptions {
  /** What the preview is, for the bar ("Foli AI's flowchart"). */
  title: string;
  /** One more line: what applying does ("Adds 3 shapes"). */
  detail?: string;
  /** Shapes to outline as new or changed. */
  highlight?: string[];
  /** Fit the view to the whole chart (a new chart), or only bring the new shapes into view. */
  fit?: "chart" | "highlight";
  /** After Apply (the change is committed). */
  onApply?: (applied: FlowchartData) => void;
}

interface Preview extends AiPreviewOptions {
  before: FlowchartData;
  next: FlowchartData;
}

export type AiPreview = ReturnType<typeof useAiPreview>;

export function useAiPreview(ctrl: FlowController) {
  const { docRef, setLive, commit, setSel, fitView } = ctrl;
  const [preview, setPreview] = useState<Preview | null>(null);
  const ref = useRef(preview);
  ref.current = preview;

  /** Shows `next` in place of the chart until it is applied or discarded. */
  const show = (next: FlowchartData, opts: AiPreviewOptions) => {
    const before = ref.current?.before ?? docRef.current;
    ctrl.flush();
    setPreview({ ...opts, before, next });
    setSel(NO_SELECTION);
    setLive(next);
    if (opts.fit === "highlight" && opts.highlight?.length) {
      const box = boxOf(next.nodes.filter((n) => opts.highlight!.includes(n.id)));
      if (box && !inView(ctrl, box)) fitView(next);
    } else fitView(next);
  };

  const apply = () => {
    const p = ref.current;
    if (!p) return;
    setPreview(null);
    commit(p.next, { before: p.before });
    // Saved at once: a result is one finished change, and the note may redraw the block right after.
    ctrl.flush();
    haptic("light");
    if (p.highlight?.length) setSel({ nodes: p.highlight.filter((id) => p.next.nodes.some((n) => n.id === id)), edges: [] });
    ctrl.focusCanvas();
    p.onApply?.(p.next);
  };

  const discard = () => {
    const p = ref.current;
    if (!p) return;
    setPreview(null);
    setLive(p.before);
    ctrl.focusCanvas();
  };

  // Changed from elsewhere while previewing (the chart was replaced under it): the preview no longer fits.
  const { doc } = ctrl;
  useEffect(() => {
    if (preview && doc !== preview.next) setPreview(null);
  }, [doc, preview]);

  const interaction: Interaction = {
    handles: ".fc-ai-preview",
    press: () => (ref.current ? "handled" : null),
    doubleClick: () => Boolean(ref.current),
    contextMenu: () => Boolean(ref.current),
    keyDown: (e) => {
      if (!ref.current) return false;
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
        return true;
      }
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        discard();
        return true;
      }
      // Tab goes to the bar's buttons (never adds a shape under the preview).
      if (e.key === "Tab") {
        ctrl.cardRef.current?.querySelector<HTMLButtonElement>(".fc-ai-preview .fc-ai-apply")?.focus();
        return true;
      }
      // Zoom and the space key (panning) stay with the canvas; nothing edits the chart under a preview.
      return !["+", "=", "-", "_", " "].includes(e.key);
    },
  };

  const k = ctrl.view.k;
  const outlined = preview?.highlight?.length ? preview.next.nodes.filter((n) => preview.highlight!.includes(n.id)) : [];
  const overlay = outlined.length ? (
    <g className="fc-ai-new" aria-hidden>
      {outlined.map((n) => (
        <rect key={n.id} x={n.x - 6 / k} y={n.y - 6 / k} width={n.w + 12 / k} height={n.h + 12 / k} rx={10 / k} strokeWidth={1.5 / k} strokeDasharray={`${5 / k} ${4 / k}`} />
      ))}
    </g>
  ) : null;

  const element = preview ? (
    <div
      className="fc-bar fc-ai-preview"
      role="region"
      aria-label="Foli AI preview"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        discard();
      }}
    >
      <AiIcon size={14} className="fc-ai-mark flex-none" />
      <span className="fc-ai-preview-text" role="status">
        <strong>{preview.title}</strong>
        {preview.detail ? <span>{preview.detail}</span> : null}
      </span>
      <button type="button" className="fc-btn fc-btn-text" onClick={discard} title="Discard (Esc)">
        <X size={14} aria-hidden /> Discard
      </button>
      <button type="button" className="fc-btn fc-btn-text fc-ai-apply" onClick={apply} title="Apply (Enter)" autoFocus>
        <Check size={14} aria-hidden /> Apply
      </button>
    </div>
  ) : null;

  return { active: preview !== null, show, apply, discard, interaction, overlay, element };
}

/** Whether a world rectangle is inside the visible canvas (below the toolbar). */
function inView(ctrl: FlowController, r: { x: number; y: number; w: number; h: number }): boolean {
  const { view, width, height } = ctrl;
  const x0 = (0 - view.x) / view.k;
  const y0 = (56 - view.y) / view.k;
  const x1 = (width - view.x) / view.k;
  const y1 = (height - 56 - view.y) / view.k;
  return r.x >= x0 && r.y >= y0 && r.x + r.w <= x1 && r.y + r.h <= y1;
}
