"use client";

// Comments on a note: the floating thread anchored under a block (opened from the "2 comments" line, the
// block menu, the selection toolbar or ⌘⌥M), and the overview of every thread in the note (Comments panel).
import type { Editor } from "@tiptap/react";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Bell, BellMinus, BellOff, BellPlus, Check, ChevronLeft, ChevronRight, CornerDownRight, Link2, MoreHorizontal, RotateCcw, Trash2, Unlink, X, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button, IconButton } from "@/components/ui/Button";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { Select } from "@/components/ui/Select";
import { Avatar } from "@/components/ui/Avatar";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { MentionInput, textToCommentBody, type MentionInputHandle, type MentionPerson } from "./MentionInput";

export type CommentsData = FunctionReturnType<typeof api.comments.threads>;
export type CommentThread = CommentsData["threads"][number];
type Comment = CommentThread["comments"][number];
type BodyNode = { type: string; text?: string; label?: string };

/** A link that opens the note on this thread (`#comment-<id>`). */
export function commentLink(documentId: string, threadId: string): string {
  return `${window.location.origin}/d/${documentId}#comment-${threadId}`;
}

export function CommentBody({ body }: { body: BodyNode[] }) {
  return (
    <>
      {body.map((n, i) =>
        n.type === "mention" ? (
          <span key={i} className="rounded-[5px] bg-accent-soft px-1 font-medium text-heading">
            @{n.label}
          </span>
        ) : n.type === "text" ? (
          <span key={i}>{n.text}</span>
        ) : null,
      )}
    </>
  );
}

const bodyToText = (body: BodyNode[]) => body.map((n) => (n.type === "text" ? n.text : n.type === "mention" ? `@${n.label}` : "")).join("");

const isPending = (id: string) => id.startsWith("pending-");

/**
 * Comment mutations with optimistic updates on the note's thread list, so sending, resolving and
 * deleting feel instant (the server's answer replaces the guess a moment later).
 */
export function useCommentActions(documentId: string) {
  const { profile } = useAppState();
  const args = { documentId };
  const me = { id: profile.id, name: profile.displayName, avatarUrl: profile.avatarUrl ?? null };
  const pendingComment = (body: unknown[]): Comment => ({
    id: `pending-${Math.random().toString(36).slice(2)}`,
    authorId: me.id,
    authorName: me.name,
    authorAvatarUrl: me.avatarUrl,
    body: body as Comment["body"],
    deleted: false,
    createdAt: Date.now(),
    editedAt: null,
    mine: true,
    canEdit: false,
    canDelete: false,
  });
  const withThreads = (store: OptimisticLocalStore, fn: (data: CommentsData) => CommentsData) => {
    const cur = store.getQuery(api.comments.threads, args);
    if (cur) store.setQuery(api.comments.threads, args, fn(cur));
  };
  return {
    create: useMutation(api.comments.create).withOptimisticUpdate((store, a) =>
      withThreads(store, (d) => {
        const now = Date.now();
        const thread: CommentThread = {
          id: `pending-${now}`,
          blockId: a.blockId ?? null,
          blockExists: a.blockId ? true : null,
          blockText: null,
          status: "open",
          createdAt: now,
          lastActivityAt: now,
          resolvedBy: null,
          resolvedAt: null,
          unread: false,
          canResolve: true,
          canDelete: false,
          comments: [pendingComment(a.body)],
        };
        const blocks = a.blockId ? bumpBlock(d.blocks, a.blockId, now, me, true) : d.blocks;
        return { ...d, threads: [thread, ...d.threads], blocks };
      }),
    ),
    reply: useMutation(api.comments.reply).withOptimisticUpdate((store, a) =>
      withThreads(store, (d) => {
        const now = Date.now();
        const target = d.threads.find((t) => t.id === a.threadId);
        const blocks = target?.blockId && target.status === "open" ? bumpBlock(d.blocks, target.blockId, now, me, false) : d.blocks;
        return {
          ...d,
          blocks,
          threads: d.threads.map((t) => (t.id === a.threadId ? { ...t, status: "open" as const, resolvedBy: null, lastActivityAt: now, comments: [...t.comments, pendingComment(a.body)] } : t)),
        };
      }),
    ),
    edit: useMutation(api.comments.edit).withOptimisticUpdate((store, a) =>
      withThreads(store, (d) => ({
        ...d,
        threads: d.threads.map((t) => ({ ...t, comments: t.comments.map((c) => (c.id === a.commentId ? { ...c, body: a.body as Comment["body"], editedAt: Date.now() } : c)) })),
      })),
    ),
    remove: useMutation(api.comments.remove).withOptimisticUpdate((store, a) =>
      withThreads(store, (d) => ({
        ...d,
        threads: d.threads
          .map((t) => ({ ...t, comments: t.comments.map((c) => (c.id === a.commentId ? { ...c, deleted: true, body: [] } : c)) }))
          .filter((t) => t.comments.some((c) => !c.deleted)),
      })),
    ),
    setResolved: useMutation(api.comments.setResolved).withOptimisticUpdate((store, a) =>
      withThreads(store, (d) => ({
        ...d,
        threads: d.threads.map((t) => (t.id === a.threadId ? { ...t, status: a.resolved ? ("resolved" as const) : ("open" as const), resolvedBy: a.resolved ? me.name : null, resolvedAt: a.resolved ? Date.now() : null } : t)),
        blocks: a.resolved ? dropThread(d, a.threadId) : d.blocks,
      })),
    ),
    deleteThread: useMutation(api.comments.deleteThread).withOptimisticUpdate((store, a) =>
      withThreads(store, (d) => ({ ...d, threads: d.threads.filter((t) => t.id !== a.threadId), blocks: dropThread(d, a.threadId) })),
    ),
    markThreadRead: useMutation(api.comments.markThreadRead).withOptimisticUpdate((store, a) =>
      withThreads(store, (d) => ({ ...d, threads: d.threads.map((t) => (t.id === a.threadId ? { ...t, unread: false } : t)) })),
    ),
    markThreadUnread: useMutation(api.comments.markThreadUnread).withOptimisticUpdate((store, a) =>
      withThreads(store, (d) => ({ ...d, threads: d.threads.map((t) => (t.id === a.threadId ? { ...t, unread: true } : t)) })),
    ),
  };
}

