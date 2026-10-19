"use client";

// Wireframe block: screens built from interface parts (buttons, inputs, cards, tables and more), with arrows
// between them. The content lives in the block's `data` (packages/editor-schema/src/wireframe.ts).
//
// The card, its toolbar, Full canvas (⇧⌘F, Esc back), Export (PNG, SVG, PDF, Copy as image; ./svg.ts) and
// the height handle come from canvas/CanvasCard.tsx. The editor goes in the card's children, its tools in
// `tools`; until then the card shows what's in the block (./render.tsx) or how to start.
import type { ReactNodeViewProps } from "@tiptap/react";
import { useMemo } from "react";
import { PanelsTopLeft } from "lucide-react";
import { LIMITS, WIREFRAME_DEFAULT_HEIGHT, parseWireframe, serializeWireframe } from "@folevi/editor-schema";
import { CanvasCard } from "../canvas/CanvasCard";
import { WireframeStatic } from "./render";

export function WireframeView(props: ReactNodeViewProps) {
  const data = String(props.node.attrs.data ?? "");
  const empty = useMemo(() => !serializeWireframe(parseWireframe(data)), [data]);
  return (
    <CanvasCard
      view={props}
      type="wireframe"
      name="Wireframe"
      icon={<PanelsTopLeft size={14} />}
      minHeight={LIMITS.minWireframeHeight}
      maxHeight={LIMITS.maxWireframeHeight}
      defaultHeight={WIREFRAME_DEFAULT_HEIGHT}
      empty={empty}
      hint="Add a phone, tablet or browser screen, then drag interface parts onto it."
    >
      {empty ? null : (
        <div className="fb-vc-content">
          <WireframeStatic data={data} />
        </div>
      )}
    </CanvasCard>
  );
}
