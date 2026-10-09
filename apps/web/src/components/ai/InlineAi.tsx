"use client";

import type { Editor } from "@tiptap/react";
import { AI_LANGUAGES } from "./languages";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  BookOpen,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerDownLeft,
  FilePlus2,
  FileText,
  LayoutTemplate,
  Languages,
  Lightbulb,
  List,
  ListChecks,
  ListTree,
  Maximize2,
  Minimize2,
  Mic2,
  PenLine,
  RotateCcw,
  SpellCheck,
  Table2,
  Wand2,
  X,
} from "lucide-react";
import { AiMarkdown, StreamingText } from "./AiMarkdown";
import { AiDiffLegend, AiDiffView } from "./AiDiffView";
import { aiDiff } from "./aiDiff";
import { useAiStream } from "./useAiStream";
import { insertAiMarkdown, noteIsEmpty, type AiPlacement } from "./insert";
import { markdownToPlain } from "./plainText";
import { AI_TOOLS, REWRITE_TASKS, SELECTION_ACTIONS, TOOL_TASKS, useAi, useNoteAi, type AiTask } from "./useAi";
import { TOOL_ICONS } from "./toolIcons";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";
import { useAppRouter } from "@/lib/app/router";
import { useToast } from "@/components/ui/Toast";
import { AiAnnouncer, useDoneAnnouncement } from "./announce";

/** What the inline composer works on: a range of text (a selection or whole blocks), or the cursor. */
export interface InlineAiRequest {
  id: number;
  target: { from: number; to: number; text: string } | null;
  /** Run this right away (from a slash command or a toolbar action). */
  task?: AiTask;
  language?: string;
  /** Open ready for a prompt: "draft" writes at the cursor, "page" writes a whole page. */
  mode?: "draft" | "page";
}

type Submenu = "languages" | "tones";

interface Suggestion {
  id: string;
  label: string;
  icon: React.ReactNode;
  task?: AiTask;
  /** Opens a list (languages, tones) instead of running. */
  menu?: Submenu;
  /** Switches to writing a whole page from a description. */
  page?: boolean;
  group?: string;
  /** More words it's found by. */
  keywords?: string;
}

const SELECTION_ICONS: Partial<Record<AiTask, React.ReactNode>> = {
  improve: <Wand2 size={15} />,
  fix: <SpellCheck size={15} />,
  shorter: <Minimize2 size={15} />,
  longer: <Maximize2 size={15} />,
  simplify: <BookOpen size={15} />,
  toList: <List size={15} />,
  toTable: <Table2 size={15} />,
  toChecklist: <CheckSquare size={15} />,
  summarizeText: <FileText size={15} />,
  explain: <Lightbulb size={15} />,
  continueText: <PenLine size={15} />,
  actionItemsText: <ListChecks size={15} />,
};
const GROUP_TITLE: Record<string, string> = { edit: "Edit", turn: "Turn into", use: "Use the text", write: "Write with AI", study: "Meetings and study", think: "Think it through" };

const selection = (group: "edit" | "turn" | "use"): Suggestion[] =>
  SELECTION_ACTIONS.filter((a) => a.group === group && a.task !== "translate").map((a) => ({ id: a.task, label: a.label, icon: SELECTION_ICONS[a.task] ?? <Wand2 size={15} />, task: a.task, group }));