/** The per-block summary without one (open) thread. */
function dropThread(d: CommentsData, threadId: string): CommentsData["blocks"] {
  const t = d.threads.find((x) => x.id === threadId);
  if (!t || !t.blockId || t.status !== "open") return d.blocks;
  const live = t.comments.filter((c) => !c.deleted).length;
  return d.blocks.flatMap((b) => (b.blockId !== t.blockId ? [b] : b.threads <= 1 ? [] : [{ ...b, threads: b.threads - 1, comments: Math.max(0, b.comments - live) }]));
}

function bumpBlock(blocks: CommentsData["blocks"], blockId: string, at: number, me: { name: string; avatarUrl: string | null }, newThread: boolean): CommentsData["blocks"] {
  const found = blocks.find((b) => b.blockId === blockId);
  if (!found) return [...blocks, { blockId, threads: 1, comments: 1, lastActivityAt: at, unread: false, authors: [{ name: me.name, avatarUrl: me.avatarUrl }] }];
  return blocks.map((b) =>
    b.blockId === blockId
      ? { ...b, threads: b.threads + (newThread ? 1 : 0), comments: b.comments + 1, lastActivityAt: at, authors: [{ name: me.name, avatarUrl: me.avatarUrl }, ...b.authors.filter((x) => x.name !== me.name)].slice(0, 3) }
      : b,
  );
}

/**
 * One comment thread: header (Comments, "…", resolve, close), the comments, and a composer. With no
 * `thread` yet it's a new thread on `blockId` (the composer creates it). Enter sends, Shift+Enter adds a
 * line, Escape closes.
 */
