"use client";
// The iPhone and iPad app's widgets, Shortcuts and Spotlight in local mode (docs/LOCAL_MODE_PLAN.md §4.2): with
// no account there's no REST API for them, so this page, which holds the library, feeds them. It hands the
// app the widgets' tasks and notes, the notes Shortcuts can pick from and Spotlight's notes whenever they
// change, and puts into the library what a widget, Siri or Shortcuts did meanwhile (a task checked off or
// added, a note made), which the app kept for it (apps/ios Shared/LocalExtras.swift). Rendered by
// NativeBridge in local mode only; in account mode the app reads the REST API with this device's token.
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { errorCode } from "@/lib/local/errors";
import { nativeApp, type NativeLocalAction, type NativeSpotlightItem, type NativeWidgetNote, type NativeWidgetSnapshot, type NativeWidgetTask } from "@/lib/nativeApp";
import { useToast } from "@/components/ui/Toast";

/** Changes settle this long before the app hears of them (typing in a note changes it many times a second). */
const SETTLE_MS = 1500;
/** How many notes Spotlight keeps: the recent and the starred ones (as the app does with an account). */
const SPOTLIGHT_RECENT = 30;
const SPOTLIGHT_STARRED = 30;
/** How many notes Shortcuts can pick from. */
const CATALOG = 300;

/** The day after a YYYY-MM-DD day. */
export function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

type RangeTask = { blockId: string; documentId: string; documentTitle: string; title: string; status: string; dueDate: string | null; dueTime: string | null; priority?: string | null };
type ListedNote = { id: string; title: string; excerpt?: string | null; updatedAt: number; starred?: boolean; homeFolder?: { name: string } | null };

/** The widgets' tasks: open ones due tomorrow or earlier, as the REST API gives them. */
export function widgetTasks(rows: readonly RangeTask[], tomorrow: string): NativeWidgetTask[] {
  return rows
    .filter((t) => t.status === "open" && t.dueDate !== null && t.dueDate <= tomorrow)
    .slice(0, 200)
    .map((t) => ({
      id: t.blockId,
      text: t.title || "Task",
      status: "open" as const,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      priority: t.priority === "low" || t.priority === "medium" || t.priority === "high" ? t.priority : null,
      note: { id: t.documentId, title: t.documentTitle || "Untitled" },
    }));
}

/** Where a note is, as the widgets and Spotlight say it: its folder, else the library. */
const whereIs = (n: ListedNote) => n.homeFolder?.name || "Notes";

export function widgetNote(n: ListedNote): NativeWidgetNote {
  return { id: n.id, title: n.title || "Untitled", place: { id: null, name: whereIs(n) }, updatedAt: new Date(n.updatedAt).toISOString() };
}

/** Spotlight's notes: the recent and the starred ones, once each (a starred note says so). */
export function spotlightItems(recent: readonly ListedNote[], starred: readonly ListedNote[]): NativeSpotlightItem[] {
  const out = new Map<string, NativeSpotlightItem>();
  const add = (n: ListedNote, star: boolean) => {
    const had = out.get(n.id);
    if (had) had.starred ||= star;
    else out.set(n.id, { id: n.id, title: n.title || "Untitled", excerpt: (n.excerpt ?? "").slice(0, 300), location: whereIs(n), starred: star, updatedAt: n.updatedAt });
  };
  for (const n of recent.slice(0, SPOTLIGHT_RECENT)) add(n, n.starred === true);
  for (const n of starred.slice(0, SPOTLIGHT_STARRED)) add(n, true);
  return [...out.values()];
}

/**
 * One drain at a time on this page, whichever component asked, and each action put in once: it stays in the
 * app's queue until finishLocalAction, so a second look (the app coming back while the first is running, a
 * remount) must not put it in again.
 */
let draining: Promise<void> | null = null;
const applied = new Set<string>();

/** Errors that mean an action can never go in (the task or note is gone, or it was never valid): let it go. */
const FINAL = new Set(["not_found", "invalid_argument", "limit_exceeded", "forbidden"]);

