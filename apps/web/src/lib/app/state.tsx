"use client";

import { useConvex, useConvexConnectionState, useQuery } from "convex/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { localDate, scopeIdKey, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { SyncEngine } from "@/lib/sync/engine";
import { deviceId as loadDeviceId } from "@/lib/sync/db";
import { Uploader } from "@/lib/sync/uploads";
import { saveAccountSnapshot } from "./offlineSnapshot";

export type Profile = NonNullable<Extract<NonNullable<ReturnType<typeof useMeQuery>>, { state: "ready" }>["profile"]>;
/** A team workspace you belong to (`workspaces.mine`). Personal is never one of these. */
export type Workspace = NonNullable<ReturnType<typeof useWorkspacesQuery>>[number];
export type WorkspaceRole = Workspace["role"];

/**
 * Where you're working: your own Personal, or one of your team workspaces. Personal is not a workspace
 * and has no id; the server knows it as `{ kind: "personal" }` (always the caller's own).
 */
export type ActiveContext = { kind: "personal" } | { kind: "workspace"; workspaceId: string; name: string; role: WorkspaceRole; workspace: Workspace };

function useMeQuery() {
  return useQuery(api.users.me, {});
}
function useWorkspacesQuery(enabled: boolean) {
  return useQuery(api.workspaces.mine, enabled ? {} : "skip");
}

const CONTEXT_KEY = "folevi:context";
/** Older builds remembered a workspace id here, possibly the old personal workspace's. */
const LEGACY_WORKSPACE_KEY = "folevi:workspace";

/** The context as remembered on this device (a workspace id may no longer be one of yours). */
export type StoredContext = { kind: "personal" } | { kind: "workspace"; workspaceId: string };

export function parseStoredContext(raw: string | null, legacyWorkspaceId: string | null): StoredContext | null {
  if (raw === "personal") return { kind: "personal" };
  if (raw?.startsWith("workspace:") && raw.length > "workspace:".length) return { kind: "workspace", workspaceId: raw.slice("workspace:".length) };
  // A legacy value only opens a workspace if it's one of your team workspaces (resolveContext); the old
  // personal workspace isn't, so it opens Personal.
  return legacyWorkspaceId ? { kind: "workspace", workspaceId: legacyWorkspaceId } : null;
}

export function serializeContext(scope: WireScope): string {
  return scope.kind === "personal" ? "personal" : `workspace:${scope.workspaceId}`;
}

/** The context to open: the remembered workspace if you still belong to it, else Personal (the default). */
export function resolveContext(stored: StoredContext | null, workspaces: readonly Workspace[]): ActiveContext {
  if (stored?.kind === "workspace") {
    const w = workspaces.find((x) => x.id === stored.workspaceId);
    if (w) return { kind: "workspace", workspaceId: w.id, name: w.name, role: w.role, workspace: w };
  }
  return { kind: "personal" };
}

function readStoredContext(): { stored: StoredContext | null; legacy: boolean } {
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    const legacy = raw === null ? localStorage.getItem(LEGACY_WORKSPACE_KEY) : null;
    return { stored: parseStoredContext(raw, legacy), legacy: legacy !== null };
  } catch {
    return { stored: null, legacy: false };
  }
}

