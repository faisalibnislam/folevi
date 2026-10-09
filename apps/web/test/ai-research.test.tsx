// Web research in the chat (docs/AI_ASSISTANT.md milestone 6): the composer's Web switch, sources that list
// notes and web pages (opening pages in a new tab), deep research's steps with Cancel, and Save as note.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { WebToggle } from "@/components/ai/chat/WebToggle";
import { openWebCitation, Sources } from "@/components/ai/chat/ChatMessage";
import { ResearchFooter, ResearchProgress, type ResearchHandlers, type ResearchJob } from "@/components/ai/chat/ResearchCard";
import { phaseLabel, stepLines } from "@/components/ai/chat/chatText";
import { SearchSuggestions, SUGGESTIONS_HEIGHT } from "@/components/ai/chat/SearchSuggestions";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  const button = (name: string | RegExp) => [...host.querySelectorAll("button")].find((b) => (typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? "")));
  return { host, root, button, rerender: async (next: ReactNode) => act(async () => root.render(next)) };
}

const job = (over: Partial<ResearchJob> = {}): ResearchJob => ({
  id: "R1",
  messageId: "m1" as ResearchJob["messageId"],
  question: "Ferry times",
  status: "running",
  steps: [
    { kind: "notes", label: "Found 2 notes", status: "done", count: 2 },
    { kind: "plan", label: "Planned 2 searches", status: "done", count: 2 },
    { kind: "search", label: "Searching the web: ferry timetable", status: "running" },
  ],
  sources: [],
  noteId: null,
  error: null,
  credits: null,
  createdAt: 1,
  finishedAt: null,
  ...over,
});

const handlers = (j: ResearchJob, over: Partial<ResearchHandlers> = {}): ResearchHandlers => ({ job: j, saving: null, onCancel: vi.fn(), onSave: vi.fn(), ...over });

describe("the Web switch", () => {
  test("off by default, pressed when on, and it says what it does", async () => {
    const onChange = vi.fn();
    const { button, rerender } = await render(<WebToggle on={false} onChange={onChange} />);
    const web = button("Web")!;
    expect(web.getAttribute("aria-pressed")).toBe("false");
    expect(web.getAttribute("type")).toBe("button");
    expect(web.title).toBe("Also search the web");
    await act(async () => web.click());
    expect(onChange).toHaveBeenCalledWith(true);
    await rerender(<WebToggle on onChange={onChange} />);
    expect(button("Web")!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Web")!.click());
    expect(onChange).toHaveBeenLastCalledWith(false);
    await rerender(<WebToggle on={false} onChange={onChange} disabled />);
    expect(button("Web")!.disabled).toBe(true);
  });
});

describe("sources", () => {
  test("notes open at their block; web pages are numbered links with their title and site, in a new tab", async () => {
    const onCite = vi.fn();
    const { host, button } = await render(
      <Sources
        citations={[{ n: 1, noteId: "N1", title: "Trip Sketch", blockId: "B1", quote: "Book the ferry" }]}
        webCitations={[
          { n: 2, url: "https://ferries.example.com/timetable", title: "Ferry timetable", domain: "ferries.example.com" },
          { n: 3, url: "https://travel.example.org/", title: "travel.example.org", domain: "travel.example.org" },
        ]}
        onCite={onCite}
      />,
    );
    expect(host.textContent).toContain("Sources");
    await act(async () => button(/Trip Sketch/)!.click());
    expect(onCite).toHaveBeenCalledWith(expect.objectContaining({ noteId: "N1", blockId: "B1" }));
    const links = [...host.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.target, a.rel])).toEqual([
      ["2Ferry timetableferries.example.com", "https://ferries.example.com/timetable", "_blank", "noopener noreferrer"],
      // A title that is the site isn't repeated.
      ["3travel.example.org", "https://travel.example.org/", "_blank", "noopener noreferrer"],
    ]);
  });

  test("an inline web citation opens the page in a new tab without an opener", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openWebCitation({ n: 2, url: "https://ferries.example.com/timetable", title: "Ferries", domain: "ferries.example.com" });
    expect(open).toHaveBeenCalledWith("https://ferries.example.com/timetable", "_blank", "noopener,noreferrer");
  });

  test("status lines and steps for the web", () => {
    expect(phaseLabel("web", false)).toBe("Searching the web…");
    expect(phaseLabel("page", false)).toBe("Reading the page…");
    expect(phaseLabel("research", false)).toBe("Researching…");
    expect(stepLines([{ tool: "search_web", count: 4, ok: true }, { tool: "search_web", count: 2, ok: true }, { tool: "read_web_page", count: 1, ok: true }])).toEqual(["Searched the web 2 times", "Read a web page"]);
  });
});

