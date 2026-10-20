"use client";

// The bars of Present and Follow a path (interactions/walkthrough.tsx), along the bottom of the canvas:
// where the walk is, the ways on (numbered, as on the canvas), back, start again and end; picking a path's
// two ends; and a path's steps. Neutral glass chrome. Each bar has its own polite live region, so a screen
// reader hears every step. A click on a button gives the keyboard back to the canvas (arrow keys keep
// working); a keyboard press on one leaves focus where it is.
import { ChevronLeft, ChevronRight, Play, RotateCcw, Route, X } from "lucide-react";

export interface WalkStep {
  /** The connector's id. */
  id: string;
  label: string;
  /** The shape it leads to. */
  to: string;
}

const stop = (e: React.PointerEvent) => e.stopPropagation();
/** Runs a bar action; a pointer click hands the keyboard back to the canvas. */
const act = (run: () => void, refocus: () => void) => (e: React.MouseEvent) => {
  run();
  if (e.detail > 0) refocus();
};

const quote = (s: string) => `“${s}”`;

export function presentAnnouncement(step: number, name: string, ways: readonly WalkStep[]): string {
  const where = `Step ${step}: ${name}.`;
  if (!ways.length) return `${where} End of the flow.`;
  if (ways.length === 1) return `${where} Next: ${ways[0]!.to}.`;
  return `${where} ${ways.length} ways on: ${ways.map((w, i) => `${i + 1}, ${w.label ? `${w.label}, to ` : "to "}${w.to}`).join("; ")}.`;
}

export function PresentBar({
  step,
  name,
  ways,
  onPath,
  canBack,
  onBack,
  onNext,
  onChoose,
  onRestart,
  onEnd,
  refocus,
}: {
  step: number;
  name: string;
  ways: WalkStep[];
  /** Walking one path (no choices). */
  onPath: boolean;
  canBack: boolean;
  onBack: () => void;
  onNext: () => void;
  onChoose: (index: number) => void;
  onRestart: () => void;
  onEnd: () => void;
  refocus: () => void;
}) {
  return (
    <div className="fc-bar fc-walk-bar" role="toolbar" aria-label={onPath ? "Presenting a path" : "Presenting the flowchart"} onPointerDown={stop}>
      <button type="button" className="fc-btn" aria-label="Back" title="Back (←)" disabled={!canBack} onClick={act(onBack, refocus)}>
        <ChevronLeft size={16} aria-hidden />
      </button>
      <div className="fc-walk-now">
        <span className="fc-walk-count">Step {step}</span>
        <span className="fc-walk-name" title={name}>
          {name}
        </span>
      </div>
      <span className="fc-sep" aria-hidden />
      {ways.length === 1 ? (
        <button type="button" className="fc-btn fc-btn-text fc-walk-next" onClick={act(onNext, refocus)} title="Next (→)">
          <span className="fc-walk-way-label">{ways[0]!.label ? `${ways[0]!.label}: ${ways[0]!.to}` : ways[0]!.to}</span>
          <ChevronRight size={16} aria-hidden />
        </button>
      ) : ways.length > 1 ? (
        <span role="group" aria-label="Choose where to go" className="fc-group fc-walk-ways">
          {ways.map((w, i) => (
            <button key={w.id} type="button" className="fc-btn fc-btn-text fc-walk-way" onClick={act(() => onChoose(i), refocus)} title={`Press ${i + 1}`} aria-label={`${i + 1}: ${w.label ? `${w.label}, to ` : "to "}${w.to}`}>
              <kbd className="fc-walk-key" aria-hidden>
                {i + 1}
              </kbd>
              <span className="fc-walk-way-label" aria-hidden>
                {w.label || w.to}
              </span>
            </button>
          ))}
        </span>
      ) : (
        <>
          <span className="fc-walk-done">End of the flow</span>
          <button type="button" className="fc-btn fc-btn-text" onClick={act(onRestart, refocus)} title="Start again (Home)">
            <RotateCcw size={14} aria-hidden /> Start again
          </button>
        </>
      )}
      <span className="fc-sep" aria-hidden />
      <span className="fc-walk-hint" aria-hidden>
        {ways.length > 1 ? "1, 2… choose · ← back · Esc ends" : "→ next · ← back · Esc ends"}
      </span>
      <button type="button" className="fc-btn fc-btn-text" onClick={act(onEnd, refocus)} title="End (Esc)">
        <X size={14} aria-hidden /> End
      </button>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {presentAnnouncement(step, name, ways)}
      </p>
    </div>
  );
}

