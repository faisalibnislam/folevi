"use client";

// The Check panel: the deterministic check first (dead ends, unlabelled branches, shapes nothing leads to,
// loops with no way out, shapes with no text; schema.ts checkFlowchart), each problem a row that jumps to
// its shapes. Then, when Foli AI can: "Explain this flowchart" (a summary to read here, add to the note
// under the chart, or copy) and "Suggest clearer labels" (each change shown before and after, taken one by
// one or all at once, as one undo step).
import { useMemo, useState } from "react";
import { Check, CircleAlert, CircleCheck, ClipboardCopy, FileDown, Lightbulb, Tags, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { checkFlowchart, serializeFlowchart, type FlowIssue, type FlowIssueKind } from "../schema";
import { applyLabels, type AiExplanation, type AiLabelSuggestions } from "../aiOps";
import { boxOf } from "../ops";
import type { FlowAiClient } from "../aiClient";
import type { FlowController } from "../controller/types";
import "../flowchart-ai.css";

const KIND_LABEL: Record<FlowIssueKind, string> = {
  unreachable: "Can't be reached",
  unconnected: "Not connected",
  deadEnd: "Dead end",
  loopNoExit: "Loop with no way out",
  oneWayDecision: "Decision with one way out",
  unlabelledBranch: "Unlabelled branch",
  noText: "No text",
};

/** Selects an issue's shapes and connectors and brings them into view. */
export function jumpTo(ctrl: FlowController, nodes: readonly string[], edges: readonly string[] = []) {
  const { docRef, setSel, setView, width, height } = ctrl;
  const fc = docRef.current;
  setSel({ nodes: nodes.filter((id) => fc.nodes.some((n) => n.id === id)), edges: edges.filter((id) => fc.edges.some((e) => e.id === id)) });
  const box = boxOf(fc.nodes.filter((n) => nodes.includes(n.id)));
  if (!box) return;
  setView((v) => {
    const k = Math.min(v.k, Math.max(0.2, Math.min((width - 80) / Math.max(1, box.w), (height - 140) / Math.max(1, box.h))));
    return { k, x: width / 2 - (box.x + box.w / 2) * k, y: (height + 44) / 2 - (box.y + box.h / 2) * k };
  });
}

export function CheckPanel({
  ctrl,
  ai,
  documentId,
  onInsert,
  onClose,
}: {
  ctrl: FlowController;
  /** Foli AI's requests, when it can explain and suggest labels here (null hides them). */
  ai: FlowAiClient | null;
  documentId?: string;
  /** Puts Markdown in the note under the chart; false when it couldn't. */
  onInsert: ((markdown: string) => boolean) | null;
  onClose: () => void;
}) {
  const { doc, docRef, commit } = ctrl;
  const issues = useMemo(() => checkFlowchart(doc), [doc]);
  const [busy, setBusy] = useState<"explain" | "labels" | null>(null);
  const [error, setError] = useState<AiProblem | null>(null);
  const [explained, setExplained] = useState<AiExplanation | null>(null);
  const [labels, setLabels] = useState<{ s: AiLabelSuggestions; off: Set<string> } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ask = async (task: "explain" | "labels") => {
    if (!ai || busy) return;
    setBusy(task);
    setError(null);
    setNotice(null);
    try {
      const data = serializeFlowchart(docRef.current);
      if (task === "explain") {
        setLabels(null);
        setExplained(await ai.explain(data));
      } else {
        setExplained(null);
        const s = await ai.labels(data);
        if (!s.shapes.length && !s.connectors.length) setNotice("The labels already read clearly. Foli AI has nothing to suggest.");
        setLabels(s.shapes.length || s.connectors.length ? { s, off: new Set() } : null);
      }
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setBusy(null);
    }
  };

  const applyPicked = (all: boolean) => {
    if (!labels) return;
    const keep = (id: string) => all || !labels.off.has(id);
    const shapes = labels.s.shapes.filter((x) => keep(`n:${x.id}`));
    const connectors = labels.s.connectors.filter((x) => keep(`e:${x.id}`));
    if (!shapes.length && !connectors.length) return;
    commit(applyLabels(docRef.current, shapes, connectors));
    ctrl.flush();
    setLabels(null);
    setNotice(`Changed ${shapes.length + connectors.length} label${shapes.length + connectors.length === 1 ? "" : "s"}. Undo with ⌘Z.`);
  };

  const toggle = (key: string) =>
    setLabels((l) => {
      if (!l) return l;
      const off = new Set(l.off);
      if (off.has(key)) off.delete(key);
      else off.add(key);
      return { ...l, off };
    });

  const picked = labels ? labels.s.shapes.filter((x) => !labels.off.has(`n:${x.id}`)).length + labels.s.connectors.filter((x) => !labels.off.has(`e:${x.id}`)).length : 0;
  const empty = !doc.nodes.length;

  return (
    <div
      className="fc-ai fc-check ui-pop"
      role="dialog"
      aria-label="Check the flowchart"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="fc-check-head">
        <h3>Check</h3>
        <span className="fc-check-count" aria-live="polite">
          {empty ? "" : issues.length ? `${issues.length} to look at` : "All clear"}
        </span>
        <button type="button" className="fc-btn" aria-label="Close check" title="Close (Esc)" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="fc-check-body">
        {empty ? (
          <p className="fc-check-empty">Add some shapes and connectors, then check the flow.</p>
        ) : issues.length ? (
          <ul className="fc-check-list" aria-label="Problems found">
            {issues.map((i, n) => (
              <li key={`${i.kind}-${i.nodes.join(",")}-${n}`}>
                <IssueRow issue={i} onJump={() => jumpTo(ctrl, i.nodes, i.edges)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="fc-check-ok">
            <CircleCheck size={15} aria-hidden /> Every path has an end, every decision is labelled and every shape can be reached.
          </p>
        )}

        {ai && !empty ? (
          <div className="fc-ai-actions" role="group" aria-label="Foli AI">
            <p className="fc-ai-actions-title">
              <AiIcon size={13} className="fc-ai-mark" /> Foli AI
            </p>
            <button type="button" disabled={Boolean(busy)} aria-pressed={Boolean(explained)} onClick={() => void ask("explain")}>
              <Lightbulb size={15} aria-hidden /> Explain this flowchart
            </button>
            <button type="button" disabled={Boolean(busy)} aria-pressed={Boolean(labels)} onClick={() => void ask("labels")}>
              <Tags size={15} aria-hidden /> Suggest clearer labels
            </button>
          </div>
        ) : null}

        {busy ? (
          <p className="fc-ai-status" role="status">
            {busy === "explain" ? "Reading the flowchart…" : "Looking at the labels…"}
          </p>
        ) : error ? (
          <AiProblemNotice problem={error} className={error.kind === "other" ? "fc-ai-error" : "mx-3 mb-2"} />
        ) : notice ? (
          <p className="fc-ai-status" role="status">
            {notice}
          </p>
        ) : null}

        {explained && !busy ? (
          <section className="fc-explain" aria-label="Explanation">
            <p>{explained.summary}</p>
            {explained.steps.length ? (
              <>
                <h4>Main path</h4>
                <ol>
                  {explained.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </>
            ) : null}
            {explained.decisions.length ? (
              <>
                <h4>Decisions</h4>
                <ul>
                  {explained.decisions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {explained.gaps.length ? (
              <>
                <h4>Worth a look</h4>
                <ul>
                  {explained.gaps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="fc-explain-actions">
              {onInsert ? (
                <button
                  type="button"
                  className="fc-btn fc-btn-text"
                  onClick={() => {
                    if (onInsert(explained.markdown)) setNotice("Added to the note, under the flowchart.");
                  }}
                >
                  <FileDown size={14} aria-hidden /> Add to note
                </button>
              ) : null}
              <button
                type="button"
                className="fc-btn fc-btn-text"
                onClick={() => {
                  const plain = [explained.summary, ...explained.steps.map((s, i) => `${i + 1}. ${s}`), ...explained.decisions.map((s) => `- ${s}`), ...explained.gaps.map((s) => `- ${s}`)].join("\n");
                  void navigator.clipboard?.writeText(plain).then(
                    () => setNotice("Copied."),
                    () => setNotice("Your browser blocked copying."),
                  );
                }}
              >
                <ClipboardCopy size={14} aria-hidden /> Copy
              </button>
            </div>
          </section>
        ) : null}

        {labels && !busy ? (
          <section className="fc-labels" aria-label="Suggested labels">
            <ul>
              {labels.s.shapes.map((x) => (
                <LabelRow key={`n:${x.id}`} on={!labels.off.has(`n:${x.id}`)} before={x.before} after={x.text} why={x.why} kind="Shape" onToggle={() => toggle(`n:${x.id}`)} onJump={() => jumpTo(ctrl, [x.id])} />
              ))}
              {labels.s.connectors.map((x) => {
                const e = doc.edges.find((y) => y.id === x.id);
                return <LabelRow key={`e:${x.id}`} on={!labels.off.has(`e:${x.id}`)} before={x.before} after={x.label} why={x.why} kind="Connector" onToggle={() => toggle(`e:${x.id}`)} onJump={() => (e ? jumpTo(ctrl, [e.from, e.to].filter(Boolean), [e.id]) : undefined)} />;
              })}
            </ul>
            <div className="fc-explain-actions">
              <button type="button" className="fc-btn fc-btn-text" onClick={() => setLabels(null)}>
                Discard
              </button>
              <button type="button" className="fc-btn fc-btn-text" disabled={!picked} onClick={() => applyPicked(false)}>
                Apply {picked} selected
              </button>
              <button type="button" className="fc-btn fc-btn-text fc-ai-apply" onClick={() => applyPicked(true)}>
                <Check size={14} aria-hidden /> Apply all
              </button>
            </div>
          </section>
        ) : null}
        {ai ? <AiCreditsNote documentId={documentId} className="mx-3 mb-2" /> : null}
      </div>
    </div>
  );
}

function IssueRow({ issue, onJump }: { issue: FlowIssue; onJump: () => void }) {
  return (
    <button type="button" className="fc-check-row" data-kind={issue.kind} onClick={onJump} title="Show in the flowchart">
      <CircleAlert size={15} aria-hidden className="fc-check-icon" />
      <span>
        <strong>{KIND_LABEL[issue.kind]}</strong>
        <span>{issue.message}</span>
      </span>
    </button>
  );
}

function LabelRow({ on, before, after, why, kind, onToggle, onJump }: { on: boolean; before: string; after: string; why: string; kind: "Shape" | "Connector"; onToggle: () => void; onJump: () => void }) {
  return (
    <li className="fc-label-row" data-on={on || undefined}>
      <button type="button" role="checkbox" aria-checked={on} className="fc-check-box" aria-label={`Use “${after}”`} onClick={onToggle}>
        {on ? <Check size={12} aria-hidden /> : null}
      </button>
      <button type="button" className="fc-label-text" onClick={onJump} title="Show in the flowchart">
        <span className="fc-label-kind">{kind}</span>
        <span>
          <s>{before || "No label"}</s> <span aria-hidden>→</span>
          <span className="sr-only">becomes</span> <strong>{after}</strong>
        </span>
        {why ? <span className="fc-label-why">{why}</span> : null}
      </button>
    </li>
  );
}
