"use client";

import { useQuery } from "convex/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Inbox, Search } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Dialog } from "@/components/ui/Dialog";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import type { FolderTarget } from "./noteActions";

interface Option {
  id: string | null;
  name: string;
  color: string | null;
  /** The parent folder's name, shown while searching (folders nest one level). */
  parent: string | null;
  nested: boolean;
}

/**
 * Picks a folder (or Drafts) to move notes into: a search field over the workspace's folders with the
 * results as a listbox (type to filter, ↑/↓ to choose, Enter to move). The folder the notes are already
 * in (when they share one) is marked and can't be picked.
 */
export function MoveToFolderDialog({
  open,
  onClose,
  onPick,
  count = 1,
  noteTitle,
  currentFolderId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (folder: FolderTarget) => void;
  /** How many notes are being moved (for the description). */
  count?: number;
  /** The note's title, when moving one note. */
  noteTitle?: string;
  /** Where the notes are now: a folder id, null for Drafts, undefined when mixed/unknown. */
  currentFolderId?: string | null;
}) {
  const what = count === 1 ? `“${noteTitle?.trim() || "Untitled"}”` : `${count.toLocaleString()} notes`;
  return (
    <Dialog open={open} onClose={onClose} title="Move to folder" description={`Choose where ${what} should live.`} size="sm">
      <FolderPicker open={open} onClose={onClose} onPick={onPick} currentFolderId={currentFolderId} />
    </Dialog>
  );
}

/** The folder search and list (also the Folder side of a note's Move dialog). */
export function FolderPicker({
  open,
  onClose,
  onPick,
  currentFolderId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (folder: FolderTarget) => void;
  currentFolderId?: string | null;
}) {
  const { scope } = useAppState();
  const org = useQuery(api.organization.sidebar, open ? { scope } : "skip");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const baseId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);

  const options = useMemo<Option[]>(() => {
    const folders = org?.folders ?? [];
    const names = new Map(folders.map((f) => [f.id, f.name]));
    // Parents first, each followed by its subfolders.
    const ordered = folders
      .filter((f) => !f.parentFolderId)
      .flatMap((f) => [f, ...folders.filter((c) => c.parentFolderId === f.id)]);
    const all: Option[] = [
      { id: null, name: "No folder (Drafts)", color: null, parent: null, nested: false },
      ...ordered.map((f) => ({ id: f.id, name: f.name, color: f.color, parent: f.parentFolderId ? (names.get(f.parentFolderId) ?? null) : null, nested: Boolean(f.parentFolderId) })),
    ];
    const needle = q.trim().toLocaleLowerCase();
    if (!needle) return all;
    return all.filter((o) => o.name.toLocaleLowerCase().includes(needle) || (o.id === null && "drafts".includes(needle)));
  }, [org, q]);

  const current = Math.min(active, Math.max(0, options.length - 1));
  const isCurrent = (o: Option) => currentFolderId !== undefined && o.id === currentFolderId;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(optionId(current))}`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const pick = (o: Option | undefined) => {
    if (!o || isCurrent(o)) return;
    onClose();
    onPick({ id: o.id, name: o.id ? o.name : "Drafts" });
  };

  return (
    <>
      <label htmlFor={`${baseId}-q`} className="sr-only">
        Search folders
      </label>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <input
          id={`${baseId}-q`}
          autoFocus
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${baseId}-list`}
          aria-activedescendant={options.length ? optionId(current) : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((current + 1) % Math.max(1, options.length));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((current - 1 + options.length) % Math.max(1, options.length));
            } else if (e.key === "Home" && !q) {
              e.preventDefault();
              setActive(0);
            } else if (e.key === "End" && !q) {
              e.preventDefault();
              setActive(options.length - 1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(options[current]);
            }
          }}
          placeholder="Search folders"
          className="ui-input h-10 w-full rounded-chip pl-8 pr-3 text-sm"
        />
      </div>
      <ul ref={listRef} id={`${baseId}-list`} role="listbox" aria-label="Folders" aria-busy={org === undefined} className="mt-3 max-h-[min(360px,50dvh)] space-y-0.5 overflow-y-auto">
        {options.map((o, i) => {
          const here = isCurrent(o);
          return (
            <li
              key={o.id ?? "drafts"}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              aria-disabled={here || undefined}
              data-highlighted={i === current}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              className={`ui-menu-item cursor-pointer ${o.nested && !q.trim() ? "pl-8" : ""} ${here ? "cursor-default opacity-60" : ""}`}
            >
              {o.id ? <FolderGlyph color={o.color} size={17} /> : <Inbox size={15} className="flex-none text-muted" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">
                {o.name}
                {o.parent && q.trim() ? <span className="ml-1.5 text-[12px] text-faint">in {o.parent}</span> : null}
              </span>
              {here ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                  <Check size={13} strokeWidth={2.5} aria-hidden /> Current
                </span>
              ) : null}
            </li>
          );
        })}
        {org === undefined ? <li className="px-2 py-3 text-sm text-muted">Loading folders…</li> : null}
        {org && !options.length ? <li className="px-2 py-3 text-sm text-muted">No folders match “{q.trim()}”.</li> : null}
      </ul>
    </>
  );
}
