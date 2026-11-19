// The media block views after the "rock solid" audit (findings M4, M6 to M9, M13, M15, M22): an image's resize
// handles on a touch screen, one block's failure staying that block's, a picture keeping its place while it
// loads, file addresses asked for once per note and kept while they work, page links past the 200th, "Retry
// now" on an interrupted upload, and a bookmark's preview asked for again after a failure. Each mounts the real
// editor with its real node views.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { UndoRedo } from "@tiptap/extensions";
import { getFunctionName } from "convex/server";
import { sync, type SyncState } from "@folevi/editor-schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!(globalThis as { CSS?: { escape?: unknown } }).CSS?.escape) vi.stubGlobal("CSS", { escape: (s: string) => s.replace(/["\\\]]/g, "\\$&") });
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });

// The server: every question the views ask is written down, and answered by what the test says.
type Asked = { name: string; args: Record<string, unknown> };
const asked: Asked[] = [];
let answer: (name: string, args: Record<string, unknown>) => unknown = () => undefined;
const fetchPreview = vi.fn();
vi.mock("convex/react", () => ({
  useConvex: () => ({}),
  useAction: () => fetchPreview,
  useMutation: () => vi.fn(),
  useQuery: (fn: never, args: Record<string, unknown> | "skip") => {
    if (args === "skip") return undefined;
    const name = getFunctionName(fn);
    asked.push({ name, args });
    return answer(name, args);
  },
}));
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
let previewRead: (url: string | null) => void = () => undefined;
const retryUploads = vi.fn();
/** Uploads this device finished, by block ("DOC" is the note). */
const finished: Record<string, string> = {};
vi.mock("@/lib/sync/uploads", async (original) => ({
  ...(await original<object>()),
  completedUploadFor: (documentId: string, blockId: string) => (documentId === "DOC" ? (finished[blockId] ?? null) : null),
  localPreviewUrl: () => new Promise<string | null>((resolve) => (previewRead = resolve)),
  releaseLocalPreview: vi.fn(),
  retryUploads: () => retryUploads(),
}));
vi.mock("@/lib/sync/deviceFiles", async (original) => ({ ...(await original<object>()), keptFileUrl: async () => null }));
// (Transcribing a recording is Foli AI's, with an account behind it: not what's looked at here.)
vi.mock("@/components/ai/AudioTranscribe", () => ({ TranscribeButton: () => null, useCanTranscribe: () => false, useTranscription: () => ({ start: () => undefined, busy: false, title: "", preview: null }) }));

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { NODE_VIEW_EXTENSIONS, BlockBoundary, NoteFileUrls, fileAddressExpiry, imageBoxSize, isChunkLoadError, keepLoadedAddress, lazyView, resizeIntent, restoreUploadedFiles } = await import("@/components/editor/NodeViews");
const { BlockIdentity, BlockKeymap } = await import("@/components/editor/plugins");
const { PageLinkStatus, pageLinkStatusKey } = await import("@/components/editor/pageLinkStatus");
const { PageLinkStatusWatcher, pageLinkStatuses, pageQuestions } = await import("@/components/editor/PageLinkStatusWatcher");
const { undoDepth } = await import("@tiptap/pm/history");

const para = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content: text ? [{ type: "text", text }] : [] });
const image = (id: string, attrs: Record<string, unknown>): JSONContent => ({ type: "image", attrs: { id, depth: 0, alt: "", caption: "", ...attrs } });

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

/** The note's editor with every block's real view; `beside` is drawn next to it, as the app draws its watchers. */
async function mount(content: JSONContent[], beside?: (editor: Editor) => React.ReactNode): Promise<Editor> {
  const made = new Editor({
    extensions: [...ALL_NODES.filter((n) => !NODE_VIEW_EXTENSIONS.some((v) => v.name === n.name)), ...NODE_VIEW_EXTENSIONS, ...ALL_MARKS, UndoRedo.configure({ newGroupDelay: 1 }), BlockIdentity, BlockKeymap, PageLinkStatus],
    content: { type: "doc", content },
  });
  editor = made;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <EditorContent editor={made} />
        {beside?.(made)}
      </>,
    ),
  );
  await settle();
  return made;
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });

