"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { Check, Copy, FileText, Globe, Loader2, Pencil, RotateCcw } from "lucide-react";
import type { api } from "@/lib/convex/api";
import { AiMarkdown, StreamingText } from "../AiMarkdown";
import { useTypewriter } from "../useAiStream";
import { markdownToPlain } from "../plainText";
import { AiProblemNotice } from "../AiCredits";
import { ActionsCard, type ActionsOutcome, type AiAction } from "./ActionsCard";
import { AgentRunCard, type RunActivity } from "./AgentRunCard";
import { phaseLabel, stepLines, storedProblem, type AgentStep } from "./chatText";
import { AttachmentChips, type AttachmentInfo, type PendingFile } from "./Attachments";
import { ResearchFooter, ResearchProgress, type ResearchHandlers } from "./ResearchCard";
import { SearchSuggestions } from "./SearchSuggestions";

export type ChatMessageData = NonNullable<FunctionReturnType<typeof api.aiChat.get>>["messages"][number];
export type Citation = ChatMessageData["citations"][number];
export type WebCitation = ChatMessageData["webCitations"][number];

/** Opens a cited web page in a new tab, without telling it where the click came from. */
export function openWebCitation(c: WebCitation) {
  window.open(c.url, "_blank", "noopener,noreferrer");
}

const ROW_BUTTON = "inline-flex h-7 items-center gap-1 rounded-[6px] px-1.5 text-[12px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading disabled:opacity-40";

/** Copies text, and says so for a moment. */
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={ROW_BUTTON}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}

/** The person's message, with the files sent with it; the last one can be edited and sent again. */
export function UserMessage({ text, attachments, onEdit, disabled }: { text: string; attachments?: (AttachmentInfo | PendingFile)[]; onEdit?: (text: string) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const fieldId = useId();
  if (editing && onEdit) {
    return (
      <form
        className="ml-auto w-full max-w-[85%] rounded-[14px] bg-[var(--glass-hover)] p-2 shadow-[inset_0_0_0_1px_var(--glass-border)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          setEditing(false);
          onEdit(draft.trim());
        }}
      >
        <label className="sr-only" htmlFor={fieldId}>
          Edit your message
        </label>
        <textarea
          id={fieldId}
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="block w-full resize-none bg-transparent px-1.5 py-1 text-[14px] leading-[1.5] text-ink outline-none"
        />
        <div className="mt-1 flex justify-end gap-1.5">
          <button type="button" onClick={() => setEditing(false)} className="h-7 rounded-[6px] px-2.5 text-[12.5px] text-muted hover:bg-[var(--glass-active)] hover:text-heading">
            Cancel
          </button>
          <button type="submit" disabled={!draft.trim()} className="h-7 rounded-[6px] bg-heading px-2.5 text-[12.5px] font-medium text-canvas disabled:opacity-40">
            Send
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="group/user flex flex-col items-end gap-0.5">
      {attachments?.length ? <AttachmentChips files={attachments} className="mb-1 max-w-[85%] justify-end" /> : null}
      <p className="w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-[14px] rounded-br-[4px] bg-heading px-3.5 py-2 text-[14px] text-canvas">{text}</p>
      {onEdit ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
          className={`${ROW_BUTTON} opacity-0 focus-visible:opacity-100 group-hover/user:opacity-100 pointer-coarse:opacity-100`}
        >
          <Pencil size={12} aria-hidden /> Edit
        </button>
      ) : null}
    </div>
  );
}

/** What an agent did, in a few words ("Searched notes", "Read 3 notes"). */
export function AgentSteps({ steps, live }: { steps: AgentStep[]; live?: boolean }) {
  const lines = stepLines(steps);
  if (!lines.length) return null;
  return (
    <ul aria-label={live ? "What the AI is doing" : "What the AI did"} className="mb-2 flex flex-wrap gap-1.5">
      {lines.map((l) => (
        <li key={l} className="rounded-full bg-[var(--glass-hover)] px-2.5 py-0.5 text-[12px] text-muted">
          {l}
        </li>
      ))}
    </ul>
  );
}

/** What an agent's answer needs to act on its proposed changes. */
export interface RunHandlers {
  activity: RunActivity;
  onApprove: (operationIds: string[]) => void;
  onDiscard: () => void;
  onUndo: (changed?: "all" | "rest") => void;
}

/**
 * Sources under an answer, numbered as in the text: each cited note (opening at the cited block), then
 * each cited web page (its title and site, opening in a new tab).
 */
