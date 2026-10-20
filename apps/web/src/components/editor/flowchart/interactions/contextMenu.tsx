"use client";

// The right-click menu for a shape or connector (the note's own menu doesn't open in the canvas).
import { useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { ContextMenu, type MenuItem } from "@/components/ui/Menu";
import type { FlowController, Interaction } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";
import type { TextEditing } from "./textEditing";
import type { ShapeContent } from "./content";
import { connectorMenuItems, connectorSpot, type ConnectorSpot } from "./connectorMenu";

/** `nodeItems`: more entries for a shape's menu from other modules (frames: "Frame selection"), above Delete. */
export function useContextMenu(ctrl: FlowController, { actions, startEdit, nodeItems }: { actions: FlowActions; startEdit: TextEditing["startEdit"]; nodeItems?: () => MenuItem[] }) {
  const { selRef, setSel, full, cardRef } = ctrl;
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; kind: "node" | "edge"; id: string; spot?: ConnectorSpot } | null>(null);

  const interaction: Interaction = {
    contextMenu: ({ e, target, at }) => {
      const nodeEl = target.closest("[data-fc-node]");
      // A connector's line, label or bend point (interactions/connectorMenu.tsx).
      const spot = nodeEl ? null : connectorSpot(target, at);
      const id = nodeEl?.getAttribute("data-fc-node") ?? spot?.id;
      if (!id) return false;
      const kind = nodeEl ? "node" : "edge";
      const s = selRef.current;
      if (!(kind === "node" ? s.nodes : s.edges).includes(id)) setSel(kind === "node" ? { nodes: [id], edges: [] } : { nodes: [], edges: [id] });
      setMenu({ at: { x: e.clientX, y: e.clientY }, kind, id, spot: spot ?? undefined });
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
              ...(nodeItems?.() ?? []),
              "separator",
              { label: "Delete", shortcut: "⌫", icon: <Trash2 size={14} />, danger: true, onSelect: actions.removeSelection },
            ]
          : connectorMenuItems(ctrl, menu.spot ?? { id: menu.id }, { actions })
      }
    />
  ) : null;

  return { interaction, /** The open menu (rendered inside the card). */ element };
}
