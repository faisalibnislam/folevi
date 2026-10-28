"use client";
// What the Mac app shows outside its window, fed from the page: the unread count on the Dock icon, new
// notifications as Mac notifications (while Folevi isn't in front), recent notes and the save state in the
// menu bar menu; and the menus' commands back into the page (New Note, open a page). In a browser: nothing.
//
// With the Mac's native frame (native chrome mode, docs/MAC_REBUILD_PLAN.md M9) the page draws no frame, so only
// these feeds run there (DesktopFeeds, from Shell's NativeContentShell): the frame does menus, navigation and the
// window buttons itself.
//
// The native Mac app (apps/mac) also has a complete menu bar: its items arrive as { type: "menu", id } and run
// here (a handler registered with registerMenuCommand first, then the shell's own, then the key the page already
// answers, sent to what has focus), and the page tells the menu bar what it can do now (setMenuState). A
// notification's actions (Reply, Mark as Read) arrive as { type: "notification", ... }.
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useEngineStatus } from "@/lib/hooks/useEngine";
import { desktop, hasMenuCommand, MAC_MENU_COMMANDS, runMenuCommand, watchMenuCommands, type DesktopCommand, type MacMenuCommand } from "@/lib/desktop";
import { openNextInNewTab, tabHref, tabPage, useTabs, type DocTab } from "@/lib/app/tabs";
import { useAiAccess } from "@/components/ai/useAi";
import { useCommentActions } from "@/components/doc/commentActions";
import { textToCommentBody } from "@/components/doc/MentionInput";
import { useCreateDocument } from "./useCreateDocument";
import { useShell } from "./Shell";
import { useCapabilities } from "@/lib/mode";

const STATUS: Record<string, string> = {
  saved: "All changes saved",
  saving: "Saving…",
  syncing: "Syncing…",
  offline: "Offline: changes are kept on this Mac",
  conflict: "A change needs your review",
  error: "Some changes couldn't be saved",
};

/** A key the page already answers (the editor's and the shell's shortcuts): a menu click presses it. */
type Press = { key: string; code?: string; meta?: boolean; shift?: boolean; alt?: boolean };
const KEYS: Partial<Record<MacMenuCommand, Press>> = {
  "format.bold": { key: "b", meta: true },
  "format.italic": { key: "i", meta: true },
  "format.underline": { key: "u", meta: true },
  "format.strikethrough": { key: "x", meta: true, shift: true },
  "format.code": { key: "e", meta: true },
  "format.highlight": { key: "h", meta: true, shift: true },
  "format.heading-1": { key: "1", meta: true, alt: true },
  "format.heading-2": { key: "2", meta: true, alt: true },
  "format.heading-3": { key: "3", meta: true, alt: true },
  "format.body": { key: "0", meta: true, alt: true },
  "format.bulleted-list": { key: "8", meta: true, shift: true },
  "format.numbered-list": { key: "7", meta: true, shift: true },
  "format.checklist": { key: "9", meta: true, shift: true },
  "format.indent": { key: "Tab", code: "Tab" },
  "format.outdent": { key: "Tab", code: "Tab", shift: true },
  "format.move-up": { key: "ArrowUp", code: "ArrowUp", alt: true, shift: true },
  "format.move-down": { key: "ArrowDown", code: "ArrowDown", alt: true, shift: true },
  "format.duplicate": { key: "d", meta: true },
};

/** Presses a key on what has focus, as the keyboard would (the page's own handlers take it from there). */
function press(k: Press) {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const code = k.code ?? (/^[a-z]$/i.test(k.key) ? `Key${k.key.toUpperCase()}` : /^[0-9]$/.test(k.key) ? `Digit${k.key}` : k.key);
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k.key, code, metaKey: !!k.meta, shiftKey: !!k.shift, altKey: !!k.alt, bubbles: true, cancelable: true, composed: true }));
}

export function DesktopBridge() {
  return desktop() ? <Bridge /> : null;
}

/** The feeds alone (the Mac's native frame): the Dock badge, Mac notifications, recent notes and the save state. */
export function DesktopFeeds() {
  return desktop() ? <Feeds /> : null;
}

function Feeds() {
  useFeeds();
  return null;
}

/** What the Mac shows outside its window, fed from this page. */
function useFeeds() {
  const bridge = desktop()!;
  const { scope, engine } = useAppState();
  // Local mode has no notifications from Folevi (reminders are scheduled with the system there).
  const { notifications } = useCapabilities();
  const unread = useQuery(api.notifications.unreadCount, notifications ? {} : "skip");
  const latest = useQuery(api.notifications.list, notifications ? { limit: 10 } : "skip");
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
      bridge.notify({
        id: n.id,
        title: n.title,
        body: n.body,
        path: n.documentId ? `/d/${n.documentId}` : "/documents",
        kind: n.kind,
        thread: n.documentId,
        threadTitle: n.documentTitle,
        commentThread: n.threadId,
      });
    }
  }, [bridge, latest]);

  useEffect(() => {
    if (recent) bridge.setRecent(recent.map((d) => ({ id: d.id, title: d.title })));
  }, [bridge, recent]);
  useEffect(() => {
    bridge.setStatus(STATUS[status] ?? "");
  }, [bridge, status]);
}