export function CommentThreadCard({
  documentId,
  thread,
  blockId,
  canComment,
  people,
  onClose,
  siblings = [],
  onSelectThread,
  embedded = false,
  autoFocus = true,
}: {
  documentId: string;
  thread: CommentThread | null;
  blockId: string | null;
  canComment: boolean;
  people: MentionPerson[];
  onClose: () => void;
  /** Other threads on the same block (for the "1 of 2" switcher). */
  siblings?: CommentThread[];
  onSelectThread?: (threadId: string) => void;
  /** Shown inside the Comments panel rather than floating over the note. */
  embedded?: boolean;
  autoFocus?: boolean;
}) {
  const actions = useCommentActions(documentId);
  const toast = useToast();
  const titleId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const inputRef = useRef<MentionInputHandle>(null);
  const editRef = useRef<MentionInputHandle>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fail = (e: unknown) => toast.show(errorMessage(e), { tone: "error" });

  const resolved = thread?.status === "resolved";
  const threadId = thread?.id ?? null;

  // Opening a thread reads it (and the notifications about it).
  const markedRead = useRef<string | null>(null);
  useEffect(() => {
    const seen = thread ? `${thread.id}:${thread.lastActivityAt}` : null;
    if (!thread || !thread.unread || isPending(thread.id) || markedRead.current === seen) return;
    markedRead.current = seen;
    void actions.markThreadRead({ threadId: thread.id }).catch(() => undefined);
  }, [thread, actions]);

  useEffect(() => {
    if (autoFocus && canComment && !resolved) requestAnimationFrame(() => inputRef.current?.focus());
  }, [autoFocus, canComment, resolved, threadId]);

  // Keep the newest comment in view.
  const count = thread?.comments.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const body = textToCommentBody(text, inputRef.current?.picked() ?? [], people);
    setDraft("");
    inputRef.current?.reset();
    const done = threadId && !isPending(threadId) ? actions.reply({ threadId, body }) : actions.create({ documentId, blockId: blockId ?? undefined, body });
    done.catch((e) => {
      setDraft(text);
      fail(e);
    });
  };

  const saveEdit = () => {
    if (!editing || !editing.text.trim()) return;
    const body = textToCommentBody(editing.text.trim(), editRef.current?.picked() ?? [], people);
    setEditing(null);
    actions.edit({ commentId: editing.id, body }).catch(fail);
  };

  const menu: MenuItem[] = thread && !isPending(thread.id)
    ? [
        {
          label: "Copy link to comment",
          icon: <Link2 size={14} />,
          onSelect: () =>
            void navigator.clipboard.writeText(commentLink(documentId, thread.id)).then(
              () => toast.show("Link copied"),
              () => toast.show("Couldn't copy the link.", { tone: "error" }),
            ),
        },
        {
          label: "Mark as unread",
          icon: <EyeOff size={14} />,
          onSelect: () => {
            markedRead.current = `${thread.id}:${thread.lastActivityAt}`;
            actions.markThreadUnread({ threadId: thread.id }).catch(fail);
            onClose();
          },
        },
        ...(thread.canDelete ? [{ label: "Delete thread", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmDelete(true) }] : []),
      ]
    : [];

  const at = thread ? siblings.findIndex((s) => s.id === thread.id) : -1;

  return (
    <section
      role={embedded ? "region" : "dialog"}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented && !embedded) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className={embedded ? "overflow-hidden rounded-[10px] bg-[var(--color-surface)] shadow-[var(--shadow-card)]" : "ui-pop overflow-hidden rounded-[14px] text-ink"}
    >
      <header className="flex items-center gap-0.5 border-b border-line/70 py-2 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[14px] font-semibold text-heading">
            {embedded ? "Thread" : "Comments"}
          </h2>
          {thread?.blockExists === false ? (
            <p className="flex items-center gap-1 text-[11.5px] text-muted">
              <Unlink size={11} aria-hidden /> On a deleted block
            </p>
          ) : null}
        </div>
        {siblings.length > 1 && at >= 0 ? (
          <div className="mr-1 flex items-center text-[11.5px] text-muted" role="group" aria-label="Threads on this block">
            <IconButton label="Previous thread" className="!h-6 !w-6" disabled={at === 0} onClick={() => onSelectThread?.(siblings[at - 1]!.id)}>
              <ChevronLeft size={13} aria-hidden />
            </IconButton>
            <span aria-live="polite">
              {at + 1} of {siblings.length}
            </span>
            <IconButton label="Next thread" className="!h-6 !w-6" disabled={at === siblings.length - 1} onClick={() => onSelectThread?.(siblings[at + 1]!.id)}>
              <ChevronRight size={13} aria-hidden />
            </IconButton>
          </div>
        ) : null}
        {menu.length ? (
          <MenuButton
            label="Thread options"
            trigger={<MoreHorizontal size={15} aria-hidden />}
            triggerClassName="grid h-7 w-7 place-items-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading"
            items={menu}
          />
        ) : null}
        {thread && thread.canResolve && !isPending(thread.id) ? (
          <IconButton
            label={resolved ? "Reopen thread" : "Resolve thread"}
            aria-pressed={resolved}
            className="!h-7 !w-7"
            onClick={() => {
              actions.setResolved({ threadId: thread.id, resolved: !resolved }).catch(fail);
              if (!resolved) toast.show("Thread resolved");
            }}
          >
            {resolved ? <RotateCcw size={14} aria-hidden /> : <Check size={15} aria-hidden />}
          </IconButton>
        ) : null}
        {embedded ? null : (
          <IconButton label="Close comments" className="!h-7 !w-7" onClick={onClose}>
            <X size={15} aria-hidden />
          </IconButton>
        )}
      </header>

      {confirmDelete && thread ? (
        <div role="alert" className="flex items-center gap-2 border-b border-line/70 bg-danger-soft/40 px-4 py-2.5 text-[12.5px]">
          <span className="flex-1">Delete this thread and its {thread.comments.length === 1 ? "comment" : `${thread.comments.length} comments`}?</span>
          <Button size="sm" variant="quiet" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setConfirmDelete(false);
              actions.deleteThread({ threadId: thread.id }).then(() => toast.show("Thread deleted"), fail);
              onClose();
            }}
          >
            Delete
          </Button>
        </div>
      ) : null}

      {resolved && !showResolved ? (
        <div className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-muted">
          <Check size={14} className="flex-none text-heading" aria-hidden />
          <span className="flex-1">
            Resolved{thread?.resolvedBy ? ` by ${thread.resolvedBy}` : ""}
            {thread?.resolvedAt ? ` · ${formatRelative(thread.resolvedAt)}` : ""}
          </span>
          <button type="button" className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 font-medium text-heading hover:bg-accent-soft" onClick={() => setShowResolved(true)}>
            <Eye size={12} aria-hidden /> Show {thread && thread.comments.length === 1 ? "comment" : `${thread?.comments.length ?? 0} comments`}
          </button>
        </div>
      ) : thread ? (
        <ul ref={listRef} className={`${embedded ? "" : "max-h-[min(340px,45vh)]"} overflow-y-auto py-1`} aria-label="Comments in this thread">
          {thread.comments.map((c) => (
            <CommentRow
              key={c.id}
              c={c}
              editing={editing?.id === c.id ? editing.text : null}
              editRef={editRef}
              people={people}
              onEdit={() => setEditing({ id: c.id, text: bodyToText(c.body) })}
              onEditChange={(text) => setEditing({ id: c.id, text })}
              onEditCancel={() => setEditing(null)}
              onEditSave={saveEdit}
              onDelete={() => actions.remove({ commentId: c.id }).then(() => toast.show("Comment deleted"), fail)}
            />
          ))}
        </ul>
      ) : null}

      {canComment && !resolved ? (
        <form
          className="flex items-end gap-1.5 border-t border-line/70 py-2 pl-4 pr-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="min-w-0 flex-1">
            <MentionInput
              ref={inputRef}
              multiline
              autoGrow
              enterToSend
              label={thread ? "Reply" : blockId ? "Comment on this block" : "Comment on this document"}
              describedBy={hintId}
              placeholder={thread ? "Reply" : "Type your comment"}
              value={draft}
              onChange={setDraft}
              people={people}
              onSubmitShortcut={send}
              onEscape={embedded ? undefined : onClose}
              className="block w-full resize-none bg-transparent py-1.5 text-[13.5px] leading-snug text-ink outline-none placeholder:text-faint"
            />
            <span id={hintId} className="sr-only">
              Enter to send, Shift+Enter for a new line. Type @ to mention someone who can see this page.
            </span>
          </div>
          <IconButton label="Send" type="submit" variant="primary" disabled={!draft.trim()} className="!h-7 !w-7 !rounded-full">
            <ArrowUp size={14} aria-hidden />
          </IconButton>
        </form>
      ) : !canComment && !thread ? (
        <p className="px-4 py-3 text-[12.5px] text-muted">You can read comments on this note but not add them.</p>
      ) : null}
    </section>
  );
}

