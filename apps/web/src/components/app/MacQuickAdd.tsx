"use client";
// Quick Add in Folevi for Mac (docs/MAC_POLISH_PLAN.md §3.8, the owner's choice P3): one field that grows, as
// Things' Quick Entry and Raycast. A 56 point row holds an empty checkbox, the task's words and, at the end, where
// it goes ("Inbox", or a page). Words become chips as they're typed: a day or time ("tomorrow 9am"), a repeat
// ("every monday"), a priority ("!high") and a page ("#Atlas"), each with a × that keeps its words as text. A
// second row (the chips, then their editors) appears only once there's something in it, and Tab moves into it.
// Return adds and closes, ⌘Return adds and opens the task in the main window, ⇧Return adds and stays for another;
// Escape closes. After adding, "Added to Inbox" shows for a moment with Open. The panel is as tall as this
// (sizeQuickAdd); the native app's panel draws the material behind a clear page (data-vibrancy).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CalendarDays, Check, FileText, Flag, Inbox, Repeat, X } from "lucide-react";
import { useQuery } from "convex/react";
import { describeRepeat } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { naturalDateLabel } from "@/lib/nlDate";
import { dueLabel } from "@/lib/format";
import { desktop } from "@/lib/desktop";
import { pageForQuery, readQuickAddTokens } from "@/lib/desktop/quickAddTokens";
import { DateField, TimeField } from "@/components/ui/DateField";
import { DocumentPicker, useQuickAdd, type Priority } from "./QuickAddTask";

const PRIORITIES: { id: Priority; label: string; tone?: string }[] = [
  { id: "none", label: "None" },
  { id: "low", label: "Low", tone: "#5b6ad0" },
  { id: "medium", label: "Medium", tone: "#c58a12" },
  { id: "high", label: "High", tone: "#d6453d" },
];
const HINT_KEY = "folevi:quick-add-hint-seen";
const clockTime = (hhmm: string) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

type Editor = "date" | "priority" | "page" | null;
type After = "close" | "open" | "again";

