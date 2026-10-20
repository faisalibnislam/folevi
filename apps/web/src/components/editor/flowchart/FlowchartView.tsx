"use client";

// Flowchart block: an infinite canvas inside the note (after Whimsical and Miro). Shapes and connectors
// are SVG; the chart lives in the block's `data` (see packages/editor-schema/src/flowchart.ts).
//
//   Pointer   click select · shift-click add · drag move (snaps to the grid and to other shapes' edges)
//             drag empty space to select an area · space-drag, middle-drag or scroll to pan
//             ⌘/ctrl-scroll or pinch to zoom · drag a side handle to connect (drop on empty space for a
//             new connected shape) · double-click to write in a shape or on a connector, or to add one
//   Frames    drag a frame's title or border, a pool's title or a lane's header to move it with its shapes;
//             shapes dropped in a frame or lane join it (interactions/containers.tsx); ⌥⌘G frames the selection
//   Connectors  drag an end to another side, spot or shape, or off into space (⌥ never snaps) · drag the
//             line to add a bend point, drag points to move them, double-click one to remove it · drag a
//             label along the line, double-click the line for another label · the bar and right-click
//             menu restyle every selected connector (interactions/connect, bends, edgeLabels, connectorMenu)
//   Keyboard  Tab to a shape, then Tab adds the next step (⇧Tab a branch) · arrows move between shapes
//             (⌥ nudges, ⇧ nudges more) · Enter or typing edits · ⌫ delete · ⌘D duplicate
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
//   layers/Containers.tsx     frames and swimlanes, under everything (interactions/containers.tsx edits them;
//                             every commit settles which frame or lane each shape is in, useFlowController.ts)
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
import { useEffect, useMemo, useState } from "react";
import { GitBranchPlus, ListChecks, ListPlus } from "lucide-react";
import { useAiEnabled, useNoteAi } from "@/components/ai/useAi";
import { insertAiMarkdown } from "@/components/ai/insert";
import { useAiFeature } from "@/lib/mode";
import { serializeFlowchart } from "./schema";
import { FlowchartReadOnly } from "./FlowchartReadOnly";
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
import { useBends } from "./interactions/bends";
import { useEdgeLabels } from "./interactions/edgeLabels";
import { useTextEditing } from "./interactions/textEditing";
import { doubleClickInteraction } from "./interactions/doubleClick";
import { useContextMenu } from "./interactions/contextMenu";
import { useShapeContent } from "./interactions/content";
import { LibraryButton } from "./chrome/ContentTools";
import { keyboardInteraction } from "./interactions/keyboard";
import { useContainers } from "./interactions/containers";
import { ContainerLayer } from "./layers/Containers";
import { useQuickAdd } from "./interactions/quickAdd";
import { useKeyboardFlow } from "./interactions/keyboardFlow";
import { DotGrid, SceneLayers, SelectionBoxes } from "./layers/Scene";
import { SelectionBar } from "./chrome/SelectionBar";
import { HeightHandle } from "./chrome/HeightHandle";
import { useWalkthrough } from "./interactions/walkthrough";
import { WalkTools } from "./chrome/WalkBar";
import { checkFlowchart } from "./schema";
import { useFlowAiClient } from "./aiClient";
import { useAiPreview } from "./interactions/aiPreview";
import { useTidy } from "./interactions/tidy";
import { useFlowAi } from "./controller/useFlowAi";
import { TidyControl } from "./chrome/TidyControl";
import { CheckPanel } from "./chrome/CheckPanel";
import { takePendingFlowchart } from "./noteConvert";

/** The flowchart block's node view: the editable canvas, or a static picture in read-only notes. */
export function FlowchartView(props: ReactNodeViewProps) {
  const { node, selected, editor } = props;
  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className={`fb-atom fb-flowchart ${selected ? "fb-atom-selected" : ""}`} aria-label="Flowchart">
        <div contentEditable={false} className="fc-card fc-card-static">
          <FlowchartReadOnly data={String(node.attrs.data ?? "")} height={Number(node.attrs.height)} />
        </div>
      </NodeViewWrapper>
    );
  }
  return <FlowchartEditor {...props} />;
}

