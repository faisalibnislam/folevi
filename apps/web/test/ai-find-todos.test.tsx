// "Find to-dos" (docs/AI_ASSISTANT.md, notes that schedule themselves): the proposal lists Foli AI's action
// items with the date read from the note's words, the person matched (or a "Sam?" hint) and where each came
// from, and "Add" puts the checked ones into the note as to-do blocks with their due date, time and assignee.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";

// Foli AI's answer (aiTodos.find), and what the app knows: today is Wednesday 14 October 2026 in Auckland.
const reply = vi.hoisted(() => ({ calls: [] as unknown[], items: [] as unknown[], people: [] as unknown[] }));
vi.mock("convex/react", () => ({
  useAction: () => async (args: unknown) => {
    reply.calls.push(args);
    return { items: reply.items, people: reply.people };
  },
  useMutation: () => async () => undefined,
  useQuery: () => undefined,
}));
vi.mock("@/lib/app/state", () => ({
  useAppState: () => ({ scope: { kind: "personal" }, today: "2026-10-14", timeZone: "Pacific/Auckland", engine: null }),
}));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate: vi.fn() }), AppLink: (p: { children: unknown }) => p.children }));
const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast, errorMessage: (e: unknown) => String((e as Error)?.message ?? e) }));
vi.mock("@/components/editor/richRender", () => ({
  renderMermaid: vi.fn(async () => ({ error: "none" })),
  svgDataUrl: (svg: string) => svg,
  onThemeChange: () => () => {},
  loadKatex: vi.fn(),
  renderLatex: vi.fn(),
}));

const { ALL_MARKS, ALL_NODES, BlockFormat } = await import("@/components/editor/extensions");
const { BlockIdentity } = await import("@/components/editor/plugins");
const { FindTodosHost, openFindTodos } = await import("@/components/ai/FindTodos");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class NoResize {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoResize);
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });
// jsdom has no modal dialogs.
Object.assign(HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  },
  close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  },
});

const p = (text: string): JSONContent => ({ type: "paragraph", attrs: { depth: 0 }, content: text ? [{ type: "text", text }] : [] });

afterEach(() => {
  document.body.innerHTML = "";
  reply.calls = [];
  vi.useRealTimers();
});

async function mount() {
  // 10:00 on Wednesday 14 October 2026 in Auckland.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 13, 21, 0)));
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity], content: { type: "doc", content: [p("Weekly sync"), p("Sam to send the deck by Friday.")] } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(FindTodosHost, { editor: editor as never, documentId: "DOC", enabled: true })));
  return { editor, root };
}

const settle = async (ms = 400) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};
const button = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;

describe("Find to-dos", () => {
  test("proposes dated, assigned to-dos and adds the checked ones as real to-dos", async () => {
    reply.items = [
      { text: "Send the deck", owner: "Sam", when: "by Friday", quote: "Sam to send the deck by Friday.", assigneeId: "p-sam", match: "matched" },
      { text: "Book the hall", owner: "Priya", when: "tomorrow 3pm", quote: null, assigneeId: null, match: "unknown" },
      { text: "Order chairs", owner: null, when: "after the launch", quote: null, assigneeId: null, match: "none" },
    ];
    reply.people = [
      { profileId: "p-me", displayName: "Faisal Islam", isYou: true },
      { profileId: "p-sam", displayName: "Sam Rivera", isYou: false },
    ];
    const { editor } = await mount();
    act(() => openFindTodos(editor.view.dom, { target: null }));
    await settle();
    expect(reply.calls).toEqual([{ scope: { kind: "personal" }, documentId: "DOC", text: undefined }]);
    const dialog = document.querySelector("dialog")!;
    const rows = [...dialog.querySelectorAll("[data-testid='proposed-todo']")];
    expect(rows).toHaveLength(3);
    // The date in words, from the person's today; where it came from; who it's for.
    expect(rows[0]!.textContent).toContain("Due Friday.");
    expect(rows[0]!.textContent).toContain("From: “Sam to send the deck by Friday.”");
    expect(rows[0]!.textContent).toContain("Sam Rivera");
    expect(rows[1]!.textContent).toContain("Due Tomorrow, 15:00.");
    expect(rows[1]!.textContent).toContain("Priya?");
    expect(rows[2]!.textContent).toContain("No date: couldn’t read “after the launch” as one.");
    // Leave the last one out.
    act(() => (rows[2]!.querySelector("[role='checkbox']") as HTMLButtonElement).click());
    expect(button("Add 2 to-dos")).toBeTruthy();
    act(() => button("Add 2 to-dos")!.click());

    const added: { type: string; text: string; attrs: Record<string, unknown> }[] = [];
    editor.state.doc.forEach((n) => added.push({ type: n.type.name, text: n.textContent, attrs: n.attrs }));
    expect(added.map((b) => `${b.type}:${b.text}`)).toEqual(["paragraph:Weekly sync", "paragraph:Sam to send the deck by Friday.", "heading:To-dos", "todo:Send the deck", "todo:Priya: Book the hall"]);
    expect(added[3]!.attrs).toMatchObject({ checked: false, dueDate: "2026-10-16", dueTime: null, assigneeId: "p-sam" });
    expect(added[4]!.attrs).toMatchObject({ checked: false, dueDate: "2026-10-15", dueTime: "15:00", assigneeId: null });
    expect(toast.show).toHaveBeenCalledWith("Added 2 to-dos");
    expect(document.querySelector("dialog")).toBeNull();
    // One undo step takes them all back.
    editor.commands.undo();
    expect(editor.state.doc.childCount).toBe(2);
  });

  test("on a selection: only that text is sent, and the to-dos go right below it", async () => {
    reply.items = [{ text: "Send the deck", owner: "me", when: null, quote: null, assigneeId: "p-me", match: "matched" }];
    reply.people = [{ profileId: "p-me", displayName: "Faisal Islam", isYou: true }];
    const { editor } = await mount();
    const from = editor.state.doc.child(0).nodeSize + 1;
    const to = from + editor.state.doc.child(1).content.size;
    act(() => openFindTodos(editor.view.dom, { target: { from, to, text: "Sam to send the deck by Friday." } }));
    await settle();
    expect(reply.calls).toEqual([{ scope: { kind: "personal" }, documentId: "DOC", text: "Sam to send the deck by Friday." }]);
    expect(document.querySelector("dialog")!.textContent).toContain("in the selected text");
    act(() => button("Add 1 to-do")!.click());
    const added: string[] = [];
    editor.state.doc.forEach((n) => added.push(`${n.type.name}:${n.textContent}:${n.attrs.assigneeId ?? ""}:${n.attrs.dueDate ?? ""}`));
    expect(added).toEqual(["paragraph:Weekly sync::", "paragraph:Sam to send the deck by Friday.::", "todo:Send the deck:p-me:"]);
  });
});
