"use client";
// Keeps the other accounts of this browser going while one is open (docs/MULTI_ACCOUNT_PLAN.md §5.1): a hidden
// /place-sync iframe per account no tab shows (one per browser, through the Web Lock in lib/places/locks.ts), so
// what was queued there still reaches Folevi, its dot shows its unread count, and its new notifications show here
// labelled with the account, with Open to switch to it. Website only: the Mac app runs its own (hidden windows),
// and the iPhone, iPad and Android apps get notifications by push.
import { useEffect, useRef } from "react";
import { useAppState } from "@/lib/app/state";
import { isShell } from "@/lib/shell";
import { useToast } from "@/components/ui/Toast";
import { accountPlaceId, flushBeforeSwitch, knownAccount, knownAccounts, rememberAccount, subscribePlaces } from "@/lib/places";
import { openPlaceInTab, signedInAccounts } from "@/lib/places/web";
import { isPlaceRunner, pinnedUserId } from "@/lib/places/pin";
import { runWhileNotOpen } from "@/lib/places/locks";
import { PLACE_SYNC_SOURCE, type PlaceSyncReport } from "./PlaceSync";

/** At most this many accounts run behind the open one (each is a page of its own). */
export const MAX_RUNNERS = 9;

export function PlaceRunners() {
  return isShell() || isPlaceRunner() ? null : <Runners />;
}

function Runners() {
  const { engine, outbox } = useAppState();
  const toast = useToast();
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const stops = useRef(new Map<string, () => void>());
  const me = pinnedUserId();

  // One runner per other account, while no tab shows it.
  useEffect(() => {
    const running = stops.current;
    const sync = () => {
      const wanted = new Set(
        knownAccounts()
          .filter((a) => a.userId !== me)
          .slice(0, MAX_RUNNERS)
          .map((a) => a.userId),
      );
      for (const [id, stop] of running) {
        if (wanted.has(id)) continue;
        stop();
        running.delete(id);
      }
      for (const id of wanted) {
        if (running.has(id)) continue;
        running.set(
          id,
          runWhileNotOpen(id, () => {
            const frame = document.createElement("iframe");
            frame.src = `/place-sync?place=${encodeURIComponent(accountPlaceId(id))}`;
            frame.title = "Folevi keeps another account in sync";
            frame.setAttribute("aria-hidden", "true");
            frame.tabIndex = -1;
            frame.dataset.placeSync = id;
            frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-10px;top:-10px";
            document.body.appendChild(frame);
            frames.current.set(id, frame);
            return () => {
              frame.remove();
              frames.current.delete(id);
            };
          }),
        );
      }
    };
    sync();
    const off = subscribePlaces(sync);
    return () => {
      off();
      for (const stop of running.values()) stop();
      running.clear();
    };
  }, [me]);

  // What the runners say: counts for the switcher, and new notifications, labelled with their account.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const r = e.data as PlaceSyncReport | null;
      if (!r || r.source !== PLACE_SYNC_SOURCE || typeof r.userId !== "string") return;
      const frame = frames.current.get(r.userId);
      if (!frame || e.source !== frame.contentWindow) return;
      if (r.signedOut) {
        // Ended elsewhere: it leaves the switcher here, and its runner stops.
        stops.current.get(r.userId)?.();
        stops.current.delete(r.userId);
        void signedInAccounts();
        return;
      }
      rememberAccount({ userId: r.userId, unread: r.unread, waiting: r.waiting });
      const who = knownAccount(r.userId);
      const label = who?.name || who?.email || "another account";
      for (const n of (r.fresh ?? []).slice(0, 3)) {
        const path = typeof n.path === "string" && n.path.startsWith("/") ? n.path : "/documents";
        toast.show(`In ${label}: ${n.title}`, {
          action: {
            label: "Open",
            onClick: () => void flushBeforeSwitch({ engine, outbox }).then(() => openPlaceInTab(accountPlaceId(r.userId), { path })),
          },
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [engine, outbox, toast]);
  return null;
}
