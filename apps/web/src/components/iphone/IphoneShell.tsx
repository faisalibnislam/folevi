"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppRouter, type Route } from "@/lib/app/router";
import { RouteView } from "@/components/app/RouteView";
import { NotificationPanel } from "@/components/app/NotificationsButton";
import { IphoneChromeProvider } from "./chrome";
import { TabBar } from "./TabBar";
import { Sheet } from "./Sheet";
import { AccountSheet } from "./AccountSheet";
import { NewFolderSheet } from "./NewFolderSheet";
import { attachStage, dropTransition, playTransition } from "./transitions";

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
  const { route, pathname } = useAppRouter();
  const key = screenKey(route, pathname);
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [account, setAccount] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const actions = useMemo<IphoneActions>(() => ({ openAccount: () => setAccount(true), openNotifications: () => setNotifications(true), openNewFolder: () => setNewFolder(true) }), []);

  useLayoutEffect(() => (stage.current && layer.current ? attachStage(stage.current, layer.current) : undefined), []);
  // A new screen slides in (or the old one out) on the frame it first draws; the same screen stays put.
  const shownKey = useRef(key);
  useLayoutEffect(() => {
    if (shownKey.current === key) {
      dropTransition();
      return;
    }
    shownKey.current = key;
    playTransition(stage.current?.firstElementChild as HTMLElement | null);
  }, [key, pathname]);

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
  const unread = useQuery(api.notifications.unreadCount, open ? {} : "skip");
  return (
    <Sheet open={open} onClose={onClose} title="Notifications" size="medium" bodyClassName="flex flex-col">
      <NotificationPanel unread={unread ?? 0} onClose={onClose} hideTitle />
    </Sheet>
  );
}
