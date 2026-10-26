"use client";

// Runs the account's device copy (lib/sync/deviceCopy.ts, docs/NATIVE_APP_PLAN.md §11) while the app is open:
// every note of Personal and each team workspace downloaded in the background, kept fresh from the current
// scope's head while the page is visible, attachments after them (deviceFiles.ts). It also prefetches on intent:
// a pointer or finger going down on any link to a note (cards, rows, links in notes), or resting on one, starts
// loading that note's content into the copy and warms its server queries, so the note opens at once.
// Account mode only: a local library is on this device already, and a public computer keeps nothing.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConvex, useQuery } from "convex/react";
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useBackendMode } from "@/lib/mode";
import { localDbInMemory } from "@/lib/sync/db";
import { DeviceCopy, type CopyClient } from "@/lib/sync/deviceCopy";
import { DeviceFiles } from "@/lib/sync/deviceFiles";
import { keepAllNotes, noteIdOfHref, onKeepAllNotes, registerDeviceCopy, visibleNoteIds } from "@/lib/sync/deviceCopyHost";
import { spaceStatus } from "@/lib/e2ee/router/hooks";

function useVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}

/** How long a note's server queries stay warm after a pointer went down on its link. */
const WARM_MS = 20_000;
/** Resting the pointer on a link this long counts as intent (desktop pointers only). */
const HOVER_MS = 120;

export function DeviceCopyRunner() {
  const { profile, workspaces, scope, engine, online } = useAppState();
  const convex = useConvex();
  const local = useBackendMode() === "local";
  const visible = useVisible();
  const [copy, setCopy] = useState<DeviceCopy | null>(null);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const engineReady = Boolean(engine);

  useEffect(() => {
    // The engine opens after a public computer's database moved to memory, so by now that's known.
    if (local || !engineReady || localDbInMemory()) return;
    const client = convex as unknown as CopyClient;
    const files = new DeviceFiles({ client, accountKey: profile.id });
    const c = new DeviceCopy({
      client,
      accountKey: profile.id,
      // A space with end-to-end encryption is its replica's (its notes are sealed anyway: the server never sends them).
      isPlain: (s: WireScope) => spaceStatus(s).level === "standard",
      hasLocalWork: (id) => engineRef.current?.hasLocalWork(id) ?? false,
      visibleIds: () => visibleNoteIds(),
      onFilled: (ids) => void files.queue(ids),
    });
    c.setEnabled(keepAllNotes(profile.id));
    registerDeviceCopy(profile.id, { copy: c, files });
    setCopy(c);
    c.start();
    const offSetting = onKeepAllNotes(() => c.setEnabled(keepAllNotes(profile.id)));
    return () => {
      offSetting();
      c.stop();
      files.stop();
      registerDeviceCopy(profile.id, null);
      setCopy(null);
    };
  }, [convex, profile.id, local, engineReady]);

  const scopesKey = workspaces.map((w) => w.id).join(",");
  useEffect(() => {
    if (!copy) return;
    const all: WireScope[] = [{ kind: "personal" }, ...scopesKey.split(",").filter(Boolean).map((workspaceId) => ({ kind: "workspace" as const, workspaceId }))];
    copy.setScopes(all, scope);
  }, [copy, scopesKey, scope]);

  useEffect(() => {
    copy?.setOnline(online);
  }, [copy, online]);

  // The current scope's head while the page is visible: when it moves, what changed comes down (§11.2).
  const head = useQuery(api.sync.head, copy && visible && online ? { scope } : "skip");
  useEffect(() => {
    if (copy && head) copy.nudge(scope);
  }, [copy, head?.seq, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (copy && visible) copy.foreground();
  }, [copy, visible]);

  // Typing holds the copy back.
  useEffect(() => {
    if (!copy) return;
    const hold = () => copy.hold();
    window.addEventListener("keydown", hold, { capture: true, passive: true });
    window.addEventListener("beforeinput", hold, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", hold, { capture: true });
      window.removeEventListener("beforeinput", hold, { capture: true });
    };
  }, [copy]);

  // Prefetch on intent (§11.5): pointer or finger down on a link to a note, or resting on one.
  useEffect(() => {
    if (!copy || local) return;
    const warm = new Map<string, () => void>();
    type Watch = { onUpdate(cb: () => void): () => void };
    const watch = (ref: unknown, args: Record<string, unknown>) => (convex.watchQuery as unknown as (r: unknown, a: unknown) => Watch)(ref, args).onUpdate(() => undefined);
    const intent = (target: EventTarget | null) => {
      const a = (target as Element | null)?.closest?.("a[href]");
      const id = noteIdOfHref(a?.getAttribute("href"));
      if (!id) return;
      void copy.prefetch([id]);
      if (warm.has(id) || !navigator.onLine) return;
      // The note's own queries start now, so they've answered (or nearly) by the time it opens.
      const offs = [watch(api.documents.get, { documentId: id }), watch(api.blocks.list, { documentId: id })];
      // Once only: Convex's unsubscribe throws when called twice (the timer used to fire after the cleanup had
      // already stopped these, whenever the effect re-ran).
      const stop = () => {
        clearTimeout(timer);
        if (warm.get(id) !== stop) return;
        warm.delete(id);
        for (const off of offs) off();
      };
      warm.set(id, stop);
      const timer = setTimeout(stop, WARM_MS);
    };
    const down = (e: Event) => intent(e.target);
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    const finePointer = window.matchMedia?.("(pointer: fine)").matches ?? false;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    const over = (e: Event) => {
      if (hoverTimer) clearTimeout(hoverTimer);
      const target = e.target;
      hoverTimer = setTimeout(() => intent(target), HOVER_MS);
    };
    const out = () => {
      if (hoverTimer) clearTimeout(hoverTimer);
    };
    document.addEventListener("pointerdown", down, { capture: true, passive: true });
    document.addEventListener("touchstart", down, { capture: true, passive: true });
    if (finePointer && !saveData) {
      document.addEventListener("mouseover", over, { capture: true, passive: true });
      document.addEventListener("mouseout", out, { capture: true, passive: true });
    }
    return () => {
      document.removeEventListener("pointerdown", down, { capture: true });
      document.removeEventListener("touchstart", down, { capture: true });
      document.removeEventListener("mouseover", over, { capture: true });
      document.removeEventListener("mouseout", out, { capture: true });
      if (hoverTimer) clearTimeout(hoverTimer);
      for (const stop of [...warm.values()]) stop();
    };
  }, [copy, convex, local]);

  return null;
}