const EDIT: Suggestion[] = [
  ...selection("edit"),
  { id: "tones", label: "Change tone…", icon: <Mic2 size={15} />, menu: "tones", group: "edit" },
  { id: "translate", label: "Translate to…", icon: <Languages size={15} />, menu: "languages", group: "edit" },
  ...selection("turn"),
  ...selection("use"),
];
/** Meeting summary, flashcards, quiz and the frameworks: on the selected text, or the whole note. */
const TOOLS: Suggestion[] = AI_TOOLS.map((t) => ({ id: t.task, label: t.label, icon: TOOL_ICONS[t.task] ?? <Wand2 size={15} />, task: t.task, group: t.group === "meeting" || t.group === "study" ? "study" : "think", keywords: t.keywords }));
const WRITE: Suggestion[] = [
  { id: "continue", label: "Continue writing", icon: <PenLine size={15} />, task: "continue", group: "write" },
  { id: "summarize", label: "Summarize this page", icon: <FileText size={15} />, task: "summarize", group: "write" },
  { id: "actions", label: "Find action items", icon: <ListChecks size={15} />, task: "actions", group: "write" },
  { id: "outline", label: "Make an outline", icon: <ListTree size={15} />, task: "outline", group: "write" },
  { id: "brainstorm", label: "Brainstorm ideas", icon: <Lightbulb size={15} />, task: "brainstorm", group: "write" },
  { id: "page", label: "Write a whole page…", icon: <FilePlus2 size={15} />, page: true, group: "write" },
];
const TONES = SELECTION_ACTIONS.filter((a) => a.group === "tone");
const REFINES = ["Shorter", "Longer", "Simpler", "More formal", "More casual"];

/** A result's heading: what was asked for. */
export function taskLabel(task: AiTask, language?: string): string {
  if (task === "translate") return `Translate to ${language ?? "English"}`;
  const tone = TONES.find((t) => t.task === task);
  if (tone) return `Tone: ${tone.label}`;
  if (task === "page") return "Page";
  return [...EDIT, ...WRITE, ...TOOLS].find((s) => s.task === task)?.label ?? "Writing";
}

/** Results that read better whole than as changes: little of the text stays (a translation, a table). */
const showChangesFirst = (task: AiTask, kept: number) => task !== "translate" && task !== "toTable" && kept >= 0.3;

type Phase =
  | { kind: "compose" }
  | { kind: "menu"; menu: Submenu }
  | { kind: "busy"; label: string }
  | { kind: "result"; text: string; title?: string; label: string; last: Run };
interface Run {
  task: AiTask;
  text?: string;
  instruction?: string;
  language?: string;
}

/**
 * The inline AI composer: opens right at the cursor (⌘J, the "/" AI commands, the toolbar's Ask AI, the
 * block menu). Pick an action or type what you want; the result is previewed in place (a rewrite as the
 * words it would remove and add) and nothing in the note changes until you pick Replace, Insert above,
 * Insert below or Append. Each of those is one undo step. Try again, quick refinements, Copy and Discard.
 */
