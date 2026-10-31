"use client";

// The editor command API (docs/NATIVE_APP_PLAN.md section 8): what the native keyboard toolbar, the note's bars
// and its menus do to the note page. DocumentView calls `useNativeNote` in native chrome mode; it registers the
// note with the bridge (lib/engine/noteHost.ts), runs the commands with the editor's own functions (the same
// ones the web keyboard bar uses, components/iphone/NoteBars.tsx) and sends `editor.state`, `editor.panel` and
// `note.ready`. Imported only by the note page, so it loads with the editor's code, never with the first screen.
import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { HIGHLIGHT_COLORS, TEXT_COLORS, applyLink, changeDepth, clearFormatting, duplicateBlocks, insertBlockAfterCurrent, moveBlock, removeLink, selectedBlockFormat, setBlockFormat, setHighlight, setTextColor, turnInto } from "@/components/editor/commands";
import { insertKind } from "@/components/doc/InsertPanel";
import { requestSpecialInsert, type SpecialInsert } from "@/components/editor/EditorMenus";
import { AI_FOCUS_EVENT, askNoteAi } from "@/components/ai/chat/events";
import { nativeChrome } from "@/lib/nativeApp";
import { bridgeListening, emitNoteEvent, focusMode, markNoteReady, onNoteHost, registerNote, setFocusMode, type NoteHandle } from "./noteHost";
import { clearMatches, findMatches, MAX_MATCHES, paintMatches, revealMatch } from "@/components/doc/findInNote";
import { BridgeError, id, num, oneOf, only, text } from "./validate";
import { EDITOR_BLOCKS, EDITOR_MARKS, EDITOR_PANELS, NOTE_MENU_ACTIONS, type BlockAlign, type CalloutTone, type EditorBlock, type EditorCommandName, type EditorFormatState, type EditorMark, type EditorPanel, type EditorStateEvent, type FindResult, type NoteMenuAction, type TextStyleName } from "./protocol";

const SPECIAL: readonly SpecialInsert[] = ["image", "unsplash", "file", "record", "scan", "scanPhotos", "page", "card", "bookmark", "embed", "collection", "gallery", "board", "calendarView", "date", "pickDate", "columns2", "columns3", "columns4", "tabs"];

export interface NativeNoteOptions {
  documentId: string;
  /** Joined notes: whether this is the one with focus (missing: a note on its own). */
  primary?: boolean;
  editor: Editor | null;
  readOnly: boolean;
  title: string;
  /** The note's first frame can be drawn (its blocks came from the device or the server). */
  ready: boolean;
  /** The open panel, or null. */
  panel: EditorPanel | null;
  openPanel(panel: EditorPanel): void;
  closePanel(): void;
  /** The "..." menu's actions this note offers now (missing ones are refused). */
  menu: Partial<Record<NoteMenuAction, () => void>>;
  scrollEl: HTMLElement | null;
  /** The note is always fully encrypted. */
  locked?: boolean;
  /** "Lock" is offered here: opens the Lock dialog over the note. */
  lock?: () => void;
  /** Revision 14: scrolls the note to a block and puts the caret there (the sidebar's outline, tasks, attachments). */
  jump?: (blockId: string) => void;
  /** Revision 14: opens a comment thread in the note (under its block); false when there's no such thread. */
  openThread?: (threadId: string) => boolean;
}

/** Checks or unchecks a to-do, as the page sidebar's Tasks tab does; false when there's no such to-do. */
export function toggleTask(editor: Editor, blockId: string): boolean {
  let found = false;
  editor.state.doc.descendants((n, pos) => {
    if (found) return false;
    if (n.attrs.id !== blockId) return true;
    found = "checked" in n.attrs;
    if (found) {
      const checked = !n.attrs.checked;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, checked, completedAt: checked ? Date.now() : null }));
    }
    return false;
  });
  return found;
}

/** `find`: every match of `query`, painted, and the one at `index` shown (left out: none scrolled to). */
export function findInNote(editor: Editor, query: string, index?: number): FindResult {
  const q = query.trim();
  const matches = findMatches(editor, q);
  if (!matches.length) {
    clearMatches();
    return { query: q, count: 0, current: -1, truncated: false, matches: [] };
  }
  const current = index === undefined ? 0 : ((Math.trunc(index) % matches.length) + matches.length) % matches.length;
  paintMatches(editor, matches, current);
  if (index !== undefined) revealMatch(editor, matches[current]!);
  return { query: q, count: matches.length, current, truncated: matches.length >= MAX_MATCHES, matches: matches.slice(0, 100).map((m) => m.snippet) };
}