function CommentRow({
  c,
  editing,
  editRef,
  people,
  onEdit,
  onEditChange,
  onEditCancel,
  onEditSave,
  onDelete,
}: {
  c: Comment;
  editing: string | null;
  editRef: React.RefObject<MentionInputHandle | null>;
  people: MentionPerson[];
  onEdit: () => void;
  onEditChange: (text: string) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onDelete: () => void;
}) {
  const isEditing = editing !== null;
  useEffect(() => {
    if (isEditing) requestAnimationFrame(() => editRef.current?.focus());
  }, [isEditing, editRef]);
  const items: MenuItem[] = [
    ...(c.canEdit ? [{ label: "Edit", onSelect: onEdit }] : []),
    ...(c.canDelete ? [{ label: "Delete", danger: true, onSelect: onDelete }] : []),
  ];
  return (
    <li className={`group relative flex gap-2.5 px-4 py-2 ${isPending(c.id) ? "opacity-60" : ""}`}>
      <Avatar name={c.authorName} url={c.authorAvatarUrl} size={24} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1 pr-7 text-[12.5px]">
          <span className="truncate font-semibold text-heading">{c.authorName}</span>
          <span className="flex-none text-faint">
            · {isPending(c.id) ? "Sending…" : formatRelative(c.createdAt)}
            {c.editedAt && !c.deleted ? " · edited" : ""}
          </span>
        </p>
        {editing !== null ? (
          <form
            className="mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              onEditSave();
            }}
          >
            <MentionInput
              ref={editRef}
              multiline
              autoGrow
              enterToSend
              label="Edit comment"
              value={editing}
              onChange={onEditChange}
              people={people}
              className="ui-input block w-full resize-none rounded-[6px] px-2 py-1.5 text-[13.5px] leading-snug"
              onSubmitShortcut={onEditSave}
              onEscape={onEditCancel}
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button size="sm" variant="quiet" onClick={onEditCancel}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit" disabled={!editing.trim()}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p className={`mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-snug ${c.deleted ? "italic text-faint" : "text-ink"}`}>{c.deleted ? "Comment deleted" : <CommentBody body={c.body} />}</p>
        )}
      </div>
      {items.length && editing === null && !isPending(c.id) ? (
        <MenuButton
          label={`Options for ${c.authorName}'s comment`}
          className="!absolute right-2 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
          triggerClassName="grid h-6 w-6 place-items-center rounded-[6px] text-muted hover:bg-accent-soft hover:text-heading"
          trigger={<MoreHorizontal size={14} aria-hidden />}
          items={items}
        />
      ) : null}
    </li>
  );
}

