"use client";

// Double-click: write in a shape or on a connector, or add a shape on empty canvas.
import type { Interaction } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";
import type { TextEditing } from "./textEditing";

export function doubleClickInteraction({ startEdit, add }: { startEdit: TextEditing["startEdit"]; add: FlowActions["add"] }): Interaction {
  return {
    doubleClick: ({ target, at, onBackground }) => {
      const nodeEl = target.closest("[data-fc-node]");
      if (nodeEl) {
        startEdit("node", nodeEl.getAttribute("data-fc-node")!);
        return true;
      }
      const edgeEl = target.closest("[data-fc-edge]");
      if (edgeEl) {
        startEdit("edge", edgeEl.getAttribute("data-fc-edge")!);
        return true;
      }
      // Other canvas items (handles) do nothing on a double-click.
      if (!onBackground) return true;
      add("process", at);
      return true;
    },
  };
}
