// The editor command API (src/lib/engine/editorCommands.ts) on its edges: what it refuses, and the commands that
// don't need the editor's own functions (panels, the note menu, insets, state).
import { describe, expect, it } from "vitest";
import { runEditorCommand, editorState, type NativeNoteOptions } from "@/lib/engine/editorCommands";
import { BridgeError } from "@/lib/engine/validate";

function options(over: Partial<NativeNoteOptions> = {}): NativeNoteOptions & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    documentId: "doc_1",
    editor: null,
    readOnly: false,
    title: "Kyoto",
    ready: true,
    panel: null,
    openPanel: (p) => log.push(`open:${p}`),
    closePanel: () => log.push("close"),
    menu: { history: () => log.push("history") },
    scrollEl: null,
    ...over,
  };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof BridgeError ? e.code : "other";
  }
  return null;
};

/** Just enough of a Tiptap editor for the commands' checks. */
const fakeEditor = { isDestroyed: false, isFocused: false, view: { hasFocus: () => false }, state: { selection: { $from: { depth: 0 }, from: 0, to: 0, empty: true }, doc: { forEach: () => undefined } }, isActive: () => false, getAttributes: () => ({}), can: () => ({ undo: () => true, redo: () => false }), commands: { focus: () => true, blur: () => true } };

describe("editor commands", () => {
  it("formatting waits for the editor and refuses a note that can only be read", () => {
    expect(code(() => runEditorCommand(options(), "format", { mark: "bold" }))).toBe("no_note");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never, readOnly: true }), "format", { mark: "bold" }))).toBe("read_only");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never }), "format", { mark: "blink" }))).toBe("invalid_args");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never }), "format", {}))).toBe("invalid_args");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never }), "insert", { kind: "spaceship" }))).toBe("invalid_args");
  });

  it("format.set (revision 21) checks what it's given", () => {
    expect(code(() => runEditorCommand(options(), "format.set", { align: "center" }))).toBe("no_note");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never, readOnly: true }), "format.set", { align: "center" }))).toBe("read_only");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never }), "format.set", {}))).toBe("invalid_args");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never }), "format.set", { align: "diagonal" }))).toBe("invalid_args");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never }), "format.set", { textColor: "neon" }))).toBe("invalid_args");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never }), "format.set", { sparkle: true }))).toBe("invalid_args");
    expect(code(() => runEditorCommand(options({ editor: fakeEditor as never }), "insert", { kind: "quick-table-0x4" }))).toBe("invalid_args");
  });

  it("panels, the note menu and Foli AI", () => {
    const o = options();
    expect(runEditorCommand(o, "panel.open", { panel: "style" })).toEqual({ ok: true });
    expect(runEditorCommand(o, "panel.close", {})).toEqual({ ok: true });
    expect(runEditorCommand(o, "ai", { action: "open" })).toEqual({ ok: true });
    expect(runEditorCommand(o, "note.menu", { action: "history" })).toEqual({ ok: true });
    expect(o.log).toEqual(["open:style", "close", "open:ai", "history"]);
    expect(code(() => runEditorCommand(o, "note.menu", { action: "share" }))).toBe("unavailable");
    expect(code(() => runEditorCommand(o, "panel.open", { panel: "sidebar" }))).toBe("invalid_args");
  });

  it("insets set the page's clearances; state describes the editor", () => {
    runEditorCommand(options(), "insets", { top: 96, bottom: 44 });
    expect(document.documentElement.style.getPropertyValue("--native-inset-top")).toBe("96px");
    expect(document.documentElement.style.getPropertyValue("--native-inset-bottom")).toBe("44px");
    expect(code(() => runEditorCommand(options(), "insets", { top: -1, bottom: 0 }))).toBe("invalid_args");
    expect(editorState(null, "doc_1", false)).toEqual({ noteId: "doc_1", focused: false, canEdit: true, block: "paragraph", marks: [], link: false, undo: false, redo: false, focus: false, locked: false, canLock: false, format: null });
    expect(runEditorCommand(options({ editor: fakeEditor as never }), "state", {})).toMatchObject({ noteId: "doc_1", undo: true, redo: false, format: { textStyle: null, align: "left", group: "page", blockTools: false } });
  });

  it("insert slash types / where the caret is (the slash menu)", () => {
    const typed: string[] = [];
    const chain = { focus: () => chain, insertContent: (t: string) => (typed.push(t), chain), run: () => true };
    runEditorCommand(options({ editor: { ...fakeEditor, chain: () => chain } as never }), "insert", { kind: "slash" });
    expect(typed).toEqual(["/"]);
  });

  it("focus: an untitled, empty note starts in its title; state counts the title as focused", () => {
    const title = document.createElement("textarea");
    title.id = "title-doc_1";
    document.body.append(title);
    const focused: string[] = [];
    const editor = { ...fakeEditor, isEmpty: true, commands: { focus: () => (focused.push("body"), true), blur: () => true } };
    runEditorCommand(options({ editor: editor as never }), "focus", {});
    expect(document.activeElement).toBe(title);
    expect(focused).toEqual([]);
    expect(editorState(editor as never, "doc_1", false).focused).toBe(true);
    title.blur();
    expect(editorState(editor as never, "doc_1", false).focused).toBe(false);
    title.value = "Kyoto";
    runEditorCommand(options({ editor: editor as never }), "focus", {});
    expect(focused).toEqual(["body"]);
    title.remove();
  });

  it("note.prepare, note.show and note.close belong to the host", () => {
    expect(code(() => runEditorCommand(options(), "note.show", { id: "doc_1" }))).toBe("unknown_editor_command");
  });
});
