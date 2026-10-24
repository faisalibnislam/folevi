"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { Bell, BellOff, Check, FileText, MoreHorizontal, Settings, UserPlus, KeyRound, AtSign, MessageSquare, Share2, Trash2, CircleDot } from "lucide-react";
import { useTopLayer } from "@/components/ui/topLayer";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { MenuButton } from "@/components/ui/Menu";
import { Avatar } from "@/components/ui/Avatar";
import { ageText } from "@/lib/format";
import { t } from "@/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import { useCapabilities } from "@/lib/mode";
import { isIpadApp, useIphoneApp } from "@/lib/iphone";
import { SwipeRow } from "@/components/iphone/Swipe";

type Item = FunctionReturnType<typeof api.notifications.list>[number];

/** Where a notification leads: the note, scrolled to the comment thread or block when there is one. */
export function notificationHref(n: Pick<Item, "documentId" | "threadId" | "blockId"> & { toChanges?: boolean }): string | null {
  // A change proposed for review waits in Changes, not in the note.
  if (n.toChanges) return "/changes";
  if (!n.documentId) return null;
  const hash = n.threadId ? `#comment-${n.threadId}` : n.blockId ? `#block-${n.blockId}` : "";
  return `/d/${n.documentId}${hash}`;
}

/** The bell. Local mode has none (reminders are the system's notifications there, WP14). */
export function NotificationsButton() {
  return useCapabilities().notifications ? <NotificationsBell /> : null;
}

