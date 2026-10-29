// The bridge's JavaScript side (docs/NATIVE_APP_PLAN.md section 3): takes native's messages
// (`__foleviEngine.handle(json)`), runs live views with windowed lists and diffs, commands and editor commands, and
// posts updates and events back in batches, at most once a frame. Pure TypeScript: EngineHost.tsx attaches the
// page's data layer to it (`attach(deps)`), tests attach fakes.
import { ConvexError } from "convex/values";
import type { EngineDeps, ViewContext } from "./context";
import { Emitter, toEngineError } from "./live";
import { clampWindow, windowDiff, type ListState } from "./diff";
import { followsSpace, parseViewArgs, type ListViewDef, type LiveList, type LiveValue, type ValueViewDef } from "./views";
import { COMMANDS, LIST_VIEWS, VALUE_VIEWS } from "./registry";
import { activeNote, isNoteReady, onNoteHost, resetNoteReady, setNativePanes, setNoteEmitter, type NativePanes } from "./noteHost";
import { setToastSink } from "./toasts";
import { actOnGate, currentGate, onGate } from "./gates";
import { routeWindowOpen } from "./navigation";
import { BridgeError, argsOf, bool, id as idArg, ids as idsArg, invalid, oneOf, only } from "./validate";
import {
  BIG_PAYLOAD_BYTES,
  COMMAND_NAMES,
  CONTRACT_REVISION,
  EDITOR_COMMAND_NAMES,
  EVENT_NAMES,
  FEATURES,
  LIST_VIEW_NAMES,
  MESSAGE_HANDLER,
  PROTOCOL_VERSION,
  VIEW_NAMES,
  WEB_PAGES,
  schemaHash,
  type CommandName,
  type EditorCommandName,
  type EngineError,
  type EventMap,
  type EventMessage,
  type EventName,
  type HelloValue,
  type ListDiff,
  type ListViewName,
  type ListWindow,
  type NativeChromeMarker,
  type Reply,
  type UpdateMessage,
  type ViewName,
} from "./protocol";

type Outgoing = UpdateMessage | EventMessage;

/** Where each web page the native app shows lives (owner decisions Q1 and Q2). */
export const WEB_PAGE_ROUTES = {
  "settings.connectedApps": "/settings/connected-apps",
  "settings.workspaceData": "/settings/workspace-data",
  "settings.data": "/settings/data",
  "settings.aiExport": "/settings/ai",
  reviews: "/review",
  graph: "/graph",
  "settings.security": "/settings/security",
  "settings.privacy": "/settings/privacy",
  "settings.workspace": "/settings/workspace",
  "settings.deleteAccount": "/settings/account",
} as const;

export { WEB_SETTINGS_SECTIONS } from "./webSettings";

export interface HostOptions {
  /** Hands one batch (a JSON string) to native. Default: the WebKit message handler. */
  post?: (json: string) => void;
  /** Runs `fn` before the next frame. Default: requestAnimationFrame, with a timer for hidden pages. */
  schedule?: (fn: () => void) => void;
  /** The web export's build id for hello. */
  build?: string;
  marker?: NativeChromeMarker | null;
  /** How long a one-off `query` waits for a live answer before replying with what it has (ms). */
  queryTimeoutMs?: number;
  /** Uploads a big batch to the scheme's `/_bridge/<id>` route (default: fetch POST). */
  upload?: (id: string, body: string) => Promise<void>;
}

interface Sub {
  id: string;
  name: ViewName | ListViewName;
  args: Record<string, unknown>;
  def: ValueViewDef | ListViewDef;
  live: LiveValue | LiveList | null;
  off: (() => void) | null;
  rev: number;
  /** Value views: the JSON of the last value sent. */
  last: string | undefined;
  lastStale: boolean;
  lastError: string | undefined;
  list: ListState | null;
  window: ListWindow;
  dirty: boolean;
  /** Internal subscriptions send an event instead of updates. */
  asEvent?: EventName;
}

