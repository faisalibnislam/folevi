// Milestone 9 part B (docs/AI_ASSISTANT.md): Foli's first-time introduction (shown once, dismissal
// remembered), the empty and plan-gated states, the graph's node sizes, shapes, labels and keyboard moves,
// study mode reading only the cards the AI made (with "Use all toggles"), the chat's remembered mode, and
// the one-time "answer ready" announcement.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { blocksToMarkdown, markdownToBlocks, flattenTree, plainText } from "@folevi/editor-schema";

const state = vi.hoisted(() => ({
  profile: { id: "me", aiEnabled: true, entitlements: { ai: true, plan: "pro_ai" } } as Record<string, unknown>,
  mutations: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useMutation: () => async (args: unknown) => {
    state.mutations.push(args);
    return null;
  },
  useAction: () => async () => ({}),
  useQuery: () => undefined,
}));
vi.mock("@/lib/app/state", () => ({
  useAppState: () => ({ profile: state.profile, context: { kind: "personal" }, workspaces: [], scope: { kind: "personal" } }),
}));
vi.mock("@/lib/app/router", () => ({
  useAppRouter: () => ({ navigate: vi.fn() }),
  AppLink: (p: { href: string; children: React.ReactNode; className?: string }) => createElement("a", { href: p.href, className: p.className }, p.children),
}));
vi.mock("@/components/app/Shell", () => ({ ViewChrome: (p: { children: React.ReactNode }) => p.children, useShell: () => ({ openAsk: vi.fn() }) }));
vi.mock("@/components/editor/richRender", () => ({
  renderMermaid: vi.fn(async () => ({ error: "none" })),
  svgDataUrl: (svg: string) => svg,
  onThemeChange: () => () => {},
  loadKatex: vi.fn(),
  renderLatex: vi.fn(),
}));

const { AI_INTRO, AiIntroBody } = await import("@/components/ai/AiIntro");
const { AiUnavailable, aiUnavailableCopy } = await import("@/components/ai/AiUnavailable");
const { RelatedList } = await import("@/components/doc/RelatedPanel");
const { GraphCanvas, nodeLabel, ALWAYS_LABELLED } = await import("@/components/views/GraphView");
const layout = await import("@/lib/graph/layout");
const { studyItems, unmarkedToggles } = await import("@/components/ai/study");
const { StudyMode } = await import("@/components/ai/StudyMode");
const { ALL_MARKS, ALL_NODES, BlockFormat } = await import("@/components/editor/extensions");
const { BlockIdentity } = await import("@/components/editor/plugins");
const { insertAiMarkdown } = await import("@/components/ai/insert");
const { finishWriting } = await import("../../../convex/lib/ai/writing");
const { useChatMode, readChatMode } = await import("@/components/ai/chat/mode");
const { useDoneAnnouncement } = await import("@/components/ai/announce");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class NoResize {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoResize);
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });

let roots: Root[] = [];
afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  roots = [];
  document.body.innerHTML = "";
  state.mutations = [];
  state.profile = { id: "me", aiEnabled: true, entitlements: { ai: true, plan: "pro_ai" } };
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
});

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return { host, root };
}
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);

describe("Meet Foli", () => {
  test("says what Foli does here, that it shows changes first, where requests go and the credits left", () => {
    const { host } = render(createElement(AiIntroBody, { place: "note", credits: 42 }));
    expect(host.textContent).toContain(AI_INTRO.note.lead);
    expect(host.textContent).toContain("never changes a note without showing you the change first");
    expect(host.textContent).toContain("Google Gemini");
    expect(host.textContent).toContain("you have 42 AI credits left");
    for (const place of ["note", "folder", "personal", "workspace"] as const) expect(AI_INTRO[place].lead).toContain("Foli");
  });
});

