"use client";

import { useEffect, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2, Users } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MenuButton } from "@/components/ui/Menu";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { useConversationActions } from "./ConversationActions";

interface Row {
  id: string;
  title: string;
  pinned: boolean;
  lastMessageAt: number;
  /** Shared with the workspace (aiSharing.ts). */
  shared?: boolean;
  /** In a team workspace (so it can be shared). */
  workspace?: boolean;
}

/** A conversation someone else shared with the workspace (aiSharing.list). */
export interface SharedRow {
  id: string;
  title: string;
  by: string;
  lastMessageAt: number;
}

const ROW_LINK = "flex h-9 items-center gap-2 rounded-[6px] pl-2.5 text-[13.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11";
const rowTone = (active: boolean) => (active ? "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading");

/**
 * "Shared with you": conversations others in this workspace shared, that you can read (each opens
 * read-only). Only shown when there are some.
 */
export function SharedWithYou({ rows, activeId, onNavigate }: { rows: SharedRow[]; activeId: string | null; onNavigate?: () => void }) {
  if (!rows.length) return null;
  return (
    <section className="mb-3" aria-label="Shared with you">
      <p className="ui-caps px-2.5 pb-1">Shared with you</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.id}>
            <AppLink href={`/ai/${r.id}`} onClick={onNavigate} aria-current={r.id === activeId ? "page" : undefined} title={`Shared by ${r.by}`} className={`${ROW_LINK} pr-2.5 ${rowTone(r.id === activeId)}`}>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="max-w-[40%] flex-none truncate text-[11.5px] font-normal text-faint">{r.by}</span>
            </AppLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConversationRow({ row, active, onNavigate }: { row: Row; active: boolean; onNavigate?: () => void }) {
  const rename = useMutation(api.aiChat.rename);
  const setPinned = useMutation(api.aiChat.setPinned);
  const remove = useMutation(api.aiChat.remove);
  const toast = useToast();
  const { navigate } = useAppRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.title);
  const [deleting, setDeleting] = useState(false);
  const fail = (e: unknown) => toast.show(errorMessage(e), { tone: "error" });
  const actions = useConversationActions({ id: row.id, title: row.title, shared: row.shared === true, workspace: row.workspace === true });

  const save = () => {
    setEditing(false);
    const next = name.trim();
    if (next && next !== row.title) void rename({ conversationId: row.id, title: next }).catch(fail);
  };

  return (
    <li className="group/conv relative">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="px-1 py-0.5"
        >
          <label className="sr-only" htmlFor={`rename-${row.id}`}>
            Conversation name
          </label>
          <input
            id={`rename-${row.id}`}
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setName(row.title);
                setEditing(false);
              }
            }}
            className="ui-input h-8 w-full rounded-[6px] px-2.5 text-[13.5px]"
          />
        </form>
      ) : (
        <AppLink
          href={`/ai/${row.id}`}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={`${ROW_LINK} pr-2.5 group-focus-within/conv:pr-9 group-hover/conv:pr-9 pointer-coarse:pr-9 ${rowTone(active)}`}
        >
          <span className="min-w-0 flex-1 truncate">{row.title}</span>
          {row.shared ? (
            <span title="Shared with the workspace" className="flex-none text-faint">
              <Users size={12} aria-hidden />
              <span className="sr-only">Shared</span>
            </span>
          ) : null}
          <span className="flex-none text-[11.5px] font-normal text-faint group-hover/conv:hidden">{formatRelative(row.lastMessageAt)}</span>
        </AppLink>
      )}
      {editing ? null : (
        <MenuButton
          label={`Options for ${row.title}`}
          className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/conv:opacity-100 pointer-coarse:opacity-100"
          triggerClassName="grid h-7 w-7 place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-active)] hover:text-heading"
          trigger={<MoreHorizontal size={14} aria-hidden />}
          items={[
            {
              label: "Rename",
              icon: <Pencil size={14} />,
              onSelect: () => {
                setName(row.title);
                setEditing(true);
              },
            },
            { label: row.pinned ? "Unpin" : "Pin", icon: row.pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => void setPinned({ conversationId: row.id, pinned: !row.pinned }).catch(fail) },
            "separator",
            ...actions.items,
            "separator",
            { label: "Delete…", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(true) },
          ]}
        />
      )}
      {actions.dialog}
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this conversation?"
        description={`“${row.title}” and everything in it will be gone for good.`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleting(false);
                void remove({ conversationId: row.id }).then(() => {
                  toast.show("Conversation deleted", { tone: "success" });
                  if (active) navigate("/ai", { replace: true });
                }, fail);
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </li>
  );
}

