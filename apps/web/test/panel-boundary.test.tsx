// A part of the note's tools panel that can't be fetched (no connection, a new version since the page opened)
// must not take the note down with it: a note opens with Foli AI's panel, so a note opened offline before that
// part had ever loaded showed the page's error screen instead of the note (found 2026-11-19).
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PanelBoundary } from "@/components/doc/PanelBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => act(() => root.unmount()) };
}

const chunkError = () => Object.assign(new Error("Failed to load chunk /_next/static/chunks/ai.js from module AiPanel.tsx"), { name: "ChunkLoadError" });

describe("a part of the tools panel that didn't arrive", () => {
  test("the panel says so, the note around it stays, and Try again asks for the part again", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tries: number[] = [];
    function Part({ attempt }: { attempt: number }) {
      tries.push(attempt);
      if (attempt === 0) throw chunkError();
      return <p>Write, Ask, Study</p>;
    }
    const { host, unmount } = render(
      <main>
        <article>The note</article>
        <PanelBoundary name="Foli AI">{(attempt) => <Part attempt={attempt} />}</PanelBoundary>
      </main>,
    );
    expect(host.querySelector("article")?.textContent).toBe("The note");
    const notice = host.querySelector('[role="status"]');
    expect(notice?.textContent).toContain("Foli AI couldn’t load. Check your connection, then try again.");
    expect(host.textContent).not.toContain("Write, Ask, Study");
    act(() => host.querySelector("button")!.click());
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toContain("Write, Ask, Study");
    expect(tries.at(-1)).toBe(1);
    unmount();
  });

  test("any other error is not hidden: it goes on to whatever catches errors above", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    class Above extends Component<{ children: ReactNode }, { caught: string | null }> {
      override state = { caught: null as string | null };
      static getDerivedStateFromError(e: unknown) {
        return { caught: String((e as Error).message) };
      }
      override render() {
        return this.state.caught ? <p data-above="">{this.state.caught}</p> : this.props.children;
      }
    }
    function Broken(): ReactNode {
      throw new Error("a bug in the panel");
    }
    const { host, unmount } = render(
      <Above>
        <PanelBoundary name="Foli AI">{() => <Broken />}</PanelBoundary>
      </Above>,
    );
    expect(host.querySelector("[data-above]")?.textContent).toBe("a bug in the panel");
    expect(host.textContent).not.toContain("couldn’t load");
    unmount();
  });
});
