"use client";

// Flowchart block: an infinite canvas inside the note (after Whimsical and Miro). Shapes and connectors
// are SVG; the chart lives in the block's `data` (see packages/editor-schema/src/flowchart.ts).
//
//   Pointer   click select · shift-click add · drag move (snaps to the grid and to other shapes' edges)
//             drag empty space to select an area · space-drag, middle-drag or scroll to pan
//             ⌘/ctrl-scroll or pinch to zoom · drag a side handle to connect (drop on empty space for a
//             new connected shape) · double-click to write in a shape or on a connector, or to add one
//   Keyboard  Tab through shapes · Enter edit · arrows nudge (⇧ more) · ⌫ delete · ⌘D duplicate
//             ⌘A select all · ⌘Z / ⇧⌘Z undo and redo · +/− zoom · ⇧1 fit · ⇧⌘F full canvas · Esc back to the note
//
// Full canvas: the card lifts into the top layer (a popover, so nothing in the page clips it) and fills the
// window; the chart is fitted again to its new size. Esc or the zoom bar's button goes back.
//
// While the canvas has focus it owns ⌘Z (its own history, useFlowDoc); outside it the editor's undo
// reverts whole flowchart edits, and the canvas follows.
//
// ARCHITECTURE
//
// This file only composes the editor; each behaviour lives in its own module:
//
//   schema.ts                 the only import of the data model (@folevi/editor-schema); switch versions here
//   ops.ts                    pure chart edits (add, move, resize, connect, snap, history, AI drafts), tested
//   useFlowDoc.ts             the chart being edited: local state, debounced save, undo history
//   render.tsx                drawing shapes and connectors, shared with read-only views, share pages, exports
//   controller/
//     types.ts                FlowController (what every module receives) and the Interaction API
//     useFlowController.ts    document, selection, text editing state, view, canvas elements, in one object
//     useViewport.ts          size, block height, pan/zoom transform, fit, wheel, full canvas
//     useInteractions.ts      the event router: pointers, pinch, capture, once-a-frame moves, key routing
//     useFlowActions.ts       whole-edit commands (add, delete, duplicate, tidy, apply a Foli AI draft, nudge)
//   interactions/             one behaviour each: pan, hover, connect, resize, move, select, textEditing,
//                             doubleClick, contextMenu, keyboard
//   layers/Scene.tsx          the SVG layers (dot grid, connectors, shapes, labels, selection boxes)
//   chrome/                   SelectionBar (shape and connector bars), HeightHandle
//   FlowchartChrome.tsx       toolbars and bars (presentational); FlowchartAi.tsx the Foli AI panel
//
// Adding an interaction (quick add arrows, bend points, swimlanes, a shape library panel):
//   1. Write interactions/<name>.tsx exporting a hook `use<Name>(ctrl, deps)` that keeps its own state and
//      returns `{ interaction, overlay? }`. `interaction` implements any of the Interaction members
//      (press returns a Gesture with move/end/cancel; hover, doubleClick, contextMenu, keyDown, blur...).
//      Give it `handles` (a CSS selector for the data-fc-* items it draws) so presses there aren't treated
//      as empty canvas. Change the chart only through ctrl.setLive (live) and ctrl.commit (one undo step).
//   2. Call the hook below and put its interaction in the list: earlier entries see events first, and the
//      first to claim one (a gesture, "handled" or true) stops it. Draw its overlay in the overlay layer
//      (world coordinates, under the transform) or its HTML next to the other chrome.
//   Panels: add their open state to the controller (like aiOpen) and their element to the chrome below.
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useAiEnabled } from "@/components/ai/useAi";
import { useAiFeature } from "@/lib/mode";
import { serializeFlowchart } from "./schema";
import { FlowchartStatic } from "./render";
import { MainToolbar, ZoomBar } from "./FlowchartChrome";
import { FlowchartAi } from "./FlowchartAi";
import { BlockExportMenu } from "../canvas/BlockExport";
import { useFlowController } from "./controller/useFlowController";
import { useFlowActions } from "./controller/useFlowActions";
import { useInteractions } from "./controller/useInteractions";
import { usePan } from "./interactions/pan";
import { useHover } from "./interactions/hover";
import { useConnect } from "./interactions/connect";
import { useResize } from "./interactions/resize";
import { useMove } from "./interactions/move";
import { useSelect } from "./interactions/select";
import { useTextEditing } from "./interactions/textEditing";
import { doubleClickInteraction } from "./interactions/doubleClick";
import { useContextMenu } from "./interactions/contextMenu";
import { keyboardInteraction } from "./interactions/keyboard";
import { DotGrid, SceneLayers, SelectionBoxes } from "./layers/Scene";
import { SelectionBar } from "./chrome/SelectionBar";
import { HeightHandle } from "./chrome/HeightHandle";

/** The flowchart block's node view: the editable canvas, or a static picture in read-only notes. */
export function FlowchartView(props: ReactNodeViewProps) {
  const { node, selected, editor } = props;
  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className={`fb-atom fb-flowchart ${selected ? "fb-atom-selected" : ""}`} aria-label="Flowchart">
        <div contentEditable={false} className="fc-card fc-card-static">
          <FlowchartStatic data={String(node.attrs.data ?? "")} height={Number(node.attrs.height)} />
        </div>
      </NodeViewWrapper>
    );
  }
  return <FlowchartEditor {...props} />;
}