export function MacQuickAdd({ round, place }: { round: number; /** The place picker, when there are several places. */ place?: ReactNode }) {
  const bridge = desktop();
  const after = useRef<After>("close");
  const [added, setAdded] = useState<{ where: string; documentId: string; stay: boolean } | null>(null);
  const q = useQuickAdd({
    onClose: () => undefined,
    onAdded: ({ documentId, where }) => {
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* storage off: the hint shows again next time */
      }
      const mode = after.current;
      after.current = "close";
      if (mode === "open") {
        bridge?.openInMain(`/d/${documentId}`);
        bridge?.closeQuickAdd();
        reset();
        return;
      }
      setAdded({ where, documentId, stay: mode === "again" });
      reset();
    },
  });
  const [raw, setRaw] = useState("");
  const [kept, setKept] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<Editor>(null);
  const [details, setDetails] = useState(false);
  const [hint, setHint] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);

  const reset = () => {
    setRaw("");
    q.setTitle("");
    q.setDue("");
    q.setTime("");
    q.setPriority("none");
    q.setTarget(undefined);
    q.setKeptAsText(null);
    q.setRepeatKept(null);
    setKept(new Set());
    setEditor(null);
    setDetails(false);
    window.requestAnimationFrame(() => field.current?.focus());
  };
  // Shown again from the menu bar or the shortcut: a fresh field.
  useEffect(() => {
    reset();
    setAdded(null);
    let seen: boolean;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
    } catch {
      seen = false;
    }
    setHint(!seen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  // The tokens: priority and page come out of the words before dates and repeats are read from what's left.
  const tokens = useMemo(() => readQuickAddTokens(raw, kept), [raw, kept]);
  const { setTitle, setPriority, setTarget } = q;
  useEffect(() => setTitle(tokens.rest), [tokens.rest, setTitle]);
  const tokenPriority = tokens.priority?.level ?? null;
  useEffect(() => {
    if (tokenPriority) setPriority(tokenPriority);
  }, [tokenPriority, setPriority]);
  const pageQuery = tokens.page?.query ?? "";
  const found = useQuery(api.search.documents, pageQuery ? { scope: q.scope, query: pageQuery, limit: 6 } : "skip");
  const tokenPage = useMemo(() => (pageQuery && found ? pageForQuery(pageQuery, found.filter((d) => d.kind !== "template")) : null), [pageQuery, found]);
  const pageFromToken = useRef(false);
  useEffect(() => {
    if (tokenPage) {
      pageFromToken.current = true;
      setTarget({ id: tokenPage.id, title: tokenPage.title, icon: tokenPage.icon });
    } else if (pageFromToken.current) {
      pageFromToken.current = false;
      setTarget(undefined);
    }
  }, [tokenPage, setTarget]);

  // The confirmation goes after a moment: the panel closes, or (⇧Return) stays with a fresh field.
  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => {
      setAdded(null);
      if (!added.stay) bridge?.closeQuickAdd();
    }, 1200);
    return () => window.clearTimeout(t);
  }, [added, bridge]);

  // The panel is as tall as what's in it, including a calendar or list opened from the second row. Told again each
  // time it's shown (the app may have put it back to one row), and on a timer rather than an animation frame: a
  // panel behind others, or not yet on screen, gets no frames in WebKit.
  const resize = useRef<(force?: boolean) => void>(() => undefined);
  useLayoutEffect(() => {
    if (!bridge) return;
    let last = 0;
    let frame = 0;
    const report = () => {
      frame = 0;
      const el = panel.current;
      if (!el) return;
      let bottom = el.getBoundingClientRect().bottom;
      for (const pop of document.querySelectorAll<HTMLElement>(":popover-open")) bottom = Math.max(bottom, pop.getBoundingClientRect().bottom + 8);
      const h = Math.ceil(bottom);
      if (h !== last) {
        last = h;
        bridge.sizeQuickAdd(h);
      }
    };
    const soon = () => {
      if (!frame) frame = window.setTimeout(report, 0);
    };
    resize.current = (force) => {
      if (force) last = 0;
      soon();
    };
    // (The body, not the panel's element, which changes between the form and the confirmation.)
    const ro = new ResizeObserver(soon);
    ro.observe(document.body);
    if (panel.current) ro.observe(panel.current);
    document.addEventListener("toggle", soon, true);
    const mo = new MutationObserver(soon);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["popover", "style"] });
    report();
    return () => {
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener("toggle", soon, true);
      window.clearTimeout(frame);
    };
  }, [bridge]);
  // (Measured again when shown, and when the confirmation takes the form's place.)
  useLayoutEffect(() => resize.current(true), [round, added]);

  const add = (mode: After) => {
    if (!q.title.trim() || q.busy) return;
    after.current = mode;
    void q.submit();
  };
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      add(e.metaKey ? "open" : e.shiftKey ? "again" : "close");
    }
  };
  const onPanelKey = (e: KeyboardEvent<HTMLElement>) => {
    // Escape puts an editor away first, then the panel (DesktopQuickAdd).
    if (e.key === "Escape" && editor && !e.defaultPrevented) {
      e.preventDefault();
      setEditor(null);
      field.current?.focus();
    }
    // ⌘Return and ⇧Return from the second row too.
    if (e.key === "Enter" && (e.metaKey || e.shiftKey) && e.target !== field.current && !e.defaultPrevented) {
      e.preventDefault();
      add(e.metaKey ? "open" : "again");
    }
  };

  const keep = (text: string) => setKept((k) => new Set(k).add(text));
  const where = q.effective ? q.effective.title || "Untitled" : "Inbox";
  const priority = PRIORITIES.find((p) => p.id === q.priority)!;
  const due = q.due || q.parsed?.date || "";
  const time = q.due ? q.time : q.parsed?.time ?? "";
  const dateLabel = q.due ? (q.time ? `${dueLabel(q.due, q.today)}, ${clockTime(q.time)}` : dueLabel(q.due, q.today)) : q.parsed ? naturalDateLabel(q.parsed, q.today) : null;
  const chips = Boolean(dateLabel || q.repeat || q.priority !== "none");
  const second = chips || details || editor !== null;

  if (added) {
    return (
      <main ref={panel} aria-label="Quick add task" aria-live="polite" className="ui-desktop-quick-add mac-quick-add flex h-14 items-center gap-3 px-4 text-ink">
        <span aria-hidden className="grid h-5 w-5 flex-none place-items-center rounded-chip bg-heading text-canvas">
          <Check size={13} strokeWidth={3} />
        </span>
        <p className="min-w-0 flex-1 truncate text-body">
          Added to <span className="font-semibold text-heading">{added.where}</span>
        </p>
        <button
          type="button"
          className="ui-btn ui-btn-secondary h-7 rounded-small px-3 text-callout"
          onClick={() => {
            bridge?.openInMain(`/d/${added.documentId}`);
            bridge?.closeQuickAdd();
            setAdded(null);
          }}
        >
          Open
        </button>
      </main>
    );
  }

  const chip = "inline-flex h-7 max-w-[15rem] flex-none items-center gap-1.5 rounded-small px-2.5 text-subheadline leading-none outline-none transition-colors hover:bg-[var(--mac-press)] focus-visible:ring-2 focus-visible:ring-focus [&>svg]:flex-none";
  const removeBtn = "-mr-1.5 grid h-5 w-5 flex-none place-items-center rounded-tiny text-faint hover:text-heading";
  return (
    <main ref={panel} aria-label="Quick add task" className="ui-desktop-quick-add mac-quick-add text-ink" onKeyDown={onPanelKey}>
      <form
        className="ui-drag flex h-14 items-center gap-3 px-4"
        onSubmit={(e) => {
          e.preventDefault();
          add("close");
        }}
      >
        <span aria-hidden className="h-5 w-5 flex-none rounded-chip shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]" />
        <label htmlFor="qa-title" className="sr-only">
          New task
        </label>
        <input
          ref={field}
          id="qa-title"
          autoFocus
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            q.setError(null);
          }}
          onKeyDown={onFieldKey}
          placeholder="New task"
          maxLength={500}
          autoComplete="off"
          spellCheck
          aria-describedby={hint ? "qa-hint" : undefined}
          aria-keyshortcuts="Enter Meta+Enter Shift+Enter Escape"
          className="h-10 min-w-0 flex-1 bg-transparent text-title-3 leading-6 text-heading outline-none placeholder:text-faint"
        />
        <button
          type="button"
          aria-label={`Adds to ${where}, change`}
          aria-expanded={editor === "page"}
          onClick={() => setEditor((x) => (x === "page" ? null : "page"))}
          className={`${chip.replace("max-w-[15rem]", "max-w-[12rem]")} ${q.effective ? "text-heading" : "text-muted"} bg-[var(--mac-hover)] ${tokens.page ? "pr-1.5" : ""}`}
        >
          {q.effective ? <FileText size={14} aria-hidden /> : <Inbox size={14} aria-hidden />}
          <span className="truncate">{tokens.page && !tokenPage ? `No page “${tokens.page.query}”` : where}</span>
        </button>
        {tokens.page ? (
          <button type="button" aria-label={`Keep “${tokens.page.text}” as text`} title="Keep as text" onClick={() => keep(tokens.page!.text)} className={`${removeBtn} -ml-2`}>
            <X size={12} aria-hidden />
          </button>
        ) : null}
      </form>

      {/* The second row: the chips (and quiet buttons for what isn't set yet), reached with Tab. */}
      <div
        role="group"
        aria-label="Task details"
        onFocus={() => setDetails(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDetails(false);
        }}
        className={second ? "flex h-12 items-center gap-1.5 border-t border-line px-4" : "h-0 overflow-hidden"}
      >
        {q.repeat ? (
          <span className={`${chip} bg-[var(--mac-hover)] text-heading`}>
            <Repeat size={13} aria-hidden />
            <span className="truncate">{describeRepeat(q.repeat.rule)}</span>
            <button type="button" aria-label={`Keep “${q.repeat.text.trim()}” as text`} title="Keep as text" onClick={() => q.setRepeatKept(q.repeat!.text)} className={removeBtn}>
              <X size={12} aria-hidden />
            </button>
          </span>
        ) : null}
        <span className={`${chip} ${dateLabel ? "bg-[var(--mac-hover)] text-heading" : "text-muted"} p-0`}>
          <button type="button" id="qa-when" aria-expanded={editor === "date"} onClick={() => setEditor((x) => (x === "date" ? null : "date"))} className="inline-flex h-7 items-center gap-1.5 rounded-small px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <CalendarDays size={13} aria-hidden />
            <span className="truncate">{dateLabel ? `Due ${dateLabel}` : "Date"}</span>
          </button>
          {q.parsed && !q.due ? (
            <button type="button" aria-label={`Keep “${q.parsed.text.trim()}” as text`} title="Keep as text" onClick={() => q.setKeptAsText(q.parsed!.text)} className={`${removeBtn} mr-1`}>
              <X size={12} aria-hidden />
            </button>
          ) : q.due ? (
            <button type="button" aria-label="Remove the date" title="Remove the date" onClick={() => (q.setDue(""), q.setTime(""))} className={`${removeBtn} mr-1`}>
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </span>
        <span className={`${chip} ${q.priority !== "none" ? "bg-[var(--mac-hover)] text-heading" : "text-muted"} p-0`}>
          <button type="button" aria-expanded={editor === "priority"} onClick={() => setEditor((x) => (x === "priority" ? null : "priority"))} className="inline-flex h-7 items-center gap-1.5 rounded-small px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Flag size={13} aria-hidden style={priority.tone ? { color: priority.tone } : undefined} />
            <span>{q.priority === "none" ? "Priority" : priority.label}</span>
          </button>
          {q.priority !== "none" ? (
            <button
              type="button"
              aria-label={tokens.priority ? `Keep “${tokens.priority.text}” as text` : "Remove the priority"}
              title={tokens.priority ? "Keep as text" : "Remove the priority"}
              onClick={() => {
                if (tokens.priority) keep(tokens.priority.text);
                q.setPriority("none");
              }}
              className={`${removeBtn} mr-1`}
            >
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </span>
        <span className="flex-1" />
        {q.error ? (
          <p role="alert" className="truncate text-footnote text-danger">
            {q.error}
          </p>
        ) : null}
      </div>

      {/* An editor for one chip, under the row. */}
      {editor === "date" ? (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-subheadline">
          <DateField value={q.due || due} onChange={(v) => q.setDue(v)} aria-label="Due date" className="w-40" />
          {q.due || due ? <TimeField value={q.due ? q.time : time ?? ""} onChange={(v) => (q.due ? q.setTime(v) : (q.setDue(due), q.setTime(v)))} emptyLabel="All day" aria-label="Due time" className="w-28" /> : null}
        </div>
      ) : editor === "priority" ? (
        <div role="radiogroup" aria-label="Priority" className="ui-seg ui-well m-3 mt-2.5">
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={q.priority === p.id}
              data-active={q.priority === p.id}
              onClick={() => {
                if (tokens.priority && p.id !== tokens.priority.level) keep(tokens.priority.text);
                q.setPriority(p.id);
                setEditor(null);
                field.current?.focus();
              }}
            >
              {p.tone ? <Flag size={12} aria-hidden style={{ color: p.tone }} /> : null}
              {p.label}
            </button>
          ))}
        </div>
      ) : editor === "page" ? (
        <div className="border-t border-line px-4 pb-3">
          {place}
          <DocumentPicker
            scope={q.scope}
            value={q.effective}
            label="Add to"
            onChange={(t) => {
              if (tokens.page) keep(tokens.page.text);
              pageFromToken.current = false;
              q.setTarget(t);
              setEditor(null);
              field.current?.focus();
            }}
          />
        </div>
      ) : null}

      {hint && !second && editor === null ? (
        <p id="qa-hint" className="-mt-2 px-4 pb-2.5 pl-12 text-footnote leading-4 text-faint">
          Return adds it, ⌘Return opens it too. Try “tomorrow 9am”, “!high” or “#page”.
        </p>
      ) : null}
    </main>
  );
}
