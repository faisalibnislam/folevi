"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { PanelLeft } from "lucide-react";
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
import { QuickAddTask } from "./QuickAddTask";
import { AppContextMenu } from "./AppContextMenu";
import { AskAiChat } from "@/components/ai/AskAiChat";
import { AI_FOCUS_EVENT } from "@/components/ai/chat/ChatThread";
import { useAiAccess } from "@/components/ai/useAi";
import { SyncStatus } from "./SyncStatus";
import { useCreateDocument } from "./useCreateDocument";
import { captureTemplateFromUrl, clearPendingTemplate, pendingTemplate } from "@/lib/pendingTemplate";
import { DesktopBridge } from "./DesktopBridge";

interface ShellValue {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  openPalette: () => void;
  openQuickAdd: () => void;
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
   * The ambient light behind the glass chrome: a CSS background (a note's style image), or null for neutral;
   * `tone` says whether it reads dark ("deep") or light, so the chrome over it stays readable.
   */
  setAmbient: (css: string | null, tone?: "deep" | "light" | null) => void;
  /** Opens Ask AI (⌘J), optionally with a question typed in, or about one folder's notes. */
  openAsk: (question?: string, folder?: { id: string; name: string }) => void;
  /** The open note takes AI requests (⌘J, Ask AI, the palette) into its AI sidebar; null when it leaves. */
  setNoteAi: (open: ((request: { view: "note" | "all"; question?: string }) => void) | null) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

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
      <div className="ui-pop h-full w-[min(86vw,320px)] animate-[folio-settle_200ms_var(--ease-folio)] rounded-none motion-reduce:animate-none">
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
  const { route, navigate } = useAppRouter();
  const [collapsed, setCollapsed] = useLocalStorage("folevi:sidebar-collapsed", false);
  const [width, setWidth] = useLocalStorage("folevi:sidebar-width", 272);
  const [inspectorPref, setInspectorPref] = useLocalStorage("folevi:inspector-open", false);
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const isMedium = useMediaQuery("(max-width: 1199px)");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [ambient, setAmbientCss] = useState<string | null>(null);
  const [ambientTone, setAmbientTone] = useState<"deep" | "light" | null>(null);
  const setAmbient = useCallback((css: string | null, tone: "deep" | "light" | null = null) => {
    setAmbientCss(css);
    setAmbientTone(css ? tone : null);
  }, []);
  // A dark style in light mode (or a light one in dark mode) gets a stronger veil (globals.css, data-ambient).
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
  const pageSidebar = route.name === "doc" && docSidebarMode === "document";

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
      openQuickAdd: () => setQuickAddOpen(true),
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

  return (
    <TabsProvider accountKey={profile.id} workspaceId={context.kind === "workspace" ? context.workspaceId : null}>
    <ShellContext.Provider value={value}>
      <a href="#main" className="sr-only-focusable ui-btn ui-btn-primary fixed left-2 top-2 z-[70] px-4 py-2">
        Skip to content
      </a>
      {settings?.bannerMessage ? (
        <div role="status" className="border-b border-line bg-warning-soft px-4 py-2 text-center text-sm text-ink">
          {settings.bannerMessage}
          {settings.readOnly ? " Folevi is read-only right now; your edits are kept on this device." : ""}
        </div>
      ) : null}
      {/* The app never scrolls as a page: each region scrolls on its own (and nothing can push the tab strip away). */}
      <div className={`ui-canvas flex h-dvh min-h-0 overflow-hidden text-ink ${isNarrow ? "" : "gap-2 p-2"}`}>
        {/* Ambient light behind the glass: on a note, its style image, heavily blurred and veiled. */}
        <div aria-hidden className={`ui-ambient pointer-events-none fixed inset-0 -z-[1] transition-opacity duration-500 ${ambient ? "opacity-100" : "opacity-0"}`}>
          {ambient ? <div className="absolute -inset-24 blur-[56px] saturate-[1.4]" style={{ background: ambient }} /> : null}
          <div className="absolute inset-0" style={{ background: "var(--ambient-veil)" }} />
        </div>
        {isNarrow ? (
          drawerOpen ? <NavDrawer onClose={closeDrawer}>{pageSidebar ? <div ref={setSidebarSlot} className="h-full" /> : <Sidebar onNavigate={closeDrawer} />}</NavDrawer> : null
        ) : !collapsed ? (
          <div ref={sidebarPanel} className="relative z-20 flex-none" style={{ width }}>
            {pageSidebar ? <div ref={setSidebarSlot} className="h-full" /> : <Sidebar />}
            <div
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
              className="absolute inset-y-3 -right-[6px] z-10 w-1 cursor-col-resize rounded-full outline-none transition-colors hover:bg-heading/20 focus-visible:bg-heading/30"
            />
          </div>
        ) : null}
        {/* While the modal drawer is open, the page behind it is inert (not focusable, hidden from AT). */}
        {/* The content panel. A note brings its own panel (its page on its backdrop), so it sits straight on the canvas. */}
        <div className={`relative flex min-w-0 flex-1 flex-col ${isNarrow ? "" : route.name === "doc" ? "" : "ui-content overflow-hidden rounded-[14px]"}`} inert={isNarrow && drawerOpen}>
          {/* The tab strip floats over the view: content scrolls behind it (views pad their top to clear it). */}
          {!isNarrow ? <TabStrip /> : null}
          <RouteView />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AppContextMenu />
      <DesktopBridge />
      <WarmNotes />
      <QuickAddTask open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
      {/* The floating Ask AI chat (bottom right), only where AI is included and on: Core has no AI, so nothing offers it. */}
      {ai.on ? <AskAiChat open={Boolean(askOpen)} onOpen={() => setAskOpen({})} initial={askOpen?.q} folder={askOpen?.folder} onClose={() => setAskOpen(null)} /> : null}
    </ShellContext.Provider>
    </TabsProvider>
  );
}

/** Top bar shared by all views: sidebar toggle, title/breadcrumbs, and actions. */
export function ViewChrome({ title, subtitle, leading, actions, children, tabTitle, overlay, tint }: { title: ReactNode; /** A short fact next to the title (e.g. "48 notes"), announced politely when it changes. */ subtitle?: ReactNode; leading?: ReactNode; actions?: ReactNode; children: ReactNode; tabTitle?: string; /** Floats over the view without scrolling with it (e.g. the bar for selected notes). */ overlay?: ReactNode; /** A colour the view's background takes a faint wash of (a folder's colour). */ tint?: string }) {
  const { sidebarOpen, toggleSidebar, drawerMode } = useShell();
  const { route } = useAppRouter();
  useDocumentTitle(tabTitle ?? (typeof title === "string" ? title : undefined));
  useViewTab(tabTitle ?? (typeof title === "string" ? title : undefined));
  // Save state lives in the sidebar; on phones (sidebar is a drawer) it shows here instead.
  const sync = drawerMode ? <SyncStatus documentId={route.name === "doc" ? route.id : undefined} /> : null;
  // No title bar: the page's name is in its tab and read to screen readers (a visually hidden h1). Only
  // real content remains in a plain row (no box): a view's facts and actions, a note's breadcrumb, and on
  // phones the drawer toggle and save state.
  const showTitle = route.name === "doc";
  const drawerToggle = !sidebarOpen && drawerMode;
  const visible = Boolean(subtitle || leading || actions || sync || drawerToggle || (showTitle && title));
  const bar = !visible ? (
    title ? <div className="sr-only">{title}</div> : null
  ) : (
      <header className={`mx-2 ${drawerMode ? "mt-2" : ""} flex min-h-11 flex-none items-center gap-2 px-3 sm:mx-3 sm:px-4`}>
        {drawerToggle ? (
          <IconButton label="Show sidebar" shortcut="⌘\" onClick={toggleSidebar} aria-expanded={sidebarOpen} aria-haspopup={drawerMode ? "dialog" : undefined} data-drawer-toggle="">
            <PanelLeft size={16} aria-hidden />
          </IconButton>
        ) : null}
        {leading}
        <div className="flex min-w-0 flex-1 items-baseline gap-2 truncate text-sm">
          <div className={showTitle ? "min-w-0 truncate" : "sr-only"}>{title}</div>
          {subtitle ? (
            <span role="status" className="min-w-0 truncate text-[13px] text-muted">
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
  const clear = drawerMode ? "" : "pt-[60px] [scroll-padding-top:64px]";
  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${tint ? "ui-view-tint" : ""}`} style={tint ? ({ ["--view-tint" as string]: tint } as React.CSSProperties) : undefined}>
      {inFlow ? null : <div className={drawerMode ? "" : "pt-[60px]"}>{bar}</div>}
      <main id="main" tabIndex={-1} className={`min-h-0 flex-1 overflow-y-auto outline-none ${inFlow ? clear : ""}`}>
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
