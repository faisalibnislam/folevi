"use client";

import { useConvex, useConvexConnectionState, useQuery } from "convex/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { localDate } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { SyncEngine } from "@/lib/sync/engine";
import { deviceId as loadDeviceId } from "@/lib/sync/db";
import { Uploader } from "@/lib/sync/uploads";
import { saveAccountSnapshot } from "./offlineSnapshot";

export type Profile = NonNullable<Extract<NonNullable<ReturnType<typeof useMeQuery>>, { state: "ready" }>["profile"]>;
export type Workspace = NonNullable<ReturnType<typeof useWorkspacesQuery>>[number];

function useMeQuery() {
  return useQuery(api.users.me, {});
}
function useWorkspacesQuery(enabled: boolean) {
  return useQuery(api.workspaces.mine, enabled ? {} : "skip");
}

interface AppState {
  profile: Profile;
  workspaces: Workspace[];
  workspace: Workspace;
  setWorkspace: (id: string) => void;
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
    if (liveWorkspaces?.length && !offlineWorkspaces) void saveAccountSnapshot(profile, liveWorkspaces);
  }, [profile, liveWorkspaces, offlineWorkspaces]);
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem("folevi:workspace");
    } catch {
      return null;
    }
  });
  const workspace = useMemo(() => {
    if (!workspaces?.length) return null;
    return workspaces.find((w) => w.id === selected) ?? workspaces.find((w) => w.isDefault) ?? workspaces[0]!;
  }, [workspaces, selected]);

  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [uploader, setUploader] = useState<Uploader | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const online = useOnline();
  const connection = useConvexConnectionState();
  const effectivelyOnline = online && (connection.isWebSocketConnected || !connection.hasEverConnected);
  const timeZone = profile.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const today = useToday(timeZone);
  const [appearance, setAppearanceState] = useState(profile.appearance);

  const workspaceId = workspace?.id ?? null;
  // One sync engine per account (docs/SYNC_PROTOCOL.md §Routing): switching workspaces only changes where
  // new top-level pages go, so edits to pages from any workspace share the same durable queue.
  const workspaceRef = useRef(workspaceId);
  useEffect(() => {
    workspaceRef.current = workspaceId;
    if (workspaceId) engine?.setWorkspace(workspaceId);
  }, [engine, workspaceId]);
  const hasWorkspace = workspaceId !== null;
  useEffect(() => {
    if (!hasWorkspace) return;
    let cancelled = false;
    (async () => {
      const id = await loadDeviceId(profile.id);
      const e = await SyncEngine.open(convex, profile.id, workspaceRef.current!, id);
      if (cancelled) return;
      setDevice(id);
      setEngine(e);
      const up = new Uploader(convex, profile.id, e, (message) => window.dispatchEvent(new CustomEvent("folevi:error", { detail: message })));
      setUploader(up);
      e.scheduleFlush(0);
      up.kick(500);
    })();
    return () => {
      cancelled = true;
    };
  }, [convex, profile.id, hasWorkspace]);

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
    if (!workspace || !workspaces) return null;
    return {
      profile,
      workspaces,
      workspace,
      setWorkspace: (id: string) => {
        try {
          localStorage.setItem("folevi:workspace", id);
        } catch {
          /* ignore */
        }
        setSelected(id);
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
  }, [profile, workspaces, workspace, engine, uploader, device, effectivelyOnline, today, timeZone, appearance]);

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
