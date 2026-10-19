"use client";

// The mind map's controls: its tools in the card's toolbar (layout, Tidy up, Outline, Foli AI, more, undo
// and redo), the zoom bar, the bar over the selected idea, and the idea's menu (right-click, a long press,
// or the bar's "More"). Neutral glass chrome (canvas/canvas.css `.fb-vc-btn`); only the swatches carry colour.
import { ArrowLeftFromLine, ChevronsDownUp, ChevronsUpDown, CornerDownRight, Focus, List, ListChecks, ListTree, Maximize, Minus, MoreHorizontal, Pencil, Plus, Redo2, Trash2, Undo2, WandSparkles, Waypoints } from "lucide-react";
import { MINDMAP_AUTO_COLORS, MINDMAP_COLOR_LABEL, MINDMAP_COLORS, type MindmapColor, type MindmapLayout } from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { MenuButton, type MenuEntry, type MenuItem } from "@/components/ui/Menu";

export const LAYOUT_LABEL: Record<MindmapLayout, string> = { both: "Both sides", right: "Right only", down: "Top down" };

/** A small picture of each layout, for its menu. */
export function LayoutIcon({ layout, size = 16 }: { layout: MindmapLayout; size?: number }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      {layout === "both" ? (
        <>
          <rect x="7.5" y="8" width="5" height="4" rx="1" {...s} />
          <path d="M12.5 10c2 0 2-4 4-4M12.5 10c2 0 2 4 4 4M7.5 10c-2 0-2-4-4-4M7.5 10c-2 0-2 4-4 4" {...s} />
        </>
      ) : layout === "right" ? (
        <>
          <rect x="2.5" y="8" width="5" height="4" rx="1" {...s} />
          <path d="M7.5 10c3 0 3-5.5 6-5.5M7.5 10h6M7.5 10c3 0 3 5.5 6 5.5" {...s} />
          <path d="M14.5 4.5h3M14.5 10h3M14.5 15.5h3" {...s} />
        </>
      ) : (
        <>
          <rect x="7.5" y="2.5" width="5" height="4" rx="1" {...s} />
          <path d="M10 6.5c0 3-5.5 3-5.5 6M10 6.5v6M10 6.5c0 3 5.5 3 5.5 6" {...s} />
          <path d="M4.5 14v3M10 14v3M15.5 14v3" {...s} />
        </>
      )}
    </svg>
  );
}

/** The tools in the card's toolbar. */
export function MindmapTools({
  layout,
  onLayout,
  onTidy,
  canTidy,
  outline,
  onOutline,
  onAi,
  aiOpen,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  more,
}: {
  layout: MindmapLayout;
  onLayout: (l: MindmapLayout) => void;
  onTidy: () => void;
  canTidy: boolean;
  outline: boolean;
  onOutline: () => void;
  onAi: (() => void) | null;
  aiOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  more: MenuEntry[];
}) {
  return (
    <>
      <MenuButton
        label={`Layout: ${LAYOUT_LABEL[layout]}`}
        align="start"
        triggerClassName="fb-vc-btn"
        trigger={<LayoutIcon layout={layout} />}
        items={(["both", "right", "down"] as const).map((l) => ({ label: LAYOUT_LABEL[l], icon: <LayoutIcon layout={l} />, checked: layout === l, onSelect: () => onLayout(l) }))}
      />
      <button type="button" className="fb-vc-btn mm-text-btn" onClick={onTidy} disabled={!canTidy} title="Tidy up: balance the branches and fit the map">
        <WandSparkles size={14} aria-hidden />
        <span className="mm-btn-label">Tidy up</span>
      </button>
      <button type="button" className="fb-vc-btn mm-text-btn" aria-pressed={outline} onClick={onOutline} title={outline ? "Show the map" : "Show as an outline"}>
        {outline ? <Waypoints size={14} aria-hidden /> : <ListTree size={14} aria-hidden />}
        <span className="mm-btn-label">Outline</span>
      </button>
      {onAi ? (
        <button type="button" className="fb-vc-btn mm-text-btn" aria-pressed={aiOpen} aria-expanded={aiOpen} onClick={onAi} title="Foli AI: make, grow or sum up the map">
          <AiIcon size={14} />
          <span className="mm-btn-label">Foli AI</span>
        </button>
      ) : null}
      <span className="fb-vc-sep" aria-hidden />
      <button type="button" className="fb-vc-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
        <Undo2 size={14} aria-hidden />
      </button>
      <button type="button" className="fb-vc-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>
        <Redo2 size={14} aria-hidden />
      </button>
      <MenuButton label="More mind map actions" align="start" triggerClassName="fb-vc-btn" trigger={<MoreHorizontal size={15} aria-hidden />} items={more} />
    </>
  );
}

