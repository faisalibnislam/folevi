"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  CheckSquare,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  List,
  Mic,
  Network,
  Paperclip,
  PenTool,
  Play,
  Quote,
  StickyNote,
  Table2,
  Text,
} from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { cx } from "../ui";
import { isStill } from "../demos/autoplay";

/*
 * The "/" menu, playing by itself: someone types "/" and a few letters, the menu filters the way the app's
 * does (components/editor/EditorMenus.tsx: labels and keywords, label matches first), they pick an item
 * and the block lands in the note. Two short notes take turns. It pauses off screen, and with reduced
 * motion it shows one still frame.
 */

type Item = { label: string; keywords: string; icon: ReactNode; hint?: string };

const ai = <AiIcon size={15} className="text-[#7c6cf0]" />;
const ITEMS: Item[] = [
  { label: "Text", keywords: "text paragraph plain", icon: <Text size={15} /> },
  { label: "Heading 1", hint: "#", keywords: "heading title h1 large", icon: <Heading1 size={15} /> },
  { label: "Heading 2", hint: "##", keywords: "heading subtitle h2", icon: <Heading2 size={15} /> },
  { label: "Heading 3", hint: "###", keywords: "heading h3 small", icon: <Heading3 size={15} /> },
  { label: "To-do", hint: "[]", keywords: "todo task checklist checkbox", icon: <CheckSquare size={15} /> },
  { label: "Bulleted list", hint: "-", keywords: "bullet list unordered", icon: <List size={15} /> },
  { label: "Callout", keywords: "callout note info warning tip", icon: <StickyNote size={15} /> },
  { label: "Quote", hint: ">", keywords: "quote blockquote citation", icon: <Quote size={15} /> },
  { label: "Table", keywords: "table grid spreadsheet", icon: <Table2 size={15} /> },
  { label: "Audio recording", keywords: "audio record recording voice memo microphone mic sound dictate", icon: <Mic size={15} /> },
  { label: "Flowchart", keywords: "flowchart diagram process flow chart shapes boxes arrows", icon: <Network size={15} /> },
  { label: "Whiteboard", keywords: "whiteboard drawing sketch draw pen canvas", icon: <PenTool size={15} /> },
  { label: "Image", keywords: "image picture photo upload", icon: <ImageIcon size={15} /> },
  { label: "File", keywords: "file attachment upload pdf", icon: <Paperclip size={15} /> },
  { label: "Kanban", keywords: "kanban board collection database columns", icon: <Columns3 size={15} /> },
  { label: "Today’s date", keywords: "date today mention calendar", icon: <CalendarDays size={15} /> },
  { label: "Ask AI…", hint: "⌘J", keywords: "ai assistant write generate gemini ask", icon: ai },
  { label: "AI · Summarize note", keywords: "ai summary summarize tldr", icon: ai },
  { label: "AI · Find action items", keywords: "ai tasks todo action items follow ups", icon: ai },
];

/** The app's filter: label or keyword matches, labels starting with the query first. */
function filtered(query: string): Item[] {
  const q = query.toLowerCase();
  const rank = (i: Item) => {
    const label = i.label.toLowerCase();
    return label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
  };
  return ITEMS.filter((i) => !q || i.label.toLowerCase().includes(q) || i.keywords.includes(q)).sort((a, b) => (q ? rank(a) - rank(b) : 0));
}

type Kind = "heading" | "todo" | "audio" | "flowchart" | "callout" | "table" | "summary" | "date";
type Block = { id: number; kind: Kind; text: string };
type Scene = { query: string; downs?: number; kind: Kind; text?: string };

const NOTES: Array<{ title: string; scenes: Scene[] }> = [
  {
    title: "Seed swap",
    scenes: [
      { query: "head", downs: 1, kind: "heading", text: "Saturday at the library" },
      { query: "todo", kind: "todo", text: "Print the seed labels" },
      { query: "rec", kind: "audio" },
      { query: "flow", kind: "flowchart" },
    ],
  },
  {
    title: "Studio move",
    scenes: [
      { query: "call", kind: "callout", text: "Keys from Ines on Friday morning." },
      { query: "tod", kind: "date", text: "Movers arrive " },
      { query: "tab", kind: "table" },
      { query: "sum", kind: "summary", text: "Movers come Saturday. Two boxes still need labels." },
    ],
  },
];

type State = { title: string; blocks: Block[]; query: string | null; active: number; key: string | null; fading: boolean };