function defaultSchedule(fn: () => void): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  // A page WebKit keeps behind the native screens may get no frames: a timer makes sure the batch goes.
  setTimeout(run, 32);
}

function defaultPost(json: string): void {
  const w = globalThis as unknown as { webkit?: { messageHandlers?: Record<string, { postMessage(m: string): void }> }; foleviEngineHost?: { postMessage(m: string): void } };
  const handler = w.webkit?.messageHandlers?.[MESSAGE_HANDLER] ?? w.foleviEngineHost;
  handler?.postMessage(json);
}

async function defaultUpload(id: string, body: string): Promise<void> {
  const res = await fetch(`/_bridge/${id}`, { method: "POST", body, headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`The bridge body route answered ${res.status}.`);
}

const errorOf = (e: unknown): EngineError => (e instanceof BridgeError ? e.toEngineError() : e instanceof ConvexError ? toEngineError(e) : toEngineError(e));

const isViewName = (n: unknown): n is ViewName => typeof n === "string" && (VIEW_NAMES as readonly string[]).includes(n);
const isListViewName = (n: unknown): n is ListViewName => typeof n === "string" && (LIST_VIEW_NAMES as readonly string[]).includes(n);
const isCommandName = (n: unknown): n is CommandName => typeof n === "string" && (COMMAND_NAMES as readonly string[]).includes(n);
const isEditorName = (n: unknown): n is EditorCommandName => typeof n === "string" && (EDITOR_COMMAND_NAMES as readonly string[]).includes(n);

export class BridgeHost {
  private deps: EngineDeps | null = null;
  private appEmitter = new Emitter();
  private subs = new Map<string, Sub>();
  private internal = new Map<string, Sub>();
  private queue: Outgoing[] = [];
  private scheduled = false;
  private posting: Promise<void> = Promise.resolve();
  private bodies = 0;
  private uploading = 0;
  private shownNote: string | null = null;
  private lastPanel: string | null | undefined = undefined;
  private readonly post: (json: string) => void;
  private readonly schedule: (fn: () => void) => void;
  private readonly upload: (id: string, body: string) => Promise<void>;
  private readonly offNoteHost: () => void;
  private readonly offGate: () => void;
  /** The JSON of the last gate.changed sent. */
  private lastGate: string | undefined = undefined;
  readonly ctx: ViewContext;

  constructor(private opts: HostOptions = {}) {
    this.post = opts.post ?? defaultPost;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.upload = opts.upload ?? defaultUpload;
    this.ctx = {
      deps: () => {
        if (!this.deps) throw new BridgeError("engine_not_ready", "Folevi is still starting.");
        return this.deps;
      },
      appSignal: this.appEmitter,
    };
    setToastSink((e) => this.emit("toast", e));
    setNoteEmitter((name, data) => this.emit(name, data));
    // The screen native should show: sent at the next flush when it changed (several reports in one frame are one).
    this.offGate = onGate(() => this.requestFlush());
    this.lastGate = JSON.stringify(currentGate());
    // A note that registers or becomes ready may change what editor.state says.
    this.offNoteHost = onNoteHost(() => {
      const note = activeNote();
      if (note) this.emit("editor.panel", { panel: note.panel() });
    });
  }

  /** The place this Page View is bound to. */
  place(): string | null {
    return this.deps?.app.place ?? this.opts.marker?.place ?? null;
  }

  get ready(): boolean {
    return this.deps !== null;
  }

  /** The page's data layer is up (or changed). Restarts what depends on what changed. */
  attach(deps: EngineDeps): void {
    const prev = this.deps;
    this.deps = deps;
    if (!prev) {
      this.startInternal();
      for (const sub of this.subs.values()) this.restart(sub);
      this.emit("engine.ready", { place: this.place(), protocol: PROTOCOL_VERSION, revision: CONTRACT_REVISION });
      return;
    }
    const all = prev.client !== deps.client || prev.app.accountKey !== deps.app.accountKey || prev.app.place !== deps.app.place;
    const spaceMoved = prev.app.space !== deps.app.space;
    if (all) {
      for (const sub of [...this.subs.values(), ...this.internal.values()]) this.restart(sub);
    } else if (spaceMoved) {
      for (const sub of [...this.subs.values(), ...this.internal.values()]) if (followsSpace(sub.args)) this.restart(sub);
    }
    if (spaceMoved || prev.app.place !== deps.app.place) this.emit("place.changed", { place: this.place(), space: deps.app.space });
    this.appEmitter.emit();
  }

  /** The data layer went away (signed out, switching places): views stop until the next attach. */
  detach(): void {
    if (!this.deps) return;
    for (const sub of [...this.subs.values(), ...this.internal.values()]) this.stop(sub);
    this.internal.clear();
    this.deps = null;
  }

  /** Ends everything (the page is going away). */
  dispose(): void {
    this.detach();
    this.subs.clear();
    this.offNoteHost();
    this.offGate();
    setToastSink(null);
    setNoteEmitter(null);
  }

  /** Native's entry point: one message as JSON (or an object), the reply as JSON. */
  async handle(raw: unknown): Promise<string> {
    return JSON.stringify(await this.handleMessage(raw));
  }

  async handleMessage(raw: unknown): Promise<Reply> {
    let msg: Record<string, unknown>;
    try {
      msg = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    } catch {
      return { kind: "reply", id: "", ok: false, error: { code: "invalid_message", message: "The message isn't JSON." } };
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { kind: "reply", id: "", ok: false, error: { code: "invalid_message", message: "The message isn't an object." } };
    const id = typeof msg.id === "string" ? msg.id : "";
    const fail = (e: unknown): Reply => ({ kind: "reply", id, ok: false, error: errorOf(e) });
    if (!id) return fail(new BridgeError("invalid_message", "The message has no id."));
    if (msg.v !== PROTOCOL_VERSION) return fail(new BridgeError("protocol_mismatch", `This message speaks bridge protocol ${String(msg.v)}; the page speaks ${PROTOCOL_VERSION}.`, { app: msg.v as number, page: PROTOCOL_VERSION }));
    try {
      const value = await this.dispatch(msg);
      return { kind: "reply", id, ok: true, value };
    } catch (e) {
      return fail(e);
    }
  }

  private async dispatch(msg: Record<string, unknown>): Promise<unknown> {
    switch (msg.kind) {
      case "hello":
        return this.hello(msg);
      case "watch":
        return this.watch(msg);
      case "unwatch": {
        const sub = this.subs.get(idArg(msg, "sub"));
        if (sub) {
          this.stop(sub);
          this.subs.delete(sub.id);
        }
        return { ok: true };
      }
      case "window": {
        const sub = this.subs.get(idArg(msg, "sub"));
        if (!sub) throw new BridgeError("unknown_subscription", `There's no subscription “${String(msg.sub)}”.`);
        if (sub.def.kind !== "list") throw new BridgeError("invalid_args", "Only list views have a window.");
        sub.window = clampWindow(msg.window as ListWindow | undefined);
        this.markDirty(sub);
        return { ok: true };
      }
      case "query":
        return this.query(msg);
      case "command": {
        // A gate's button works before the data layer is up (that's when gates show).
        if (msg.name === "gate.act") {
          const args = argsOf(msg.args);
          only(args, ["action", "values"]);
          const values = argsOf(args.values);
          if (!Object.values(values).every((v) => typeof v === "string")) throw new BridgeError("invalid_args", "values must be text by field id.");
          await actOnGate(idArg(args, "action"), values as Record<string, string>);
          return { ok: true };
        }
        this.checkPlace(msg);
        if (!isCommandName(msg.name)) throw new BridgeError("unknown_command", `There's no command named “${String(msg.name)}”.`);
        const deps = this.ctx.deps();
        return COMMANDS[msg.name].run(deps, argsOf(msg.args));
      }
      case "editor":
        return this.editor(msg);
      default:
        throw new BridgeError("invalid_message", `Unknown message kind “${String(msg.kind)}”.`);
    }
  }

  private hello(msg: Record<string, unknown>): HelloValue {
    const app = (msg.app ?? {}) as { protocol?: unknown };
    if (app.protocol !== PROTOCOL_VERSION) {
      throw new BridgeError("protocol_mismatch", `This app speaks bridge protocol ${String(app.protocol)}; the page speaks ${PROTOCOL_VERSION}. Reinstall Folevi.`, { app: app.protocol as number, page: PROTOCOL_VERSION });
    }
    return {
      protocol: PROTOCOL_VERSION,
      revision: CONTRACT_REVISION,
      build: this.opts.build ?? "dev",
      schemaHash: schemaHash(),
      ready: this.ready,
      place: this.place(),
      features: [...FEATURES],
      views: [...VIEW_NAMES],
      listViews: [...LIST_VIEW_NAMES],
      commands: [...COMMAND_NAMES],
      editorCommands: [...EDITOR_COMMAND_NAMES],
      events: [...EVENT_NAMES],
      gate: currentGate(),
    };
  }

  private checkPlace(msg: Record<string, unknown>): void {
    if (typeof msg.place !== "string" || !msg.place) throw new BridgeError("invalid_message", "The message names no place.");
    if (!this.deps) throw new BridgeError("engine_not_ready", "Folevi is still starting.");
    const expected = this.place();
    if (expected && msg.place !== expected) throw new BridgeError("place_mismatch", "This window shows another place.", { expected, got: msg.place });
  }

  private viewDef(name: unknown): ValueViewDef | ListViewDef {
    if (isViewName(name)) return VALUE_VIEWS[name];
    if (isListViewName(name)) return LIST_VIEWS[name];
    throw new BridgeError("unknown_view", `There's no view named “${String(name)}”.`);
  }

  private watch(msg: Record<string, unknown>): { sub: string } {
    const subId = idArg(msg, "sub");
    this.checkPlace(msg);
    const def = this.viewDef(msg.name);
    const args = parseViewArgs(def, msg.args);
    const old = this.subs.get(subId);
    if (old) this.stop(old);
    const sub: Sub = {
      id: subId,
      name: msg.name as ViewName | ListViewName,
      args,
      def,
      live: null,
      off: null,
      rev: 0,
      last: undefined,
      lastStale: false,
      lastError: undefined,
      list: null,
      window: clampWindow(msg.window as ListWindow | undefined),
      dirty: false,
    };
    this.subs.set(subId, sub);
    this.start(sub);
    return { sub: subId };
  }

  private start(sub: Sub): void {
    if (!this.deps) return;
    try {
      sub.live = sub.def.create(this.ctx, sub.args) as LiveValue | LiveList;
    } catch (e) {
      sub.live = null;
      this.sendError(sub, errorOf(e));
      return;
    }
    const offs = sub.live.signals.map((s) => s.subscribe(() => this.markDirty(sub)));
    sub.off = () => {
      for (const off of offs) off();
    };
    this.markDirty(sub);
  }

  private stop(sub: Sub): void {
    sub.off?.();
    sub.off = null;
    sub.live?.dispose?.();
    sub.live = null;
    sub.dirty = false;
  }

  /** Starts a subscription over: the next update is a whole value (lists: `reset`). */
  private restart(sub: Sub): void {
    this.stop(sub);
    sub.last = undefined;
    sub.lastStale = false;
    sub.lastError = undefined;
    sub.list = null;
    this.start(sub);
  }

  private markDirty(sub: Sub): void {
    sub.dirty = true;
    this.requestFlush();
  }

  private requestFlush(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => this.flush());
  }

  /** Computes what changed and posts one batch. Public for tests. */
  flush(): void {
    this.scheduled = false;
    const gate = currentGate();
    const gateJson = JSON.stringify(gate);
    if (gateJson !== this.lastGate) {
      this.lastGate = gateJson;
      this.queue.push({ kind: "event", name: "gate.changed", data: gate });
    }
    for (const sub of [...this.internal.values(), ...this.subs.values()]) {
      if (!sub.dirty) continue;
      sub.dirty = false;
      if (!sub.live) continue;
      try {
        if (sub.def.kind === "list") this.flushList(sub, sub.live as LiveList);
        else this.flushValue(sub, sub.live as LiveValue);
      } catch (e) {
        this.sendError(sub, errorOf(e));
      }
    }
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    this.send(JSON.stringify(batch));
  }

  private send(json: string): void {
    if (json.length <= BIG_PAYLOAD_BYTES) {
      // In order: after a big batch still uploading, if there is one.
      if (this.uploading === 0) this.post(json);
      else this.posting = this.posting.then(() => this.post(json));
      return;
    }
    const id = `eng${Date.now().toString(36)}${(++this.bodies).toString(36)}`;
    this.uploading++;
    this.posting = this.posting
      .then(() =>
        this.upload(id, json).then(
          () => this.post(JSON.stringify({ bodyId: id })),
          (e) => console.warn("[engine] A big batch couldn't be handed over.", e instanceof Error ? e.message : e),
        ),
      )
      .finally(() => {
        this.uploading--;
      });
  }

  private flushValue(sub: Sub, live: LiveValue): void {
    const snap = live.compute();
    if (snap.error) {
      const key = `${snap.error.code}:${snap.error.message}`;
      if (key === sub.lastError) return;
      sub.lastError = key;
      sub.last = undefined;
      this.out(sub, { error: snap.error });
      return;
    }
    if (snap.value === undefined) return;
    const json = JSON.stringify(snap.value);
    if (json === sub.last && snap.stale === sub.lastStale && sub.lastError === undefined) return;
    sub.last = json;
    sub.lastStale = snap.stale;
    sub.lastError = undefined;
    this.out(sub, { value: snap.value, ...(snap.stale ? { stale: true } : {}) });
  }

  private flushList(sub: Sub, live: LiveList): void {
    live.ensure(sub.window.start + sub.window.count);
    const snap = live.compute();
    const ids = snap.error ? [] : snap.ids;
    const { diff, next } = windowDiff(sub.list, ids, snap.rows, sub.window, snap.error ? true : snap.complete);
    sub.list = next;
    const errKey = snap.error ? `${snap.error.code}:${snap.error.message}` : undefined;
    if (!diff && snap.stale === sub.lastStale && errKey === sub.lastError) return;
    sub.lastStale = snap.stale;
    sub.lastError = errKey;
    const d: ListDiff = diff ?? { total: next.total, complete: next.complete, start: next.start };
    this.out(sub, { diff: d, ...(snap.stale ? { stale: true } : {}), ...(snap.error ? { error: snap.error } : {}) });
  }

  private sendError(sub: Sub, error: EngineError): void {
    const key = `${error.code}:${error.message}`;
    if (key === sub.lastError) return;
    sub.lastError = key;
    this.out(sub, { error });
    if (this.queue.length) this.requestFlush();
  }

  private out(sub: Sub, body: Omit<UpdateMessage, "kind" | "sub" | "rev">): void {
    if (sub.asEvent) {
      if (body.value !== undefined) this.queue.push({ kind: "event", name: sub.asEvent, data: body.value });
      return;
    }
    this.queue.push({ kind: "update", sub: sub.id, rev: ++sub.rev, ...body });
  }

  /** Sends an event in the next batch. */
  emit<N extends EventName>(name: N, data: EventMap[N]): void {
    // (The panel is said once per change, however many parts of the page notice it.)
    if (name === "editor.panel") {
      const panel = (data as EventMap["editor.panel"]).panel;
      if (panel === this.lastPanel) return;
      this.lastPanel = panel;
    }
    this.queue.push({ kind: "event", name, data });
    this.requestFlush();
  }

  // ---- one-off queries

  private async query(msg: Record<string, unknown>): Promise<unknown> {
    this.checkPlace(msg);
    const def = this.viewDef(msg.name);
    const args = parseViewArgs(def, msg.args);
    const live = def.create(this.ctx, args) as LiveValue | LiveList;
    const win = clampWindow(msg.window as ListWindow | undefined);
    const settled = () => {
      if (def.kind === "list") {
        (live as LiveList).ensure(win.start + win.count);
        const s = (live as LiveList).compute();
        return s.error || !s.stale ? s : null;
      }
      const s = (live as LiveValue).compute();
      return s.error || (s.value !== undefined && !s.stale) ? s : null;
    };
    const snap = await new Promise<ReturnType<typeof settled> | "timeout">((resolve) => {
      let done = false;
      let offs: (() => void)[] = [];
      const finish = (v: ReturnType<typeof settled> | "timeout") => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const off of offs) off();
        resolve(v);
      };
      const check = () => {
        const s = settled();
        if (s) finish(s);
      };
      const timer = setTimeout(() => finish("timeout"), this.opts.queryTimeoutMs ?? 10_000);
      offs = live.signals.map((s) => s.subscribe(() => queueMicrotask(check)));
      check();
    });
    live.dispose?.();
    const final = snap === "timeout" ? (def.kind === "list" ? (live as LiveList).compute() : (live as LiveValue).compute()) : snap;
    if (!final) throw new BridgeError("failed", "No answer yet.");
    if (final.error) throw new BridgeError(final.error.code, final.error.message, final.error.data);
    if (def.kind === "list") {
      const s = final as ReturnType<LiveList["compute"]>;
      return windowDiff(null, s.ids, s.rows, win, s.complete).diff;
    }
    const v = (final as ReturnType<LiveValue["compute"]>).value;
    if (v === undefined) throw new BridgeError("failed", "There's no answer yet. Try again when you're online.");
    return v;
  }

  // ---- editor commands

  private async editor(msg: Record<string, unknown>): Promise<unknown> {
    if (!isEditorName(msg.name)) throw new BridgeError("unknown_editor_command", `There's no editor command named “${String(msg.name)}”.`);
    const args = argsOf(msg.args);
    switch (msg.name) {
      case "note.prepare":
      case "note.show": {
        only(args, msg.name === "note.show" ? ["id", "focus", "panes", "sizes", "tabs"] : ["id"]);
        const noteId = idArg(args, "id");
        const focus = msg.name === "note.show" ? bool(args, "focus", false) : false;
        if (msg.name === "note.show") setNativePanes(paneArgs(args, noteId));
        const deps = this.ctx.deps();
        const note = activeNote();
        if (note?.noteId !== noteId) {
          // (A joined note already on the page says it's ready again once it has focus.)
          resetNoteReady(noteId);
          deps.navigate(`/d/${encodeURIComponent(noteId)}${focus ? "?new=1" : ""}`);
        } else if (focus) {
          await note.run("focus", {});
        }
        this.showMeta(noteId);
        return { id: noteId, ready: isNoteReady(noteId) };
      }
      case "web.show": {
        only(args, ["page"]);
        const page = oneOf(args, "page", WEB_PAGES);
        this.ctx.deps().navigate(WEB_PAGE_ROUTES[page]);
        this.showMeta(null);
        return { id: page, ready: true };
      }
      case "note.close": {
        only(args, []);
        this.ctx.deps().navigate("/native");
        this.showMeta(null);
        return { ok: true };
      }
      default: {
        const note = activeNote();
        if (!note) throw new BridgeError("no_note", "No note is open.");
        return note.run(msg.name, args);
      }
    }
  }

  // ---- internal subscriptions: sync.status and the shown note's meta as events

  private startInternal(): void {
    this.internalSub("sync.status", "sync.status", {});
    if (this.shownNote) this.internalSub("note.meta", "note.meta", { id: this.shownNote });
  }

  private internalSub(key: string, name: ViewName, args: Record<string, unknown>): void {
    const old = this.internal.get(key);
    if (old) this.stop(old);
    const def = VALUE_VIEWS[name];
    const sub: Sub = { id: `internal:${key}`, name, args, def, live: null, off: null, rev: 0, last: undefined, lastStale: false, lastError: undefined, list: null, window: clampWindow(undefined), dirty: false, asEvent: name as EventName };
    this.internal.set(key, sub);
    this.start(sub);
  }

  private showMeta(noteId: string | null): void {
    if (this.shownNote === noteId) return;
    this.shownNote = noteId;
    const old = this.internal.get("note.meta");
    if (old) {
      this.stop(old);
      this.internal.delete("note.meta");
    }
    if (noteId && this.deps) this.internalSub("note.meta", "note.meta", { id: noteId });
  }

  /** For tests: the live subscriptions' ids. */
  subscriptions(): string[] {
    return [...this.subs.keys()];
  }
}