/**
 * Floats a thread card in the note's scroll area, just under the block (and its comment line), so it
 * scrolls with the text. Clicking elsewhere in the note closes it. Calls `onMissing` when the block isn't
 * on screen (deleted, or hidden in a folded toggle).
 */
export function FloatingThread({
  scrollEl,
  blockId,
  editor,
  onDismiss,
  onMissing,
  children,
}: {
  scrollEl: HTMLElement | null;
  blockId: string;
  editor: Editor | null;
  onDismiss: () => void;
  onMissing: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const missing = useRef(onMissing);
  missing.current = onMissing;

  useLayoutEffect(() => {
    if (!scrollEl) return;
    let misses = 0;
    const place = () => {
      const block = scrollEl.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
      if (!block || block.classList.contains("fb-hidden")) {
        // The block may still be arriving (just opened from a link): give it a moment.
        if (++misses > 20) missing.current();
        return;
      }
      misses = 0;
      const chip = scrollEl.querySelector<HTMLElement>(`[data-comment-chip="${CSS.escape(blockId)}"]`);
      const sr = scrollEl.getBoundingClientRect();
      const br = block.getBoundingClientRect();
      const bottom = (chip ?? block).getBoundingClientRect().bottom;
      const width = Math.min(360, scrollEl.clientWidth - 24);
      const left = Math.max(12, Math.min(br.left - sr.left + scrollEl.scrollLeft - 4, scrollEl.clientWidth - width - 12));
      setPos((p) => {
        const next = { top: bottom - sr.top + scrollEl.scrollTop + 6, left, width };
        return p && p.top === next.top && p.left === next.left && p.width === next.width ? p : next;
      });
    };
    place();
    const retry = window.setInterval(() => {
      if (misses) place();
    }, 150);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(scrollEl);
    if (scrollEl.firstElementChild) ro?.observe(scrollEl.firstElementChild);
    editor?.on("update", place);
    window.addEventListener("resize", place);
    return () => {
      window.clearInterval(retry);
      ro?.disconnect();
      editor?.off("update", place);
      window.removeEventListener("resize", place);
    };
  }, [scrollEl, blockId, editor]);

  // Bring it into view once placed.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!pos || shown.current === blockId) return;
    shown.current = blockId;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }));
  }, [pos, blockId]);

  // The block's comment line shows it's open.
  useEffect(() => {
    const chip = scrollEl?.querySelector<HTMLElement>(`[data-comment-chip="${CSS.escape(blockId)}"]`);
    chip?.setAttribute("data-open", "true");
    chip?.setAttribute("aria-expanded", "true");
    return () => {
      chip?.removeAttribute("data-open");
      chip?.setAttribute("aria-expanded", "false");
    };
  }, [scrollEl, blockId, pos]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || ref.current?.contains(target)) return;
      // Menus and suggestion lists opened from the card live in the top layer; comment lines switch threads.
      if (target.closest?.('[role="menu"], [role="listbox"], [data-comment-chip], #document-inspector')) return;
      onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onDismiss]);

  if (!pos) return null;
  return (
    <div ref={ref} className="absolute z-20 animate-[folio-rise_160ms_var(--ease-folio)] motion-reduce:animate-none" style={{ top: pos.top, left: pos.left, width: pos.width }}>
      {children}
    </div>
  );
}

