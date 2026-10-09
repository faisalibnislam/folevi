// The AI page and chat (docs/AI_ASSISTANT.md milestone 1): routes, the chat's small helpers, and answers
// rendered with tables, code (with Copy) and clickable citations.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseRoute } from "@/lib/app/router";
import { APP_ROUTE_HEADS } from "@/lib/app/routes";
import { AiMarkdown, answerSegments, linkCitations } from "@/components/ai/AiMarkdown";
import { citationHref, phaseLabel, storedProblem, withNote, without, WHOLE_SCOPE } from "@/components/ai/chat/chatText";
import { markdownToBlocks } from "@folevi/editor-schema";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("routes", () => {
  test("/ai is the AI page, with or without a conversation, and Settings has an AI section", () => {
    expect(parseRoute("/ai")).toEqual({ name: "ai", id: null });
    expect(parseRoute("/ai/01J9ZXCV8K2M4N6P8Q0R2S4T6V")).toEqual({ name: "ai", id: "01J9ZXCV8K2M4N6P8Q0R2S4T6V" });
    expect(parseRoute("/ai/not%20an%20id")).toEqual({ name: "ai", id: null });
    expect(APP_ROUTE_HEADS.has("ai")).toBe(true);
    expect(parseRoute("/settings/ai")).toEqual({ name: "settings", section: "ai" });
  });
});

describe("chat helpers", () => {
  test("the status line, stored refusals, contexts and citation links", () => {
    expect(phaseLabel("searching", false)).toBe("Searching your notes…");
    expect(phaseLabel(null, false)).toBe("Thinking…");
    expect(phaseLabel("searching", true)).toBe("Writing…");
    expect(storedProblem({ code: "out_of_credits", message: "None left.", action: "buy" })).toEqual({ message: "None left.", kind: "out_of_credits", action: "buy" });
    expect(storedProblem({ code: "forbidden", message: "Core.", reason: "ai_not_included" })).toMatchObject({ kind: "not_included" });
    expect(storedProblem({ code: "maintenance", message: "Busy." })).toMatchObject({ kind: "other" });
    let c = withNote(WHOLE_SCOPE, "a");
    expect(c).toEqual({ kind: "note", ids: ["a"] });
    c = withNote(c, "b");
    expect(c).toEqual({ kind: "notes", ids: ["a", "b"] });
    expect(without(c, "a")).toEqual({ kind: "note", ids: ["b"] });
    expect(without({ kind: "note", ids: ["b"] }, "b")).toEqual(WHOLE_SCOPE);
    expect(without({ kind: "folder", ids: ["f"] }, "f")).toEqual(WHOLE_SCOPE);
    expect(withNote({ kind: "folder", ids: ["f"] }, "a")).toEqual({ kind: "note", ids: ["a"] });
    expect(citationHref({ noteId: "N1", blockId: "B1" })).toBe("/d/N1#block-B1");
    expect(citationHref({ noteId: "N1" })).toBe("/d/N1");
  });

  test("citations become links, but not inside code or existing links", () => {
    expect(linkCitations("Take the ferry [1]. See [2](https://x.y) and `arr[1]`.", new Set([1, 2]))).toBe("Take the ferry [1](#cite-1). See [2](https://x.y) and `arr[1]`.");
    expect(linkCitations("Not cited [3].", new Set([1]))).toBe("Not cited [3].");
    expect(linkCitations("```\nx[1]\n```\nyes [1]", new Set([1]))).toBe("```\nx[1]\n```\nyes [1](#cite-1)");
  });

  test("top-level code blocks are set apart (they get a Copy button)", () => {
    const blocks = markdownToBlocks("Intro\n\n```ts\nconst a = 1;\n```\n\nAfter", { titleFromHeading: false }).blocks;
    expect(answerSegments(blocks).map((s) => s.kind)).toEqual(["blocks", "code", "blocks"]);
  });
});

describe("answers", () => {
  test("render tables, code with Copy, and citations that open their source", async () => {
    const onCite = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<AiMarkdown markdown={"Book the ferry [1].\n\n| Day | Plan |\n| --- | --- |\n| Fri | Ferry |\n\n```js\nconsole.log(1)\n```"} cited={new Set([1])} onCite={onCite} />);
    });
    expect(host.querySelector("table")).not.toBeNull();
    expect(host.querySelector("pre code")?.textContent).toBe("console.log(1)");
    const cite = host.querySelector<HTMLAnchorElement>('a[href="#cite-1"]')!;
    expect(cite.textContent).toBe("1");
    await act(async () => cite.click());
    expect(onCite).toHaveBeenCalledWith(1);
    const copy = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Copy code")!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith("console.log(1)");
    act(() => root.unmount());
  });
});
