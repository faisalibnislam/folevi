"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import { emptyFlowchart, serializeFlowchart } from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { chartFromDraft, type FlowDraft } from "@/components/editor/flowchart/ops";
import { FlowchartStatic } from "@/components/editor/flowchart/render";
import "@/components/editor/flowchart/flowchart.css";
import { cx } from "../ui";
import { autoplay, isStill } from "./autoplay";

/*
 * Flowcharts with AI (components/editor/flowchart/FlowchartAi.tsx), playing by itself: a process is
 * described, the chart is drawn shape by shape, then changed in words (an approval step, error handling,
 * the main steps only). Visitors can pick the ideas, switch between Update and Start over, or type. Every
 * chart is an AI-shaped draft laid out and drawn by the app's own flowchart code; the drafts are canned.
 */

type Draft = FlowDraft & { id: string };
const e = (from: string, to: string, extra: Partial<FlowDraft["edges"][number]> = {}) => ({ from, to, ...extra });

const REFUND: Draft = {
  id: "refund",
  direction: "TD",
  nodes: [
    { id: "start", shape: "terminator", text: "Refund requested", color: "accent" },
    { id: "check", shape: "process", text: "Check the order", color: "neutral" },
    { id: "days", shape: "decision", text: "Within 30 days?", color: "yellow" },
    { id: "refund", shape: "process", text: "Approve the refund", color: "green" },
    { id: "credit", shape: "process", text: "Offer store credit", color: "pink" },
    { id: "pay", shape: "io", text: "Send the money back", color: "blue" },
    { id: "done", shape: "terminator", text: "Email the customer", color: "neutral" },
  ],
  edges: [e("start", "check"), e("check", "days"), e("days", "refund", { label: "Yes" }), e("days", "credit", { label: "No" }), e("refund", "pay"), e("pay", "done"), e("credit", "done", { style: "dashed" })],
};

const UPDATES: Array<{ idea: string; draft: Draft }> = [
  {
    idea: "Add an approval step after review",
    draft: {
      ...REFUND,
      id: "approval",
      nodes: [...REFUND.nodes.slice(0, 2), { id: "approve", shape: "process", text: "Manager approves", color: "purple" }, ...REFUND.nodes.slice(2)],
      edges: [e("start", "check"), e("check", "approve"), e("approve", "days"), ...REFUND.edges.slice(2)],
    },
  },
  {
    idea: "Add error handling to every step",
    draft: {
      ...REFUND,
      id: "errors",
      nodes: [...REFUND.nodes, { id: "failed", shape: "decision", text: "Payment failed?", color: "yellow" }, { id: "retry", shape: "process", text: "Retry, then tell support", color: "pink" }],
      edges: [...REFUND.edges.filter((x) => !(x.from === "pay" && x.to === "done")), e("pay", "failed"), e("failed", "retry", { label: "Yes" }), e("failed", "done", { label: "No" }), e("retry", "done", { style: "dashed" })],
    },
  },
  {
    idea: "Simplify it to the main steps",
    draft: {
      id: "simple",
      direction: "TD",
      nodes: [REFUND.nodes[0]!, REFUND.nodes[1]!, REFUND.nodes[3]!, REFUND.nodes[6]!],
      edges: [e("start", "check"), e("check", "refund"), e("refund", "done")],
    },
  },
];

const CREATES: Array<{ idea: string; draft: Draft }> = [
  { idea: "Customer refund process", draft: REFUND },
  {
    idea: "Hiring pipeline from application to offer",
    draft: {
      id: "hiring",
      direction: "TD",
      nodes: [
        { id: "apply", shape: "terminator", text: "Application received", color: "accent" },
        { id: "screen", shape: "process", text: "Screen the CV", color: "neutral" },
        { id: "fit", shape: "decision", text: "Good fit?", color: "yellow" },
        { id: "talk", shape: "process", text: "Two interviews", color: "blue" },
        { id: "no", shape: "process", text: "Send a kind no", color: "pink" },
        { id: "offer", shape: "terminator", text: "Make an offer", color: "green" },
      ],
      edges: [e("apply", "screen"), e("screen", "fit"), e("fit", "talk", { label: "Yes" }), e("fit", "no", { label: "No" }), e("talk", "offer")],
    },
  },
  {
    idea: "How a pull request gets merged",
    draft: {
      id: "pr",
      direction: "TD",
      nodes: [
        { id: "open", shape: "terminator", text: "Pull request opened", color: "accent" },
        { id: "ci", shape: "process", text: "Checks run", color: "neutral" },
        { id: "pass", shape: "decision", text: "Checks pass?", color: "yellow" },
        { id: "review", shape: "process", text: "Code review", color: "blue" },
        { id: "fix", shape: "process", text: "Fix and push", color: "pink" },
        { id: "merge", shape: "terminator", text: "Merge", color: "green" },
      ],
      edges: [e("open", "ci"), e("ci", "pass"), e("pass", "review", { label: "Yes" }), e("pass", "fix", { label: "No" }), e("fix", "ci", { style: "dashed" }), e("review", "merge")],
    },
  },
];

