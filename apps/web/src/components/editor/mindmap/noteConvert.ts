"use client";

// A mind map and the note around it: a bulleted list (or numbered, or to-dos) turned into a mind map block
// and back, Markdown from Foli AI put in the note below the block, and the block menu's entries for them
// (EditorMenus). Every change is one undo step in the note. The note is a flat list of blocks with a
// `depth`, so an outline's depths map straight onto it.
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { createElement } from "react";
import { Waypoints } from "lucide-react";
import { LIMITS, MINDMAP_DEFAULT_HEIGHT, mindmapFromOutline, mindmapToOutline, parseMindmap, serializeMindmap, ulid } from "@folevi/editor-schema";
import { endHistoryGroup, normalizeDepths } from "../commands";
import { insertAiMarkdown } from "@/components/ai/insert";
import { AiIcon } from "@/components/ai/AiIcon";

/** Blocks a list made of (a list in a note can mix them). */
const LIST_TYPES = new Set(["bulleted", "numbered", "todo"]);
/** Blocks whose text Foli AI can map. */
const TEXT_TYPES = new Set(["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote", "callout"]);

/** Position of the top-level block at an index. */
function posOf(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** The blocks from `from` to `to` (indexes), when they're all list items. */
function listRange(editor: Editor, from: number, to: number): PMNode[] | null {
  const nodes: PMNode[] = [];
  for (let i = from; i <= to; i++) {
    const n = editor.state.doc.maybeChild(i);
    if (!n || !LIST_TYPES.has(n.type.name)) return null;
    nodes.push(n);
  }
  return nodes.length ? nodes : null;
}

/** Turns list blocks (indexes `from` to `to`) into one mind map block in their place. */
export function listToMindmap(editor: Editor, from: number, to: number): boolean {
  const nodes = listRange(editor, from, to);
  if (!nodes) return false;
  const base = Math.min(...nodes.map((n) => Number(n.attrs.depth ?? 0)));
  // The heading or line just above a list of several top-level items names the centre.
  const above = from > 0 ? editor.state.doc.child(from - 1) : null;
  const centre = above && above.isTextblock && !LIST_TYPES.has(above.type.name) ? above.textContent.trim().slice(0, 120) : "";
  const map = mindmapFromOutline(nodes.map((n) => ({ text: n.textContent, depth: Number(n.attrs.depth ?? 0) - base })), { centre });
  const data = serializeMindmap(map);
  if (!data || data.length > LIMITS.maxMindmapDataLength) return false;
  const { state } = editor;
  const start = posOf(state.doc, from);
  const end = posOf(state.doc, to) + state.doc.child(to).nodeSize;
  const block = state.schema.nodes.mindmap!.create({ id: ulid(), depth: base, data, height: MINDMAP_DEFAULT_HEIGHT });
  const tr = state.tr.replaceWith(start, end, block);
  tr.setSelection(NodeSelection.create(tr.doc, start));
  commit(editor, tr);
  return true;
}

/** Turns the mind map block at `pos` into a bulleted list in its place (the centre first). */
export function mindmapToList(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "mindmap") return false;
  const outline = mindmapToOutline(parseMindmap(String(node.attrs.data ?? "")));
  if (!outline.length) return false;
  const depth = Number(node.attrs.depth ?? 0);
  const { schema } = editor.state;
  const items = outline.map((o) =>
    schema.nodes.bulleted!.create({ id: ulid(), depth: Math.min(LIMITS.maxDepth, depth + o.depth) }, o.text.trim() ? schema.text(o.text.replace(/\s*\n+\s*/g, " ").trim()) : null),
  );
  const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, items);
  const last = pos + items.reduce((n, x) => n + x.nodeSize, 0) - 1;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, last))));
  commit(editor, tr);
  return true;
}

/** Puts Markdown (a summary, to-dos) in the note right after the mind map block at `pos`, at its depth. */
export function insertAfterMindmap(editor: Editor, pos: number, markdown: string): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  return insertAiMarkdown(editor, markdown, { kind: "after", pos: pos + node.nodeSize, depth: Number(node.attrs.depth ?? 0) });
}

