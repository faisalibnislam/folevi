// The flowchart editor's shared types: the controller every module receives, and the small interaction API
// that pointer, keyboard, double-click and context-menu behaviour plugs into (see FlowchartView.tsx).
import type { ReactNodeViewProps } from "@tiptap/react";
import type { RefObject } from "react";
import type { FlowchartData, FlowNode, FlowEdge, FlowSide, Pt, RoutedEdge } from "../schema";
import type { Selection } from "../ops";

/** The view transform: screen = world * k + (x, y). */
export interface View {
  x: number;
  y: number;
  k: number;
}

/**
 * Text being written in a shape or on a connector; `typed` when it started with a keystroke. On a
 * connector, `label` is which of its labels (default the first; one past the last adds a label).
 */
export type Editing = { kind: "node" | "edge"; id: string; before: FlowchartData; typed?: boolean; label?: number };

type SetState<T> = (next: T | ((prev: T) => T)) => void;

/**
 * Everything the modules share: the chart and its history, the selection, the view, text editing state
 * and the canvas elements. Values are this render's; the `…Ref` twins always hold the latest (read them in
 * event handlers and gestures that outlive a render).
 */
export interface FlowController {
  /** The node view's props (the block's attributes, the editor, getPos). */
  props: ReactNodeViewProps;

  // Document and history (useFlowDoc).
  doc: FlowchartData;
  docRef: RefObject<FlowchartData>;
  /** Shows a state without recording it (live dragging). */
  setLive: (next: FlowchartData, save?: boolean) => void;
  /** A finished change: recorded for undo (from `before`, default the current chart) and saved. */
  commit: (next: FlowchartData, opts?: { before?: FlowchartData; key?: string }) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  tooLarge: boolean;
  /** Connectors with their routes, labels and arrowheads (derived from `doc`). */
  routed: RoutedEdge[];
  byId: Map<string, FlowNode>;

  // Selection.
  sel: Selection;
  selRef: RefObject<Selection>;
  setSel: SetState<Selection>;
  /** The selected shapes and connectors that still exist. */
  selNodes: FlowNode[];
  selEdges: FlowEdge[];
  /** The one selected shape, when nothing else is selected and nothing is being written. */
  single: FlowNode | null;
  /** The one selected connector (nothing else selected), routed. */
  selectedEdge: RoutedEdge | undefined;

  // Text editing state (interactions/textEditing.tsx owns starting and finishing it).
  editing: Editing | null;
  editingRef: RefObject<Editing | null>;
  setEditing: SetState<Editing | null>;

  // View (controller/useViewport.ts).
  view: View;
  viewRef: RefObject<View>;
  setView: SetState<View>;
  width: number;
  height: number;
  /** The block's saved height (its `height` attribute, clamped). */
  savedHeight: number;
  setLiveHeight: (h: number | null) => void;
  toWorld: (clientX: number, clientY: number) => Pt;
  zoomAt: (k: number, sx: number, sy: number) => void;
  zoomBy: (f: number) => void;
  fitView: (fc?: FlowchartData, w?: number, h?: number) => void;
  /** The world point at the middle of the visible canvas (below the toolbar). */
  viewCenter: () => Pt;
  full: boolean;
  toggleFull: (on?: boolean) => void;
  fullCardProps: { "data-full"?: true; popover?: "manual" };
  /** ⇧⌘F and Esc for full canvas (canvas/useFullCanvas.ts). */
  fullKey: (e: React.KeyboardEvent | KeyboardEvent, opts?: { escape?: boolean }) => boolean;

  // Canvas state.
  /** The canvas (or something in it) has keyboard focus. */
  active: boolean;
  activeRef: RefObject<boolean>;
  setActive: (on: boolean) => void;
  aiOpen: boolean;
  setAiOpen: SetState<boolean>;
  /** A pointer gesture or a pinch is running (read during render and in handlers). */
  isDragging: () => boolean;
  /** Where the pointer router keeps the running gesture (only the router writes it). */
  dragRef: RefObject<ActiveDrag | null>;