let installed: BridgeHost | null = null;

/** The page's bridge host, if native chrome mode installed one. */
export function bridgeHost(): BridgeHost | null {
  return installed;
}

/**
 * Installs the bridge host as `window.__foleviEngine` (native chrome mode only: lib/nativeApp.ts nativeChrome()).
 * Idempotent; returns the host.
 */
export function installBridgeHost(opts: HostOptions = {}): BridgeHost {
  if (installed) return installed;
  const host = new BridgeHost(opts);
  installed = host;
  routeWindowOpen();
  (globalThis as unknown as { __foleviEngine?: { handle(m: unknown): Promise<string>; protocol: number } }).__foleviEngine = {
    handle: (m: unknown) => host.handle(m),
    protocol: PROTOCOL_VERSION,
  };
  return host;
}

/** For tests. */
export function uninstallBridgeHost(): void {
  installed?.dispose();
  installed = null;
  delete (globalThis as unknown as { __foleviEngine?: unknown }).__foleviEngine;
}

/** note.show's joined panes (revision 20), checked: 2 or 3 different notes, the shown one among them. */
export function paneArgs(args: Record<string, unknown>, noteId: string): NativePanes {
  const panes = args.panes === undefined ? null : idsArg(args, "panes", 3);
  if (panes && (panes.length < 2 || new Set(panes).size !== panes.length || !panes.includes(noteId))) throw invalid("panes must be 2 or 3 different notes, the shown one among them.");
  let sizes: number[] | null = null;
  if (args.sizes !== undefined) {
    const v = args.sizes;
    if (!panes || !Array.isArray(v) || v.length !== panes.length || !v.every((x) => typeof x === "number" && x > 0 && x < 1)) throw invalid("sizes must be a share for each pane.");
    sizes = v as number[];
  }
  const tabs: NativePanes["tabs"] = [];
  if (args.tabs !== undefined) {
    const v = args.tabs;
    if (!Array.isArray(v) || v.length > 50) throw invalid("tabs must be a list of at most 50.");
    for (const t of v) {
      if (!t || typeof t !== "object" || typeof (t as { id?: unknown }).id !== "string" || typeof (t as { title?: unknown }).title !== "string") throw invalid("tabs must be ids and titles.");
      const { id, title } = t as { id: string; title: string };
      tabs.push({ id: idArg({ id }, "id"), title: title.slice(0, 500) });
    }
  }
  return { panes, sizes, tabs };
}
