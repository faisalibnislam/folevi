"use client";

// Align and distribute for several selected shapes: one button in the selection bar opening a menu (the
// app's own Menu). Each choice is one undo step (alignNodes, distributeNodes in the model).
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
} from "lucide-react";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { alignNodes, distributeNodes, type FlowAlign } from "../schema";
import type { FlowController } from "../controller/types";

const ALIGN: { how: FlowAlign; label: string; said: string; Icon: typeof AlignStartVertical }[] = [
  { how: "left", label: "Align left", said: "to the left", Icon: AlignStartVertical },
  { how: "center", label: "Align centres", said: "on their centres", Icon: AlignCenterVertical },
  { how: "right", label: "Align right", said: "to the right", Icon: AlignEndVertical },
  { how: "top", label: "Align top", said: "to the top", Icon: AlignStartHorizontal },
  { how: "middle", label: "Align middles", said: "on their middles", Icon: AlignCenterHorizontal },
  { how: "bottom", label: "Align bottom", said: "to the bottom", Icon: AlignEndHorizontal },
];

export function AlignMenu({ ctrl }: { ctrl: FlowController }) {
  const { docRef, commit, sel, say } = ctrl;
  const ids = sel.nodes;
  const n = ids.length;
  const apply = (next: ReturnType<typeof alignNodes>, message: string) => {
    if (next === docRef.current) return;
    commit(next);
    say(message);
  };
  const items: MenuEntry[] = [
    { heading: "Align" },
    ...ALIGN.map(({ how, label, said, Icon }) => ({ label, icon: <Icon size={15} />, onSelect: () => apply(alignNodes(docRef.current, ids, how), `Aligned ${n} shapes ${said}.`) })),
    "separator",
    { heading: "Distribute" },
    { label: "Space evenly across", icon: <AlignHorizontalDistributeCenter size={15} />, disabled: n < 3, onSelect: () => apply(distributeNodes(docRef.current, ids, "horizontal"), `Spaced ${n} shapes evenly across.`) },
    { label: "Space evenly down", icon: <AlignVerticalDistributeCenter size={15} />, disabled: n < 3, onSelect: () => apply(distributeNodes(docRef.current, ids, "vertical"), `Spaced ${n} shapes evenly down.`) },
  ];
  return <MenuButton label="Align and distribute" align="start" triggerClassName="fc-btn fc-btn-menu" trigger={<AlignCenterVertical size={15} aria-hidden />} items={items} />;
}
