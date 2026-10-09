"use client";

import { useState } from "react";
import { Check, Copy, CornerDownLeft, ListTree, X } from "lucide-react";
import { AiIcon } from "./AiIcon";
import { AiMarkdown } from "./AiMarkdown";
import { AiProblemNotice, type AiProblem } from "./AiCredits";
import { markdownToPlain } from "./plainText";

/** What a transcription shows: the transcript, or its summary. */
export type TranscriptView = "transcript" | "summary";

/**
 * A recording's transcript under its audio block, before anything goes into the note (the writing
 * assistant's preview style): the transcript (and its summary, once asked for), then Insert below,
 * Summarize, Copy and Discard. Nothing in the note changes until Insert below.
 */
export function TranscriptPreview({
  working,
  transcript,
  summary,
  summarizing,
  view,
  onView,
  problem,
  canInsert,
  onInsert,
  onSummarize,
  onDiscard,
}: {
  /** Transcribing (nothing to show yet). */
  working: boolean;
  transcript: string;
  summary: string | null;
  summarizing: boolean;
  view: TranscriptView;
  onView: (view: TranscriptView) => void;
  problem: AiProblem | null;
  /** The note can be changed (Insert below shows). */
  canInsert: boolean;
  onInsert: () => void;
  onSummarize: () => void;
  onDiscard: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shown = view === "summary" && summary ? summary : transcript;
  const copy = () => {
    void navigator.clipboard?.writeText(view === "summary" && summary ? markdownToPlain(summary) : transcript).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div role="region" aria-label="Transcript" className="ui-card mt-1.5 overflow-hidden rounded-[12px] text-ink" contentEditable={false}>
      {working ? (
        <div className="px-4 pb-3 pt-3.5" aria-live="polite" aria-busy="true">
          <p role="status" className="mb-2 flex items-center gap-2 text-[11.5px] font-semibold text-muted">
            <AiIcon size={12} aria-hidden className="animate-pulse text-[#7c6cf0] motion-reduce:animate-none" /> Transcribing…
          </p>
          <div className="space-y-2 pb-1">
            {[92, 78, 85].map((w) => (
              <div key={w} className="h-2.5 animate-pulse rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,#8b7cf6_22%,transparent),color-mix(in_oklab,#f58ab8_18%,transparent))] motion-reduce:animate-none" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      ) : transcript ? (
        <div className="max-h-[min(46vh,380px)] overflow-y-auto border-b border-line/60 px-4 pb-2.5 pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
            <AiIcon size={12} aria-hidden className="text-[#7c6cf0]" />
            <span className="min-w-0 flex-1 truncate">{summary ? "Transcription" : "Transcript"}</span>
            {summary ? (
              <div className="ui-seg ui-well text-[11.5px]" role="group" aria-label="Show">
                <button type="button" aria-pressed={view === "transcript"} onClick={() => onView("transcript")}>
                  Transcript
                </button>
                <button type="button" aria-pressed={view === "summary"} onClick={() => onView("summary")}>
                  Summary
                </button>
              </div>
            ) : null}
          </div>
          {view === "summary" && summary ? <AiMarkdown markdown={summary} /> : <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.6]">{shown}</p>}
        </div>
      ) : null}
      {problem ? <AiProblemNotice problem={problem} className={problem.kind === "other" ? "mx-3 my-2.5 rounded-[8px] bg-danger-soft px-3 py-2 text-[13px] text-danger" : "mx-3 my-2.5 w-auto"} /> : null}
      {!working ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5" role="group" aria-label="Use the transcript">
          {transcript && canInsert ? (
            <button type="button" onClick={onInsert} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
              <CornerDownLeft size={14} aria-hidden /> Insert below
            </button>
          ) : null}
          {transcript && !summary ? (
            <button type="button" disabled={summarizing} onClick={onSummarize} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
              <ListTree size={14} aria-hidden /> {summarizing ? "Summarizing…" : "Summarize"}
            </button>
          ) : null}
          {transcript ? (
            <button type="button" onClick={copy} className="ui-btn ui-btn-ghost h-8 px-2.5 text-[12.5px]">
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
          <button type="button" onClick={onDiscard} className="ui-btn ui-btn-ghost ml-auto h-8 px-2.5 text-[12.5px] text-muted">
            <X size={14} aria-hidden /> {transcript ? "Discard" : "Close"}
          </button>
        </div>
      ) : null}
      <p className="border-t border-line/60 px-3.5 py-1.5 text-[11px] text-faint">AI can make mistakes. The recording is sent to Google Gemini.</p>
    </div>
  );
}