describe("Google Search Suggestions", () => {
  test("each chip renders unchanged in a sandboxed frame: no scripts, not same-origin, links open in a new tab", async () => {
    const chip = '<style>.chip{color:#1f1f1f}@media (prefers-color-scheme: dark){.chip{color:#fff}}</style><a class="chip" href="https://www.google.com/search?q=ferry">ferry</a>';
    const { host } = await render(<SearchSuggestions entryPoints={[chip, "<b>second</b>"]} />);
    const frames = [...host.querySelectorAll("iframe")];
    expect(frames).toHaveLength(2);
    const frame = frames[0]!;
    const sandbox = frame.getAttribute("sandbox")!.split(/\s+/);
    expect(sandbox.sort()).toEqual(["allow-popups", "allow-popups-to-escape-sandbox"]);
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(frame.title).toBe("Google Search suggestions");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.style.height).toBe(`${SUGGESTIONS_HEIGHT}px`);
    const doc = frame.getAttribute("srcdoc")!;
    // Google's markup as sent, links to a new tab, light and dark.
    expect(doc).toContain(`<body>${chip}</body>`);
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain('<meta name="color-scheme" content="light dark">');
    // Nothing in the app's own page.
    expect(host.querySelector("a.chip")).toBeNull();
  });

  test("nothing shows without chips", async () => {
    const { host } = await render(<SearchSuggestions entryPoints={[]} />);
    expect(host.innerHTML).toBe("");
  });
});

describe("deep research", () => {
  test("while it runs: its steps, live, and Cancel", async () => {
    const h = handlers(job());
    const { host, button } = await render(<ResearchProgress research={h} />);
    expect(host.textContent).toContain("Researching…");
    const steps = host.querySelector('ol[aria-label="Research in progress"]')!;
    expect([...steps.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Found 2 notes (done)", "Planned 2 searches (done)", "Searching the web: ferry timetable (in progress)"]);
    await act(async () => button("Cancel")!.click());
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  test("a finished report can be saved as a note, then opened; a failed save says why; a cancelled job says so", async () => {
    const onOpen = vi.fn();
    const done = job({ status: "done" });
    const h = handlers(done);
    const { host, button, rerender } = await render(<ResearchFooter research={h} onOpen={onOpen} />);
    await act(async () => button("Save as note")!.click());
    expect(h.onSave).toHaveBeenCalledTimes(1);
    await rerender(<ResearchFooter research={handlers(done, { saving: "saving" })} onOpen={onOpen} />);
    expect(button("Save as note")!.disabled).toBe(true);
    await rerender(<ResearchFooter research={handlers(done, { saving: { error: "That report is too long to save as a note." } })} onOpen={onOpen} />);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That report is too long to save as a note.");
    await rerender(<ResearchFooter research={handlers(job({ status: "done", noteId: "N9" }))} onOpen={onOpen} />);
    expect(button("Save as note")).toBeUndefined();
    await act(async () => button("Open note")!.click());
    expect(onOpen).toHaveBeenCalledWith("/d/N9");
    await rerender(<ResearchFooter research={handlers(job({ status: "cancelled" }))} onOpen={onOpen} />);
    expect(host.textContent).toBe("Research cancelled");
  });
});
