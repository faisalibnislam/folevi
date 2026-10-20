// What the sync engine, the outbox and the uploader need from a backend client: the Convex client in account
// mode, the LocalClient (lib/local/client.ts) in local mode. Both are what `useConvex()` returns.
import type { ConvexReactClient } from "convex/react";
import type { LocalHostApi } from "@/lib/local/client";

export type FoleviClient = Pick<ConvexReactClient, "mutation" | "query" | "action">;

/** The local-only operations when `client` is a LocalClient (uploads go to `putFile`), else null. */
export function localApiOf(client: FoleviClient): LocalHostApi | null {
  return "local" in client ? ((client as { local: LocalHostApi }).local ?? null) : null;
}