describe("empty and plan-gated states", () => {
  test("AI off says how to turn it on; Core says what's included with Upgrade; a workspace points at its plan", () => {
    const off = aiUnavailableCopy({ setting: false, context: "personal" });
    expect(off.link).toEqual({ href: "/settings/ai", label: "Open AI settings" });
    expect(off.body).toContain("Settings > AI");
    const core = aiUnavailableCopy({ setting: true, context: "personal" });
    expect(core.link).toEqual({ href: "/settings/billing", label: "Upgrade" });
    expect(core.body).toMatch(/Pro and Pro AI/);
    expect(aiUnavailableCopy({ setting: true, context: "workspace" }).body).toMatch(/owner or admin/);
    const { host } = render(createElement(AiUnavailable, { ai: { setting: true, context: "personal" }, compact: true, headingLevel: 3 }));
    expect(host.querySelector("h3")?.textContent).toContain("Foli isn't part of your plan");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/settings/billing");
  });

  test("Related with nothing says how to fill it", () => {
    const { host } = render(createElement(RelatedList, { related: { full: false, note: null, items: [] }, duplicates: undefined, contradictions: undefined, onOpen: vi.fn() }));
    expect(host.textContent).toContain("Nothing related yet.");
    expect(host.textContent).toContain("Type [[");
  });

  test("a graph with few notes, or none linked, says how it grows", () => {
    const notes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: "note", label: `Note ${i}` }));
    const few = render(createElement(GraphCanvas, { nodes: notes(2), edges: [], matches: new Set<string>(), searching: false, onOpen: vi.fn() }));
    expect(few.host.textContent).toContain("Your graph grows as you write");
    const unlinked = render(createElement(GraphCanvas, { nodes: notes(4), edges: [], matches: new Set<string>(), searching: false, onOpen: vi.fn() }));
    expect(unlinked.host.textContent).toContain("Type [[ in a note to link another one");
  });
});