  // Elements.
  cardRef: RefObject<HTMLDivElement | null>;
  wrapRef: RefObject<HTMLDivElement | null>;
  svgRef: RefObject<SVGSVGElement | null>;
  /** A stable id prefix for this canvas's SVG defs and help text. */
  uid: string;
  /** Moves the keyboard to the canvas unless it is already there (and not in a text box). */
  focusCanvas: () => void;
  /** Focusing a shape (Tab) selects it. Stable, for memoised shapes. */
  onFocusNode: (id: string) => void;
  /**
   * Extension point: a new connector dragged out of a shape and let go on empty canvas. The connect
   * interaction calls it first; when it returns true (interactions/quickAdd.tsx opens the shape picker
   * there) the connect interaction does nothing more.
   */
  dropInEmptyRef: RefObject<DropInEmpty | null>;
  /** Tells screen readers about a change ("Added process, below Start"); FlowchartView draws the live region. */
  say: (message: string) => void;
  announcement: string;
}

/** A connector from `side` of shape `from`, let go on empty canvas at `at` (world) / `client` (screen). */
export type DropInEmpty = (d: { from: string; side: FlowSide; at: Pt; client: Pt }) => boolean;

// ------------------------------------------------------------------------------------------ interactions

/** Where a press, double-click or right-click landed. */
export interface CanvasHit<E> {
  e: E;
  /** The element under the pointer (inside this canvas). */
  target: Element;
  /** The world point under the pointer. */
  at: Pt;
  /** Not on any canvas item (shapes, connectors and every interaction's `handles`). */
  onBackground: boolean;
}
export type Press = CanvasHit<React.PointerEvent<SVGSVGElement>>;

/**
 * A pointer gesture: once an interaction's `press` returns one it owns that pointer until it is released.
 * `move` is called at most once a frame; `end` after a last move on release; `cancel` when the browser
 * cancels the pointer or a second finger starts a pinch (put things back as they were).
 */
export interface Gesture {
  move?(e: PointerEvent): void;
  end?(e: React.PointerEvent<SVGSVGElement>): void;
  cancel?(): void;
}

/** The router's running gesture (or a two-finger pinch, which belongs to no single pointer). */
export type ActiveDrag = { kind: "gesture"; pointer: number; gesture: Gesture } | { kind: "pinch"; dist: number; view: View; mid: Pt };

/**
 * One behaviour of the canvas. Every member is optional; the router (controller/usePointerRouter.ts) offers
 * events to the interactions in the order they are listed in FlowchartView.tsx, and the first that claims
 * an event (returns a gesture, "handled" or true) stops it there.
 */
export interface Interaction {
  /** A CSS selector for the canvas items this interaction draws and owns (presses there aren't background). */
  handles?: string;
  /** Every press, before routing (also a second finger or another mouse button). */
  beforePress?(e: React.PointerEvent<SVGSVGElement>): void;
  /** A primary or middle press: start a gesture, or say it was "handled" (a click), or pass. */
  press?(p: Press): Gesture | "handled" | null | void;
  /** The pointer moved over the canvas while no gesture runs (hover effects). */
  hover?(e: React.PointerEvent<SVGSVGElement>): void;
  /** The pointer left the canvas while no gesture runs. */
  leave?(): void;
  doubleClick?(h: CanvasHit<React.MouseEvent<SVGSVGElement>>): boolean | void;
  /** Right-click (the note's own menu never opens in the canvas). */
  contextMenu?(h: CanvasHit<React.MouseEvent<SVGSVGElement>>): boolean | void;
  /** A key on the canvas (not in its text boxes, toolbars or panels); true when used (it is then stopped). */
  keyDown?(e: React.KeyboardEvent<HTMLDivElement>): boolean | void;
  keyUp?(e: React.KeyboardEvent<HTMLDivElement>): void;
  /** Keyboard focus left the canvas. */
  blur?(): void;
}
