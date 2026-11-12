"use client";

// Copy, cut and paste of shapes (with the connectors between them), inside a chart, between charts and
// between notes: ⌘C, ⌘X, ⌘V on the canvas, and the browser's own Copy, Cut and Paste commands.
//
// What is copied goes on the system clipboard twice: as the chart itself (a type of Folevi's own, which a
// canvas pastes) and as plain text (the shapes' labels, one a line, for anywhere else). Some browsers send a
// canvas no copy or paste event at all, because nothing in it is editable text (Safari and the Mac app,
// without a text selection). So the keys also work by themselves: the copy is remembered here, and a ⌘V that
// no paste event follows pastes what was remembered.
//
// Pasting text that isn't a chart makes a shape of it. Images are interactions/content.tsx's.
import { useRef } from "react";
import { FLOWCHART_LIMITS, fitNodeToText, parseFlowchart, serializeFlowchart } from "../schema";
import { NO_SELECTION, addNode, boxOf, copySelection, deleteSelection, freeNodeSpot, pasteChart, updateNodes } from "../ops";
import { reveal } from "./quickAdd";
import type { FlowController } from "../controller/types";

const TYPE = "application/x-folevi-flowchart";
/** How long after ⌘V a paste event may still come before the remembered copy is pasted instead. */
const PASTE_WAIT = 80;

interface Clip {
  /** The note it was copied in (images in shapes belong to their note's files). */
  origin: string | null;
  chart: string;
  plain: string;
}

/** The last copy made in any canvas of this page. */
let remembered: Clip | null = null;
/** How many times the remembered copy was pasted (each paste lands a step further along). */
let pastes = 0;