export function PickBar({ from, onEvery, onEnd, refocus }: { from: string | null; onEvery: (() => void) | null; onEnd: () => void; refocus: () => void }) {
  const text = from ? `From ${quote(from)}: click where the path ends.` : "Click the shape a path starts from.";
  return (
    <div className="fc-bar fc-walk-bar" role="toolbar" aria-label="Follow a path" onPointerDown={stop}>
      <Route size={15} aria-hidden className="fc-walk-icon" />
      <span className="fc-walk-name fc-walk-prompt">{text}</span>
      {onEvery ? (
        <button type="button" className="fc-btn fc-btn-text" onClick={act(onEvery, refocus)}>
          Every path from here
        </button>
      ) : null}
      <span className="fc-sep" aria-hidden />
      <button type="button" className="fc-btn fc-btn-text" onClick={act(onEnd, refocus)} title="Cancel (Esc)">
        <X size={14} aria-hidden /> Cancel
      </button>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {text}
      </p>
    </div>
  );
}

export function PathBar({
  from,
  to,
  count,
  index,
  all,
  steps,
  onPath,
  onStep,
  onPresent,
  onPick,
  onEnd,
  refocus,
}: {
  from: string;
  to: string | null;
  count: number;
  index: number;
  all: boolean;
  /** The shown path's shapes (with the label of the connector into each); empty while all are shown. */
  steps: { id: string; name: string; label: string }[];
  onPath: (index: number | "all") => void;
  onStep: (id: string) => void;
  onPresent: (() => void) | null;
  onPick: () => void;
  onEnd: () => void;
  refocus: () => void;
}) {
  const what = to ? `${quote(from)} to ${quote(to)}` : `From ${quote(from)}`;
  const status = !count
    ? to
      ? `No path leads from ${quote(from)} to ${quote(to)}.`
      : `Nothing follows ${quote(from)}.`
    : all
      ? `${count} paths from ${quote(from)}${to ? ` to ${quote(to)}` : ""}.`
      : `Path ${index + 1} of ${count}, ${steps.length} steps: ${steps.map((s) => (s.label ? `${s.label}, ${s.name}` : s.name)).join(", then ")}.`;
  return (
    <div className="fc-bar fc-walk-bar fc-walk-paths" role="toolbar" aria-label="Paths" onPointerDown={stop}>
      <div className="fc-walk-now">
        <span className="fc-walk-count">{!count ? "No path" : all ? `${count} paths` : `Path ${index + 1} of ${count}`}</span>
        <span className="fc-walk-name" title={what}>
          {what}
        </span>
      </div>
      {count > 1 ? (
        <span role="group" aria-label="Paths" className="fc-group">
          <button type="button" className="fc-btn" aria-label="Previous path" title="Previous path (←)" onClick={act(() => onPath(all ? count - 1 : index - 1), refocus)}>
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button type="button" className="fc-btn" aria-label="Next path" title="Next path (→)" onClick={act(() => onPath(all ? 0 : index + 1), refocus)}>
            <ChevronRight size={16} aria-hidden />
          </button>
          <button type="button" className="fc-btn fc-btn-text" aria-pressed={all} title="Show every path (A)" onClick={act(() => onPath(all ? index : "all"), refocus)}>
            All
          </button>
        </span>
      ) : null}
      {steps.length ? (
        <ol className="fc-walk-steps" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={`${s.id}-${i}`}>
              {i > 0 ? <ChevronRight size={12} aria-hidden className="fc-walk-arrow" /> : null}
              <button type="button" className="fc-walk-step" onClick={act(() => onStep(s.id), refocus)} title="Show this step">
                {s.label ? <span className="fc-walk-step-label">{s.label}</span> : null}
                {s.name}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <span className="fc-sep" aria-hidden />
      {onPresent ? (
        <button type="button" className="fc-btn fc-btn-text" onClick={act(onPresent, refocus)} title="Present this path (Enter)">
          <Play size={14} aria-hidden /> Present
        </button>
      ) : null}
      <button type="button" className="fc-btn fc-btn-text" onClick={act(onPick, refocus)} title="Pick another end">
        <Route size={14} aria-hidden /> Change
      </button>
      <button type="button" className="fc-btn fc-btn-text" onClick={act(onEnd, refocus)} title="Done (Esc)">
        <X size={14} aria-hidden /> Done
      </button>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
    </div>
  );
}

/** Toolbar buttons that start a walk (in the main toolbar). */
export function WalkTools({ onPresent, onFollow, disabled }: { onPresent: () => void; onFollow: () => void; disabled: boolean }) {
  return (
    <>
      <button type="button" className="fc-btn fc-btn-text" onClick={onPresent} disabled={disabled} title="Present: step through the flow">
        <Play size={14} aria-hidden /> Present
      </button>
      <button type="button" className="fc-btn" onClick={onFollow} disabled={disabled} aria-label="Follow a path" title="Follow a path: highlight the way from one shape to another">
        <Route size={15} aria-hidden />
      </button>
    </>
  );
}
