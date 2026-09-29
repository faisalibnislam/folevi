"use client";

import { useState } from "react";
import { ArrowUp, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAi } from "@/components/ai/useAi";
import { errorMessage } from "@/components/ui/Toast";
import type { FlowDraft } from "./ops";

const CREATE_IDEAS = ["Customer refund process", "Hiring pipeline from application to offer", "How a pull request gets merged"];
const UPDATE_IDEAS = ["Add an approval step after review", "Add error handling to every step", "Simplify it to the main steps"];

/**
 * "Create with AI" / "Update with AI" for a flowchart. The server returns a sanitised draft; the canvas
 * lays it out and applies it as one change (⌘Z undoes it).
 */
export function FlowchartAi({
  hasChart,
  current,
  onApply,
  onClose,
}: {
  hasChart: boolean;
  /** The chart as stored (sent for updates). */
  current: () => string;
  onApply: (draft: FlowDraft, mode: "create" | "update") => void;
  onClose: () => void;
}) {
  const { flowchart } = useAi();
  const [mode, setMode] = useState<"create" | "update">(hasChart ? "update" : "create");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (instruction: string) => {
    if (busy || !instruction.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const draft = await flowchart(mode, instruction.trim(), mode === "update" ? current() : undefined);
      onApply(draft, mode);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ideas = mode === "create" ? CREATE_IDEAS : UPDATE_IDEAS;
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
        <div className="fc-ai-modes" role="group" aria-label="What the AI should do">
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
          disabled={busy}
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
        <button type="submit" className="fc-ai-send" aria-label={mode === "create" ? "Create flowchart" : "Update flowchart"} disabled={busy || !text.trim()}>
          <ArrowUp size={15} aria-hidden />
        </button>
        <button type="button" className="fc-btn" aria-label="Close AI" title="Close (Esc)" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </form>
      {busy ? (
        <p className="fc-ai-status" role="status">
          {mode === "create" ? "Drawing your flowchart…" : "Updating the flowchart…"}
        </p>
      ) : error ? (
        <p className="fc-ai-error" role="alert">
          {error}
        </p>
      ) : (
        <ul className="fc-ai-ideas" aria-label="Ideas">
          {ideas.map((idea) => (
            <li key={idea}>
              <button type="button" onClick={() => setText(idea)}>
                {idea}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="fc-ai-foot">AI can make mistakes. Sent to Google Gemini. {mode === "update" ? "Undo with ⌘Z." : ""}</p>
    </div>
  );
}