export function Sources({ citations, webCitations = [], onCite }: { citations: Citation[]; webCitations?: WebCitation[]; onCite: (c: Citation) => void }) {
  return (
    <div className="mt-3 border-t border-line/70 pt-2.5">
      <p className="ui-caps mb-1.5">Sources</p>
      <div className="flex flex-wrap gap-1.5">
        {citations.map((c) => (
          <button
            key={`${c.n}-${c.noteId}`}
            type="button"
            title={c.quote ? `“${c.quote}”` : undefined}
            onClick={() => onCite(c)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--glass-hover)] px-2.5 py-1 text-[12.5px] text-ink hover:bg-[var(--glass-active)] hover:text-heading"
          >
            <span className="font-semibold text-muted">{c.n}</span>
            <FileText size={12} aria-hidden className="flex-none text-muted" />
            <span className="truncate">{c.title}</span>
          </button>
        ))}
        {webCitations.map((c) => (
          <a
            key={`${c.n}-${c.url}`}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            title={c.url}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--glass-hover)] px-2.5 py-1 text-[12.5px] text-ink hover:bg-[var(--glass-active)] hover:text-heading"
          >
            <span className="font-semibold text-muted">{c.n}</span>
            <Globe size={12} aria-hidden className="flex-none text-muted" />
            <span className="truncate">{c.title}</span>
            {c.domain && c.domain !== c.title.toLowerCase() ? <span className="flex-none text-muted">{c.domain}</span> : null}
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * An answer: written word by word while it streams (with Stop), then the Markdown with inline citations,
 * sources, proposed changes, Copy and (the last one) Regenerate, and follow-up suggestions.
 */
export function AssistantMessage({
  message,
  last,
  busy,
  outcome,
  onCite,
  onStop,
  onRegenerate,
  onSuggestion,
  onApply,
  onDismiss,
  onOpen,
  run,
  research,
}: {
  message: ChatMessageData;
  last: boolean;
  busy: boolean;
  outcome: ActionsOutcome;
  onCite: (c: Citation) => void;
  onStop: () => void;
  onRegenerate: () => void;
  onSuggestion: (text: string) => void;
  onApply: () => void;
  onDismiss: () => void;
  onOpen: (href: string) => void;
  /** An agent's answer: acting on its run. */
  run?: RunHandlers;
  /** A deep research report: its job (steps, Cancel, Save as note). */
  research?: ResearchHandlers;
}) {
  const streaming = message.status === "streaming";
  // Revealed word by word while it streams, and until the reveal catches up with the finished answer.
  const [reveal, setReveal] = useState(streaming);
  const { text, caughtUp } = useTypewriter(message.text, reveal);
  useEffect(() => {
    if (reveal && !streaming && caughtUp) setReveal(false);
  }, [reveal, streaming, caughtUp]);
  const cited = useMemo(() => new Set([...message.citations.map((c) => c.n), ...message.webCitations.map((c) => c.n)]), [message.citations, message.webCitations]);
  const citeBy = (n: number) => {
    const c = message.citations.find((x) => x.n === n);
    if (c) return onCite(c);
    const w = message.webCitations.find((x) => x.n === n);
    if (w) openWebCitation(w);
  };

  if (message.status === "error" && message.error) {
    const problem = storedProblem(message.error);
    return (
      <div className="space-y-1.5">
        {message.text ? (
          <div className="rounded-[14px] rounded-bl-[4px] bg-[var(--glass-active)] px-4 py-3 shadow-[var(--glass-edge)]">
            <AiMarkdown markdown={message.text} />
          </div>
        ) : null}
        <AiProblemNotice problem={problem} className={problem.kind === "other" ? "rounded-[12px] bg-danger-soft px-3 py-2.5 text-[13px] text-danger" : undefined} />
        {last ? (
          <button type="button" disabled={busy} onClick={onRegenerate} className={ROW_BUTTON}>
            <RotateCcw size={12} aria-hidden /> Try again
          </button>
        ) : null}
      </div>
    );
  }

  if (streaming && !message.text && research?.job.status === "running") return <ResearchProgress research={research} />;

  if (streaming && !message.text) {
    return (
      <div className="px-1">
        <div className="flex items-center gap-3">
          <p role="status" className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> {phaseLabel(message.phase, false)}
          </p>
          <button type="button" onClick={onStop} className={ROW_BUTTON}>
            <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" /> Stop
          </button>
        </div>
        {message.agent?.steps.length ? (
          <div className="mt-2">
            <AgentSteps steps={message.agent.steps} live />
          </div>
        ) : null}
      </div>
    );
  }

  if (reveal) {
    return (
      <div className="rounded-[14px] rounded-bl-[4px] bg-[var(--glass-active)] px-4 py-3 shadow-[var(--glass-edge)]" aria-busy="true">
        <StreamingText text={text} cited={cited} />
        {streaming ? (
          <button type="button" onClick={onStop} className={`${ROW_BUTTON} mt-1`}>
            <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" /> Stop
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-[14px] rounded-bl-[4px] bg-[var(--glass-active)] px-4 py-3 shadow-[var(--glass-edge)]">
        {message.agent ? <AgentSteps steps={message.agent.steps} /> : null}
        {message.text ? <AiMarkdown markdown={message.text} cited={cited} onCite={citeBy} onNavigate={onOpen} /> : <p className="text-[13.5px] text-muted">Stopped before it said anything.</p>}
        {message.agent?.run && run ? <AgentRunCard run={message.agent.run} activity={run.activity} onApprove={run.onApprove} onDiscard={run.onDiscard} onUndo={run.onUndo} onOpen={onOpen} /> : null}
        {message.actions ? <ActionsCard actions={message.actions as AiAction[]} outcome={outcome} onApply={onApply} onDismiss={onDismiss} onOpen={onOpen} /> : null}
        {message.citations.length || message.webCitations.length ? <Sources citations={message.citations} webCitations={message.webCitations} onCite={onCite} /> : null}
        <SearchSuggestions entryPoints={message.searchEntryPoints} />
        <div className="-mb-1 mt-2 flex flex-wrap items-center gap-0.5">
          {message.text ? <CopyButton text={markdownToPlain(message.text)} /> : null}
          {last ? (
            <button type="button" disabled={busy} onClick={onRegenerate} className={ROW_BUTTON}>
              <RotateCcw size={12} aria-hidden /> Regenerate
            </button>
          ) : null}
          {research ? <ResearchFooter research={research} onOpen={onOpen} /> : null}
          {message.status === "stopped" && research?.job.status !== "cancelled" ? <span className="px-1.5 text-[12px] text-faint">Stopped</span> : null}
        </div>
      </div>
      {last && message.suggestions.length && !busy ? (
        <div className="flex flex-col items-start gap-1.5" aria-label="Suggested follow-ups" role="group">
          {message.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onSuggestion(s)} className="rounded-full bg-[var(--glass-hover)] px-3 py-1.5 text-left text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