describe("the graph", () => {
  test("nodes grow with their connections, never shrink to a speck, and are easy to hit", () => {
    expect(layout.radiusFor(0, false)).toBeLessThan(layout.radiusFor(9, false));
    expect(layout.radiusFor(10_000, false)).toBe(18);
    expect(layout.radiusFor(0, true)).toBeGreaterThan(layout.radiusFor(0, false));
    for (const k of [0.15, 0.5, 1, 4]) {
      expect(layout.drawnRadius(layout.radiusFor(0, false), k) * k).toBeGreaterThanOrEqual(layout.MIN_DRAWN_PX - 1e-9);
      expect(layout.hitRadius(layout.radiusFor(0, false), k) * k * 2).toBeGreaterThanOrEqual(24 - 1e-9);
    }
  });

  test("entities differ from notes, and from each other, by shape", () => {
    expect(layout.shapePath("note", 6)).toBeNull();
    const paths = ["person", "project", "organization", "topic", "decision"].map((k) => layout.shapePath(k, 6));
    expect(paths.every(Boolean)).toBe(true);
    expect(new Set(paths).size).toBe(5);
    expect(new Set(Object.values(layout.KIND_SHAPE)).size).toBe(6);
  });

  test("the best-connected nodes are labelled; arrow keys pick the nearest node that way", () => {
    const deg = new Map([
      ["a", 5],
      ["b", 2],
      ["c", 2],
      ["d", 0],
    ]);
    expect([...layout.topConnected(deg, 2)]).toEqual(["a", "b"]);
    expect(layout.topConnected(deg, 10).has("d")).toBe(false);
    const pos = new Map([
      ["m", { x: 0, y: 0 }],
      ["r", { x: 100, y: 10 }],
      ["far", { x: 300, y: 0 }],
      ["up", { x: 5, y: -80 }],
      ["side", { x: 20, y: 200 }],
    ]);
    expect(layout.nextInDirection(pos, "m", "right")).toBe("r");
    expect(layout.nextInDirection(pos, "m", "up")).toBe("up");
    expect(layout.nextInDirection(pos, "m", "down")).toBe("side");
    expect(layout.nextInDirection(pos, "m", "left")).toBeNull();
    expect(layout.nextInDirection(pos, "missing", "left")).toBeNull();
  });

  test("300 nodes settle within the step limit", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `n${i}`);
    const edges = ids.slice(1).map((id, i) => ({ source: id, target: ids[(i * 7) % (i + 1)]! }));
    const sim = new layout.Simulation(ids, edges);
    let steps = 0;
    while (!sim.settled && steps < 10_000) {
      sim.tick();
      steps++;
    }
    expect(sim.settled).toBe(true);
    expect(sim.ticks).toBeLessThanOrEqual(layout.LAYOUT_MAX_TICKS);
    expect(sim.tick()).toBe(false);
  });

  test("nodes are buttons with names, one Tab stop, labels for the best connected, and keyboard moves", async () => {
    const nodes = [
      { id: "hub", kind: "note", label: "Hub" },
      { id: "a", kind: "note", label: "Alpha" },
      { id: "b", kind: "note", label: "Beta" },
      { id: "p", kind: "person", label: "Ana" },
    ];
    const edges = [
      { source: "hub", target: "a", kind: "link", inferred: false },
      { source: "hub", target: "b", kind: "link", inferred: false },
      { source: "p", target: "hub", kind: "mention", inferred: true },
    ];
    const onOpen = vi.fn();
    const { host } = render(createElement(GraphCanvas, { nodes, edges, matches: new Set<string>(), searching: false, onOpen }));
    await act(async () => new Promise((r) => setTimeout(r, 60)));
    const buttons = [...host.querySelectorAll<SVGGElement>('g[role="button"]')];
    expect(buttons).toHaveLength(4);
    expect(buttons.find((b) => b.dataset.node === "hub")!.getAttribute("aria-label")).toBe(nodeLabel(nodes[0]!, 3));
    expect(buttons.find((b) => b.dataset.node === "p")!.getAttribute("aria-label")).toBe("Ana, person, 1 connection");
    // One Tab stop: the best-connected node.
    expect(buttons.filter((b) => b.getAttribute("tabindex") === "0").map((b) => b.dataset.node)).toEqual(["hub"]);
    // Labels: every node here is among the best connected (ALWAYS_LABELLED of them).
    expect(ALWAYS_LABELLED).toBeGreaterThanOrEqual(4);
    expect([...host.querySelectorAll("text")].map((t) => t.textContent).sort()).toEqual(["Alpha", "Ana", "Beta", "Hub"]);

    const at = (id: string) => {
      const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(buttons.find((b) => b.dataset.node === id)!.getAttribute("transform")!)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const hub = buttons.find((b) => b.dataset.node === "hub")!;
    act(() => hub.focus());
    expect(document.activeElement).toBe(hub);
    // Each arrow goes to a node that way (when there's one); from the hub, with three around it, some do.
    let moves = 0;
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
      act(() => hub.focus());
      const from = at("hub");
      act(() => hub.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
      const now = (document.activeElement as SVGGElement).dataset?.node;
      if (now && now !== "hub") {
        moves++;
        const to = at(now);
        if (key === "ArrowRight") expect(to.x).toBeGreaterThan(from.x);
        if (key === "ArrowLeft") expect(to.x).toBeLessThan(from.x);
        if (key === "ArrowUp") expect(to.y).toBeLessThan(from.y);
        if (key === "ArrowDown") expect(to.y).toBeGreaterThan(from.y);
      }
    }
    expect(moves).toBeGreaterThan(0);
    // Enter opens a note; on an entity it shows its notes.
    act(() => hub.focus());
    act(() => hub.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onOpen).toHaveBeenCalledWith("hub");
    const person = buttons.find((b) => b.dataset.node === "p")!;
    act(() => person.focus());
    act(() => person.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(host.querySelector('section[aria-label="Ana"]')?.textContent).toContain("Hub");
    expect(person.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("study mode reads the cards the AI made", () => {
  const linesOf = (md: string) =>
    flattenTree(markdownToBlocks(md, { titleFromHeading: false }).blocks).map(({ block, depth }) => ({ id: block.id, type: block.type, depth, text: plainText(block.text), study: (block.props as { study?: "card" | "quiz" }).study ?? null }));
  const CARDS = finishWriting("flashcards", JSON.stringify({ cards: [{ q: "What is mitosis?", a: "Cell division." }] })).text;
  const HAND = "<details><summary>Packing</summary>\n\nTent and stove\n\n</details>";

  test("marked toggles only, unless every toggle is asked for; the mark survives Markdown both ways", () => {
    const lines = [...linesOf(CARDS), ...linesOf(HAND)];
    expect(studyItems(lines).map((i) => i.question)).toEqual(["What is mitosis?"]);
    expect(studyItems(lines, { all: true }).map((i) => i.question)).toEqual(["What is mitosis?", "Packing"]);
    expect(unmarkedToggles(lines)).toBe(1);
    const blocks = markdownToBlocks(CARDS, { titleFromHeading: false }).blocks;
    expect(blocks.find((b) => b.type === "toggle")!.props).toMatchObject({ study: "card" });
    expect(blocksToMarkdown(blocks)).toContain('<details data-study="card">');
    expect(markdownToBlocks(blocksToMarkdown(blocks), { titleFromHeading: false }).blocks.find((b) => b.type === "toggle")!.props).toMatchObject({ study: "card" });
  });

  test("a note with only hand-written toggles offers 'Use all toggles'", async () => {
    const p = (text: string): JSONContent => ({ type: "paragraph", attrs: { depth: 0 }, content: text ? [{ type: "text", text }] : [] });
    const element = document.createElement("div");
    document.body.append(element);
    const e = new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, BlockIdentity], content: { type: "doc", content: [p("Trip")] } });
    insertAiMarkdown(e, `${HAND}\n\n<details><summary>Food</summary>\n\nRice\n\n</details>`, { kind: "end" });
    const { host } = render(createElement(StudyMode, { editor: e as never, canMake: true, busy: false, onMake: vi.fn() }));
    expect(host.textContent).toContain("Nothing to study yet");
    expect(host.textContent).toContain("This note has 2 toggles you could study as cards.");
    await act(async () => button(host, "Use all toggles")!.click());
    expect(host.querySelector('[aria-roledescription="flashcard"]')?.textContent).toContain("Packing");
    expect(button(host, "Only cards made by AI")!.getAttribute("aria-pressed")).toBe("true");

    // Cards the AI made are studied on their own; the hand-written ones only with "Use all toggles".
    insertAiMarkdown(e, CARDS, { kind: "end" });
    await act(async () => button(host, "Only cards made by AI")!.click());
    expect(host.textContent).toContain("0 of 1 known");
    expect(button(host, "Use all toggles")).toBeTruthy();
    e.destroy();
  });
});

describe("the chat remembers its mode", () => {
  function ModeProbe({ fixed }: { fixed?: "ask" | "agent" | "research" }) {
    const [mode, setMode] = useChatMode(fixed);
    const [, force] = useState(0);
    return createElement(
      "div",
      null,
      createElement("span", { "data-mode": mode }, mode),
      createElement("button", { type: "button", onClick: () => (setMode("agent"), force((n) => n + 1)) }, "agent"),
      createElement("button", { type: "button", onClick: () => setMode("ask", { remember: false }) }, "quiet"),
    );
  }

  test("a pick is remembered per person and read back on the next visit; a fixed mode isn't", () => {
    const first = render(createElement(ModeProbe));
    expect(first.host.querySelector("span")!.textContent).toBe("ask");
    act(() => button(first.host, "agent")!.click());
    expect(readChatMode("me")).toBe("agent");
    expect(readChatMode("someone-else")).toBeNull();
    const next = render(createElement(ModeProbe));
    expect(next.host.querySelector("span")!.textContent).toBe("agent");
    act(() => button(next.host, "quiet")!.click());
    expect(readChatMode("me")).toBe("agent");
    // The note's Agent tab sets its own mode and doesn't change what's remembered.
    localStorage.clear();
    const fixed = render(createElement(ModeProbe, { fixed: "ask" }));
    act(() => button(fixed.host, "agent")!.click());
    expect(readChatMode("me")).toBeNull();
  });

  test("storage that can't be read: it starts in Chat and nothing breaks", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { host } = render(createElement(ModeProbe));
    expect(host.querySelector("span")!.textContent).toBe("ask");
    act(() => button(host, "agent")!.click());
    expect(host.querySelector("span")!.textContent).toBe("agent");
    spy.mockRestore();
    set.mockRestore();
  });
});

describe("answers are announced once, when they're ready", () => {
  function Probe({ busy }: { busy: boolean }) {
    return createElement("p", null, useDoneAnnouncement(busy, "Answer ready."));
  }
  test("nothing at first or while working; once when it finishes", () => {
    const { host, root } = render(createElement(Probe, { busy: false }));
    expect(host.textContent).toBe("");
    act(() => root.render(createElement(Probe, { busy: true })));
    expect(host.textContent).toBe("");
    act(() => root.render(createElement(Probe, { busy: false })));
    expect(host.textContent).toBe("Answer ready.");
  });
});
