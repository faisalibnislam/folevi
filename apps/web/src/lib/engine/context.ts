// What the engine's views and commands get from the page: the data layer's client, the app state, the outbox and
// the sync engine, places, navigation. EngineHost.tsx builds it from React context on every render and hands it
// to the bridge host; tests build it from fakes.
import type { WireScope } from "@folevi/editor-schema";
import type { SyncEngine } from "@/lib/sync/engine";
import type { Outbox } from "@/lib/sync/outbox";
import type { EngineClient, KeptAnswers, Signal } from "./live";
import type { Capabilities, PlacesValue, ProfileInfo, SpaceRef } from "./protocol";

export interface EngineSpace {
  id: SpaceRef;
  kind: "personal" | "workspace";
  name: string;
  role: string;
  canEdit: boolean;
  canManage: boolean;
  scope: WireScope;
}

/** A space's end-to-end encryption standing on this device (lib/e2ee/router/hooks.ts spaceStatus). */
export interface EngineSpaceStatus {
  encrypted: boolean;
  locked: boolean;
  state: "opening" | "downloading" | "ready" | "locked";
  have: number;
  total: number | null;
}

export interface EngineApp {
  /** The place this page shows (`acct:<user id>` or `library`); null when it can't tell. */
  place: string | null;
  mode: "account" | "local";
  /** Names the account's data on this device (the profile id): the kept answers' key. */
  accountKey: string;
  profile: ProfileInfo;
  /** Personal first, then the team workspaces. */
  spaces: EngineSpace[];
  /** The space the page shows now. */
  space: SpaceRef;
  online: boolean;
  today: string;
  timeZone: string;
  appearance: "system" | "light" | "dark";
  capabilities: Capabilities;
  engine: SyncEngine | null;
  outbox: Outbox | null;
  places: PlacesValue;
}

export interface EngineDeps {
  client: EngineClient;
  kept: KeptAnswers | null;
  app: EngineApp;
  /** Whether answers about `scope` may be written to the device (false for encrypted spaces and public computers). */
  persist(scope: WireScope): boolean;
  spaceStatus(scope: WireScope): EngineSpaceStatus;
  /** Fires when the E2EE router's spaces, replicas or lock change. */
  e2eeSignal: Signal;
  /** Moves the page (always a replace in native chrome mode: the web history stays one entry). */
  navigate(path: string): void;
  /** Shows another space (Personal or a workspace) in this place. */
  setSpace(space: SpaceRef): void;
  /** Foli AI's brief for Catch me up. */
  brief?(scope: WireScope, today: string): Promise<{ answer: string; sources: { id: string; title: string }[] }>;
}

/** What views and commands hold: the deps as they are now (they change as the page re-renders) and that change. */
export interface ViewContext {
  deps(): EngineDeps;
  /** Fires when the deps changed (online, today, the space, the outbox or engine being replaced, places). */
  appSignal: Signal;
}

export function spaceOf(app: EngineApp, space: SpaceRef | undefined): EngineSpace | null {
  const id = space ?? app.space;
  return app.spaces.find((s) => s.id === id) ?? null;
}
