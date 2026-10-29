"use client";

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, GripVertical, PanelLeft, X } from "lucide-react";
import { usePane } from "@/lib/app/panes";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { TabsProvider, useTabs, useViewTab } from "@/lib/app/tabs";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { useDocumentTitle } from "@/lib/hooks/useTitle";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { IconButton } from "@/components/ui/Button";
import { Sidebar } from "./Sidebar";
import { RouteView } from "./RouteView";
import { TabStrip } from "./TabStrip";
import { CommandPalette } from "./CommandPalette";
import { AppContextMenu } from "./AppContextMenu";
import { FolderDropLayer } from "./FolderDropLayer";
import { AskAiChat } from "@/components/ai/AskAiChat";
import { AI_FOCUS_EVENT } from "@/components/ai/chat/events";
import { useAiAccess } from "@/components/ai/useAi";
import { OutboxRefusals, SyncStatus } from "./SyncStatus";
import { useCreateDocument } from "./useCreateDocument";
import { captureTemplateFromUrl, clearPendingTemplate, pendingTemplate } from "@/lib/pendingTemplate";
import { DesktopBridge, DesktopFeeds } from "./DesktopBridge";
import { DesktopCapabilities } from "./DesktopCapabilities";
import { PlaceRunners } from "@/components/places/PlaceRunners";
import { MovePlacesHost } from "@/components/places/MovePlaces";
import { NativeBridge } from "./NativeBridge";
import { DeviceCopyRunner } from "./DeviceCopyRunner";
import { displayCornerRadius, useIpadLayout, useIphoneApp } from "@/lib/iphone";
import { nativeApp, nativeChrome } from "@/lib/nativeApp";
import { EngineHost } from "@/lib/engine/EngineHost";
import { NativeGate } from "@/lib/engine/NativeGate";
import { WEB_SETTINGS_SECTIONS } from "@/lib/engine/host";
import { useEditorZoom } from "@/lib/editorZoom";
import { loadDocumentView, loadedDocumentView } from "@/lib/app/noteView";
import { IphoneShell } from "@/components/iphone/IphoneShell";
import { installInputModality } from "@/components/iphone/chrome";
import { MacCommands } from "./MacCommands";
import { inMacApp } from "@/lib/desktop/mac";
import { IphoneScreen, type IphoneScreenOptions } from "@/components/iphone/Screen";

// Quick add (and its plain-words dates, chrono-node, the largest library the first screen would otherwise
// read) loads the first time it's opened, then stays (docs/IOS_PERFORMANCE.md, "Startup").
const QuickAddTask = lazy(() => import("./QuickAddTask").then((m) => ({ default: m.QuickAddTask })));