/** The block the caret is in, as the protocol names it ("heading2", "todo", "image", ...). */
export function blockAtSelection(editor: Editor): string {
  const $from = editor.state.selection.$from;
  if ($from.depth < 1) return "paragraph";
  const node = $from.node(1);
  if (node.type.name === "heading") return `heading${Number(node.attrs.level) || 1}`;
  return node.type.name;
}

/** The note's title field (DocumentView's DocTitle). */
export function titleField(noteId: string): HTMLTextAreaElement | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById(`title-${noteId}`);
  return el instanceof HTMLTextAreaElement ? el : null;
}

/** Something on the note page that holds the keyboard: the title, the editor, or a field inside the note. */
function typingOnPage(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !el.readOnly && !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset"].includes(el.type);
  return el.isContentEditable;
}

const TEXT_STYLES: readonly TextStyleName[] = ["title", "subtitle", "heading", "strong", "body", "caption"];
const ALIGNS: readonly BlockAlign[] = ["left", "center", "right", "justify"];
const CALLOUT_TONES: readonly CalloutTone[] = ["note", "info", "success", "warning", "danger"];
const TEXT_LINES = ["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote"];

/** The line's formatting at the caret, as the Format panel reads it (revision 21). */
export function formatState(editor: Editor): EditorFormatState {
  const node = editor.state.selection.$from.depth >= 1 ? editor.state.selection.$from.node(1) : null;
  const type = node?.type.name;
  const level = Number(node?.attrs.level) || 0;
  // (Not in a line at all: no block format to read.)
  const fmt = node ? selectedBlockFormat(editor) : {};
  const textStyle: TextStyleName | null =
    type === "heading" ? (level === 1 ? "title" : level === 2 ? "subtitle" : "heading") : type === "paragraph" ? ((fmt.textStyle as TextStyleName | null) ?? "body") : null;
  const tone = node?.attrs.tone as CalloutTone | undefined;
  return {
    textStyle,
    textColor: (editor.getAttributes("textColor").value as string | undefined) ?? null,
    highlight: (editor.getAttributes("highlight").value as string | undefined) ?? null,
    align: (fmt.align as BlockAlign | null) ?? "left",
    group: fmt.group === "card" ? "card" : "page",
    decoration: fmt.decoration ?? null,
    calloutTone: type === "callout" && tone && CALLOUT_TONES.includes(tone) ? tone : null,
    codeLanguage: type === "codeBlock" ? String(node?.attrs.language ?? "plaintext") : null,
    blockTools: TEXT_LINES.includes(type ?? ""),
  };
}

/** `format.set`: the Format panel's other tools, as it runs them. */
function setFormat(editor: Editor, args: Record<string, unknown>) {
  if (args.textStyle !== undefined) {
    const style = oneOf(args, "textStyle", TEXT_STYLES);
    if (style === "title" || style === "subtitle" || style === "heading") turnInto(editor, "heading", { level: style === "title" ? 1 : style === "subtitle" ? 2 : 3 });
    else turnInto(editor, "paragraph", { textStyle: style === "body" ? null : style });
  }
  if (args.textColor !== undefined) setTextColor(editor, args.textColor === null ? null : oneOf(args, "textColor", TEXT_COLORS));
  if (args.highlight !== undefined) setHighlight(editor, args.highlight === null ? null : oneOf(args, "highlight", HIGHLIGHT_COLORS));
  if (args.align !== undefined) {
    const align = oneOf(args, "align", ALIGNS);
    setBlockFormat(editor, { align: align === "left" ? null : align });
  }
  if (args.group !== undefined) setBlockFormat(editor, { group: oneOf(args, "group", ["page", "card"] as const) === "card" ? "card" : null });
  if (args.decoration !== undefined) setBlockFormat(editor, { decoration: args.decoration === null ? null : oneOf(args, "decoration", ["focus", "block"] as const) });
  if (args.calloutTone !== undefined) turnInto(editor, "callout", { tone: oneOf(args, "calloutTone", CALLOUT_TONES) });
  if (args.codeLanguage !== undefined) {
    const language = text(args, "codeLanguage", { max: 40 }) as string;
    const $from = editor.state.selection.$from;
    const node = $from.depth >= 1 ? $from.node(1) : null;
    if (node?.type.name !== "codeBlock") throw new BridgeError("invalid_args", "The caret isn't in a code block.");
    editor.view.dispatch(editor.state.tr.setNodeMarkup($from.before(1), undefined, { ...node.attrs, language }));
  }
  if (args.clear === true) clearFormatting(editor);
}

