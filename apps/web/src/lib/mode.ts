"use client";

// Local mode or account mode, for the interface (docs/LOCAL_MODE_PLAN.md §2.3, §5.2). Server-only features
// ask useCapabilities() before they show; in local mode they're replaced by one "Sign in to Folevi to share
// and collaborate" note (WP10). Prices and upgrades ask canPurchaseHere(), which is false in local mode on
// every platform, and inside the iOS app.
import { createContext, useContext } from "react";
import { capabilitiesOf, type BackendMode, type Capabilities, type Capability } from "./backendMode";

export { canPurchaseHere } from "./nativeApp";
export { CAPABILITIES, currentBackendMode, type BackendMode, type Capabilities, type Capability } from "./backendMode";

export const BackendModeContext = createContext<BackendMode>("account");

/** Where this page's notes live. */
export function useBackendMode(): BackendMode {
  return useContext(BackendModeContext);
}

const LOCAL = capabilitiesOf("local");
const ACCOUNT = capabilitiesOf("account");

/** What the backend can do here (a feature also checks the person's plan and settings, as before). */
export function useCapabilities(): Capabilities {
  return useBackendMode() === "local" ? LOCAL : ACCOUNT;
}

/** One capability. */
export function useCapability(capability: Capability): boolean {
  return useCapabilities()[capability];
}
