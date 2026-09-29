"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  FileText,
  Languages,
  Lightbulb,
  ListChecks,
  ListTree,
  Minimize2,
  PenLine,
  RotateCcw,
  SpellCheck,
  Maximize2,
  Wand2,
  X,
} from "lucide-react";
import { AiMarkdown, StreamingText } from "./AiMarkdown";
import { useAiStream } from "./useAiStream";
import { insertAiMarkdown } from "./insert";
import { useAi, type AiTask } from "./useAi";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";

/** What the inline composer works on: a range of text (a selection or whole blocks), or the cursor. */
export interface InlineAiRequest {
  id: number;
  target: { from: number; to: number; text: string } | null;
  /** Run this right away (from a slash command or a toolbar action). */
  task?: AiTask;
  language?: string;
}

interface Suggestion {
  id: string;
  label: string;
  icon: React.ReactNode;
  task?: AiTask;
  /** Opens the language list instead of running. */
  languages?: boolean;
}

const EDIT: Suggestion[] = [
  { id: "improve", label: "Improve writing", icon: <Wand2 size={15} />, task: "improve" },
  { id: "fix", label: "Fix spelling & grammar", icon: <SpellCheck size={15} />, task: "fix" },
  { id: "shorter", label: "Make shorter", icon: <Minimize2 size={15} />, task: "shorter" },
  { id: "longer", label: "Make longer", icon: <Maximize2 size={15} />, task: "longer" },
  { id: "simplify", label: "Simplify language", icon: <BookOpen size={15} />, task: "simplify" },
  { id: "professional", label: "Sound professional", icon: <PenLine size={15} />, task: "professional" },
  { id: "casual", label: "Sound casual", icon: <PenLine size={15} />, task: "casual" },
  { id: "translate", label: "Translate to…", icon: <Languages size={15} />, languages: true },
  { id: "explain", label: "Explain this", icon: <Lightbulb size={15} />, task: "explain" },
  { id: "summarizeText", label: "Summarize this", icon: <FileText size={15} />, task: "summarizeText" },
];
const WRITE: Suggestion[] = [
  { id: "continue", label: "Continue writing", icon: <PenLine size={15} />, task: "continue" },
  { id: "summarize", label: "Summarize this note", icon: <FileText size={15} />, task: "summarize" },
  { id: "actions", label: "Find action items", icon: <ListChecks size={15} />, task: "actions" },
  { id: "outline", label: "Make an outline", icon: <ListTree size={15} />, task: "outline" },
  { id: "brainstorm", label: "Brainstorm ideas", icon: <Lightbulb size={15} />, task: "brainstorm" },
];
export const AI_LANGUAGES = ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Bengali", "Hindi", "Arabic", "Chinese", "Japanese", "Korean", "Turkish", "Russian"];
const REFINES = ["Shorter", "Longer", "Simpler", "More formal", "More casual"];

const TASK_LABEL: Partial<Record<AiTask, string>> = Object.fromEntries([...EDIT, ...WRITE].filter((s) => s.task).map((s) => [s.task, s.label]));

type Phase = { kind: "compose" } | { kind: "languages" } | { kind: "busy"; label: string } | { kind: "result"; text: string; label: string; last: Run };
interface Run {
  task: AiTask;
  text?: string;
  instruction?: string;
  language?: string;
}

/**
 * The inline AI composer: opens right at the cursor (⌘J, "/ai…", the toolbar's Ask AI, the block menu).
 * Type what you want or pick a suggestion; the result appears in place with Replace/Insert, Try again,
 * quick refinements ("Shorter", "More formal", or anything you type) and Discard.
 */
