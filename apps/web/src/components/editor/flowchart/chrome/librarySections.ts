// The shape library panel's sections: every shape the model knows, grouped as Flowchart, Basic, and Arrows
// and callouts, in catalog order (or in search order while searching). Pure, so it can be tested.
import { FLOWCHART_SHAPES, FLOWCHART_SHAPE_INFO, searchFlowShapes, type FlowShape } from "../schema";

export type LibraryGroup = "flowchart" | "basic" | "arrows";

export const LIBRARY_GROUPS: { id: LibraryGroup; label: string }[] = [
  { id: "flowchart", label: "Flowchart" },
  { id: "basic", label: "Basic" },
  { id: "arrows", label: "Arrows and callouts" },
];

const ARROWS_AND_CALLOUTS = new Set<FlowShape>(["arrowRight", "arrowLeft", "arrowUp", "arrowDown", "doubleArrow", "chevron", "callout", "annotation"]);

/** The panel section a shape is listed in. */
export function libraryGroup(shape: FlowShape): LibraryGroup {
  if (ARROWS_AND_CALLOUTS.has(shape)) return "arrows";
  return FLOWCHART_SHAPE_INFO[shape].group === "flowchart" ? "flowchart" : "basic";
}

export interface LibrarySection {
  id: LibraryGroup;
  label: string;
  shapes: FlowShape[];
}

/** The panel's sections for a search ("" lists everything); sections without a match are left out. */
export function librarySections(query: string): LibrarySection[] {
  const shapes = query.trim() ? searchFlowShapes(query) : [...FLOWCHART_SHAPES];
  return LIBRARY_GROUPS.map((g) => ({ ...g, shapes: shapes.filter((s) => libraryGroup(s) === g.id) })).filter((s) => s.shapes.length);
}