function unmount() {
  if (root) act(() => root!.unmount());
  editor?.destroy();
  root = null;
  editor = null;
  host = null;
  document.body.innerHTML = "";
}

let quiet: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => {
  asked.length = 0;
  answer = () => undefined;
  fetchPreview.mockReset();
  retryUploads.mockReset();
  engine.set([]);
  localStorage.clear();
});
afterEach(() => {
  unmount();
  quiet?.mockRestore();
  quiet = null;
});

const HOUR = 3_600_000;
/** A signed address as the server makes them, ending `inMs` from now. */
const signed = (fileId: string, inMs: number) => `https://files.test/files/${fileId}?exp=${Date.now() + inMs}&sig=s${Math.round(inMs)}`;
const fileInfo = (url: string, extra: Record<string, unknown> = {}) => ({ url, mimeType: "image/png", filename: "a.png", size: 10, width: null, height: null, palette: null, ...extra });
const urlsAsked = () => asked.filter((q) => q.name === "files:urls").map((q) => (q.args.fileIds as string[]).join(","));

describe("M4: an image's resize handles under a finger", () => {
  const rect = (width: number) => ({ width, height: 100, left: 0, top: 0, right: width, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const touch = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }), { pointerType: "touch", pointerId: 7 });
  const widthOf = (e: Editor) => e.state.doc.child(0).attrs.width as number | null;

  async function half() {
    const e = await mount([image("IMG", { url: "https://example.com/pic.png", width: 0.5 }), para("p", "after")]);
    const box = host!.querySelector<HTMLElement>(".fb-image-box")!;
    const figure = box.closest("figure")!;
    figure.parentElement!.getBoundingClientRect = () => rect(1000);
    box.getBoundingClientRect = () => rect(parseFloat(figure.style.width) * 10);
    return { e, figure, grip: host!.querySelector<HTMLElement>('[data-image-grip="right"]')! };
  }

  test("what a drag means: two pixels with a mouse, eight and mostly sideways with a finger", () => {
    expect(resizeIntent(1, 0, false)).toBe("wait");
    expect(resizeIntent(-2, 40, false)).toBe("resize");
    expect(resizeIntent(5, 6, true)).toBe("wait");
    expect(resizeIntent(3, 12, true)).toBe("scroll");
    expect(resizeIntent(9, 8, true)).toBe("scroll");
    expect(resizeIntent(-12, 3, true)).toBe("resize");
  });

  test("a swipe up that starts on a handle, with some sideways drift, changes no width and selects nothing", async () => {
    const { e, figure, grip } = await half();
    // (The caret is in the text below: the picture isn't the selection to begin with.)
    act(() => void e.commands.setTextSelection(e.state.doc.content.size - 1));
    expect(e.state.selection instanceof NodeSelection).toBe(false);
    const before = undoDepth(e.state);
    act(() => void grip.dispatchEvent(touch("pointerdown", 500, 300)));
    act(() => void window.dispatchEvent(touch("pointermove", 503, 290)));
    act(() => void window.dispatchEvent(touch("pointermove", 507, 240)));
    // The handle has let go: what follows, however far sideways, is the scroll's.
    act(() => void window.dispatchEvent(touch("pointermove", 620, 200)));
    expect(figure.style.width).toBe("50%");
    act(() => void window.dispatchEvent(touch("pointerup", 620, 200)));
    expect(widthOf(e)).toBe(0.5);
    expect(undoDepth(e.state)).toBe(before);
    expect(e.state.selection instanceof NodeSelection).toBe(false);
    expect(document.documentElement.classList.contains("fb-image-resizing")).toBe(false);
  });

  test("a sideways drag with a finger still resizes", async () => {
    const { e, figure, grip } = await half();
    act(() => void grip.dispatchEvent(touch("pointerdown", 500, 300)));
    act(() => void window.dispatchEvent(touch("pointermove", 505, 301)));
    expect(figure.style.width).toBe("50%");
    act(() => void window.dispatchEvent(touch("pointermove", 700, 304)));
    expect(figure.style.width).toBe("70%");
    act(() => void window.dispatchEvent(touch("pointerup", 700, 304)));
    expect(widthOf(e)).toBe(0.7);
  });

  test("on a touch screen the handles take no touch until the picture is selected, and let an up-and-down swipe scroll", () => {
    const css = readFileSync(join(process.cwd(), "src/components/editor/image.css"), "utf8");
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    const block = coarse.slice(0, coarse.indexOf("\n}\n"));
    expect(block).toMatch(/\.fb-image-grip \{[^}]*touch-action: pan-y;[^}]*pointer-events: none;/);
    expect(block).toMatch(/\.fb-image-box\[data-selected\] > \.fb-image-grip,\s*\.fb-image-grip\[data-active\] \{ pointer-events: auto; \}/);
  });
});