function Bridge() {
  const bridge = desktop()!;
  const { navigate } = useAppRouter();
  const createDocument = useCreateDocument();
  useFeeds();

  // The window buttons sit in the space the top bar keeps for them, wherever that is (sidebar shown or hidden).
  useEffect(() => {
    if (bridge.platform !== "mac") return;
    let frame = 0;
    let last = "";
    const place = () => {
      frame = 0;
      // A block in full canvas covers the window: its toolbar's space comes first.
      const spaces = [...document.querySelectorAll<HTMLElement>(".fb-canvas-card[data-full] .ui-traffic-space"), ...document.querySelectorAll<HTMLElement>(".ui-traffic-space")];
      const spot = spaces.map((el) => el.getBoundingClientRect()).find((r) => r.width > 0);
      if (!spot) return;
      const next = { x: spot.left, y: spot.top, height: spot.height };
      const key = `${Math.round(next.x)},${Math.round(next.y)},${Math.round(next.height)}`;
      if (key === last) return;
      last = key;
      bridge.placeWindowButtons(next);
    };
    const soon = () => {
      // A page that isn't drawn (its window behind others, or Folevi hidden) gets no frames: placed now, so the
      // buttons are on their spot when the window shows.
      if (document.visibilityState === "hidden") return place();
      if (!frame) frame = requestAnimationFrame(place);
    };
    const watch = new MutationObserver(soon);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-full"] });
    window.addEventListener("resize", soon);
    document.addEventListener("visibilitychange", soon);
    soon();
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", soon);
      document.removeEventListener("visibilitychange", soon);
      cancelAnimationFrame(frame);
    };
  }, [bridge]);

  const menu = useMenuCommands();
  const notification = useNotificationActions();
  useEffect(
    () =>
      bridge.onCommand((command) => {
        if (command.type === "navigate") navigate(command.path);
        else if (command.type === "new-note") void createDocument({});
        else if (command.type === "menu") menu(command.id);
        else if (command.type === "notification") notification(command);
      }),
    [bridge, navigate, createDocument, menu, notification],
  );
  return null;
}

/**
 * The menu bar's commands (the native Mac app): runs one, and keeps the menu bar told what can run now. Returns
 * the runner.
 */