export function InlineAi({ editor, documentId, request, onClose }: { editor: Editor; documentId: string; request: InlineAiRequest; onClose: () => void }) {
  const { write, saveDraft } = useAi();
  const stream = useAiStream();
  const noteAi = useNoteAi();
  const toast = useToast();
  const { navigate } = useAppRouter();
  const target = request.target;
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  // Writing a whole page from a description (the "/" command, or "Write a whole page…").
  const [pageMode, setPageMode] = useState(request.mode === "page");
  const [input, setInput] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<AiProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"changes" | "result">("changes");
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const runSeq = useRef(0);
  const uid = useId();

  // Suggestions: what you typed first (as an instruction), then the matching actions.
  const q = input.trim().toLowerCase();
  const options: Suggestion[] = useMemo(() => {
    if (phase.kind === "menu" && phase.menu === "languages") return AI_LANGUAGES.filter((l) => !q || l.toLowerCase().startsWith(q)).map((l) => ({ id: `lang-${l}`, label: l, icon: <Languages size={15} />, task: "translate" as AiTask }));
    if (phase.kind === "menu") return TONES.filter((t) => !q || t.label.toLowerCase().startsWith(q)).map((t) => ({ id: `tone-${t.task}`, label: t.label, icon: <Mic2 size={15} />, task: t.task }));
    const typed = input.trim();
    if (pageMode) return typed ? [{ id: "custom-page", label: typed, icon: <FilePlus2 size={15} />, page: true }] : [];
    if (request.mode === "draft") return typed ? [{ id: "custom", label: typed, icon: <AiIcon size={15} /> }] : [];
    const base = [...(target ? EDIT : WRITE), ...TOOLS];
    const matches = base.filter((s) => !q || s.label.toLowerCase().includes(q) || Boolean(s.keywords?.includes(q)));
    if (!typed) return matches;
    const custom: Suggestion[] = [{ id: "custom", label: typed, icon: <AiIcon size={15} /> }];
    if (!target) custom.push({ id: "custom-page", label: typed, icon: <FilePlus2 size={15} />, page: true });
    return [...custom, ...matches.filter((m) => !m.page)];
  }, [phase, q, input, pageMode, request.mode, target]);
  useEffect(() => setActive(0), [q, phase.kind, pageMode]);

  const run = useCallback(
    async (r: Run, label: string) => {
      const seq = ++runSeq.current;
      setError(null);
      setNotice(null);
      setPhase({ kind: "busy", label });
      try {
        // Stream the reply so it appears word by word (falls back to waiting for the whole reply).
        const streamId = await stream.begin().catch(() => undefined);
        const { text, title } = await write(r.task, { documentId, text: r.text, instruction: r.instruction, language: r.language, streamId });
        if (seq !== runSeq.current) return;
        await stream.finish(text);
        if (seq !== runSeq.current) return;
        if (!text.trim()) {
          setPhase({ kind: "compose" });
          return;
        }
        const replaces = Boolean(target) && REWRITE_TASKS.has(r.task);
        setView(replaces && showChangesFirst(r.task, aiDiff(target!.text, text).kept) ? "changes" : "result");
        setPhase({ kind: "result", text, title, label, last: r });
        setInput("");
      } catch (e) {
        if (seq !== runSeq.current) return;
        setError(aiProblem(e));
        setPhase({ kind: "compose" });
      } finally {
        if (seq === runSeq.current) stream.end();
      }
    },
    [write, documentId, stream, target],
  );

  const choose = (s: Suggestion | undefined) => {
    if (!s) return;
    if (s.menu) {
      setInput("");
      setPhase({ kind: "menu", menu: s.menu });
      return;
    }
    if (s.id === "custom-page") return void run({ task: "page", instruction: s.label }, "Page");
    if (s.page) {
      setInput("");
      setPageMode(true);
      return;
    }
    if (s.id === "custom") {
      const instruction = s.label;
      return void run(target ? { task: "refine", text: target.text, instruction } : { task: "draft", instruction }, instruction);
    }
    const language = s.id.startsWith("lang-") ? s.label : undefined;
    return void run({ task: s.task!, text: target?.text, language }, taskLabel(s.task!, language));
  };

  // Started from a slash command or a toolbar action: run at once.
  useEffect(() => {
    if (request.task) void run({ task: request.task, text: target?.text, language: request.language }, taskLabel(request.task, request.language));
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
  }, [placed, phase.kind, pageMode]);

  const close = () => {
    runSeq.current++;
    onClose();
    editor.commands.focus();
  };

  const result = phase.kind === "result" ? phase : null;
  const replaceable = Boolean(result && target && REWRITE_TASKS.has(result.last.task));
  const isPage = result?.last.task === "page";
  /** A meeting summary, flashcards, a quiz or a framework: inserted or saved as a note, never replacing. */
  const isTool = Boolean(result && TOOL_TASKS.has(result.last.task));
  // People a meeting summary's "@Owner" can become a mention of (and a to-do's assignee).
  const people = useQuery(api.comments.mentionable, result?.last.task === "meetingSummary" ? { documentId } : "skip");
  const diff = useMemo(() => (result && target && replaceable ? aiDiff(target.text, result.text) : null), [result, target, replaceable]);

  /** Puts the result into the note (one undo step) and closes. */
  const accept = (how: "replace" | "above" | "below" | "end" | "cursor") => {
    if (!result) return;
    let placement: AiPlacement;
    if (how === "replace" && target) placement = { kind: "replace", ...target, original: target.text };
    else if ((how === "above" || how === "below") && target) placement = { kind: how, at: how === "above" ? target.from : target.to };
    else if (how === "above") placement = { kind: "above", at: editor.state.selection.from };
    else if (how === "end") placement = { kind: "end" };
    else placement = target ? { kind: "below", at: target.to } : { kind: "cursor" };
    // A page written into an empty note names it, when it has no title yet.
    const nameIt = isPage && result.title && noteIsEmpty(editor) && !noteAi?.title?.trim();
    const opts = { people: result.last.task === "meetingSummary" ? people : undefined };
    if (!insertAiMarkdown(editor, result.text, placement, opts)) {
      // The selected text changed since it was sent: overwrite nothing, put the result below it instead.
      insertAiMarkdown(editor, result.text, { kind: "below", at: Math.min(target?.to ?? 0, editor.state.doc.content.size) }, opts);
      toast.show("The selected text changed, so the result went below it.");
    }
    if (nameIt) noteAi?.setTitle?.(result.title!);
    onClose();
  };
  const primary = () => accept(replaceable ? "replace" : isPage && noteIsEmpty(editor) ? "end" : "below");

  const save = async (kind: "note" | "template") => {
    if (!result || saving) return;
    setSaving(true);
    setError(null);
    try {
      // A tool's result is named for what it is and the note it came from ("Meeting summary: Weekly sync").
      const toolTitle = isTool ? (noteAi?.title?.trim() ? `${taskLabel(result.last.task)}: ${noteAi.title.trim()}` : taskLabel(result.last.task)) : "";
      const { id } = await saveDraft(kind, toolTitle || result.title || result.last.instruction || "", result.text, { people: result.last.task === "meetingSummary" });
      onClose();
      if (kind === "note") navigate(`/d/${id}`);
      else toast.show("Saved to Templates", { action: { label: "Open", onClick: () => navigate(`/d/${id}`) } });
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setSaving(false);
    }
  };

  const copy = () => {
    if (!result) return;
    const text = isPage && result.title ? `${result.title}\n\n${markdownToPlain(result.text)}` : markdownToPlain(result.text);
    void navigator.clipboard.writeText(text).then(
      () => setNotice("Copied"),
      () => setNotice("Couldn't copy. Select the text and copy it instead."),
    );
  };

  const refine = (instruction: string) => {
    if (!result || !instruction.trim()) return;
    if (isPage) return void run({ task: "page", instruction: `${result.last.instruction ?? ""}\n\nChange it: ${instruction.trim()}` }, instruction.trim());
    // A tool runs again on the same text with the request, so its result keeps its shape (cards stay cards).
    if (isTool) return void run({ ...result.last, instruction: instruction.trim() }, `${taskLabel(result.last.task)}: ${instruction.trim()}`);
    void run({ task: "refine", text: result.text, instruction: instruction.trim() }, instruction.trim());
  };

  const back = () => {
    setInput("");
    if (phase.kind === "menu") setPhase({ kind: "compose" });
    else if (pageMode && request.mode !== "page") setPageMode(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (phase.kind === "menu" || (pageMode && request.mode !== "page" && phase.kind === "compose")) return back();
      return close();
    }
    if (phase.kind === "result") {
      if (e.key === "Enter" && !e.shiftKey && e.target === inputRef.current) {
        e.preventDefault();
        if (input.trim()) refine(input);
        else primary();
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
    } else if (e.key === "ArrowLeft" && !input && (phase.kind === "menu" || (pageMode && request.mode !== "page"))) {
      back();
    }
  };

  // Said once when the result is ready (the streaming text isn't announced word by word).
  const announce = useDoneAnnouncement(phase.kind === "busy", result ? (replaceable ? "Ready. Review the changes below." : "Ready. Review the result below.") : "");

  const listId = `${uid}-list`;
  const resultId = `${uid}-result`;
  const inSubmenu = phase.kind === "menu" || (pageMode && request.mode !== "page" && phase.kind === "compose");
  const placeholder =
    phase.kind === "result"
      ? isPage
        ? "Tell AI what to change in the page… (⏎ to insert)"
        : `Tell AI what to change… (⏎ to ${replaceable ? "replace" : "insert"})`
      : phase.kind === "menu"
        ? phase.menu === "languages"
          ? "Translate to…"
          : "Change the tone to…"
        : pageMode
          ? "Describe the page to write…"
          : request.mode === "draft"
            ? "Describe what to write…"
            : target
              ? "Ask Foli to edit the selected text…"
              : "Ask Foli to write anything…";
  const groupTitle = phase.kind === "compose" && !input.trim() && !pageMode;

  return (
    <div
      ref={boxRef}
      popover="manual"
      role="dialog"
      aria-label="Foli"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      style={{ position: "fixed", margin: 0, right: "auto", bottom: "auto", left: pos?.left ?? 0, top: pos?.top ?? 0, width: pos?.width ?? 480, visibility: pos ? "visible" : "hidden" }}
      className="ui-pop ui-app-colors z-[100] overflow-hidden rounded-[14px] border-0 p-0 text-ink animate-[folio-rise_140ms_var(--ease-folio)] motion-reduce:animate-none"
    >
      {/* What it's working on */}
      {target ? (
        <p className="truncate border-b border-line/60 px-3.5 py-2 text-[12px] text-muted">
          <span className="font-semibold">Editing:</span> “{target.text.replace(/\s+/g, " ").slice(0, 140)}”
        </p>
      ) : pageMode && phase.kind === "compose" ? (
        <p className="border-b border-line/60 px-3.5 py-2 text-[12px] text-muted">Say what the page is for and what it should cover. You'll see it before anything is added.</p>
      ) : null}

      {/* Result: the changes to the selected text, or what will be added */}
      {result ? (
        <div className="max-h-[min(46vh,380px)] overflow-y-auto border-b border-line/60 px-4 pb-2.5 pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
            <AiIcon size={12} aria-hidden className="text-[#7c6cf0]" />
            <span className="min-w-0 flex-1 truncate">{result.label}</span>
            {diff && !diff.same ? (
              <div className="ui-seg ui-well text-[11.5px]" role="group" aria-label="Preview">
                <button type="button" aria-pressed={view === "changes"} aria-controls={resultId} onClick={() => setView("changes")}>
                  Changes
                </button>
                <button type="button" aria-pressed={view === "result"} aria-controls={resultId} onClick={() => setView("result")}>
                  Result
                </button>
              </div>
            ) : null}
          </div>
          {diff?.same ? <p className="mb-1.5 text-[12.5px] text-muted">No changes needed.</p> : null}
          {isPage && result.title ? <p className="mb-1 font-serif text-[18px] font-semibold text-heading">{result.title}</p> : null}
          <div id={resultId}>
            {diff && !diff.same && view === "changes" ? (
              <>
                <AiDiffView parts={diff.parts} />
                <AiDiffLegend />
              </>
            ) : (
              <AiMarkdown markdown={result.text} />
            )}
          </div>
        </div>
      ) : null}

      {/* Working */}
      {phase.kind === "busy" ? (
        <div className="max-h-[min(46vh,380px)] overflow-y-auto px-4 pb-2 pt-3.5" aria-busy="true">
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
          {inSubmenu ? (
            <button type="button" aria-label="Back" onClick={back} className="grid h-7 w-7 flex-none place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
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
            aria-autocomplete={phase.kind === "result" ? undefined : "list"}
            aria-activedescendant={phase.kind !== "result" && options[active] ? `${uid}-${options[active]!.id}` : undefined}
            aria-label={phase.kind === "result" ? "Tell Foli what to change" : phase.kind === "menu" ? (phase.menu === "languages" ? "Language" : "Tone") : pageMode ? "Describe the page" : "Ask Foli to write or edit"}
            placeholder={placeholder}
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
      {notice ? (
        <p className="mx-4 mb-2 text-[12.5px] text-muted" role="status">
          {notice}
        </p>
      ) : null}

      {/* Result actions and quick refinements */}
      {result ? (
        <div className="space-y-2 border-t border-line/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Use the result">
            {replaceable ? (
              <button type="button" onClick={() => accept("replace")} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
                <Check size={14} aria-hidden /> Replace
              </button>
            ) : (
              <button type="button" onClick={primary} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
                <CornerDownLeft size={14} aria-hidden /> {target ? "Insert below" : "Insert"}
              </button>
            )}
            <button type="button" onClick={() => accept("above")} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
              <ArrowUpToLine size={14} aria-hidden /> Insert above
            </button>
            {replaceable ? (
              <button type="button" onClick={() => accept("below")} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
                <CornerDownLeft size={14} aria-hidden /> Insert below
              </button>
            ) : null}
            <button type="button" onClick={() => accept("end")} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
              <ArrowDownToLine size={14} aria-hidden /> Append to note
            </button>
            {isTool ? (
              <button type="button" disabled={saving} onClick={() => void save("note")} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
                <FilePlus2 size={14} aria-hidden /> Create note
              </button>
            ) : null}
            {isPage ? (
              <>
                <button type="button" disabled={saving} onClick={() => void save("note")} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
                  <FilePlus2 size={14} aria-hidden /> Create note
                </button>
                <button type="button" disabled={saving} onClick={() => void save("template")} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
                  <LayoutTemplate size={14} aria-hidden /> Save as template
                </button>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={copy} className="ui-btn ui-btn-ghost h-8 px-2.5 text-[12.5px]">
              <Copy size={13} aria-hidden /> Copy
            </button>
            <button type="button" onClick={() => void run(result.last, result.label)} className="ui-btn ui-btn-ghost h-8 px-2.5 text-[12.5px]">
              <RotateCcw size={13} aria-hidden /> Try again
            </button>
            <button type="button" onClick={close} className="ui-btn ui-btn-ghost ml-auto h-8 px-2.5 text-[12.5px] text-muted">
              Discard
            </button>
          </div>
          {!isPage ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick changes">
              {REFINES.map((r) => (
                <button key={r} type="button" onClick={() => refine(r)} className="rounded-full bg-[var(--glass-hover)] px-2.5 py-1 text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[var(--glass-active)] hover:text-heading">
                  {r}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Suggestions */}
      {phase.kind === "compose" || phase.kind === "menu" ? (
        options.length ? (
          <ul id={listId} role="listbox" aria-label={phase.kind === "menu" ? (phase.menu === "languages" ? "Languages" : "Tones") : "AI suggestions"} className="max-h-[min(40vh,320px)] overflow-y-auto border-t border-line/60 p-1.5">
            {options.map((o, i) => (
              <SuggestionRow
                key={o.id}
                o={o}
                id={`${uid}-${o.id}`}
                active={i === active}
                heading={groupTitle && o.group && o.group !== options[i - 1]?.group ? GROUP_TITLE[o.group] : undefined}
                target={Boolean(target)}
                onHover={() => i !== active && setActive(i)}
                onChoose={() => choose(o)}
              />
            ))}
          </ul>
        ) : null
      ) : null}
      <p className="border-t border-line/60 px-3.5 py-1.5 text-[11px] text-faint">Foli can make mistakes. Sent to Google Gemini.</p>
      <AiAnnouncer text={announce} />
    </div>
  );
}

function SuggestionRow({ o, id, active, heading, target, onHover, onChoose }: { o: Suggestion; id: string; active: boolean; heading?: string; target: boolean; onHover: () => void; onChoose: () => void }) {
  return (
    <>
      {heading ? (
        <li role="presentation" className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
          {heading}
        </li>
      ) : null}
      <li
        id={id}
        role="option"
        aria-selected={active}
        onPointerMove={onHover}
        onClick={onChoose}
        className={`flex cursor-default items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13.5px] ${active ? "bg-[var(--glass-hover)] text-heading" : "text-ink"}`}
      >
        <span aria-hidden className="text-muted">
          {o.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {o.id === "custom" ? (
            <>
              {target ? "Edit: " : "Write: "}
              <span className="font-medium">{o.label}</span>
            </>
          ) : o.id === "custom-page" ? (
            <>
              Write a page: <span className="font-medium">{o.label}</span>
            </>
          ) : (
            o.label
          )}
        </span>
        {o.menu || (o.page && o.id !== "custom-page") ? <ChevronRight size={14} aria-hidden className="text-faint" /> : null}
        {active ? <CornerDownLeft size={13} aria-hidden className="text-faint" /> : null}
      </li>
    </>
  );
}
