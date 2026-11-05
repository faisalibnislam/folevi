"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CornerLeftUp, FolderPlus, Inbox, Search } from "lucide-react";
import { flattenFolders, folderAncestors, folderMoveProblem, type WireScope } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { folderMoveMessage, useFolderActions, useFolderTree } from "@/lib/app/folders";
import { Dialog } from "@/components/ui/Dialog";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import type { FolderTarget } from "./noteActions";

interface Option {
  /** "new": the row that makes a folder (named after the search, or named next) and picks it. */
  id: string | null | "new";
  name: string;
  color: string | null;
  /** The folders above it ("Work / Clients"), shown while searching and read out to screen readers. */
  path: string | null;
  /** Its level in the tree (0 at the top level). */
  depth: number;
  /** Why it can't be picked (moving a folder into itself, a subfolder, or too deep). */
  blocked?: string;
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

/**
 * The folder search and list (also the Folder side of a note's Move dialog, the Move folder dialog and the
 * Copy to dialog). Folders show as a tree; while searching each match says where it is. The last row makes a
 * new folder at the top level and picks it: "New folder “<search>”" while searching for a name no folder has,
 * else "New folder…", which turns the field into the new folder's name (Enter makes it).
 */
export function FolderPicker({
  open,
  onClose,
  onPick,
  currentFolderId,
  movingFolderId,
  scope: scopeOverride,
  closeOnPick = true,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (folder: FolderTarget) => void;
  currentFolderId?: string | null;
  /** Picking a new place for this folder: the first choice is the top level, and it can't go inside itself. */
  movingFolderId?: string;
  /** Whose folders to list (default: the current Personal or workspace). */
  scope?: WireScope;
  /** Close once a folder is picked (a picker inside a bigger form keeps it open). */
  closeOnPick?: boolean;
}) {
  const { scope: here, canEdit } = useAppState();
  const scope = scopeOverride ?? here;
  const org = useFolderTree(open ? scope : "skip");
  const folderActions = useFolderActions();
  const [q, setQ] = useState("");
  // Naming a new folder: the field is its name, and Enter makes it and picks it.
  const [naming, setNaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const baseId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setNaming(false);
    }
  }, [open]);

  const options = useMemo<Option[]>(() => {
    const folders = org?.folders ?? [];
    const all: Option[] = [
      movingFolderId
        ? { id: null, name: "Top level", color: null, path: null, depth: 0 }
        : { id: null, name: "No folder (Drafts)", color: null, path: null, depth: 0 },
      ...flattenFolders(folders).map(({ folder: f, depth }) => {
        const problem = movingFolderId ? folderMoveProblem(folders, movingFolderId, f.id) : null;
        return {
          id: f.id,
          name: f.name,
          color: f.color,
          path: depth ? folderAncestors(folders, f.id).map((a) => a.name).join(" / ") : null,
          depth,
          blocked: problem ? folderMoveMessage(problem) : undefined,
        };
      }),
    ];
    const needle = q.trim().toLocaleLowerCase();
    const shown = needle ? all.filter((o) => o.name.toLocaleLowerCase().includes(needle) || (o.id === null && (movingFolderId ? "top level" : "drafts").includes(needle))) : all;
    if (!canEdit || !org) return shown;
    // A search for a name no folder has offers to make it.
    const named = needle && !folders.some((f) => f.name.trim().toLocaleLowerCase() === needle) ? q.trim() : "";
    return [...shown, { id: "new" as const, name: named ? `New folder “${named}”` : "New folder…", color: null, path: named || null, depth: 0 }];
  }, [org, q, movingFolderId, canEdit]);

  const current = Math.min(active, Math.max(0, options.length - 1));
  const isCurrent = (o: Option) => currentFolderId !== undefined && o.id !== "new" && o.id === currentFolderId;
  const unavailable = (o: Option) => isCurrent(o) || Boolean(o.blocked);
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(optionId(current))}`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const make = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const id = folderActions.create(clean, null, scope);
    if (closeOnPick) onClose();
    onPick({ id, name: clean });
  };

  const pick = (o: Option | undefined) => {
    if (!o || unavailable(o)) return;
    if (o.id === "new") {
      if (o.path) return make(o.path);
      setNaming(true);
      setQ("");
      inputRef.current?.focus();
      return;
    }
    if (closeOnPick) onClose();
    onPick({ id: o.id, name: o.id ? o.name : movingFolderId ? "the top level" : "Drafts" });
  };

  return (
    <>
      <label htmlFor={`${baseId}-q`} className="sr-only">
        {naming ? "New folder name" : "Search folders"}
      </label>
      <div className="relative">
        {naming ? (
          <FolderPlus size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        ) : (
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        )}
        <input
          ref={inputRef}
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
            if (naming) {
              if (e.key === "Enter") {
                e.preventDefault();
                make(q);
              }
              return;
            }
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
          placeholder={naming ? "Name the new folder" : "Search folders"}
          className="ui-input h-10 w-full rounded-chip pl-8 pr-3 text-callout"
        />
      </div>
      {naming ? (
        <div className="mt-3 flex items-center justify-between gap-3 px-2 py-2 text-subheadline text-muted">
          <span>{q.trim() ? `Press Enter to make “${q.trim()}” and move there.` : "Type a name, then press Enter."}</span>
          <button type="button" onClick={() => { setNaming(false); setQ(""); inputRef.current?.focus(); }} className="rounded-chip px-2 py-1 text-heading hover:bg-accent-soft">
            Back to folders
          </button>
        </div>
      ) : null}
      <ul ref={listRef} hidden={naming} id={`${baseId}-list`} role="listbox" aria-label="Folders" aria-busy={org === undefined} className="mt-3 max-h-[min(360px,50dvh)] space-y-0.5 overflow-y-auto">
        {options.map((o, i) => {
          const here = isCurrent(o);
          const searching = Boolean(q.trim());
          return (
            <li
              key={o.id ?? "none"}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              aria-disabled={unavailable(o) || undefined}
              data-highlighted={i === current}
              title={o.blocked}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              style={o.depth && !searching ? { paddingLeft: `calc(0.5rem + ${o.depth * 1.25}rem)` } : undefined}
              className={`ui-menu-item cursor-pointer ${unavailable(o) ? "cursor-default opacity-60" : ""}`}
            >
              {o.id === "new" ? (
                <FolderPlus size={15} className="flex-none text-muted" aria-hidden />
              ) : o.id ? (
                <FolderGlyph color={o.color} size={17} />
              ) : movingFolderId ? (
                <CornerLeftUp size={15} className="flex-none text-muted" aria-hidden />
              ) : (
                <Inbox size={15} className="flex-none text-muted" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">
                {o.name}
                {o.path && o.id !== "new" ? searching ? <span className="ml-1.5 text-footnote text-faint">in {o.path}</span> : <span className="sr-only">, in {o.path}</span> : null}
              </span>
              {here ? (
                <span className="inline-flex items-center gap-1 text-footnote text-muted">
                  <Check size={13} strokeWidth={2.5} aria-hidden /> Current
                </span>
              ) : null}
            </li>
          );
        })}
        {org === undefined ? <li className="px-2 py-3 text-subheadline text-muted">Loading folders…</li> : null}
        {org && !options.some((o) => o.id !== "new") && q.trim() ? <li className="px-2 py-3 text-subheadline text-muted">No folders match “{q.trim()}”.</li> : null}
      </ul>
    </>
  );
}

/** Picks a new place for a folder (with everything inside it): another folder, or the top level. */
export function MoveFolderDialog({
  open,
  onClose,
  folder,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  folder: { id: string; name: string; parentFolderId: string | null };
  onPick: (parent: FolderTarget) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={`Move “${folder.name}”`} description="Choose a folder to put it in, or move it to the top level. Its notes and subfolders go with it." size="sm">
      <FolderPicker open={open} onClose={onClose} onPick={onPick} currentFolderId={folder.parentFolderId} movingFolderId={folder.id} />
    </Dialog>
  );
}
