// Which blocks export as a picture, what each is called, and how each draws its standalone SVG (light colours,
// for files and the clipboard). Each block draws itself in its own folder (flowchart from the shared schema,
// the others in <type>/svg.ts); used by the block menu (EditorMenus) and each block's own toolbar.
import { flowchartToSvg, parseFlowchart } from "@folevi/editor-schema";
import { mindmapSvg } from "../mindmap/svg";
import { stickiesSvg } from "../stickies/svg";
import { chartSvg } from "../chart/svg";
import { wireframeSvg } from "../wireframe/svg";
import { whiteboardSvg } from "../whiteboard/svg";

interface ImageBlock {
  /** The block's name, for menus and file names. */
  name: string;
  /** The block's picture, or null while it has nothing to draw. */
  svg: (data: string, height: number) => string | null;
}

export const IMAGE_BLOCKS: Record<string, ImageBlock> = {
  flowchart: { name: "Flowchart", svg: (data) => (parseFlowchart(data).nodes.length ? flowchartToSvg(data) : null) },
  mindmap: { name: "Mind map", svg: mindmapSvg },
  stickies: { name: "Sticky notes", svg: stickiesSvg },
  chart: { name: "Chart", svg: chartSvg },
  wireframe: { name: "Wireframe", svg: wireframeSvg },
  whiteboard: { name: "Whiteboard", svg: whiteboardSvg },
};

/** The SVG of a block from its node attributes, or null when it has nothing to export (or isn't a picture). */
export function blockImageSvg(type: string, attrs: Record<string, unknown>): string | null {
  const block = IMAGE_BLOCKS[type];
  return block ? block.svg(String(attrs.data ?? ""), Number(attrs.height) || 0) : null;
}
