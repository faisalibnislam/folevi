// Code and formulas are written as typed (editor audit M11, M12, M25): while the caret is in a code block or
// in inline code the editor's own element turns autocorrect and capitals off (a phone reads them from the
// element being edited, which is the whole note), curly quotes and long dashes the keyboard substitutes go in
// as typed, a formula's field does the same, and an empty code block keeps the Copy button's room.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });

vi.mock("convex/react", () => ({ useConvex: () => ({}), useAction: () => vi.fn(), useMutation: () => vi.fn(), useQuery: () => undefined }));
vi.mock("@/lib/app/state", async (original) => ({ ...(await original<object>()), useAppState: () => ({ profile: { id: "acct" }, engine: null, outbox: null }) }));

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { NODE_VIEW_EXTENSIONS } = await import("@/components/editor/NodeViews");
const { codeTextInput, plainCodeText, selectionInCode } = await import("@/components/editor/codeView");
const { plainFormulaText } = await import("@/components/editor/FormulaView");

const para = (id: string, content: JSONContent[]): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content });
const text = (t: string, code = false): JSONContent => ({ type: "text", text: t, ...(code ? { marks: [{ type: "code" }] } : {}) });
const codeBlock = (id: string, source: string, language = "plaintext"): JSONContent => ({ type: "codeBlock", attrs: { id, depth: 0, language }, content: source ? [text(source)] : [] });

let editor: Editor | null = null;
let root: Root | null = null;

function make(content: JSONContent[], attributes: Record<string, string> = {}): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS], content: { type: "doc", content }, editorProps: { attributes } });
  return editor;
}
/** The position just inside the block with this id, plus `offset`. */
function inside(e: Editor, id: string, offset = 0): number {
  let at = -1;
  e.state.doc.forEach((n, pos) => {
    if (n.attrs.id === id) at = pos + 1 + offset;
  });
  return at;
}
const caretAt = (e: Editor, pos: number) => e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)));

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("M11: typing in code", () => {
  const note = () => [para("p", [text("Some prose, with "), text("inline()", true), text(" in it.")]), codeBlock("c", "const s = 1;")];

  test("the caret is in code inside a code block or inline code, and nowhere else", () => {
    const e = make(note());
    caretAt(e, inside(e, "p", 3));
    expect(selectionInCode(e.state)).toBe(false);
    caretAt(e, inside(e, "p", "Some prose, with ".length + 3));
    expect(selectionInCode(e.state)).toBe(true);
    caretAt(e, inside(e, "c", 4));
    expect(selectionInCode(e.state)).toBe(true);
  });

  test("in code the editor's own element says so, and says what it said before once the caret leaves", () => {
    const e = make(note(), { spellcheck: "true", autocapitalize: "sentences" });
    const dom = e.view.dom;
    caretAt(e, inside(e, "p", 3));
    expect(dom.getAttribute("spellcheck")).toBe("true");
    expect(dom.getAttribute("autocorrect")).toBeNull();

    caretAt(e, inside(e, "c", 4));
    expect(dom.getAttribute("autocorrect")).toBe("off");
    expect(dom.getAttribute("autocapitalize")).toBe("off");
    expect(dom.getAttribute("autocomplete")).toBe("off");
    expect(dom.getAttribute("spellcheck")).toBe("false");

    // Out to the prose: as it was.
    caretAt(e, inside(e, "p", 3));
    expect(dom.getAttribute("autocorrect")).toBeNull();
    expect(dom.getAttribute("autocomplete")).toBeNull();
    expect(dom.getAttribute("autocapitalize")).toBe("sentences");
    expect(dom.getAttribute("spellcheck")).toBe("true");

    // Inline code counts too.
    caretAt(e, inside(e, "p", "Some prose, with ".length + 3));
    expect(dom.getAttribute("autocorrect")).toBe("off");
    expect(dom.getAttribute("spellcheck")).toBe("false");
  });

  test("a read-only note is left as it is", () => {
    const e = make(note(), { spellcheck: "true" });
    e.setEditable(false);
    caretAt(e, inside(e, "c", 4));
    expect(e.view.dom.getAttribute("autocorrect")).toBeNull();
    expect(e.view.dom.getAttribute("spellcheck")).toBe("true");
  });

  test("what the keyboard substituted is put back as typed", () => {
    expect(plainCodeText("\u201Ca\u201D \u2018b\u2019 \u2014 c\u2026")).toBe("\"a\" 'b' -- c...");
    expect(plainCodeText("plain - text")).toBe("plain - text");
  });

  test("a curly quote typed in a code block goes in straight; two hyphens stay two hyphens", () => {
    const e = make([codeBlock("c", "s = -")]);
    const end = inside(e, "c", 5);
    caretAt(e, end);
    expect(codeTextInput(e.view, end, end, "\u201C", true)).toBe(true);
    expect(e.state.doc.child(0).textContent).toBe('s = -"');
    // The second hyphen arrives as a long dash in place of the first.
    const dash = inside(e, "c", 4);
    caretAt(e, dash + 1);
    expect(codeTextInput(e.view, dash, dash + 1, "\u2014", true)).toBe(true);
    expect(e.state.doc.child(0).textContent).toBe('s = --"');
  });

  test("ordinary typing, prose, and keyboards that mean their quotes are left alone", () => {
    const e = make(note());
    const inCode = inside(e, "c", 4);
    caretAt(e, inCode);
    expect(codeTextInput(e.view, inCode, inCode, "x", true)).toBe(false);
    expect(codeTextInput(e.view, inCode, inCode, "\u201C", false)).toBe(false);
    const inProse = inside(e, "p", 3);
    caretAt(e, inProse);
    expect(codeTextInput(e.view, inProse, inProse, "\u201C", true)).toBe(false);
    expect(e.state.doc.child(1).textContent).toBe("const s = 1;");
  });

  test("the editor's own text input goes through it on an iPhone", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", language: "en-US", platform: "iPhone" });
    const e = make([codeBlock("c", "x = ")]);
    const end = inside(e, "c", 4);
    caretAt(e, end);
    const handled = e.view.someProp("handleTextInput", (f) => f(e.view, end, end, "\u2018", () => e.state.tr));
    expect(handled).toBe(true);
    expect(e.state.doc.child(0).textContent).toBe("x = '");
  });
});

