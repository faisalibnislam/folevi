// The block views' small fixes from the editor audit (docs/EDITOR_AUDIT_2026-11-12.md): undo from a tabs
// block's strip, a bookmark's preview staying out of undo, an image's resize handles and its loading state,
// and a collection cell keeping what's typed while the collection changes under it. Each mounts the real
// editor with its real node views.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { UndoRedo } from "@tiptap/extensions";
import { sync, type SyncState } from "@folevi/editor-schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no CSS.escape (the tab strip finds its tabs by id with it).
if (!(globalThis as { CSS?: { escape?: unknown } }).CSS?.escape) vi.stubGlobal("CSS", { escape: (s: string) => s.replace(/["\\\]]/g, "\\$&") });
// Nor does it lay text out (undo scrolls the caret into view, which measures it).
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });

// The parts of the app around the editor: a server that answers a bookmark's preview, and a sync engine that
// only knows its uploads.
const fetchPreview = vi.fn();
vi.mock("convex/react", () => ({ useConvex: () => ({}), useAction: () => fetchPreview, useMutation: () => vi.fn(), useQuery: () => undefined }));
const engine = {
  state: sync.emptySyncState() as SyncState,
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) {
    engine.listeners.add(cb);
    return () => void engine.listeners.delete(cb);
  },
  set(uploads: SyncState["uploads"]) {
    engine.state = { ...engine.state, uploads };
    for (const cb of engine.listeners) cb();
  },
};
vi.mock("@/lib/app/state", async (original) => ({ ...(await original<object>()), useAppState: () => ({ profile: { id: "acct" }, engine, outbox: null }) }));
// The copy of an upload kept on this device: read when the test says so.
let previewRead: (url: string | null) => void = () => undefined;
vi.mock("@/lib/sync/uploads", async (original) => ({
  ...(await original<object>()),
  localPreviewUrl: () => new Promise<string | null>((resolve) => (previewRead = resolve)),
  releaseLocalPreview: vi.fn(),
}));

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { NODE_VIEW_EXTENSIONS, imageWidthAttr } = await import("@/components/editor/NodeViews");
const { BlockIdentity, BlockKeymap } = await import("@/components/editor/plugins");
const { TabsExtension, deleteTab } = await import("@/components/editor/tabs/tabsExtension");
const { LiveInput } = await import("@/components/editor/collection/LiveInput");
const { undoDepth } = await import("@tiptap/pm/history");

const para = (id: string, text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { id, depth }, content: text ? [{ type: "text", text }] : [] });
const tabs = (id: string): JSONContent => ({ type: "tabs", attrs: { id, depth: 0 } });
const tab = (id: string, name: string): JSONContent => ({ type: "tab", attrs: { id, depth: 1, name } });

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

/** The note's editor with every block's real view, drawn in the page (changes a moment apart are separate steps to undo). */
async function mount(content: JSONContent[]): Promise<Editor> {
  const made = new Editor({
    extensions: [...ALL_NODES.filter((n) => !NODE_VIEW_EXTENSIONS.some((v) => v.name === n.name)), ...NODE_VIEW_EXTENSIONS, ...ALL_MARKS, UndoRedo.configure({ newGroupDelay: 1 }), BlockIdentity, BlockKeymap, TabsExtension],
    content: { type: "doc", content },
  });
  editor = made;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<EditorContent editor={made} />));
  return made;
}

