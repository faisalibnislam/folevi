// Milestone 8's study, meeting, translation and framework tools (docs/AI_ASSISTANT.md): study mode reads the
// note's flashcards and quiz (flip, Know it / Again, progress, a quiz score), the tools are offered in the
// inline composer and the "/" menu, a meeting summary's owners become mentions and assignees, and a whole-note
// translation goes into the editor as one undo step with every block's structure kept.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { flattenTree, markdownToBlocks, plainText } from "@folevi/editor-schema";

const reply = vi.hoisted(() => ({ text: "", calls: [] as unknown[] }));
vi.mock("convex/react", () => ({
  useAction: () => async (args: unknown) => {
    reply.calls.push(args);
    return { text: reply.text };
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
    workspaces: [],
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
const { insertAiMarkdown } = await import("@/components/ai/insert");
const { InlineAi, taskLabel } = await import("@/components/ai/InlineAi");
const { StudyMode } = await import("@/components/ai/StudyMode");
const { AI_TOOLS, AI_TOOL_SLASH_ITEMS, TOOL_TASKS, REWRITE_TASKS } = await import("@/components/ai/useAi");
const { cardsReducer, quizReducer, quizScore, startCards, startQuiz, studyItems } = await import("@/components/ai/study");
const { linkPeople } = await import("@/components/ai/people");
const { applyTranslation } = await import("@/components/ai/translateApply");
const { WRITING_TASKS, finishWriting } = await import("../../../convex/lib/ai/writing");

class NoResize {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoResize);
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
/** Lines for study mode from Markdown (as the note would hold it). */
const linesOf = (md: string) =>
  flattenTree(markdownToBlocks(md, { titleFromHeading: false }).blocks).map(({ block, depth }) => ({ id: block.id, type: block.type, depth, text: plainText(block.text), study: (block.props as { study?: "card" | "quiz" }).study ?? null }));
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const option = (host: HTMLElement, name: string) => [...host.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === name) as HTMLElement | undefined;

const CARDS = finishWriting("flashcards", JSON.stringify({ cards: [{ q: "What is mitosis?", a: "Cell division." }, { q: "What is a gene?", a: "A unit of heredity." }] })).text;
const QUIZ = finishWriting(
  "quiz",
  JSON.stringify({
    questions: [
      { q: "Capital of France?", options: ["Lyon", "Paris", "Nice"], answer: 1, explanation: "Paris is the capital." },
      { q: "2 + 2?", options: ["3", "4"], answer: 1, explanation: "Basic sums." },
    ],
  }),
).text;

afterEach(() => {
  document.body.innerHTML = "";
  reply.calls.length = 0;
});

describe("the new actions", () => {
  test("every tool is a server task, inserted (never replacing), and in the '/' menu", () => {
    expect(AI_TOOLS.map((t) => t.task)).toEqual(["meetingSummary", "flashcards", "quiz", "prosCons", "decisionMatrix", "swot", "risks", "premortem", "mindMap", "howMightWe", "scamper", "sixHats"]);
    for (const t of AI_TOOLS) {
      expect(Object.keys(WRITING_TASKS)).toContain(t.task);
      expect(REWRITE_TASKS.has(t.task)).toBe(false);
      expect(TOOL_TASKS.has(t.task)).toBe(true);
    }
    expect(AI_TOOL_SLASH_ITEMS.map((i) => i.label)).toEqual([
      "Foli: Meeting summary", "Foli: Flashcards", "Foli: Quiz", "Foli: Pros and cons", "Foli: Decision matrix", "Foli: SWOT analysis",
      "Foli: Risks and mitigations", "Foli: Pre-mortem", "Foli: Mind map", "Foli: How might we", "Foli: SCAMPER", "Foli: Six thinking hats",
    ]);
    // "think" finds the frameworks, "ai" finds them all.
    expect(AI_TOOL_SLASH_ITEMS.filter((i) => i.keywords.includes("think")).map((i) => i.task)).toEqual(["prosCons", "decisionMatrix", "swot", "risks", "premortem", "mindMap", "howMightWe", "scamper", "sixHats"]);
    expect(AI_TOOL_SLASH_ITEMS.every((i) => i.keywords.startsWith("ai "))).toBe(true);
    expect(taskLabel("meetingSummary")).toBe("Meeting summary");
  });

  test("the inline composer offers them on a selection and on the note, and runs them on the selected text", async () => {
    const e = make([p("We chose the harbour hall. Sam sends the deck.")]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    await act(async () => root.render(createElement(InlineAi, { editor: e as never, documentId: "N1", request: { id: 1, target: { from: 1, to: 47, text: "We chose the harbour hall. Sam sends the deck." } }, onClose })));
    for (const name of ["Meeting summary", "Flashcards", "Quiz", "Pros and cons", "Decision matrix", "SWOT analysis", "Risks and mitigations", "Pre-mortem", "Mind map", "How might we", "SCAMPER", "Six thinking hats"]) expect(option(host, name), name).toBeTruthy();
    reply.text = "## Decisions\n\n- Harbour hall\n\n## Action items\n\n- [ ] @Sam: Send the deck";
    await act(async () => option(host, "Meeting summary")!.click());
    expect(reply.calls[0]).toMatchObject({ task: "meetingSummary", text: "We chose the harbour hall. Sam sends the deck.", documentId: "N1" });
    // A tool's result is inserted or saved as a note, never replacing the text.
    expect(button(host, "Replace")).toBeUndefined();
    for (const name of ["Insert below", "Insert above", "Append to note", "Create note", "Copy", "Try again", "Discard"]) expect(button(host, name), name).toBeTruthy();
    expect(texts(e)).toEqual(["paragraph:We chose the harbour hall. Sam sends the deck."]);
    await act(async () => button(host, "Insert below")!.click());
    expect(texts(e)).toEqual(["paragraph:We chose the harbour hall. Sam sends the deck.", "heading:Decisions", "bulleted:Harbour hall", "heading:Action items", "todo:@Sam: Send the deck"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:We chose the harbour hall. Sam sends the deck."]);
    act(() => root.unmount());

    // From the "/" menu on the whole note: runs at once, with no selection.
    const root2 = createRoot(host);
    await act(async () => root2.render(createElement(InlineAi, { editor: e as never, documentId: "N1", request: { id: 2, target: null, task: "swot" }, onClose })));
    expect(reply.calls[1]).toMatchObject({ task: "swot", documentId: "N1" });
    expect((reply.calls[1] as { text?: string }).text).toBeUndefined();
    act(() => root2.unmount());
    e.destroy();
  });

  test("a meeting summary's owners become mentions and to-do assignees when they can be mentioned", () => {
    const { blocks } = markdownToBlocks("- [ ] @Sam Lee: Send the deck (due 2026-10-14)\n- [ ] @Nobody: Book\n- Ask @sam lee and @Ana later", { titleFromHeading: false });
    const linked = linkPeople(blocks, [
      { profileId: "p-sam", displayName: "Sam Lee" },
      { profileId: "p-ana", displayName: "Ana" },
    ]);
    expect(linked[0]!.text).toEqual([{ type: "mention", userId: "p-sam", label: "Sam Lee" }, { type: "text", text: ": Send the deck" }]);
    expect(linked[0]!.props).toMatchObject({ assigneeId: "p-sam", dueDate: "2026-10-14" });
    expect(linked[1]).toBe(blocks[1]);
    // Not a to-do: mentions, no assignee.
    expect(linked[2]!.text.filter((n) => n.type === "mention")).toHaveLength(2);
    expect(linked[2]!.props.assigneeId).toBeUndefined();
    // Into the note: a real mention node.
    const e = make([p("Notes")]);
    insertAiMarkdown(e, "- [ ] @Ana: Call the venue", { kind: "end" }, { people: [{ profileId: "p-ana", displayName: "Ana" }] });
    const todo = e.state.doc.lastChild!;
    expect(todo.type.name).toBe("todo");
    expect(todo.attrs.assigneeId).toBe("p-ana");
    expect(todo.firstChild?.type.name).toBe("mention");
    e.destroy();
  });
});

describe("study mode", () => {
  test("cards and quiz questions are read from the note's toggles", () => {
    const items = studyItems([...linesOf(CARDS), ...linesOf(QUIZ), ...linesOf("<details><summary>Empty toggle</summary>\n</details>")]);
    expect(items.map((i) => i.kind)).toEqual(["card", "card", "quiz", "quiz"]);
    expect(items[0]).toMatchObject({ question: "What is mitosis?", answer: "Cell division." });
    expect(items[2]).toMatchObject({ question: "Capital of France?", options: ["Lyon", "Paris", "Nice"], answer: 1, explanation: "Paris is the capital." });
  });

  test("flashcards: flip, Again puts a card at the back, Know it takes it out; a quiz scores the first pick", () => {
    let s = startCards(["a", "b", "c"]);
    s = cardsReducer(s, { type: "flip" });
    expect(s.flipped).toBe(true);
    s = cardsReducer(s, { type: "again" });
    expect(s).toMatchObject({ queue: ["b", "c", "a"], flipped: false, again: ["a"] });
    s = cardsReducer(cardsReducer(cardsReducer(s, { type: "know" }), { type: "know" }), { type: "know" });
    expect(s).toMatchObject({ queue: [], known: ["b", "c", "a"] });
    expect(cardsReducer(s, { type: "know" })).toBe(s);

    const questions = studyItems(linesOf(QUIZ)).filter((i) => i.kind === "quiz");
    let q = startQuiz();
    expect(quizReducer(q, { type: "next", total: 2 })).toBe(q);
    q = quizReducer(q, { type: "pick", option: 0 });
    q = quizReducer(q, { type: "pick", option: 1 });
    expect(q.picked).toEqual([0]);
    q = quizReducer(q, { type: "next", total: 2 });
    q = quizReducer(quizReducer(q, { type: "pick", option: 1 }), { type: "next", total: 2 });
    expect(q.done).toBe(true);
    expect(quizScore(questions as never, q)).toBe(1);
  });

  async function study(e: Editor, onMake = vi.fn()) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(StudyMode, { editor: e as never, canMake: true, busy: false, onMake })));
    return { host, root, onMake };
  }

  test("runs through the note's cards with progress, then its quiz with a score", async () => {
    const e = make([p("Biology")]);
    insertAiMarkdown(e, `${CARDS}\n\n${QUIZ}`, { kind: "end" });
    const { host, root } = await study(e);
    const bar = () => host.querySelector('[role="progressbar"]')!;
    expect(host.textContent).toContain("0 of 2 known");
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
    expect(host.querySelector('[aria-roledescription="flashcard"]')?.textContent).toContain("What is mitosis?");
    expect(host.textContent).not.toContain("Cell division.");
    const flip = button(host, "Show answer")!;
    expect(flip.getAttribute("aria-expanded")).toBe("false");
    await act(async () => flip.click());
    expect(host.textContent).toContain("Cell division.");
    expect(button(host, "Hide answer")!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => button(host, "Again")!.click());
    expect(host.querySelector('[aria-roledescription="flashcard"]')?.textContent).toContain("What is a gene?");
    await act(async () => button(host, "Know it")!.click());
    expect(host.textContent).toContain("1 of 2 known");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Known. 1 of 2.");
    // Keyboard: K is "Know it".
    await act(async () => host.querySelector('[aria-roledescription="flashcard"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true })));
    expect(host.textContent).toContain("You know all 2 cards.");
    expect(host.textContent).toContain("One needed another go.");
    expect(bar().getAttribute("aria-valuenow")).toBe("2");

    // The quiz.
    await act(async () => button(host, "Quiz (2)")!.click());
    expect(host.textContent).toContain("Question 1 of 2");
    expect(host.querySelector("legend")?.textContent).toBe("Capital of France?");
    await act(async () => [...host.querySelectorAll("fieldset button")].find((b) => b.textContent?.includes("Lyon"))!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("Not quite. It's B. Paris is the capital.");
    // One answer per question.
    await act(async () => [...host.querySelectorAll("fieldset button")].find((b) => b.textContent?.includes("Paris"))!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("0 right");
    await act(async () => button(host, "Next question")!.click());
    // Keyboard: B picks the second option.
    await act(async () => host.querySelector("fieldset")!.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true })));
    expect(host.textContent).toContain("Right. Basic sums.");
    await act(async () => button(host, "See your score")!.click());
    expect(host.textContent).toContain("You got 1 of 2 right.");
    await act(async () => button(host, "Try again")!.click());
    expect(host.textContent).toContain("Question 1 of 2");
    // Studying never changes the note.
    expect(texts(e).filter((t) => t.startsWith("toggle")).length).toBe(4);
    act(() => root.unmount());
    e.destroy();
  });

  test("nothing to study yet: offers to make flashcards or a quiz", async () => {
    const e = make([p("Just a paragraph")]);
    const { host, root, onMake } = await study(e);
    expect(host.textContent).toContain("Nothing to study yet");
    await act(async () => button(host, "Make flashcards")!.click());
    await act(async () => button(host, "Make a quiz")!.click());
    expect(onMake.mock.calls).toEqual([["flashcards"], ["quiz"]]);
    act(() => root.unmount());
    e.destroy();
  });
});

describe("whole-note translation in the editor", () => {
  test("each block's text changes in place, structure and code kept, one undo takes it all back", () => {
    const e = make([p("")]);
    insertAiMarkdown(e, "## Plan\n\n- [ ] Book the ferry\n\n```js\nconst x = 1;\n```\n\n| Day |\n| --- |\n| Sat |", { kind: "end" });
    const ids: Record<string, string> = {};
    e.state.doc.forEach((n) => void (ids[n.type.name] = n.attrs.id as string));
    const before = texts(e);
    const changed = applyTranslation(e, [
      { id: ids.heading!, text: [{ type: "text", text: "Plan (ES)" }], from: "Plan" },
      { id: ids.todo!, text: [{ type: "text", text: "Reservar el ferry" }], from: "Book the ferry" },
      { id: ids.table!, rows: [[[{ type: "text", text: "Día" }]], [[{ type: "text", text: "Sáb" }]]], from: "DaySat" },
      { id: "gone", text: [{ type: "text", text: "nothing" }] },
    ]);
    expect(changed).toEqual({ changed: 3, skipped: 0 });
    expect(texts(e)).toEqual(["heading:Plan (ES)", "todo:Reservar el ferry", "codeBlock:const x = 1;", "table:"]);
    let todoId = "";
    e.state.doc.forEach((n) => {
      if (n.type.name === "todo") todoId = n.attrs.id as string;
      if (n.type.name === "table") expect(n.attrs.rows).toEqual([[[{ type: "text", text: "Día" }]], [[{ type: "text", text: "Sáb" }]]]);
    });
    expect(todoId).toBe(ids.todo);
    e.commands.undo();
    expect(texts(e)).toEqual(before);
    // A block edited since the translation was made is left as it is.
    expect(applyTranslation(e, [{ id: ids.heading!, text: [{ type: "text", text: "Plan (ES)" }], from: "Old plan" }, { id: ids.todo!, text: [{ type: "text", text: "Reservar" }], from: "Book the ferry" }])).toEqual({ changed: 1, skipped: 1 });
    expect(texts(e).slice(0, 2)).toEqual(["heading:Plan", "todo:Reservar"]);
    e.destroy();
  });
});
