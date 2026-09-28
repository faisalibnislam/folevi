"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useTopLayer } from "@/components/ui/topLayer";
import { Bell } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { t } from "@/i18n";

export function NotificationsButton() {
  const unread = useQuery(api.notifications.unreadCount, {});
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelStyle = useTopLayer(open, panelRef, buttonRef, { align: "start" });
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
        aria-label={t("notifications.button.label", { count: unread ?? 0 })}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-8 w-8 place-items-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading pointer-coarse:h-11 pointer-coarse:w-11"
      >
        <Bell size={16} aria-hidden />
        {unread ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-coral" aria-hidden /> : null}
      </button>
      {open ? (
        <div ref={panelRef} popover="manual" style={panelStyle} className="z-[100] w-80 max-w-[calc(100vw-1rem)] border-0 bg-transparent p-0 text-ink">
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
    <section role="dialog" aria-label="Notifications" className="ui-card rounded-[8px] shadow-[var(--shadow-pop)]">
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
                {n.fileId ? <DownloadFile fileId={n.fileId} /> : null}
                {n.kind === "invite" && n.inviteId ? (
                  <button
                    type="button"
                    className="mt-1.5 ui-btn ui-btn-primary px-2.5 py-1 text-xs font-medium "
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

/** A download for a file delivered to you (an export prepared at your request). Signed link fetched on click. */
function DownloadFile({ fileId }: { fileId: string }) {
  const convex = useConvex();
  const toast = useToast();
  return (
    <button
      type="button"
      className="mt-1.5 ui-btn ui-btn-secondary px-2.5 py-1 text-xs font-medium"
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