/**
 * Your AI conversations here (Personal or this workspace): search, pinned ones first, then the rest by
 * when they were last used, and in a workspace those shared with you. Each of yours can be renamed,
 * pinned, shared with the workspace, exported (Markdown, or a note) or deleted.
 */
export function ConversationList({ activeId, onNavigate }: { activeId: string | null; onNavigate?: () => void }) {
  const { scope, profile } = useAppState();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const pinned = useQuery(api.aiChat.pinned, term ? "skip" : { scope });
  // Conversations others shared with this workspace (none in Personal).
  const shared = useQuery(api.aiSharing.list, term || scope.kind !== "workspace" ? "skip" : { scope });
  const { results, status, loadMore } = usePaginatedQuery(api.aiChat.list, { scope, search: term || undefined }, { initialNumItems: 30 });
  const historyOff = (profile as { aiPrefs?: { history: boolean } }).aiPrefs?.history === false;
  const rows = (list: Row[]) => list.map((r) => <ConversationRow key={r.id} row={r} active={r.id === activeId} onNavigate={onNavigate} />);
  const nothing = status !== "LoadingFirstPage" && !results.length && !(pinned?.length ?? 0) && !(shared?.length ?? 0);

  return (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col">
      <div className="flex-none space-y-2 px-2.5 pb-2 pt-3">
        <AppLink href="/ai" onClick={onNavigate} className="ui-btn ui-btn-secondary flex h-9 w-full items-center justify-center gap-2 text-[13.5px]">
          <Plus size={15} aria-hidden /> New chat
        </AppLink>
        <div className="ui-well flex h-9 items-center gap-2 rounded-[6px] px-2.5">
          <Search size={14} aria-hidden className="flex-none text-muted" />
          <label htmlFor="ai-conversation-search" className="sr-only">
            Search conversations
          </label>
          <input
            id="ai-conversation-search"
            type="text"
            role="searchbox"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {historyOff ? (
          <p className="mb-3 rounded-[8px] bg-[var(--glass-hover)] px-3 py-2 text-[12.5px] text-muted">
            History is off, so new conversations are deleted when you close them.{" "}
            <AppLink href="/settings/ai" className="underline underline-offset-2 hover:text-heading">
              Change
            </AppLink>
          </p>
        ) : null}
        {!term && shared ? <SharedWithYou rows={shared} activeId={activeId} onNavigate={onNavigate} /> : null}
        {!term && pinned?.length ? (
          <section className="mb-3">
            <p className="ui-caps px-2.5 pb-1">Pinned</p>
            <ul className="space-y-0.5">{rows(pinned)}</ul>
          </section>
        ) : null}
        {results.length ? (
          <section>
            {!term && pinned?.length ? <p className="ui-caps px-2.5 pb-1">Recent</p> : null}
            <ul className="space-y-0.5">{rows(results)}</ul>
          </section>
        ) : null}
        {nothing ? (
          <div className="flex flex-col items-center px-4 py-10 text-center text-[13px] text-muted">
            <MessageSquare size={18} aria-hidden className="mb-2 text-faint" />
            {term ? "No conversations match that." : "Your conversations will show up here."}
          </div>
        ) : null}
        {status === "CanLoadMore" ? (
          <button type="button" onClick={() => loadMore(30)} className="mt-2 h-8 w-full rounded-[6px] text-[12.5px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
            Show more
          </button>
        ) : null}
      </div>
    </nav>
  );
}
