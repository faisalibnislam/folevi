// Presenting a note as slides: where one slide ends and the next starts.
//
// Each divider and each page break at the top level of the note starts a new slide (the line itself isn't
// shown). A note with neither is cut at its top-level headings instead: at every Heading 1, or when it has
// none, at every Heading 2 (the heading opens its slide). A slide always holds whole blocks with everything
// nested under them, so a toggle, a list or a tabs block is never split.
import type { WireBlock } from "./types";
import { flattenTree, type FlatEntry } from "./tree";

/** What cut the note into slides. */
export type SlideCut = "breaks" | "heading1" | "heading2" | "none";

export interface SlideSplit<T> {
  slides: FlatEntry<T>[][];
  cut: SlideCut;
}

const isBreak = (type: string) => type === "divider" || type === "pageBreak";

function isEmptyLine(block: Pick<WireBlock, "type" | "text">): boolean {
  return block.type === "paragraph" && !block.text.some((n) => n.type !== "text" || n.text.trim());
}

/** The note's blocks in order (a flat list with depths, as flattenTree gives) cut into slides. */
export function splitSlides<T extends Pick<WireBlock, "type" | "text" | "props">>(flat: readonly FlatEntry<T>[]): SlideSplit<T> {
  const top = flat.filter((e) => e.depth === 0);
  const level = (e: FlatEntry<T>) => (e.block.type === "heading" ? Number((e.block.props as { level?: unknown }).level) || 1 : 0);
  const cut: SlideCut = top.some((e) => isBreak(e.block.type))
    ? "breaks"
    : top.some((e) => level(e) === 1)
      ? "heading1"
      : top.some((e) => level(e) === 2)
        ? "heading2"
        : "none";
  const slides: FlatEntry<T>[][] = [];
  let current: FlatEntry<T>[] = [];
  const close = () => {
    // A slide of nothing but empty lines (two dividers in a row, a heading-less start) is left out.
    if (current.some((e) => !isEmptyLine(e.block))) slides.push(current);
    current = [];
  };
  for (const e of flat) {
    if (e.depth === 0) {
      if (cut === "breaks" && isBreak(e.block.type)) {
        close();
        continue;
      }
      if ((cut === "heading1" && level(e) === 1) || (cut === "heading2" && level(e) === 2)) close();
    }
    current.push(e);
  }
  close();
  return { slides, cut };
}

/** The note's blocks cut into slides, each slide's blocks a whole tree of its own (parents included). */
export function slidesOf<T extends Pick<WireBlock, "id" | "parentId" | "rank" | "type" | "text" | "props">>(blocks: readonly T[]): T[][] {
  return splitSlides(flattenTree(blocks)).slides.map((s) => s.map((e) => e.block));
}
