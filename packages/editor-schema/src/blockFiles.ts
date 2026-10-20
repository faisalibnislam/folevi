// The files a block shows: an image, file or audio block's own file, and the images inside a flowchart's
// shapes. Share pages, presenting, version history and exports ask for addresses of these.
import { parseFlowchart } from "./flowchart";
import { flowchartFileIds } from "./flowchartPaths";

/** Ids of the files a block (a wire block, or anything with its type and props) shows, each once. */
export function blockFileIds(block: { type: string; props: unknown }): string[] {
  const p = (block.props ?? {}) as { fileId?: unknown; data?: unknown };
  const ids: string[] = typeof p.fileId === "string" && p.fileId ? [p.fileId] : [];
  if (block.type === "flowchart" && typeof p.data === "string" && p.data.includes("fileId")) ids.push(...flowchartFileIds(parseFlowchart(p.data)));
  return [...new Set(ids)];
}

/** Ids of the files a list of blocks shows, each once. */
export function blocksFileIds(blocks: readonly { type: string; props: unknown }[]): string[] {
  return [...new Set(blocks.flatMap(blockFileIds))];
}

/**
 * A flowchart's stored data with its shapes' image file ids swapped by `map` (an id it gives null or
 * undefined for is left as it is; with `drop`, a shape whose file `drop` names loses its image instead).
 * Everything else in the data stays exactly as stored. Data that isn't JSON is returned unchanged.
 */
export function remapFlowchartFiles(data: string, map: (fileId: string) => string | null | undefined, drop?: (fileId: string) => boolean): string {
  if (!data.includes("fileId")) return data;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return data;
  }
  const nodes = (parsed as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return data;
  let changed = false;
  for (const n of nodes) {
    const image = (n as { image?: { fileId?: unknown } } | null)?.image;
    if (!image || typeof image.fileId !== "string") continue;
    if (drop?.(image.fileId)) {
      delete (n as { image?: unknown }).image;
      changed = true;
      continue;
    }
    const next = map(image.fileId);
    if (next && next !== image.fileId) {
      image.fileId = next;
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : data;
}

/**
 * A block pointing at other files: its own `fileId` and the images in a flowchart's shapes swapped by `map`
 * (ids it has no answer for stay). The same block (object) when nothing changes.
 */
export function remapBlockFiles<B extends { type: string; props: unknown }>(block: B, map: (fileId: string) => string | null | undefined, drop?: (fileId: string) => boolean): B {
  const p = (block.props ?? {}) as Record<string, unknown>;
  let props: Record<string, unknown> | null = null;
  if (typeof p.fileId === "string" && p.fileId) {
    const next = map(p.fileId);
    if (next && next !== p.fileId) props = { ...p, fileId: next };
  }
  if (block.type === "flowchart" && typeof p.data === "string") {
    const data = remapFlowchartFiles(p.data, map, drop);
    if (data !== p.data) props = { ...(props ?? p), data };
  }
  return props ? { ...block, props } : block;
}
