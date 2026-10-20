"use client";

// The toolbar's Tidy up: the button lays the chart out at once; the menu next to it picks the direction
// (top-down or left to right, which also tidies), whether to keep the person's placement, and offers "Tidy up
// with Foli AI" when the chart is still hard to read.
import { ChevronDown, WandSparkles } from "lucide-react";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { AiIcon } from "@/components/ai/AiIcon";
import type { Tidy } from "../interactions/tidy";

export function TidyControl({ tidy, canTidy, aiTidy }: { tidy: Tidy; canTidy: boolean; aiTidy: boolean }) {
  const dir = tidy.direction();
  const items: MenuEntry[] = [
    { heading: "Direction" },
    { label: "Top to bottom", checked: dir === "TD", onSelect: () => tidy.run({ direction: "TD" }), disabled: !canTidy },
    { label: "Left to right", checked: dir === "LR", onSelect: () => tidy.run({ direction: "LR" }), disabled: !canTidy },
    "separator",
    { label: "Keep my placement", multi: true, checked: tidy.keepPlacement, description: "Keeps the order and groups you made", onSelect: () => tidy.setKeep(!tidy.keepPlacement) },
  ];
  if (aiTidy && canTidy && tidy.hardToRead) {
    items.push("separator", { label: "Tidy up with Foli AI", icon: <AiIcon size={14} className="fc-ai-mark" />, disabled: tidy.busy, onSelect: () => void tidy.withAi() });
  }
  return (
    <span className="fc-group fc-tidy" role="group" aria-label="Tidy up">
      <button type="button" className="fc-btn fc-btn-text" onClick={() => tidy.run()} disabled={!canTidy} title={`Tidy up: lay the chart out ${dir === "LR" ? "left to right" : "top to bottom"}`}>
        <WandSparkles size={15} aria-hidden /> Tidy up
      </button>
      <MenuButton label="Layout options" align="start" triggerClassName="fc-btn fc-tidy-more" trigger={<ChevronDown size={13} aria-hidden />} items={items} />
    </span>
  );
}