/** Lets what was started settle: promises, a frame, and what React draws after them. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  fetchPreview.mockReset();
  engine.set([]);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  editor?.destroy();
  root = null;
  editor = null;
  host = null;
  document.body.innerHTML = "";
});

// ProseMirror's own "Mod": ⌘ on a Mac, Ctrl elsewhere (jsdom is elsewhere).
const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
const modZ = (shift = false) => new KeyboardEvent("keydown", { key: "z", metaKey: mac, ctrlKey: !mac, shiftKey: shift, bubbles: true, cancelable: true });
const tabNames = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => {
    if (n.type.name === "tab") out.push(String(n.attrs.name));
  });
  return out;
};

describe("undo from a tabs block's strip", () => {
  const note = () => [para("intro", "Intro"), tabs("T"), tab("A", "Alpha"), para("a1", "One", 2), tab("B", "Beta"), para("b1", "Bee", 2), para("outro", "Outro")];

  test("⌘Z pressed on a tab brings back the tab just deleted, and ⇧⌘Z deletes it again", async () => {
    const e = await mount(note());
    const alpha = host!.querySelector<HTMLElement>('[data-tabs-strip] [role="tab"][data-tab-id="A"]');
    expect(alpha).not.toBeNull();
    act(() => deleteTab(e.view, "T", "B"));
    expect(tabNames(e)).toEqual(["Alpha"]);

    alpha!.focus();
    const undo = modZ();
    act(() => void alpha!.dispatchEvent(undo));
    expect(tabNames(e)).toEqual(["Alpha", "Beta"]);
    expect(undo.defaultPrevented).toBe(true);

    act(() => void host!.querySelector<HTMLElement>('[data-tab-id="A"]')!.dispatchEvent(modZ(true)));
    expect(tabNames(e)).toEqual(["Alpha"]);
  });

  test("so does ⌘Z on the strip's own buttons (add a tab, the … menu)", async () => {
    const e = await mount(note());
    act(() => deleteTab(e.view, "T", "B"));
    const add = host!.querySelector<HTMLElement>('[data-tabs-strip] button[aria-label="Add a tab"]');
    expect(add).not.toBeNull();
    act(() => void add!.dispatchEvent(modZ()));
    expect(tabNames(e)).toEqual(["Alpha", "Beta"]);
  });

  test("while a tab is being renamed, ⌘Z is the name field's own", async () => {
    const e = await mount(note());
    act(() => deleteTab(e.view, "T", "B"));
    act(() => void host!.querySelector<HTMLElement>('[data-tab-id="A"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const field = host!.querySelector<HTMLInputElement>("input.fb-tab-rename");
    expect(field).not.toBeNull();
    const undo = modZ();
    act(() => void field!.dispatchEvent(undo));
    // The note's history didn't run, and the key was left to the field.
    expect(tabNames(e)).toEqual(["Alpha"]);
    expect(undo.defaultPrevented).toBe(false);
  });

  test("a tab deleted from its menu leaves the keyboard on the strip, where ⌘Z brings it back", async () => {
    const e = await mount(note());
    const beta = host!.querySelector<HTMLElement>('[data-tab-id="B"]')!;
    beta.focus();
    // The tab's menu from the keyboard (⇧F10), then "Delete tab".
    act(() => void beta.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })));
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("Delete tab"));
    expect(item).toBeDefined();
    act(() => item!.click());
    await settle();
    expect(tabNames(e)).toEqual(["Alpha"]);
    // The tab the menu was opened on is gone: the keyboard is on the tab that's open, not on nothing.
    const active = document.activeElement as HTMLElement | null;
    expect(active).not.toBe(document.body);
    expect(active?.closest("[data-tabs-strip]")).not.toBeNull();
    act(() => void active!.dispatchEvent(modZ()));
    expect(tabNames(e)).toEqual(["Alpha", "Beta"]);
  });
});

describe("a bookmark's preview", () => {
  const bookmarkOf = (e: Editor) => {
    let found: Record<string, unknown> | null = null;
    e.state.doc.forEach((n) => {
      if (n.type.name === "bookmark") found = n.attrs;
    });
    return found as Record<string, unknown> | null;
  };
  /** Pastes a link as a bookmark: one step to undo. */
  function insertBookmark(e: Editor, url: string) {
    const node = e.schema.nodes.bookmark!.create({ id: "BM", depth: 0, url, title: new URL(url).host });
    act(() => e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, node)));
  }

  test("arriving by itself, it's no step to undo: ⌘Z after pasting a link takes the bookmark away", async () => {
    fetchPreview.mockResolvedValue({ title: "Example Domain", description: "For use in examples.", siteName: "Example", image: null, icon: "https://example.com/icon.png" });
    const e = await mount([para("p", "hello")]);
    insertBookmark(e, "https://example.com/one");
    expect(undoDepth(e.state)).toBe(1);
    await settle();
    expect(fetchPreview).toHaveBeenCalledWith({ url: "https://example.com/one" });
    expect(bookmarkOf(e)).toMatchObject({ title: "Example Domain", description: "For use in examples.", icon: "https://example.com/icon.png" });
    // The preview is in the note, and there is still only the paste to undo.
    expect(undoDepth(e.state)).toBe(1);
    act(() => void e.commands.undo());
    expect(bookmarkOf(e)).toBeNull();
    // Redo brings the bookmark back as it was, preview and all.
    act(() => void e.commands.redo());
    expect(bookmarkOf(e)).toMatchObject({ title: "Example Domain" });
  });

  test("a title the person writes is a step of its own, undone back to the preview's", async () => {
    fetchPreview.mockResolvedValue({ title: "Example Domain", description: "For use in examples.", siteName: null, image: null, icon: null });
    const e = await mount([para("p", "hello")]);
    insertBookmark(e, "https://example.com/two");
    await settle();
    expect(bookmarkOf(e)).toMatchObject({ title: "Example Domain" });

    act(() => host!.querySelector<HTMLElement>('button[aria-label="Edit bookmark"]')!.click());
    const title = [...host!.querySelectorAll<HTMLLabelElement>("form label")].find((l) => l.textContent?.startsWith("Title"))!.querySelector("input")!;
    type(title, "My own title");
    expect(bookmarkOf(e)).toMatchObject({ title: "My own title" });
    expect(undoDepth(e.state)).toBe(2);
    act(() => void e.commands.undo());
    expect(bookmarkOf(e)).toMatchObject({ title: "Example Domain", description: "For use in examples." });
  });
});

