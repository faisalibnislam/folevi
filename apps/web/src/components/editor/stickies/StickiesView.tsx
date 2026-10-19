"use client";

// Sticky notes block: a board of coloured notes in labelled groups, for workshops and brainstorms (after
// Miro). The content lives in the block's `data` (packages/editor-schema/src/stickies.ts).
//
// The card, its toolbar, Full canvas (⇧⌘F, Esc back), Export (PNG, SVG, PDF, Copy as image; ./svg.ts) and
// the height handle come from canvas/CanvasCard.tsx. The editor goes in the card's children, its tools in
// `tools`; until then the card shows what's in the block (./render.tsx) or how to start.
import type { ReactNodeViewProps } from "@tiptap/react";
import { useMemo } from "react";
import { StickyNotes } from "lucide-react";
import { LIMITS, STICKIES_DEFAULT_HEIGHT, parseStickies, serializeStickies } from "@folevi/editor-schema";
import { CanvasCard } from "../canvas/CanvasCard";
import { StickiesStatic } from "./render";

export function StickiesView(props: ReactNodeViewProps) {
  const data = String(props.node.attrs.data ?? "");
  const empty = useMemo(() => !serializeStickies(parseStickies(data)), [data]);
  return (
    <CanvasCard
      view={props}
      type="stickies"
      name="Sticky notes"
      icon={<StickyNotes size={14} />}
      minHeight={LIMITS.minStickiesHeight}
      maxHeight={LIMITS.maxStickiesHeight}
      defaultHeight={STICKIES_DEFAULT_HEIGHT}
      empty={empty}
      hint="Add a note for each idea. Colours, tags and votes help sort them."
    >
      {empty ? null : (
        <div className="fb-vc-content">
          <StickiesStatic data={data} />
        </div>
      )}
    </CanvasCard>
  );
}
