"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";

export function NotificationsButton() {
  const unread = useQuery(api.notifications.unreadCount, {});
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-8 w-8 place-items-center rounded-[6px] text-muted hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
      >
        <Bell size={16} aria-hidden />
        {unread ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-coral" aria-hidden /> : null}
      </button>
      {open ? (
        <div ref={panelRef} className="absolute left-0 z-50 mt-1 w-80">
          <NotificationPanel onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const items = useQuery(api.notifications.list, { limit: 30 });
  const markRead = useMutation(api.notifications.markRead);
  const accept = useMutation(api.workspaces.acceptInvite);
  const { navigate } = useAppRouter();
  const toast = useToast();
  return (
    <section role="dialog" aria-label="Notifications" className="rounded-[12px] border border-line bg-raised shadow-[0_16px_48px_-20px_rgba(0,0,0,0.45)]">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => void markRead({})}>
          Mark all read
        </button>
      </header>
      <ul className="max-h-96 overflow-y-auto py-1">
        {items === undefined ? <li className="px-4 py-3 text-sm text-muted">Loading…</li> : null}
        {items?.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted">You're all caught up.</li> : null}
        {items?.map((n) => (
          <li key={n.id}>
            <div className={`flex gap-3 px-4 py-2.5 ${n.read ? "" : "bg-accent-soft/40"}`}>
              <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${n.read ? "bg-transparent" : "bg-accent"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="text-left text-sm leading-snug hover:underline"
                  onClick={() => {
                    void markRead({ ids: [n.id] });
                    if (n.documentId) {
                      navigate(`/d/${n.documentId}`);
                      onClose();
                    }
                  }}
                >
                  {n.title}
                </button>
                {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p> : null}
                <p className="mt-0.5 text-[11px] text-faint">{formatRelative(n.createdAt)}</p>
                {n.kind === "invite" && n.inviteId ? (
                  <button
                    type="button"
                    className="mt-1.5 rounded-[6px] bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink"
                    onClick={() =>
                      accept({ inviteId: n.inviteId! }).then(
                        () => toast.show("You joined the workspace.", { tone: "success" }),
                        (e) => toast.show(errorMessage(e), { tone: "error" }),
                      )
                    }
                  >
                    Accept invitation
                  </button>
                ) : null}
              </div>
              {!n.read ? <span className="sr-only">Unread</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