/** Types into a field as a person does (React hears the input event, not a value set from outside). */
function type(field: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("an image", () => {
  const image = (attrs: Record<string, unknown>): JSONContent => ({ type: "image", attrs: { id: "IMG", depth: 0, alt: "", caption: "", ...attrs } });
  const widthOf = (e: Editor) => e.state.doc.child(0).attrs.width as number | null;
  const rect = (width: number) => ({ width, height: 100, left: 0, top: 0, right: width, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const pointer = (type: string, x: number) => new MouseEvent(type, { clientX: x, clientY: 50, button: 0, bubbles: true, cancelable: true });

  /** A picture half the column wide, in a column 1000 px wide. */
  async function half() {
    const e = await mount([image({ url: "https://example.com/pic.png", width: 0.5 }), para("p", "after")]);
    const box = host!.querySelector<HTMLElement>(".fb-image-box")!;
    const figure = box.closest("figure")!;
    figure.parentElement!.getBoundingClientRect = () => rect(1000);
    box.getBoundingClientRect = () => rect(parseFloat(figure.style.width) * 10);
    return { e, figure, grip: (side: "left" | "right") => host!.querySelector<HTMLElement>(`[data-image-grip="${side}"]`)! };
  }

  test("a dragged width is saved in hundredths of the column, from a fifth to all of it (null)", () => {
    expect(imageWidthAttr(0.456)).toBe(0.46);
    expect(imageWidthAttr(0.05)).toBe(0.2);
    expect(imageWidthAttr(0.999)).toBeNull();
    expect(imageWidthAttr(1.4)).toBeNull();
  });

  test("dragging the right handle resizes as it goes and writes once when let go: one step to undo", async () => {
    const { e, figure, grip } = await half();
    expect(figure.style.width).toBe("50%");
    const before = undoDepth(e.state);
    act(() => void grip("right").dispatchEvent(pointer("pointerdown", 500)));
    act(() => void window.dispatchEvent(pointer("pointermove", 600)));
    act(() => void window.dispatchEvent(pointer("pointermove", 700)));
    // Drawn at the new width, nothing written yet.
    expect(figure.style.width).toBe("70%");
    expect(widthOf(e)).toBe(0.5);
    expect(undoDepth(e.state)).toBe(before);
    act(() => void window.dispatchEvent(pointer("pointerup", 700)));
    expect(widthOf(e)).toBe(0.7);
    expect(undoDepth(e.state)).toBe(before + 1);
    await settle();
    expect(host!.querySelector("figure")!.style.width).toBe("70%");
    // Undone, the picture is drawn at the old width again (not left at the dragged one).
    act(() => void e.commands.undo());
    await settle();
    expect(widthOf(e)).toBe(0.5);
    expect(host!.querySelector("figure")!.style.width).toBe("50%");
  });

  test("the left handle works the other way round, and never goes under a fifth of the column", async () => {
    const { e, figure, grip } = await half();
    act(() => void grip("left").dispatchEvent(pointer("pointerdown", 0)));
    act(() => void window.dispatchEvent(pointer("pointermove", 100)));
    expect(figure.style.width).toBe("40%");
    act(() => void window.dispatchEvent(pointer("pointermove", 900)));
    expect(figure.style.width).toBe("20%");
    act(() => void window.dispatchEvent(pointer("pointerup", 900)));
    expect(widthOf(e)).toBe(0.2);
  });

  test("dragged out to the column's full width, it's saved as full width", async () => {
    const { e, grip } = await half();
    act(() => void grip("right").dispatchEvent(pointer("pointerdown", 500)));
    act(() => void window.dispatchEvent(pointer("pointermove", 1400)));
    act(() => void window.dispatchEvent(pointer("pointerup", 1400)));
    expect(widthOf(e)).toBeNull();
  });

  test("Escape during a drag puts the width back and writes nothing", async () => {
    const { e, figure, grip } = await half();
    const before = undoDepth(e.state);
    act(() => void grip("right").dispatchEvent(pointer("pointerdown", 500)));
    act(() => void window.dispatchEvent(pointer("pointermove", 800)));
    expect(figure.style.width).toBe("80%");
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(figure.style.width).toBe("50%");
    act(() => void window.dispatchEvent(pointer("pointerup", 800)));
    expect(widthOf(e)).toBe(0.5);
    expect(undoDepth(e.state)).toBe(before);
  });

  test("a double click on a handle gives the picture its full width back", async () => {
    const { e, grip } = await half();
    act(() => void grip("right").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    expect(widthOf(e)).toBeNull();
  });

  test("a read-only note has no handles", async () => {
    const { e } = await half();
    act(() => void e.setEditable(false));
    expect(host!.querySelector("[data-image-grip]")).toBeNull();
  });

  test("while its upload is under way it says Loading, never Unavailable, and then shows the copy kept here", async () => {
    engine.set([{ uploadId: "UP", blockId: "IMG", documentId: "DOC", attempts: 0, state: "queued" }] as SyncState["uploads"]);
    await mount([image({})]);
    // The block is there before the copy on this device has been read.
    expect(host!.textContent).toContain("Loading image…");
    expect(host!.textContent).not.toContain("Image unavailable");
    await act(async () => previewRead("blob:local-copy"));
    expect(host!.querySelector("img")?.getAttribute("src")).toBe("blob:local-copy");
  });

  test("a picture with no file, no address and no upload is unavailable", async () => {
    await mount([image({})]);
    expect(host!.textContent).toContain("Image unavailable");
  });
});

describe("a collection's text cell", () => {
  /** A cell over a value the test changes from outside, as a live update does. */
  let setValue: (v: string) => void = () => undefined;
  const saved: string[] = [];
  function Cell() {
    const [value, set] = useState("first");
    setValue = set;
    return <LiveInput aria-label="Cell" value={value} onCommit={(typed) => saved.push(typed)} />;
  }
  async function cell() {
    saved.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Cell />));
    return host.querySelector("input")!;
  }
  const leave = (field: HTMLInputElement) => act(() => field.blur());

  test("a value that arrives while text is typed and unsaved doesn't replace the typing; leaving the field saves it", async () => {
    const field = await cell();
    act(() => field.focus());
    type(field, "first, and more");
    act(() => setValue("someone else's"));
    expect(field.value).toBe("first, and more");
    leave(field);
    expect(saved).toEqual(["first, and more"]);
  });

  test("a field nobody typed in follows the value, even with the keyboard in it, and saves nothing when left", async () => {
    const field = await cell();
    act(() => field.focus());
    act(() => setValue("someone else's"));
    expect(field.value).toBe("someone else's");
    leave(field);
    expect(saved).toEqual([]);
  });

  test("Escape gives the typing up: the value that arrived meanwhile shows, and nothing is saved", async () => {
    const field = await cell();
    act(() => field.focus());
    type(field, "never mind");
    act(() => setValue("someone else's"));
    act(() => void field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(saved).toEqual([]);
    expect(field.value).toBe("someone else's");
    expect(document.activeElement).not.toBe(field);
  });
});
