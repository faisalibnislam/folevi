// Which backend this page runs on, readable anywhere without React (lib/mode.ts has the hooks). Kept free of
// imports so low-level modules (lib/nativeApp.ts, lib/convex/provider.tsx) can read it without a cycle.
// BackendProvider sets it before anything below it renders; a page has one backend for its whole life.

/** Where the notes live: on this person's devices (local mode) or in their Folevi account. */
export type BackendMode = "local" | "account";

/**
 * What the backend can do. In account mode all of it (plans and settings still decide what a person
 * sees); in local mode the server-only features are hidden behind one "Sign in to Folevi" note.
 */
export type Capability =
  | "sharing"
  | "comments"
  | "workspaces"
  | "presence"
  | "billing"
  | "semanticSearch"
  | "connectedApps"
  | "emailToNote"
  | "aiServer"
  /** Foli AI can run here at all: the server in account mode; Apple's model or the person's own key in local mode. */
  | "foliAi"
  | "notifications"
  | "pushNotifications"
  | "changes"
  | "calendarFeeds"
  | "stockPhotos"
  | "copyTo"
  | "account";

export const CAPABILITIES: readonly Capability[] = [
  "sharing",
  "comments",
  "workspaces",
  "presence",
  "billing",
  "semanticSearch",
  "connectedApps",
  "emailToNote",
  "aiServer",
  "foliAi",
  "notifications",
  "pushNotifications",
  "changes",
  "calendarFeeds",
  "stockPhotos",
  "copyTo",
  "account",
];

export type Capabilities = Readonly<Record<Capability, boolean>>;

export function capabilitiesOf(mode: BackendMode): Capabilities {
  const on = mode === "account";
  return Object.fromEntries(CAPABILITIES.map((c) => [c, on])) as Record<Capability, boolean>;
}

/**
 * Capabilities a local page turns on for itself: the home page's showcase (components/marketing/showcase) runs
 * local mode with demo stand-ins for comments and presence, so their interface shows. Set before rendering.
 */
let localExtras: Partial<Record<Capability, boolean>> = {};
export function setLocalCapabilityExtras(extras: Partial<Record<Capability, boolean>>): void {
  localExtras = extras;
}
export function localCapabilityExtras(): Partial<Record<Capability, boolean>> {
  return localExtras;
}

let current: BackendMode = "account";

export function currentBackendMode(): BackendMode {
  return current;
}

/** Set by BackendProvider (and tests). */
export function setCurrentBackendMode(mode: BackendMode): void {
  current = mode;
}