export interface ShellValue {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  openPalette: () => void;
  /** Quick add task; `due` starts it on a day (YYYY-MM-DD). Safe to pass as a click handler. */
  openQuickAdd: (opts?: { due?: string }) => void;
  isNarrow: boolean;
  /** The sidebar is a modal drawer (phone widths) rather than a column. */
  drawerMode: boolean;
  /**
   * On a document page the app navigation gives way to the page's own sidebar (contents, tasks,
   * attachments, find). The page renders it into this element with a portal.
   */
  sidebarSlot: HTMLElement | null;
  /** On a page, the left sidebar shows the page's tools ("document", default) or the app folders. */
  docSidebarMode: "document" | "folders";
  setDocSidebarMode: (mode: "document" | "folders") => void;
  /** Focus mode hides both sidebars. */
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;
  /**
   * The ambient light behind the glass chrome: a CSS background (a note's theme image), or null for neutral;
   * `tone` says whether it reads dark ("deep") or light, so the chrome over it stays readable.
   */
  setAmbient: (css: string | null, tone?: "deep" | "light" | null) => void;
  /** Opens Ask AI (⌘J), optionally with a question typed in, or about one folder's notes. */
  openAsk: (question?: string, folder?: { id: string; name: string }) => void;
  /** The open note takes AI requests (⌘J, Ask AI, the palette) into its AI sidebar; null when it leaves. */
  setNoteAi: (open: ((request: { view: "note" | "all"; question?: string }) => void) | null) => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

/** Id of the narrow-screen navigation drawer (referenced by the toggle's aria-controls). */
export const DRAWER_ID = "folevi-nav-drawer";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

/**
 * Narrow-screen navigation drawer: a modal dialog. Focus moves in on open, Tab/Shift+Tab stay inside,
 * Escape (or the scrim) closes it, and focus returns to whatever opened it.
 */
function NavDrawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, so the effect below runs once per opening: re-running it (a new onClose after a
  // re-render) would record an element inside the drawer as the opener and lose the focus return.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  // A layout effect: it runs before the browser's focus fix-up blurs the opener (the page behind the drawer
  // turns inert in the same commit). A passive effect would see <body> as the opener in production builds.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body && !root.contains(active) ? active : null;
    (focusables(root)[0] ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(root);
      if (!items.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Return focus to the opener when it is still on screen, else to the (re-mounted) sidebar toggle,
      // else to the main region.
      const restore = () => {
        const target =
          opener && opener.isConnected && opener.getClientRects().length && !opener.closest("[inert]")
            ? opener
            : (document.querySelector<HTMLElement>("[data-drawer-toggle]") ?? document.getElementById("main"));
        target?.focus({ preventScroll: true });
        return target;
      };
      // The page behind the drawer may still be inert in this commit; try again on the next frame.
      const target = restore();
      requestAnimationFrame(() => {
        if (document.activeElement !== target) restore();
      });
    };
  }, []);
  return (
    <div ref={ref} id={DRAWER_ID} role="dialog" aria-modal="true" aria-label="Navigation" tabIndex={-1} className="fixed inset-0 z-40 flex outline-none">
      <div className="ui-pop ui-drawer-panel h-full w-[min(86vw,320px)] animate-[folio-settle_200ms_var(--ease-folio)] rounded-none motion-reduce:animate-none">
        {children}
      </div>
      <button type="button" aria-label="Close sidebar" className="flex-1 bg-[var(--color-scrim)] backdrop-blur-[2px]" onClick={onClose} />
    </div>
  );
}
export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell outside Shell");
  return ctx;
}

export function Shell() {
  // The editor's text size on this device, on every page (it used to apply only while Settings > Appearance was open).
  useEditorZoom();
  // The native apps draw the frame themselves (docs/NATIVE_APP_PLAN.md section 8): only the note page and the
  // engine. (Fixed for the page's life: the host marks it before the first paint.)
  if (nativeChrome()) return <NativeContentShell />;
  return <WebShell />;
}

// The note page's code, as RouteView loads it (handed over at once when it's already here).
const NativeDocumentView = lazy(() => {
  const ready = loadedDocumentView();
  if (ready) return { then: (resolve: (m: { default: typeof ready }) => void) => resolve({ default: ready }) } as unknown as Promise<{ default: typeof ready }>;
  return loadDocumentView().then((m) => ({ default: m.DocumentView }));
});
const NativeReviewView = lazy(() => import("@/components/views/ReviewView").then((m) => ({ default: m.ReviewView })));
const NativeGraphView = lazy(() => import("@/components/views/GraphView").then((m) => ({ default: m.GraphView })));
// The technical Settings sections (Webhooks, API tokens, Connected apps, AI export, Data) stay web pages.
const NativeSettingsView = lazy(() => import("@/components/views/SettingsView").then((m) => ({ default: m.SettingsView })));

const noop = () => undefined;

/**
 * Native chrome mode: the providers (above, in ProductApp and the gates), the bridge host (EngineHost) and, only
 * while native shows one, a note, Reviews or Graph, with no sidebar, tab strip, iPhone frame, palette, floating
 * Foli AI or dialogs (the native app has its own). Anything else is the idle state: nothing drawn.
 */
// Fixed for the page's life, as the marker is.
const macFrame = typeof window !== "undefined" && nativeChrome()?.platform === "macos";

