"use client";

// Note exports (Markdown, HTML, PDF: components/doc/export.ts) write a synced block as the content it shows now.
import type { ConvexReactClient } from "convex/react";
import { expandSyncedBlocks, syncedSourceIds, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";

/** What each synced block on screen shows right now (SyncedView keeps it), offline edits included. */
export const shownSyncedContent = new Map<string, () => WireBlock[]>();

/** `blocks` with each synced block replaced by its content, as far as this person can see it (else left out). */
export async function withSyncedContent(client: ConvexReactClient, blocks: WireBlock[]): Promise<WireBlock[]> {
  const ids = syncedSourceIds(blocks);
  if (!ids.length) return blocks;
  const content = new Map<string, readonly WireBlock[] | null>();
  await Promise.all(
    ids.map(async (id) => {
      const shown = shownSyncedContent.get(id)?.();
      if (shown?.length) return void content.set(id, shown);
      try {
        content.set(id, (await client.query(api.blocks.list, { documentId: id }))?.blocks ?? null);
      } catch {
        content.set(id, null);
      }
    }),
  );
  return expandSyncedBlocks(blocks, (id) => content.get(id) ?? null);
}