function FlowchartEditor(props: ReactNodeViewProps) {
  const ctrl = useFlowController(props);
  const { doc, docRef, view, editing, full, uid } = ctrl;
  // The small on-device model can't draw flowcharts (WP11, lib/local/ai/features.ts), but it can explain
  // one and suggest clearer labels ("flowchartExplain").
  const flowchartAi = useAiFeature("flowchart");
  const explainAi = useAiFeature("flowchartExplain");
  const aiEnabled = useAiEnabled();
  const aiOn = aiEnabled && flowchartAi;
  const explainOn = aiEnabled && explainAi;
  // Foli AI: previews, building and extending, Tidy up (and with Foli AI), Check.
  const noteAi = useNoteAi();
  const documentId = noteAi?.home?.id ?? undefined;
  const aiClient = useFlowAiClient(documentId);
  const preview = useAiPreview(ctrl);
  const flowAi = useFlowAi(ctrl, { preview, client: aiOn ? aiClient : null });
  const tidy = useTidy(ctrl, { preview, ai: aiOn ? aiClient : null });
  const [checkOpen, setCheckOpen] = useState(false);
  const issueCount = useMemo(() => checkFlowchart(doc).length, [doc]);
  // Made from the note ("Flowchart with Foli AI" in the block menu, "Flowchart" in the Foli AI panel): draw it once.
  useEffect(() => {
    const p = takePendingFlowchart(String(props.node.attrs.id ?? ""));
    if (p && aiOn) void flowAi.fromText(p, "menu");
    // Only when the block first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const insertBelow = (markdown: string) => {
    const pos = typeof props.getPos === "function" ? props.getPos() : null;
    const node = typeof pos === "number" ? props.editor.state.doc.nodeAt(pos) : null;
    if (typeof pos !== "number" || !node) return false;
    return insertAiMarkdown(props.editor, markdown, { kind: "after", pos: pos + node.nodeSize, depth: Number(node.attrs.depth ?? 0) });
  };

  const actions = useFlowActions(ctrl);
  const walk = useWalkthrough(ctrl);
  // What shapes hold: the shape library, icons, colours, images, notes, page links (interactions/content.tsx).
  const content = useShapeContent(ctrl, { actions });
  const text = useTextEditing(ctrl, { onImage: content.onImageWhileWriting });
  const pan = usePan(ctrl);
  const hover = useHover(ctrl);
  const connect = useConnect(ctrl, { hover: hover.hover });
  const resize = useResize(ctrl);
  const move = useMove(ctrl);
  const select = useSelect(ctrl);
  const boxes = useContainers(ctrl);
  const menu = useContextMenu(ctrl, { actions, startEdit: text.startEdit, contentItems: content.menuItems, nodeItems: () => [...(boxes.nodeMenuItems?.() ?? []), ...walk.menuItems(), ...(aiOn ? [{ label: "Add next steps", icon: <ListPlus size={14} />, onSelect: () => void flowAi.extend("next", ctrl.selRef.current.nodes) }, { label: "Fill in missing branches", icon: <GitBranchPlus size={14} />, onSelect: () => void flowAi.extend("branches", ctrl.selRef.current.nodes) }] : [])] });
  const quick = useQuickAdd(ctrl);
  const flow = useKeyboardFlow(ctrl, { actions, finishEdit: text.finishEdit });
  const events = useInteractions(ctrl, [
    walk.interaction, // Present and Follow a path: while one runs, every press and key is its own
    text.interaction, // any press ends writing first
    pan.interaction, // middle button, space held, one finger on empty canvas; the space key
    preview.interaction, // a Foli AI preview: only panning and zooming until it is applied or discarded
    tidy.interaction, // Tidy up's move: shapes can't be grabbed while they glide
    quick.interaction, // the + arrows around a shape, and the shape picker
    connect.interaction, // side handles and connector ends
    resize.interaction,
    boxes.interaction, // frames and swimlanes: titles, borders, their handles and keys
    content.interaction, // the note and page-link badges on shapes
    move.interaction, // shapes
    select.edges, // connectors
    hover.interaction,
    doubleClickInteraction({ startEdit: text.startEdit, add: actions.add }),
    menu.interaction,
    flow.interaction, // Tab and ⇧Tab grow the flow, arrows move between shapes
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
  const bends = useBends(ctrl, { hidden: connect.drawing });
  const labels = useEdgeLabels(ctrl);
          {...events.canvas}
          {...walk.canvasProps}
          {...content.canvasProps}
        >
          <p id={`${uid}-help`} className="sr-only">
            Tab moves to the shapes; on a selected shape, Tab adds the next step and Shift Tab a branch beside it. Arrow keys move between shapes, Option with arrow keys moves the shape. Enter or typing edits the selected shape, Delete removes it, Command D duplicates. Command Z undoes. Escape steps back to the note.
          </p>
          <svg ref={ctrl.svgRef} className="fc-root fc-svg" width={ctrl.width} height={ctrl.height} {...events.svg}>
            <DotGrid id={`${uid}-dots`} view={view} />
            <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
              <ContainerLayer fc={doc} selected={boxes.selected} renaming={boxes.renaming} onFocusBox={boxes.onFocusBox} />
              <SceneLayers nodes={doc.nodes} routed={ctrl.routed} selNodes={ctrl.sel.nodes} selEdges={ctrl.sel.edges} editing={editing} onFocusNode={ctrl.onFocusNode} imageUrls={content.imageUrls} uid={uid} />
              <g aria-hidden className="fc-overlay">
                <SelectionBoxes nodes={ctrl.selNodes} k={k} />
                {boxes.overlay}
                {move.overlay}
                {connect.previewOverlay}
                {resize.overlay}
                {connect.handlesOverlay}
    labels.interaction, // connector labels: drag along the line, double-click to write, typing
    bends.interaction, // connector lines and bend points: drag to bend, double-click a point to remove it
                {quick.overlay}
                {select.overlay}
                {content.overlay}
                {preview.overlay}
              </g>
              {walk.layer}
            </g>
          </svg>
          {text.input}
          {walk.element}
          {content.panel}
          {content.status}
          {boxes.element}
          {quick.element}
          {preview.element}
          {tidy.element}
          {flowAi.element}
          <p className="sr-only fc-announce" aria-live="polite" aria-atomic="true">
            {ctrl.announcement}
          </p>
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
            library={<LibraryButton open={content.libraryOpen} onOpen={content.openLibrary} />}
            onTidy={actions.tidy}
            onUndo={ctrl.undo}
            onRedo={ctrl.redo}
            canUndo={ctrl.canUndo}
            canRedo={ctrl.canRedo}
            canTidy={nodeCount > 1}
            onAi={
              aiOn
                ? () => {
                    setCheckOpen(false);
                    ctrl.setAiOpen((o) => !o);
                  }
                : null
            }
            tidyControl={<TidyControl tidy={tidy} canTidy={nodeCount > 1} aiTidy={aiOn} />}
            checkControl={
              <button
                type="button"
                className="fc-btn fc-btn-text"
                aria-pressed={checkOpen}
                aria-expanded={checkOpen}
                aria-label={issueCount ? `Check, ${issueCount} to look at` : "Check"}
                title="Check the flowchart for dead ends and gaps"
                onClick={() => {
                  ctrl.setAiOpen(false);
                  setCheckOpen((o) => !o);
                }}
              >
                <ListChecks size={15} aria-hidden /> Check
                {issueCount ? <span className="fc-check-badge" aria-hidden>{issueCount}</span> : null}
              </button>
            }
            aiOpen={ctrl.aiOpen}
            walkTools={<WalkTools onPresent={() => walk.present()} onFollow={() => walk.pick()} disabled={!nodeCount} />}
            containers={boxes.tools}
            exportMenu={<BlockExportMenu type="flowchart" attrs={() => ({ data: serializeFlowchart(docRef.current) })} empty={!nodeCount} triggerClassName="fc-btn" align="start" />}
          />
          <ZoomBar zoom={k} onZoomIn={() => ctrl.zoomBy(1.2)} onZoomOut={() => ctrl.zoomBy(1 / 1.2)} onFit={() => ctrl.fitView()} full={full} onFull={() => ctrl.toggleFull()} />
          <SelectionBar ctrl={ctrl} actions={actions} startEdit={text.startEdit} clearance={quick.clearance} content={content} />
          {ctrl.aiOpen ? <FlowchartAi hasChart={nodeCount > 0} flowAi={flowAi} selected={ctrl.selNodes} documentId={documentId} onClose={() => ctrl.setAiOpen(false)} /> : null}
          {checkOpen ? <CheckPanel ctrl={ctrl} ai={explainOn ? aiClient : null} documentId={documentId} onInsert={insertBelow} onClose={() => setCheckOpen(false)} /> : null}
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
                {bends.overlay}
