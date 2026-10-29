"use client";

import { DateField, TimeField } from "@/components/ui/DateField";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Inbox, X, FileText, CalendarDays } from "lucide-react";
import { naturalDateLabel, parseNaturalDate, useNaturalDatesReady } from "@/lib/nlDate";
import { describeRepeat, parseRepeatPhrase, repeatProps, stepOccurrence, type RepeatRule } from "@folevi/editor-schema";
import { Repeat } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Select";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { quickAddOnDevice } from "@/lib/quickAddOffline";
import { useIphoneApp } from "@/lib/iphone";
import { Sheet } from "@/components/iphone/Sheet";
import { PhoneQuickAdd } from "@/components/iphone/QuickAddSheet";

export type Priority = "none" | "low" | "medium" | "high";
export type Target = { id: string; title: string; icon: string | null } | null;

/**
 * Quick Add Task (⇧⌘A). The task becomes a checklist block in the chosen document: the open page by
 * default, or the person's Inbox page when none is chosen. Every task always lives in a document.
 */
export function QuickAddTask({ open, onClose, documentId, due }: { open: boolean; onClose: () => void; documentId?: string; /** Starts on this day (the calendar's "Add a task"). */ due?: string }) {
  const { route } = useAppRouter();
  const currentDoc = documentId ?? (route.name === "doc" ? route.id : undefined);
  const touch = useMediaQuery("(pointer: coarse)");
  // The phone layout: a sheet at the keyboard's top (docs/IOS_POLISH_PLAN.md §3, Quick add task).
  const iphone = useIphoneApp();
  if (iphone)
    return (
      <Sheet open={open} onClose={onClose} label="Quick add task" closeButton={false} bodyClassName="pb-1">
        <PhoneQuickAdd onClose={onClose} currentDoc={currentDoc} initialDue={due} />
      </Sheet>
    );
  return (
    // (A finger has no Enter key to be told about: the keyboard's Return, or Add task, adds it.)
    <Dialog open={open} onClose={onClose} title="Quick add task" description={`${touch ? "" : "Press Enter to add. "}Tasks without a page go to your Inbox page.`} size="sm">
      {open ? <QuickAddForm onClose={onClose} currentDoc={currentDoc} initialDue={due} /> : null}
    </Dialog>
  );
}

