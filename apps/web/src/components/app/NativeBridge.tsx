"use client";
// What the iPhone and iPad app does with the page (lib/nativeApp.ts): the status bar's text follows the app's
// theme (light text on a dark page), drags are felt (haptics), and folevi:// links opened from other apps
// (widgets, Shortcuts, Spotlight) land where they point (a note, a page, a new note, Quick add task). It also
// gives the app this device's token for its extensions (lib/nativeDevice.ts) and saves what the share
// extension kept while it couldn't reach Folevi. In a browser and in the Mac app: nothing.
import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { parseDeepLink } from "@/lib/deepLink";
import { nativeApp } from "@/lib/nativeApp";
import { fileFromNative, linkThisDevice } from "@/lib/nativeDevice";
import { normaliseShare, shareFileKind } from "@/lib/share/payload";
import { saveShare } from "@/lib/share/save";
import { useToast } from "@/components/ui/Toast";
import { useShell } from "./Shell";
import { useCreateDocument } from "./useCreateDocument";

export function NativeBridge() {
  return nativeApp() ? <Bridge /> : null;
}

function Bridge() {
  const bridge = nativeApp()!;
  const { navigate } = useAppRouter();
  const createDocument = useCreateDocument();
  const { openQuickAdd } = useShell();
  const { profile, online } = useAppState();
  useDeviceToken(profile.id, online);
  useKeptShares();

  // The theme is on <html data-theme> (the boot script, then Appearance): the status bar follows it.
  useEffect(() => {
    const root = document.documentElement;
    let last = "";
    const sync = () => {
      const theme = root.dataset.theme === "dark" ? "dark" : "light";
      if (theme === last) return;
      last = theme;
      bridge.setStatusBar(theme);
    };
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, [bridge]);

  // Dragging is felt: a light tap when something lifts (a note, a block, a task), a firmer one when it lands.
  useEffect(() => {
    const lift = () => bridge.haptic("light");
    const land = () => bridge.haptic("medium");
    window.addEventListener("dragstart", lift, true);
    window.addEventListener("drop", land, true);
    return () => {
      window.removeEventListener("dragstart", lift, true);
      window.removeEventListener("drop", land, true);
    };
  }, [bridge]);

  useEffect(
    () =>
      bridge.onCommand((command) => {
        if (command.type !== "link") return;
        const link = parseDeepLink(command.url);
        if (!link) return;
        // folevi://quick-add (the Quick Add widget, the Control Center control) is Quick add task.
        if (link.type === "open") navigate(link.path);
        else if (link.type === "quick-add") openQuickAdd();
        else void createDocument({});
      }),
    [bridge, navigate, createDocument, openQuickAdd],
  );
  return null;
}

/** On each launch, signed in and online: the app holds a working token for this account. */
function useDeviceToken(accountId: string, online: boolean) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!online || done.current === accountId) return;
    done.current = accountId;
    // Not worth bothering anyone about: the widgets say "Open Folevi to sign in" and it's tried again next launch.
    linkThisDevice(accountId).catch(() => (done.current = null));
  }, [accountId, online]);
}

/**
 * What the share extension kept for the app (it was offline, or the share had images or PDFs, which go
 * through the upload queue): saved to the Inbox chosen there, on launch and whenever the app comes back.
 */
function useKeptShares() {
  const bridge = nativeApp()!;
  const { engine, profile, workspaces, deviceId, online } = useAppState();
  const prepareInbox = useMutation(api.tasks.inbox);
  const toast = useToast();
  const running = useRef(false);
  const latest = useRef({ engine, profile, workspaces, deviceId, online, prepareInbox, toast });
  latest.current = { engine, profile, workspaces, deviceId, online, prepareInbox, toast };

  useEffect(() => {
    if (!bridge.takeShares) return;
    const run = async () => {
      const { engine, profile, workspaces, deviceId, online, prepareInbox, toast } = latest.current;
      if (running.current || !engine || document.visibilityState !== "visible") return;
      running.current = true;
      try {
        const kept = (await bridge.takeShares?.()) ?? [];
        let saved = 0;
        for (const item of kept) {
          const files = item.files.map(fileFromNative).filter((f) => shareFileKind(f));
          const payload = normaliseShare({ title: item.title, text: item.text, url: item.url });
          // A workspace left since sharing: Personal's Inbox instead.
          const place = item.place && workspaces.some((w) => w.id === item.place && w.canEdit !== false) ? item.place : "personal";
          await saveShare({ engine, profileId: profile.id, deviceId, online, prepareInbox }, { payload, files, title: payload.title, place });
          await bridge.finishShare?.(item.id);
          saved++;
        }
        if (saved) toast.show(saved === 1 ? "Saved what you shared to your Inbox" : `Saved ${saved} shares to your Inbox`);
      } catch {
        // Kept by the app: tried again when Folevi next comes back.
      } finally {
        running.current = false;
      }
    };
    void run();
    const onVisible = () => void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [bridge, engine]);
}
