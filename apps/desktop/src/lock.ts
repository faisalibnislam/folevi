// The Touch ID lock (docs/LOCAL_MODE_PLAN.md owner decisions, §4.2 `src/lock.ts`): with it on, Folevi covers
// every window when it opens, when the Mac locks or sleeps, and when Folevi comes back to the front after
// being away longer than "Ask again" says, until Touch ID says it's the owner. The page reads and changes the
// settings through foleviShell.lock (preload.ts, shell:lock-*); turning the lock on or off asks for Touch ID
// too, so someone at an unlocked Mac can't simply switch it off.
//
// The cover is a view of its own over each window's page (a tiny local page with no script, no network and no
// preload), so the notes underneath aren't drawn while it's up. Its Unlock link is a navigation the main
// process cancels and answers with Touch ID.
//
// AppLock is plain logic with its parts passed in (lock.test.ts); electronCover() is the Electron half.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type LockMethod = "touchID" | "none";

export interface LockSettings {
  lock: boolean;
  /** Seconds away before it asks again (0: every time Folevi comes back to the front). */
  lockAfter: number;
  method: LockMethod;
}

export interface LockCover {
  /** Covers every window (and windows opened while it's up: attach). */
  show(): void;
  hide(): void;
}

export interface AppLockDeps {
  /** lock.json in the app's support folder. */
  file: string;
  /** Whether this Mac can ask for Touch ID (systemPreferences.canPromptTouchID). */
  canPrompt(): boolean;
  /** Asks for Touch ID; rejects when it fails or the person cancels (systemPreferences.promptTouchID). */
  prompt(reason: string): Promise<void>;
  cover: LockCover;
  now?: () => number;
}

/** The "Ask again" choices Settings offers; anything else is read as the nearest one below it. */
export const LOCK_AFTER = [0, 60, 300, 900, 3600] as const;

/** A rejection the page can read (contextBridge keeps a plain object's fields). */
export const lockError = (code: "cancelled" | "unavailable" | "invalid_argument", message: string) => Object.assign(new Error(message), { code });

function readFile(file: string): { lock: boolean; lockAfter: number } {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { lock?: unknown; lockAfter?: unknown };
    return { lock: raw.lock === true, lockAfter: validAfter(raw.lockAfter) ?? 0 };
  } catch {
    return { lock: false, lockAfter: 0 };
  }
}

function validAfter(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  let best = 0;
  for (const s of LOCK_AFTER) if (s <= v) best = s;
  return best;
}

export class AppLock {
  private settings: { lock: boolean; lockAfter: number };
  private awaySince: number | null = null;
  private asking: Promise<boolean> | null = null;
  private now: () => number;
  /** True while the windows are covered. */
  locked = false;

  constructor(private deps: AppLockDeps) {
    this.now = deps.now ?? Date.now;
    this.settings = readFile(deps.file);
    // A lock this Mac can no longer honour (Touch ID removed) doesn't shut the person out.
    if (this.settings.lock && deps.canPrompt()) this.lockNow();
  }

  private get on(): boolean {
    return this.settings.lock && this.deps.canPrompt();
  }

  getSettings(): LockSettings {
    const method: LockMethod = this.deps.canPrompt() ? "touchID" : "none";
    return { lock: this.settings.lock && method !== "none", lockAfter: this.settings.lockAfter, method };
  }

  /** From the page. Turning the lock on or off asks for Touch ID first; a cancel leaves it as it was. */
  async setSettings(patch: unknown): Promise<LockSettings> {
    const p = (patch && typeof patch === "object" ? patch : {}) as { lock?: unknown; lockAfter?: unknown };
    const next = { ...this.settings };
    if (p.lockAfter !== undefined) {
      const after = validAfter(p.lockAfter);
      if (after === null) throw lockError("invalid_argument", "lockAfter is a number of seconds.");
      next.lockAfter = after;
    }
    if (p.lock !== undefined) {
      if (typeof p.lock !== "boolean") throw lockError("invalid_argument", "lock is true or false.");
      if (p.lock !== this.settings.lock) {
        if (!this.deps.canPrompt()) throw lockError("unavailable", "This Mac has no Touch ID, or it isn't set up.");
        try {
          await this.deps.prompt(p.lock ? "turn on the Touch ID lock" : "turn off the Touch ID lock");
        } catch {
          throw lockError("cancelled", "Touch ID didn't confirm it.");
        }
      }
      next.lock = p.lock;
    }
    this.settings = next;
    this.save();
    return this.getSettings();
  }

