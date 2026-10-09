// Attachments and audio (docs/AI_ASSISTANT.md milestone 5): which picked files the chat attaches and which
// it refuses before uploading (with the reason), the Attach control and its chips, the transcript preview
// (Insert below, Summarize, Copy, Discard), and a transcript going in right after its audio block.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("convex/react", () => ({ useConvex: () => ({}), useAction: () => vi.fn(), useMutation: () => vi.fn(), useQuery: () => undefined }));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate: vi.fn() }), AppLink: (p: { children: unknown }) => p.children }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }), errorMessage: (e: unknown) => String((e as Error)?.message ?? e) }));
vi.mock("@/components/editor/richRender", () => ({ renderMermaid: vi.fn(async () => ({ error: "none" })), svgDataUrl: (svg: string) => svg, onThemeChange: () => () => {}, loadKatex: vi.fn(), renderLatex: vi.fn() }));

const { AttachControl, AttachmentChips, AttachmentProblems, planAttachments } = await import("@/components/ai/chat/Attachments");
const { TranscriptPreview } = await import("@/components/ai/TranscriptPreview");
const { insertAiMarkdown } = await import("@/components/ai/insert");
const { ALL_MARKS, ALL_NODES, BlockFormat } = await import("@/components/editor/extensions");
const { BlockIdentity } = await import("@/components/editor/plugins");

class NoResize {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoResize);
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });

let root: Root | null = null;
async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

const MB = 1024 * 1024;