export function InlineAi({ editor, documentId, request, onClose }: { editor: Editor; documentId: string; request: InlineAiRequest; onClose: () => void }) {
  const { write } = useAi();
  const stream = useAiStream();
  const target = request.target;
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [input, setInput] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<AiProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const runSeq = useRef(0);
  const uid = useId();

  // Suggestions: what you typed first (as an instruction), then the matching actions.
  const base = target ? EDIT : WRITE;
  const q = input.trim().toLowerCase();
  const options: Suggestion[] = useMemo(() => {
    if (phase.kind === "languages") return AI_LANGUAGES.filter((l) => !q || l.toLowerCase().startsWith(q)).map((l) => ({ id: `lang-${l}`, label: l, icon: <Languages size={15} />, task: "translate" as AiTask }));
    const matches = base.filter((s) => !q || s.label.toLowerCase().includes(q));
    return input.trim() ? [{ id: "custom", label: input.trim(), icon: <AiIcon size={15} /> }, ...matches] : matches;
  }, [base, q, input, phase.kind]);
  useEffect(() => setActive(0), [q, phase.kind]);

  const run = useCallback(
    async (r: Run, label: string) => {
      const seq = ++runSeq.current;
      setError(null);
      setNotice(null);
      setPhase({ kind: "busy", label });
      try {
        // Stream the reply so it appears word by word (falls back to waiting for the whole reply).
        const streamId = await stream.begin().catch(() => undefined);
        const { text } = await write(r.task, { documentId, text: r.text, instruction: r.instruction, language: r.language, streamId });
        if (seq !== runSeq.current) return;
        await stream.finish(text);
        if (seq !== runSeq.current) return;
        if (!text.trim()) {
          setPhase({ kind: "compose" });
          return;
        }
        setPhase({ kind: "result", text, label, last: r });
        setInput("");
      } catch (e) {
        if (seq !== runSeq.current) return;
        setError(aiProblem(e));
        setPhase({ kind: "compose" });
      } finally {
        if (seq === runSeq.current) stream.end();
      }
    },
    [write, documentId, stream],
  );

  const choose = (s: Suggestion | undefined) => {
    if (!s) return;
    if (s.languages) {
      setInput("");
      setPhase({ kind: "languages" });
      return;
    }
    if (s.id === "custom") {
      const instruction = s.label;
      return void run(target ? { task: "refine", text: target.text, instruction } : { task: "draft", instruction }, instruction);
    }
    const language = s.id.startsWith("lang-") ? s.label : undefined;
    return void run({ task: s.task!, text: target?.text, language }, language ? `Translate to ${language}` : s.label);
  };

  // Started from a slash command or a toolbar action: run at once.
  useEffect(() => {
    if (request.task) {
      const label = request.task === "translate" ? `Translate to ${request.language ?? "English"}` : (TASK_LABEL[request.task] ?? "Writing");
      void run({ task: request.task, text: target?.text, language: request.language }, label);
    }
  }, [request.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Place under the text it's about (or above when there's no room), as wide as the page's text column.
  const place = useCallback(() => {
    const view = editor.view;
    const at = target ? target.to : view.state.selection.to;
    let rect: { top: number; bottom: number };
    try {
      rect = view.coordsAtPos(Math.min(at, view.state.doc.content.size));
    } catch {
      return;
    }
    const col = (view.dom as HTMLElement).getBoundingClientRect();
    const width = Math.min(640, Math.max(320, col.width));
    const left = Math.min(Math.max(8, col.left), window.innerWidth - width - 8);
    const h = boxRef.current?.offsetHeight ?? 260;
    const below = window.innerHeight - rect.bottom - 16;
    const up = below < Math.min(h, 320) && rect.top > below;
    setPos({ left, width, top: up ? Math.max(8, rect.top - 10 - h) : rect.bottom + 10, up });
  }, [editor, target]);
  useLayoutEffect(() => {
    const el = boxRef.current;
    try {
      if (el && !el.matches(":popover-open")) el.showPopover();
    } catch {
      /* no Popover API: still fixed */
    }
    place();
    const ro = new ResizeObserver(place);
    if (el) ro.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);
  // Focus the input once it's placed (it's hidden until then, and hidden elements can't take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (placed && phase.kind !== "busy") inputRef.current?.focus();
  }, [placed, phase.kind]);

  const close = () => {
    runSeq.current++;
    onClose();
    editor.commands.focus();
  };

  const accept = (how: "replace" | "below") => {
    if (phase.kind !== "result") return;
    const placement = how === "replace" && target ? { kind: "replace" as const, ...target, original: target.text } : { kind: "cursor" as const };
    if (how === "below" && target) editor.commands.setTextSelection(target.to);
    if (!insertAiMarkdown(editor, phase.text, placement)) {
      editor.commands.setTextSelection(Math.min(target?.to ?? 0, editor.state.doc.content.size));
      insertAiMarkdown(editor, phase.text, { kind: "cursor" });
    }
    onClose();
  };

  const refine = (instruction: string) => {
    if (phase.kind !== "result" || !instruction.trim()) return;
    void run({ task: "refine", text: phase.text, instruction: instruction.trim() }, instruction.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (phase.kind === "languages") return setPhase({ kind: "compose" });
      return close();
    }
    if (phase.kind === "result") {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (input.trim()) refine(input);
        else accept(target && !["explain", "summarizeText"].includes(phase.last.task) ? "replace" : "below");
      }
      return;
    }
    if (phase.kind === "busy") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "ArrowLeft" && phase.kind === "languages" && !input) {
      setPhase({ kind: "compose" });
    }
  };

  const replaceable = phase.kind === "result" && target && !["explain", "summarizeText"].includes(phase.last.task);
  const listId = `${uid}-list`;

  return (
    <div
      ref={boxRef}
      popover="manual"
      role="dialog"
      aria-label="AI Assistant"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      style={{ position: "fixed", margin: 0, right: "auto", bottom: "auto", left: pos?.left ?? 0, top: pos?.top ?? 0, width: pos?.width ?? 480, visibility: pos ? "visible" : "hidden" }}
      className="ui-pop z-[100] overflow-hidden rounded-[14px] border-0 p-0 text-ink animate-[folio-rise_140ms_var(--ease-folio)] motion-reduce:animate-none"
    >
      {/* What it's working on */}
      {target ? (
        <p className="truncate border-b border-line/60 px-3.5 py-2 text-[12px] text-muted">
          <span className="font-semibold">Editing:</span> “{target.text.replace(/\s+/g, " ").slice(0, 140)}”
        </p>
      ) : null}

      {/* Result */}
      {phase.kind === "result" ? (
        <div className="max-h-[min(46vh,380px)] overflow-y-auto border-b border-line/60 px-4 pb-2 pt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
            <AiIcon size={12} aria-hidden className="text-[#7c6cf0]" /> {phase.label}
          </p>
          <AiMarkdown markdown={phase.text} />
        </div>
      ) : null}

      {/* Working */}
      {phase.kind === "busy" ? (
        <div className="max-h-[min(46vh,380px)] overflow-y-auto px-4 pb-2 pt-3.5" aria-live="polite" aria-busy="true">
          <p className="mb-1.5 flex items-center gap-2 text-[11.5px] font-semibold text-muted">
            <AiIcon size={12} aria-hidden className="animate-pulse text-[#7c6cf0] motion-reduce:animate-none" /> {phase.label}…
          </p>
          {stream.text ? (
            <StreamingText text={stream.text} />
          ) : (
            <div className="space-y-2 pb-1.5">
              {[92, 78, 85].map((w) => (
                <div key={w} className="h-2.5 animate-pulse rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,#8b7cf6_22%,transparent),color-mix(in_oklab,#f58ab8_18%,transparent))] motion-reduce:animate-none" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Input: an instruction, a filter for the suggestions, or a refinement of the result */}
      {phase.kind !== "busy" ? (
        <div className="flex items-center gap-2 px-3 py-2.5">
          {phase.kind === "languages" ? (
            <button type="button" aria-label="Back" onClick={() => setPhase({ kind: "compose" })} className="grid h-7 w-7 flex-none place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
              <ChevronLeft size={16} aria-hidden />
            </button>
          ) : (
            <AiIcon size={16} aria-hidden className="flex-none text-[#7c6cf0]" />
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            role={phase.kind === "result" ? undefined : "combobox"}
            aria-expanded={phase.kind === "result" ? undefined : options.length > 0}
            aria-controls={phase.kind === "result" ? undefined : listId}
            aria-activedescendant={phase.kind !== "result" && options[active] ? `${uid}-${options[active]!.id}` : undefined}
            aria-label={phase.kind === "result" ? "Tell the AI what to change" : phase.kind === "languages" ? "Language" : "Ask AI to write or edit"}
            placeholder={
              phase.kind === "result"
                ? "Tell AI what to change… (⏎ to accept)"
                : phase.kind === "languages"
                  ? "Translate to…"
                  : target
                    ? "Ask AI to edit the selected text…"
                    : "Ask AI to write anything…"
            }
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
          {input.trim() ? (
            <button
              type="button"
              aria-label="Send"
              onClick={() => (phase.kind === "result" ? refine(input) : choose(options[0]))}
              className="grid h-7 w-7 flex-none place-items-center rounded-full bg-heading text-canvas"
            >
              <ArrowUp size={15} aria-hidden />
            </button>
          ) : null}
          <button type="button" aria-label="Close AI" title="Close (Esc)" onClick={close} className="grid h-7 w-7 flex-none place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
            <X size={15} aria-hidden />
          </button>
        </div>
      ) : (
        <div className="flex justify-end px-3 pb-2.5">
          <button type="button" onClick={() => stream.stop()} className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12.5px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
            <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" /> Stop
          </button>
        </div>
      )}

      {error ? <AiProblemNotice problem={error} className={error.kind === "other" ? "mx-3 mb-2.5 rounded-[8px] bg-danger-soft px-3 py-2 text-[13px] text-danger" : "mx-3 mb-2.5 w-auto"} /> : phase.kind === "compose" ? <AiCreditsNote documentId={documentId} className="mx-3 mb-2.5" /> : null}
      {notice ? <p className="mx-4 mb-2 text-[12.5px] text-muted">{notice}</p> : null}

      {/* Result actions and quick refinements */}
      {phase.kind === "result" ? (
        <div className="space-y-2 border-t border-line/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {replaceable ? (
              <>
                <button type="button" onClick={() => accept("replace")} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
                  <Check size={14} aria-hidden /> Replace
                </button>
                <button type="button" onClick={() => accept("below")} className="ui-btn ui-btn-secondary h-8 px-3 text-[12.5px]">
                  <CornerDownLeft size={14} aria-hidden /> Insert below
                </button>
              </>
            ) : (
              <button type="button" onClick={() => accept("below")} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
                <CornerDownLeft size={14} aria-hidden /> Insert
              </button>
            )}
            <button type="button" onClick={() => void run(phase.last, phase.label)} className="ui-btn ui-btn-ghost h-8 px-2.5 text-[12.5px]">
              <RotateCcw size={13} aria-hidden /> Try again
            </button>
            <button type="button" onClick={close} className="ui-btn ui-btn-ghost ml-auto h-8 px-2.5 text-[12.5px] text-muted">
              Discard
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick changes">
            {REFINES.map((r) => (
              <button key={r} type="button" onClick={() => refine(r)} className="rounded-full bg-[var(--glass-hover)] px-2.5 py-1 text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
                {r}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Suggestions */}
      {phase.kind === "compose" || phase.kind === "languages" ? (
        options.length ? (
          <ul id={listId} role="listbox" aria-label={phase.kind === "languages" ? "Languages" : "AI suggestions"} className="max-h-[min(40vh,320px)] overflow-y-auto border-t border-line/60 p-1.5">
            {phase.kind === "compose" && !input.trim() ? (
              <li role="presentation" className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                {target ? "Edit or review" : "Write with AI"}
              </li>
            ) : null}
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${uid}-${o.id}`}
                role="option"
                aria-selected={i === active}
                onPointerMove={() => i !== active && setActive(i)}
                onClick={() => choose(o)}
                className={`flex cursor-default items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13.5px] ${i === active ? "bg-[var(--glass-hover)] text-heading" : "text-ink"}`}
              >
                <span aria-hidden className="text-muted">
                  {o.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.id === "custom" ? <>{target ? "Edit: " : "Write: "}<span className="font-medium">{o.label}</span></> : o.label}</span>
                {o.languages ? <ChevronRight size={14} aria-hidden className="text-faint" /> : null}
                {i === active ? <CornerDownLeft size={13} aria-hidden className="text-faint" /> : null}
              </li>
            ))}
          </ul>
        ) : null
      ) : null}
      <p className="border-t border-line/60 px-3.5 py-1.5 text-[11px] text-faint">AI can make mistakes. Sent to Google Gemini.</p>
    </div>
  );
}
