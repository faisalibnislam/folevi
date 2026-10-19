// The table's block menu entry for charts: "Turn into chart" makes a chart of the table right under it,
// following the table live; with Foli AI on, Foli AI writes its title and takeaway line (fromTable.ts).
import type { Editor } from "@tiptap/react";
import { ChartColumn } from "lucide-react";
import { haptic } from "@/lib/nativeApp";
import { turnTableIntoChart } from "./fromTable";

/** The block menu's chart entries for blocks `from`..`to` (one table: Turn into chart). */
export function chartMenuItems(editor: Editor, from: number, to: number, { aiOn, close }: { aiOn: boolean; close: (refocus?: boolean) => void }) {
  if (from !== to || editor.state.doc.maybeChild(from)?.type.name !== "table" || !editor.isEditable) return [];
  return [
    {
      label: "Turn into chart",
      hint: "",
      icon: <ChartColumn size={14} />,
      run: () => {
        close(false);
        if (turnTableIntoChart(editor, from, aiOn)) haptic("light");
      },
    },
  ];
}
