// Shared definitions for the Insert panel and the slash menu.
import type { DividerStyle } from "@folevi/editor-schema";

export const DIVIDER_STYLES: { style: DividerStyle; label: string }[] = [
  { style: "extralight", label: "Extra light" },
  { style: "light", label: "Light" },
  { style: "regular", label: "Regular" },
  { style: "strong", label: "Strong" },
];

/** Starter diagram for a new Mermaid block. */
export const MERMAID_SAMPLE = ["flowchart TD", "  A[Idea] --> B{Worth doing?}", "  B -- Yes --> C[Plan it]", "  B -- Not yet --> D[Park it]", "  C --> E[Ship]"].join("\n");