describe("M25: an empty code block keeps the Copy button's room", () => {
  test("the button is unseen, not gone, while there's nothing to copy; a Mermaid block has none", () => {
    const e = make([codeBlock("c", ""), codeBlock("d", "let a;"), codeBlock("m", "graph TD; A-->B", "mermaid")]);
    const button = (id: string) => e.view.dom.querySelector<HTMLButtonElement>(`pre[data-block-id="${id}"] > .fb-code-copy`)!;
    // The stylesheet keeps the room for any code block whose button isn't `hidden` (editor.css): the same for
    // an empty block as for one with text, so the first character typed doesn't make the block jump taller.
    expect(button("c").hidden).toBe(false);
    expect(button("c").style.visibility).toBe("hidden");
    expect(button("c").tabIndex).toBe(-1);
    expect(button("d").hidden).toBe(false);
    expect(button("d").style.visibility).toBe("");
    expect(button("m").hidden).toBe(true);

    caretAt(e, inside(e, "c"));
    e.view.dispatch(e.state.tr.insertText("x"));
    expect(button("c").hidden).toBe(false);
    expect(button("c").style.visibility).toBe("");
  });
});

describe("M12: a formula's field", () => {
  test("typed quotes are straightened, one character for one", () => {
    expect(plainFormulaText("f\u2019(x) = \u201Ca\u201D")).toBe("f'(x) = \"a\"");
    expect(plainFormulaText("x^2")).toBe("x^2");
  });

  test("the field takes LaTeX as typed: no autocorrect, no capitals, no suggestions, and a curly quote is saved straight", async () => {
    // (jsdom has no ResizeObserver; a drawn formula watches its own width for its scroll edges.)
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const made = new Editor({
      extensions: [...ALL_NODES.filter((n) => !NODE_VIEW_EXTENSIONS.some((v) => v.name === n.name)), ...NODE_VIEW_EXTENSIONS, ...ALL_MARKS],
      content: { type: "doc", content: [{ type: "formula", attrs: { id: "f", depth: 0, latex: "f" } }] },
    });
    editor = made;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<EditorContent editor={made} />));
    // (The view is drawn a moment after the editor: promises, a frame, and what React draws after them.)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => host.querySelector<HTMLElement>(".fb-formula-display")!.click());
    const field = host.querySelector<HTMLTextAreaElement>("textarea.fb-formula-input")!;
    expect(field.getAttribute("autocapitalize")).toBe("off");
    expect(field.getAttribute("autocorrect")).toBe("off");
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");

    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(field, "f\u2019(x)");
      field.setSelectionRange(2, 2);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(made.state.doc.child(0).attrs.latex).toBe("f'(x)");
    expect(field.value).toBe("f'(x)");
    // The caret stays after the quote, where it was typed.
    expect(field.selectionStart).toBe(2);
  });
});
