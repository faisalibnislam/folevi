"use client";

// The right-click menu for a shape or connector (the note's own menu doesn't open in the canvas).
import { useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { ContextMenu } from "@/components/ui/Menu";
import type { FlowController, Interaction } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";
import type { TextEditing } from "./textEditing";

export function useContextMenu(ctrl: FlowController, { actions, startEdit }: { actions: FlowActions; startEdit: TextEditing["startEdit"] }) {
  const { selRef, setSel, full, cardRef } = ctrl;
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; kind: "node" | "edge"; id: string } | null>(null);

  const interaction: Interaction = {
    contextMenu: ({ e, target }) => {
      const nodeEl = target.closest("[data-fc-node]");
      const edgeEl = nodeEl ? null : target.closest("[data-fc-edge]");
      const id = nodeEl?.getAttribute("data-fc-node") ?? edgeEl?.getAttribute("data-fc-edge");
      if (!id) return false;
      const kind = nodeEl ? "node" : "edge";
      const s = selRef.current;
      if (!(kind === "node" ? s.nodes : s.edges).includes(id)) setSel(kind === "node" ? { nodes: [id], edges: [] } : { nodes: [], edges: [id] });
      setMenu({ at: { x: e.clientX, y: e.clientY }, kind, id });
      return true;
    },
  };

  const element = menu ? (
    <ContextMenu
      at={menu.at}
      label={menu.kind === "node" ? "Shape" : "Connector"}
      // In full canvas the card is on the top layer: the menu goes inside it to show above it.
      host={full ? (cardRef.current ?? undefined) : undefined}
      onClose={() => setMenu(null)}
      items={
        menu.kind === "node"
          ? [
              { label: "Edit text", shortcut: "Enter", icon: <Pencil size={14} />, onSelect: () => startEdit("node", menu.id) },
              { label: "Duplicate", shortcut: "⌘D", icon: <Copy size={14} />, onSelect: actions.duplicateSelection },
              "separator",
              { label: "Delete", shortcut: "⌫", icon: <Trash2 size={14} />, danger: true, onSelect: actions.removeSelection },
            ]
          : [
              { label: "Edit label", shortcut: "Enter", icon: <Pencil size={14} />, onSelect: () => startEdit("edge", menu.id) },
              "separator",
              { label: "Delete", shortcut: "⌫", icon: <Trash2 size={14} />, danger: true, onSelect: actions.removeSelection },
            ]
      }
    />
  ) : null;

  return { interaction, /** The open menu (rendered inside the card). */ element };
}
