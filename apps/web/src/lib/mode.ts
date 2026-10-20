"use client";

// Local mode or account mode, for the interface (docs/LOCAL_MODE_PLAN.md §2.3, §5.2). Server-only features
// ask useCapabilities() before they show; in local mode they're replaced by one "Sign in to Folevi to share
// and collaborate" note (WP10). Prices and upgrades ask canPurchaseHere(), which is false in local mode on
// every platform, and inside the iOS app.
import { createContext, useContext, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { capabilitiesOf, currentBackendMode as modeNow, type BackendMode, type Capabilities, type Capability } from "./backendMode";
import { LOCAL_FUNCTIONS } from "./local/registry";
import { localAiState, subscribeLocalAi, type LocalAiState } from "./local/ai/state";
import { ACCOUNT_FEATURES, type AiFeature, type AiFeatures } from "./local/ai/features";

export { canPurchaseHere } from "./nativeApp";
export { CAPABILITIES, currentBackendMode, type BackendMode, type Capabilities, type Capability } from "./backendMode";

export const BackendModeContext = createContext<BackendMode>("account");

/** Where this page's notes live. */
export function useBackendMode(): BackendMode {
  return useContext(BackendModeContext);
}

const LOCAL = capabilitiesOf("local");
const ACCOUNT = capabilitiesOf("account");

const LOCAL_WITH_AI: Capabilities = { ...LOCAL, foliAi: true };
const serverAiState = () => null;

/**
 * Foli AI in local mode (WP11): which model is active on this device and what it can do, kept up to date
 * (lib/local/ai/state.ts). Null in account mode, where the server decides.
 */
export function useLocalAi(): LocalAiState | null {
  const local = useBackendMode() === "local";
  const state = useSyncExternalStore(local ? subscribeLocalAi : noopSubscribe, local ? localAiState : serverAiState, serverAiState);
  return local ? state : null;
}
const noopSubscribe = () => () => {};

/** What the backend can do here (a feature also checks the person's plan and settings, as before). */
export function useCapabilities(): Capabilities {
  const local = useBackendMode() === "local";
  const ai = useLocalAi();
  if (!local) return ACCOUNT;
  // Foli AI shows in local mode once this device has a model for it (Apple's, or the person's own key).
  return ai?.active ? LOCAL_WITH_AI : LOCAL;
}

/**
 * Which Foli AI features to offer: all of them in account mode (the person's plan and settings still decide),
 * and in local mode only what the active model can do (lib/local/ai/features.ts).
 */
export function useAiFeatures(): AiFeatures {
  const ai = useLocalAi();
  return ai ? ai.features : ACCOUNT_FEATURES;
}

/** One Foli AI feature (see useAiFeatures). */
export function useAiFeature(feature: AiFeature): boolean {
  return useAiFeatures()[feature];
}

/** useAiFeature outside React: account mode always; local mode asks the active model. */
export function aiFeatureHere(feature: AiFeature): boolean {
  return modeNow() !== "local" || localAiState().features[feature];
}

export type { AiFeature, AiFeatures } from "./local/ai/features";

/** One capability. */
export function useCapability(capability: Capability): boolean {
  return useCapabilities()[capability];
}

/**
 * Whether a server function can be called on this page's backend: anything in account mode; in local mode
 * only what lib/local has ported (registry.ts LOCAL_FUNCTIONS). A feature whose port is still planned (the
 * graph, bookmark previews) stays out of sight with this instead of failing, and shows once it's ported.
 */
export function canCallHere(ref: FunctionReference<"query" | "mutation" | "action">): boolean {
  return modeNow() !== "local" || LOCAL_FUNCTIONS.has(getFunctionName(ref));
}

/** canCallHere for a component (the mode is the provider's, which never changes for a page). */
export function useCanCall(ref: FunctionReference<"query" | "mutation" | "action">): boolean {
  return useBackendMode() !== "local" || LOCAL_FUNCTIONS.has(getFunctionName(ref));
}
