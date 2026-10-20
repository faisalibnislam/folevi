// Foli AI's "Mind map" writing tool as a block (no editor code here, so the AI previews can load it):
// noteConvert.ts inserts it, AiMarkdown.tsx previews it.
import { LIMITS, MINDMAP_DEFAULT_HEIGHT, SCHEMA_VERSION, mindmapDataIssue, ulid, type WireBlock } from "@folevi/editor-schema";

/**
 * Foli AI's "Mind map" (the writing tool's `mindmap`: the block's data, checked on the server) as a block,
 * when it passes the same strict check here; null otherwise.
 */
export function aiMindmapBlock(data: string | undefined): WireBlock | null {
  if (!data || data.length > LIMITS.maxMindmapDataLength || mindmapDataIssue(data) !== null) return null;
  return { id: ulid(), type: "mindmap", parentId: null, rank: "a0", schemaVersion: SCHEMA_VERSION, text: [], props: { data, height: MINDMAP_DEFAULT_HEIGHT } };
}
