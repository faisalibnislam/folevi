"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { useDocumentTitle } from "@/lib/hooks/useTitle";
import { IconButton } from "@/components/ui/Button";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { QuickAddTask } from "./QuickAddTask";
import { RouteView } from "./RouteView";
import { useCreateDocument } from "./useCreateDocument";

interface ShellValue {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  openPalette: () => void;
  openQuickAdd: () => void;
  isNarrow: boolean;
}

const ShellContext = createContext<ShellValue | null>(null);
export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell outside Shell");
  return ctx;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
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
  const createDocument = useCreateDocument();
  const settings = useQuery(api.settings.status, {});

  useEffect(() => setDrawerOpen(false), [route]);

  const sidebarOpen = isNarrow ? drawerOpen : !collapsed;
  const toggleSidebar = useCallback(() => {
    if (isNarrow) setDrawerOpen((o) => !o);
    else setCollapsed(!collapsed);
  }, [isNarrow, collapsed, setCollapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "k") {
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
    }),
    [sidebarOpen, toggleSidebar, inspectorPref, setInspectorPref, isNarrow, isMedium],
  );

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(248, Math.min(320, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
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
      <div className="ui-canvas flex h-dvh min-h-0 text-ink">
        {isNarrow ? (
          drawerOpen ? (
            <div className="fixed inset-0 z-40 flex">
              <div className="h-full w-[min(86vw,320px)] animate-[folio-settle_200ms_var(--ease-folio)] bg-sidebar shadow-[var(--shadow-pop)]">
                <Sidebar onNavigate={() => setDrawerOpen(false)} />
              </div>
              <button type="button" aria-label="Close sidebar" className="flex-1 bg-[var(--color-scrim)] backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} />
            </div>
          ) : null
        ) : !collapsed ? (
          <div className="relative flex-none bg-[color-mix(in_oklab,var(--color-sidebar)_82%,transparent)] shadow-[inset_-1px_0_0_var(--color-line)]" style={{ width }}>
            <Sidebar />
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
              className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none transition-colors hover:bg-ember/25 focus-visible:bg-ember/35"
            />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <RouteView />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickAddTask open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
    </ShellContext.Provider>
  );
}

/** Top bar shared by all views: sidebar toggle, title/breadcrumbs, and actions. */
export function ViewChrome({ title, leading, actions, children, tabTitle }: { title: ReactNode; leading?: ReactNode; actions?: ReactNode; children: ReactNode; tabTitle?: string }) {
  const { sidebarOpen, toggleSidebar } = useShell();
  useDocumentTitle(tabTitle ?? (typeof title === "string" ? title : undefined));
  return (
    <>
      <header className="flex h-[52px] flex-none items-center gap-2 px-3 sm:px-4">
        {!sidebarOpen ? (
          <IconButton label="Show sidebar" shortcut="⌘\" onClick={toggleSidebar}>
            <PanelLeft size={16} aria-hidden />
          </IconButton>
        ) : null}
        <HistoryPills />
        {leading}
        <div className="min-w-0 flex-1 truncate text-sm">{title}</div>
        <div className="flex flex-none items-center gap-1.5">{actions}</div>
      </header>
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
        {children}
      </main>
    </>
  );
}

/** Back / forward as one raised pill pair (browser history drives the in-app router). */
function HistoryPills() {
  return (
    <div className="ui-raised hidden flex-none items-center rounded-full p-0.5 sm:flex" role="group" aria-label="History">
      <button type="button" aria-label="Back" title="Back (⌘[)" onClick={() => window.history.back()} className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-heading">
        <ChevronLeft size={16} aria-hidden />
      </button>
      <span className="h-4 w-px bg-line" aria-hidden />
      <button type="button" aria-label="Forward" title="Forward (⌘])" onClick={() => window.history.forward()} className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-heading">
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}