function NotificationsBell() {
  const unread = useQuery(api.notifications.unreadCount, {});
  // On iPad the list is kept warm too, so the popover opens on it (a touch screen has no hover to get ahead).
  useNotificationList(isIpadApp());
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

/** The list as last seen (this visit): shown at once when the panel opens again, while its query catches up. */
let lastList: Item[] | undefined;

/** The notifications list's query, kept warm by the iPhone's bell so the sheet opens on the list, not a placeholder. */
export function useNotificationList(on = true): Item[] | undefined {
  const items = useQuery(api.notifications.list, on ? { limit: 50 } : "skip");
  if (items) lastList = items;
  return items ?? lastList;
}

/** The list of notifications (the bell's panel; a sheet in the iPhone app, which shows its own title). */
export function NotificationPanel({ unread, onClose, hideTitle = false }: { unread: number; onClose: (refocus: boolean) => void; hideTitle?: boolean }) {
  const items = useNotificationList();
  const markRead = useMutation(api.notifications.markRead);
  const { navigate } = useAppRouter();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
  const phone = useIphoneApp();

  // Focus lands in the panel so arrow keys work right away. On a touch screen it goes to the title (no ring):
  // a ring round the first notification after a tap isn't wanted there, and there are no arrow keys.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || items === undefined) return;
    focused.current = true;
    const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    const first = touch ? null : listRef.current?.querySelector<HTMLElement>("[data-nav-item]");
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
    const go = () => {
      navigate(href);
      // Already on that note: the view listens for this to jump to the thread or block.
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    };
    onClose(false);
    // The phone's sheet is on its way down first; the note opens under it on the next frame.
    if (phone) requestAnimationFrame(go);
    else go();
  };

  const markAll = (
    <button
      type="button"
      data-mark-all=""
      disabled={!unread}
      onClick={() => void markRead({}).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}
      // On a touch screen: a 44 pt button with phone-sized text, readable while there's something to mark.
      className="inline-flex h-7 flex-none items-center gap-1 whitespace-nowrap rounded-chip px-2 text-[12px] font-medium text-muted transition-colors hover:bg-accent-soft hover:text-heading disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:gap-1.5 pointer-coarse:px-3.5 pointer-coarse:text-[15px] pointer-coarse:text-heading pointer-coarse:active:bg-[var(--liquid-press,var(--color-accent-soft))] pointer-coarse:disabled:text-muted pointer-coarse:disabled:opacity-50 [&>svg]:pointer-coarse:h-[18px] [&>svg]:pointer-coarse:w-[18px]"
    >
      <Check size={13} aria-hidden /> Mark all read
    </button>
  );
  const settings = (
    <button
      type="button"
      aria-label="Notification settings"
      title="Notification settings"
      onClick={() => {
        navigate("/settings/notifications");
        onClose(false);
      }}
      className="grid h-7 w-7 place-items-center rounded-chip text-muted transition-colors hover:bg-accent-soft hover:text-heading pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:text-heading pointer-coarse:active:bg-[var(--liquid-press,var(--color-accent-soft))] [&>svg]:pointer-coarse:h-5 [&>svg]:pointer-coarse:w-5"
    >
      <Settings size={14} aria-hidden />
    </button>
  );
  const show = (
    <div role="group" aria-label="Show" className={`ui-seg bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] ${phone ? "w-[164px] flex-none" : "w-44"}`}>
      <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
        All
      </button>
      <button type="button" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>
        Unread{unread ? ` · ${unread > 99 ? "99+" : unread}` : ""}
      </button>
    </div>
  );

  return (
    <section role="dialog" aria-labelledby="notifications-heading" className="flex min-h-0 flex-1 flex-col">
      {hideTitle ? (
        // The phone's sheet has the title: one toolbar row under it, All / Unread at the start, Mark all read and
        // the settings at the end, on one line.
        <div className="flex flex-none items-center gap-1 pb-2 pl-4 pr-2">
          <h2 id="notifications-heading" ref={headingRef} tabIndex={-1} className="sr-only">
            Notifications
          </h2>
          {show}
          <span className="min-w-0 flex-1" />
          {markAll}
          {settings}
        </div>
      ) : (
        <>
          <header className="flex flex-none items-center gap-1 px-4 pb-2 pt-3">
            <h2 id="notifications-heading" ref={headingRef} tabIndex={-1} className="flex-1 text-[14px] font-semibold text-heading outline-none">
              Notifications
            </h2>
            {markAll}
            {settings}
          </header>
          <div className="flex-none px-4 pb-2">{show}</div>
        </>
      )}
      {/* (In the phone's sheet the list runs on behind the home indicator, with room to scroll its last row clear,
          in its rows' own colour all the way down.) */}
      <div ref={listRef} onKeyDown={onListKey} className={`min-h-0 flex-1 overflow-y-auto border-t border-line/70 ${phone ? "bg-canvas pb-[calc(var(--sheet-safe-b,0px)+8px)]" : "pb-2"}`}>
        {items === undefined ? (
          // Only the very first time (afterwards the last list shows at once): rows shaped like the real ones,
          // so nothing moves when they arrive.
          <div className={phone ? "pt-4" : "space-y-3 px-4 py-4"} aria-busy aria-label="Loading notifications">
            {phone ? <div className="mx-5 mb-2.5 h-3 w-16 animate-pulse rounded-tiny bg-sunken motion-reduce:animate-none" /> : null}
            {[70, 90, 60].map((w) =>
              phone ? (
                <div key={w} className="flex gap-3 py-3 pl-5 pr-9">
                  <div className="h-9 w-9 flex-none animate-pulse rounded-capsule bg-sunken motion-reduce:animate-none" />
                  <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                    <div className="h-3.5 animate-pulse rounded-tiny bg-sunken motion-reduce:animate-none" style={{ width: `${w}%` }} />
                    <div className="h-3.5 w-1/2 animate-pulse rounded-tiny bg-sunken motion-reduce:animate-none" />
                    <div className="h-3 w-12 animate-pulse rounded-tiny bg-sunken motion-reduce:animate-none" />
                  </div>
                </div>
              ) : (
                <div key={w} className="flex gap-3">
                  <div className="h-7 w-7 flex-none animate-pulse rounded-chip bg-sunken motion-reduce:animate-none" />
                  <div className="h-3.5 animate-pulse rounded-tiny bg-sunken motion-reduce:animate-none" style={{ width: `${w}%` }} />
                </div>
              ),
            )}
          </div>
        ) : groups.length === 0 ? (
          <NothingHere unreadOnly={filter === "unread" && Boolean(items.length)} />
        ) : (
          groups.map((g) => (
            <div key={g.label} role="group" aria-labelledby={`notifications-${g.label}`}>
              <h3 id={`notifications-${g.label}`} className={phone ? "ui-caption-caps px-5 pb-1.5 pt-4" : "ui-caps px-4 pb-1 pt-3"}>
                {g.label}
              </h3>
              <ul className={phone ? "" : "px-1.5"} data-iphone-tappable={phone ? "" : undefined}>
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

function NothingHere({ unreadOnly }: { unreadOnly: boolean }) {
  return <EmptyState size="inline" icon={BellOff} title={unreadOnly ? "No unread notifications" : "You’re all caught up"} body="Comments, replies, @mentions and pages shared with you show up here." className="py-10" />;
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
  // The phone layout: phone-sized text, swipe actions, and the row's options in its long-press menu (no "…").
  const phone = useIphoneApp();
  const fail = (e: unknown) => toast.show(errorMessage(e), { tone: "error" });
  const actionable = Boolean(n.documentId) || n.toChanges;
  const toggleRead = () => void (n.read ? markUnread({ ids: [n.id] }) : markRead({ ids: [n.id] })).catch(fail);
  const drop = () => void remove({ ids: [n.id] }).catch(fail);
  const row = (
    <>
      <button
        type="button"
        data-nav-item
        onClick={() => {
          if (actionable) onOpen();
          else if (!n.read) void markRead({ ids: [n.id] }).catch(fail);
        }}
        aria-describedby={`${n.id}-meta`}
        className={
          phone
            ? "flex w-full gap-3 py-3 pl-5 pr-9 text-left outline-none transition-colors active:bg-[var(--liquid-press)] ui-key-focus"
            : "flex w-full gap-3 rounded-control py-2.5 pl-2.5 pr-9 text-left outline-none transition-colors hover:bg-[var(--glass-hover)] focus-visible:bg-[var(--glass-hover)] focus-visible:ring-2 focus-visible:ring-focus"
        }
      >
        <span className="relative mt-0.5 flex-none">
          {n.actorName ? (
            <Avatar name={n.actorName} url={n.actorAvatarUrl} size={phone ? 36 : 28} />
          ) : (
            <span aria-hidden className={`grid place-items-center rounded-chip bg-sunken text-muted ${phone ? "h-9 w-9" : "h-7 w-7"}`}>
              <Bell size={phone ? 17 : 13} />
            </span>
          )}
          {n.actorName ? <KindIcon kind={n.kind} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block ${phone ? "text-[15px] leading-5" : "text-[13px] leading-snug"} ${n.read ? "text-muted" : "text-ink"}`}>
            <Sentence n={n} />
          </span>
          {n.body ? (
            <span className={`mt-1 line-clamp-2 block border-l-2 border-line-strong pl-2 text-muted ${phone ? "text-[15px] leading-5" : "text-[12.5px] leading-snug"}`}>{n.body}</span>
          ) : null}
          <span id={`${n.id}-meta`} className={`mt-1 block text-faint ${phone ? "text-[13px] leading-[18px]" : "text-[11.5px]"}`}>
            {ageText(n.createdAt)}
            {n.read ? null : <span className="sr-only">, unread</span>}
          </span>
        </span>
        {n.read ? null : <span aria-hidden className={`absolute h-2 w-2 rounded-tiny bg-coral transition-opacity ${phone ? "right-4 top-5" : "right-3.5 top-4 group-hover:opacity-0 group-focus-within:opacity-0"}`} />}
      </button>
      {n.fileId || (n.kind === "invite" && n.inviteId) || n.pageInviteId ? (
        <div className={`-mt-1 flex gap-1.5 pb-2.5 ${phone ? "pl-[68px]" : "pl-[50px]"}`}>
          {n.fileId ? <DownloadFile fileId={n.fileId} /> : null}
          {n.pageInviteId ? (
            <button
              type="button"
              className={`ui-btn ui-btn-primary font-medium ${phone ? "h-9 px-3.5 text-[15px]" : "h-7 px-2.5 text-xs"}`}
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
              className={`ui-btn ui-btn-primary font-medium ${phone ? "h-9 px-3.5 text-[15px]" : "h-7 px-2.5 text-xs"}`}
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
      {/* On the phone this stays out of sight (globals.css, [data-ctx-host]): a long press opens it, VoiceOver finds it. */}
      <MenuButton
        label={`Options for this notification`}
        className="!absolute right-1.5 top-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        triggerClassName="grid h-7 w-7 place-items-center rounded-chip text-muted hover:bg-accent-soft hover:text-heading"
        trigger={<MoreHorizontal size={15} aria-hidden />}
        items={[
          n.read
            ? { label: "Mark as unread", icon: phone ? <CircleDot size={14} /> : undefined, onSelect: toggleRead }
            : { label: "Mark as read", icon: phone ? <Check size={14} /> : undefined, onSelect: toggleRead },
          ...(phone ? ["separator" as const] : []),
          { label: "Remove", icon: phone ? <Trash2 size={14} /> : undefined, danger: true, onSelect: drop },
        ]}
      />
    </>
  );
  if (!phone) return <li className="group relative">{row}</li>;
  return (
    <li data-ctx-host="" className="relative">
      <SwipeRow
        leading={[n.read ? { label: "Unread", icon: <CircleDot />, tone: "#5b6ad0", onAction: toggleRead } : { label: "Read", icon: <Check />, tone: "#5b6ad0", onAction: toggleRead }]}
        trailing={[{ label: "Remove", icon: <Trash2 />, tone: "#d6453d", danger: true, onAction: drop }]}
      >
        <div className="relative">{row}</div>
      </SwipeRow>
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