export function editorState(editor: Editor | null, noteId: string, readOnly: boolean, lock: { locked?: boolean; canLock?: boolean } = {}): EditorStateEvent {
  const extra = { focus: focusMode(), locked: Boolean(lock.locked), canLock: Boolean(lock.canLock) };
  if (!editor || editor.isDestroyed) return { noteId, focused: typingOnPage(), canEdit: !readOnly, block: "paragraph", marks: [], link: false, undo: false, redo: false, ...extra, format: null };
  return {
    ...extra,
    format: formatState(editor),
    noteId,
    // Whatever holds the keyboard on the note page (the title too), so native's toolbar and Done follow it.
    focused: editor.isFocused || editor.view.hasFocus() || typingOnPage(),
    canEdit: !readOnly,
    block: blockAtSelection(editor),
    marks: EDITOR_MARKS.filter((m) => editor.isActive(m)),
    link: editor.isActive("link"),
    undo: editor.can().undo(),
    redo: editor.can().redo(),
  };
}

function setInsets(top: number, bottom: number) {
  const root = document.documentElement;
  root.style.setProperty("--native-inset-top", `${top}px`);
  root.style.setProperty("--native-inset-bottom", `${bottom}px`);
}

function toggleMark(editor: Editor, mark: EditorMark) {
  if (mark === "highlight") {
    if (editor.isActive("highlight")) editor.chain().unsetMark("highlight").run();
    else editor.chain().setMark("highlight", { value: "yellow" }).run();
    return;
  }
  editor.chain().toggleMark(mark).run();
}

function setBlock(editor: Editor, block: EditorBlock) {
  const at = blockAtSelection(editor);
  const current = at === "codeBlock" ? "code" : at;
  // The toolbar's rule: a block turned into what it already is goes back to a paragraph.
  if (current === block && block !== "paragraph") {
    turnInto(editor, "paragraph");
    return;
  }
  if (block.startsWith("heading")) turnInto(editor, "heading", { level: Number(block.slice(7)) });
  else if (block === "code") turnInto(editor, "code", { language: "plaintext" });
  else if (block === "todo") turnInto(editor, "todo", { checked: false });
  else turnInto(editor, block);
}

