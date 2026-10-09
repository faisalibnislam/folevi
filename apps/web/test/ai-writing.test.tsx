// The writing assistant (docs/AI_ASSISTANT.md milestone 4): the complete set of selection actions, the
// preview of a rewrite's changes, where results go (replace, above, below, append) as one undo step, the
// inline composer from pick to Replace, and AI following the note's own plan inside its editor.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";

// The Convex hooks: `write` answers from `reply`, streams aren't available (so results arrive whole).
const reply = vi.hoisted(() => ({ text: "", title: undefined as string | undefined, calls: [] as unknown[] }));
const app = vi.hoisted(() => ({ workspaces: [] as { id: string; aiIncluded: boolean }[] }));
vi.mock("convex/react", () => ({
  useAction: () => async (args: unknown) => {
    reply.calls.push(args);
    return { text: reply.text, title: reply.title };
  },
  useMutation: () => async () => {
    throw new Error("no streams in tests");
  },
  useQuery: () => undefined,
}));
vi.mock("@/lib/app/state", () => ({
  useAppState: () => ({
    profile: { id: "me", aiEnabled: true, entitlements: { ai: true, plan: "pro_ai" } },
    context: { kind: "personal" },
    workspaces: app.workspaces,
    scope: { kind: "personal" },
  }),
}));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate: vi.fn() }), AppLink: (p: { children: unknown }) => p.children }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }), errorMessage: (e: unknown) => String((e as Error)?.message ?? e) }));
vi.mock("@/components/editor/richRender", () => ({
  renderMermaid: vi.fn(async () => ({ error: "none" })),
  svgDataUrl: (svg: string) => svg,
  onThemeChange: () => () => {},
  loadKatex: vi.fn(),
  renderLatex: vi.fn(),
}));

const { ALL_MARKS, ALL_NODES, BlockFormat } = await import("@/components/editor/extensions");
const { BlockIdentity } = await import("@/components/editor/plugins");
const { insertAiMarkdown, noteIsEmpty } = await import("@/components/ai/insert");
const { aiDiff, blocksPlain } = await import("@/components/ai/aiDiff");
const { InlineAi, taskLabel } = await import("@/components/ai/InlineAi");
const { NoteAiContext, REWRITE_TASKS, SELECTION_ACTIONS, useAiEnabled } = await import("@/components/ai/useAi");
const { WRITING_TASKS, finishWriting } = await import("../../../convex/lib/ai/writing");

class NoResize {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoResize);
// jsdom has no layout: the editor scrolls the selection into view after focus.
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });

const p = (text: string): JSONContent => ({ type: "paragraph", attrs: { depth: 0 }, content: text ? [{ type: "text", text }] : [] });
function make(content: JSONContent[]) {
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity], content: { type: "doc", content } });
}
const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}`));
  return out;
};
/** The text range of block `index` (inside it). */
const rangeOf = (e: Editor, index: number) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += e.state.doc.child(i).nodeSize;
  return { from: pos + 1, to: pos + 1 + e.state.doc.child(index).content.size };
};

afterEach(() => {
  document.body.innerHTML = "";
  reply.calls.length = 0;
  reply.title = undefined;
  app.workspaces = [];
});

describe("selection actions", () => {
  test("every action, tone and turn-into is offered, and the server knows each one", () => {
    expect(SELECTION_ACTIONS.map((a) => a.task)).toEqual([
      "improve", "fix", "shorter", "longer", "simplify", "translate",
      "professional", "casual", "friendly", "confident", "direct", "academic",
      "toList", "toTable", "toChecklist",
      "summarizeText", "explain", "continueText", "actionItemsText",
    ]);
    for (const a of SELECTION_ACTIONS) expect(Object.keys(WRITING_TASKS)).toContain(a.task);
    for (const t of ["summarize", "continue", "outline", "actions", "title", "brainstorm", "draft", "refine", "page", "template"]) expect(Object.keys(WRITING_TASKS)).toContain(t);
    // Rewrites can replace the selection; reading it (summary, explanation, continuation) never does.
    expect(REWRITE_TASKS.has("academic")).toBe(true);
    expect(REWRITE_TASKS.has("toTable")).toBe(true);
    expect(REWRITE_TASKS.has("refine")).toBe(true);
    expect(REWRITE_TASKS.has("explain")).toBe(false);
    expect(REWRITE_TASKS.has("continueText")).toBe(false);
    expect(taskLabel("academic")).toBe("Tone: Academic");
    expect(taskLabel("translate", "French")).toBe("Translate to French");
    expect(taskLabel("toChecklist")).toBe("Turn into a checklist");
  });

  test("results are tidied per task: a checklist is to-dos, a page has its title split off", () => {
    expect(finishWriting("toChecklist", "- Book the ferry\n- Pack\n1. Leave").text).toBe("- [ ] Book the ferry\n- [ ] Pack\n- [ ] Leave");
    expect(finishWriting("page", "```markdown\n# Weekend hike\n\n## Pack\n- [ ] Water\n```")).toEqual({ text: "## Pack\n- [ ] Water", title: "Weekend hike" });
    expect(finishWriting("title", '## "Trip plans."\nmore').text).toBe("Trip plans");
  });
});

