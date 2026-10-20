// The canvas's keyboard shortcuts (space-to-pan is interactions/pan.ts; keys while writing are
// interactions/textEditing.tsx). Listed last, so a new interaction placed before it can take a key first.
//
//   ⌘Z / ⇧⌘Z / ⌘Y undo and redo · ⌘D duplicate · ⌘A select all · ⇧⌘F full canvas · ⌫ delete
//   Esc closes the Foli AI panel, then clears the selection, then leaves full canvas, then goes back to the note
//   arrows nudge (⇧ more; the view when nothing is selected) · Enter edits · +/− zoom · ⇧1 fit
//   typing on one selected shape replaces its text
import { NO_SELECTION } from "../ops";
import type { FlowController, Interaction } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";
import type { TextEditing } from "./textEditing";

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function keyboardInteraction(ctrl: FlowController, { actions, startEdit }: { actions: FlowActions; startEdit: TextEditing["startEdit"] }): Interaction {
  const { undo, redo, docRef, selRef, setSel, fullKey, aiOpen, setAiOpen, full, toggleFull, zoomBy, fitView } = ctrl;
  return {
    keyDown: (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const s = selRef.current;
      if (mod && key === "z") {
        if (e.shiftKey) redo();
        else undo();
        return true;
      }
      if (mod && key === "y") {
        redo();
        return true;
      }
      if (mod && key === "d") {
        actions.duplicateSelection();
        return true;
      }
      if (mod && key === "a") {
        setSel({ nodes: docRef.current.nodes.map((n) => n.id), edges: docRef.current.edges.map((x) => x.id) });
        return true;
      }
      if (mod && e.shiftKey && key === "f") return fullKey(e);
      if (mod) return false;
      if (e.key === "Delete" || e.key === "Backspace") {
        actions.removeSelection();
        return true;
      }
      if (e.key === "Escape") {
        if (aiOpen) setAiOpen(false);
        else if (s.nodes.length || s.edges.length) setSel(NO_SELECTION);
        else if (full) toggleFull(false);
        else actions.exitToNote();
        return true;
      }
      const dir = ARROWS[e.key];
      if (dir) {
        const step = e.shiftKey ? 32 : 8;
        actions.nudge(dir[0] * step, dir[1] * step);
        return true;
      }
      if (e.key === "Enter") {
        if (s.nodes.length === 1 && !s.edges.length) startEdit("node", s.nodes[0]!);
        else if (s.edges.length === 1 && !s.nodes.length) startEdit("edge", s.edges[0]!);
        return true;
      }
      if (e.key === "+" || e.key === "=") {
        zoomBy(1.2);
        return true;
      }
      if (e.key === "-" || e.key === "_") {
        zoomBy(1 / 1.2);
        return true;
      }
      if (e.key === "!" && e.shiftKey) {
        fitView();
        return true;
      }
      // Typing on a selected shape replaces its text.
      if (e.key.length === 1 && !e.altKey && s.nodes.length === 1 && !s.edges.length) {
        startEdit("node", s.nodes[0]!, e.key);
        return true;
      }
      return false;
    },
  };
}
