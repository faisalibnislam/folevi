"use client";
// What the Mac app shows outside its window, fed from the page: the unread count on the Dock icon, new
// notifications as Mac notifications (while Folevi isn't in front), recent notes and the save state in the
// menu bar menu; and the menus' commands back into the page (New Note, open a page). In a browser: nothing.
import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useEngineStatus } from "@/lib/hooks/useEngine";
import { desktop } from "@/lib/desktop";
import { useCreateDocument } from "./useCreateDocument";

const STATUS: Record<string, string> = {
  saved: "All changes saved",
  saving: "Saving…",
  syncing: "Syncing…",
  offline: "Offline: changes are kept on this Mac",
  conflict: "A change needs your review",
  error: "Some changes couldn't be saved",
};

export function DesktopBridge() {
  return desktop() ? <Bridge /> : null;
}

function Bridge() {
  const bridge = desktop()!;
  const { scope, engine } = useAppState();
  const { navigate } = useAppRouter();
  const createDocument = useCreateDocument();
  const unread = useQuery(api.notifications.unreadCount, {});
  const latest = useQuery(api.notifications.list, { limit: 10 });
  const recent = useQuery(api.documents.recentNotes, { scope, limit: 8 });
  const status = useEngineStatus(engine);

  useEffect(() => {
    if (unread !== undefined) bridge.setBadge(unread);
  }, [bridge, unread]);
  useEffect(() => () => bridge.setBadge(0), [bridge]);

  // Only what arrives from now on: what was already there when Folevi opened is in the bell.
  const since = useRef(Date.now());
  const told = useRef(new Set<string>());
  useEffect(() => {
    if (!latest) return;
    for (const n of [...latest].reverse()) {
      if (n.read || n.createdAt < since.current || told.current.has(n.id)) continue;
      told.current.add(n.id);
      // In front, the bell shows it; a Mac notification is for when Folevi is behind other apps.
      if (document.hasFocus()) continue;
      bridge.notify({ id: n.id, title: n.title, body: n.body, path: n.documentId ? `/d/${n.documentId}` : "/documents" });
    }
  }, [bridge, latest]);

  useEffect(() => {
    if (recent) bridge.setRecent(recent.map((d) => ({ id: d.id, title: d.title })));
  }, [bridge, recent]);
  useEffect(() => {
    bridge.setStatus(STATUS[status] ?? "");
  }, [bridge, status]);

  // The window buttons sit in the space the top bar keeps for them, wherever that is (sidebar shown or hidden).
  useEffect(() => {
    let frame = 0;
    let last = "";
    const place = () => {
      frame = 0;
      const spot = [...document.querySelectorAll<HTMLElement>(".ui-traffic-space")].map((el) => el.getBoundingClientRect()).find((r) => r.width > 0);
      if (!spot) return;
      const next = { x: spot.left, y: spot.top, height: spot.height };
      const key = `${Math.round(next.x)},${Math.round(next.y)},${Math.round(next.height)}`;
      if (key === last) return;
      last = key;
      bridge.placeWindowButtons(next);
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const watch = new MutationObserver(soon);
    watch.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", soon);
    soon();
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", soon);
      cancelAnimationFrame(frame);
    };
  }, [bridge]);

  useEffect(
    () =>
      bridge.onCommand((command) => {
        if (command.type === "navigate") navigate(command.path);
        else if (command.type === "new-note") void createDocument({});
      }),
    [bridge, navigate, createDocument],
  );
  return null;
}
