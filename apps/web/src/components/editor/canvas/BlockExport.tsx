"use client";

// Export from a visual block's menus: PNG, SVG, PDF and Copy as image (canvas/exportImage.ts), with a toast
// when it's done or why it couldn't be. `exportItems` feeds the block menu (EditorMenus) and
// `BlockExportMenu` is the button for a block's own toolbar, so it works in full canvas too.
import { Copy, Download, FileImage, FileText, Image as ImageIcon } from "lucide-react";
import { useCallback } from "react";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { blockImageSvg, IMAGE_BLOCKS } from "./blockImage";
import { copyImage, exportImage, IMAGE_FORMAT_LABEL, type ImageFormat } from "./exportImage";

export type ExportAction = ImageFormat | "copy";

const ICONS: Record<ExportAction, React.ReactNode> = {
  png: <ImageIcon size={14} aria-hidden />,
  svg: <FileImage size={14} aria-hidden />,
  pdf: <FileText size={14} aria-hidden />,
  copy: <Copy size={14} aria-hidden />,
};

const ACTIONS: ExportAction[] = ["png", "svg", "pdf", "copy"];
const actionLabel = (a: ExportAction) => (a === "copy" ? "Copy as image" : `Export as ${IMAGE_FORMAT_LABEL[a]}`);

/** Runs an export of a block (by type and node attributes), and says how it went. */
export function useBlockExport() {
  const toast = useToast();
  return useCallback(
    async (action: ExportAction, type: string, attrs: Record<string, unknown>) => {
      const svg = blockImageSvg(type, attrs);
      if (!svg) return toast.show("There's nothing to export yet.");
      const name = IMAGE_BLOCKS[type]?.name ?? "Image";
      try {
        if (action === "copy") {
          await copyImage(svg);
          toast.show("Image copied");
        } else {
          await exportImage(svg, name, action);
        }
      } catch (e) {
        toast.show(action === "copy" ? `Couldn't copy the image. ${(e as Error).message || ""}`.trim() : "Couldn't export the image. Try again.", { tone: "error" });
      }
    },
    [toast],
  );
}

/** The export entries for a block: one per format and Copy as image (none when it isn't a picture block). */
export function exportItems(type: string, attrs: Record<string, unknown>, run: (action: ExportAction) => void): { action: ExportAction; label: string; icon: React.ReactNode; disabled: boolean; run: () => void }[] {
  if (!IMAGE_BLOCKS[type]) return [];
  const empty = !blockImageSvg(type, attrs);
  return ACTIONS.map((action) => ({ action, label: actionLabel(action), icon: ICONS[action], disabled: empty, run: () => run(action) }));
}

/**
 * An Export button with a menu, for a block's own toolbar. `attrs` is read when an item is chosen; `empty`
 * (when the block knows) saves drawing the picture on every render just to see whether there is one.
 */
export function BlockExportMenu({ type, attrs, empty: knownEmpty, triggerClassName, align = "end", side = "bottom" }: { type: string; attrs: () => Record<string, unknown>; empty?: boolean; triggerClassName?: string; align?: "start" | "end"; side?: "top" | "bottom" }) {
  const run = useBlockExport();
  const empty = knownEmpty ?? !blockImageSvg(type, attrs());
  const items: MenuItem[] = ACTIONS.map((action) => ({ label: actionLabel(action), icon: ICONS[action], disabled: empty, onSelect: () => void run(action, type, attrs()) }));
  return <MenuButton label="Export" align={align} side={side} triggerClassName={triggerClassName} trigger={<Download size={14} aria-hidden />} items={items} />;
}
