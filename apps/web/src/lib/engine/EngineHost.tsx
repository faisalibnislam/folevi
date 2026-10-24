"use client";

// Hands the page's data layer to the bridge host (lib/engine/host.ts) in native chrome mode: the client the page
// uses (Convex, the E2EE router or the local backend), the app state, the outbox and sync engine, places and
// navigation. Rendered by components/app/Shell.tsx's NativeContentShell; renders nothing.
import { useEffect, useMemo } from "react";
import { useConvex } from "convex/react";
import type { WireScope } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useBackendMode, useCanCall, useCapabilities, canPurchaseHere } from "@/lib/mode";
import { api } from "@/lib/convex/api";
import { usePlaces } from "@/lib/places";
import { activeRouter, onActiveRouter } from "@/lib/e2ee/router/active";
import { spaceStatus } from "@/lib/e2ee/router/hooks";
import { keepAnswer, keptAnswer } from "@/lib/sync/queryCache";
import { useAiEnabled } from "@/components/ai/useAi";
import { nativeChrome } from "@/lib/nativeApp";
import type { EngineDeps, EngineSpace, EngineSpaceStatus } from "./context";
import type { EngineClient, KeptAnswers, Signal } from "./live";
import { installBridgeHost } from "./host";
import { forgetCatchUps } from "./catchUp";
import type { PlaceRow, PlacesValue } from "./protocol";
import { FOLEVI_VERSION } from "@/lib/version";

// Native chrome mode installs `__foleviEngine` as soon as the app's code runs, before signing in or opening the
// place's store: hello works at once, and views answer engine_not_ready until EngineHost attaches the data layer.
if (typeof window !== "undefined" && nativeChrome()) installBridgeHost({ build: FOLEVI_VERSION, marker: nativeChrome() });

/** A workspace's plan as workspaces.mine names it ("Team", "Business"), or null. */
function planNameOf(w: unknown): string | null {
  const plan = (w as { plan?: { shortName?: unknown; name?: unknown } } | undefined)?.plan;
  return typeof plan?.shortName === "string" ? plan.shortName : typeof plan?.name === "string" ? plan.name : null;
}

/** Fires when the E2EE router (spaces, replicas, the lock) changes, or a router comes or goes. */
const e2eeSignal: Signal = {
  subscribe(cb) {
    let offs: (() => void)[] = [];
    const bind = () => {
      for (const o of offs) o();
      offs = [];
      const r = activeRouter();
      if (r) offs = [r.spaces.subscribe(cb), r.replicas.subscribe(cb), r.env.session.subscribe(cb), r.onRoutesChanged(cb)];
    };
    bind();
    const offActive = onActiveRouter(() => {
      bind();
      cb();
    });
    return () => {
      offActive();
      for (const o of offs) o();
    };
  },
};

function statusOf(scope: WireScope): EngineSpaceStatus {
  const s = spaceStatus(scope);
  const locked = s.locked || s.state === "locked";
  return { encrypted: s.level !== "standard", locked: s.level !== "standard" && locked, state: locked && s.level !== "standard" ? "locked" : s.state, have: s.have, total: s.total };
}

export function EngineHost() {
  const convex = useConvex();
  const state = useAppState();
  const { navigate } = useAppRouter();
  const mode = useBackendMode();
  const caps = useCapabilities();
  const aiOn = useAiEnabled();
  const canGraph = useCanCall(api.aiGraph.graph);
  const { places, current } = usePlaces();
  const { profile, workspaces, context, engine, outbox, online, today, timeZone, appearance, setContext } = state;

  const spaces = useMemo<EngineSpace[]>(
    () => [
      { id: "personal", kind: "personal", name: "Personal", role: "owner", canEdit: true, canManage: false, scope: { kind: "personal" } as WireScope },
      ...workspaces.map(
        (w): EngineSpace => ({
          id: w.id,
          kind: "workspace",
          name: w.name,
          role: String(w.role),
          canEdit: (w as { canEdit?: boolean }).canEdit !== false,
          canManage: (w as { canManage?: boolean }).canManage === true,
          scope: { kind: "workspace", workspaceId: w.id } as WireScope,
        }),
      ),
    ],
    [workspaces],
  );

  const placesValue = useMemo<PlacesValue>(
    () => ({
      current,
      places: places.map(
        (p): PlaceRow =>
          p.kind === "library"
            ? { id: p.id, kind: "library", name: "On this device", email: null, avatarUrl: null, syncs: p.syncs, workspaces: [], unread: p.unread, reminders: p.reminders, waiting: p.waiting }
            : { id: p.id, kind: "account", name: p.name, email: p.email, avatarUrl: p.avatarUrl, syncs: null, workspaces: p.workspaces.map((w) => ({ id: w.id, name: w.name, logoUrl: w.logoUrl, planName: p.id === current ? planNameOf(workspaces.find((x) => x.id === w.id)) : null })), unread: p.unread, reminders: p.reminders, waiting: p.waiting },
      ),
    }),
    [places, current, workspaces],
  );

  const kept = useMemo<KeptAnswers>(() => ({ read: (name, args) => keptAnswer(profile.id, name, args), write: (name, args, value) => keepAnswer(profile.id, name, args, value) }), [profile.id]);

  const deps = useMemo<EngineDeps>(
    () => ({
      client: convex as unknown as EngineClient,
      kept,
      app: {
        place: nativeChrome()?.place ?? current ?? (mode === "local" ? "library" : null),
        mode,
        accountKey: profile.id,
        profile: { id: profile.id, name: profile.displayName ?? "", email: profile.email ?? "", avatarUrl: (profile as { avatarUrl?: string | null }).avatarUrl ?? null },
        profileData: profile as unknown as Record<string, unknown>,
        workspaceData: Object.fromEntries(workspaces.map((w) => [w.id, w as unknown as Record<string, unknown>])),
        spaces,
        space: context.kind === "personal" ? "personal" : context.workspaceId,
        online,
        today,
        timeZone,
        appearance,
        capabilities: { graph: canGraph, sharing: caps.sharing, changes: caps.changes, workspaces: caps.workspaces, ai: aiOn, purchases: canPurchaseHere() },
        engine,
        outbox,
        places: placesValue,
      },
      // Decrypted answers (encrypted spaces) never go to the device.
      persist: (s) => spaceStatus(s).level === "standard",
      spaceStatus: statusOf,
      e2eeSignal,
      hasKeys: () => {
        const r = activeRouter();
        return Boolean(r && r.env.session.state() !== "none");
      },
      navigate: (path) => navigate(path, { replace: true, engine: true }),
      setSpace: (space) => setContext(space === "personal" ? ({ kind: "personal" } as WireScope) : ({ kind: "workspace", workspaceId: space } as WireScope)),
    }),
    [convex, kept, current, mode, profile, workspaces, spaces, context, online, today, timeZone, appearance, caps, aiOn, canGraph, engine, outbox, placesValue, navigate, setContext],
  );

  useEffect(() => {
    installBridgeHost({ build: FOLEVI_VERSION, marker: nativeChrome() }).attach(deps);
  }, [deps]);

  useEffect(
    () => () => {
      installBridgeHost().detach();
      forgetCatchUps();
    },
    [],
  );
  return null;
}