describe("picking files", () => {
  test("readable files are attached; Word files, GIFs, files too large and the sixth file are refused with the reason", () => {
    const caps = { vision: true, audioIn: true };
    const plan = planAttachments([], [
      { name: "timetable.pdf", size: 2 * MB, type: "application/pdf" },
      { name: "report.docx", size: 1000, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { name: "budget.csv", size: 300, type: "text/csv" },
      { name: "notes.md", size: 300, type: "" },
      { name: "anim.gif", size: 300, type: "image/gif" },
      { name: "scan.pdf", size: 20 * MB, type: "application/pdf" },
    ], caps);
    expect(plan.accepted.map((a) => a.kind)).toEqual(["pdf", "csv", "markdown"]);
    expect(plan.refused.map((r) => r.name)).toEqual(["report.docx", "anim.gif", "scan.pdf"]);
    expect(plan.refused[0]!.reason).toMatch(/isn't supported yet.*Word, Excel and PowerPoint/);
    expect(plan.refused[2]!.reason).toMatch(/too large/);
    const five = Array.from({ length: 5 }, () => ({ kind: "text" as const, size: 10 }));
    expect(planAttachments(five, [{ name: "six.txt", size: 10, type: "text/plain" }], caps).refused[0]!.reason).toBe("Attach up to 5 files to one message.");
    expect(planAttachments([{ kind: "pdf", size: 12 * MB }], [{ name: "photo.png", size: 3 * MB, type: "image/png" }], caps).refused[0]!.reason).toMatch(/too large together/);
    // What the model can't take in isn't offered.
    expect(planAttachments([], [{ name: "photo.png", size: 10, type: "image/png" }], { vision: false, audioIn: true }).refused[0]!.reason).toBe("The AI model in use can't read images.");
  });
});

describe("the Attach control", () => {
  test("opens the device's file picker behind the app's own button and hands over what was picked", async () => {
    const onFiles = vi.fn();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const host = await render(<AttachControl noteFiles={[]} onFiles={onFiles} onPick={vi.fn()} />);
    const attach = button(host, "Attach files")!;
    expect(attach).toBeTruthy();
    await act(async () => attach.click());
    expect(click).toHaveBeenCalledTimes(1);
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.hidden).toBe(true);
    const file = new File(["month,amount"], "budget.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onFiles).toHaveBeenCalledWith([file]);
    click.mockRestore();
  });

  test("chips show what's attached (uploading, then ready) and come off with their ×; refusals are shown before sending", async () => {
    const onRemove = vi.fn();
    const onDismiss = vi.fn();
    const host = await render(
      <>
        <AttachmentChips
          files={[
            { key: "a", name: "timetable.pdf", size: 2048, kind: "pdf", status: "ready", fileId: "F1" },
            { key: "b", name: "chart.png", size: 1024, kind: "image", status: "uploading" },
          ]}
          onRemove={onRemove}
        />
        <AttachmentProblems problems={[{ name: "report.docx", reason: "“report.docx” isn't supported yet." }]} onDismiss={onDismiss} />
      </>,
    );
    const chips = [...host.querySelectorAll('ul[aria-label="Attached files"] li')];
    expect(chips.map((c) => c.textContent)).toEqual(["timetable.pdf", "chart.pngUploading"]);
    await act(async () => button(host, "Remove timetable.pdf")!.click());
    expect(onRemove).toHaveBeenCalledWith("a");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("isn't supported yet");
    await act(async () => button(host, "Dismiss")!.click());
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("the transcript preview", () => {
  const base = { summary: null, summarizing: false, view: "transcript" as const, onView: vi.fn(), problem: null, onInsert: vi.fn(), onSummarize: vi.fn(), onDiscard: vi.fn() };

  test("shows progress while transcribing, then the transcript with Insert below, Summarize, Copy and Discard", async () => {
    const working = await render(<TranscriptPreview {...base} working transcript="" canInsert />);
    expect(working.querySelector('[role="status"]')?.textContent).toContain("Transcribing");
    expect(button(working, "Insert below")).toBeUndefined();
    act(() => root!.unmount());
    root = null;

    const onInsert = vi.fn();
    const onSummarize = vi.fn();
    const onDiscard = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const host = await render(<TranscriptPreview {...base} working={false} transcript={"Speaker 1: Book the ferry.\n\nSpeaker 2: Friday works."} canInsert onInsert={onInsert} onSummarize={onSummarize} onDiscard={onDiscard} />);
    expect(host.querySelector('[role="region"][aria-label="Transcript"]')?.textContent).toContain("Speaker 2: Friday works.");
    await act(async () => button(host, "Insert below")!.click());
    await act(async () => button(host, "Summarize")!.click());
    await act(async () => button(host, "Copy")!.click());
    await act(async () => button(host, "Discard")!.click());
    expect(onInsert).toHaveBeenCalled();
    expect(onSummarize).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("Speaker 1: Book the ferry.\n\nSpeaker 2: Friday works.");
    expect(onDiscard).toHaveBeenCalled();
  });

  test("with a summary: switch between them; read-only notes get no Insert; a refusal is shown", async () => {
    const onView = vi.fn();
    const host = await render(<TranscriptPreview {...base} working={false} transcript="Long talk." summary={"- Ferry on Friday"} view="summary" onView={onView} canInsert={false} problem={{ message: "No AI credits left.", kind: "out_of_credits", action: "buy" }} />);
    expect(host.textContent).toContain("Ferry on Friday");
    expect(button(host, "Insert below")).toBeUndefined();
    expect(button(host, "Summarize")).toBeUndefined();
    await act(async () => button(host, "Transcript")!.click());
    expect(onView).toHaveBeenCalledWith("transcript");
    expect(host.querySelector('[data-testid="ai-credits-problem"]')?.textContent).toContain("No AI credits left.");
  });

  test("Insert below puts the transcript right after its audio block, as one undo step", () => {
    const p = (text: string): JSONContent => ({ type: "paragraph", attrs: { depth: 0 }, content: text ? [{ type: "text", text }] : [] });
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity], content: { type: "doc", content: [p("Intro"), { type: "audio", attrs: { depth: 0, fileId: "F1", name: "memo.webm" } }, p("After")] } });
    const audioPos = editor.state.doc.child(0).nodeSize;
    const audio = editor.state.doc.child(1);
    insertAiMarkdown(editor, "Speaker 1: Book the ferry.\n\nSpeaker 2: Friday works.", { kind: "after", pos: audioPos + audio.nodeSize, depth: 0 });
    const types: string[] = [];
    editor.state.doc.forEach((n) => types.push(`${n.type.name}:${n.textContent}`));
    expect(types).toEqual(["paragraph:Intro", "audio:", "paragraph:Speaker 1: Book the ferry.", "paragraph:Speaker 2: Friday works.", "paragraph:After"]);
    editor.commands.undo();
    const back: string[] = [];
    editor.state.doc.forEach((n) => back.push(n.type.name));
    expect(back).toEqual(["paragraph", "audio", "paragraph"]);
    editor.destroy();
  });
});
