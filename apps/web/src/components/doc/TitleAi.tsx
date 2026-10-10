"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAi, type AiTask } from "@/components/ai/useAi";
import { errorMessage } from "@/components/ui/Toast";

/** A range of the title the AI works on (the whole title when nothing is selected). */
export interface TitleRange {
  start: number;
  end: number;
}

const ACTIONS: { task: AiTask; label: string }[] = [
  { task: "improve", label: "Improve writing" },
  { task: "fix", label: "Fix spelling & grammar" },
  { task: "shorter", label: "Make shorter" },
  { task: "simplify", label: "Simplify language" },
  { task: "professional", label: "Sound professional" },
  { task: "casual", label: "Sound casual" },
];

/**
 * Where to float next to the title, in viewport coordinates. The title sits in the cover band, which
 * clips anything that overflows it, so the pill and menu render in a portal and follow the title.
 */
function useBelow(anchor: HTMLElement | null): { top: number; left: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      setPos({ top: Math.round(r.bottom + 8), left: Math.round(Math.max(16, Math.min(r.left, window.innerWidth - 376))) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  return pos;
}

/** A small "AI" button under the title while words in it are selected. */
export function TitleAiPill({ anchor, onOpen }: { anchor: HTMLElement | null; onOpen: () => void }) {
  const pos = useBelow(anchor);
  if (!pos) return null;
  return createPortal(
    <button
      type="button"
      // Keep the title's selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      style={{ top: pos.top, left: pos.left }}
      className="ui-pop fixed z-40 inline-flex items-center gap-1.5 rounded-chip px-3 py-1.5 text-[12.5px] font-medium text-ink hover:text-heading"
    >
      <AiIcon size={14} aria-hidden className="text-[#7c6cf0]" /> Edit with AI
      <kbd className="ml-1 font-sans text-[11px] text-faint">⌘J</kbd>
    </button>,
    document.body,
  );
}

/** Titles are one line: drop line breaks, wrapping quotes and a trailing full stop from AI replies. */
function cleanTitle(text: string): string {
  return text
    .replace(/\s*\n+\s*/g, " ")
    .trim()
    .replace(/^["“'‘](.*)["”'’]$/, "$1")
    .replace(/\.$/, "")
    .trim();
}

/**
 * The title's AI menu. The title is a plain textarea, outside the note's editor, so the editor's
 * selection menu never reaches it: this offers the same rewrites for the selected words (or the whole
 * title), a fresh title suggested from the note, and a free-form instruction.
 */
export function TitleAi({
  anchor,
  documentId,
  title,
  range,
  hasContent,
  onApply,
  onClose,
}: {
  /** The title field the menu floats under. */
  anchor: HTMLElement | null;
  documentId: string;
  title: string;
  range: TitleRange;
  /** The note has body text, so the AI can suggest a title from it. */
  hasContent: boolean;
  onApply: (next: string) => void;
  onClose: () => void;
}) {
  const { write } = useAi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const pos = useBelow(anchor);
  const whole = range.start === range.end || (range.start === 0 && range.end === title.length);
  const target = whole ? title : title.slice(range.start, range.end);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const replace = (text: string) => {
    const clean = cleanTitle(text);
    if (!clean) return setError("Foli didn't return a title. Try again.");
    onApply(whole ? clean : `${title.slice(0, range.start)}${clean}${title.slice(range.end)}`);
  };

  const run = async (label: string, task: AiTask, opts: { instruction?: string } = {}) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    try {
      const { text } = task === "title" ? await write("title", { documentId }) : await write(task, { documentId, text: target, ...opts });
      if (task === "title") onApply(cleanTitle(text) || title);
      else replace(text);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  if (!pos) return null;
  const item = "flex w-full items-center rounded-control px-2.5 py-1.5 text-left text-[13.5px] text-ink hover:bg-[var(--glass-hover)] hover:text-heading disabled:opacity-50";

  return createPortal(
    <div
      ref={rootRef}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="AI for the title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="ui-pop fixed z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-panel text-left font-sans text-ink animate-[folio-rise_160ms_var(--ease-folio)] motion-reduce:animate-none"
    >
      <form
        className="flex items-center gap-2 px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (instruction.trim() && target.trim()) void run("instruction", "refine", { instruction: instruction.trim() });
        }}
      >
        <AiIcon size={16} aria-hidden className="flex-none text-[#7c6cf0]" />
        <input
          autoFocus
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={Boolean(busy)}
          aria-label={whole ? "Ask Foli to edit the title" : "Ask Foli to edit the selected words"}
          placeholder={whole ? "Ask Foli to edit the title…" : "Ask Foli to edit the selected words…"}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
        {instruction.trim() ? (
          <button type="submit" aria-label="Send" disabled={Boolean(busy)} className="grid h-7 w-7 flex-none place-items-center rounded-chip bg-heading text-canvas">
            <ArrowUp size={15} aria-hidden />
          </button>
        ) : null}
        <button type="button" aria-label="Close AI" title="Close (Esc)" onClick={onClose} className="grid h-7 w-7 flex-none place-items-center rounded-chip text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
          <X size={15} aria-hidden />
        </button>
      </form>
      {error ? (
        <p role="alert" className="mx-3 mb-2 rounded-control bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <ul id={listId} aria-label="AI suggestions" className="border-t border-line/60 p-1.5">
        {hasContent ? (
          <li>
            <button type="button" className={item} disabled={Boolean(busy)} onClick={() => void run("title", "title")}>
              {busy === "title" ? "Thinking of a title…" : "Suggest a new title from the note"}
            </button>
          </li>
        ) : null}
        {target.trim()
          ? ACTIONS.map((a) => (
              <li key={a.task}>
                <button type="button" className={item} disabled={Boolean(busy)} onClick={() => void run(a.label, a.task)}>
                  {busy === a.label ? "Working…" : a.label}
                </button>
              </li>
            ))
          : null}
      </ul>
      {busy === "instruction" ? <p className="px-4 pb-2.5 text-[12.5px] text-muted">Working…</p> : null}
      <p className="border-t border-line/60 px-4 py-2 text-[11.5px] text-faint">Foli can make mistakes. Sent to Google Gemini.</p>
    </div>,
    document.body,
  );
}
