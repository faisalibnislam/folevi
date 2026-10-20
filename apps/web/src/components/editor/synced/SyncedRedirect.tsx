"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@/lib/convex/api";
import { useAppRouter } from "@/lib/app/router";

/**
 * Synced content isn't a page (docs/SYNCED_BLOCKS.md): a link to it (a task, a mention, a search hit) opens the
 * first note showing it that this person can open, at the synced block.
 */
export function SyncedRedirect({ sourceId }: { sourceId: string }) {
  const home = useQuery(api.synced.home, { sourceId });
  const { navigate } = useAppRouter();
  useEffect(() => {
    if (home) navigate(`/d/${home.documentId}#block-${home.blockId}`, { replace: true });
  }, [home, navigate]);
  return null;
}
