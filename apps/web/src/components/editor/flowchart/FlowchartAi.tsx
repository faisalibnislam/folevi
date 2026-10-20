"use client";

import { useState } from "react";
import { ArrowUp, FileText, GitBranchPlus, ListPlus, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { AiCreditsNote, AiProblemNotice } from "@/components/ai/AiCredits";
import { useBackendMode } from "@/lib/mode";
import type { FlowNode } from "./schema";
import type { FlowAi } from "./controller/useFlowAi";
import "./flowchart-ai.css";

const CREATE_IDEAS = ["Customer refund process", "Hiring pipeline from application to offer", "Order fulfilment with swimlanes for sales, warehouse and delivery"];
const UPDATE_IDEAS = ["Add an approval step after review", "Add error handling to every step", "Group the steps into stages"];
const DECISIONS = new Set(["decision", "diamond"]);

/**
 * The Foli AI panel for a flowchart: draw one from a description or from the note, change the current one,
 * and add the next steps or the missing branches around the selected shapes. Every result opens as a preview
 * on the canvas (Apply or Discard; one undo step), never straight into the chart.
 */
export function FlowchartAi({
  hasChart,
  flowAi,
  selected,
  documentId,
  onClose,
}: {
  hasChart: boolean;
  flowAi: FlowAi;
  /** The selected shapes ("Add next steps" and "Fill in missing branches" work on them). */
  selected: FlowNode[];
  /** The note the chart is in ("Make it from this note"). */
  documentId?: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"create" | "update">(hasChart ? "update" : "create");
  const [text, setText] = useState("");
  const local = useBackendMode() === "local";
  const busy = flowAi.busy;
  const error = flowAi.error;

  const done = (ok: boolean) => {
    if (ok) onClose();
  };
  const run = async (instruction: string) => {
    if (busy || !instruction.trim()) return;
    done(await flowAi.draw(mode, instruction.trim()));
  };
  const extend = async (kind: "next" | "branches") => done(await flowAi.extend(kind, selected.map((n) => n.id), "panel", text.trim() || undefined));
  const fromNote = async () => done(await flowAi.fromText({ documentId, instruction: text.trim() || undefined }));

  const ideas = mode === "create" ? CREATE_IDEAS : UPDATE_IDEAS;
  const names = selected.length === 1 ? `“${selected[0]!.text.replace(/\s+/g, " ").trim().slice(0, 40) || "the shape"}”` : `${selected.length} shapes`;
  const branchy = selected.some((n) => DECISIONS.has(n.shape));
  return (
    <div
      className="fc-ai ui-pop"
      role="dialog"
      aria-label={mode === "create" ? "Create a flowchart with AI" : "Change the flowchart with AI"}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {hasChart ? (
        <div className="fc-ai-modes" role="group" aria-label="What Foli AI should do">
          <button type="button" aria-pressed={mode === "update"} onClick={() => setMode("update")}>
            Update this chart
          </button>
          <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>
            Start over
          </button>
        </div>
      ) : null}
      <form
        className="fc-ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
      >
        <AiIcon size={15} className="fc-ai-mark flex-none" />
        <textarea
          autoFocus
          rows={2}
          value={text}
          disabled={Boolean(busy)}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run(text);
            }
          }}
          aria-label={mode === "create" ? "Describe the process" : "What should change?"}
          placeholder={mode === "create" ? "Describe a process, step by step or in a sentence…" : "What should change? e.g. add an approval step after review"}
        />
        <button type="submit" className="fc-ai-send" aria-label={mode === "create" ? "Create flowchart" : "Update flowchart"} disabled={Boolean(busy) || !text.trim()}>
          <ArrowUp size={15} aria-hidden />
        </button>
        <button type="button" className="fc-btn" aria-label="Close AI" title="Close (Esc)" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </form>
      {(selected.length && hasChart) || (documentId && mode === "create") ? (
        <div className="fc-ai-actions" role="group" aria-label="Foli AI actions">
          {selected.length && hasChart ? (
            <>
              <p className="fc-ai-actions-title">With {names}</p>
              <button type="button" disabled={Boolean(busy)} onClick={() => void extend("next")}>
                <ListPlus size={15} aria-hidden /> Add next steps
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void extend("branches")} title={branchy ? "Add the answers a decision is missing" : "Add branches and ends that are missing"}>
                <GitBranchPlus size={15} aria-hidden /> Fill in missing branches
              </button>
            </>
          ) : null}
          {documentId && mode === "create" ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => void fromNote()}>
              <FileText size={15} aria-hidden /> Make it from this note
            </button>
          ) : null}
        </div>
      ) : null}
      {busy ? (
        <p className="fc-ai-status" role="status">
          {busy}
        </p>
      ) : error ? (
        <AiProblemNotice problem={error} className={error.kind === "other" ? "fc-ai-error" : "mx-3 mb-2"} />
      ) : (
        <>
          <AiCreditsNote documentId={documentId} className="mx-3 mb-2" />
          <ul className="fc-ai-ideas" aria-label="Ideas">
            {ideas.map((idea) => (
              <li key={idea}>
                <button type="button" onClick={() => setText(idea)}>
                  {idea}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="fc-ai-foot">Foli AI can make mistakes. {local ? "Runs on this device or with your own key." : "Sent to Google Gemini."} You see every result before it goes in.</p>
    </div>
  );
}
