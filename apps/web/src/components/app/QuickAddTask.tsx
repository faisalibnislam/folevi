"use client";

import { DateField, TimeField } from "@/components/ui/DateField";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Inbox, X, FileText } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Select";

type Priority = "none" | "low" | "medium" | "high";
type Target = { id: string; title: string; icon: string | null } | null;

/**
 * Quick Add Task (⇧⌘A). The task becomes a checklist block in the chosen document: the open page by
 * default, or the person's Inbox page when none is chosen. Every task always lives in a document.
 */
export function QuickAddTask({ open, onClose, documentId }: { open: boolean; onClose: () => void; documentId?: string }) {
  const { route } = useAppRouter();
  const currentDoc = documentId ?? (route.name === "doc" ? route.id : undefined);
  return (
    <Dialog open={open} onClose={onClose} title="Quick add task" description="Press Enter to add. Tasks without a page go to your Inbox page." size="sm">
      {open ? <QuickAddForm onClose={onClose} currentDoc={currentDoc} /> : null}
    </Dialog>
  );
}

function QuickAddForm({ onClose, currentDoc }: { onClose: () => void; currentDoc?: string }) {
  const { scope, today, deviceId } = useAppState();
  const quickAdd = useMutation(api.tasks.quickAdd);
  const { navigate } = useAppRouter();
  const toast = useToast();
  const current = useQuery(api.documents.titles, currentDoc ? { documentIds: [currentDoc] } : "skip");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [target, setTarget] = useState<Target | undefined>(undefined); // undefined = not chosen yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentInfo = currentDoc ? current?.[currentDoc] : undefined;
  // Default: the open page (if it's a normal page you can see), otherwise the Inbox.
  const effective: Target = target !== undefined ? target : currentDoc && currentInfo && !currentInfo.inTrash ? { id: currentDoc, title: currentInfo.title, icon: currentInfo.icon } : null;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        if (!title.trim()) {
          setError("Write the task first.");
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const r = await quickAdd({
            scope,
            title,
            today,
            dueDate: due || undefined,
            dueTime: due && time ? time : undefined,
            priority: priority === "none" ? undefined : priority,
            documentId: effective?.id,
            deviceId: deviceId ?? undefined,
          });
          onClose();
          toast.show(effective ? `Task added to ${effective.title || "Untitled"}` : "Task added to Inbox", { tone: "success", action: { label: "Open", onClick: () => navigate(`/d/${r.documentId}`) } });
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
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
        className="h-11 w-full ui-input rounded-[6px] px-3 text-[15px] outline-none"
      />
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="text-sm">
          <span className="block text-muted">Due date</span>
          <DateField value={due} onChange={setDue} aria-label="Due date" size="lg" className="mt-1 w-44" />
        </div>
        {due ? (
          <div className="text-sm">
            <span className="block text-muted">Time (optional)</span>
            <TimeField value={time} onChange={setTime} emptyLabel="All day" aria-label="Due time" size="lg" className="mt-1 w-32" />
          </div>
        ) : null}
        <label className="text-sm">
          <span className="block text-muted">Priority</span>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="mt-1 h-9 ui-input rounded-[6px] px-3">
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </label>
      </div>
      <DocumentPicker scope={scope} value={effective} onChange={setTarget} />
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
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
function DocumentPicker({ scope, value, onChange }: { scope: WireScope; value: Target; onChange: (t: Target) => void }) {
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
  const docs = ((debounced ? results : recent) ?? []).filter((d) => d.kind !== "template");
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
    <div className="mt-3 text-sm">
      <label htmlFor={`${listId}-input`} className="block text-muted">
        Add to
      </label>
      <div className="mt-1 flex items-center gap-2">
        {value && !open ? (
          <span className="ui-chip max-w-full bg-accent-soft text-accent-soft-ink">
            <span className="truncate">
              {value.title || "Untitled"}
            </span>
            <button type="button" aria-label="Add to Inbox instead" onClick={() => onChange(null)} className="-mr-1 grid h-5 w-5 place-items-center rounded-[6px] hover:bg-[var(--glass-hover)]">
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
          className="h-9 min-w-0 flex-1 ui-input rounded-[6px] px-3"
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
              className="ui-menu-item flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5"
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