function NativeContentShell() {
  const { route } = useAppRouter();
  const { profile, context } = useAppState();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const noteAi = useRef<((request: { view: "note" | "all"; question?: string }) => void) | null>(null);
  const setNoteAi = useCallback((open: ((request: { view: "note" | "all"; question?: string }) => void) | null) => {
    noteAi.current = open;
  }, []);
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-native-chrome", "");
  }, []);
  // An iPhone (marker platform "ios"): the phone page layout and its styles (globals.css, editor-phone.css).
  const iphone = useIphoneApp();
  useLayoutEffect(() => {
    if (!iphone) return;
    const root = document.documentElement;
    root.dataset.iphone = "";
    const corner = displayCornerRadius();
    if (corner) root.style.setProperty("--iphone-sheet-bottom", `${Math.max(28, corner - 8)}px`);
    return () => {
      delete root.dataset.iphone;
      root.style.removeProperty("--iphone-sheet-bottom");
    };
  }, [iphone]);
  // The note page's code starts loading at once: the first note native opens should not wait for it.
  useEffect(() => {
    void loadDocumentView();
  }, []);
  const value = useMemo<ShellValue>(
    () => ({
      sidebarOpen: false,
      toggleSidebar: noop,
      inspectorOpen,
      setInspectorOpen,
      openPalette: noop,
      openQuickAdd: noop,
      isNarrow,
      drawerMode: isNarrow,
      sidebarSlot: null,
      docSidebarMode: "document",
      setDocSidebarMode: noop,
      focusMode: !inspectorOpen,
      setFocusMode: noop,
      setAmbient: noop,
      openAsk: () => noteAi.current?.({ view: "note" }),
      setNoteAi,
    }),
    [inspectorOpen, isNarrow, setNoteAi],
  );
  const content =
    route.name === "doc" ? (
      <NativeDocumentView key={route.id} documentId={route.id} />
    ) : route.name === "review" ? (
      <NativeReviewView />
    ) : route.name === "graph" ? (
      <NativeGraphView />
    ) : route.name === "settings" && WEB_SETTINGS_SECTIONS.has(route.section) ? (
      <NativeSettingsView section={route.section} />
    ) : null;
  return (
    <TabsProvider accountKey={profile.id} workspaceId={context.kind === "workspace" ? context.workspaceId : null}>
      <ShellContext.Provider value={value}>
        <div data-native-content="" className="ui-canvas flex h-dvh min-h-0 flex-col overflow-hidden text-ink">
          <Suspense fallback={null}>{content}</Suspense>
        </div>
        <EngineHost />
        {/* The app is up: no gate screen for native to show. */}
        <NativeGate gate={null} />
        <NativeBridge />
        {/* The Mac's native frame: the Dock badge, notifications, the menu bar's recent notes and save state,
            Spotlight, Share, Print and notes dragged out (the iPhone's are NativeBridge's). */}
        {macFrame ? (
          <>
            <DesktopFeeds />
            <DesktopCapabilities />
          </>
        ) : null}
        <PlaceRunners />
        {/* Every note of the place kept on this device (Settings > This device, device.storage). */}
        <DeviceCopyRunner />
        <OutboxRefusals />
      </ShellContext.Provider>
    </TabsProvider>
  );
}