export function useShapeClipboard(ctrl: FlowController) {
  const { docRef, selRef, setSel, commit, say } = ctrl;
  /** A copy the ⌘C or ⌘X key just made, for the copy event that follows it to put on the clipboard. */
  const fresh = useRef<{ clip: Clip; at: number } | null>(null);
  const waiting = useRef<number | null>(null);

  const noteId = () => ctrl.props.editor.view.dom.closest("[data-fb-root]")?.getAttribute("data-fb-root") ?? null;
  const busy = (target: EventTarget | null) => {
    const t = target as HTMLElement | null;
    return Boolean(ctrl.editingRef.current) || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || Boolean(t?.isContentEditable);
  };

  /** Copies the selection (and removes it, for Cut). Null with no shape selected. */
  const take = (cut: boolean): Clip | null => {
    const sel = selRef.current;
    const picked = copySelection(docRef.current, sel);
    if (!picked) return null;
    const clip: Clip = { origin: noteId(), chart: serializeFlowchart(picked), plain: picked.nodes.map((n) => n.text).filter(Boolean).join("\n") };
    remembered = clip;
    pastes = 0;
    if (cut) {
      commit(deleteSelection(docRef.current, sel));
      setSel(NO_SELECTION);
    }
    const n = picked.nodes.length;
    say(`${cut ? "Cut" : "Copied"} ${n} shape${n === 1 ? "" : "s"}.`);
    return clip;
  };

  const put = (clip: Clip) => {
    const fc = docRef.current;
    let chart = parseFlowchart(clip.chart);
    // A picture in a shape is a file of the note it was copied in: it doesn't travel to another note.
    if (clip.origin !== noteId()) chart = { ...chart, nodes: chart.nodes.map(({ image: _image, ...n }) => n) };
    const box = boxOf(chart.nodes);
    if (!box) return false;
    // In the chart it came from, a step down and right of the original (and of the paste before); in
    // another chart, in the middle of what is showing.
    const here = chart.nodes.some((n) => fc.nodes.some((o) => o.x === n.x && o.y === n.y && o.text === n.text));
    pastes += 1;
    const step = 24 * pastes;
    const c = ctrl.viewCenter();
    const res = here || pastes > 1 ? pasteChart(fc, chart, here ? step : c.x - (box.x + box.w / 2) + step - 24, here ? step : c.y - (box.y + box.h / 2) + step - 24) : pasteChart(fc, chart, c.x - (box.x + box.w / 2), c.y - (box.y + box.h / 2));
    if (!res) {
      say("The flowchart is full.");
      return true;
    }
    commit(res.doc);
    setSel({ nodes: res.ids, edges: [] });
    const placed = boxOf(res.doc.nodes.filter((n) => res.ids.includes(n.id)));
    if (placed) reveal(ctrl, placed);
    say(`Pasted ${res.ids.length} shape${res.ids.length === 1 ? "" : "s"}.`);
    return true;
  };

  /** Plain text from somewhere else: a shape that holds it. */
  const putText = (text: string) => {
    const clean = text.replace(/\r\n?/g, "\n").trim().slice(0, FLOWCHART_LIMITS.maxText);
    if (!clean) return false;
    const fc = docRef.current;
    const c = ctrl.viewCenter();
    const spot = freeNodeSpot(fc, { x: c.x - 80, y: c.y - 32 }, { w: 160, h: 64 });
    const res = addNode(fc, "process", { x: spot.x + 80, y: spot.y + 32 }, { text: clean });
    if (!res) {
      say("The flowchart is full.");
      return true;
    }
    const doc = updateNodes(res.doc, [res.id], (n) => fitNodeToText(n));
    commit(doc);
    setSel({ nodes: [res.id], edges: [] });
    const made = doc.nodes.find((n) => n.id === res.id);
    if (made) reveal(ctrl, made);
    return true;
  };

  const cancelWait = () => {
    if (waiting.current !== null) window.clearTimeout(waiting.current);
    waiting.current = null;
  };

  /** ⌘C, ⌘X and ⌘V on the canvas. Never claims the key: the browser's own copy or paste event still follows. */
  const keyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || busy(e.target)) return;
    const key = e.key.toLowerCase();
    if ((key === "c" || key === "x") && !e.shiftKey) {
      const clip = take(key === "x");
      fresh.current = clip ? { clip, at: Date.now() } : null;
    } else if (key === "v") {
      cancelWait();
      const clip = remembered;
      if (!clip) return;
      waiting.current = window.setTimeout(() => {
        waiting.current = null;
        put(clip);
      }, PASTE_WAIT);
    }
  };

  const onCopyOrCut = (e: React.ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    if (busy(e.target)) return;
    // The key already made the copy a moment ago; a Copy or Cut chosen from a menu makes it here.
    const made = fresh.current && Date.now() - fresh.current.at < 500 ? fresh.current.clip : take(cut);
    fresh.current = null;
    if (!made) return;
    e.clipboardData.setData(TYPE, JSON.stringify({ origin: made.origin, chart: made.chart }));
    e.clipboardData.setData("text/plain", made.plain);
    e.preventDefault();
    e.stopPropagation();
  };

  /** True when the paste was this module's (a chart, or text for a new shape). */
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>): boolean => {
    if (busy(e.target)) return false;
    cancelWait();
    const data = e.clipboardData;
    let clip: Clip | null = null;
    const own = data.getData(TYPE);
    if (own) {
      try {
        const parsed = JSON.parse(own) as { origin?: unknown; chart?: unknown };
        if (typeof parsed.chart === "string") clip = { origin: typeof parsed.origin === "string" ? parsed.origin : null, chart: parsed.chart, plain: "" };
      } catch {
        // Not ours after all.
      }
    }
    const text = data.getData("text/plain");
    // A browser that kept only the plain text of a copy made here.
    if (!clip && remembered && text && text === remembered.plain && !data.files.length) clip = remembered;
    if (clip) {
      if (clip.chart !== remembered?.chart) {
        remembered = clip;
        pastes = 0;
      }
      e.preventDefault();
      e.stopPropagation();
      return put(clip);
    }
    if (data.files.length || !text.trim()) return false;
    e.preventDefault();
    e.stopPropagation();
    return putText(text);
  };

  return {
    keyDown,
    canvasProps: {
      onCopy: (e: React.ClipboardEvent<HTMLDivElement>) => onCopyOrCut(e, false),
      onCut: (e: React.ClipboardEvent<HTMLDivElement>) => onCopyOrCut(e, true),
    },
    onPaste,
  };
}