/** The still frame: also what the server renders before the animation starts. */
const STILL: State = {
  title: "Seed swap",
  blocks: [
    { id: 1, kind: "heading", text: "Saturday at the library" },
    { id: 2, kind: "todo", text: "Print the seed labels" },
  ],
  query: "rec",
  active: 0,
  key: null,
  fading: false,
};

export function SlashDemo() {
  const [s, setS] = useState<State>(STILL);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current || isStill(root.current)) return;
    let alive = true;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = Boolean(e?.isIntersecting)), { threshold: 0.2 });
    if (root.current) io.observe(root.current);
    const set = (patch: Partial<State> | ((p: State) => Partial<State>)) => setS((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
    // Waits, and holds while the picture is off screen or the tab is hidden.
    const sleep = async (ms: number) => {
      let left = ms;
      while (alive && left > 0) {
        await new Promise((r) => setTimeout(r, Math.min(left, 100)));
        if (visible && !document.hidden) left -= 100;
      }
      if (!alive) throw new Error("stopped");
    };
    const press = async (key: string, ms = 380) => {
      set({ key });
      await sleep(ms);
      set({ key: null });
    };
    let id = 100;

    (async () => {
      await sleep(1200);
      for (let round = 0; ; round++) {
        const note = NOTES[round % NOTES.length]!;
        set({ fading: true, query: null });
        await sleep(450);
        set({ title: note.title, blocks: [], fading: false, active: 0 });
        await sleep(600);
        for (const scene of note.scenes) {
          await press("/", 260);
          set({ query: "", active: 0 });
          await sleep(500);
          let q = "";
          for (const ch of scene.query) {
            q += ch;
            set({ query: q, active: 0 });
            await sleep(140);
          }
          await sleep(650);
          for (let i = 0; i < (scene.downs ?? 0); i++) {
            set({ active: i + 1 });
            await press("↓", 420);
          }
          await press("↵", 300);
          const blockId = ++id;
          set((p) => ({ query: null, blocks: [...p.blocks, { id: blockId, kind: scene.kind, text: "" }] }));
          await sleep(300);
          if (scene.text) {
            for (let i = 1; i <= scene.text.length; i++) {
              const text = scene.text.slice(0, i);
              set((p) => ({ blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, text } : b)) }));
              await sleep(scene.kind === "summary" ? 22 : 45);
            }
          }
          await sleep(900);
        }
        await sleep(1800);
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, []);

  const items = s.query === null ? [] : filtered(s.query).slice(0, 6);
  // Low in the note, the menu opens above the line, as the app's does when there's no room below.
  const above = s.blocks.length >= 3;
  const label =
    "An animation of the slash menu in a Folevi note. Someone types a slash and a few letters, the menu filters to match, and they pick a block: a heading, a to-do, an audio recording, a flowchart, a callout, a date, a table and an AI summary.";

  return (
    <div ref={root} role="img" aria-label={label} className="mx-auto w-full max-w-[400px]">
      <div aria-hidden="true" className="mk-app-pop relative h-[440px] rounded-[16px] px-5 pb-5 pt-6 text-[14px] text-ink">
        <div className={cx("transition-opacity duration-300", s.fading && "opacity-0")}>
          <p className="mk-display text-[24px] text-(--color-heading)">{s.title}</p>
          <div className="mt-3 space-y-2.5">
            {s.blocks.map((b) => (
              <div key={b.id} className="mk-appear">
                <DemoBlock block={b} />
              </div>
            ))}
            <div className="relative">
              <p className="h-6 leading-6">
                {s.query !== null ? (
                  <>
                    /{s.query}
                    <Caret />
                  </>
                ) : (
                  <span className="text-faint">
                    <Caret />
                    Type / for blocks
                  </span>
                )}
              </p>
              {items.length ? (
                <ul className={cx("mk-app-pop absolute left-0 z-10 w-[250px] rounded-[12px] p-1.5 text-[13px]", above ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]")}>
                  {items.map((item, i) => (
                    <li key={item.label} className={cx("flex items-center gap-2.5 rounded-[6px] px-2 py-1.5", i === s.active ? "mk-app-row-on text-(--color-heading)" : "text-ink")}>
                      <span className="grid size-6 flex-none place-items-center rounded-[6px] bg-(--color-surface) text-(--color-heading) shadow-(--shadow-control)">{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.hint ? <span className="text-[11.5px] text-faint">{item.hint}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : s.query !== null ? (
                <p className={cx("mk-app-pop absolute left-0 z-10 rounded-[12px] px-3 py-2 text-[13px] text-muted", above ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]")}>No matches</p>
              ) : null}
            </div>
          </div>
        </div>
        {/* The key just pressed. */}
        <span
          className={cx(
            "absolute bottom-4 right-4 grid h-9 min-w-9 place-items-center rounded-[8px] bg-(--color-surface) px-2.5 text-[15px] font-semibold text-(--color-heading) shadow-[var(--shadow-control),0_6px_14px_-6px_rgb(0_0_0/0.25)] transition-all duration-150",
            s.key ? "scale-100 opacity-100" : "scale-90 opacity-0",
          )}
        >
          {s.key ?? "↵"}
        </span>
      </div>
    </div>
  );
}

function Caret() {
  return <span className="mx-px inline-block h-[17px] w-px translate-y-[3px] animate-pulse bg-(--color-heading) motion-reduce:animate-none" />;
}

function DemoBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      return <p className="min-h-6 text-[17px] font-semibold text-(--color-heading)">{block.text || <Caret />}</p>;
    case "todo":
      return (
        <p className="flex min-h-6 items-center gap-2.5">
          <span className="size-[15px] flex-none rounded-[4px] shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]" />
          <span>{block.text || <Caret />}</span>
        </p>
      );
    case "date":
      return (
        <p className="min-h-6">
          {block.text}
          <span className="rounded-[5px] bg-(--glass-hover) px-1.5 py-0.5 text-[12.5px] font-medium text-(--color-heading)">
            <CalendarDays size={11} className="mr-1 inline -translate-y-px" />
            Saturday
          </span>
        </p>
      );
    case "callout":
      return (
        <p className="flex min-h-10 gap-2 rounded-[8px] bg-[color-mix(in_oklab,#f5b43c_16%,transparent)] px-3 py-2">
          <StickyNote size={15} className="mt-[3px] flex-none text-[#b7791f]" />
          <span>{block.text || <Caret />}</span>
        </p>
      );
    case "summary":
      return (
        <div className="min-h-10 rounded-[8px] bg-[color-mix(in_oklab,#7c6cf0_10%,transparent)] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">{ai} Summary</p>
          <p className="mt-1">{block.text || <Caret />}</p>
        </div>
      );
    case "audio":
      return (
        <div className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <span className="grid size-7 flex-none place-items-center rounded-full bg-(--color-heading) text-(--color-canvas)">
            <Play size={12} className="ml-px fill-current" />
          </span>
          <span className="flex h-6 flex-1 items-center gap-[2px]">
            {[3, 6, 9, 5, 11, 7, 4, 8, 12, 6, 9, 4, 7, 10, 5, 8, 3, 6, 9, 5, 4, 7].map((h, i) => (
              <span key={i} className="w-full rounded-full bg-(--color-ink-muted)" style={{ height: `${h * 7}%` }} />
            ))}
          </span>
          <span className="text-[12px] tabular-nums text-muted">0:42</span>
        </div>
      );
    case "table":
      return (
        <div className="grid grid-cols-3 overflow-hidden rounded-[8px] text-[12.5px] shadow-[inset_0_0_0_1px_var(--color-line)]">
          {["Box", "Room", "Done", "Lamp", "Studio", "Yes", "Plan chest", "Studio", "No"].map((c, i) => (
            <span key={i} className={cx("border-(--color-line) px-2 py-1", i < 3 && "bg-(--glass-hover) font-semibold text-(--color-heading)", i % 3 !== 2 && "border-r", i < 6 && "border-b")}>
              {c}
            </span>
          ))}
        </div>
      );
    case "flowchart":
      return (
        <svg viewBox="0 0 320 64" className="h-16 w-full" fill="none">
          {[
            { x: 4, label: "Bring seeds", fill: "#e8f0ff", stroke: "#8fb0f0" },
            { x: 112, label: "Label them", fill: "#fff6d8", stroke: "#e5c45c" },
            { x: 220, label: "Swap", fill: "#e4f6ea", stroke: "#7cc497" },
          ].map((n, i) => (
            <g key={n.label}>
              <rect x={n.x} y={14} width={96} height={36} rx={i === 2 ? 18 : 8} fill={n.fill} stroke={n.stroke} strokeWidth={1.2} />
              <text x={n.x + 48} y={36.5} textAnchor="middle" fontSize={11.5} fill="#1d1d22" fontFamily="var(--font-sans)">
                {n.label}
              </text>
              {i < 2 ? <path d={`M${n.x + 98} 32h10m-4-4 4 4-4 4`} stroke="#8a8a93" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" /> : null}
            </g>
          ))}
        </svg>
      );
  }
}