function FlowchartEditor(props: ReactNodeViewProps) {
  const ctrl = useFlowController(props);
  const { doc, docRef, view, editing, full, uid } = ctrl;
  // The small on-device model can't draw flowcharts (WP11, lib/local/ai/features.ts).
  const flowchartAi = useAiFeature("flowchart");
  const aiOn = useAiEnabled() && flowchartAi;

  const text = useTextEditing(ctrl);
  const actions = useFlowActions(ctrl);
  const pan = usePan(ctrl);
  const hover = useHover(ctrl);
  const connect = useConnect(ctrl, { hover: hover.hover });
  const resize = useResize(ctrl);
  const move = useMove(ctrl);
  const select = useSelect(ctrl);
  const menu = useContextMenu(ctrl, { actions, startEdit: text.startEdit });
  const events = useInteractions(ctrl, [
    text.interaction, // any press ends writing first
    pan.interaction, // middle button, space held, one finger on empty canvas; the space key
    connect.interaction, // side handles and connector ends
    resize.interaction,
    move.interaction, // shapes
    select.edges, // connectors
    hover.interaction,
    doubleClickInteraction({ startEdit: text.startEdit, add: actions.add }),
    menu.interaction,
    keyboardInteraction(ctrl, { actions, startEdit: text.startEdit }),
    select.area, // empty canvas: takes every press that reaches it, so it stays last
  ]);

  const k = view.k;
  const nodeCount = doc.nodes.length;
  return (
    <NodeViewWrapper className={`fb-atom fb-flowchart ${props.selected ? "fb-atom-selected" : ""}`} aria-label="Flowchart">
      <div ref={ctrl.cardRef} contentEditable={false} className="fc-card fb-canvas-card" data-active={ctrl.active || undefined} {...ctrl.fullCardProps} aria-label={full ? "Flowchart, full canvas" : undefined}>
        {/* Full canvas in the Mac app: the window's buttons sit in this corner (canvas.css). */}
        <span aria-hidden className="ui-traffic-space fb-full-traffic" />
        <div
          ref={ctrl.wrapRef}
          className="fc-canvas fb-canvas-body"
          style={{ height: full ? undefined : ctrl.height }}
          tabIndex={0}
          role="application"
          aria-roledescription="flowchart editor"
          aria-label={`Flowchart, ${nodeCount} shape${nodeCount === 1 ? "" : "s"}`}
          aria-describedby={`${uid}-help`}
          // The canvas has its own right-click menu, not the note's.
          data-native-menu=""
          data-panning={pan.panning || undefined}
          data-space={pan.spaceDown || undefined}
          {...events.canvas}
        >
          <p id={`${uid}-help`} className="sr-only">
            Tab moves between shapes. Enter edits the selected shape, arrow keys move it, Delete removes it, Command D duplicates. Command Z undoes. Escape returns to the note.
          </p>
          <svg ref={ctrl.svgRef} className="fc-root fc-svg" width={ctrl.width} height={ctrl.height} {...events.svg}>
            <DotGrid id={`${uid}-dots`} view={view} />
            <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
              <SceneLayers nodes={doc.nodes} routed={ctrl.routed} selNodes={ctrl.sel.nodes} selEdges={ctrl.sel.edges} editing={editing} onFocusNode={ctrl.onFocusNode} />
              <g aria-hidden className="fc-overlay">
                <SelectionBoxes nodes={ctrl.selNodes} k={k} />
                {move.overlay}
                {connect.previewOverlay}
                {resize.overlay}
                {connect.handlesOverlay}
                {select.overlay}
              </g>
            </g>
          </svg>
          {text.input}
          {!nodeCount && !editing ? (
            <div className="fc-empty">
              <p>Double-click anywhere to add a shape, or pick one above.</p>
              {aiOn ? (
                <button type="button" className="fc-btn fc-btn-text fc-empty-ai" onClick={() => ctrl.setAiOpen(true)} onPointerDown={(e) => e.stopPropagation()}>
                  Create with AI
                </button>
              ) : null}
            </div>
          ) : null}
          <MainToolbar
            onAdd={(s) => actions.add(s)}
            onTidy={actions.tidy}
            onUndo={ctrl.undo}
            onRedo={ctrl.redo}
            canUndo={ctrl.canUndo}
            canRedo={ctrl.canRedo}
            canTidy={nodeCount > 1}
            onAi={aiOn ? () => ctrl.setAiOpen((o) => !o) : null}
            aiOpen={ctrl.aiOpen}
            exportMenu={<BlockExportMenu type="flowchart" attrs={() => ({ data: serializeFlowchart(docRef.current) })} empty={!nodeCount} triggerClassName="fc-btn" align="start" />}
          />
          <ZoomBar zoom={k} onZoomIn={() => ctrl.zoomBy(1.2)} onZoomOut={() => ctrl.zoomBy(1 / 1.2)} onFit={() => ctrl.fitView()} full={full} onFull={() => ctrl.toggleFull()} />
          <SelectionBar ctrl={ctrl} actions={actions} startEdit={text.startEdit} />
          {ctrl.aiOpen ? <FlowchartAi hasChart={nodeCount > 0} current={() => serializeFlowchart(docRef.current)} onApply={actions.applyDraft} onClose={() => ctrl.setAiOpen(false)} /> : null}
          {ctrl.tooLarge ? (
            <p className="fc-warning" role="alert">
              This flowchart is too large to save. Remove some shapes or text.
            </p>
          ) : null}
        </div>
        <HeightHandle ctrl={ctrl} />
        {menu.element}
      </div>
    </NodeViewWrapper>
  );
}