/** Runs one editor command against the note (pure over its options; exported for tests). */
export function runEditorCommand(o: NativeNoteOptions, name: EditorCommandName, args: Record<string, unknown>): unknown {
  const editor = o.editor;
  const editing = () => {
    if (!editor || editor.isDestroyed) throw new BridgeError("no_note", "The note is still opening.");
    if (o.readOnly) throw new BridgeError("read_only", "You can only read this note.");
    return editor;
  };
  const ok = { ok: true as const };
  switch (name) {
    case "format": {
      only(args, ["mark", "block"]);
      const e = editing();
      if (args.mark !== undefined) toggleMark(e, oneOf(args, "mark", EDITOR_MARKS));
      if (args.block !== undefined) setBlock(e, oneOf(args, "block", EDITOR_BLOCKS));
      if (args.mark === undefined && args.block === undefined) throw new BridgeError("invalid_args", "format needs a mark or a block.");
      return ok;
    }
    case "format.set": {
      only(args, ["textStyle", "textColor", "highlight", "align", "group", "decoration", "calloutTone", "codeLanguage", "clear"]);
      const e = editing();
      if (!Object.keys(args).length) throw new BridgeError("invalid_args", "format.set needs something to set.");
      setFormat(e, args);
      return ok;
    }
    case "insert": {
      only(args, ["kind"]);
      const e = editing();
      const kind = text(args, "kind", { max: 40 }) as string;
      if (kind === "mention") e.chain().focus().insertContent("@").run();
      // "/" where the caret is: the editor's own slash menu opens, as typing it does.
      else if (kind === "slash") e.chain().focus().insertContent("/").run();
      else if (kind === "divider") insertBlockAfterCurrent(e, "divider");
      else if (kind === "code") insertBlockAfterCurrent(e, "codeBlock");
      else if ((SPECIAL as readonly string[]).includes(kind)) requestSpecialInsert(e, kind as SpecialInsert);
      // Revision 21: an Insert panel tile by its id (the native Insert sheet).
      else if (insertKind(e, kind)) return ok;
      else throw new BridgeError("invalid_args", `There's nothing to insert called “${kind}”.`);
      return ok;
    }
    case "link": {
      only(args, ["href"]);
      const e = editing();
      if (args.href === null) removeLink(e);
      else if (!applyLink(e, text(args, "href", { max: 2000 }) as string)) throw new BridgeError("invalid_args", "That doesn’t look like a web address.");
      return ok;
    }
    case "undo":
      only(args, []);
      editing().commands.undo();
      return ok;
    case "redo":
      only(args, []);
      editing().commands.redo();
      return ok;
    case "indent":
      only(args, []);
      changeDepth(editing(), 1);
      return ok;
    case "outdent":
      only(args, []);
      changeDepth(editing(), -1);
      return ok;
    case "focus":
      only(args, []);
      if (!editor || editor.isDestroyed) throw new BridgeError("no_note", "The note is still opening.");
      // An untitled, empty note starts in its title (as the web's new note does); any other in the body.
      {
        const title = titleField(o.documentId);
        if (title && !o.readOnly && !title.value.trim() && editor.isEmpty) title.focus();
        else editor.commands.focus();
      }
      return ok;
    case "dismissKeyboard":
      only(args, []);
      editor?.commands.blur();
      (document.activeElement as HTMLElement | null)?.blur?.();
      return ok;
    case "panel.open":
      only(args, ["panel"]);
      o.openPanel(oneOf(args, "panel", EDITOR_PANELS));
      return ok;
    case "panel.close":
      only(args, []);
      o.closePanel();
      return ok;
    case "ai": {
      only(args, ["action", "prompt"]);
      const action = oneOf(args, "action", ["open", "ask"] as const);
      const prompt = action === "ask" ? (text(args, "prompt", { max: 4000, optional: true }) ?? "").trim() : "";
      // The question waits for the panel, which takes it when it opens (or at once when it's open).
      if (prompt) askNoteAi(prompt);
      o.openPanel("ai");
      // No question: the panel's composer takes focus (⌘J's event), ready for one.
      if (action === "ask" && !prompt) window.dispatchEvent(new Event(AI_FOCUS_EVENT));
      return ok;
    }
    case "note.menu": {
      only(args, ["action"]);
      const action = oneOf(args, "action", NOTE_MENU_ACTIONS);
      const run = o.menu[action];
      if (!run) throw new BridgeError("unavailable", "That isn't available for this note.");
      run();
      return ok;
    }
    case "scrollToTop":
      only(args, []);
      o.scrollEl?.scrollTo({ top: 0, behavior: "smooth" });
      return ok;
    case "insets":
      only(args, ["top", "bottom"]);
      setInsets(num(args, "top", { min: 0, max: 2000 }), num(args, "bottom", { min: 0, max: 2000 }));
      return ok;
    case "state":
      only(args, []);
      return editorState(editor, o.documentId, o.readOnly, { locked: o.locked, canLock: Boolean(o.lock) });
    case "block.move":
      only(args, ["dir"]);
      moveBlock(editing(), oneOf(args, "dir", ["up", "down"] as const) === "up" ? -1 : 1);
      return ok;
    case "block.duplicate":
      only(args, []);
      duplicateBlocks(editing());
      return ok;
    case "focus.toggle":
      only(args, []);
      setFocusMode(!focusMode());
      if (focusMode()) o.closePanel();
      return ok;
    case "note.lock":
      only(args, []);
      if (!o.lock) throw new BridgeError("unavailable", "Lock isn't offered for this note.");
      o.lock();
      return ok;
    case "block.jump": {
      only(args, ["blockId"]);
      const blockId = id(args, "blockId");
      if (!editor || editor.isDestroyed || !o.jump) throw new BridgeError("no_note", "The note is still opening.");
      o.jump(blockId);
      return ok;
    }
    case "task.toggle": {
      only(args, ["blockId"]);
      const blockId = id(args, "blockId");
      if (!toggleTask(editing(), blockId)) throw new BridgeError("invalid_args", "There's no such to-do in this note.");
      return ok;
    }
    case "thread.open": {
      only(args, ["threadId"]);
      const threadId = id(args, "threadId");
      if (!o.openThread) throw new BridgeError("unavailable", "Comments aren't available for this note.");
      if (!o.openThread(threadId)) throw new BridgeError("invalid_args", "That comment thread isn't in this note.");
      return ok;
    }
    case "find": {
      only(args, ["query", "index"]);
      const query = text(args, "query", { max: 500, allowEmpty: true }) as string;
      const index = args.index === undefined ? undefined : num(args, "index", { min: -100_000, max: 100_000 });
      if (!editor || editor.isDestroyed) throw new BridgeError("no_note", "The note is still opening.");
      return findInNote(editor, query, index);
    }
    case "find.clear":
      only(args, []);
      clearMatches();
      return ok;
    default:
      // note.prepare, note.show and note.close are the host's.
      throw new BridgeError("unknown_editor_command", `The note page doesn't run “${name}”.`);
  }
}

