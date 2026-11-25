// "Float this note" (the owner, 2026-11-25): a note in a small window of its own that stays on top of other apps,
// with full editing. Its page is /float/<id> (components/app/FloatNote.tsx): the note's title and text in the same
// editor as the main window, under a slim bar (the note's name, Always on top, Open in main window, Close). Edits
// sync both ways through the backend, as between any two windows.
//
// Where it opens:
// - Folevi for Mac, Windows and Linux: a window of the app's own (foleviDesktop.floatNote), one per note, its size
//   and place remembered per note, on top of other apps until its pin is turned off.
// - Chrome and Edge: Document Picture-in-Picture (window.documentPictureInPicture), which stays on top of every
//   window. A page may hold one such window, so several floated notes share it, one at a time, with a row to switch
//   between them; each note's size is remembered for when it opens first.
// - Safari, Firefox, the iPhone, iPad and Android apps: nowhere. The menu item isn't shown.
import { desktop, type DesktopBridge } from "@/lib/desktop";

export interface FloatingNote {
  id: string;
  title: string;
}

export type FloatKind = "desktop" | "pip";

/** The page a floating note shows. */
export function floatPath(id: string): string {
  return `/float/${encodeURIComponent(id)}`;
}

/** The note a /float/<id> path is for, or null. */
export function floatIdOf(pathname: string): string | null {
  const m = /^\/float\/([^/?#]+)\/?$/.exec(pathname);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]!);
    return id ? id : null;
  } catch {
    return null;
  }
}

interface FloatEnv {
  bridge: Pick<DesktopBridge, "floatNote"> | null;
  /** window.documentPictureInPicture is there (Chrome and Edge 116+). */
  pip: boolean;
  /** Inside the iPhone, iPad or Android app (no floating windows there). */
  inApp: boolean;
  /** This page is itself a floating note (no floating from inside one). */
  floating: boolean;
}

function currentEnv(): FloatEnv {
  if (typeof window === "undefined") return { bridge: null, pip: false, inApp: false, floating: false };
  const w = window as Window & { Capacitor?: unknown; foleviNative?: unknown };
  return {
    bridge: desktop(),
    pip: "documentPictureInPicture" in window,
    inApp: Boolean(w.Capacitor || w.foleviNative || document.documentElement.hasAttribute("data-native-chrome")),
    floating: floatIdOf(window.location.pathname) !== null,
  };
}

/** How a note can float here, or null where it can't (the menu item is left out). */
export function floatKind(env: FloatEnv = currentEnv()): FloatKind | null {
  if (env.floating) return null;
  if (env.bridge) return typeof env.bridge.floatNote === "function" ? "desktop" : null;
  if (env.inApp) return null;
  return env.pip ? "pip" : null;
}

/** Floats `note`: a new window, or its window brought forward if it's already floating. Call it from a click. */
export function floatNote(note: FloatingNote): void {
  const kind = floatKind();
  if (kind === "desktop") desktop()?.floatNote?.({ id: note.id, title: note.title });
  else if (kind === "pip") void pipFloats().open(note);
}

/** The menu item's words. */
export const FLOAT_LABEL = "Float this note";

// ---------------------------------------------------------------- inside a floating note

/** Whether this page is a floating note's (/float/<id>, any window). */
export function inFloatWindow(): boolean {
  return typeof window !== "undefined" && floatIdOf(window.location.pathname) !== null;
}

/** Inside Chrome's Picture-in-Picture window (the page is in an iframe there, ?pip=1). */
export function inPip(): boolean {
  return typeof window !== "undefined" && window.parent !== window && new URLSearchParams(window.location.search).get("pip") === "1";
}

/** What a floating note's page tells the Picture-in-Picture window around it. */
export type PipMessage = { folevi: "float"; action: "close" | "open-main" | "title"; id: string; title?: string; path?: string };

function tellPip(message: PipMessage) {
  try {
    window.parent.postMessage(message, window.location.origin);
  } catch {
    // The window around it is gone.
  }
}

/** The bar's Close. */
export function closeFloat(id: string) {
  if (inPip()) tellPip({ folevi: "float", action: "close", id });
  else if (desktop()?.closeWindow) desktop()!.closeWindow!();
  else window.close();
}

/** The bar's Open in main window (or any other page of the app asked for from a floating note). */
export function openInMainWindow(id: string, path: string = `/d/${id}`) {
  if (inPip()) tellPip({ folevi: "float", action: "open-main", id, path });
  else desktop()?.openInMain(path);
}

/** The note's name changed: the switcher in the Picture-in-Picture window says so. */
export function floatTitle(id: string, title: string) {
  if (inPip()) tellPip({ folevi: "float", action: "title", id, title });
}

/**
 * A link followed inside a floating note (a page link, a mention, a breadcrumb) opens in the main window: the
 * floating window keeps its note. True when it was sent there (the router does nothing more).
 */
export function routeFromFloat(href: string): boolean {
  if (typeof window === "undefined") return false;
  const id = floatIdOf(window.location.pathname);
  if (!id) return false;
  const to = new URL(href, window.location.href);
  if (to.origin !== window.location.origin || floatIdOf(to.pathname) !== null) return false;
  openInMainWindow(id, to.pathname + to.search + to.hash);
  return true;
}

// ---------------------------------------------------------------- remembered sizes

export interface FloatSize {
  width: number;
  height: number;
}

export const FLOAT_DEFAULT_SIZE: FloatSize = { width: 380, height: 480 };
const SIZE_KEY = "folevi:float-size:";

/** Keeps a size within what a floating note may be. */
export function clampFloatSize(s: Partial<FloatSize> | null | undefined): FloatSize {
  const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
  return { width: n(s?.width, FLOAT_DEFAULT_SIZE.width, 260, 1200), height: n(s?.height, FLOAT_DEFAULT_SIZE.height, 200, 1200) };
}

export function readFloatSize(id: string, store: Pick<Storage, "getItem"> | null = safeStorage()): FloatSize {
  try {
    const raw = store?.getItem(SIZE_KEY + id);
    return clampFloatSize(raw ? (JSON.parse(raw) as Partial<FloatSize>) : null);
  } catch {
    return clampFloatSize(null);
  }
}

export function saveFloatSize(id: string, size: FloatSize, store: Pick<Storage, "setItem"> | null = safeStorage()) {
  try {
    store?.setItem(SIZE_KEY + id, JSON.stringify(clampFloatSize(size)));
  } catch {
    // Storage full or off: the next open uses the default.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Chrome's Picture-in-Picture window

interface DocumentPip {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

/** Where "Open in main window" goes on the website (set by the main window's Shell: a tab on the note). */
let openMainHandler: ((path: string) => void) | null = null;
export function setFloatOpenMain(handler: ((path: string) => void) | null) {
  openMainHandler = handler;
}

/**
 * The website's floating notes, in the one Picture-in-Picture window a page may have. Each note is an iframe on its
 * /float page (its own editor and connection, as a window of the desktop apps has); one shows at a time and a row
 * of the notes' names switches between them once there are two. Exported for tests (a fake `pip` and document).
 */
export class PipFloats {
  win: Window | null = null;
  readonly notes = new Map<string, { title: string; frame: HTMLIFrameElement }>();
  active: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly pip: () => DocumentPip | null = () => (window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null,
    private readonly host: Window = window,
  ) {}

  /** Floats `note` (it shows, and the window comes forward). Must run in a click: the browser asks for one. */
  async open(note: FloatingNote): Promise<void> {
    if (this.win && !this.win.closed) {
      this.add(note);
      this.show(note.id);
      try {
        this.win.focus();
      } catch {
        // Some browsers don't let a page focus its Picture-in-Picture window.
      }
      return;
    }
    const pip = this.pip();
    if (!pip) return;
    const size = readFloatSize(note.id);
    // Asked for first, with nothing awaited before it: the browser only opens it during the click.
    const win = await pip.requestWindow({ width: size.width, height: size.height });
    this.win = win;
    this.notes.clear();
    this.active = null;
    this.build(win);
    this.add(note);
    this.show(note.id);
  }

  /** Whether `id` is floating here now. */
  has(id: string): boolean {
    return Boolean(this.win && !this.win.closed && this.notes.has(id));
  }

  private build(win: Window) {
    const doc = win.document;
    // The app's styles and fonts, so the switcher looks like Folevi (each note's own page loads its own).
    for (const node of Array.from(this.host.document.querySelectorAll('link[rel="stylesheet"], style'))) doc.head.appendChild(node.cloneNode(true));
    const root = this.host.document.documentElement;
    for (const attr of ["data-theme", "class", "style"]) {
      const v = root.getAttribute(attr);
      if (v !== null) doc.documentElement.setAttribute(attr, v);
    }
    doc.documentElement.setAttribute("data-float-host", "");
    doc.title = "Folevi";
    const base = doc.createElement("style");
    base.textContent =
      "html,body{margin:0;height:100%;overflow:hidden}body{display:flex;flex-direction:column;background:var(--color-canvas,Canvas)}" +
      "[data-float-switcher]{display:flex;gap:4px;padding:6px 8px 0;overflow-x:auto;flex:none}" +
      "[data-float-switcher][hidden]{display:none}" +
      "[data-float-switcher] button{max-width:10rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;border-radius:8px;padding:3px 10px;font:inherit;font-size:12px;background:transparent;color:var(--color-muted,GrayText);cursor:default}" +
      "[data-float-switcher] button:hover{background:var(--glass-hover,rgba(0,0,0,.06));color:var(--color-heading,CanvasText)}" +
      "[data-float-switcher] button[aria-current=true]{background:var(--glass-active,rgba(0,0,0,.08));color:var(--color-heading,CanvasText);font-weight:600}" +
      "[data-float-frames]{position:relative;flex:1;min-height:0}" +
      "[data-float-frames] iframe{position:absolute;inset:0;width:100%;height:100%;border:0}" +
      "[data-float-frames] iframe[hidden]{display:none}";
    doc.head.appendChild(base);
    const bar = doc.createElement("nav");
    bar.setAttribute("data-float-switcher", "");
    bar.setAttribute("aria-label", "Floating notes");
    bar.hidden = true;
    const frames = doc.createElement("div");
    frames.setAttribute("data-float-frames", "");
    doc.body.append(bar, frames);
    win.addEventListener("message", (e) => this.onMessage(e as MessageEvent));
    win.addEventListener("resize", () => this.rememberSize());
    win.addEventListener("pagehide", () => {
      this.rememberSize(true);
      if (this.win === win) {
        this.win = null;
        this.notes.clear();
        this.active = null;
      }
    });
  }

  private add(note: FloatingNote) {
    const win = this.win!;
    const existing = this.notes.get(note.id);
    if (existing) {
      if (note.title) existing.title = note.title;
      this.drawSwitcher();
      return;
    }
    const frame = win.document.createElement("iframe");
    frame.title = note.title || "Untitled";
    frame.src = new URL(`${floatPath(note.id)}?pip=1`, this.host.location.href).toString();
    frame.setAttribute("allow", "clipboard-read; clipboard-write");
    frame.hidden = true;
    win.document.querySelector("[data-float-frames]")!.appendChild(frame);
    this.notes.set(note.id, { title: note.title, frame });
    this.drawSwitcher();
  }

  show(id: string) {
    if (!this.notes.has(id)) return;
    this.rememberSize(true);
    this.active = id;
    for (const [nid, n] of this.notes) n.frame.hidden = nid !== id;
    this.drawSwitcher();
    if (this.win) this.win.document.title = this.notes.get(id)!.title || "Untitled";
    try {
      this.notes.get(id)!.frame.focus();
    } catch {
      // Not focusable yet.
    }
  }

  close(id: string) {
    const n = this.notes.get(id);
    if (!n) return;
    n.frame.remove();
    this.notes.delete(id);
    if (!this.notes.size) {
      this.rememberSize(true);
      this.win?.close();
      this.win = null;
      this.active = null;
      return;
    }
    if (this.active === id) this.show(this.notes.keys().next().value as string);
    else this.drawSwitcher();
  }

  private drawSwitcher() {
    const win = this.win;
    if (!win) return;
    const bar = win.document.querySelector<HTMLElement>("[data-float-switcher]");
    if (!bar) return;
    bar.hidden = this.notes.size < 2;
    bar.replaceChildren(
      ...Array.from(this.notes, ([id, n]) => {
        const b = win.document.createElement("button");
        b.type = "button";
        b.textContent = n.title || "Untitled";
        b.title = n.title || "Untitled";
        b.setAttribute("aria-current", String(id === this.active));
        b.addEventListener("click", () => this.show(id));
        return b;
      }),
    );
  }

  private rememberSize(now = false) {
    const win = this.win;
    const id = this.active;
    if (!win || !id || win.closed) return;
    const size = { width: win.innerWidth, height: win.innerHeight };
    if (!size.width || !size.height) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (now) saveFloatSize(id, size);
    else this.saveTimer = setTimeout(() => saveFloatSize(id, size), 300);
  }

  private onMessage(e: MessageEvent) {
    const m = e.data as Partial<PipMessage> | null;
    if (!m || m.folevi !== "float" || typeof m.id !== "string" || e.origin !== this.host.location.origin) return;
    const from = this.notes.get(m.id);
    if (!from || e.source !== from.frame.contentWindow) return;
    if (m.action === "close") this.close(m.id);
    else if (m.action === "title" && typeof m.title === "string") {
      from.title = m.title.slice(0, 200);
      from.frame.title = from.title || "Untitled";
      if (this.active === m.id && this.win) this.win.document.title = from.title || "Untitled";
      this.drawSwitcher();
    } else if (m.action === "open-main") {
      const path = typeof m.path === "string" && m.path.startsWith("/") && !m.path.startsWith("//") ? m.path : `/d/${m.id}`;
      if (openMainHandler) openMainHandler(path);
      else this.host.location.assign(path);
      try {
        this.host.focus();
      } catch {
        // The browser may keep the focus where it is.
      }
    }
  }
}

let floats: PipFloats | null = null;
function pipFloats(): PipFloats {
  floats ??= new PipFloats();
  return floats;
}