function WebShell() {
  const { route, navigate, search } = useAppRouter();
  const [collapsed, setCollapsed] = useLocalStorage("folevi:sidebar-collapsed", false);
  const [width, setWidth] = useLocalStorage("folevi:sidebar-width", 248);
  const [inspectorPref, setInspectorPref] = useLocalStorage("folevi:inspector-open", false);
  // The iPhone app has its own interface (components/iphone): a navigation stack and a floating tab bar.
  const iphone = useIphoneApp();
  const isNarrow = useMediaQuery("(max-width: 767px)") || iphone;
  const isMedium = useMediaQuery("(max-width: 1199px)");
  useLayoutEffect(() => {
    if (!iphone) return;
    const root = document.documentElement;
    root.dataset.iphone = "";
    // A floating sheet's bottom corners: the screen's own corner less the sheet's 8 px inset (globals.css).
    const corner = displayCornerRadius();
    if (corner) root.style.setProperty("--iphone-sheet-bottom", `${Math.max(28, corner - 8)}px`);
    return () => {
      delete root.dataset.iphone;
      root.style.removeProperty("--iphone-sheet-bottom");
    };
  }, [iphone]);
  // The iPad app with room for the sidebar: <html data-ipad> gives the desktop layout iPadOS's look (globals.css).
  const ipad = useIpadLayout();
  useLayoutEffect(() => {
    if (!ipad) return;
    const root = document.documentElement;
    root.dataset.ipad = "";
    // Keyboard hints (⌘K) show only while a hardware keyboard is attached: the app says so (bridge.js,
    // data-hardware-keyboard). An older app doesn't, and then the first key pressed with ⌘, ⌃ or ⌥ (which
    // the on-screen keyboard has none of) or Tab says one is there.
    const onKey = (e: KeyboardEvent) => {
      if (root.hasAttribute("data-keyboard-known")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Tab") root.setAttribute("data-hardware-keyboard", "");
    };
    window.addEventListener("keydown", onKey, true);
    // Focus rings only while a keyboard moves focus, never left behind by a tap (globals.css, data-input).
    const stopModality = installInputModality();
    return () => {
      delete root.dataset.ipad;
      window.removeEventListener("keydown", onKey, true);
      stopModality();
    };
  }, [ipad]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Mounted from its first opening on (it keeps its draft and closing animation from then).
  const [quickAddUsed, setQuickAddUsed] = useState(false);
  if (quickAddOpen && !quickAddUsed) setQuickAddUsed(true);
  const [quickAddDue, setQuickAddDue] = useState<string | undefined>(undefined);
  const [ambient, setAmbientCss] = useState<string | null>(null);
  const [ambientTone, setAmbientTone] = useState<"deep" | "light" | null>(null);
  const setAmbient = useCallback((css: string | null, tone: "deep" | "light" | null = null) => {
    setAmbientCss(css);
    setAmbientTone(css ? tone : null);
  }, []);
  // A dark note theme in light mode (or a light one in dark mode) gets a stronger veil (globals.css, data-ambient).
  useEffect(() => {
    const root = document.documentElement;
    if (ambientTone) root.dataset.ambient = ambientTone;
    else delete root.dataset.ambient;
    return () => {
      delete root.dataset.ambient;
    };
  }, [ambientTone]);
  const [askOpen, setAskOpen] = useState<{ q?: string; folder?: { id: string; name: string } } | null>(null);
  // On a note, AI opens in its right sidebar (DocumentView registers here); elsewhere, the floating chat.
  const noteAi = useRef<((request: { view: "note" | "all"; question?: string }) => void) | null>(null);
  const setNoteAi = useCallback((open: ((request: { view: "note" | "all"; question?: string }) => void) | null) => {
    noteAi.current = open;
  }, []);
  const ai = useAiAccess();
  const aiOn = ai.on;
  const aiOnRef = useRef(aiOn);
  aiOnRef.current = aiOn;
  const createDocument = useCreateDocument();
  const settings = useQuery(api.settings.status, {});
  const { profile, context } = useAppState();
  const [sidebarSlot, setSidebarSlot] = useState<HTMLElement | null>(null);
  const [docSidebarMode, setDocSidebarModePref] = useLocalStorage<"document" | "folders">("folevi:doc-sidebar-mode", "document");
  const pageSidebar = route.name === "doc" && docSidebarMode === "document" && !iphone;

  // "Use this template" on folevi.com: open the picked template as a new page, once, as soon as the app can
  // create pages (after onboarding; straight away for someone already signed in, via ?template=).
  const templateOpened = useRef(false);
  useEffect(() => {
    if (templateOpened.current) return;
    captureTemplateFromUrl();
    const pending = pendingTemplate();
    if (!pending) return;
    templateOpened.current = true;
    void createDocument({ title: pending.name, templateId: `builtin:${pending.key}` }).then((id) => {
      if (id) clearPendingTemplate();
      else templateOpened.current = false; // not ready yet; try again when it is
    });
  }, [createDocument]);

  useEffect(() => setDrawerOpen(false), [route]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const sidebarOpen = isNarrow ? drawerOpen : !collapsed;
  const toggleSidebar = useCallback(() => {
    if (isNarrow) setDrawerOpen((o) => !o);
    else setCollapsed(!collapsed);
  }, [isNarrow, collapsed, setCollapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && e.altKey && e.code === "KeyN") {
        e.preventDefault();
        void createDocument({});
      } else if (mod && !e.altKey && !e.shiftKey && e.code === "KeyN" && nativeApp()) {
        // In the iPhone and iPad app ⌘N is free (a browser keeps it for a new window), as in the Mac app.
        e.preventDefault();
        void createDocument({});
      } else if (mod && e.altKey && e.code === "KeyI") {
        e.preventDefault();
        setInspectorPref(!inspectorPref);
      } else if (mod && e.shiftKey && e.code === "KeyA") {
        e.preventDefault();
        setQuickAddOpen(true);
      } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j" && aiOnRef.current) {
        e.preventDefault();
        if (noteAi.current) noteAi.current({ view: "note" });
        // On the AI page, ⌘J goes to its box.
        else if (window.location.pathname.startsWith("/ai")) window.dispatchEvent(new Event(AI_FOCUS_EVENT));
        else setAskOpen({});
      } else if (mod && e.altKey && e.code === "KeyT") {
        e.preventDefault();
        navigate("/tasks/today");
      } else if (mod && !e.altKey && !e.shiftKey && e.key === ",") {
        // Settings, as the account menu says (in the Mac app the menu bar's ⌘, opens its Settings window first).
        e.preventDefault();
        navigate("/settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, createDocument, inspectorPref, setInspectorPref, navigate]);

  const value = useMemo<ShellValue>(
    () => ({
      sidebarOpen,
      toggleSidebar,
      inspectorOpen: inspectorPref,
      setInspectorOpen: setInspectorPref,
      openPalette: () => setPaletteOpen(true),
      openQuickAdd: (opts) => {
        // (As a click handler it's handed the click: only a real date counts.)
        setQuickAddDue(typeof opts?.due === "string" ? opts.due : undefined);
        setQuickAddOpen(true);
      },
      isNarrow: isNarrow || isMedium,
      drawerMode: isNarrow,
      sidebarSlot: pageSidebar ? sidebarSlot : null,
      docSidebarMode,
      setDocSidebarMode: (mode) => {
        setDocSidebarModePref(mode);
        if (isNarrow) setDrawerOpen(true);
        else setCollapsed(false);
      },
      focusMode: !sidebarOpen && !inspectorPref,
      setFocusMode: (on) => {
        if (on) {
          setDrawerOpen(false);
          setCollapsed(true);
          setInspectorPref(false);
        } else setCollapsed(false);
      },
      setAmbient,
      // A typed question (the palette) or a folder is about more than this note: the floating chat. Plain Ask AI on
      // a note opens the note's AI.
      openAsk: (q, folder) => (noteAi.current && !folder && !q ? noteAi.current({ view: "note" }) : setAskOpen({ q, folder })),
      setNoteAi,
    }),
    [sidebarOpen, toggleSidebar, inspectorPref, setInspectorPref, isNarrow, isMedium, pageSidebar, sidebarSlot, docSidebarMode, setDocSidebarModePref, setCollapsed, setAmbient, setNoteAi],
  );

  // Dragging moves the panel's edge directly and saves the width once, on release: saving on every move
  // wrote localStorage and re-rendered the whole app each time.
  const sidebarPanel = useRef<HTMLDivElement>(null);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const handle = e.currentTarget;
    let next = startW;
    const move = (ev: PointerEvent) => {
      next = Math.max(248, Math.min(320, startW + ev.clientX - startX));
      if (sidebarPanel.current) sidebarPanel.current.style.width = `${next}px`;
      handle.setAttribute("aria-valuenow", String(next));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (next !== startW) setWidth(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const globals = (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AppContextMenu />
      {/* Dropping notes and folders on folders (sidebar, folder cards and chips), by mouse or by finger. */}
      <FolderDropLayer />
      <DesktopBridge />
      <DesktopCapabilities />
      {/* Folevi for Mac in Electron: the tab shortcuts (⌘1 to ⌘9, ⌃Tab), which its menus don't have. */}
      <MacCommands />
      <PlaceRunners />
      <MovePlacesHost />
      <NativeBridge />
      <WarmNotes />
      {/* Every note kept on this device, and prefetch on intent (docs/NATIVE_APP_PLAN.md §11). */}
      <DeviceCopyRunner />
      <OutboxRefusals />
      {quickAddUsed ? (
        <Suspense fallback={null}>
          <QuickAddTask open={quickAddOpen} due={quickAddDue} onClose={() => setQuickAddOpen(false)} />
        </Suspense>
      ) : null}
      {/* The floating Ask AI chat (bottom right), only where AI is included and on: Core has no AI, so nothing offers it. */}
      {ai.on ? <AskAiChat open={Boolean(askOpen)} onOpen={() => setAskOpen({})} initial={askOpen?.q} folder={askOpen?.folder} onClose={() => setAskOpen(null)} hideLauncher={(isNarrow && drawerOpen) || iphone || ipad} /> : null}
    </>
  );

  // Folevi for Mac's Settings window (⌘,, decision M2, docs/MAC_POLISH_PLAN.md §3.10): the section alone, under the
  // window's own toolbar of sections (/settings/<section>?window=1); no sidebar, tab strip or Foli AI pill, and
  // none of the main window's work (badge, notifications, runners), which the main window does.
  if (route.name === "settings" && search.get("window") === "1" && inMacApp()) {
    return (
      <TabsProvider accountKey={profile.id} workspaceId={context.kind === "workspace" ? context.workspaceId : null}>
        <ShellContext.Provider value={value}>
          <div className="ui-settings-window flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--color-surface)] text-ink">
            <RouteView />
          </div>
          <AppContextMenu />
        </ShellContext.Provider>
      </TabsProvider>
    );
  }

  if (iphone) {
    return (
      <TabsProvider accountKey={profile.id} workspaceId={context.kind === "workspace" ? context.workspaceId : null}>
        <ShellContext.Provider value={value}>
          <IphoneShell
            banner={
              settings?.bannerMessage ? (
                <div role="status" className="rounded-panel bg-warning-soft px-4 py-2 text-center text-subheadline text-ink shadow-[var(--glass-shadow)]">
                  {settings.bannerMessage}
                  {settings.readOnly ? " Folevi is read-only right now; your edits are kept on this device." : ""}
                </div>
              ) : null
            }
          />
          {globals}
        </ShellContext.Provider>
      </TabsProvider>
    );
  }

  return (
    <TabsProvider accountKey={profile.id} workspaceId={context.kind === "workspace" ? context.workspaceId : null}>
    <ShellContext.Provider value={value}>
      <a href="#main" className="sr-only-focusable ui-btn ui-btn-primary fixed left-2 top-2 z-[70] px-4 py-2">
        Skip to content
      </a>
      {settings?.bannerMessage ? (
        <div role="status" className="border-b border-line bg-warning-soft px-4 py-2 text-center text-subheadline text-ink">
          {settings.bannerMessage}
          {settings.readOnly ? " Folevi is read-only right now; your edits are kept on this device." : ""}
        </div>
      ) : null}
      {/* The app never scrolls as a page: each region scrolls on its own (and nothing can push the tab strip away). */}
      <div className={`ui-canvas ui-shell flex h-dvh min-h-0 overflow-hidden text-ink ${isNarrow ? "" : "gap-2 p-2"}`}>
        {/* Ambient light behind the glass: on a note, its theme image, heavily blurred and veiled. */}
        <div aria-hidden className={`ui-ambient pointer-events-none fixed inset-0 -z-[1] transition-opacity duration-500 ${ambient ? "opacity-100" : "opacity-0"}`}>
          {ambient ? <div className="absolute -inset-24 blur-[56px] saturate-[1.4]" style={{ background: ambient }} /> : null}
          <div className="absolute inset-0" style={{ background: "var(--ambient-veil)" }} />
        </div>
        {isNarrow ? (
          drawerOpen ? <NavDrawer onClose={closeDrawer}>{pageSidebar ? <div ref={setSidebarSlot} className="h-full" /> : <Sidebar onNavigate={closeDrawer} />}</NavDrawer> : null
        ) : !collapsed ? (
          // The iPad's sidebar is iPadOS's width, 320, and isn't dragged (a finger can't hold a 4 pt edge).
          <div ref={sidebarPanel} data-ipad-sidebar={ipad ? "" : undefined} className="relative z-20 flex-none" style={{ width: ipad ? 320 : width }}>
            {pageSidebar ? <div ref={setSidebarSlot} className="h-full" /> : <Sidebar />}
            {ipad ? null : <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuemin={248}
              aria-valuemax={320}
              aria-valuenow={width}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setWidth(Math.max(248, width - 8));
                if (e.key === "ArrowRight") setWidth(Math.min(320, width + 8));
              }}
              className="absolute inset-y-3 -right-[6px] z-10 w-1 cursor-col-resize rounded-chip outline-none transition-colors hover:bg-heading/20 focus-visible:bg-heading/30"
            />}
          </div>
        ) : null}
        {/* While the modal drawer is open, the page behind it is inert (not focusable, hidden from AT). */}
        {/* The content panel. A note brings its own panel (its page on its backdrop), so it sits straight on the canvas. */}
        <div className={`relative flex min-w-0 flex-1 flex-col ${isNarrow ? "" : route.name === "doc" ? "" : "ui-content overflow-hidden rounded-container"}`} inert={isNarrow && drawerOpen}>
          {/* The tab strip floats over the view: content scrolls behind it (views pad their top to clear it). */}
          {!isNarrow ? <TabStrip /> : null}
          <RouteView />
        </div>
      </div>
      {globals}
    </ShellContext.Provider>
    </TabsProvider>
  );
}

/** Top bar shared by all views: sidebar toggle, title/breadcrumbs, and actions. */
export function ViewChrome({ title, subtitle, leading, actions, children, tabTitle, overlay, tint, invert, iphone }: { /** The view in the other theme (dark in light mode, light in dark mode), the rest of the app unchanged: the Vault. */ invert?: boolean; title: ReactNode; /** A short fact next to the title (e.g. "48 notes"), announced politely when it changes. */ subtitle?: ReactNode; leading?: ReactNode; actions?: ReactNode; children: ReactNode; tabTitle?: string; /** Floats over the view without scrolling with it (e.g. the bar for selected notes). */ overlay?: ReactNode; /** A colour the view's background takes a faint wash of (a folder's colour). */ tint?: string; /** How the view looks as a screen of the iPhone app (large title, bar actions); only read there. */ iphone?: IphoneScreenOptions }) {
  const { sidebarOpen, toggleSidebar, drawerMode } = useShell();
  const { route } = useAppRouter();
  useDocumentTitle(tabTitle ?? (typeof title === "string" ? title : undefined));
  useViewTab(tabTitle ?? (typeof title === "string" ? title : undefined));
  const inIphone = useIphoneApp();
  const ipad = useIpadLayout();
  const pane = usePane();
  if (nativeChrome()) {
    // Native chrome mode: the native app draws the bars; the view keeps clear of them by the insets it was given.
    return (
      <div className="relative flex min-h-0 flex-1 flex-col pb-[var(--native-inset-bottom,0px)] pt-[var(--native-inset-top,0px)]">
        <main id="main" tabIndex={-1} className={`min-h-0 flex-1 outline-none ${route.name === "doc" ? "overflow-hidden" : "overflow-y-auto"}`}>
          {children}
        </main>
        {overlay}
      </div>
    );
  }
  if (inIphone) {
    // A view that says nothing about the iPhone app gets a large title, and its facts and actions in a row under it.
    const extra = !iphone && (subtitle || leading || actions) ? (
      <div className="flex flex-wrap items-center gap-2 px-5 pb-2 pt-1">
        {leading}
        {subtitle ? (
          <span role="status" className="mr-auto min-w-0 truncate text-body text-muted">
            {subtitle}
          </span>
        ) : (
          <span className="mr-auto" />
        )}
        {actions}
      </div>
    ) : null;
    const fallback = (tabTitle ?? (typeof title === "string" ? title : "")).replace(/^Tasks · /, "Tasks ");
    return (
      <IphoneScreen options={{ ...iphone, header: iphone?.header ?? extra }} fallbackTitle={fallback} overlay={overlay} tint={tint}>
        {children}
      </IphoneScreen>
    );
  }
  // Save state lives in the sidebar; on phones (sidebar is a drawer) it shows here instead.
  const sync = drawerMode ? <SyncStatus documentId={route.name === "doc" ? route.id : undefined} /> : null;
  // No title bar: the page's name is in its tab and read to screen readers (a visually hidden h1). Only
  // real content remains in a plain row (no box): a view's facts and actions, a note's breadcrumb, and on
  // phones the drawer toggle and save state.
  const showTitle = route.name === "doc";
  const drawerToggle = !sidebarOpen && drawerMode;
  const visible = Boolean(subtitle || leading || actions || sync || drawerToggle || (showTitle && title));
  // Joined notes: each note's top row is a bar to tell which has focus (raised, like the open tab) and to
  // rearrange them. It lines up with the note's panel under it (inset 4, like the panel) with 8 below: drag it, or ‹ › to move one place; × takes the note out into its own tab.
  const joined = showTitle ? pane.joined : undefined;
  const PANE_BTN = "grid h-7 w-7 flex-none place-items-center rounded-control text-faint outline-none transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-30";
  const bar = joined ? (
    <header
      onPointerDown={joined.dragStart}
      title="Drag to rearrange"
      className={`mx-1 mb-2 flex h-10 flex-none select-none items-center gap-1 rounded-panel px-1 transition-[background-color,box-shadow,color] duration-150 ${joined.dragging ? "cursor-grabbing" : "cursor-grab"} ${
        pane.primary
          ? "bg-[var(--color-surface-raised)] text-heading shadow-[0_1px_3px_rgb(0_0_0/0.03),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_5%,transparent)]"
          : "bg-[var(--glass-hover)] text-muted"
      }`}
    >
      <button type="button" aria-label="Move this note left" title="Move left" disabled={joined.index === 0} onClick={() => joined.move(joined.index - 1)} className={PANE_BTN}>
        <ChevronLeft size={14} aria-hidden />
      </button>
      <GripVertical size={14} aria-hidden className="flex-none text-faint" />
      <div className={`flex min-w-0 flex-1 items-baseline gap-2 truncate text-subheadline ${pane.primary ? "" : "opacity-80"}`}>
        {/* The page's breadcrumb when it has one; with the sidebar open it has none, so the note's name. */}
        <div className="min-w-0 truncate">{title ?? <span className="px-1 font-semibold">{tabTitle}</span>}</div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        {sync}
        {actions}
      </div>
      <button type="button" aria-label="Move this note right" title="Move right" disabled={joined.index === joined.count - 1} onClick={() => joined.move(joined.index + 1)} className={PANE_BTN}>
        <ChevronRight size={14} aria-hidden />
      </button>
      <button type="button" aria-label="Take this note out into its own tab" title="Take out into its own tab" onClick={joined.remove} className={PANE_BTN}>
        <X size={13} aria-hidden />
      </button>
    </header>
  ) : !visible ? (
    title ? <div className="sr-only">{title}</div> : null
  ) : (
      <header className={`mx-2 ${drawerMode ? "mt-2" : ""} flex min-h-11 flex-none items-center gap-2 px-2 sm:mx-3 sm:px-5`}>
        {drawerToggle ? (
          <IconButton label="Show sidebar" shortcut="⌘\" onClick={toggleSidebar} aria-expanded={sidebarOpen} aria-haspopup={drawerMode ? "dialog" : undefined} data-drawer-toggle="">
            <PanelLeft size={16} aria-hidden />
          </IconButton>
        ) : null}
        {leading}
        <div className="flex min-w-0 flex-1 items-baseline gap-2 truncate text-subheadline">
          <div className={showTitle ? "min-w-0 truncate" : "sr-only"}>{title}</div>
          {subtitle ? (
            <span role="status" className="min-w-0 truncate text-subheadline text-muted">
              {subtitle}
            </span>
          ) : null}
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {sync}
          {actions}
        </div>
      </header>
  );
  // Phones keep it pinned: it holds the only way to open the navigation drawer.
  const inFlow = route.name !== "doc" && !drawerMode;
  // Room for the floating tab strip (desktop); list views scroll underneath it.
  // (The iPad's strip is taller: 52 pt, 8 from the top.)
  const clear = drawerMode ? "" : ipad ? "pt-[68px] [scroll-padding-top:72px]" : "pt-[56px] [scroll-padding-top:60px]";
  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${tint ? "ui-view-tint" : ""} ${invert ? "ui-invert bg-canvas text-ink" : ""}`} style={tint ? ({ ["--view-tint" as string]: tint } as React.CSSProperties) : undefined}>
      {inFlow ? null : <div className={drawerMode ? "" : ipad ? "pt-[68px]" : "pt-[56px]"}>{bar}</div>}
      {/* A note scrolls inside its own page, so <main> doesn't clip: the page's edge and shadow show whole, and the
          tools panel can run to the window's bottom edge. */}
      <main id="main" tabIndex={-1} className={`min-h-0 flex-1 outline-none ${route.name === "doc" && !drawerMode ? "overflow-visible" : "overflow-y-auto"} ${inFlow ? clear : ""}`}>
        {inFlow ? bar : null}
        {children}
      </main>
      {overlay}
    </div>
  );
}

/** Keeps the recent tabs' note details and page tree loaded, so switching to one needs no round trip. */
function WarmNotes() {
  const { warm } = useTabs();
  return (
    <>
      {warm.map((id) => (
        <WarmNote key={id} documentId={id} />
      ))}
    </>
  );
}

function WarmNote({ documentId }: { documentId: string }) {
  useQuery(api.documents.get, { documentId });
  useQuery(api.documents.pageTree, { documentId });
  return null;
}