export function LocalExtensions() {
  const bridge = nativeApp()!;
  const { scope, today, deviceId } = useAppState();
  const tomorrow = dayAfter(today);
  const feeds = !!bridge.setWidgetSnapshot;
  const tasks = useQuery(api.tasks.range, feeds ? { scope, from: "0000-01-01", to: tomorrow } : "skip");
  const recent = useQuery(api.documents.recentNotes, feeds ? { scope, limit: SPOTLIGHT_RECENT } : "skip");
  const starred = useQuery(api.documents.list, feeds ? { scope, view: "starred", paginationOpts: { numItems: SPOTLIGHT_STARRED, cursor: null } } : "skip");
  const catalog = useQuery(api.documents.list, feeds ? { scope, view: "all", sort: "updated", paginationOpts: { numItems: CATALOG, cursor: null } } : "skip");

  // The widgets, Shortcuts' notes and Spotlight, once the library's changes settle.
  useEffect(() => {
    if (!tasks || !recent || !starred || !catalog) return;
    const timer = setTimeout(() => {
      const snapshot: NativeWidgetSnapshot = {
        day: today,
        tasks: widgetTasks(tasks as RangeTask[], tomorrow),
        notes: (recent as ListedNote[]).slice(0, 10).map(widgetNote),
        catalog: (catalog.page as ListedNote[]).filter((n) => n.title).map(widgetNote),
      };
      void bridge.setWidgetSnapshot?.(snapshot);
      void bridge.indexSpotlight?.(spotlightItems(recent as ListedNote[], starred.page as ListedNote[]));
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [bridge, tasks, recent, starred, catalog, today, tomorrow]);

  useLocalActions({ scope, today, deviceId });
  return null;
}

/**
 * Several places (docs/MULTI_ACCOUNT_PLAN.md §6): in an account, what the share sheet, Siri, Shortcuts or a widget
 * saved to it while offline (or before it had a token on this device) waits in the same queue, tagged with the
 * account; the app hands this page only its own. Put into Personal, as the REST API would have.
 */
const PERSONAL: ReturnType<typeof useAppState>["scope"] = { kind: "personal" };

export function PlaceActions() {
  const { today, deviceId } = useAppState();
  useLocalActions({ scope: PERSONAL, today, deviceId });
  return null;
}

/** What a widget, Siri or Shortcuts did while this page wasn't there: put into the library, then let go. */
function useLocalActions(state: { scope: ReturnType<typeof useAppState>["scope"]; today: string; deviceId: string | null }) {
  const bridge = nativeApp()!;
  const update = useMutation(api.tasks.update);
  const quickAdd = useMutation(api.tasks.quickAdd);
  const importText = useMutation(api.imports.importText);
  const { navigate } = useAppRouter();
  const toast = useToast();
  const latest = useRef({ ...state, update, quickAdd, importText, navigate, toast });
  latest.current = { ...state, update, quickAdd, importText, navigate, toast };

  useEffect(() => {
    if (!bridge.takeLocalActions) return;
    const apply = async (a: NativeLocalAction): Promise<{ added?: boolean; opened?: string }> => {
      const { scope, today, update, quickAdd, importText } = latest.current;
      const deviceId = latest.current.deviceId ?? undefined;
      if (a.kind === "toggleTask") {
        await update({ blockId: a.taskId, checked: a.completed, deviceId });
        return {};
      }
      if (a.kind === "addTask") {
        const task = { scope, title: a.text, today, ...(a.dueDate ? { dueDate: a.dueDate } : {}), deviceId };
        try {
          await quickAdd({ ...task, ...(a.noteId ? { documentId: a.noteId } : {}) });
        } catch (e) {
          // The note it was for is gone: the Inbox instead, as Add task does without one.
          if (!a.noteId || errorCode(e) !== "not_found") throw e;
          await quickAdd(task);
        }
        return { added: true };
      }
      const made = await importText({ scope, filename: a.title || "Untitled", content: a.markdown ?? "", format: "markdown" });
      return { opened: made.document.id };
    };
    const drain = async () => {
      const actions = (await bridge.takeLocalActions?.()) ?? [];
      let added = 0;
      let opened: string | null = null;
      for (const action of actions) {
        if (!applied.has(action.id)) {
          try {
            const done = await apply(action);
            applied.add(action.id);
            if (done.added) added++;
            if (done.opened) opened = done.opened;
          } catch (e) {
            // Kept by the app and tried again next time, unless it can never go in.
            if (!FINAL.has(errorCode(e) ?? "")) continue;
          }
        }
        await bridge.finishLocalAction?.(action.id);
      }
      if (opened) latest.current.navigate(`/d/${opened}`);
      if (added) latest.current.toast.show(added === 1 ? "Added the task from Siri or Shortcuts" : `Added ${added} tasks from Siri or Shortcuts`);
    };
    let again = false;
    const run = async (): Promise<void> => {
      if (draining) {
        // Something more may have come since that look began: one more after it.
        again = true;
        return;
      }
      draining = drain()
        .catch(() => undefined) // The app couldn't answer: tried again when Folevi next comes back.
        .finally(() => {
          draining = null;
          if (again) {
            again = false;
            void run();
          }
        });
      await draining;
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    const onActive = () => void run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("folevi:app-active", onActive);
    // A widget or an intent queued something while the app is running (bridge.js passes the app's word on).
    window.addEventListener("folevi:local-actions", onActive);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("folevi:app-active", onActive);
      window.removeEventListener("folevi:local-actions", onActive);
    };
  }, [bridge]);
}
