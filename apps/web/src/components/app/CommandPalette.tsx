"use client";

import { useQuery } from "convex/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, CheckSquare, FileText, House as Home, Moon, Plus, Search, Settings, Sun, Trash2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Kbd } from "@/components/ui/Button";
import { useCreateDocument } from "./useCreateDocument";
import { Highlight } from "./Highlight";
import { formatRelative } from "@/lib/format";

type Item =
  | { kind: "action"; id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void }
  | { kind: "doc"; id: string; title: string; icon: string | null; snippet?: string; updatedAt: number };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ⌘K palette: recent documents, full-text search with highlighted matches, and actions (combobox pattern). */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace, appearance, setAppearance } = useAppState();
  const { navigate } = useAppRouter();
  const createDocument = useCreateDocument();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 120);
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [filters, setFilters] = useState<{ folderId?: string; tagId?: string; creatorId?: string; updated?: "7" | "30" | "365" }>({});
  const org = useQuery(api.organization.sidebar, open ? { workspaceId: workspace.id } : "skip");
  const members = useQuery(api.workspaces.members, open ? { workspaceId: workspace.id } : "skip");
  const recent = useQuery(api.documents.recent, open ? { workspaceId: workspace.id, limit: 8 } : "skip");
  // Coarse "updated after" so the query stays cacheable.
  const updatedAfter = filters.updated ? Math.floor((Date.now() - Number(filters.updated) * 86_400_000) / 3_600_000) * 3_600_000 : undefined;
  const results = useQuery(
    api.search.documents,
    open && debounced ? { workspaceId: workspace.id, query: debounced, limit: 20, folderId: filters.folderId, tagId: filters.tagId, creatorId: filters.creatorId, updatedAfter } : "skip",
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      setQuery("");
      setActive(0);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const actions: Item[] = useMemo(
    () => [
      { kind: "action", id: "new", label: "New document", hint: "⌘⌥N", icon: <Plus size={16} />, run: () => void createDocument({}) },
      { kind: "action", id: "tasks", label: "Go to Tasks · Today", icon: <CheckSquare size={16} />, run: () => navigate("/tasks/today") },
      { kind: "action", id: "calendar", label: "Go to Calendar", icon: <CalendarDays size={16} />, run: () => navigate("/calendar") },
      { kind: "action", id: "all", label: "Go to Home", icon: <Home size={16} />, run: () => navigate("/documents") },
      { kind: "action", id: "trash", label: "Open Trash", icon: <Trash2 size={16} />, run: () => navigate("/trash") },
      { kind: "action", id: "settings", label: "Open Settings", icon: <Settings size={16} />, run: () => navigate("/settings/account") },
      {
        kind: "action",
        id: "theme",
        label: appearance === "dark" ? "Switch to light appearance" : "Switch to dark appearance",
        icon: appearance === "dark" ? <Sun size={16} /> : <Moon size={16} />,
        run: () => setAppearance(appearance === "dark" ? "light" : "dark"),
      },
    ],
    [createDocument, navigate, appearance, setAppearance],
  );

  const q = query.trim().toLowerCase();
  const items: Item[] = useMemo(() => {
    const matchingActions = q ? actions.filter((a) => a.kind === "action" && a.label.toLowerCase().includes(q)) : actions.slice(0, 4);
    const docs: Item[] = debounced
      ? (results ?? []).map((r) => ({ kind: "doc" as const, id: r.id, title: r.title, icon: r.icon, snippet: r.snippet, updatedAt: r.updatedAt }))
      : (recent ?? []).map((r) => ({ kind: "doc" as const, id: r.id, title: r.title, icon: r.icon, updatedAt: r.updatedAt }));
    return [...docs, ...matchingActions];
  }, [q, actions, debounced, results, recent]);

  useEffect(() => setActive(0), [debounced]);

  const run = (item: Item) => {
    onClose();
    if (item.kind === "action") item.run();
    else navigate(`/d/${item.id}`);
  };

  // Enter pressed while the search for what was typed is still in flight opens the top result once
  // it arrives (fast typists shouldn't get a stale "recent" document or nothing at all).
  const settled = !query.trim() || (debounced === query.trim() && results !== undefined);
  const [pendingEnter, setPendingEnter] = useState(false);
  useEffect(() => {
    if (!pendingEnter || !settled) return;
    setPendingEnter(false);
    if (items[0]) run(items[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, settled, items]);

  const docCount = items.filter((i) => i.kind === "doc").length;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Search and commands"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-[22px] bg-raised p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-[var(--color-scrim)] backdrop:backdrop-blur-[4px] open:animate-[folio-rise_160ms_var(--ease-folio)]"
    >
      {open ? (
        <div>
          <div className="flex items-center gap-3 px-5 shadow-[inset_0_-1px_0_var(--color-line)]">
            <Search size={18} className="text-ember" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              aria-label="Search documents or type a command"
              placeholder="Search documents or type a command…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (!settled) setPendingEnter(true);
                  else if (items[active]) run(items[active]!);
                }
              }}
              className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--color-ink-faint)]"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 px-5 py-2.5 text-xs shadow-[inset_0_-1px_0_var(--color-line)]" role="group" aria-label="Search filters">
            <select aria-label="Folder" value={filters.folderId ?? ""} onChange={(e) => setFilters({ ...filters, folderId: e.target.value || undefined })} className="ui-well h-7 rounded-full px-2.5 text-muted">
              <option value="">Any folder</option>
              {org?.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select aria-label="Tag" value={filters.tagId ?? ""} onChange={(e) => setFilters({ ...filters, tagId: e.target.value || undefined })} className="ui-well h-7 rounded-full px-2.5 text-muted">
              <option value="">Any tag</option>
              {org?.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.name}
                </option>
              ))}
            </select>
            <select aria-label="Created by" value={filters.creatorId ?? ""} onChange={(e) => setFilters({ ...filters, creatorId: e.target.value || undefined })} className="ui-well h-7 rounded-full px-2.5 text-muted">
              <option value="">Anyone</option>
              {members?.members.map((m) => (
                <option key={m.profileId} value={m.profileId}>
                  {m.isYou ? "Me" : m.displayName}
                </option>
              ))}
            </select>
            <select aria-label="Updated" value={filters.updated ?? ""} onChange={(e) => setFilters({ ...filters, updated: (e.target.value || undefined) as typeof filters.updated })} className="ui-well h-7 rounded-full px-2.5 text-muted">
              <option value="">Any time</option>
              <option value="7">Past week</option>
              <option value="30">Past month</option>
              <option value="365">Past year</option>
            </select>
            <span className="ml-auto text-faint">{workspace.name}</span>
          </div>
          <div className="max-h-[55vh] overflow-y-auto p-2">
            {debounced && results === undefined ? <p className="px-3 py-2 text-sm text-muted">Searching…</p> : null}
            {debounced && results?.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No documents match “{debounced}”.</p> : null}
            <p className="ui-caps px-3 pb-1.5 pt-2">{debounced ? "Documents" : "Recent"}</p>
            <ul id={listId} role="listbox" aria-label="Results">
              {items.map((item, i) => {
                const selected = i === active;
                const cls = `flex cursor-pointer items-start gap-3 rounded-[16px] px-3 py-2.5 transition-colors ${selected ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_18%,transparent)]" : ""}`;
                const header =
                  i === docCount && item.kind === "action" ? (
                    <li role="presentation" className="ui-caps px-3 pb-1.5 pt-3">
                      Actions
                    </li>
                  ) : null;
                return (
                  <FragmentWithHeader key={`${item.kind}-${item.id}`} header={header}>
                    <li id={`${listId}-${i}`} role="option" aria-selected={selected} className={cls} onMouseEnter={() => setActive(i)} onClick={() => run(item)}>
                      {item.kind === "doc" ? (
                        <>
                          <span className="mt-0.5 w-5 flex-none text-center" aria-hidden>
                            {item.icon ?? <FileText size={16} className="inline text-muted" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              <Highlight text={item.title || "Untitled"} query={debounced} />
                            </span>
                            {item.snippet ? (
                              <span className="line-clamp-2 block text-xs text-muted">
                                <Highlight text={item.snippet} query={debounced} />
                              </span>
                            ) : (
                              <span className="block text-xs text-faint">Edited {formatRelative(item.updatedAt)}</span>
                            )}
                          </span>
                          {selected ? <ArrowRight size={14} className="mt-1" aria-hidden /> : null}
                        </>
                      ) : (
                        <>
                          <span className="mt-0.5 text-muted" aria-hidden>
                            {item.icon}
                          </span>
                          <span className="flex-1 text-sm">{item.label}</span>
                          {item.hint ? <span className="text-xs text-faint">{item.hint}</span> : null}
                        </>
                      )}
                    </li>
                  </FragmentWithHeader>
                );
              })}
            </ul>
          </div>
          <p className="sr-only" aria-live="polite">
            {debounced && results ? `${results.length} result${results.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      ) : null}
    </dialog>
  );
}

function FragmentWithHeader({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {header}
      {children}
    </>
  );
}