/** DocumentView in native chrome mode: registers the note with the bridge and keeps native told. */
export function useNativeNote(o: NativeNoteOptions): void {
  const latest = useRef(o);
  latest.current = o;
  const on = typeof window !== "undefined" && nativeChrome() !== null;
  const { documentId, editor, ready, panel, readOnly } = o;
  // Joined notes: only the one with focus takes the bars' commands and says it's ready (again, each time it gets focus).
  const primary = o.primary ?? true;

  // The handle: commands always see the latest editor, panel and menu.
  useEffect(() => {
    if (!on || !primary || !bridgeListening()) return;
    const handle: NoteHandle = {
      noteId: documentId,
      run: (name, args) => runEditorCommand(latest.current, name, args),
      state: () => editorState(latest.current.editor, documentId, latest.current.readOnly, { locked: latest.current.locked, canLock: Boolean(latest.current.lock) }),
      panel: () => latest.current.panel,
    };
    return registerNote(handle);
  }, [on, documentId, primary]);

  // note.ready: a frame after the note's first blocks are on screen.
  useEffect(() => {
    if (!on || !ready || !primary) return;
    const frame = requestAnimationFrame(() => markNoteReady(documentId, latest.current.title));
    return () => cancelAnimationFrame(frame);
  }, [on, ready, documentId, primary]);

  // editor.panel when a tool opens or closes.
  useEffect(() => {
    if (!on) return;
    emitNoteEvent("editor.panel", { panel });
  }, [on, panel]);

  // editor.state: at most once a frame, only when it changed (as the web keyboard bar reads it).
  useEffect(() => {
    if (!on || !editor) return;
    let frame = 0;
    let last = "";
    const send = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const state = editorState(editor, documentId, latest.current.readOnly, { locked: latest.current.locked, canLock: Boolean(latest.current.lock) });
        const json = JSON.stringify(state);
        if (json === last) return;
        last = json;
        emitNoteEvent("editor.state", state);
      });
    };
    send();
    editor.on("selectionUpdate", send);
    editor.on("transaction", send);
    editor.on("focus", send);
    editor.on("blur", send);
    // Focus Mode turning on or off changes the state too.
    const offFocus = onNoteHost(send);
    // The title (or any field on the page) taking or leaving the keyboard, not only the editor's selection.
    document.addEventListener("focusin", send);
    document.addEventListener("focusout", send);
    return () => {
      offFocus();
      document.removeEventListener("focusin", send);
      document.removeEventListener("focusout", send);
      cancelAnimationFrame(frame);
      editor.off("selectionUpdate", send);
      editor.off("transaction", send);
      editor.off("focus", send);
      editor.off("blur", send);
    };
  }, [on, editor, documentId, readOnly]);
}