/** The map's "More" menu. */
export function moreItems(o: { onExpandAll: () => void; onCollapseAll: () => void; onToList: (() => void) | null; onFit: () => void; hasMap: boolean }): MenuEntry[] {
  return [
    { label: "Expand all", icon: <ChevronsUpDown size={14} />, disabled: !o.hasMap, onSelect: o.onExpandAll },
    { label: "Collapse all", icon: <ChevronsDownUp size={14} />, disabled: !o.hasMap, onSelect: o.onCollapseAll },
    { label: "Fit to view", icon: <Maximize size={14} />, shortcut: "⇧1", disabled: !o.hasMap, onSelect: o.onFit },
    ...(o.onToList ? (["separator", { label: "Turn into bulleted list", icon: <List size={14} />, disabled: !o.hasMap, onSelect: o.onToList }] as MenuEntry[]) : []),
  ];
}

export function ZoomBar({ zoom, onZoomIn, onZoomOut, onFit }: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void }) {
  return (
    <div className="mm-bar mm-zoom" role="toolbar" aria-label="Zoom" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="fb-vc-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={onZoomOut}>
        <Minus size={14} aria-hidden />
      </button>
      <span className="mm-zoom-value" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" className="fb-vc-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={onZoomIn}>
        <Plus size={14} aria-hidden />
      </button>
      <button type="button" className="fb-vc-btn" aria-label="Fit to view" title="Fit to view (⇧1)" onClick={onFit}>
        <Maximize size={13} aria-hidden />
      </button>
    </div>
  );
}

/** Colour entries for an idea's menu: automatic (its branch's turn, or inherited), then each colour. */
export function colorEntries(current: MindmapColor | undefined, onPick: (c: MindmapColor | undefined) => void): MenuEntry[] {
  return [
    { heading: "Colour" },
    { label: "Automatic", icon: <Swatch color={null} />, checked: current === undefined, onSelect: () => onPick(undefined) },
    ...[...MINDMAP_AUTO_COLORS, ...MINDMAP_COLORS.filter((c) => !MINDMAP_AUTO_COLORS.includes(c))].map((c): MenuItem => ({ label: MINDMAP_COLOR_LABEL[c], icon: <Swatch color={c} />, checked: current === c, onSelect: () => onPick(c) })),
  ];
}

function Swatch({ color }: { color: MindmapColor | null }) {
  return <span className="mm-swatch" data-color={color ?? undefined} data-auto={color === null || undefined} aria-hidden />;
}

export interface IdeaActions {
  isRoot: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  focused: boolean;
  canOutdent: boolean;
  /** Its own colour (unset: automatic), and the colour it shows. */
  color: MindmapColor | undefined;
  shown: MindmapColor;
  aiOn: boolean;
  onAddChild: () => void;
  onAddSibling: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onFocus: () => void;
  onOutdent: () => void;
  onColor: (c: MindmapColor | undefined) => void;
  onExpandAi: () => void;
  onTasksAi: () => void;
  onDelete: () => void;
}