function writeStoredContext(scope: WireScope) {
  try {
    localStorage.setItem(CONTEXT_KEY, serializeContext(scope));
    localStorage.removeItem(LEGACY_WORKSPACE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export interface AppState {
  profile: Profile;
  /** Your team workspaces, by name. May be empty: Personal always works on its own. */
  workspaces: Workspace[];
  context: ActiveContext;
  /** The current context as the server's `scope` argument (stable between renders). */
  scope: WireScope;
  /** `scopeIdKey(scope)`: "personal" or the workspace id, for local caches, deterministic ids and React keys. */
  scopeKey: string;
  /** The current team workspace, or null in Personal. */
  workspace: Workspace | null;
  /** Your role in the current context: "owner" in your Personal (you manage all of it), else your workspace role (owner, admin or member). */
  role: WorkspaceRole;
  /** Whether you can add and change pages, folders and tags here (always in Personal; members who can only comment or view can't). The server checks again. */
  canEdit: boolean;
  /** Owner or admin of the current workspace (settings, members, guests, export). False in Personal. */
  canManage: boolean;
  setContext: (scope: WireScope) => void;
  engine: SyncEngine | null;
  uploader: Uploader | null;
  deviceId: string | null;
  online: boolean;
  today: string;
  timeZone: string;
  appearance: "system" | "light" | "dark";
  setAppearance: (a: "system" | "light" | "dark") => void;
}

const AppStateContext = createContext<AppState | null>(null);

/**
 * A fixed app state, for the editor on the public site (its demo note has no account, engine or server):
 * the editor's menus read the day and the context from here.
 */
export function StaticAppStateProvider({ value, children }: { value: AppState; children: ReactNode }) {
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState outside AppStateProvider");
  return ctx;
}

export function applyAppearance(appearance: "system" | "light" | "dark") {
  try {
    localStorage.setItem("folevi:appearance", appearance);
  } catch {
    /* storage unavailable */
  }
  const dark = appearance === "dark" || (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Today's local date, refreshed at midnight. */
function useToday(timeZone: string): string {
  const [today, setToday] = useState(() => localDate(Date.now(), timeZone));
  useEffect(() => {
    const tick = () => setToday(localDate(Date.now(), timeZone));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [timeZone]);
  return today;
}

/**
 * `offlineWorkspaces` is the last-known workspace list, used for an offline cold start (the server
 * can't be reached and nothing has loaded yet); live data replaces it as soon as it arrives.
 */
export function AppStateProvider({ profile, offlineWorkspaces, children }: { profile: Profile; offlineWorkspaces?: Workspace[]; children: ReactNode }) {
  const convex = useConvex();
  const liveWorkspaces = useWorkspacesQuery(true);
  const workspaces = liveWorkspaces ?? offlineWorkspaces;

  // Keep the snapshot fresh while online so the next offline start opens the same folio.
  useEffect(() => {
    if (liveWorkspaces && !offlineWorkspaces) void saveAccountSnapshot(profile, liveWorkspaces);
  }, [profile, liveWorkspaces, offlineWorkspaces]);
  const [initial] = useState(readStoredContext);
  const [selected, setSelected] = useState<StoredContext | null>(initial.stored);
  const context = useMemo(() => (workspaces ? resolveContext(selected, workspaces) : null), [workspaces, selected]);
  const contextWorkspaceId = context?.kind === "workspace" ? context.workspaceId : null;
  const scope = useMemo<WireScope>(() => (contextWorkspaceId ? { kind: "workspace", workspaceId: contextWorkspaceId } : { kind: "personal" }), [contextWorkspaceId]);

  // An older build's remembered workspace becomes the new setting once your workspaces are known (the
  // old personal workspace isn't one of them, so it becomes Personal).
  const migrated = useRef(!initial.legacy);
  useEffect(() => {
    if (migrated.current || !liveWorkspaces) return;
    migrated.current = true;
    writeStoredContext(scope);
  }, [liveWorkspaces, scope]);

  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [uploader, setUploader] = useState<Uploader | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const online = useOnline();
  const connection = useConvexConnectionState();
  const effectivelyOnline = online && (connection.isWebSocketConnected || !connection.hasEverConnected);
  const timeZone = profile.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const today = useToday(timeZone);
  const [appearance, setAppearanceState] = useState(profile.appearance);

  // One sync engine per account (docs/SYNC_PROTOCOL.md §Routing): switching between Personal and workspaces
  // only changes where new top-level pages go, so edits to pages from any scope share the same durable queue.
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
    engine?.setScope(scope);
  }, [engine, scope]);
  const teamIdsRef = useRef<string[]>([]);
  teamIdsRef.current = workspaces?.map((w) => w.id) ?? [];
  const ready = context !== null;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let opened: SyncEngine | null = null;
    (async () => {
      const id = await loadDeviceId(profile.id);
      // Your workspaces let page creates queued by an older build find their scope (engine.ts adoptLegacyCreates).
      const e = await SyncEngine.open(convex, profile.id, scopeRef.current, id, teamIdsRef.current);
      opened = e;
      if (cancelled) {
        e.dispose();
        return;
      }
      setDevice(id);
      setEngine(e);
      const up = new Uploader(convex, profile.id, e, (message) => window.dispatchEvent(new CustomEvent("folevi:error", { detail: message })));
      setUploader(up);
      e.scheduleFlush(0);
      up.kick(500);
    })();
    return () => {
      cancelled = true;
      // Replaced (another account) or unmounted: it stops listening to the page.
      opened?.dispose();
    };
  }, [convex, profile.id, ready]);

  useEffect(() => {
    engine?.setOnline(effectivelyOnline);
    if (effectivelyOnline) uploader?.kick(0);
  }, [engine, uploader, effectivelyOnline]);

  // New attachments (Editor.insertFiles) start uploading right away, not on the next reload/reconnect.
  useEffect(() => {
    if (!uploader) return;
    const onUploads = () => uploader.kick(0);
    window.addEventListener("folevi:uploads-changed", onUploads);
    return () => window.removeEventListener("folevi:uploads-changed", onUploads);
  }, [uploader]);

  useEffect(() => {
    setAppearanceState(profile.appearance);
    applyAppearance(profile.appearance);
  }, [profile.appearance]);

  useEffect(() => {
    if (appearance !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance]);

  const registered = useRef(false);
  const registerSession = useMutationSafe();
  useEffect(() => {
    if (registered.current || !device) return;
    registered.current = true;
    void registerSession(device);
  }, [device, registerSession]);

  const value = useMemo<AppState | null>(() => {
    if (!context || !workspaces) return null;
    return {
      profile,
      workspaces,
      context,
      scope,
      scopeKey: scopeIdKey(scope),
      workspace: context.kind === "workspace" ? context.workspace : null,
      role: context.kind === "workspace" ? context.role : "owner",
      canEdit: context.kind === "workspace" ? context.workspace.canEdit !== false : true,
      canManage: context.kind === "workspace" ? context.workspace.canManage === true : false,
      setContext: (next: WireScope) => {
        writeStoredContext(next);
        setSelected(next.kind === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: next.workspaceId });
      },
      engine,
      uploader,
      deviceId: device,
      online: effectivelyOnline,
      today,
      timeZone,
      appearance,
      setAppearance: (a) => {
        setAppearanceState(a);
        applyAppearance(a);
      },
    };
  }, [profile, workspaces, context, scope, engine, uploader, device, effectivelyOnline, today, timeZone, appearance]);

  if (!value) {
    return <FullPageMessage title="Opening your folio…" busy />;
  }
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

function useMutationSafe() {
  const convex = useConvex();
  return useMemo(
    () => async (deviceId: string) => {
      try {
        await convex.mutation(api.users.registerSession, { client: "web", label: browserLabel(), userAgent: navigator.userAgent, deviceId });
        await convex.mutation(api.users.heartbeat, {});
      } catch {
        /* offline or revoked: surfaced elsewhere */
      }
    },
    [convex],
  );
}

function browserLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function FullPageMessage({ title, body, busy, children }: { title: string; body?: ReactNode; busy?: boolean; children?: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="grid min-h-dvh place-items-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-[6px] border border-line bg-surface p-8 shadow-[0_1px_0_var(--color-line),0_12px_40px_-24px_rgba(24,32,28,0.35)]" aria-busy={busy || undefined}>
        <h1 className="font-display text-3xl leading-tight text-ink">{title}</h1>
        {body ? <div className="mt-3 text-muted">{body}</div> : null}
        {busy ? <div className="mt-6 h-1 overflow-hidden rounded-full bg-sunken"><div className="h-full w-1/3 animate-[folio-progress_1.2s_ease-in-out_infinite] rounded-full bg-accent" /></div> : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </main>
  );
}

export { useMeQuery };
