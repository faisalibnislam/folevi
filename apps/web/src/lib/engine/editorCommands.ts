"use client";

// The editor command API (docs/NATIVE_APP_PLAN.md section 8): what the native keyboard toolbar, the note's bars
// and its menus do to the note page. DocumentView calls `useNativeNote` in native chrome mode; it registers the
// note with the bridge (lib/engine/noteHost.ts), runs the commands with the editor's own functions (the same
// ones the web keyboard bar uses, components/iphone/NoteBars.tsx) and sends `editor.state`, `editor.panel` and
// `note.ready`. Imported only by the note page, so it loads with the editor's code, never with the first screen.
import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { applyLink, changeDepth, insertBlockAfterCurrent, removeLink, turnInto } from "@/components/editor/commands";
import { requestSpecialInsert, type SpecialInsert } from "@/components/editor/EditorMenus";
import { AI_FOCUS_EVENT, askNoteAi } from "@/components/ai/chat/events";
import { nativeChrome } from "@/lib/nativeApp";
import { bridgeListening, emitNoteEvent, markNoteReady, registerNote, type NoteHandle } from "./noteHost";
import { BridgeError, num, oneOf, only, text } from "./validate";
import { EDITOR_BLOCKS, EDITOR_MARKS, EDITOR_PANELS, NOTE_MENU_ACTIONS, type EditorBlock, type EditorCommandName, type EditorMark, type EditorPanel, type EditorStateEvent, type NoteMenuAction } from "./protocol";

const SPECIAL: readonly SpecialInsert[] = ["image", "unsplash", "file", "record", "scan", "scanPhotos", "page", "card", "bookmark", "embed", "collection", "gallery", "board", "calendarView", "date", "pickDate", "columns2", "columns3", "columns4", "tabs"];

export interface NativeNoteOptions {
  documentId: string;
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
}

/** The block the caret is in, as the protocol names it ("heading2", "todo", "image", ...). */
export function blockAtSelection(editor: Editor): string {
  const $from = editor.state.selection.$from;
  if ($from.depth < 1) return "paragraph";
  const node = $from.node(1);
  if (node.type.name === "heading") return `heading${Number(node.attrs.level) || 1}`;
  return node.type.name;
}

export function editorState(editor: Editor | null, noteId: string, readOnly: boolean): EditorStateEvent {
  if (!editor || editor.isDestroyed) return { noteId, focused: false, canEdit: !readOnly, block: "paragraph", marks: [], link: false, undo: false, redo: false };
  return {
    noteId,
    focused: editor.isFocused || editor.view.hasFocus(),
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
  const current = blockAtSelection(editor);
  // The toolbar's rule: a block turned into what it already is goes back to a paragraph.
  if (current === block && block !== "paragraph") {
    turnInto(editor, "paragraph");
    return;
  }
  if (block.startsWith("heading")) turnInto(editor, "heading", { level: Number(block.slice(7)) });
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
    case "insert": {
      only(args, ["kind"]);
      const e = editing();
      const kind = text(args, "kind", { max: 40 }) as string;
      if (kind === "mention") e.chain().focus().insertContent("@").run();
      else if (kind === "divider") insertBlockAfterCurrent(e, "divider");
      else if (kind === "code") insertBlockAfterCurrent(e, "codeBlock");
      else if ((SPECIAL as readonly string[]).includes(kind)) requestSpecialInsert(e, kind as SpecialInsert);
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
      editor.commands.focus();
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
      return editorState(editor, o.documentId, o.readOnly);
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

  // The handle: commands always see the latest editor, panel and menu.
  useEffect(() => {
    if (!on || !bridgeListening()) return;
    const handle: NoteHandle = {
      noteId: documentId,
      run: (name, args) => runEditorCommand(latest.current, name, args),
      state: () => editorState(latest.current.editor, documentId, latest.current.readOnly),
      panel: () => latest.current.panel,
    };
    return registerNote(handle);
  }, [on, documentId]);

  // note.ready: a frame after the note's first blocks are on screen.
  useEffect(() => {
    if (!on || !ready) return;
    const frame = requestAnimationFrame(() => markNoteReady(documentId, latest.current.title));
    return () => cancelAnimationFrame(frame);
  }, [on, ready, documentId]);

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
        const state = editorState(editor, documentId, latest.current.readOnly);
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
    return () => {
      cancelAnimationFrame(frame);
      editor.off("selectionUpdate", send);
      editor.off("transaction", send);
      editor.off("focus", send);
      editor.off("blur", send);
    };
  }, [on, editor, documentId, readOnly]);
}
