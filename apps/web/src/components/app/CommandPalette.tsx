"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { ArrowRight, CalendarDays, CheckSquare, FileDiff, FileText, House as Home, Layers, Moon, Plus, Search, Settings, Sun, Trash2 } from "lucide-react";
import { fileTextLabel, flattenFolders, type FileTextSource } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useFolderTree } from "@/lib/app/folders";
import { openNextInNewTab } from "@/lib/app/tabs";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Kbd } from "@/components/ui/Button";
import { useCreateDocument } from "./useCreateDocument";
import { useShell } from "./Shell";
import { useAiEnabled } from "@/components/ai/useAi";
import { Highlight } from "./Highlight";
import { formatRelative } from "@/lib/format";
import { t } from "@/i18n";
import { Select } from "@/components/ui/Select";
import { useIphoneApp } from "@/lib/iphone";

type Item =
  | { kind: "action"; id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void }
  | { kind: "doc"; id: string; title: string; icon: string | null; snippet?: string; updatedAt?: number; place?: string; meaning?: boolean; match?: { source: FileTextSource; page: number | null; blockId: string } | null };

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
  const { scope, workspace, appearance, setAppearance } = useAppState();
  const { navigate } = useAppRouter();
  const createDocument = useCreateDocument();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 120);
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [filters, setFilters] = useState<{ folderId?: string; tagId?: string; creatorId?: string; updated?: "7" | "30" | "365" }>({});
  // Search, recents and filters follow the current context (Personal or a workspace).
  const org = useFolderTree(open ? scope : "skip");
  // Personal has no members: everything in it is yours, so the "Created by" filter is for workspaces.
  const members = useQuery(api.workspaces.members, open && workspace ? { workspaceId: workspace.id } : "skip");
  const recent = useQuery(api.documents.recent, open ? { scope, limit: 8 } : "skip");
  // Coarse "updated after" so the query stays cacheable.
  const updatedAfter = filters.updated ? Math.floor((Date.now() - Number(filters.updated) * 86_400_000) / 3_600_000) * 3_600_000 : undefined;
  // "All places": Personal and every workspace at once (no folder, tag or person filters: they belong to one place).
  const [everywhere, setEverywhere] = useState(false);
  const workspaces = useQuery(api.workspaces.mine, open ? {} : "skip");
  const manyPlaces = (workspaces?.length ?? 0) > 0;
  const allPlaces = everywhere && manyPlaces;
  const here = useQuery(
    api.search.documents,
    open && debounced && !allPlaces ? { scope, query: debounced, limit: 20, folderId: filters.folderId, tagId: filters.tagId, creatorId: filters.creatorId, updatedAfter } : "skip",
  );
  const all = useQuery(api.search.everywhere, open && debounced && allPlaces ? { query: debounced, limit: 24 } : "skip");
  const results = allPlaces ? all : here;
  // Search by meaning (plans with the notes index): extra notes about what was typed, after a pause.
  const meaningOn = useQuery(api.search.meaningAvailable, open ? { scope } : "skip");
  const byMeaning = useAction(api.search.byMeaning);
  const slow = useDebounced(query.trim(), 450);
  const [meaning, setMeaning] = useState<{ q: string; notes: { id: string; title: string; snippet: string }[] } | null>(null);
  useEffect(() => {
    if (!open || !meaningOn || allPlaces || slow.length < 3) return;
    let live = true;
    byMeaning({ scope, query: slow }).then(
      (notes) => live && setMeaning({ q: slow, notes }),
      () => live && setMeaning({ q: slow, notes: [] }),
    );
    return () => {
      live = false;
    };
  }, [open, meaningOn, allPlaces, slow, scope, byMeaning]);

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

  const { openAsk } = useShell();
  const aiOn = useAiEnabled();
  const actions: Item[] = useMemo(
    () => [
      { kind: "action", id: "new", label: "New document", hint: "⌘⌥N", icon: <Plus size={16} />, run: () => void createDocument({}) },
      { kind: "action", id: "tasks", label: "Go to Tasks · Today", icon: <CheckSquare size={16} />, run: () => navigate("/tasks/today") },
      { kind: "action", id: "calendar", label: "Go to Calendar", icon: <CalendarDays size={16} />, run: () => navigate("/calendar") },
      { kind: "action", id: "review", label: "Go to Reviews", icon: <Layers size={16} />, run: () => navigate("/review") },
      { kind: "action", id: "changes", label: "Go to Changes", icon: <FileDiff size={16} />, run: () => navigate("/changes") },
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
      ? (results ?? []).map((r) => ({ kind: "doc" as const, id: r.id, title: r.title, icon: r.icon, snippet: r.snippet, updatedAt: r.updatedAt, place: "place" in r ? (r.place as { name: string }).name : undefined, match: r.match }))
      : (recent ?? []).map((r) => ({ kind: "doc" as const, id: r.id, title: r.title, icon: r.icon, updatedAt: r.updatedAt }));
    // By meaning: only notes the keyword search didn't already find, for what's typed now.
    const seen = new Set(docs.map((d) => d.id));
    const extra: Item[] =
      debounced && meaning && meaning.q === debounced && !allPlaces
        ? meaning.notes.filter((n) => !seen.has(n.id)).map((n) => ({ kind: "doc" as const, id: n.id, title: n.title, icon: null, snippet: n.snippet, meaning: true }))
        : [];
    docs.push(...extra);
    // Ask AI: with a query typed, "Ask AI: …" sends it straight to the assistant.
    const askAi: Item = {
      kind: "action",
      id: "ask-ai",
      label: query.trim() ? `Ask Foli AI: “${query.trim()}”` : "Ask Foli AI about your notes",
      hint: "⌘J",
      icon: <AiIcon size={16} />,
      run: () => openAsk(query.trim() || undefined),
    };
    return [...docs, ...(aiOn ? [askAi] : []), ...matchingActions];
  }, [q, query, actions, debounced, results, recent, openAsk, aiOn, meaning, allPlaces]);

  useEffect(() => setActive(0), [debounced]);

  const run = (item: Item) => {
    onClose();
    if (item.kind === "action") item.run();
    else {
      openNextInNewTab();
      // Found in a PDF, an image or handwriting: the note opens at that block.
      navigate(`/d/${item.id}${item.match ? `#block-${item.match.blockId}` : ""}`);
    }
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
  // The iPhone app: a full-screen search, the field at the top with Cancel, results as list rows.
  const iphone = useIphoneApp();

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
      className={
        iphone
          ? "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-canvas p-0 pt-[env(safe-area-inset-top)] text-ink backdrop:bg-transparent open:animate-[iphone-fade-in_180ms_ease-out]"
          : "m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden ui-pop rounded-panel p-0 text-ink backdrop:bg-transparent shadow-[var(--glass-edge),0_16px_48px_rgb(0_0_0/0.1),0_2px_8px_rgb(0_0_0/0.1)] open:animate-[folio-rise_160ms_var(--ease-folio)]"
      }
    >
      {open ? (
        <div className={iphone ? "flex h-full flex-col" : undefined}>
          <div className={iphone ? "flex items-center gap-2 px-4 pb-2 pt-2" : "flex items-center gap-3 px-5 shadow-[inset_0_-1px_0_var(--color-line)]"}>
            <span className={iphone ? "flex h-11 min-w-0 flex-1 items-center gap-2 rounded-panel bg-[color-mix(in_oklab,var(--color-ink)_6.5%,transparent)] px-3" : "contents"}>
            <Search size={iphone ? 19 : 18} className={iphone ? "flex-none text-faint" : "text-heading"} aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              aria-label="Search documents or type a command"
              placeholder={iphone ? "Search notes and commands" : "Search documents or type a command…"}
              enterKeyHint="search"
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
              className={iphone ? "h-full min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-[var(--color-ink-faint)]" : "h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--color-ink-faint)]"}
            />
            </span>
            {iphone ? (
              <button type="button" onClick={onClose} className="h-11 flex-none px-1 text-[17px] text-heading">
                Cancel
              </button>
            ) : (
              <Kbd>Esc</Kbd>
            )}
          </div>
          <div className={iphone ? "flex flex-none items-center gap-1.5 overflow-x-auto px-4 pb-2 text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:flex-none" : "flex flex-wrap items-center gap-1.5 px-5 py-2.5 text-xs shadow-[inset_0_-1px_0_var(--color-line)]"} role="group" aria-label="Search filters">
            <Select aria-label="Folder" disabled={allPlaces} value={filters.folderId ?? ""} onChange={(e) => setFilters({ ...filters, folderId: e.target.value || undefined })} className="ui-well h-7 rounded-chip px-2.5 text-muted">
              <option value="">Any folder</option>
              {flattenFolders(org?.folders ?? []).map(({ folder: f, depth }) => (
                <option key={f.id} value={f.id}>
                  {"\u00a0\u00a0\u00a0".repeat(depth)}
                  {f.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Tag" disabled={allPlaces} value={filters.tagId ?? ""} onChange={(e) => setFilters({ ...filters, tagId: e.target.value || undefined })} className="ui-well h-7 rounded-chip px-2.5 text-muted">
              <option value="">Any tag</option>
              {org?.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.name}
                </option>
              ))}
            </Select>
            {workspace ? (
              <Select aria-label="Created by" disabled={allPlaces} value={filters.creatorId ?? ""} onChange={(e) => setFilters({ ...filters, creatorId: e.target.value || undefined })} className="ui-well h-7 rounded-chip px-2.5 text-muted">
                <option value="">Anyone</option>
                {members?.members.map((m) => (
                  <option key={m.profileId} value={m.profileId}>
                    {m.isYou ? "Me" : m.displayName}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select aria-label="Updated" value={filters.updated ?? ""} onChange={(e) => setFilters({ ...filters, updated: (e.target.value || undefined) as typeof filters.updated })} className="ui-well h-7 rounded-chip px-2.5 text-muted">
              <option value="">Any time</option>
              <option value="7">Past week</option>
              <option value="30">Past month</option>
              <option value="365">Past year</option>
            </Select>
            {manyPlaces ? (
              <Select aria-label="Where" value={allPlaces ? "all" : "here"} onChange={(e) => setEverywhere(e.target.value === "all")} className="ui-well ml-auto h-7 rounded-chip px-2.5 text-muted">
                <option value="here">{workspace ? workspace.name : "Personal"}</option>
                <option value="all">All places</option>
              </Select>
            ) : (
              <span className="ml-auto text-faint">{workspace ? workspace.name : "Personal"}</span>
            )}
          </div>
          <div className={iphone ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(env(safe-area-inset-bottom)+16px)]" : "max-h-[55vh] overflow-y-auto p-2"}>
            {debounced && results === undefined ? <p className="px-3 py-2 text-sm text-muted">Searching…</p> : null}
            {debounced && results?.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No documents match “{debounced}”.</p> : null}
            <p className="ui-caps px-3 pb-1.5 pt-2">{debounced ? "Documents" : "Recent"}</p>
            <ul id={listId} role="listbox" aria-label="Results">
              {items.map((item, i) => {
                const selected = i === active;
                const cls = iphone
                  ? `flex cursor-pointer items-start gap-3 rounded-panel px-3 py-3 transition-colors active:bg-[var(--liquid-press)] [&_.text-sm]:text-[17px] [&_.text-xs]:text-[13px] ${selected && query.trim() ? "bg-[var(--liquid-active)]" : ""}`
                  : `flex cursor-pointer items-start gap-3 rounded-chip px-3 py-2.5 transition-colors ${selected ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_18%,transparent)]" : ""}`;
                const prev = items[i - 1];
                const header =
                  i === docCount && item.kind === "action" ? (
                    <li role="presentation" className="ui-caps px-3 pb-1.5 pt-3">
                      Actions
                    </li>
                  ) : item.kind === "doc" && item.meaning && !(prev?.kind === "doc" && prev.meaning) ? (
                    <li role="presentation" className="ui-caps px-3 pb-1.5 pt-3">
                      By meaning
                    </li>
                  ) : null;
                return (
                  <FragmentWithHeader key={`${item.kind}-${item.id}`} header={header}>
                    <li id={`${listId}-${i}`} role="option" aria-selected={selected} className={cls} onMouseEnter={() => setActive(i)} onClick={() => run(item)}>
                      {item.kind === "doc" ? (
                        <>
                          <span className="mt-0.5 w-5 flex-none text-center" aria-hidden>
                            <FileText size={16} className="inline text-muted" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              <Highlight text={item.title || "Untitled"} query={debounced} />
                            </span>
                            {item.snippet ? (
                              <span className="line-clamp-2 block text-xs text-muted">
                                {item.place ? <span className="text-faint">{item.place} · </span> : null}
                                {item.match ? <span className="text-faint">{fileTextLabel(item.match.source, item.match.page)} · </span> : null}
                                <Highlight text={item.snippet} query={debounced} />
                              </span>
                            ) : item.updatedAt ? (
                              <span className="block text-xs text-faint">
                                {item.place ? `${item.place} · ` : ""}Edited {formatRelative(item.updatedAt)}
                              </span>
                            ) : null}
                          </span>
                          {selected && !iphone ? <ArrowRight size={14} className="mt-1" aria-hidden /> : null}
                        </>
                      ) : (
                        <>
                          <span className="mt-0.5 text-muted" aria-hidden>
                            {item.icon}
                          </span>
                          <span className="flex-1 text-sm">{item.label}</span>
                          {item.hint && !iphone ? <span className="text-xs text-faint">{item.hint}</span> : null}
                        </>
                      )}
                    </li>
                  </FragmentWithHeader>
                );
              })}
            </ul>
          </div>
          <p className="sr-only" aria-live="polite">
            {debounced && results ? t("palette.results", { count: results.length }) : ""}
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
