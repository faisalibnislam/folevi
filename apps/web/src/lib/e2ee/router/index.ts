// The data side of end-to-end encryption (docs/E2EE_DESIGN.md §6.4 to §6.8, §12 WP7). This module is heavy
// (the router, the replicas, the local backend's handlers): lib/convex/provider.tsx loads it only for accounts
// with E2EE set up. The light parts (hooks.ts, active.ts) don't import it.
export { E2eeRouterClient, lockedSessionError, type RouterDeps } from "./client";
export { E2EE_ROUTES, routeOf, hasRoute } from "./routes";
export { SpaceIndex } from "./spaces";
export type { Route } from "./types";
export type { ReplicaHub, SpaceReplica, ReplicaStatus } from "../replica/host";
export { useE2eeSpaceStatus, isSealedDocument } from "./hooks";
export { sealBlock, openBlock } from "../seal";
export { uploadSealed, decryptedFileUrl } from "../files";
export { setActiveRouter, activeRouter } from "./active";
