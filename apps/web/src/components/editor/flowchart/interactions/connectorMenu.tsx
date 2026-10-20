"use client";

// A connector's right-click menu (interactions/contextMenu.tsx opens it): labels, route style, turning it
// around, its bend points, selecting every connector, deleting. Right-clicking a label or a bend point
// adds that item's own entries first. Every entry is one undo step.
import { ArrowLeftRight, Pencil, Plus, Spline, Trash2, Waypoints, X } from "lucide-react";
import type { MenuItem } from "@/components/ui/Menu";
import type { FlowRoute, Pt } from "../schema";
import { clearBends, patchEdges, removeBend, removeLabel, reverseEdges, styleEdges } from "../connectors";
import { startNewLabel } from "./edgeLabels";
import type { FlowController } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";

export const ROUTE_LABEL: Record<FlowRoute, string> = { elbow: "Elbow", curved: "Curved", straight: "Straight" };

/** Where on the connector the menu was opened: a label, a bend point, or the line at a point. */
export interface ConnectorSpot {
  id: string;
  label?: number;
  bend?: number;
  at?: Pt;
}

/** What the press landed on, read from the data-fc-* attributes of the connector layer and overlay. */
export function connectorSpot(target: Element, at: Pt): ConnectorSpot | null {
  const bend = target.closest("[data-fc-bend]");
  if (bend) return { id: bend.getAttribute("data-edge")!, bend: Number(bend.getAttribute("data-fc-bend")), at };
  const el = target.closest("[data-fc-edge]");
  if (!el) return null;
  const label = el.getAttribute("data-fc-label");
  return { id: el.getAttribute("data-fc-edge")!, label: label === null ? undefined : Number(label), at };
}

export function connectorMenuItems(ctrl: FlowController, spot: ConnectorSpot, { actions }: { actions: FlowActions }): (MenuItem | "separator")[] {
  const { docRef, commit, selRef, setSel, setEditing } = ctrl;
  const edge = docRef.current.edges.find((x) => x.id === spot.id);
  if (!edge) return [];
  // The menu acts on every selected connector (it was right-clicked into the selection).
  const ids = () => (selRef.current.edges.includes(spot.id) ? selRef.current.edges : [spot.id]);
  const items: (MenuItem | "separator")[] = [];
  if (spot.label !== undefined && edge.labels[spot.label]) {
    const index = spot.label;
    items.push(
      { label: "Edit label", shortcut: "Enter", icon: <Pencil size={14} />, onSelect: () => setEditing({ kind: "edge", id: spot.id, before: docRef.current, label: index }) },
      { label: "Remove label", icon: <X size={14} />, onSelect: () => commit(patchEdges(docRef.current, [spot.id], (x) => removeLabel(x, index))) },
      "separator",
    );
  } else if (spot.bend !== undefined && edge.bends[spot.bend]) {
    const index = spot.bend;
    items.push({ label: "Remove bend point", icon: <X size={14} />, onSelect: () => commit(patchEdges(docRef.current, [spot.id], (x) => removeBend(x, index))) }, "separator");
  }
  items.push({ label: edge.labels.length ? "Add another label" : "Add label", icon: <Plus size={14} />, disabled: edge.labels.length >= 8, onSelect: () => startNewLabel(ctrl, spot.id) });
  items.push("separator");
  for (const route of ["elbow", "curved", "straight"] as const) {
    items.push({ label: `${ROUTE_LABEL[route]} line`, checked: edge.route === route, onSelect: () => commit(styleEdges(docRef.current, ids(), { route })) });
  }
  items.push(
    "separator",
    { label: "Reverse direction", icon: <ArrowLeftRight size={14} />, onSelect: () => commit(reverseEdges(docRef.current, ids())) },
    { label: "Straighten (remove bend points)", icon: <Spline size={14} />, disabled: !edge.bends.length, onSelect: () => commit(clearBends(docRef.current, ids())) },
    { label: "Select all connectors", icon: <Waypoints size={14} />, onSelect: () => setSel({ nodes: [], edges: docRef.current.edges.map((x) => x.id) }) },
    "separator",
    { label: "Delete", shortcut: "⌫", icon: <Trash2 size={14} />, danger: true, onSelect: actions.removeSelection },
  );
  return items;
}
