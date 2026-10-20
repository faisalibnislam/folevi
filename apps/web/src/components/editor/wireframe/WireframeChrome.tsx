"use client";

// The wireframe canvas's controls: the tools in the block's toolbar (add a screen, the parts library,
// Clean or Sketch, Foli AI, undo and redo), zoom, the parts library itself (searchable; tap or drag a part
// onto a screen), and the bar that edits the selection (text, options, links, align, export, delete).
// Neutral glass chrome; the drawing is greyscale by design. The bars fold what doesn't fit into a More menu
// (canvas/ToolFold.tsx), so each tool also says how it reads as menu rows.
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowRight,
  Copy,
  Download,
  LayoutGrid,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  X,
  Monitor,
  Square,
  Image as ImageIcon,
  FileImage,
  FileText,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  WIREFRAME_COMPONENT_LABEL,
  WIREFRAME_FRAMES,
  WIREFRAME_FRAME_LABEL,
  WIREFRAME_OPTIONS,
  WIREFRAME_OPTION_DEFAULTS,
  wireframePartSize,
  type WireItem,
  type WireScreen,
  type WireframeComponent,
  type WireframeFrame,
  type WireframeStyle,
} from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { ToolFold, type FoldTool } from "../canvas/ToolFold";
import { colsOf, countOf, drawItem } from "./draw";
import type { Align } from "./ops";
import type { ExportAction } from "../canvas/BlockExport";

export const FRAME_ICON: Record<WireframeFrame, ReactNode> = {
  phone: <Smartphone size={15} aria-hidden />,
  tablet: <Tablet size={15} aria-hidden />,
  browser: <Monitor size={15} aria-hidden />,
  plain: <Square size={15} aria-hidden />,
};

// ------------------------------------------------------------------------------------------ toolbar

export interface ToolsProps {
  style: WireframeStyle;
  onStyle: (s: WireframeStyle) => void;
  onAddScreen: (f: WireframeFrame) => void;
  libraryOpen: boolean;
  onLibrary: () => void;
  onAi: (() => void) | null;
  aiOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Touch: taps add to the selection (null where there's a keyboard's Shift). */
  multi: boolean | null;
  onMulti: () => void;
}

const STYLE_TITLE: Record<WireframeStyle, string> = { clean: "Clean greyscale lines", sketch: "Hand-drawn lines and handwriting" };

