"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, CircleCheck, ExternalLink, FileText, House, Image as ImageIcon, List, MessageSquare, Mic, PanelLeft, Paperclip, Search, X } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { CommentsOverview, type CommentThread } from "./Comments";
import { flattenTree, plainText, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { useDocumentBlocks, useLocalStorage } from "@/lib/hooks/useEngine";
import { IconButton } from "@/components/ui/Button";
import { Outline } from "./Outline";
import { WorkspaceMenu } from "@/components/app/WorkspaceMenu";
import { SidebarSearch, SidebarTopBar } from "@/components/app/Sidebar";

export type DocSidebarTab = "contents" | "comments" | "tasks" | "attachments" | "find";

const TABS: { id: DocSidebarTab; label: string; icon: React.ReactNode }[] = [
  { id: "contents", label: "Table of contents", icon: <List size={15} /> },
  { id: "comments", label: "Comments", icon: <MessageSquare size={15} /> },
  { id: "tasks", label: "Tasks in this page", icon: <CircleCheck size={15} /> },
  { id: "attachments", label: "Attachments and links", icon: <Paperclip size={15} /> },
  { id: "find", label: "Find in page", icon: <Search size={15} /> },
];

export interface Crumb {
  href: string;
  label: string;
  icon?: string | null;
}

/**
 * The document page's own sidebar (it replaces the app navigation while a page is open): where the page
 * lives, then four tools for the page itself: contents, tasks, attachments & links, and find.
 */
export function DocumentSidebar({
  documentId,
  title,
  trail,
  editor,
  readOnly,
  onJump,
  onHide,
  onNavigate,
  request,
  onOpenThread,
  focusThreadId = null,
}: {
  /** Switch to a tab from outside (opening comments from the note): applied whenever `at` changes. */
  request?: { tab: DocSidebarTab; at: number } | null;
  /** A thread chosen in the Comments tab: jump to its block and open it there. */
  onOpenThread?: (thread: CommentThread) => void;
  /** A thread to open in the Comments tab (one on the whole note or a deleted block). */
  focusThreadId?: string | null;
  documentId: string;
  title: string;
  /** Workspace › folder(s) › parent pages, outermost first. */
  trail: Crumb[];
  editor: Editor | null;
  readOnly: boolean;
  onJump: (blockId: string) => void;
  onHide: () => void;
  /** Called after following a link (closes the drawer on phones). */
  onNavigate?: () => void;
}) {
  const [tab, setTab] = useLocalStorage<DocSidebarTab>("folevi:doc-sidebar-tab", "contents");
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = TABS.some((t) => t.id === tab) ? tab : "contents";
  useEffect(() => {
    if (request) setTab(request.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new request switches tabs
  }, [request?.at]);
  // An unread open thread puts a dot on the Comments tab.
  const threads = useQuery(api.comments.threads, { documentId });
  const unread = Boolean(threads?.threads.some((t) => t.unread && t.status === "open"));
  return (
    <div className="flex h-full flex-col">
      {/* On phones the sidebar is a drawer and the tab strip is hidden, so it carries its own controls. */}
      {onNavigate ? (
        <div className="flex h-[52px] flex-none items-center gap-1 px-3">
          <IconButton label="Hide sidebar" shortcut="⌘\" onClick={onHide}>
            <PanelLeft size={16} aria-hidden />
          </IconButton>
          <AppLink href="/documents" onClick={onNavigate} aria-label="Home" title="Home" className="ui-btn ui-btn-ghost grid h-8 w-8 place-items-center rounded-[6px] p-0 text-muted hover:text-heading">
            <House size={16} aria-hidden />
          </AppLink>
        </div>
      ) : (
        <SidebarTopBar />
      )}

      {/* Search everywhere (⌘K), as in the app's sidebar. */}
      <div className="flex-none px-3 pb-2 pt-1">
        <SidebarSearch />
      </div>

      <div className="flex-none px-3 pb-3">
        {/* The note's name and where it lives, in a translucent card. */}
        <div className="rounded-[10px] bg-[var(--glass-hover)] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--glass-border)]">
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold leading-tight text-heading" title={title || "Untitled"}>
              {title || "Untitled"}
            </p>
            <nav aria-label="Breadcrumb" className="mt-1">
              <ol className="flex flex-wrap items-center gap-x-0.5 text-[11.5px] leading-5 text-muted">
                {trail.map((c, i) => (
                  <li key={`${c.href}-${i}`} className="flex min-w-0 items-center gap-0.5">
                    {i > 0 ? <ChevronRight size={11} className="flex-none text-faint" aria-hidden /> : <span className="flex-none">In</span>}
                    <AppLink href={c.href} onClick={onNavigate} className="max-w-[9.5rem] truncate rounded-[6px] px-1 transition-colors hover:bg-accent-soft hover:text-heading">
                                            {c.label}
                    </AppLink>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </div>
      </div>

      <PageTree documentId={documentId} onNavigate={onNavigate} />

      <div className="flex-none px-3">
        <div role="tablist" aria-label="Page tools" className="ui-seg ui-well">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls={`${baseId}-panel`}
              aria-label={t.id === "comments" && unread ? "Comments (unread)" : t.label}
              title={t.label}
              tabIndex={active === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                const next = (i + dir + TABS.length) % TABS.length;
                setTab(TABS[next]!.id);
                tabRefs.current[next]?.focus();
              }}
              className="!min-h-8 !px-0"
            >
              <span aria-hidden className="relative">
                {t.icon}
                {t.id === "comments" && unread ? <span className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-[4px] bg-coral" /> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`} className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-4">
        {active === "contents" ? <ContentsPanel documentId={documentId} title={title} onJump={onJump} /> : null}
        {active === "comments" ? (
          <>
            <PanelTitle>Comments</PanelTitle>
            <CommentsOverview documentId={documentId} onOpenThread={(t) => onOpenThread?.(t)} focusThreadId={focusThreadId} />
          </>
        ) : null}
        {active === "tasks" ? <TasksPanel documentId={documentId} editor={editor} readOnly={readOnly} onJump={onJump} /> : null}
        {active === "attachments" ? <AttachmentsPanel documentId={documentId} onJump={onJump} onNavigate={onNavigate} /> : null}
        {active === "find" ? <FindPanel editor={editor} /> : null}
      </div>
      <div className="flex-none px-2 pb-2">
        <WorkspaceMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function PanelTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold text-heading">{children}</h2>
      {aside}
    </div>
  );
}

function useBlocks(documentId: string): WireBlock[] {
  const { engine } = useAppState();
  // Re-renders only when this note's blocks change; the tree is ordered once per change.
  const blocks = useDocumentBlocks(engine, documentId);
  return useMemo(() => flattenTree(blocks).map(({ block }) => block), [blocks]);
}

/** Smooth scrolling, unless the person asked for less motion. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function ContentsPanel({ documentId, title, onJump }: { documentId: string; title: string; onJump: (id: string) => void }) {
  return (
    <>
      <PanelTitle>Table of contents</PanelTitle>
      <button
        type="button"
        onClick={() => (document.getElementById("doc-scroll") ?? document.getElementById("main"))?.scrollTo({ top: 0, behavior: scrollBehavior() })}
        className="mb-0.5 block w-full truncate rounded-[6px] bg-[var(--glass-hover)] px-3 py-1.5 text-left text-[13px] font-semibold text-heading transition-colors hover:bg-[var(--glass-hover)]"
      >
        {title || "Untitled"}
      </button>
      <Outline documentId={documentId} onJump={onJump} variant="panel" />
    </>
  );
}

function TasksPanel({ documentId, editor, readOnly, onJump }: { documentId: string; editor: Editor | null; readOnly: boolean; onJump: (id: string) => void }) {
  const todos = useBlocks(documentId).filter((b) => b.type === "todo");
  const done = todos.filter((b) => (b.props as { checked?: boolean }).checked).length;
  const toggle = (blockId: string) => {
    if (!editor || readOnly) return;
    editor.state.doc.forEach((n, offset) => {
      if (n.attrs.id !== blockId || !("checked" in n.attrs)) return;
      const checked = !n.attrs.checked;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(offset, undefined, { ...n.attrs, checked, completedAt: checked ? Date.now() : null }));
    });
  };
  return (
    <>
      <PanelTitle aside={todos.length ? <span className="text-[11.5px] tabular-nums text-muted">{done} of {todos.length} done</span> : null}>Tasks</PanelTitle>
      {!todos.length ? (
        <p className="px-1 text-[12.5px] leading-relaxed text-muted">Tasks inside this document will appear here. Type “[]” or use Insert → To-do to add one.</p>
      ) : (
        <ul className="space-y-0.5">
          {todos.map((b) => {
            const checked = Boolean((b.props as { checked?: boolean }).checked);
            const text = plainText(b.text) || "Untitled task";
            return (
              <li key={b.id} className="flex items-start gap-2 rounded-[6px] px-1.5 py-1 hover:bg-accent-soft/60">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`${checked ? "Mark as not done" : "Mark as done"}: ${text}`}
                  disabled={readOnly || !editor}
                  onClick={() => toggle(b.id)}
                  className={`mt-[3px] grid h-4 w-4 flex-none place-items-center rounded-[6px] border transition-colors ${checked ? "border-moss bg-moss text-white" : "border-line-strong bg-surface hover:border-moss"} disabled:cursor-default`}
                >
                  {checked ? (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
                      <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </button>
                <button type="button" onClick={() => onJump(b.id)} className={`min-w-0 flex-1 text-left text-[13px] leading-snug ${checked ? "text-muted line-through" : "text-ink"}`}>
                  {text}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function AttachmentsPanel({ documentId, onJump, onNavigate }: { documentId: string; onJump: (id: string) => void; onNavigate?: () => void }) {
  const blocks = useBlocks(documentId);
  const attachments = blocks
    .filter((b) => b.type === "image" || b.type === "file" || b.type === "audio")
    .map((b) => {
      const p = b.props as { name?: string; alt?: string; caption?: string; fileId?: string };
      const named = b.type === "file" || b.type === "audio";
      return { id: b.id, kind: b.type, name: named ? p.name || (b.type === "audio" ? "Audio recording" : "File") : p.caption || p.alt || "Image", uploading: !p.fileId && named };
    });
  const links: { key: string; blockId: string; label: string; href: string; internal: boolean }[] = [];
  for (const b of blocks) {
    const p = b.props as { url?: string; title?: string };
    if (b.type === "bookmark" && p.url) links.push({ key: `${b.id}-bm`, blockId: b.id, label: p.title || hostOf(p.url), href: p.url, internal: false });
    (b.text as InlineNode[]).forEach((n, i) => {
      if (n.type === "pageLink") links.push({ key: `${b.id}-${i}`, blockId: b.id, label: n.label || "Untitled", href: `/d/${n.documentId}`, internal: true });
      else if (n.type === "text") {
        const link = n.marks?.find((m) => m.type === "link") as { href?: string } | undefined;
        if (link?.href && /^https?:/i.test(link.href)) links.push({ key: `${b.id}-${i}`, blockId: b.id, label: n.text, href: link.href, internal: false });
      }
    });
  }
  return (
    <>
      <PanelTitle>Attachments</PanelTitle>
      {!attachments.length ? (
        <p className="mb-5 px-1 text-[12.5px] text-muted">Images and files in this page will appear here.</p>
      ) : (
        <ul className="mb-5 space-y-0.5">
          {attachments.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onJump(a.id)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-accent-soft/60">
                <span aria-hidden className="grid h-7 w-7 flex-none place-items-center rounded-[6px] bg-sunken text-muted">
                  {a.kind === "image" ? <ImageIcon size={14} /> : a.kind === "audio" ? <Mic size={14} /> : <Paperclip size={14} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PanelTitle>Links</PanelTitle>
      {!links.length ? (
        <p className="px-1 text-[12.5px] text-muted">Links and page links in this page will appear here.</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.key} className="ui-card rounded-[10px]">
              {l.internal ? (
                <AppLink href={l.href} onClick={onNavigate} className="flex items-center gap-2 px-2.5 py-2 text-[13px] hover:text-heading">
                  <FileText size={14} className="flex-none text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{l.label}</span>
                </AppLink>
              ) : (
                <a href={l.href} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2 px-2.5 py-2 text-[13px] hover:text-heading">
                  <ExternalLink size={14} className="flex-none text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.label}</span>
                    <span className="block truncate text-[11px] text-faint">{hostOf(l.href)}</span>
                  </span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface Match {
  from: number;
  to: number;
  snippet: { before: string; hit: string; after: string };
}

const OBJECT = "￼";

/** A short excerpt around a match that starts and ends on word boundaries. */
function snippetAround(text: string, at: number, length: number) {
  const clean = (t: string) => t.replaceAll(OBJECT, "…");
  let before = text.slice(Math.max(0, at - 32), at);
  if (at > 32) before = `…${before.slice(before.indexOf(" ") + 1)}`;
  let after = text.slice(at + length, at + length + 48);
  if (at + length + 48 < text.length) after = `${after.slice(0, Math.max(after.lastIndexOf(" "), 0))}…`;
  return { before: clean(before), hit: text.slice(at, at + length), after: clean(after) };
}

function findMatches(editor: Editor, query: string): Match[] {
  const q = query.toLocaleLowerCase();
  if (!q) return [];
  const out: Match[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Inline atoms (mentions, dates, page links) count as one object character, so string offsets map
    // straight onto document positions.
    const text = node.textBetween(0, node.content.size, undefined, OBJECT);
    const lower = text.toLocaleLowerCase();
    let at = lower.indexOf(q);
    while (at !== -1 && out.length < 500) {
      out.push({
        from: pos + 1 + at,
        to: pos + 1 + at + q.length,
        snippet: snippetAround(text, at, q.length),
      });
      at = lower.indexOf(q, at + Math.max(1, q.length));
    }
    return false;
  });
  return out;
}

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
function highlights(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === "function" ? css.highlights : null;
}

function FindPanel({ editor }: { editor: Editor | null }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [version, setVersion] = useState(0);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (!editor) return;
    // Searched again a moment after typing stops, not on every key (a long note takes a while to search).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 150);
    };
    editor.on("update", bump);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("update", bump);
    };
  }, [editor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = useMemo(() => (editor ? findMatches(editor, query.trim()) : []), [editor, query, version]);
  const current = matches.length ? Math.min(index, matches.length - 1) : -1;

  const rangeOf = useCallback(
    (m: Match): Range | null => {
      if (!editor) return null;
      try {
        const a = editor.view.domAtPos(m.from);
        const b = editor.view.domAtPos(m.to);
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        return r;
      } catch {
        return null;
      }
    },
    [editor],
  );

  // Paint every match, and the current one more strongly (CSS Custom Highlight API; no DOM changes).
  useEffect(() => {
    const reg = highlights();
    if (!reg) return;
    const H = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    const all = matches.map(rangeOf).filter((r): r is Range => r !== null);
    reg.set("folevi-find", new H(...all));
    const cur = current >= 0 ? rangeOf(matches[current]!) : null;
    reg.set("folevi-find-current", new H(...(cur ? [cur] : [])));
    return () => {
      reg.delete("folevi-find");
      reg.delete("folevi-find-current");
    };
  }, [matches, current, rangeOf]);

  const reveal = (i: number) => {
    if (!matches.length) return;
    const next = (i + matches.length) % matches.length;
    setIndex(next);
    const r = rangeOf(matches[next]!);
    const el = r?.startContainer instanceof Element ? r.startContainer : r?.startContainer.parentElement;
    el?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  };

  return (
    <>
      <PanelTitle>Find</PanelTitle>
      <label htmlFor={inputId} className="sr-only">
        Find text in this page
      </label>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              reveal(current + (e.shiftKey ? -1 : 1));
            } else if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          placeholder="Text in document"
          className="ui-input h-9 w-full rounded-[6px] pl-8 pr-8 text-sm"
          aria-describedby={`${inputId}-count`}
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[6px] text-faint hover:text-ink">
            <X size={13} aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-1 px-1">
        <p id={`${inputId}-count`} role="status" className="flex-1 text-[12px] text-muted">
          {!query.trim() ? "Type to search this page" : matches.length ? `${current + 1} of ${matches.length}${matches.length >= 500 ? "+" : ""}` : "No results in this page"}
        </p>
        <IconButton label="Previous match" onClick={() => reveal(current - 1)} disabled={!matches.length} className="!h-7 !w-7">
          <ChevronUp size={15} aria-hidden />
        </IconButton>
        <IconButton label="Next match" onClick={() => reveal(current + 1)} disabled={!matches.length} className="!h-7 !w-7">
          <ChevronDown size={15} aria-hidden />
        </IconButton>
      </div>
      {matches.length ? (
        <ul className="mt-2 space-y-0.5" aria-label="Matches">
          {matches.slice(0, 100).map((m, i) => (
            <li key={`${m.from}-${i}`}>
              <button
                type="button"
                onClick={() => reveal(i)}
                aria-current={i === current ? "true" : undefined}
                className={`block w-full rounded-[6px] px-2 py-1.5 text-left text-[12.5px] leading-snug text-muted transition-colors hover:bg-accent-soft/60 ${i === current ? "bg-accent-soft text-ink" : ""}`}
              >
                {m.snippet.before}
                <mark className="rounded-[4px] bg-marigold-soft px-0.5 text-ink">{m.snippet.hit}</mark>
                {m.snippet.after}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * The note and its nested pages as a small tree, the open one marked: one click moves between them (in the
 * same tab). Only for a note that has nested pages.
 */
function PageTree({ documentId, onNavigate }: { documentId: string; onNavigate?: () => void }) {
  const tree = useQuery(api.documents.pageTree, { documentId });
  if (!tree || tree.pages.length < 2) return null;
  return (
    <nav aria-label="Pages in this note" className="flex-none px-3 pb-3">
      <h2 className="ui-caps px-1 pb-1">Pages</h2>
      <ul className="max-h-[32vh] space-y-px overflow-y-auto">
        {tree.pages.map((p) => {
          const here = p.id === documentId;
          return (
            <li key={p.id}>
              <AppLink
                href={`/d/${p.id}`}
                onClick={onNavigate}
                aria-current={here ? "page" : undefined}
                className={`flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] pr-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-10 ${here ? "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading"}`}
                style={{ paddingLeft: `${0.5 + p.depth * 0.85}rem` }}
              >
                <FileText size={13} aria-hidden className="flex-none opacity-60" />
                <span className="truncate">{p.title || "Untitled"}</span>
              </AppLink>
            </li>
          );
        })}
        {tree.truncated ? <li className="px-2 py-1 text-xs text-muted">More pages than fit here. Open a page to see its own.</li> : null}
      </ul>
    </nav>
  );
}