describe("the preview of changes", () => {
  test("marks removed and added words, comparing the text as the note would hold it", () => {
    const d = aiDiff("i has went to the market", "I went to the market.");
    expect(d.same).toBe(false);
    expect(d.parts.filter((x) => x.kind === "removed").map((x) => x.text.trim())).toEqual(expect.arrayContaining(["i has"]));
    expect(d.parts.filter((x) => x.kind === "added").map((x) => x.text.trim())).toEqual(expect.arrayContaining(["I"]));
    expect(d.kept).toBeGreaterThan(0.5);
    // Markdown marks aren't changes: a list keeps its words.
    expect(blocksPlain("- one\n- **two**")).toBe("one\ntwo");
    expect(blocksPlain("| A | B |\n| --- | --- |\n| 1 | 2 |")).toBe("A | B\n1 | 2");
    expect(aiDiff("one\ntwo", "- one\n- two").same).toBe(true);
    // A translation keeps little.
    expect(aiDiff("Good morning everyone", "Bonjour à tous").kept).toBeLessThan(0.3);
  });
});

describe("where results go", () => {
  test("replace, insert above, insert below and append, each one undo step", () => {
    const e = make([p("First line"), p("Second line"), p("Third line")]);
    const second = rangeOf(e, 1);
    expect(insertAiMarkdown(e, "Above it", { kind: "above", at: second.from })).toBe(true);
    expect(texts(e)).toEqual(["paragraph:First line", "paragraph:Above it", "paragraph:Second line", "paragraph:Third line"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:First line", "paragraph:Second line", "paragraph:Third line"]);

    expect(insertAiMarkdown(e, "- [ ] One\n- [ ] Two", { kind: "below", at: rangeOf(e, 1).to })).toBe(true);
    expect(texts(e)).toEqual(["paragraph:First line", "paragraph:Second line", "todo:One", "todo:Two", "paragraph:Third line"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:First line", "paragraph:Second line", "paragraph:Third line"]);

    expect(insertAiMarkdown(e, "## The end", { kind: "end" })).toBe(true);
    expect(texts(e).at(-1)).toBe("heading:The end");
    e.commands.undo();

    const r = rangeOf(e, 1);
    expect(insertAiMarkdown(e, "Better line", { kind: "replace", ...r, original: "Second line" })).toBe(true);
    expect(texts(e)).toEqual(["paragraph:First line", "paragraph:Better line", "paragraph:Third line"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:First line", "paragraph:Second line", "paragraph:Third line"]);
    // The selection changed since it was sent: nothing is replaced.
    expect(insertAiMarkdown(e, "Better line", { kind: "replace", ...r, original: "Something else" })).toBe(false);
    expect(texts(e)).toEqual(["paragraph:First line", "paragraph:Second line", "paragraph:Third line"]);
    e.destroy();
  });

  test("an empty note is empty, and a generated page fills it from the top", () => {
    const e = make([p("")]);
    expect(noteIsEmpty(e)).toBe(true);
    insertAiMarkdown(e, "## Pack\n\n- [ ] Water\n\n| Day | Plan |\n| --- | --- |\n| Sat | Hike |", { kind: "end" });
    expect(texts(e).map((t) => t.split(":")[0])).toEqual(["heading", "todo", "table"]);
    expect(noteIsEmpty(e)).toBe(false);
    e.destroy();
  });
});

async function mount(editor: Editor, request: Parameters<typeof InlineAi>[0]["request"]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  await act(async () => {
    root.render(createElement(InlineAi, { editor: editor as never, documentId: "N1", request, onClose }));
  });
  return { host, root, onClose };
}
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const option = (host: HTMLElement, name: string) => [...host.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === name) as HTMLElement | undefined;

describe("the inline composer", () => {
  test("a rewrite shows its changes first, and nothing changes until Replace (one undo takes it back)", async () => {
    const e = make([p("i has went to the market"), p("After")]);
    const r = rangeOf(e, 0);
    const { host, root, onClose } = await mount(e, { id: 1, target: { ...r, text: "i has went to the market" } });
    // The menu groups, the tone and language lists.
    expect([...host.querySelectorAll('[role="presentation"]')].map((h) => h.textContent)).toEqual(["Edit", "Turn into", "Use the text", "Meetings and study", "Think it through"]);
    expect(option(host, "Change tone…")).toBeTruthy();
    reply.text = "I went to the market.";
    await act(async () => option(host, "Fix spelling & grammar")!.click());
    expect(reply.calls[0]).toMatchObject({ task: "fix", text: "i has went to the market", documentId: "N1" });
    // The changes, not the note: struck-out and added words.
    expect(host.querySelector("del.fb-diff-removed")?.textContent).toMatch(/i has/);
    expect(host.querySelector("ins.fb-diff-added")).not.toBeNull();
    expect(texts(e)[0]).toBe("paragraph:i has went to the market");
    for (const name of ["Replace", "Insert above", "Insert below", "Append to note", "Copy", "Try again", "Discard"]) expect(button(host, name), name).toBeTruthy();
    // "Result" shows it as it would read.
    await act(async () => button(host, "Result")!.click());
    expect(host.querySelector("del.fb-diff-removed")).toBeNull();
    await act(async () => button(host, "Replace")!.click());
    expect(onClose).toHaveBeenCalled();
    expect(texts(e)).toEqual(["paragraph:I went to the market.", "paragraph:After"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:i has went to the market", "paragraph:After"]);
    act(() => root.unmount());
    e.destroy();
  });

  test("tones are a list of their own; Discard leaves the note alone", async () => {
    const e = make([p("We might ship it")]);
    const r = rangeOf(e, 0);
    const { host, root, onClose } = await mount(e, { id: 2, target: { ...r, text: "We might ship it" } });
    await act(async () => option(host, "Change tone…")!.click());
    expect(host.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Tones");
    expect([...host.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim())).toEqual(["Professional", "Casual", "Friendly", "Confident", "Direct", "Academic"]);
    reply.text = "We will ship it.";
    await act(async () => option(host, "Confident")!.click());
    expect(reply.calls[0]).toMatchObject({ task: "confident" });
    await act(async () => button(host, "Discard")!.click());
    expect(onClose).toHaveBeenCalled();
    expect(texts(e)).toEqual(["paragraph:We might ship it"]);
    act(() => root.unmount());
    e.destroy();
  });

  test("a page written into an empty note fills it and names it", async () => {
    const e = make([p("")]);
    const setTitle = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    await act(async () => {
      root.render(createElement(NoteAiContext.Provider, { value: { home: null, title: "", setTitle } }, createElement(InlineAi, { editor: e as never, documentId: "N1", request: { id: 3, target: null, mode: "page" }, onClose })));
    });
    const input = host.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe("Describe the page");
    reply.text = "## Pack\n\n- [ ] Water";
    reply.title = "Weekend hike";
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "A weekend hike");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => option(host, "Write a page: A weekend hike")!.click());
    expect(reply.calls[0]).toMatchObject({ task: "page", instruction: "A weekend hike" });
    expect(host.textContent).toContain("Weekend hike");
    for (const name of ["Insert", "Create note", "Save as template"]) expect(button(host, name), name).toBeTruthy();
    await act(async () => button(host, "Insert")!.click());
    expect(texts(e)).toEqual(["heading:Pack", "todo:Water"]);
    expect(setTitle).toHaveBeenCalledWith("Weekend hike");
    act(() => root.unmount());
    e.destroy();
  });
});

describe("AI follows the note inside its editor", () => {
  test("a note from a workspace without AI turns the editor's AI off", async () => {
    app.workspaces = [{ id: "W1", aiIncluded: false }];
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useAiEnabled());
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.render(createElement(NoteAiContext.Provider, { value: { home: { id: "N1", workspaceId: "W1" } } }, createElement(Probe))));
    // Personal (current context): on. The workspace note's editor: off (Core, or AI not included there).
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
    act(() => root.unmount());
  });
});