describe("M6: one block that can't be shown is one card, not the whole app", () => {
  test("a view that throws while drawing leaves the note around it standing, and its block untouched", async () => {
    quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The server refuses the question about this one file (as it does for a session that was signed out).
    let refuse = true;
    answer = (name, args) => {
      if (name !== "files:urls") return undefined;
      if (refuse && (args.fileIds as string[]).includes("FILEBOOM0001")) throw new Error("Unauthenticated");
      return Object.fromEntries((args.fileIds as string[]).map((id) => [id, fileInfo(signed(id, 2 * HOUR))]));
    };
    const e = await mount([para("p1", "before"), image("BAD", { fileId: "FILEBOOM0001" }), para("p2", "after"), image("GOOD", { fileId: "FILEFINE0001" })]);
    const card = host!.querySelector<HTMLElement>("[data-block-error]");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("This block couldn’t be shown.");
    expect(card!.closest("[data-block-id]")?.getAttribute("data-block-id")).toBe("BAD");
    // Its neighbours, and the same kind of block next to it, are as they were.
    expect(host!.textContent).toContain("before");
    expect(host!.textContent).toContain("after");
    expect(host!.querySelector('[data-block-id="GOOD"] img')?.getAttribute("src")).toContain("FILEFINE0001");
    expect(e.state.doc.child(1).attrs).toMatchObject({ id: "BAD", fileId: "FILEBOOM0001" });

    // Reload tries the view again.
    refuse = false;
    const reload = [...card!.querySelectorAll("button")].find((b) => b.textContent?.includes("Reload"))!;
    await act(async () => reload.click());
    await settle();
    expect(host!.querySelector("[data-block-error]")).toBeNull();
    expect(host!.querySelector('[data-block-id="BAD"] img')?.getAttribute("src")).toContain("FILEBOOM0001");
  });

  test("a view whose part of the app didn't load is asked for again; one that still won't come loads the app again", async () => {
    quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const gone = Object.assign(new Error("Loading chunk 4821 failed."), { name: "ChunkLoadError" });
    expect(isChunkLoadError(gone)).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/chunk.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);

    let fails = 1;
    const load = vi.fn(async () => {
      if (fails-- > 0) throw gone;
      return { default: (() => <p>the whiteboard</p>) as ComponentType<object> };
    });
    const View = lazyView<object>(load);
    const reloadApp = vi.fn();
    const node = {} as PMNode;
    const draw = () => (
      <BlockBoundary node={node} reload={View.reload} reloadApp={reloadApp}>
        <View />
      </BlockBoundary>
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(draw()));
    await settle();
    expect(host.textContent).toContain("This block couldn’t be shown.");
    await act(async () => host!.querySelector("button")!.click());
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("the whiteboard");
    expect(reloadApp).not.toHaveBeenCalled();

    // A part that is gone for good (replaced by a newer version of the app).
    act(() => root!.unmount());
    const never = lazyView<object>(async () => {
      throw gone;
    });
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <BlockBoundary node={node} reload={never.reload} reloadApp={reloadApp}>
          {(() => {
            const Never = never as ComponentType<object>;
            return <Never />;
          })()}
        </BlockBoundary>,
      ),
    );
    await settle();
    await act(async () => host!.querySelector("button")!.click());
    await settle();
    expect(reloadApp).not.toHaveBeenCalled();
    expect(host.textContent).toContain("This block couldn’t be shown.");
    await act(async () => host!.querySelector("button")!.click());
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  test("every block view is drawn inside the boundary", () => {
    const source = readFileSync(join(process.cwd(), "src/components/editor/NodeViews.tsx"), "utf8");
    const views = source.slice(source.indexOf("export const NODE_VIEW_EXTENSIONS"));
    // Each view goes through blockView (which guards it) or is guarded where it's made.
    expect(views.match(/ReactNodeViewRenderer\((?!guarded\()/g)).toBeNull();
    expect(source).toMatch(/return ReactNodeViewRenderer\(guarded\(component\)/);
  });
});

describe("M7 and M8: a picture keeps its place while it loads, and loads when it's needed", () => {
  test("its size comes from the block, else from the stored file", () => {
    expect(imageBoxSize({ naturalWidth: 4000, naturalHeight: 3000 }, { width: 10, height: 10 })).toEqual({ width: 4000, height: 3000 });
    expect(imageBoxSize({ naturalWidth: null, naturalHeight: null }, { width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(imageBoxSize({ naturalWidth: 4000, naturalHeight: null }, null)).toBeNull();
    expect(imageBoxSize({}, { width: 0, height: 600 })).toBeNull();
  });

  test("waiting, previewed and loaded, the box has the picture's shape", async () => {
    engine.set([{ uploadId: "UP", blockId: "IMG", documentId: "DOC", attempts: 0, state: "queued" }] as SyncState["uploads"]);
    const e = await mount([image("IMG", { naturalWidth: 4000, naturalHeight: 3000 }), para("p", "after")]);
    // Waiting: no picture yet, and its place is already kept.
    const waiting = host!.querySelector<HTMLElement>("figure [aria-busy]")!;
    expect(waiting.textContent).toContain("Loading image…");
    expect(waiting.style.aspectRatio).toBe("4000 / 3000");
    expect(waiting.className).not.toContain("h-40");

    // The copy kept on this device.
    await act(async () => previewRead("blob:local-copy"));
    let img = host!.querySelector<HTMLImageElement>("figure img")!;
    expect(img.getAttribute("src")).toBe("blob:local-copy");
    expect(img.style.aspectRatio).toBe("4000 / 3000");
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["4000", "3000"]);
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");

    // Uploaded: the server's address takes its place, in the same box.
    answer = (name, args) => (name === "files:urls" ? Object.fromEntries((args.fileIds as string[]).map((id) => [id, fileInfo(signed(id, 2 * HOUR))])) : undefined);
    engine.set([]);
    act(() => void e.view.dispatch(e.state.tr.setNodeMarkup(0, undefined, { ...e.state.doc.child(0).attrs, fileId: "FILEDONE0001" }).setMeta("addToHistory", false)));
    await settle();
    img = host!.querySelector<HTMLImageElement>("figure img")!;
    expect(img.getAttribute("src")).toContain("FILEDONE0001");
    expect(img.style.aspectRatio).toBe("4000 / 3000");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  test("a stored picture with no size on its block takes the file's, and is never edited for being looked at", async () => {
    answer = (name, args) => (name === "files:urls" ? Object.fromEntries((args.fileIds as string[]).map((id) => [id, fileInfo(signed(id, 2 * HOUR), { width: 1200, height: 800 })])) : undefined);
    const e = await mount([image("IMG", { fileId: "FILEOLD00001" })]);
    const img = host!.querySelector<HTMLImageElement>("figure img")!;
    expect(img.style.aspectRatio).toBe("1200 / 800");
    Object.defineProperties(img, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
    const doc = e.state.doc;
    act(() => void img.dispatchEvent(new Event("load")));
    expect(e.state.doc).toBe(doc);
  });

  test("a picture just added from this device gets its size written with it, with nothing more to undo", async () => {
    engine.set([{ uploadId: "UP", blockId: "IMG", documentId: "DOC", attempts: 0, state: "queued" }] as SyncState["uploads"]);
    const e = await mount([image("IMG", {})]);
    await act(async () => previewRead("blob:local-copy"));
    const img = host!.querySelector<HTMLImageElement>("figure img")!;
    Object.defineProperties(img, { naturalWidth: { value: 640 }, naturalHeight: { value: 480 } });
    const before = undoDepth(e.state);
    act(() => void img.dispatchEvent(new Event("load")));
    expect(e.state.doc.child(0).attrs).toMatchObject({ naturalWidth: 640, naturalHeight: 480 });
    expect(undoDepth(e.state)).toBe(before);
  });
});

describe("M9 and S14: file addresses", () => {
  test("an address says when it ends, and one that still works is kept when a new one arrives", () => {
    const now = 1_800_000_000_000;
    const old = { url: `https://files.test/files/A?exp=${now + 70 * 60_000}&sig=a` };
    const fresh = { url: `https://files.test/files/A?exp=${now + 130 * 60_000}&sig=b` };
    expect(fileAddressExpiry(old.url)).toBe(now + 70 * 60_000);
    expect(fileAddressExpiry("blob:kept-1")).toBeNull();
    expect(keepLoadedAddress(null, fresh, now)).toBe(fresh);
    expect(keepLoadedAddress(old, fresh, now)).toBe(old);
    // Ten minutes from its end, the new one takes over.
    expect(keepLoadedAddress(old, fresh, now + 61 * 60_000)).toBe(fresh);
    // An address that says nothing of its end is replaced, as before.
    expect(keepLoadedAddress({ url: "https://elsewhere.test/a.png" }, fresh, now)).toBe(fresh);
  });

  const mediaNote = () => [
    image("I1", { fileId: "FILEAAAA0001" }),
    para("p", "text"),
    image("I2", { fileId: "FILEBBBB0002" }),
    { type: "file", attrs: { id: "F1", depth: 0, fileId: "FILECCCC0003", name: "notes.pdf", size: 10, mimeType: "application/pdf" } },
    { type: "audio", attrs: { id: "A1", depth: 0, fileId: "FILEDDDD0004", name: "talk.m4a", size: 10, mimeType: "audio/mp4", duration: 3 } },
  ];

  test("with the note's watcher beside the editor, all its files are asked for in one question", async () => {
    answer = (name, args) => (name === "files:urls" ? Object.fromEntries((args.fileIds as string[]).map((id) => [id, fileInfo(signed(id, 2 * HOUR))])) : undefined);
    await mount(mediaNote(), (e) => <NoteFileUrls editor={e} />);
    expect([...new Set(urlsAsked())]).toEqual(["FILEAAAA0001,FILEBBBB0002,FILECCCC0003,FILEDDDD0004"]);
    expect(host!.querySelector('[data-block-id="I1"] img')?.getAttribute("src")).toContain("FILEAAAA0001");
    expect(host!.querySelector('[data-block-id="I2"] img')?.getAttribute("src")).toContain("FILEBBBB0002");
    expect(host!.querySelector<HTMLAnchorElement>('[data-block-id="F1"] a[download]')?.href).toContain("FILECCCC0003");
  });

  test("without one, each view asks for its own file, as before", async () => {
    answer = (name, args) => (name === "files:urls" ? Object.fromEntries((args.fileIds as string[]).map((id) => [id, fileInfo(signed(id, 2 * HOUR))])) : undefined);
    await mount(mediaNote());
    expect([...new Set(urlsAsked())].sort()).toEqual(["FILEAAAA0001", "FILEBBBB0002", "FILECCCC0003", "FILEDDDD0004"]);
  });

  test("a file the one answer leaves out is gone; the others aren't", async () => {
    answer = (name, args) => (name === "files:urls" ? Object.fromEntries((args.fileIds as string[]).filter((id) => id !== "FILEBBBB0002").map((id) => [id, fileInfo(signed(id, 2 * HOUR))])) : undefined);
    await mount(mediaNote(), (e) => <NoteFileUrls editor={e} />);
    expect(host!.querySelector('[data-block-id="I2"]')?.textContent).toContain("Image unavailable");
    expect(host!.querySelector('[data-block-id="I1"] img')).not.toBeNull();
  });

  test("the server's hourly new address doesn't replace one that still works (no second download)", async () => {
    const first = signed("FILEAAAA0001", 90 * 60_000);
    const second = signed("FILEAAAA0001", 150 * 60_000);
    let current = first;
    answer = (name) => (name === "files:urls" ? { FILEAAAA0001: fileInfo(current) } : undefined);
    const e = await mount([image("I1", { fileId: "FILEAAAA0001" })], (ed) => <NoteFileUrls editor={ed} />);
    expect(host!.querySelector("img")?.getAttribute("src")).toBe(first);
    // The renewal answers with the next hour's address (anything that redraws the watcher asks again).
    current = second;
    act(() => void e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, e.schema.nodes.image!.create({ id: "I2", depth: 0, fileId: "FILEBBBB0002" }))));
    await settle();
    expect(host!.querySelector('[data-block-id="I1"] img')?.getAttribute("src")).toBe(first);

    // The picture failing to load with it (the address ended while the app slept) is what brings the new one.
    act(() => void host!.querySelector('[data-block-id="I1"] img')!.dispatchEvent(new Event("error")));
    await settle();
    expect(host!.querySelector('[data-block-id="I1"] img')?.getAttribute("src")).toBe(second);
  });

  test("when the note's one question is refused, nothing breaks: the pictures say they can't be reached", async () => {
    quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    answer = (name) => {
      if (name === "files:urls") throw new Error("Unauthenticated");
      return undefined;
    };
    await mount(mediaNote(), (e) => <NoteFileUrls editor={e} />);
    expect(host!.querySelector("[data-block-error]")).toBeNull();
    expect(host!.textContent).toContain("text");
    expect(host!.querySelector('[data-block-id="I1"]')?.textContent).toContain("Image unavailable");
  });
});

describe("M13: page links past the 200th", () => {
  test("pages are asked about in groups the server answers whole, and only an asked page can be missing", () => {
    const ids = Array.from({ length: 201 }, (_, i) => `DOC${String(i).padStart(4, "0")}`);
    expect(pageQuestions(ids).map((g) => g.length)).toEqual([200, 1]);
    const first = { ids: ids.slice(0, 200), titles: Object.fromEntries(ids.slice(0, 199).map((id) => [id, { inTrash: id === "DOC0003" }])) };
    // The 200th was asked about and didn't come back; the 201st hasn't been answered for yet.
    expect(pageLinkStatuses([first], new Set())).toEqual({ DOC0003: "trash", DOC0199: "missing" });
    expect(pageLinkStatuses([first], new Set(["DOC0199"]))).toEqual({ DOC0003: "trash" });
  });

  test("a note with 201 links marks none of them unavailable when every page is there", async () => {
    // The server as it is: the first 200 pages of a question, no more.
    answer = (name, args) => (name === "documents:titles" ? Object.fromEntries((args.documentIds as string[]).slice(0, 200).map((id) => [id, { title: id, inTrash: false }])) : undefined);
    const links = Array.from({ length: 201 }, (_, i) => ({ type: "pageLink", attrs: { documentId: `DOC${String(i).padStart(4, "0")}`, label: `Page ${i}` } }));
    const e = await mount([{ type: "paragraph", attrs: { id: "p", depth: 0 }, content: links }], (ed) => <PageLinkStatusWatcher editor={ed} />);
    await settle();
    const titles = asked.filter((q) => q.name === "documents:titles");
    expect(Math.max(...titles.map((q) => (q.args.documentIds as string[]).length))).toBe(200);
    expect(pageLinkStatusKey.getState(e.state)?.statuses).toEqual({});
    expect(host!.querySelector(".fb-page-link-gone")).toBeNull();
  });
});

describe("M3: a block undone while its file uploaded gets the file when it comes back", () => {
  test("the upload that finished with no block to write to is written into the block a redo brings back", async () => {
    const e = await mount([para("p", "text"), image("IMG", {})]);
    // Nothing finished for it yet: nothing to do.
    expect(restoreUploadedFiles(e.state, "DOC")).toBeNull();
    finished.IMG = "FILEDONE0009";
    try {
      // Another note's upload for a block of the same id is not this note's.
      expect(restoreUploadedFiles(e.state, "OTHER")).toBeNull();
      const fix = restoreUploadedFiles(e.state, "DOC");
      expect(fix).not.toBeNull();
      expect(fix!.getMeta("addToHistory")).toBe(false);
      const before = undoDepth(e.state);
      act(() => void e.view.dispatch(fix!));
      expect(e.state.doc.child(1).attrs).toMatchObject({ id: "IMG", fileId: "FILEDONE0009", uploadId: null });
      expect(undoDepth(e.state)).toBe(before);
      // Once it has its file there is nothing more to give.
      expect(restoreUploadedFiles(e.state, "DOC")).toBeNull();
    } finally {
      delete finished.IMG;
    }
  });

  test("a picture from the web, and a block that already has its file, are left alone", async () => {
    finished.WEB = "FILEDONE0001";
    finished.HAS = "FILEDONE0002";
    try {
      const e = await mount([image("WEB", { url: "https://example.com/pic.png" }), image("HAS", { fileId: "FILEKEEP0001" })]);
      expect(restoreUploadedFiles(e.state, "DOC")).toBeNull();
    } finally {
      delete finished.WEB;
      delete finished.HAS;
    }
  });
});

describe("M15: an interrupted upload can be tried again now", () => {
  test("Retry now shows beside an interrupted upload and asks the uploader", async () => {
    engine.set([{ uploadId: "UP", blockId: "IMG", documentId: "DOC", attempts: 3, state: "failed" }] as SyncState["uploads"]);
    await mount([image("IMG", {})]);
    expect(host!.textContent).toContain("Upload interrupted. Retrying (attempt 4)");
    const retry = [...host!.querySelectorAll("button")].find((b) => b.textContent === "Retry now");
    expect(retry).toBeDefined();
    act(() => retry!.click());
    expect(retryUploads).toHaveBeenCalledTimes(1);
  });

  test("an upload still under way has nothing to retry", async () => {
    engine.set([{ uploadId: "UP", blockId: "IMG", documentId: "DOC", attempts: 0, state: "queued" }] as SyncState["uploads"]);
    await mount([image("IMG", {})]);
    expect([...host!.querySelectorAll("button")].some((b) => b.textContent === "Retry now")).toBe(false);
  });
});

describe("M22: a bookmark's preview", () => {
  const bookmark = (url: string): JSONContent => ({ type: "bookmark", attrs: { id: "BM", depth: 0, url, title: new URL(url).host } });

  test("a preview that couldn't be read is asked for again the next time the bookmark is shown", async () => {
    fetchPreview.mockRejectedValue(new Error("offline"));
    await mount([bookmark("https://example.com/retry-me")]);
    await settle();
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    unmount();
    fetchPreview.mockResolvedValue({ title: "Example", description: "Words.", siteName: null, image: null, icon: "https://example.com/i.png" });
    const e = await mount([bookmark("https://example.com/retry-me")]);
    await settle();
    expect(fetchPreview).toHaveBeenCalledTimes(2);
    expect(e.state.doc.child(0).attrs).toMatchObject({ title: "Example", icon: "https://example.com/i.png" });
  });

  test("a page with nothing to preview isn't read again for every bookmark to it, in this session or the next", async () => {
    fetchPreview.mockResolvedValue({ title: null, description: null, siteName: null, image: null, icon: null });
    await mount([bookmark("https://example.com/plain-page")]);
    await settle();
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("folevi:bookmarks-without-preview")).toContain("https://example.com/plain-page");
    unmount();
    // The next session knows only what the device kept.
    vi.resetModules();
    const fresh = await import("@/components/editor/NodeViews");
    const nodes = (await import("@/components/editor/extensions")).ALL_NODES;
    const made = new Editor({
      extensions: [...nodes.filter((n) => !fresh.NODE_VIEW_EXTENSIONS.some((v) => v.name === n.name)), ...fresh.NODE_VIEW_EXTENSIONS, ...(await import("@/components/editor/extensions")).ALL_MARKS],
      content: { type: "doc", content: [bookmark("https://example.com/plain-page")] },
    });
    editor = made;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const { EditorContent: FreshContent } = await import("@tiptap/react");
    await act(async () => root!.render(<FreshContent editor={made} />));
    await settle();
    expect(fetchPreview).toHaveBeenCalledTimes(1);
  });
});

// (Kept so the import above is used where the type is needed.)
export type { ReactNodeViewProps };