function useMenuCommands(): (id: string) => void {
  const bridge = desktop()!;
  const { route, pathname, navigate, back, forward } = useAppRouter();
  const shell = useShell();
  const { tabs, close, homeHref } = useTabs();
  const createDocument = useCreateDocument();
  const ai = useAiAccess().on;
  const { appearance, setAppearance } = useAppState();
  const onNote = route.name === "doc";
  const docId = route.name === "doc" ? route.id : null;

  // Tabs closed lately (by ⌘W or the tab strip), for Reopen Closed Tab.
  const closed = useRef<DocTab[]>([]);
  const previous = useRef<DocTab[]>(tabs);
  const [closedCount, setClosedCount] = useState(0);
  useEffect(() => {
    const now = new Set(tabs.map((t) => t.id));
    const gone = previous.current.filter((t) => !now.has(t.id));
    previous.current = tabs;
    if (!gone.length) return;
    closed.current = [...closed.current.filter((t) => !gone.some((g) => g.id === t.id)), ...gone].slice(-20);
    setClosedCount(closed.current.length);
  }, [tabs]);

  // Home first, then the open tabs (the strip's order); which one is on screen.
  const strip = useMemo(() => [homeHref, ...tabs.map(tabHref)], [homeHref, tabs]);
  const shown = tabs.findIndex((t) => (t.view ? t.view.path === pathname : docId !== null && tabPage(t) === docId));
  const at = shown + 1;

  const builtin = useCallback(
    (id: string): (() => void) | null => {
      switch (id) {
        case "file.new-note":
          return () => void createDocument({});
        case "file.new-from-template":
          return () => navigate("/templates");
        case "file.quick-add-task":
          return () => shell.openQuickAdd();
        case "file.new-tab":
          // What to open comes from the palette, in a tab of its own.
          return () => {
            openNextInNewTab();
            shell.openPalette();
          };
        case "file.open-quickly":
        case "edit.search-all":
        case "go.search":
          return () => shell.openPalette();
        case "file.close-tab":
          return () => {
            if (shown >= 0) close(tabs[shown]!.id);
            else bridge.closeWindow?.();
          };
        case "file.reopen-closed-tab":
          if (!closed.current.length) return null;
          return () => {
            const t = closed.current.pop();
            setClosedCount(closed.current.length);
            if (!t) return;
            openNextInNewTab();
            navigate(tabHref(t));
          };
        case "file.import":
          return () => navigate("/settings/data");
        case "view.sidebar":
          return () => shell.toggleSidebar();
        case "view.inspector":
          return onNote ? () => shell.setInspectorOpen(!shell.inspectorOpen) : null;
        case "view.focus":
          return () => shell.setFocusMode(!shell.focusMode);
        case "view.appearance-light":
          return () => setAppearance("light");
        case "view.appearance-dark":
          return () => setAppearance("dark");
        case "view.appearance-system":
          return () => setAppearance("system");
        case "go.back":
          return () => back();
        case "go.forward":
          return forward ? () => forward() : null;
        case "go.home":
          return () => navigate("/documents");
        case "go.today":
          return () => navigate("/tasks/today");
        case "go.calendar":
          return () => navigate("/calendar");
        case "go.inbox":
          return () => navigate("/inbox");
        case "go.ask-ai":
          return ai ? () => shell.openAsk() : null;
        case "go.next-tab":
        case "go.previous-tab":
          if (strip.length < 2) return null;
          return () => navigate(strip[(at + (id === "go.next-tab" ? 1 : strip.length - 1)) % strip.length]!);
        case "help.help":
          return () => navigate("/help");
        case "help.shortcuts":
          return () => navigate("/help#h-shortcuts");
        case "help.whats-new":
          return () => void window.open("https://folevi.com/changelog", "_blank", "noopener");
        case "help.feedback":
          return () => void window.open("mailto:support@folevi.com?subject=Folevi%20for%20Mac", "_blank", "noopener");
      }
      const tab = /^go\.tab-([1-9])$/.exec(id);
      if (tab) {
        // ⌘9 is the last tab, as in Safari.
        const n = Number(tab[1]);
        const href = n === 9 ? strip[strip.length - 1] : strip[n - 1];
        return href ? () => navigate(href) : null;
      }
      const key = KEYS[id as MacMenuCommand];
      if (key && (onNote || !id.startsWith("format."))) return () => press(key);
      return null;
    },
    [createDocument, navigate, shell, shown, close, tabs, bridge, onNote, back, forward, ai, strip, at, setAppearance],
  );

  // What the menu bar can do now (Find stays the system's: the page has no find bar of its own yet).
  const [registered, setRegistered] = useState(0);
  useEffect(() => watchMenuCommands(() => setRegistered((n) => n + 1)), []);
  const sent = useRef("");
  useEffect(() => {
    if (!bridge.setMenuState) return;
    const disabled = MAC_MENU_COMMANDS.filter((id) => !id.startsWith("edit.find") && !hasMenuCommand(id) && !builtin(id));
    // (View > Appearance shows the page's theme checked.)
    const state = { disabled, checked: [`view.appearance-${appearance}`], ai, sidebar: shell.sidebarOpen, inspector: shell.inspectorOpen, focus: shell.focusMode, route: route.name };
    const key = JSON.stringify(state);
    if (key === sent.current) return;
    sent.current = key;
    bridge.setMenuState(state);
  }, [bridge, builtin, ai, shell.sidebarOpen, shell.inspectorOpen, shell.focusMode, route.name, registered, closedCount, appearance]);

  const latest = useRef(builtin);
  latest.current = builtin;
  return useCallback((id: string) => {
    if (runMenuCommand(id)) return;
    latest.current(id)?.();
  }, []);
}

/** A Mac notification's actions that need the page: Reply (a comment in its thread) and Mark as Read. */
function useNotificationActions(): (command: Extract<DesktopCommand, { type: "notification" }>) => void {
  const { notifications } = useCapabilities();
  const markRead = useMutation(api.notifications.markRead);
  const comments = useCommentActions("");
  const latest = useRef({ notifications, markRead, comments });
  latest.current = { notifications, markRead, comments };
  return useCallback((c) => {
    const { notifications: on, markRead: read, comments: actions } = latest.current;
    if (!on) return;
    const done = () => (c.id ? read({ ids: [c.id] }).catch(() => undefined) : undefined);
    if (c.action === "read") void done();
    else if (c.action === "reply" && c.thread && c.text?.trim()) {
      void actions
        .reply({ threadId: c.thread, body: textToCommentBody(c.text.trim(), [], []) })
        .then(done)
        .catch(() => undefined);
    } else if (runMenuCommand(`notification.${c.action}`)) void done();
  }, []);
}