/**
 * The comments on one block, floating under it: the chosen thread, else the block's latest open one,
 * else a new thread. Closing returns focus to where it was (the editor, or the comment line).
 */
export function BlockThread({
  documentId,
  data,
  blockId,
  threadId,
  scrollEl,
  editor,
  onSelect,
  onClose,
  onMissing,
}: {
  documentId: string;
  data: CommentsData;
  blockId: string;
  threadId: string | null;
  scrollEl: HTMLElement | null;
  editor: Editor | null;
  onSelect: (threadId: string) => void;
  onClose: () => void;
  onMissing: () => void;
}) {
  const people = useQuery(api.comments.mentionable, { documentId });
  const opener = useRef<Element | null>(null);
  if (opener.current === null && typeof document !== "undefined") opener.current = document.activeElement;
  const onBlock = data.threads.filter((t) => t.blockId === blockId);
  const open = onBlock.filter((t) => t.status === "open");
  const thread = (threadId ? onBlock.find((t) => t.id === threadId) : undefined) ?? open[0] ?? null;
  const siblings = [...(thread?.status === "resolved" ? onBlock : open)].sort((a, b) => a.createdAt - b.createdAt);
  // Stay on the thread being shown (so resolving it shows it resolved rather than switching away).
  useEffect(() => {
    if (!threadId && thread && !isPending(thread.id)) onSelect(thread.id);
  }, [threadId, thread, onSelect]);
  const close = () => {
    onClose();
    const el = opener.current;
    requestAnimationFrame(() => {
      if (editor && el && editor.view.dom.contains(el)) editor.commands.focus();
      else if (el instanceof HTMLElement && el.isConnected && el !== document.body) el.focus();
      else scrollEl?.querySelector<HTMLElement>(`[data-comment-chip="${CSS.escape(blockId)}"]`)?.focus();
    });
  };
  return (
    <FloatingThread scrollEl={scrollEl} blockId={blockId} editor={editor} onDismiss={onClose} onMissing={onMissing}>
      <CommentThreadCard documentId={documentId} thread={thread} blockId={blockId} canComment={data.canComment} people={people ?? []} onClose={close} siblings={siblings} onSelectThread={onSelect} />
    </FloatingThread>
  );
}

/** What a thread is attached to, in a few words. */
function anchorLabel(t: CommentThread): ReactNode {
  if (t.blockExists === false)
    return (
      <span className="inline-flex items-center gap-1 italic">
        <Unlink size={11} aria-hidden /> On a deleted block
      </span>
    );
  if (t.blockText) return <span className="truncate">“{t.blockText}”</span>;
  if (t.blockId) return "On a block";
  return "On the whole note";
}

/**
 * Every thread in the note (open or resolved) in the Comments panel, plus a comment on the whole note.
 * Choosing a thread on a block jumps there and opens it; threads on the whole note or a deleted block
 * open right here.
 */
