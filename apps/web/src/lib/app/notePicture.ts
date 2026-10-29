import { blocksToHtml, type WireBlock } from "@folevi/editor-schema";

/** How wide a note's picture is laid out before it's scaled down (a note's reading width plus margins). */
export const PICTURE_PAGE_W = 600;
/** At most this many blocks are drawn: a picture shows a page's top, not all of it. */
export const PICTURE_BLOCKS = 80;

/** The page laid out small: no scroll bars, no pointer, tighter margins than an export. */
const MINI_CSS = `html,body{overflow:hidden!important;pointer-events:none;background:transparent!important}main{max-width:none!important;margin:22px 30px!important;padding:0!important}h1{margin-top:0;font-size:1.9rem}`;

/**
 * A note's picture as a page of HTML (the same render as an export, its top only): the web's tab previews and Tab
 * Overview draw it in a sandboxed frame, the Mac app's in a web view with nothing able to run.
 */
export function notePictureHtml(blocks: WireBlock[], title: string): string {
  const top = blocks.length > PICTURE_BLOCKS ? blocks.slice(0, PICTURE_BLOCKS) : blocks;
  return blocksToHtml(top, { title: title || "Untitled" }).replace("</style>", `${MINI_CSS}</style>`);
}
