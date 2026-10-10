"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { Bell, BellOff, Check, FileText, MoreHorizontal, Settings, UserPlus, KeyRound, AtSign, MessageSquare, Share2 } from "lucide-react";
import { useTopLayer } from "@/components/ui/topLayer";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { MenuButton } from "@/components/ui/Menu";
import { Avatar } from "@/components/ui/Avatar";
import { formatRelative } from "@/lib/format";
import { t } from "@/i18n";

type Item = FunctionReturnType<typeof api.notifications.list>[number];

/** Where a notification leads: the note, scrolled to the comment thread or block when there is one. */
export function notificationHref(n: Pick<Item, "documentId" | "threadId" | "blockId">): string | null {
  if (!n.documentId) return null;
  const hash = n.threadId ? `#comment-${n.threadId}` : n.blockId ? `#block-${n.blockId}` : "";
  return `/d/${n.documentId}${hash}`;
}

export function NotificationsButton() {
  const unread = useQuery(api.notifications.unreadCount, {});
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelStyle = useTopLayer(open, panelRef, buttonRef, { align: "start", gap: 8 });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // Menus opened from the panel live in the top layer outside it.
      if (target.closest?.('[role="menu"]')) return;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const count = unread ?? 0;
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("notifications.button.label", { count })}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
        className={`relative grid h-8 w-8 place-items-center rounded-chip transition-colors hover:bg-accent-soft hover:text-heading pointer-coarse:h-11 pointer-coarse:w-11 ${open ? "bg-accent-soft text-heading" : "text-muted"}`}
      >
        <Bell size={16} aria-hidden />
        {count ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-chip bg-coral px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-[var(--color-sidebar)]"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          ref={panelRef}
          popover="manual"
          style={panelStyle}
          className="ui-pop z-[100] flex max-h-[min(560px,calc(100vh-72px))] w-[380px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-panel border-0 p-0 text-ink animate-[folio-rise_140ms_var(--ease-folio)] motion-reduce:animate-none"
        >
          <NotificationPanel
            unread={count}
            onClose={(refocus) => {
              setOpen(false);
              if (refocus) buttonRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

const DAY_MS = 86_400_000;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function NotificationPanel({ unread, onClose }: { unread: number; onClose: (refocus: boolean) => void }) {
  const items = useQuery(api.notifications.list, { limit: 50 });
  const markRead = useMutation(api.notifications.markRead);
  const { navigate } = useAppRouter();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const toast = useToast();

  // Focus lands in the panel so arrow keys work right away.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || items === undefined) return;
    focused.current = true;
    const first = listRef.current?.querySelector<HTMLElement>("[data-nav-item]");
    (first ?? headingRef.current)?.focus({ preventScroll: true });
  }, [items]);

  const shown = (items ?? []).filter((n) => filter === "all" || !n.read);
  const today = startOfToday();
  const groups = [
    { label: "Today", rows: shown.filter((n) => n.createdAt >= today) },
    { label: "Yesterday", rows: shown.filter((n) => n.createdAt < today && n.createdAt >= today - DAY_MS) },
    { label: "Earlier", rows: shown.filter((n) => n.createdAt < today - DAY_MS) },
  ].filter((g) => g.rows.length);

  const onListKey = (e: React.KeyboardEvent) => {
    const nav = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-nav-item]") ?? [])];
    if (!nav.length) return;
    const at = nav.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      nav[(i + nav.length) % nav.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? nav.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(nav.length - 1);
  };

  const open = (n: Item) => {
    if (!n.read) void markRead({ ids: [n.id] }).catch(() => undefined);
    const href = notificationHref(n);
    if (!href) return;
    navigate(href);
    // Already on that note: the view listens for this to jump to the thread or block.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    onClose(false);
  };

  return (
    <section role="dialog" aria-labelledby="notifications-heading" className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-1 px-4 pb-2 pt-3">
        <h2 id="notifications-heading" ref={headingRef} tabIndex={-1} className="flex-1 text-[14px] font-semibold text-heading outline-none">
          Notifications
        </h2>
        <button
          type="button"
          disabled={!unread}
          onClick={() => void markRead({}).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}
          className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-[12px] font-medium text-muted transition-colors hover:bg-accent-soft hover:text-heading disabled:pointer-events-none disabled:opacity-40"
        >
          <Check size={13} aria-hidden /> Mark all read
        </button>
        <button
          type="button"
          aria-label="Notification settings"
          title="Notification settings"
          onClick={() => {
            navigate("/settings/notifications");
            onClose(false);
          }}
          className="grid h-7 w-7 place-items-center rounded-chip text-muted transition-colors hover:bg-accent-soft hover:text-heading"
        >
          <Settings size={14} aria-hidden />
        </button>
      </header>
      <div className="flex-none px-4 pb-2">
        <div role="group" aria-label="Show" className="ui-seg w-44 bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)]">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
          <button type="button" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>
            Unread{unread ? ` · ${unread > 99 ? "99+" : unread}` : ""}
          </button>
        </div>
      </div>
      <div ref={listRef} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto border-t border-line/70 pb-2">
        {items === undefined ? (
          <div className="space-y-3 px-4 py-4" aria-busy aria-label="Loading notifications">
            {[70, 90, 60].map((w) => (
              <div key={w} className="flex gap-3">
                <div className="h-7 w-7 flex-none animate-pulse rounded-chip bg-sunken motion-reduce:animate-none" />
                <div className="h-3.5 animate-pulse rounded-tiny bg-sunken motion-reduce:animate-none" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState unreadOnly={filter === "unread" && Boolean(items.length)} />
        ) : (
          groups.map((g) => (
            <div key={g.label} role="group" aria-labelledby={`notifications-${g.label}`}>
              <h3 id={`notifications-${g.label}`} className="ui-caps px-4 pb-1 pt-3">
                {g.label}
              </h3>
              <ul className="px-1.5">
                {g.rows.map((n) => (
                  <NotificationRow key={n.id} n={n} onOpen={() => open(n)} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function EmptyState({ unreadOnly }: { unreadOnly: boolean }) {
  return (
    <div className="flex flex-col items-center px-8 py-10 text-center">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-control bg-sunken text-muted" aria-hidden>
        <BellOff size={17} />
      </span>
      <p className="text-[13.5px] font-medium text-heading">{unreadOnly ? "No unread notifications" : "You're all caught up."}</p>
      <p className="mt-1 text-[12.5px] leading-snug text-muted">Comments, replies, @mentions and pages shared with you show up here.</p>
    </div>
  );
}

/** The sentence for a notification: who did what, where. The note's name is emphasised. */
function Sentence({ n }: { n: Item }) {
  const who = <span className="font-semibold text-heading">{n.actorName ?? "Someone"}</span>;
  const doc = n.documentTitle ? <em className="font-medium not-italic text-heading">{n.documentTitle}</em> : null;
  if (doc && n.actorName) {
    switch (n.kind) {
      case "comment":
        return <>{who} {n.count > 1 ? `left ${n.count} comments on` : "commented on"} {doc}</>;
      case "reply":
        return <>{who} {n.count > 1 ? `replied ${n.count} times in` : "replied in"} {doc}</>;
      case "mention":
        return <>{who} mentioned you in {doc}</>;
      case "share":
        return <>{who} shared {doc} with you</>;
    }
  }
  return <>{n.title}</>;
}

function KindIcon({ kind }: { kind: Item["kind"] }) {
  const Icon = kind === "comment" || kind === "reply" ? MessageSquare : kind === "mention" ? AtSign : kind === "share" ? Share2 : kind === "invite" ? UserPlus : kind === "share_change" ? KeyRound : FileText;
  return (
    <span aria-hidden className="absolute -bottom-0.5 -right-1 grid h-4 w-4 place-items-center rounded-chip bg-[var(--color-surface-raised)] text-muted shadow-[0_0_0_1.5px_var(--color-surface-raised)]">
      <Icon size={9.5} strokeWidth={2.4} />
    </span>
  );
}

function NotificationRow({ n, onOpen }: { n: Item; onOpen: () => void }) {
  const markRead = useMutation(api.notifications.markRead);
  const markUnread = useMutation(api.notifications.markUnread);
  const remove = useMutation(api.notifications.remove);
  const accept = useMutation(api.workspaces.acceptInvite);
  const acceptPage = useMutation(api.sharing.acceptPageInvite);
  const { navigate } = useAppRouter();
  const toast = useToast();
  const fail = (e: unknown) => toast.show(errorMessage(e), { tone: "error" });
  const actionable = Boolean(n.documentId);
  return (
    <li className="group relative">
      <button
        type="button"
        data-nav-item
        onClick={() => {
          if (actionable) onOpen();
          else if (!n.read) void markRead({ ids: [n.id] }).catch(fail);
        }}
        aria-describedby={`${n.id}-meta`}
        className="flex w-full gap-3 rounded-control py-2.5 pl-2.5 pr-9 text-left outline-none transition-colors hover:bg-[var(--glass-hover)] focus-visible:bg-[var(--glass-hover)] focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="relative mt-0.5 flex-none">
          {n.actorName ? (
            <Avatar name={n.actorName} url={n.actorAvatarUrl} size={28} />
          ) : (
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-chip bg-sunken text-muted">
              <Bell size={13} />
            </span>
          )}
          {n.actorName ? <KindIcon kind={n.kind} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] leading-snug ${n.read ? "text-muted" : "text-ink"}`}>
            <Sentence n={n} />
          </span>
          {n.body ? (
            <span className="mt-1 line-clamp-2 block border-l-2 border-line-strong pl-2 text-[12.5px] leading-snug text-muted">{n.body}</span>
          ) : null}
          <span id={`${n.id}-meta`} className="mt-1 block text-[11.5px] text-faint">
            {formatRelative(n.createdAt)}
            {n.read ? null : <span className="sr-only">, unread</span>}
          </span>
        </span>
        {n.read ? null : <span aria-hidden className="absolute right-3.5 top-4 h-2 w-2 rounded-tiny bg-coral transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />}
      </button>
      {n.fileId || (n.kind === "invite" && n.inviteId) || n.pageInviteId ? (
        <div className="-mt-1 flex gap-1.5 pb-2.5 pl-[50px]">
          {n.fileId ? <DownloadFile fileId={n.fileId} /> : null}
          {n.pageInviteId ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary h-7 px-2.5 text-xs font-medium"
              onClick={() =>
                acceptPage({ inviteId: n.pageInviteId! }).then((r) => {
                  toast.show("The page was added to Shared with Me.", { tone: "success" });
                  navigate(`/d/${r.documentId}`);
                }, fail)
              }
            >
              Accept and open
            </button>
          ) : null}
          {n.kind === "invite" && n.inviteId ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary h-7 px-2.5 text-xs font-medium"
              onClick={() =>
                accept({ inviteId: n.inviteId! }).then(
                  () => toast.show("You joined the workspace.", { tone: "success" }),
                  fail,
                )
              }
            >
              Accept invitation
            </button>
          ) : null}
        </div>
      ) : null}
      <MenuButton
        label={`Options for this notification`}
        className="!absolute right-1.5 top-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        triggerClassName="grid h-7 w-7 place-items-center rounded-chip text-muted hover:bg-accent-soft hover:text-heading"
        trigger={<MoreHorizontal size={15} aria-hidden />}
        items={[
          n.read
            ? { label: "Mark as unread", onSelect: () => void markUnread({ ids: [n.id] }).catch(fail) }
            : { label: "Mark as read", onSelect: () => void markRead({ ids: [n.id] }).catch(fail) },
          { label: "Remove", danger: true, onSelect: () => void remove({ ids: [n.id] }).catch(fail) },
        ]}
      />
    </li>
  );
}

/** A download for a file delivered to you (an export prepared at your request). Signed link fetched on click. */
function DownloadFile({ fileId }: { fileId: string }) {
  const convex = useConvex();
  const toast = useToast();
  return (
    <button
      type="button"
      className="ui-btn ui-btn-secondary h-7 px-2.5 text-xs font-medium"
      onClick={async () => {
        try {
          const urls = await convex.query(api.files.urls, { fileIds: [fileId], now: Math.floor(Date.now() / 3_600_000) * 3_600_000 });
          const url = urls[fileId]?.url;
          if (!url) return toast.show("That download has expired.", { tone: "error" });
          window.location.assign(url);
        } catch (e) {
          toast.show(errorMessage(e), { tone: "error" });
        }
      }}
    >
      Download
    </button>
  );
}
