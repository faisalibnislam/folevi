// Synced blocks: one piece of content shown in several notes. The content lives in a synced source (a
// document of kind "synced", owned by a Personal or a workspace, never listed as a page); each note shows it
// through a `synced` block whose `props.sourceId` names the source's public id. Editing it in any note edits
// the source, so every note shows the change. See docs/EDITOR_SCHEMA.md (Synced blocks).
import type { WireBlock } from "./types";
import { assignTreePositions, flattenTree } from "./tree";

export const SYNCED_BLOCK_TYPE = "synced";

/** Whether `block` is a synced block with a usable source id. */
export function isSyncedBlock(block: Pick<WireBlock, "type" | "props">): boolean {
  return block.type === SYNCED_BLOCK_TYPE && typeof (block.props as { sourceId?: unknown }).sourceId === "string" && (block.props as { sourceId: string }).sourceId.length > 0;
}

/** The source a synced block shows, or null. */
export function syncedSourceOf(block: Pick<WireBlock, "type" | "props">): string | null {
  return isSyncedBlock(block) ? (block.props as { sourceId: string }).sourceId : null;
}

/** The sources the synced blocks in `blocks` show, each once, in the order they first appear. */
export function syncedSourceIds(blocks: readonly Pick<WireBlock, "type" | "props">[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const id = syncedSourceOf(b);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface ExpandSyncedOptions {
  /**
   * What stands in for a synced block whose content the reader can't see (or that's gone). Default: nothing
   * (the block is left out).
   */
  missing?: (block: WireBlock) => WireBlock[];
}

/**
 * `blocks` with each synced block replaced by its source's current blocks, for everything that reads a note as
 * one text: exports (Markdown, HTML, PDF), public share pages, search text and Foli AI. `contentOf(sourceId)`
 * returns the source's live blocks, or null when this reader may not see them. The content takes the synced
 * block's place and indentation; a synced block inside a source (never written: the server refuses one) is
 * left out. Blocks shown through a synced block get ids of their own (`<synced block id>_<block id>`), so the
 * same source shown twice is two sets of blocks. Ranks are rebuilt; the order is the reading order.
 */
export function expandSyncedBlocks(
  blocks: readonly WireBlock[],
  contentOf: (sourceId: string) => readonly WireBlock[] | null,
  opts: ExpandSyncedOptions = {},
): WireBlock[] {
  if (!blocks.some((b) => b.type === SYNCED_BLOCK_TYPE)) return [...blocks];
  const entries: { block: WireBlock; depth: number }[] = [];
  for (const { block, depth } of flattenTree(blocks)) {
    if (block.type !== SYNCED_BLOCK_TYPE) {
      entries.push({ block, depth });
      continue;
    }
    const sourceId = syncedSourceOf(block);
    const content = sourceId ? contentOf(sourceId) : null;
    if (!content) {
      for (const b of opts.missing?.(block) ?? []) entries.push({ block: { ...b, id: `${block.id}_${b.id}` }, depth });
      continue;
    }
    // Inside a source, a synced block (never valid there) and everything under it are skipped.
    let skipBelow: number | null = null;
    for (const inner of flattenTree(content)) {
      if (skipBelow !== null && inner.depth > skipBelow) continue;
      skipBelow = null;
      if (inner.block.type === SYNCED_BLOCK_TYPE) {
        skipBelow = inner.depth;
        continue;
      }
      entries.push({ block: { ...inner.block, id: `${block.id}_${inner.block.id}` }, depth: depth + inner.depth });
    }
  }
  const positions = assignTreePositions(entries.map((e) => ({ id: e.block.id, depth: e.depth })));
  return entries.map(({ block }) => {
    const pos = positions.get(block.id)!;
    return { ...block, parentId: pos.parentId, rank: pos.rank };
  });
}