  private save() {
    mkdirSync(dirname(this.deps.file), { recursive: true });
    const tmp = `${this.deps.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lock: this.settings.lock, lockAfter: this.settings.lockAfter }), { mode: 0o600 });
    renameSync(tmp, this.deps.file);
  }

  /** Covers the windows now (the Mac locking or going to sleep, and at launch). */
  lockNow(): void {
    if (!this.on) return;
    this.locked = true;
    this.awaySince = null;
    this.deps.cover.show();
  }

  /** No Folevi window is in front any more. */
  away(): void {
    if (this.awaySince === null) this.awaySince = this.now();
  }

  /** A Folevi window came to the front: locks if it was away long enough, and asks for Touch ID if locked. */
  back(): void {
    const since = this.awaySince;
    this.awaySince = null;
    if (this.on && !this.locked && since !== null && this.now() - since >= this.settings.lockAfter * 1000) this.lockNow();
    if (this.locked) void this.unlock();
  }

  /** Asks for Touch ID (once at a time) and uncovers the windows if it's the owner. */
  unlock(): Promise<boolean> {
    if (!this.locked) return Promise.resolve(true);
    if (!this.deps.canPrompt()) {
      // Touch ID went away while locked: nothing could ever open it.
      this.locked = false;
      this.deps.cover.hide();
      return Promise.resolve(true);
    }
    this.asking ??= this.deps
      .prompt("unlock your notes")
      .then(
        () => {
          this.locked = false;
          this.deps.cover.hide();
          return true;
        },
        () => false,
      )
      .finally(() => {
        this.asking = null;
      });
    return this.asking;
  }
}

// ---- the cover (Electron) ---------------------------------------------------------------------------------

/** The cover's page: no script; "Unlock" is a link to UNLOCK_URL, which the main process cancels and answers. */
export const UNLOCK_URL = "https://unlock.folevi.invalid/";

export function coverHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Folevi is locked</title><style>
:root{color-scheme:light dark;--bg:#fff;--ink:#1d1f1e;--muted:#6b6f6c;--line:#e3e5e3}
@media (prefers-color-scheme:dark){:root{--bg:#141515;--ink:#ecedec;--muted:#9a9e9b;--line:#2c2e2d}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;-webkit-user-select:none;-webkit-app-region:drag}
main{height:100%;display:grid;place-items:center;text-align:center}
div{display:grid;gap:14px;justify-items:center;padding:24px}
h1{margin:0;font-size:22px;font-weight:600}
p{margin:0;color:var(--muted);max-width:320px}
a{-webkit-app-region:no-drag;display:inline-block;margin-top:6px;padding:9px 18px;border-radius:10px;background:var(--ink);color:var(--bg);text-decoration:none;font-weight:600}
a:focus-visible{outline:2px solid var(--muted);outline-offset:3px}
</style></head><body><main><div>
<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>
<h1>Folevi is locked</h1><p>Your notes stay covered until Touch ID says it's you.</p>
<a href="${UNLOCK_URL}">Unlock with Touch ID</a>
</div></main></body></html>`;
}

/** What electronCover needs from Electron, so main.ts passes the real classes and nothing else is imported here. */
export interface CoverWindow {
  isDestroyed(): boolean;
  getContentBounds(): { width: number; height: number };
  on(event: "resize", listener: () => void): unknown;
  removeListener(event: "resize", listener: () => void): unknown;
  contentView: { addChildView(view: unknown): void; removeChildView(view: unknown): void };
  webContents: { focus(): void };
}
export interface CoverView {
  setBounds(b: { x: number; y: number; width: number; height: number }): void;
  webContents: {
    loadURL(url: string): Promise<void>;
    on(event: "will-navigate", listener: (e: { preventDefault(): void }, url: string) => void): unknown;
    setWindowOpenHandler(h: () => { action: "deny" }): void;
    focus(): void;
    close(): void;
  };
}

export function electronCover(o: { windows: () => CoverWindow[]; makeView: () => CoverView; onUnlock: () => void }): LockCover & { attach(win: CoverWindow): void } {
  const views = new Map<CoverWindow, { view: CoverView; fit: () => void }>();
  let up = false;
  const attach = (win: CoverWindow) => {
    if (!up || win.isDestroyed() || views.has(win)) return;
    const view = o.makeView();
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (e, url) => {
      e.preventDefault();
      if (url === UNLOCK_URL) o.onUnlock();
    });
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(coverHtml())}`).catch(() => undefined);
    const fit = () => {
      if (win.isDestroyed()) return;
      const b = win.getContentBounds();
      view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
    };
    fit();
    win.on("resize", fit);
    win.contentView.addChildView(view);
    view.webContents.focus();
    views.set(win, { view, fit });
  };
  return {
    attach,
    show() {
      up = true;
      for (const w of o.windows()) attach(w);
    },
    hide() {
      up = false;
      for (const [win, { view, fit }] of views) {
        if (!win.isDestroyed()) {
          win.removeListener("resize", fit);
          win.contentView.removeChildView(view);
          win.webContents.focus();
        }
        view.webContents.close();
      }
      views.clear();
    },
  };
}