/** An idea's menu (right-click, a long press, or "More" on its bar). Colours are on the bar. */
export function ideaMenu(a: IdeaActions): (MenuItem | "separator")[] {
  const items: (MenuItem | "separator")[] = [
    { label: "Add idea inside", icon: <CornerDownRight size={14} />, shortcut: "Tab", onSelect: a.onAddChild },
    ...(a.isRoot ? [] : [{ label: "Add idea after", icon: <Plus size={14} />, shortcut: "⇧Enter", onSelect: a.onAddSibling }]),
    { label: "Edit text", icon: <Pencil size={14} />, shortcut: "F2", onSelect: a.onEdit },
  ];
  if (a.hasChildren && !a.isRoot) items.push({ label: a.collapsed ? "Expand branch" : "Collapse branch", icon: a.collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />, shortcut: "Space", onSelect: a.onToggle });
  if (!a.isRoot || a.focused) items.push({ label: a.focused ? "Show the whole map" : "Focus on this branch", icon: <Focus size={14} />, onSelect: a.onFocus });
  if (a.canOutdent) items.push({ label: "Move up a level", icon: <ArrowLeftFromLine size={14} />, shortcut: "⇧Tab", onSelect: a.onOutdent });
  if (a.aiOn) {
    items.push("separator");
    items.push({ label: "Expand with Foli AI", icon: <AiIcon size={14} />, description: "3 to 6 new ideas inside", onSelect: a.onExpandAi });
    items.push({ label: a.isRoot ? "Turn the map into tasks" : "Turn into tasks", icon: <ListChecks size={14} />, description: "Foli AI adds them to the note as to-dos", onSelect: a.onTasksAi });
  }
  if (!a.isRoot) {
    items.push("separator");
    items.push({ label: "Delete", icon: <Trash2 size={14} />, shortcut: "⌫", danger: true, onSelect: a.onDelete });
  }
  return items;
}

/** The bar over the selected idea: add inside, colour, fold, Foli AI, and the idea's menu. */
export function IdeaBar({ style, a, onMore }: { style: React.CSSProperties; a: IdeaActions; onMore: (at: { x: number; y: number }) => void }) {
  return (
    <div className="mm-bar mm-idea-bar" role="toolbar" aria-label="Selected idea" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="fb-vc-btn" aria-label="Add idea inside" title="Add idea inside (Tab)" onClick={a.onAddChild}>
        <CornerDownRight size={14} aria-hidden />
      </button>
      {!a.isRoot ? (
        <button type="button" className="fb-vc-btn" aria-label="Add idea after" title="Add idea after (⇧Enter)" onClick={a.onAddSibling}>
          <Plus size={14} aria-hidden />
        </button>
      ) : null}
      <MenuButton label="Colour" align="start" triggerClassName="fb-vc-btn" trigger={<Swatch color={a.shown} />} items={colorEntries(a.color, a.onColor)} />
      {a.hasChildren && !a.isRoot ? (
        <button type="button" className="fb-vc-btn" aria-label={a.collapsed ? "Expand branch" : "Collapse branch"} title={`${a.collapsed ? "Expand" : "Collapse"} (Space)`} onClick={a.onToggle}>
          {a.collapsed ? <ChevronsUpDown size={14} aria-hidden /> : <ChevronsDownUp size={14} aria-hidden />}
        </button>
      ) : null}
      {a.aiOn ? (
        <button type="button" className="fb-vc-btn" aria-label="Expand with Foli AI" title="Expand with Foli AI: 3 to 6 new ideas" onClick={a.onExpandAi}>
          <AiIcon size={14} />
        </button>
      ) : null}
      <button
        type="button"
        className="fb-vc-btn"
        aria-label="More for this idea"
        aria-haspopup="menu"
        title="More"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMore({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <MoreHorizontal size={15} aria-hidden />
      </button>
    </div>
  );
}
