// Which blocks export as a picture, what each is called, and how each draws its standalone SVG (light colours,
// for files and the clipboard). Each block draws itself in its own folder (flowchart from the shared schema,
// the others in <type>/svg.ts); used by the block menu (EditorMenus) and each block's own toolbar.
import { flowchartFileIds, flowchartToSvg, parseFlowchart } from "@folevi/editor-schema";
import { mindmapSvg } from "../mindmap/svg";
import { stickiesSvg } from "../stickies/svg";
import { chartSvg } from "../chart/svg";
import { wireframeSvg } from "../wireframe/svg";
import { whiteboardSvg } from "../whiteboard/svg";

/** What a block's picture may need from outside it. */
export interface BlockImageOptions {
  /** The address of a file the picture shows (a data URL, so the picture stands alone); null leaves a placeholder. */
  imageUrl?: (fileId: string) => string | null;
}

interface ImageBlock {
  /** The block's name, for menus and file names. */
  name: string;
  /** The block's picture, or null while it has nothing to draw. */
  svg: (data: string, height: number, opts?: BlockImageOptions) => string | null;
  /** The files the picture shows (the images in a flowchart's shapes), to resolve before drawing it. */
  files?: (data: string) => string[];
}

export const IMAGE_BLOCKS: Record<string, ImageBlock> = {
  flowchart: {
    name: "Flowchart",
    svg: (data, _height, opts) => (parseFlowchart(data).nodes.length ? flowchartToSvg(data, { imageUrl: opts?.imageUrl }) : null),
    files: (data) => (data.includes("fileId") ? flowchartFileIds(parseFlowchart(data)) : []),
  },
  mindmap: { name: "Mind map", svg: mindmapSvg },
  stickies: { name: "Sticky notes", svg: stickiesSvg },
  chart: { name: "Chart", svg: chartSvg },
  wireframe: { name: "Wireframe", svg: wireframeSvg },
  whiteboard: { name: "Whiteboard", svg: whiteboardSvg },
};

/** The SVG of a block from its node attributes, or null when it has nothing to export (or isn't a picture). */
export function blockImageSvg(type: string, attrs: Record<string, unknown>, opts?: BlockImageOptions): string | null {
  const block = IMAGE_BLOCKS[type];
  return block ? block.svg(String(attrs.data ?? ""), Number(attrs.height) || 0, opts) : null;
}

/** The files a block's picture shows (none for most blocks). */
export function blockImageFiles(type: string, attrs: Record<string, unknown>): string[] {
  return IMAGE_BLOCKS[type]?.files?.(String(attrs.data ?? "")) ?? [];
}