/** The block's toolbar tools (CanvasCard folds the ones that don't fit into More, least used first). */
export function wireTools({ style, onStyle, onAddScreen, libraryOpen, onLibrary, onAi, aiOpen, onUndo, onRedo, canUndo, canRedo, multi, onMulti }: ToolsProps): FoldTool[] {
  const frames = WIREFRAME_FRAMES.map((f) => ({ label: `${WIREFRAME_FRAME_LABEL[f]} screen`, icon: FRAME_ICON[f], onSelect: () => onAddScreen(f) }));
  const tools: FoldTool[] = [
    {
      key: "screen",
      priority: 6,
      node: (
        <MenuButton
          label="Add screen"
          align="start"
          triggerClassName="fb-vc-btn wf-btn-text"
          trigger={
            <>
              <Plus size={14} aria-hidden /> <span className="wf-btn-label">Screen</span>
            </>
          }
          items={frames}
        />
      ),
      menu: [{ heading: "Add screen" }, ...frames],
    },
    {
      key: "parts",
      priority: 5,
      node: (
        <button type="button" className="fb-vc-btn wf-btn-text" aria-pressed={libraryOpen} aria-label="Parts" onClick={onLibrary} title="Interface parts to drag onto a screen">
          <LayoutGrid size={14} aria-hidden /> <span className="wf-btn-label">Parts</span>
        </button>
      ),
      menu: [{ label: "Parts", icon: <LayoutGrid size={14} aria-hidden />, checked: libraryOpen, multi: true, onSelect: onLibrary }],
    },
    {
      key: "look",
      priority: 1,
      node: (
        <span className="wf-seg" role="group" aria-label="Look">
          {(["clean", "sketch"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={style === s} onClick={() => onStyle(s)} title={STYLE_TITLE[s]}>
              {s === "clean" ? "Clean" : "Sketch"}
            </button>
          ))}
        </span>
      ),
      menu: [{ heading: "Look" }, ...(["clean", "sketch"] as const).map((s) => ({ label: s === "clean" ? "Clean" : "Sketch", description: STYLE_TITLE[s], checked: style === s, onSelect: () => onStyle(s) }))],
    },
  ];
  if (onAi) {
    tools.push({
      key: "ai",
      priority: 3,
      node: (
        <button type="button" className="fb-vc-btn wf-btn-text" aria-pressed={aiOpen} aria-expanded={aiOpen} aria-label="Foli AI" onClick={onAi} title="Draw, vary or refine screens with Foli AI">
          <AiIcon size={14} className="wf-ai-mark" /> <span className="wf-btn-label">Foli AI</span>
        </button>
      ),
      menu: [{ label: "Foli AI", icon: <AiIcon size={14} className="wf-ai-mark" />, onSelect: onAi }],
    });
  }
  if (multi !== null) {
    tools.push({
      key: "multi",
      priority: 2,
      node: (
        <button type="button" className="fb-vc-btn" aria-pressed={multi} aria-label="Select several" title="Select several: each tap adds to the selection" onClick={onMulti}>
          <MousePointer2 size={15} aria-hidden />
        </button>
      ),
      menu: [{ label: "Select several", icon: <MousePointer2 size={14} aria-hidden />, checked: multi, multi: true, onSelect: onMulti }],
    });
  }
  tools.push(
    {
      key: "undo",
      sep: true,
      priority: 4,
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={15} aria-hidden />
        </button>
      ),
      menu: [{ label: "Undo", icon: <Undo2 size={14} aria-hidden />, shortcut: "⌘Z", disabled: !canUndo, onSelect: onUndo }],
    },
    {
      key: "redo",
      priority: 3,
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={15} aria-hidden />
        </button>
      ),
      menu: [{ label: "Redo", icon: <Redo2 size={14} aria-hidden />, shortcut: "⇧⌘Z", disabled: !canRedo, onSelect: onRedo }],
    },
  );
  return tools;
}

