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