/** To-dos as Markdown, one per line, escaped so a task's text stays text. */
export function tasksMarkdown(tasks: string[]): string {
  return tasks.map((t) => `- [ ] ${t.replace(/[\\`*_[\]<>#|~]/g, (c) => `\\${c}`)}`).join("\n");
}

function commit(editor: Editor, tr: import("@tiptap/pm/state").Transaction) {
  normalizeDepths(tr);
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  endHistoryGroup(editor);
  editor.view.focus();
}

// ---------------------------------------------------------------------------------- Foli AI from the note

/** A mind map block made from the note's text, waiting for its view to start Foli AI with it. */
const pending = new Map<string, { text: string }>();

/** What a new block (by id) should ask Foli AI for when it appears, once. */
export function takePendingAi(blockId: string): { text: string } | null {
  const p = pending.get(blockId) ?? null;
  pending.delete(blockId);
  return p;
}

/** Inserts an empty mind map below the blocks `from` to `to`, which then asks Foli AI to map their text. */
export function mindmapFromBlocksWithAi(editor: Editor, from: number, to: number): boolean {
  const { state } = editor;
  const parts: string[] = [];
  for (let i = from; i <= to; i++) {
    const n = state.doc.maybeChild(i);
    if (n && TEXT_TYPES.has(n.type.name) && n.textContent.trim()) parts.push(`${"  ".repeat(Number(n.attrs.depth ?? 0))}${n.textContent.trim()}`);
  }
  const text = parts.join("\n").trim();
  if (!text) return false;
  const last = state.doc.child(to);
  const at = posOf(state.doc, to) + last.nodeSize;
  const id = ulid();
  pending.set(id, { text: text.slice(0, 24_000) });
  const block = state.schema.nodes.mindmap!.create({ id, depth: Number(state.doc.child(from).attrs.depth ?? 0), data: "", height: MINDMAP_DEFAULT_HEIGHT });
  const tr = state.tr.insert(at, block);
  tr.setSelection(NodeSelection.create(tr.doc, at));
  commit(editor, tr);
  return true;
}

/**
 * The block menu's mind map entries for blocks `from` to `to`: "Turn into mind map" for a list, "Mind map
 * with Foli AI" for any text (when AI is on), "Turn into bulleted list" for a mind map. Each item closes the
 * menu itself (`close`).
 */
export function mindmapMenuItems(editor: Editor, from: number, to: number, opts: { aiOn: boolean; close: (refocus?: boolean) => void }): { label: string; hint: string; icon: React.ReactNode; run: () => void }[] {
  const out: { label: string; hint: string; icon: React.ReactNode; run: () => void }[] = [];
  const icon = createElement(Waypoints, { size: 14 });
  const single = from === to ? editor.state.doc.maybeChild(from) : null;
  if (single?.type.name === "mindmap") {
    if (parseMindmap(String(single.attrs.data ?? "")).nodes.length)
      out.push({ label: "Turn into bulleted list", hint: "", icon, run: () => (mindmapToList(editor, posOf(editor.state.doc, from)), opts.close(false)) });
    return out;
  }
  if (listRange(editor, from, to)) out.push({ label: "Turn into mind map", hint: "", icon, run: () => (listToMindmap(editor, from, to), opts.close(false)) });
  let text = false;
  for (let i = from; i <= to; i++) {
    const n = editor.state.doc.maybeChild(i);
    if (n && TEXT_TYPES.has(n.type.name) && n.textContent.trim()) text = true;
  }
  if (opts.aiOn && text)
    out.push({ label: "Mind map with Foli AI", hint: "", icon: createElement(AiIcon, { size: 14, className: "text-[#7c6cf0]" }), run: () => (mindmapFromBlocksWithAi(editor, from, to), opts.close(false)) });
  return out;
}