export function ZoomBar({ zoom, onZoomIn, onZoomOut, onFit }: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void }) {
  return (
    <div className="wf-bar wf-bar-zoom" role="toolbar" aria-label="Zoom" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="fb-vc-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={onZoomOut}>
        <Minus size={15} aria-hidden />
      </button>
      <span className="wf-zoom" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" className="fb-vc-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={onZoomIn}>
        <Plus size={15} aria-hidden />
      </button>
      <button type="button" className="fb-vc-btn" aria-label="Fit to screens" title="Fit to screens (⇧1)" onClick={onFit}>
        <Maximize size={14} aria-hidden />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ library

interface Group {
  name: string;
  kinds: WireframeComponent[];
}
const GROUPS: Group[] = [
  { name: "Text", kinds: ["heading", "text", "paragraph"] },
  { name: "Controls", kinds: ["button", "input", "search", "textarea", "checkbox", "radio", "toggle", "slider", "dropdown", "datePicker"] },
  { name: "Navigation", kinds: ["navBar", "tabs", "sidebar", "menu", "breadcrumbs", "pagination"] },
  { name: "Content", kinds: ["card", "table", "list", "avatar", "badge", "tooltip", "modal", "alert", "progress", "divider"] },
  { name: "Media", kinds: ["image", "icon", "video", "map"] },
];

/** Words a part is found by in the library's search. */
const KEYWORDS: Partial<Record<WireframeComponent, string>> = {
  text: "label copy words",
  heading: "title h1 header",
  paragraph: "body copy lorem text block",
  button: "primary secondary action cta submit",
  input: "text field form email password",
  search: "find field box",
  textarea: "multiline comment message field",
  checkbox: "check tick option form",
  radio: "option choice form",
  toggle: "switch on off setting",
  slider: "range volume",
  dropdown: "select picker combobox menu",
  datePicker: "calendar date",
  tabs: "segmented tab bar",
  navBar: "navigation header app bar toolbar tab bar bottom",
  sidebar: "drawer navigation menu",
  menu: "context dropdown list popover",
  breadcrumbs: "path navigation",
  pagination: "pages next previous",
  card: "tile panel",
  table: "grid data rows columns spreadsheet",
  list: "rows items feed",
  avatar: "profile user photo picture",
  badge: "chip tag pill label count",
  tooltip: "hint popover",
  modal: "dialog popup overlay sheet",
  alert: "banner notice toast message error warning",
  progress: "loading bar",
  image: "photo picture placeholder",
  icon: "symbol glyph",
  video: "player movie play",
  map: "location pin",
  divider: "line separator rule hr",
};

/** A part drawn small for its library tile. */
function PartPreview({ kind, style }: { kind: WireframeComponent; style: WireframeStyle }) {
  const svg = useMemo(() => {
    const base = wireframePartSize(kind, { w: 220, h: 320 });
    const size = { w: Math.min(base.w, 200), h: Math.min(base.h, kind === "sidebar" ? 200 : 150) };
    const it: WireItem = { id: `lib-${kind}`, screen: "lib", kind, x: 0, y: 0, ...size, text: "" };
    return { size, html: drawItem(it, style) };
  }, [kind, style]);
  const pad = 6;
  return (
    <svg className="wfd" data-style={style} viewBox={`${-pad} ${-pad} ${svg.size.w + pad * 2} ${svg.size.h + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g dangerouslySetInnerHTML={{ __html: svg.html }} />
    </svg>
  );
}

export type LibraryPick = { kind: WireframeComponent } | { frame: WireframeFrame };

/**
 * The parts library: screens and every interface part, grouped, with a search field. A tap adds the part
 * to the screen in use; dragging one (mouse, pen or finger) drops it where it's let go.
 */
export function Library({ style, onPick, onDragStart, onClose, compact }: { style: WireframeStyle; onPick: (p: LibraryPick) => void; onDragStart: (p: LibraryPick, e: React.PointerEvent) => void; onClose: () => void; compact: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (kind: WireframeComponent) => !q || `${WIREFRAME_COMPONENT_LABEL[kind]} ${kind} ${KEYWORDS[kind] ?? ""}`.toLowerCase().includes(q);
  const frames = WIREFRAME_FRAMES.filter((f) => !q || `${WIREFRAME_FRAME_LABEL[f]} screen frame device`.toLowerCase().includes(q));
  const groups = GROUPS.map((g) => ({ ...g, kinds: g.kinds.filter(match) })).filter((g) => g.kinds.length);
  const tile = (p: LibraryPick, label: string, body: ReactNode) => (
    <li key={label}>
      <button
        type="button"
        className="wf-tile"
        title={`${label}: tap to add, or drag onto a screen`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          onDragStart(p, e);
        }}
        onClick={(e) => {
          // A drag that ended here isn't a tap (the drag handled it).
          if ((e.currentTarget as HTMLElement).dataset.dragged) return;
          onPick(p);
        }}
      >
        <span className="wf-tile-art">{body}</span>
        <span className="wf-tile-label">{label}</span>
      </button>
    </li>
  );
  return (
    <div
      className="wf-panel wf-library ui-pop"
      data-compact={compact || undefined}
      role="dialog"
      aria-label="Interface parts"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        // Keys typed in the library stay in it (Delete in the search field doesn't delete a part).
        e.stopPropagation();
      }}
    >
      <div className="wf-panel-head">
        <span className="wf-panel-title">Parts</span>
        <button type="button" className="fb-vc-btn" aria-label="Close parts" title="Close (Esc)" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>
      <label className="wf-search">
        <Search size={14} aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search parts" aria-label="Search parts" autoFocus={!compact} />
      </label>
      <div className="wf-library-scroll">
        {frames.length ? (
          <section aria-label="Screens">
            <h4>Screens</h4>
            <ul className="wf-tiles">{frames.map((f) => tile({ frame: f }, `${WIREFRAME_FRAME_LABEL[f]} screen`, <span className="wf-tile-frame">{FRAME_ICON[f]}</span>))}</ul>
          </section>
        ) : null}
        {groups.map((g) => (
          <section key={g.name} aria-label={g.name}>
            <h4>{g.name}</h4>
            <ul className="wf-tiles">{g.kinds.map((k) => tile({ kind: k }, WIREFRAME_COMPONENT_LABEL[k], <PartPreview kind={k} style={style} />))}</ul>
          </section>
        ))}
        {!frames.length && !groups.length ? <p className="wf-library-none">No parts match “{query.trim()}”.</p> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ selection bar

/** A small number field made of buttons: − value + (no OS spin box). */
function Stepper({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void }) {
  return (
    <span className="wf-stepper" role="group" aria-label={label}>
      <button type="button" className="fb-vc-btn" aria-label={`Fewer: ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        <Minus size={13} aria-hidden />
      </button>
      <span className="wf-stepper-value" aria-live="polite" title={label}>
        {value}
        {suffix}
      </span>
      <button type="button" className="fb-vc-btn" aria-label={`More: ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        <Plus size={13} aria-hidden />
      </button>
    </span>
  );
}

/** A stepper as rows of the More menu: its value, then fewer and more. */
const stepperMenu = (label: string, value: number, min: number, max: number, onChange: (n: number) => void, step = 1, suffix = ""): MenuEntry[] => [
  { heading: `${label}: ${value}${suffix}` },
  { label: `Fewer: ${label.toLowerCase()}`, icon: <Minus size={14} aria-hidden />, disabled: value <= min, onSelect: () => onChange(Math.max(min, value - step)) },
  { label: `More: ${label.toLowerCase()}`, icon: <Plus size={14} aria-hidden />, disabled: value >= max, onSelect: () => onChange(Math.min(max, value + step)) },
];

const COUNT_LABEL: Partial<Record<WireframeComponent, string>> = {
  tabs: "Tabs",
  table: "Rows",
  list: "Rows",
  menu: "Items",
  breadcrumbs: "Levels",
  pagination: "Pages",
  navBar: "Items",
  sidebar: "Items",
};

const EXPORT_ITEMS: { action: ExportAction; label: string; icon: ReactNode }[] = [
  { action: "png", label: "Export screen as PNG", icon: <ImageIcon size={14} aria-hidden /> },
  { action: "svg", label: "Export screen as SVG", icon: <FileImage size={14} aria-hidden /> },
  { action: "pdf", label: "Export screen as PDF", icon: <FileText size={14} aria-hidden /> },
  { action: "copy", label: "Copy screen as image", icon: <Copy size={14} aria-hidden /> },
];

export interface SelectionBarProps {
  style: React.CSSProperties;
  items: WireItem[];
  screens: WireScreen[];
  links: number;
  /** Every screen, for Link to. */
  allScreens: WireScreen[];
  /** Screen ids the selected part or screen (one) already links to. */
  linkedTo: Set<string>;
  onEditText: (() => void) | null;
  onRename: (() => void) | null;
  onPatch: (patch: Partial<WireItem>) => void;
  onFrame: (f: WireframeFrame) => void;
  onToggleLink: ((to: string) => void) | null;
  onAlign: (a: Align | "spaceX" | "spaceY") => void;
  onExport: ((a: ExportAction) => void) | null;
  onAiVary: (() => void) | null;
  onAiRefine: (() => void) | null;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** Edits the selection: a part's text and options, a screen's frame, links, align, export, delete. */
export function SelectionBar(p: SelectionBarProps) {
  const one = p.items.length === 1 && !p.screens.length ? p.items[0]! : null;
  const sameKind = p.items.length && p.items.every((i) => i.kind === p.items[0]!.kind) ? p.items[0]!.kind : null;
  const options = sameKind && !p.screens.length ? (WIREFRAME_OPTIONS[sameKind] ?? []) : [];
  const first = p.items[0];
  const screen = p.screens.length === 1 && !p.items.length ? p.screens[0]! : null;
  const alignItems: MenuEntry[] = [
    { label: one ? "Align left in screen" : "Align left edges", icon: <AlignStartVertical size={14} aria-hidden />, onSelect: () => p.onAlign("left") },
    { label: one ? "Centre in screen" : "Align centres", icon: <AlignCenterVertical size={14} aria-hidden />, onSelect: () => p.onAlign("center") },
    { label: one ? "Align right in screen" : "Align right edges", icon: <AlignEndVertical size={14} aria-hidden />, onSelect: () => p.onAlign("right") },
    "separator",
    { label: one ? "Align top in screen" : "Align top edges", icon: <AlignStartHorizontal size={14} aria-hidden />, onSelect: () => p.onAlign("top") },
    { label: one ? "Middle of screen" : "Align middles", icon: <AlignCenterHorizontal size={14} aria-hidden />, onSelect: () => p.onAlign("middle") },
    { label: one ? "Align bottom in screen" : "Align bottom edges", icon: <AlignEndHorizontal size={14} aria-hidden />, onSelect: () => p.onAlign("bottom") },
    ...(p.items.length >= 3
      ? (["separator", { label: "Space evenly across", icon: <AlignHorizontalSpaceAround size={14} aria-hidden />, onSelect: () => p.onAlign("spaceX") }, { label: "Space evenly down", icon: <AlignVerticalSpaceAround size={14} aria-hidden />, onSelect: () => p.onAlign("spaceY") }] as MenuEntry[])
      : []),
  ];
  const linkTargets = p.allScreens.filter((s) => s.id !== (one?.screen ?? screen?.id));
  // The screen the part is on: a navigation bar low on a phone is a tab bar, which counts every line.
  const firstScreen = first ? p.allScreens.find((s) => s.id === first.screen) : undefined;
  const kindRef = useRef<HTMLSpanElement>(null);
  const tools: FoldTool[] = [];
  const kind = one ? WIREFRAME_COMPONENT_LABEL[one.kind] : screen ? `${WIREFRAME_FRAME_LABEL[screen.frame]} screen` : null;
  if (p.onEditText) {
    const onEditText = p.onEditText;
    tools.push({
      key: "text",
      priority: 6,
      node: (
        <button type="button" className="fb-vc-btn wf-btn-text" onClick={onEditText} title="Edit text (Enter)">
          <Pencil size={13} aria-hidden /> Text
        </button>
      ),
      menu: [{ label: "Edit text", icon: <Pencil size={14} aria-hidden />, onSelect: onEditText }],
    });
  }
  if (p.onRename) {
    const onRename = p.onRename;
    tools.push({
      key: "rename",
      priority: 6,
      node: (
        <button type="button" className="fb-vc-btn wf-btn-text" onClick={onRename} title="Rename (Enter)">
          <Pencil size={13} aria-hidden /> Name
        </button>
      ),
      menu: [{ label: "Rename", icon: <Pencil size={14} aria-hidden />, onSelect: onRename }],
    });
  }
  if (screen) {
    const frames = WIREFRAME_FRAMES.map((f) => ({ label: WIREFRAME_FRAME_LABEL[f], icon: FRAME_ICON[f], checked: screen.frame === f, onSelect: () => p.onFrame(f) }));
    tools.push({ key: "frame", priority: 4, node: <MenuButton label="Frame" align="start" triggerClassName="fb-vc-btn" trigger={FRAME_ICON[screen.frame]} items={frames} />, menu: [{ heading: "Frame" }, ...frames] });
  }
  if (first && options.includes("variant")) {
    const looks = (["primary", "secondary"] as const).map((v) => ({ v, label: v === "primary" ? "Primary" : "Secondary", on: (first.variant ?? "primary") === v }));
    tools.push({
      key: "variant",
      priority: 5,
      node: (
        <span className="wf-seg" role="group" aria-label="Button look">
          {looks.map((l) => (
            <button key={l.v} type="button" aria-pressed={l.on} onClick={() => p.onPatch({ variant: l.v })}>
              {l.label}
            </button>
          ))}
        </span>
      ),
      menu: [{ heading: "Button look" }, ...looks.map((l) => ({ label: l.label, checked: l.on, onSelect: () => p.onPatch({ variant: l.v }) }))],
    });
  }
  if (first && options.includes("checked")) {
    const title = first.kind === "toggle" ? "On or off" : "Checked or not";
    tools.push({
      key: "checked",
      priority: 5,
      node: (
        <button type="button" className="fb-vc-btn wf-btn-text" aria-pressed={Boolean(first.checked)} onClick={() => p.onPatch({ checked: !first.checked })} title={title}>
          {first.checked ? "On" : "Off"}
        </button>
      ),
      menu: [{ label: first.kind === "toggle" ? "On" : "Checked", checked: Boolean(first.checked), multi: true, onSelect: () => p.onPatch({ checked: !first.checked }) }],
    });
  }
  if (first && options.includes("value")) {
    const value = first.value ?? WIREFRAME_OPTION_DEFAULTS[first.kind]?.value ?? 50;
    const set = (n: number) => p.onPatch({ value: n });
    tools.push({ key: "value", priority: 5, node: <Stepper label="Value" value={value} min={0} max={100} step={10} suffix="%" onChange={set} />, menu: stepperMenu("Value", value, 0, 100, set, 10, "%") });
  }
  if (first && options.includes("count")) {
    const label = COUNT_LABEL[first.kind] ?? "Count";
    const value = countOf(first, firstScreen);
    const max = first.kind === "table" || first.kind === "list" ? 50 : 12;
    const set = (n: number) => p.onPatch({ count: n });
    tools.push({ key: "count", priority: 5, node: <Stepper label={label} value={value} min={1} max={max} onChange={set} />, menu: stepperMenu(label, value, 1, max, set) });
  }
  if (first && options.includes("cols")) {
    const value = colsOf(first);
    const set = (n: number) => p.onPatch({ cols: n });
    tools.push({ key: "cols", priority: 5, node: <Stepper label="Columns" value={value} min={1} max={12} onChange={set} />, menu: stepperMenu("Columns", value, 1, 12, set) });
  }
  if (p.onToggleLink && linkTargets.length) {
    const toggle = p.onToggleLink;
    // A part can go to several screens: each is a checkbox, not one choice of many.
    const links: MenuEntry[] = linkTargets.map((s) => ({ label: s.name.trim() || "Untitled screen", icon: FRAME_ICON[s.frame], checked: p.linkedTo.has(s.id), multi: true, onSelect: () => toggle(s.id) }));
    tools.push({
      key: "link",
      sep: true,
      priority: 3,
      node: <MenuButton label="Link to screen" align="start" triggerClassName="fb-vc-btn" trigger={<ArrowRight size={15} aria-hidden />} items={[{ heading: "Goes to" }, ...links]} />,
      menu: [{ heading: "Link to screen" }, ...links],
    });
  }
  if (p.items.length) tools.push({ key: "align", priority: 2, node: <MenuButton label="Align" align="start" triggerClassName="fb-vc-btn" trigger={<AlignStartVertical size={15} aria-hidden />} items={alignItems} />, menu: [{ heading: "Align" }, ...alignItems] });
  if (p.onExport) {
    const run = p.onExport;
    const exports = EXPORT_ITEMS.map((x) => ({ label: x.label, icon: x.icon, onSelect: () => run(x.action) }));
    tools.push({ key: "export", priority: 1, node: <MenuButton label="Export screen" align="start" triggerClassName="fb-vc-btn" trigger={<Download size={14} aria-hidden />} items={exports} />, menu: exports });
  }
  if (p.onAiVary || p.onAiRefine) {
    const ai: MenuEntry[] = [...(p.onAiRefine ? [{ label: "Refine this screen…", onSelect: p.onAiRefine }] : []), ...(p.onAiVary ? [{ label: "Make variations…", onSelect: p.onAiVary }] : [])];
    tools.push({ key: "ai", priority: 2, node: <MenuButton label="Foli AI" align="start" triggerClassName="fb-vc-btn" trigger={<AiIcon size={14} className="wf-ai-mark" />} items={ai} />, menu: [{ heading: "Foli AI" }, ...ai] });
  }
  tools.push(
    {
      key: "duplicate",
      sep: true,
      priority: 3,
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Duplicate" title="Duplicate (⌘D)" onClick={p.onDuplicate} disabled={!p.items.length && !p.screens.length}>
          <Copy size={14} aria-hidden />
        </button>
      ),
      menu: [{ label: "Duplicate", icon: <Copy size={14} aria-hidden />, shortcut: "⌘D", disabled: !p.items.length && !p.screens.length, onSelect: p.onDuplicate }],
    },
    // Delete always stays in the bar.
    {
      key: "delete",
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Delete" title="Delete (⌫)" onClick={p.onDelete}>
          <Trash2 size={14} aria-hidden />
        </button>
      ),
    },
  );
  return (
    <div className="wf-bar wf-bar-float" role="toolbar" aria-label={one ? `Selected ${WIREFRAME_COMPONENT_LABEL[one.kind].toLowerCase()}` : screen ? "Selected screen" : "Selection"} style={p.style} onPointerDown={(e) => e.stopPropagation()}>
      {kind ? (
        <span ref={kindRef} className="wf-bar-kind">
          {kind}
        </span>
      ) : null}
      <ToolFold tools={tools} squeeze={kind ? kindRef : undefined} centred at={`${p.style.left},${p.style.top}`} label="More for the selection" />
    </div>
  );
}