export function CommentsOverview({ documentId, onOpenThread, focusThreadId = null }: { documentId: string; onOpenThread: (thread: CommentThread) => void; focusThreadId?: string | null }) {
  const data = useQuery(api.comments.threads, { documentId });
  const people = useQuery(api.comments.mentionable, { documentId });
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(focusThreadId);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<MentionInputHandle>(null);
  const actions = useCommentActions(documentId);
  const toast = useToast();
  // A thread asked for from outside (a link, a thread whose block is gone): open it once it's loaded.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    const t = focusThreadId ? data?.threads.find((x) => x.id === focusThreadId) : undefined;
    if (!t || focused.current === t.id) return;
    focused.current = t.id;
    setExpanded(t.id);
    setFilter(t.status);
  }, [focusThreadId, data]);
  if (!data) return <p className="text-sm text-muted">Loading comments…</p>;
  const everyone: MentionPerson[] = people ?? [];
  const open = data.threads.filter((t) => t.status === "open");
  const resolved = data.threads.filter((t) => t.status === "resolved");
  // Search: the comments' text, who wrote them, and the line they're on.
  const q = query.trim().toLowerCase();
  const textOf = (t: CommentThread) =>
    [t.blockText ?? "", ...t.comments.map((c) => `${c.authorName} ${c.deleted ? "" : c.body.map((n) => ("text" in n ? n.text : "label" in n ? n.label : "")).join("")}`)].join(" ").toLowerCase();
  const shown = (filter === "open" ? open : filter === "resolved" ? resolved : data.threads)
    .filter((t) => !q || textOf(t).includes(q))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const fail = (e: unknown) => toast.show(errorMessage(e), { tone: "error" });
  const threadMenu = (t: CommentThread): MenuItem[] => [
    ...(t.canResolve
      ? [
          t.status === "open"
            ? { label: "Resolve", icon: <Check size={14} />, onSelect: () => void actions.setResolved({ threadId: t.id, resolved: true }).catch(fail) }
            : { label: "Reopen", icon: <RotateCcw size={14} />, onSelect: () => void actions.setResolved({ threadId: t.id, resolved: false }).catch(fail) },
        ]
      : []),
    t.unread
      ? { label: "Mark as read", icon: <Eye size={14} />, onSelect: () => void actions.markThreadRead({ threadId: t.id }).catch(fail) }
      : { label: "Mark as unread", icon: <EyeOff size={14} />, onSelect: () => void actions.markThreadUnread({ threadId: t.id }).catch(fail) },
    {
      label: "Copy link",
      icon: <Link2 size={14} />,
      onSelect: () =>
        void navigator.clipboard.writeText(`${location.origin}${commentLink(documentId, t.id)}`).then(
          () => toast.show("Link copied"),
          () => toast.show("Couldn't copy the link.", { tone: "error" }),
        ),
    },
    ...(t.canDelete ? [{ label: "Delete thread…", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmDelete(t.id) }] : []),
  ];
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const body = textToCommentBody(text, inputRef.current?.picked() ?? [], everyone);
    setDraft("");
    inputRef.current?.reset();
    actions.create({ documentId, body }).catch((e) => {
      setDraft(text);
      toast.show(errorMessage(e), { tone: "error" });
    });
  };
  return (
    <div className="space-y-3 text-sm">
      {data.canComment ? (
        <form
          className="ui-input rounded-[10px] px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <MentionInput
            ref={inputRef}
            id="new-comment"
            multiline
            autoGrow
            enterToSend
            label="Comment on this document"
            value={draft}
            onChange={setDraft}
            people={everyone}
            describedBy="comment-hint"
            placeholder="Comment on the whole note"
            className="block w-full resize-none bg-transparent text-[13.5px] leading-snug outline-none placeholder:text-faint"
            onSubmitShortcut={submit}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p id="comment-hint" className="text-[11.5px] text-faint">
              @ to mention · Enter to send
            </p>
            <Button size="sm" variant="primary" type="submit" disabled={!draft.trim()}>
              Comment
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-muted">You can read comments on this note but not add them.</p>
      )}
      <div className="space-y-2">
        <div role="group" aria-label="Show threads" className="ui-seg bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)]">
          <button type="button" aria-pressed={filter === "open"} onClick={() => setFilter("open")}>
            Open{open.length ? ` · ${open.length}` : ""}
          </button>
          <button type="button" aria-pressed={filter === "resolved"} onClick={() => setFilter("resolved")}>
            Resolved{resolved.length ? ` · ${resolved.length}` : ""}
          </button>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
        </div>
        {data.threads.length > 2 ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search comments"
            aria-label="Search comments"
            className="h-8 w-full ui-input rounded-[6px] px-2.5 text-[13px]"
          />
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="px-1 py-4 text-center text-muted">{q ? "No comments match." : filter === "open" ? "No open comments." : filter === "resolved" ? "No resolved comments." : "No comments yet."}</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((t) => {
            const first = t.comments.find((c) => !c.deleted) ?? t.comments[0]!;
            const replies = t.comments.length - 1;
            // Threads that can't float under their block open here (also one whose block is folded away).
            const inline = !t.blockId || t.blockExists === false || focusThreadId === t.id;
            return (
              <li key={t.id} className="group/thread relative">
                {!isPending(t.id) ? (
                  <MenuButton
                    label="Thread actions"
                    align="end"
                    className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover/thread:opacity-100 pointer-coarse:opacity-100"
                    triggerClassName="grid h-7 w-7 place-items-center rounded-[6px] text-muted hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    trigger={<MoreHorizontal size={15} aria-hidden />}
                    items={threadMenu(t)}
                  />
                ) : null}
                {confirmDelete === t.id ? (
                  <div role="alert" className="mb-1 flex items-center gap-2 rounded-[8px] bg-danger-soft/40 px-2.5 py-2 text-[12.5px]">
                    <span className="flex-1">Delete this thread and its {t.comments.length === 1 ? "comment" : `${t.comments.length} comments`}?</span>
                    <Button size="sm" variant="quiet" onClick={() => setConfirmDelete(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setConfirmDelete(null);
                        actions.deleteThread({ threadId: t.id }).then(() => toast.show("Thread deleted"), fail);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-expanded={inline ? expanded === t.id : undefined}
                  // A thread still being saved has a temporary id that's replaced when the server answers;
                  // opening it before then would open a thread that's about to disappear.
                  disabled={isPending(t.id)}
                  aria-busy={isPending(t.id) || undefined}
                  onClick={() => (inline ? setExpanded(expanded === t.id ? null : t.id) : onOpenThread(t))}
                  className="block w-full rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--glass-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-progress"
                >
                  <span className="flex min-w-0 items-center gap-1 pr-8 text-[11.5px] text-faint">{anchorLabel(t)}</span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <Avatar name={first.authorName} url={first.authorAvatarUrl} size={20} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">
                      <span className="font-semibold text-heading">{first.authorName}</span> <span className="text-faint">· {formatRelative(t.lastActivityAt)}</span>
                    </span>
                    {t.unread ? <span className="h-2 w-2 flex-none rounded-full bg-coral" aria-label="Unread" role="img" /> : null}
                  </span>
                  <span className={`mt-1 line-clamp-2 block whitespace-pre-wrap text-[13px] leading-snug ${first.deleted ? "italic text-faint" : "text-ink"}`}>
                    {first.deleted ? "Comment deleted" : <CommentBody body={first.body} />}
                  </span>
                  {replies > 0 || t.status === "resolved" ? (
                    <span className="mt-1 flex items-center gap-2 text-[11.5px] text-muted">
                      {replies > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <CornerDownRight size={11} aria-hidden /> {replies} {replies === 1 ? "reply" : "replies"}
                        </span>
                      ) : null}
                      {t.status === "resolved" ? <span>Resolved{t.resolvedBy ? ` by ${t.resolvedBy}` : ""}</span> : null}
                    </span>
                  ) : null}
                </button>
                {inline && expanded === t.id ? (
                  <div className="mt-1 px-0.5 pb-1">
                    <CommentThreadCard documentId={documentId} thread={t} blockId={t.blockId} canComment={data.canComment} people={everyone} onClose={() => setExpanded(null)} embedded autoFocus={false} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <NoteNotifications documentId={documentId} />
    </div>
  );
}

/** "Follow comments" / "Mute comment notifications" for a note's "…" menu. */
export function useNoteNotifyItems(documentId: string, enabled: boolean): MenuItem[] {
  const sub = useQuery(api.notifications.noteSubscription, enabled ? { documentId } : "skip");
  const set = useMutation(api.notifications.setNoteSubscription);
  const toast = useToast();
  if (!sub) return [];
  const save = (mode: "default" | "follow" | "mute", message: string) =>
    void set({ documentId, mode }).then(
      () => toast.show(message),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  const items: MenuItem[] = [];
  if (!sub.isAuthor) {
    items.push(
      sub.mode === "follow"
        ? { label: "Unfollow comments", icon: <BellMinus size={14} />, onSelect: () => save("default", "You'll hear about replies and @mentions only") }
        : { label: "Follow comments", icon: <BellPlus size={14} />, onSelect: () => save("follow", "You'll hear about every comment on this note") },
    );
  }
  items.push(
    sub.mode === "mute"
      ? { label: "Unmute comment notifications", icon: <Bell size={14} />, onSelect: () => save("default", "Comment notifications are on again") }
      : { label: "Mute comment notifications", icon: <BellOff size={14} />, onSelect: () => save("mute", "Muted. You'll still hear when someone @mentions you.") },
  );
  return items;
}

/** Follow or mute comment notifications for this one note. */
export function NoteNotifications({ documentId }: { documentId: string }) {
  const sub = useQuery(api.notifications.noteSubscription, { documentId });
  const set = useMutation(api.notifications.setNoteSubscription);
  const toast = useToast();
  if (!sub) return null;
  // For the note's creator "default" already means every comment.
  const value = sub.isAuthor && sub.mode === "follow" ? "default" : sub.mode;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/70 px-1 pt-3">
      <label htmlFor={`note-notify-${documentId}`} className="text-[12.5px] text-muted">
        Notify me about
      </label>
      <Select
        id={`note-notify-${documentId}`}
        value={value}
        onChange={(e) =>
          void set({ documentId, mode: e.target.value as "default" | "follow" | "mute" }).then(
            () => toast.show(e.target.value === "mute" ? "Comment notifications muted for this note" : "Saved"),
            (err) => toast.show(errorMessage(err), { tone: "error" }),
          )
        }
        className="ui-input h-8 w-48 rounded-[6px] px-2.5 text-[12.5px]"
      >
        {sub.isAuthor ? <option value="default">All comments</option> : <option value="follow">All comments</option>}
        {sub.isAuthor ? null : <option value="default">Replies and @mentions</option>}
        <option value="mute">Only @mentions</option>
      </Select>
    </div>
  );
}
