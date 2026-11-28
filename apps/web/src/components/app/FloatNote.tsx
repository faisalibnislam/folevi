"use client";
// A floating note's window (/float/<id>, lib/app/float.ts): the note's title and text in the main window's editor,
// under a slim bar with the note's name, Always on top (in the desktop apps: Chrome's Picture-in-Picture window is
// always on top), Open in main window and Close. No sidebar, tabs, tools panel or dock: a compact page to keep
// writing beside another app. Edits sync with every other window and device as usual.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AppWindow, Pin, PinOff, X } from "lucide-react";
import { ShellContext, type ShellValue } from "./Shell";
import { FloatTabsProvider } from "@/lib/app/tabs";
import { FloatingContext, type FloatingValue } from "@/lib/app/floatContext";
import { closeFloat, floatTitle, inPip, openInMainWindow } from "@/lib/app/float";
import { desktop, registerMenuCommand } from "@/lib/desktop";
import { useAppRouter } from "@/lib/app/router";
import { inMenuBarPanel } from "@/lib/desktop/menuBarNote";
import { MenuBarComposer, useMenuBarCommands } from "./MenuBarNote";

const DocumentView = lazy(() => import("@/components/doc/DocumentView").then((m) => ({ default: m.DocumentView })));

const noop = () => undefined;

const BAR_BUTTON =
  "grid h-7 w-7 flex-none place-items-center rounded-chip text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** A colour that shows (not fully transparent). */
function solid(c: string | undefined): string | null {
  if (!c || c === "transparent") return null;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m && Number(m[1]!.split(/[ ,/]+/).filter(Boolean)[3] ?? 1) === 0) return null;
  return c;
}

/** The note's paper and ink, read off its page (the sheet's colour, else the page's), kept up to date as the note's
 *  style changes, so the bar wears them and the window is the note's colour from edge to edge. */
function useNoteColours(root: HTMLElement | null): { paper: string; ink: string } | null {
  const [colours, setColours] = useState<{ paper: string; ink: string } | null>(null);
  useEffect(() => {
    if (!root) return;
    const read = () => {
      const sheet = root.querySelector<HTMLElement>(".fb-sheet");
      if (!sheet) return;
      const page = root.querySelector<HTMLElement>("#doc-scroll");
      const s = getComputedStyle(sheet);
      const paper = solid(s.backgroundColor) ?? (page ? solid(getComputedStyle(page).backgroundColor) : null);
      const next = paper ? { paper, ink: s.color } : null;
      setColours((prev) => (prev?.paper === next?.paper && prev?.ink === next?.ink ? prev : next));
    };
    read();
    // At most once a frame: typing changes the page's nodes too.
    let frame = 0;
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), read()));
    };
    const watch = new MutationObserver(soon);
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "data-sheet", "data-text", "data-background", "data-theme"] });
    watch.observe(document.documentElement, { attributes: true });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root]);
  return colours;
}

export function FloatNote({ id }: { id: string }) {
  // The Mac's menu bar note (`?panel=1`, components/app/MenuBarNote.tsx): the same page without the bar (the panel
  // has its own), and `/float/new` there is the empty page that makes a note on the first keystroke.
  const { search } = useAppRouter();
  const panel = inMenuBarPanel(search);
  useMenuBarCommands(panel);
  const [title, setTitle] = useState("");
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const colours = useNoteColours(rootEl);
  const pip = useMemo(() => inPip(), []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-float", panel ? "menu-bar" : pip ? "pip" : "window");
    return () => root.removeAttribute("data-float");
  }, [pip, panel]);
  // ⌘W (the Mac's File > Close Tab) closes the floating window: it holds one note.
  useEffect(() => registerMenuCommand("file.close-tab", () => closeFloat(id)), [id]);
  const onTitle = useCallback(
    (t: string) => {
      setTitle(t);
      floatTitle(id, t);
    },
    [id],
  );
  const floating = useMemo<FloatingValue>(() => ({ id, onTitle }), [id, onTitle]);
  const shell = useMemo<ShellValue>(
    () => ({
      sidebarOpen: false,
      toggleSidebar: noop,
      inspectorOpen: false,
      setInspectorOpen: noop,
      openPalette: noop,
      openQuickAdd: noop,
      isNarrow: true,
      drawerMode: false,
      sidebarSlot: null,
      docSidebarMode: "document",
      setDocSidebarMode: noop,
      focusMode: true,
      setFocusMode: noop,
      setAmbient: noop,
      openAsk: noop,
      setNoteAi: noop,
    }),
    [],
  );
  return (
    <FloatTabsProvider documentId={id}>
      <ShellContext.Provider value={shell}>
        <FloatingContext.Provider value={floating}>
          <div
            ref={setRootEl}
            data-float-root=""
            className="ui-canvas flex h-dvh min-h-0 flex-col overflow-hidden text-ink"
            style={colours ? { ["--float-paper" as string]: colours.paper, ["--float-ink" as string]: colours.ink, background: colours.paper } : undefined}
          >
            {panel ? null : <FloatBar id={id} title={title} tinted={Boolean(colours)} />}
            <div className="relative min-h-0 flex-1">
              {panel && id === "new" ? (
                <MenuBarComposer />
              ) : (
                <Suspense fallback={null}>
                  <DocumentView documentId={id} />
                </Suspense>
              )}
            </div>
          </div>
        </FloatingContext.Provider>
      </ShellContext.Provider>
    </FloatTabsProvider>
  );
}

/** The slim bar: the note's name (the window moves by it), the pin, Open in main window and Close. */
export function FloatBar({ id, title, tinted = false }: { id: string; title: string; tinted?: boolean }) {
  const bridge = desktop();
  // Only the desktop apps can let a window stop floating; null until the app says (or where it can't).
  const [onTop, setOnTop] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void bridge?.floatOnTop?.().then((v) => live && setOnTop(typeof v === "boolean" ? v : null));
    return () => {
      live = false;
    };
  }, [bridge]);
  const name = title || "Untitled";
  return (
    <header data-float-bar="" data-tinted={tinted ? "" : undefined} className="ui-drag flex h-9 flex-none items-center gap-0.5 border-b border-[var(--color-line,transparent)] pl-3 pr-1.5">
      <h1 className="min-w-0 flex-1 truncate text-footnote font-semibold text-heading" title={name}>
        {name}
      </h1>
      {onTop !== null ? (
        <button
          type="button"
          aria-pressed={onTop}
          aria-label="Always on top"
          title={onTop ? "Always on top (on)" : "Always on top (off)"}
          className={`${BAR_BUTTON} ${onTop ? "text-heading" : ""}`}
          onClick={() => {
            const next = !onTop;
            setOnTop(next);
            void bridge?.floatOnTop?.(next).then((v) => typeof v === "boolean" && setOnTop(v));
          }}
        >
          {onTop ? <Pin size={14} aria-hidden /> : <PinOff size={14} aria-hidden />}
        </button>
      ) : null}
      <button type="button" aria-label="Open in main window" title="Open in main window" className={BAR_BUTTON} onClick={() => openInMainWindow(id)}>
        <AppWindow size={14} aria-hidden />
      </button>
      <button type="button" aria-label="Close" title="Close" className={BAR_BUTTON} onClick={() => closeFloat(id)}>
        <X size={14} aria-hidden />
      </button>
    </header>
  );
}