const PROMPT = "Customer refund process: refunds within 30 days, store credit after that";
type Mode = "create" | "update";
type Busy = null | "drawing" | "updating";

export function FlowchartDemo() {
  // The first frame (and a card cover's) shows the refund chart; the autoplay starts from an empty chart.
  const [chart, setChart] = useState<Draft | null>(REFUND);
  const [prev, setPrev] = useState<Draft | null>(null);
  const [mode, setMode] = useState<Mode>("update");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  const data = useMemo(() => (chart ? serializeFlowchart(chartFromDraft(chart, emptyFlowchart(), "create")) : ""), [chart]);

  /** Sends a request: create draws a new chart, update changes the current one. */
  const send = async (draft: Draft, how: Mode, sleep: (ms: number) => Promise<void>) => {
    const id = ++runId.current;
    setHint(null);
    setBusy(how === "create" ? "drawing" : "updating");
    await sleep(1200);
    if (id !== runId.current) return;
    setPrev(how === "update" ? chart : null);
    setChart(draft);
    setBusy(null);
    setText("");
    setMode("update");
  };

  useEffect(() => {
    if (!auto) return;
    return autoplay(root.current, async (sleep) => {
      for (;;) {
        setChart(null);
        setPrev(null);
        setMode("create");
        setText("");
        setHover(null);
        await sleep(1000);
        for (let n = 1; n <= PROMPT.length; n += 2) {
          setText(PROMPT.slice(0, n));
          await sleep(30);
        }
        setText(PROMPT);
        await sleep(600);
        await send(REFUND, "create", sleep);
        await sleep(3200);
        let current = REFUND;
        for (const u of UPDATES) {
          setHover(u.idea);
          await sleep(900);
          setHover(null);
          setText(u.idea);
          await sleep(500);
          // Each update reads the chart it changes from state; keep the autoplay's own copy in step.
          setPrev(current);
          setBusy("updating");
          await sleep(1200);
          setChart(u.draft);
          setBusy(null);
          setText("");
          current = u.draft;
          await sleep(3400);
        }
        await sleep(1200);
      }
    });
    // The loop keeps its own copy of the chart and only calls state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const plain = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const take = () => setAuto(false);
  const ideas = mode === "create" ? CREATES : UPDATES;
  const pick = (idea: string) => {
    take();
    const hit = ideas.find((i) => i.idea === idea);
    if (!hit) return;
    setText(idea);
    void send(hit.draft, mode, plain);
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    take();
    const q = text.trim().toLowerCase();
    if (!q) return;
    if (mode === "create") {
      const hit = CREATES.find((c) => q.includes(c.idea.split(" ")[0]!.toLowerCase())) ?? CREATES[0]!;
      void send(hit.draft, "create", plain);
      return;
    }
    const hit = UPDATES.find((u) => q.includes(u.idea.split(" ")[1]!.toLowerCase()) || q.includes(u.idea.split(" ")[0]!.toLowerCase()));
    if (hit) void send(hit.draft, "update", plain);
    else setHint("This sample knows three changes. Try one of the ideas below.");
  };

  return (
    <div
      ref={root}
      onPointerDown={take}
      onKeyDown={take}
      role="group"
      aria-label="A working sample of flowcharts with AI. Describe a process or pick an idea, then change the chart in words."
      className="mx-auto max-w-[760px]"
    >
      <div className="mk-card overflow-hidden">
        <div className="flex items-center gap-2 border-b mk-hair px-5 py-3 text-[12px] font-medium text-muted">
          <span className="rounded-chip bg-(--glass-hover) px-1.5 leading-5 text-ink">Flowchart</span>
          <span className="flex-1" />
          <span>Tidy up</span>
          <span className="inline-flex items-center gap-1 rounded-chip bg-(--glass-hover) px-2 py-0.5 text-(--color-heading)">
            <AiIcon size={12} /> AI
          </span>
        </div>
        <div className="grid items-start md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="mk-app-pop m-3 overflow-hidden rounded-panel text-[13.5px] md:m-5">
            {chart ? (
              <div className="flex gap-1 px-2 pt-2 text-[12px] font-[550]" role="group" aria-label="What the AI should do">
                {(["update", "create"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => {
                      take();
                      setMode(m);
                    }}
                    className={cx("rounded-chip px-2.5 py-1", mode === m ? "bg-(--glass-hover) text-(--color-heading) shadow-[inset_0_0_0_1px_var(--glass-border)]" : "text-muted hover:text-(--color-heading)")}
                  >
                    {m === "update" ? "Update this chart" : "Start over"}
                  </button>
                ))}
              </div>
            ) : null}
            <form onSubmit={submit} className="flex items-start gap-2 p-2">
              <AiIcon size={15} className="mt-[3px] flex-none text-[#7c6cf0]" />
              <label htmlFor="fc-demo-input" className="sr-only">
                {mode === "create" ? "Describe the process" : "What should change?"}
              </label>
              <textarea
                id="fc-demo-input"
                rows={3}
                value={text}
                disabled={busy !== null}
                onChange={(ev) => {
                  take();
                  setText(ev.target.value);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && !ev.shiftKey) submit(ev);
                }}
                placeholder={mode === "create" ? "Describe a process, step by step or in a sentence…" : "What should change? e.g. add an approval step after review"}
                className="min-w-0 flex-1 resize-none bg-transparent text-[14px] leading-[1.45] text-ink outline-none placeholder:text-faint"
              />
              <button type="submit" aria-label={mode === "create" ? "Create flowchart" : "Update flowchart"} disabled={busy !== null || !text.trim()} className="grid size-7 flex-none place-items-center rounded-chip bg-(--color-heading) text-(--color-canvas) transition-opacity disabled:opacity-30">
                <ArrowUp size={15} aria-hidden="true" />
              </button>
            </form>
            {busy ? (
              <p className="flex items-center gap-2 px-3.5 pb-3 text-[13px] text-muted" role="status">
                <AiIcon size={12} className="animate-pulse text-[#7c6cf0]" />
                {busy === "drawing" ? "Drawing your flowchart…" : "Updating the flowchart…"}
              </p>
            ) : hint ? (
              <p className="px-3.5 pb-3 text-[13px] text-muted" role="status">
                {hint}
              </p>
            ) : null}
            <ul className="border-t border-(--color-line) px-1.5 py-1.5 text-[13px]" aria-label="Ideas">
              {ideas.map(({ idea }) => (
                <li key={idea}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => pick(idea)}
                    className={cx("w-full rounded-control px-2 py-1.5 text-left transition-colors hover:bg-(--glass-hover) hover:text-(--color-heading)", hover === idea ? "bg-(--glass-hover) text-(--color-heading)" : "text-muted")}
                  >
                    {idea}
                  </button>
                </li>
              ))}
            </ul>
            <p className="border-t border-(--color-line) px-3.5 py-1.5 text-[11px] text-faint">AI can make mistakes. Sent to Google Gemini.{chart ? " Undo with ⌘Z." : ""}</p>
          </div>
          <div className="relative min-h-[420px] px-2 pb-5 md:min-h-[560px] md:pt-3">
            {chart ? (
              <DrawnChart key={chart.id} data={data} before={prev} />
            ) : (
              <div className="grid h-[420px] place-items-center text-center text-[13px] text-muted md:h-[540px]">
                <p className="max-w-[24ch]">{busy ? "" : "Describe a process and Folevi draws it here."}</p>
              </div>
            )}
            {busy ? <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklab,#8b7cf6_14%,transparent),transparent_60%)]" /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The chart, drawn by the app's renderer; shapes that weren't in the chart before pop in one by one, then the arrows. */
function DrawnChart({ data, before }: { data: string; before: Draft | null }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || isStill(el)) return;
    const known = new Set(before?.nodes.map((n) => n.text) ?? []);
    let i = 0;
    el.querySelectorAll<SVGGElement>(".fc-node").forEach((g) => {
      if (known.has(g.textContent?.trim() ?? "")) return;
      g.style.animation = `fc-demo-pop 420ms var(--mk-ease) ${i++ * 150}ms both`;
    });
    const edgesAt = known.size ? 150 : i * 150;
    el.querySelectorAll<SVGGElement>(".fc-edge, .fc-edge-label, text.fc-label").forEach((g) => {
      g.style.animation = `fc-demo-fade 360ms ease ${edgesAt}ms both`;
    });
  }, [before]);
  return (
    <div ref={box} className="[&_.fc-node]:[transform-box:fill-box] [&_.fc-node]:[transform-origin:center] [&_.fc-static]:flex [&_.fc-static]:justify-center">
      <FlowchartStatic data={data} height={560} />
    </div>
  );
}
