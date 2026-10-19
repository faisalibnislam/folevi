"use client";

// Mind map block: ideas branching out from a central one (after Whimsical and Miro), always laid out tidily.
// The content lives in the block's `data` (packages/editor-schema/src/mindmap.ts).
//
// The card, its toolbar, Full canvas (⇧⌘F, Esc back), Export (PNG, SVG, PDF, Copy as image; ./svg.ts) and
// the height handle come from canvas/CanvasCard.tsx. The editor goes in the card's children, its tools in
// `tools`; until then the card shows what's in the block (./render.tsx) or how to start.
import type { ReactNodeViewProps } from "@tiptap/react";
import { useMemo } from "react";
import { Waypoints } from "lucide-react";
import { LIMITS, MINDMAP_DEFAULT_HEIGHT, parseMindmap, serializeMindmap } from "@folevi/editor-schema";
import { CanvasCard } from "../canvas/CanvasCard";
import { MindmapStatic } from "./render";

export function MindmapView(props: ReactNodeViewProps) {
  const data = String(props.node.attrs.data ?? "");
  const empty = useMemo(() => !serializeMindmap(parseMindmap(data)), [data]);
  return (
    <CanvasCard
      view={props}
      type="mindmap"
      name="Mind map"
      icon={<Waypoints size={14} />}
      minHeight={LIMITS.minMindmapHeight}
      maxHeight={LIMITS.maxMindmapHeight}
      defaultHeight={MINDMAP_DEFAULT_HEIGHT}
      empty={empty}
      hint="Start with the central idea, then branch out from it."
    >
      {empty ? null : (
        <div className="fb-vc-content">
          <MindmapStatic data={data} />
        </div>
      )}
    </CanvasCard>
  );
}
