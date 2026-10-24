"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useCapabilities } from "@/lib/mode";
import { api } from "@/lib/convex/api";
import { useAppRouter, type Route } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { RouteView } from "@/components/app/RouteView";
import { NotificationPanel } from "@/components/app/NotificationsButton";
import { IphoneChromeProvider } from "./chrome";
import { TabBar } from "./TabBar";
import { Sheet } from "./Sheet";
import { AccountSheet } from "./AccountSheet";
import { NewFolderSheet } from "./NewFolderSheet";
import { attachStage, dropTransition, markZoomFrom, playTransition } from "./transitions";
import { recordRoute, resetAllTabs } from "./tabStacks";

interface IphoneActions {
  openAccount: () => void;
  openNotifications: () => void;
  openNewFolder: () => void;
}

const ActionsContext = createContext<IphoneActions>({ openAccount: () => undefined, openNotifications: () => undefined, openNewFolder: () => undefined });

/** The sheets every screen can open: the account and places, notifications, a new folder. */
export const useIphoneActions = () => useContext(ActionsContext);

/** Which screen a route is: moving between screens slides; within one (another task view, month) it doesn't. */
function screenKey(route: Route, pathname: string): string {
  switch (route.name) {
    case "doc":
    case "folder":
    case "tag":
      return `${route.name}:${route.id}`;
    case "tasks":
    case "calendar":
      return route.name;
    case "ai":
      return "ai";
    case "settings":
      return pathname.replace(/\/+$/, "") === "/settings" ? "settings" : `settings:${route.section}`;
    default:
      return route.name;
  }
}

/**
 * The iPhone app's frame (isIphoneApp): one screen at a time, full screen (each draws its own glass bar,
 * components/iphone/Screen.tsx), the floating tab bar over it, and the shell's sheets. Moving to another
 * screen slides it in like a navigation stack (transitions.ts). Shell renders this instead of its sidebar,
 * tab strip and drawer.
 */
export function IphoneShell({ banner }: { banner?: ReactNode }) {
  const { route, pathname, search } = useAppRouter();
  const { context } = useAppState();
  const key = screenKey(route, pathname);
  // A Settings section's own pushed screens (a choice, an edit: `?screen=`, SettingsKit.tsx) slide like any
  // screen, but the section stays mounted under them (its state carries on), so they're not a new key.
  const moveKey = `${key}|${route.name === "settings" ? (search.get("screen") ?? "") : ""}`;
  // Each tab keeps its own stack of screens (tabStacks.ts): every move is written down in the current tab's.
  const href = `${pathname}${search.size ? `?${search.toString()}` : ""}`;
  const recorded = useRef(false);
  useEffect(() => {
    recordRoute(route, href, !recorded.current);
    recorded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);
  // Another place: the other tabs start again from their first screens (theirs showed the old place).
  const place = context.kind === "workspace" ? context.workspaceId : "personal";
  const shownPlace = useRef(place);
  useEffect(() => {
    if (shownPlace.current === place) return;
    shownPlace.current = place;
    resetAllTabs();
  }, [place]);
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [account, setAccount] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const actions = useMemo<IphoneActions>(() => ({ openAccount: () => setAccount(true), openNotifications: () => setNotifications(true), openNewFolder: () => setNewFolder(true) }), []);

  useLayoutEffect(() => (stage.current && layer.current ? attachStage(stage.current, layer.current) : undefined), []);
  // A note's card or row tapped in a screen's content: the note zooms out of it (transitions.ts). Heard on the
  // way down, before the link's own click navigates.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.<HTMLElement>("main a[href^='/d/']");
      if (link && el.contains(link) && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) markZoomFrom(link);
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, []);
  // A new screen slides in (or the old one out) on the frame it first draws; the same screen stays put.
  const shownKey = useRef(moveKey);
  useLayoutEffect(() => {
    if (shownKey.current === moveKey) {
      dropTransition();
      return;
    }
    shownKey.current = moveKey;
    playTransition(stage.current?.firstElementChild as HTMLElement | null);
  }, [moveKey, pathname]);

  return (
    <IphoneChromeProvider>
      <ActionsContext.Provider value={actions}>
        <div className="fixed inset-0 overflow-hidden bg-canvas text-ink">
          <div ref={stage} className="absolute inset-0 z-[1]">
            <div key={key} className="absolute inset-0 flex flex-col bg-canvas">
              <RouteView />
            </div>
          </div>
          {/* The screen that's leaving, while it slides away (above or below the new one). */}
          <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0 [&>*]:absolute [&>*]:inset-0 [&>*]:flex [&>*]:flex-col [&>*]:bg-canvas" />
          {banner ? <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+56px)] z-40">{banner}</div> : null}
          <TabBar onNewFolder={actions.openNewFolder} />
        </div>
        <AccountSheet open={account} onClose={() => setAccount(false)} />
        <NotificationsSheet open={notifications} onClose={() => setNotifications(false)} />
        <NewFolderSheet open={newFolder} onClose={() => setNewFolder(false)} />
      </ActionsContext.Provider>
    </IphoneChromeProvider>
  );
}

function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifications } = useCapabilities();
  const unread = useQuery(api.notifications.unreadCount, open && notifications ? {} : "skip");
  return (
    <Sheet open={open} onClose={onClose} title="Notifications" size="medium" bodyClassName="flex flex-col" bodyPad={false}>
      <NotificationPanel unread={unread ?? 0} onClose={onClose} hideTitle />
    </Sheet>
  );
}
