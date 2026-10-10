"use client";

import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTopLayer } from "@/components/ui/topLayer";

export interface MentionPerson {
  profileId: string;
  displayName: string;
  isYou?: boolean;
  guest?: boolean;
}

export type CommentNode = { type: "text"; text: string } | { type: "mention"; userId: string; label: string };

/**
 * Turns comment text into inline nodes: "@Name" becomes a mention when it matches someone picked from
 * the suggestions (exact id) or, failing that, anyone who can be mentioned (longest name first).
 */
export function textToCommentBody(text: string, picked: MentionPerson[], people: MentionPerson[]): CommentNode[] {
  const seen = new Set<string>();
  const candidates = [...picked, ...[...people].sort((a, b) => b.displayName.length - a.displayName.length)].filter((p) => {
    const key = `${p.profileId}:${p.displayName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const out: CommentNode[] = [];
  let buf = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]!))) {
      const rest = text.slice(i + 1);
      const hit = candidates.find((m) => rest.toLowerCase().startsWith(m.displayName.toLowerCase()) && !/[\p{L}\p{N}]/u.test(rest[m.displayName.length] ?? " "));
      if (hit) {
        if (buf) out.push({ type: "text", text: buf });
        buf = "";
        out.push({ type: "mention", userId: hit.profileId, label: hit.displayName });
        i += 1 + hit.displayName.length;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push({ type: "text", text: buf });
  return out;
}

/** The "@query" being typed right before the caret, if any. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)@([\p{L}\p{N}][\p{L}\p{N} .'-]{0,30})?$/u.exec(before);
  if (!m) return null;
  const query = m[1] ?? "";
  return { start: caret - query.length - 1, query };
}

export interface MentionInputHandle {
  focus: () => void;
  /** People picked from the suggestions since the last reset (used to resolve duplicate names). */
  picked: () => MentionPerson[];
  reset: () => void;
}

/**
 * A comment field with @mention suggestions. The field keeps focus; the list is linked with
 * aria-controls/aria-activedescendant; ↑/↓ move, Enter/Tab pick, Escape closes the list.
 */
export const MentionInput = forwardRef<
  MentionInputHandle,
  {
    value: string;
    onChange: (value: string) => void;
    people: MentionPerson[];
    multiline?: boolean;
    id?: string;
    label?: string;
    placeholder?: string;
    describedBy?: string;
    className?: string;
    onSubmitShortcut?: () => void;
    onEscape?: () => void;
    /** Enter sends (calls onSubmitShortcut) and Shift+Enter starts a new line, as in chat. */
    enterToSend?: boolean;
    /** A multiline field that starts at one line and grows with its text (up to `maxHeight` px). */
    autoGrow?: boolean;
    maxHeight?: number;
    disabled?: boolean;
  }
>(function MentionInput({ value, onChange, people, multiline = false, id, label, placeholder, describedBy, className, onSubmitShortcut, onEscape, enterToSend = false, autoGrow = false, maxHeight = 160, disabled }, ref) {
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!autoGrow || !multiline || !el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, autoGrow, multiline, maxHeight]);
  const listRef = useRef<HTMLUListElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const picked = useRef<MentionPerson[]>([]);
  const listId = useId();

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    },
    picked: () => picked.current,
    reset: () => {
      picked.current = [];
    },
  }));

  const q = mentionQueryAt(value, caret);
  const matches = useMemo(() => {
    if (!q) return [];
    const needle = q.query.toLowerCase();
    return people.filter((p) => p.displayName.toLowerCase().includes(needle)).slice(0, 6);
  }, [q, people]);
  const open = Boolean(q && matches.length && closedAt !== q.start);
  const listStyle = useTopLayer(open, listRef, inputRef, { matchWidth: true, gap: 4 });
  const current = Math.min(active, Math.max(0, matches.length - 1));

  const choose = (p: MentionPerson) => {
    if (!q) return;
    const insert = `@${p.displayName} `;
    const next = value.slice(0, q.start) + insert + value.slice(caret);
    picked.current = [...picked.current.filter((x) => x.profileId !== p.profileId), p];
    onChange(next);
    const at = q.start + insert.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  };

  const common = {
    id,
    value,
    placeholder,
    "aria-label": label,
    "aria-describedby": describedBy,
    "aria-autocomplete": "list" as const,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open ? `${listId}-${current}` : undefined,
    className,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      onChange(e.target.value);
      setCaret(e.target.selectionStart ?? e.target.value.length);
      setActive(0);
    },
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0),
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (open) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((current + 1) % matches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((current - 1 + matches.length) % matches.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          choose(matches[current]!);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setClosedAt(q!.start);
          return;
        }
      }
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmitShortcut) {
        e.preventDefault();
        onSubmitShortcut();
        return;
      }
      if (enterToSend && e.key === "Enter" && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing && onSubmitShortcut) {
        e.preventDefault();
        onSubmitShortcut();
      }
    },
  };

  return (
    <div className="relative">
      {multiline ? <textarea ref={inputRef} rows={autoGrow ? 1 : 3} maxLength={5000} disabled={disabled} {...common} /> : <input ref={inputRef} maxLength={5000} disabled={disabled} {...common} />}
      {open ? (
        <ul ref={listRef} id={listId} role="listbox" aria-label="People to mention" popover="manual" style={listStyle} className="ui-pop z-[100] border-0 p-1.5 text-ink" onMouseDown={(e) => e.preventDefault()}>
          {matches.map((p, i) => (
            <li
              key={p.profileId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(p)}
              className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm ${i === current ? "bg-accent-soft text-heading" : ""}`}
            >
              <span className="grid h-6 w-6 flex-none place-items-center rounded-[6px] bg-sunken text-[11px] font-semibold text-heading" aria-hidden>
                {p.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
              {p.isYou ? <span className="text-xs text-faint">you</span> : p.guest ? <span className="text-xs text-faint">guest</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