/** What a quick-add form holds and does (the dialog's form, the phone's sheet, the Mac app's Quick Add window). */
export function useQuickAdd({ onClose, currentDoc, onAdded, initialDue }: { onClose: () => void; currentDoc?: string; onAdded?: (added: { documentId: string; where: string }) => void; initialDue?: string }) {
  const { scope, today, deviceId, engine, profile, online } = useAppState();
  const quickAdd = useMutation(api.tasks.quickAdd);
  const { navigate } = useAppRouter();
  const toast = useToast();
  const current = useQuery(api.documents.titles, currentDoc ? { documentIds: [currentDoc] } : "skip");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(initialDue ?? "");
  const [time, setTime] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [target, setTarget] = useState<Target | undefined>(undefined); // undefined = not chosen yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A date written in the task ("call Sam tomorrow 3pm") sets the due date, unless one was picked by hand
  // or the person said to keep those words as text.
  const [keptAsText, setKeptAsText] = useState<string | null>(null);
  const [repeatKept, setRepeatKept] = useState<string | null>(null);
  // "water the plants every monday": a repeat, read first so its day isn't also taken as the due date.
  const repeat = useMemo(() => {
    const r = parseRepeatPhrase(title);
    return r && r.text !== repeatKept && r.rest ? r : null;
  }, [title, repeatKept]);
  const text = repeat ? repeat.rest : title;
  // (Read again once the date parser has loaded: it arrives a moment after the app starts.)
  const datesReady = useNaturalDatesReady();
  const parsed = useMemo(() => {
    if (due || !datesReady) return null;
    const p = parseNaturalDate(text);
    return p && p.text !== keptAsText && p.rest ? p : null;
  }, [text, due, keptAsText, datesReady]);
  // A repeat with no date written starts on its first day from today (today itself when it fits).
  const firstDate = (rule: RepeatRule) => {
    if (rule.repeat === "monthly" || rule.repeat === "yearly") return today;
    const yesterday = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - 86_400_000).toISOString().slice(0, 10);
    return stepOccurrence(rule, yesterday, Number(today.slice(8, 10)));
  };
  const currentInfo = currentDoc ? current?.[currentDoc] : undefined;
  // Default: the open page (if it's a normal page you can see), otherwise the Inbox.
  const effective: Target = target !== undefined ? target : currentDoc && currentInfo && !currentInfo.inTrash ? { id: currentDoc, title: currentInfo.title, icon: currentInfo.icon } : null;

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) {
      setError("Write the task first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const task = {
        title: parsed ? parsed.rest : text,
        dueDate: due || parsed?.date || (repeat ? firstDate(repeat.rule) : undefined),
        dueTime: due ? time || undefined : parsed?.time,
        ...(repeat ? { repeat: repeatProps(repeat.rule) } : {}),
        priority: priority === "none" ? undefined : priority,
        documentId: effective?.id,
      };
      // Offline (account mode): kept on this device and sent with the rest of the queue, rather than
      // waiting for the server. (Local mode is always "online": its server is the library on this device.)
      const r =
        !online && engine
          ? await quickAddOnDevice({ engine, profileId: profile.id, deviceId }, scope, task)
          : await quickAdd({ scope, today, ...task, deviceId: deviceId ?? undefined });
      onClose();
      const where = effective ? effective.title || "Untitled" : "Inbox";
      if (onAdded) onAdded({ documentId: r.documentId, where });
      else toast.show(`Task added to ${where}`, { tone: "success", action: { label: "Open", onClick: () => navigate(`/d/${r.documentId}`) } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return { scope, today, title, setTitle, due, setDue, time, setTime, priority, setPriority, setTarget, effective, busy, error, setError, repeat, parsed, setKeptAsText, setRepeatKept, submit };
}

/** The form itself: in the dialog above, and alone in the Mac app's Quick Add window (`onAdded` says where it went). */
export function QuickAddForm({ onClose, currentDoc, onAdded, initialDue }: { onClose: () => void; currentDoc?: string; onAdded?: (added: { documentId: string; where: string }) => void; initialDue?: string }) {
  const { scope, today, title, setTitle, due, setDue, time, setTime, priority, setPriority, setTarget, effective, busy, error, setError, repeat, parsed, setKeptAsText, setRepeatKept, submit } = useQuickAdd({ onClose, currentDoc, onAdded, initialDue });

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await submit();
      }}
    >
      <label htmlFor="qa-title" className="sr-only">
        Task
      </label>
      <input
        id="qa-title"
        autoFocus
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setError(null);
        }}
        placeholder="What needs doing?"
        maxLength={500}
        aria-invalid={error ? true : undefined}
        aria-describedby={parsed ? "qa-when" : undefined}
        className="h-11 w-full ui-input rounded-chip px-3 text-body outline-none"
      />
      {repeat ? (
        <p className="mt-2 flex items-center gap-2 text-subheadline text-muted">
          <span className="ui-chip bg-accent-soft text-accent-soft-ink">
            <Repeat size={13} aria-hidden />
            <span>{describeRepeat(repeat.rule)}</span>
            <button type="button" aria-label={`Keep “${repeat.text.trim()}” as text`} title="Keep as text" onClick={() => setRepeatKept(repeat.text)} className="-mr-1 grid h-5 w-5 place-items-center rounded-chip hover:bg-[var(--glass-hover)]">
              <X size={12} aria-hidden />
            </button>
          </span>
        </p>
      ) : null}
      {parsed ? (
        <p id="qa-when" className="mt-2 flex items-center gap-2 text-subheadline text-muted">
          <span className="ui-chip bg-accent-soft text-accent-soft-ink">
            <CalendarDays size={13} aria-hidden />
            <span>Due {naturalDateLabel(parsed, today)}</span>
            <button type="button" aria-label={`Keep “${parsed.text.trim()}” as text`} title="Keep as text" onClick={() => setKeptAsText(parsed.text)} className="-mr-1 grid h-5 w-5 place-items-center rounded-chip hover:bg-[var(--glass-hover)]">
              <X size={12} aria-hidden />
            </button>
          </span>
          <span className="truncate">from “{parsed.text.trim()}”</span>
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="text-subheadline">
          <span className="block text-muted">Due date</span>
          <DateField value={due} onChange={setDue} aria-label="Due date" size="lg" className="mt-1 w-44" />
        </div>
        {due ? (
          <div className="text-subheadline">
            <span className="block text-muted">Time (optional)</span>
            <TimeField value={time} onChange={setTime} emptyLabel="All day" aria-label="Due time" size="lg" className="mt-1 w-32" />
          </div>
        ) : null}
        <label className="text-subheadline">
          <span className="block text-muted">Priority</span>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="mt-1 h-9 ui-input rounded-chip px-3">
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </label>
      </div>
      <DocumentPicker scope={scope} value={effective} onChange={setTarget} />
      {error ? (
        <p role="alert" className="mt-3 text-subheadline text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" aria-busy={busy || undefined}>
          Add task
        </Button>
      </div>
    </form>
  );
}


/** "Add to" field: the Inbox, or any page in the current context (Personal or a workspace) found by search. */
export function DocumentPicker({ scope, value, onChange, label = "Add to", exclude }: { scope: WireScope; value: Target; onChange: (t: Target) => void; label?: string; exclude?: string }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);
  const results = useQuery(api.search.documents, open && debounced ? { scope, query: debounced, limit: 8 } : "skip");
  const recent = useQuery(api.documents.recent, open && !debounced ? { scope, limit: 6 } : "skip");
  const docs = ((debounced ? results : recent) ?? []).filter((d) => d.kind !== "template" && d.id !== exclude);
  const options: Target[] = [null, ...docs.map((d) => ({ id: d.id, title: d.title, icon: d.icon }))];
  const choose = (t: Target) => {
    onChange(t);
    setQuery("");
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      choose(options[active] ?? null);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };
  const optionId = (t: Target) => `${listId}-${t ? t.id : "inbox"}`;
  return (
    <div className="mt-3 text-subheadline">
      <label htmlFor={`${listId}-input`} className="block text-muted">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        {value && !open ? (
          <span className="ui-chip max-w-full bg-accent-soft text-accent-soft-ink">
            <span className="truncate">
              {value.title || "Untitled"}
            </span>
            <button type="button" aria-label="Add to Inbox instead" title="Add to Inbox instead" onClick={() => onChange(null)} className="-mr-1 grid h-5 w-5 place-items-center rounded-chip hover:bg-[var(--glass-hover)]">
              <X size={12} aria-hidden />
            </button>
          </span>
        ) : null}
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? optionId(options[active] ?? null) : undefined}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder={value ? "Search another page…" : "Inbox, or search a page…"}
          className="h-9 min-w-0 flex-1 ui-input rounded-chip px-3"
        />
      </div>
      {open ? (
        <ul id={listId} role="listbox" aria-label="Pages" className="ui-pop mt-1 max-h-52 overflow-y-auto p-1.5">
          {options.map((t, i) => (
            <li
              key={t ? t.id : "inbox"}
              id={optionId(t)}
              role="option"
              aria-selected={i === active}
              data-highlighted={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(t)}
              className="ui-menu-item flex cursor-pointer items-center gap-2 px-2 py-1.5"
            >
              {t ? <FileText size={14} aria-hidden className="text-muted" /> : <Inbox size={14} aria-hidden className="text-muted" />}
              <span className="truncate">{t ? t.title || "Untitled" : "Inbox (your task page)"}</span>
            </li>
          ))}
          {debounced && results !== undefined && docs.length === 0 ? <li className="px-2 py-1.5 text-muted">No matching pages</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
