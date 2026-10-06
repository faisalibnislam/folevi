"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Archive, ArrowUp, Asterisk, Bell, CheckSquare, Ellipsis, FileText, Files, House, Info, LayoutTemplate, MessageSquare, Paintbrush, PanelLeft, Plus, Search, Share2, Star, Type, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { TemplateTile } from "@/components/ui/TemplateIcon";
import { COVER_ART, type CoverArt } from "@/lib/cover";
import type { StarterPage } from "@/lib/onboarding";

/*
 * The live preview beside onboarding: a miniature of the person's own Folevi (the app's glass chrome, the
 * page sidebar, the tab strip, Home or their Welcome page, the page tools dock), rebuilt in HTML so it
 * follows the theme and updates as they choose. An illustration only: nothing in it is a control.
 */

const ART_BY_ID = new Map(COVER_ART.map((a) => [a.id, a]));
export const artOf = (id: string | null | undefined): CoverArt | null => (id ? (ART_BY_ID.get(id) ?? null) : null);
export const artThumb = (id: string) => `url("/covers/${id}-thumb.webp")`;
const artLarge = (id: string) => `image-set(url("/covers/${id}-thumb.webp") 1x, url("/covers/${id}-1x.webp") 2x)`;

/** CSS variables that colour a note like the editor does for a style (editor.css, data-sheet="art"). */
function noteVars(art: CoverArt | null): CSSProperties {
  if (!art) return {};
  const vars: Record<string, string> = { "--art-paper": art.paper, "--art-ink": art.ink, "--art-paper-dark": art.paperDark, "--art-ink-dark": art.inkDark };
  if (art.accent) vars["--art-accent"] = art.accent;
  if (art.accentDark) vars["--art-accent-dark"] = art.accentDark;
  if (art.highlight?.[2]) vars["--art-hl"] = art.highlight[2];
  if (art.highlightDark?.[2]) vars["--art-hl-dark"] = art.highlightDark[2];
  return vars as CSSProperties;
}

/** Every art id shown so far, so a change cross-fades from the last one instead of popping. */
function useSeen(ids: (string | null)[]): string[] {
  const key = ids.filter(Boolean).join(",");
  const [seen, setSeen] = useState<string[]>(() => (key ? [...new Set(key.split(","))] : []));
  useEffect(() => {
    const next = key ? key.split(",") : [];
    setSeen((prev) => (next.every((id) => prev.includes(id)) ? prev : [...new Set([...prev, ...next])]));
  }, [key]);
  return seen;
}

/** Scales a fixed-size drawing to fit its container (kept crisp: the drawing is laid out at full size). */
function useFit(base: { w: number; h: number }, pad: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setScale(Math.max(0.2, Math.min((r.width - pad * 2) / base.w, (r.height - pad * 2) / base.h, 1.1)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [base.w, base.h, pad]);
  return { ref, scale };
}

export type PreviewScene = "deck" | "home" | "note";

export interface PreviewProps {
  scene: PreviewScene;
  /** The Welcome page's style (null: Plain). */
  styleId: string | null;
  /** Colour behind everything on the stage (a use case being picked, or the Welcome page's style). */
  ambientId: string | null;
  pages: StarterPage[];
  ai: boolean;
  highlight: "style" | "ai" | null;
  finished: boolean;
  name: string;
  compact?: boolean;
  label: string;
}

const DECK = [
  { id: "art-39", x: -250, y: 36, r: -13 },
  { id: "art-30", x: -126, y: 10, r: -6.5 },
  { id: "art-01", x: 126, y: 10, r: 6.5 },
  { id: "art-49", x: 250, y: 36, r: 13 },
  { id: "art-03", x: 0, y: -4, r: 0 },
];

const SEED_PAGES = ["Field Notes: A Quiet Morning", "Project Atlas Brief", "Trip Sketch: Coastal Weekend", "Reading Shelf"];

export function OnboardingPreview(props: PreviewProps) {
  const { scene, ambientId, compact = false, label } = props;
  const seen = useSeen([ambientId, props.styleId]);
  const winBase = compact ? { w: 640, h: 470 } : { w: 920, h: 740 };
  const win = useFit(winBase, compact ? 10 : 36);
  const deck = useFit({ w: 720, h: 470 }, compact ? 4 : 30);
  return (
    <div role="img" aria-label={label} className="ob-stage h-full w-full">
      <div aria-hidden="true" className="absolute inset-0">
        {seen.map((id) => (
          <div key={id} className="ob-stage-art" data-on={id === ambientId} style={{ ["--ob-art" as string]: artThumb(id) }} />
        ))}
        <div ref={deck.ref} className="ob-scene" data-scene="deck" data-on={scene === "deck"}>
          <div className="ob-win-fit" style={{ width: 720, height: 470, ["--ob-scale" as string]: deck.scale }}>
            {DECK.map((card, i) => {
              const art = artOf(card.id)!;
              return (
                <div key={card.id} className="ob-deck-card" style={{ ["--x" as string]: `${card.x}px`, ["--y" as string]: `${card.y}px`, ["--r" as string]: `${card.r}deg`, ["--i" as string]: i, zIndex: i === 4 ? 5 : i < 2 ? i : 4 - i }}>
                  <div className="ob-art" style={{ ["--ob-art" as string]: artLarge(card.id) }} />
                  <div className={`absolute inset-x-0 bottom-0 flex h-16 flex-col justify-center px-4 ${card.x > 0 ? "items-end text-right" : ""}`} style={{ background: art.paper, color: art.ink }}>
                    <p className="font-[family-name:var(--font-display)] text-[19px] font-semibold leading-tight">{art.name}</p>
                    <p className="text-[11.5px] opacity-70">Note style</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div ref={win.ref} className="ob-scene" data-scene="app" data-on={scene !== "deck"}>
          <div className="ob-win-fit" style={{ width: winBase.w, height: winBase.h, ["--ob-scale" as string]: win.scale }}>
            <Window {...props} seen={seen} base={winBase} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Window({ scene, styleId, pages, ai, highlight, finished, name, compact, seen, base }: PreviewProps & { seen: string[]; base: { w: number; h: number } }) {
  const art = artOf(styleId);
  const note = scene === "note";
  return (
    <div className="ob-win" data-lift={finished} style={{ width: base.w, height: base.h }}>
      {seen.map((id) => (
        <div key={id} className="ob-win-ambient" data-on={note && id === styleId} style={{ ["--ob-art" as string]: artThumb(id) }} />
      ))}
      {finished ? <div className="ob-sheen" /> : null}
      <div className="flex h-full gap-2 p-2">
        {compact ? null : <Sidebar pages={pages} note={note} name={name} />}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Tabs note={note} compact={compact} />
          <div className="relative min-h-0 flex-1">
            <div className="ob-view" data-on={!note}>
              <Home pages={pages} art={art} ai={ai} compact={compact} />
            </div>
            <div className="ob-view" data-on={note}>
              <NotePage art={art} styleId={styleId} seen={seen} ai={ai} highlight={highlight} compact={compact} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ pages, note, name }: { pages: StarterPage[]; note: boolean; name: string }) {
  const rows = [
    { icon: House, label: "Home" },
    { icon: Star, label: "Starred" },
    { icon: Files, label: "All notes" },
    { icon: CheckSquare, label: "Tasks" },
    { icon: LayoutTemplate, label: "Templates" },
  ];
  return (
    <div className="flex w-[228px] flex-none flex-col">
      <div className="flex h-10 flex-none items-center gap-1 px-2">
        <FoleviLogo height={22} title={null} className="flex-none text-heading" />
        <span className="flex-1" />
        <span className="grid size-7 place-items-center text-muted">
          <Bell size={15} />
        </span>
        <span className="grid size-7 place-items-center text-muted">
          <PanelLeft size={15} />
        </span>
      </div>
      <div className="ob-well mx-1 mt-1 flex h-8 items-center gap-2 rounded-[6px] pl-2.5 pr-1.5 text-[12px] text-muted">
        <Search size={13} />
        <span className="flex-1 truncate">Search or jump to…</span>
        <span className="rounded-[5px] bg-raised px-1 text-[10px] font-semibold leading-[18px] shadow-[0_0_0_1px_var(--color-line)]">⌘K</span>
      </div>
      <ul className="mt-3 space-y-0.5 px-1">
        {rows.map(({ icon: RowIcon, label }) => (
          <li key={label} className={`flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px] ${label === "Home" && !note ? "ob-row-on" : "text-ink"}`}>
            <RowIcon size={15} className={label === "Home" && !note ? "text-heading" : "text-muted"} />
            <span className="truncate">{label}</span>
          </li>
        ))}
      </ul>
      <p className="ui-caps mt-4 px-3.5 text-[10.5px]">Pages</p>
      <ul className="relative mt-1 min-h-0 flex-1 space-y-0.5 overflow-hidden px-1 [mask-image:linear-gradient(black_78%,transparent)]">
        <li className={`flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px] ${note ? "ob-row-on" : "text-ink"}`}>
          <FileText size={14} className={note ? "text-heading" : "text-muted"} />
          <span className="truncate">Welcome to Folevi</span>
        </li>
        {pages.map((page, i) => (
          <li key={page.template} className="ob-arrive flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px] text-ink" style={{ ["--i" as string]: i % 2 }}>
            <TemplateTile name={page.icon} size={18} iconSize={11} className="!rounded-[5px]" />
            <span className="truncate">{page.title}</span>
          </li>
        ))}
        {SEED_PAGES.map((title) => (
          <li key={title} className="flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px] text-ink">
            <FileText size={14} className="text-muted" />
            <span className="truncate">{title}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-2 space-y-0.5 px-1">
        <li className="flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px] text-ink">
          <Archive size={15} className="text-muted" /> Archive
        </li>
      </ul>
      <div className="flex flex-none items-center gap-2.5 px-2 pb-1 pt-2">
        <span className="grid size-7 flex-none place-items-center rounded-full bg-heading text-[11px] font-semibold text-canvas">{name.trim().slice(0, 1).toUpperCase() || "F"}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-semibold text-heading">{name}</span>
          <span className="block truncate text-[11px] text-muted">Personal</span>
        </span>
      </div>
    </div>
  );
}

function Tabs({ note, compact }: { note: boolean; compact?: boolean }) {
  return (
    <div className="ob-glass flex h-11 flex-none items-center gap-1.5 rounded-[12px] px-1.5">
      <span className="grid size-8 flex-none place-items-center text-muted">{compact ? <PanelLeft size={15} /> : <ArrowUp size={15} />}</span>
      <span className="h-5 w-px flex-none bg-line-strong opacity-60" />
      <span className="ob-tab flex-none" data-on={!note}>
        <House size={13} /> Home
      </span>
      <span className="ob-tab min-w-0 flex-[0_1_220px]" data-on={note}>
        <FileText size={13} className="flex-none opacity-70" />
        <span className="min-w-0 flex-1 truncate">Welcome to Folevi</span>
        <X size={11} className="flex-none text-faint" />
      </span>
      <span className="flex-1" />
      <span className="ui-btn ui-btn-primary h-8 flex-none gap-1.5 px-3 text-[12.5px]">
        <Plus size={14} /> New note
      </span>
    </div>
  );
}

function Home({ pages, art, ai, compact }: { pages: StarterPage[]; art: CoverArt | null; ai: boolean; compact?: boolean }) {
  const cols = compact ? 2 : 3;
  const seeds = SEED_PAGES.slice(0, Math.max(0, cols * 2 - 1 - pages.length));
  return (
    <div className="ob-content absolute inset-0 overflow-hidden rounded-[14px] px-8 pt-7">
      <p className="ui-display text-[30px] leading-none">Home</p>
      <div className={`mt-4 flex h-9 w-fit items-center gap-2 rounded-[8px] bg-[var(--glass-active)] px-3.5 text-[12.5px] font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)] transition-opacity duration-500 ${ai ? "" : "opacity-0"}`}>
        <AiIcon size={14} /> Catch me up
      </div>
      <p className="ui-caps mt-6 text-[10.5px]">Recent notes</p>
      <ul className={`mt-2.5 grid gap-3 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {pages.slice(0, cols * 2 - 1).map((page, i) => (
          <li key={page.template} className="ob-arrive h-[132px]" style={{ ["--i" as string]: i % 2 }}>
            <div className="ob-note flex h-full flex-col rounded-[8px] px-4 py-3.5 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2">
                <TemplateTile name={page.icon} size={24} iconSize={13} className="!rounded-[6px]" />
                <span className="text-[11px] text-muted">Just now</span>
              </div>
              <p className="ob-note-h mt-2.5 truncate text-[16px]">{page.title}</p>
              <span className="mt-2.5 block h-1.5 w-4/5 rounded-full bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]" />
              <span className="mt-1.5 block h-1.5 w-3/5 rounded-full bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]" />
            </div>
          </li>
        ))}
        <li className="h-[132px]">
          <div className="ob-note grid h-full grid-cols-[14px_minmax(0,1fr)] overflow-hidden rounded-[8px] shadow-[var(--shadow-card)]" style={noteVars(art)}>
            <span className="transition-[background] duration-500" style={{ background: art ? `${artThumb(art.id)} center / cover no-repeat` : "var(--color-surface-sunken)" }} />
            <div className="min-w-0 px-4 py-3.5">
              <p className="ob-note-h truncate text-[16px]">Welcome to Folevi</p>
              <p className="ob-note-muted mt-0.5 text-[11px]">{art ? art.name : "Plain"}</p>
              <p className="mt-2 line-clamp-2 text-[11.5px] leading-[1.45]">A quiet place for ideas that keep growing.</p>
            </div>
          </div>
        </li>
        {seeds.map((title) => (
          <li key={title} className="h-[132px]">
            <div className="ob-note flex h-full flex-col rounded-[8px] px-4 py-3.5 shadow-[var(--shadow-card)]">
              <p className="ob-note-h line-clamp-2 text-[16px] leading-snug">{title}</p>
              <span className="mt-auto block h-1.5 w-4/5 rounded-full bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]" />
              <span className="mt-1.5 block h-1.5 w-3/5 rounded-full bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotePage({ art, styleId, seen, ai, highlight, compact }: { art: CoverArt | null; styleId: string | null; seen: string[]; ai: boolean; highlight: "style" | "ai" | null; compact?: boolean }) {
  return (
    <div className="ob-page">
      {seen.map((id) => (
        <div key={id} className="ob-page-art" data-on={id === styleId} style={{ ["--ob-art" as string]: artLarge(id) }} />
      ))}
      <article className={`ob-note absolute inset-x-0 top-5 mx-auto overflow-hidden ${compact ? "w-[88%]" : "w-[620px]"}`} style={{ ...noteVars(art), bottom: -16 }}>
        <div className="ob-note-cover" style={{ height: art ? (compact ? 110 : 150) : 0 }}>
          {seen.map((id) => (
            <div key={id} className="ob-note-cover-art" data-on={id === styleId} style={{ ["--ob-art" as string]: artLarge(id) }} />
          ))}
        </div>
        <div className={`${compact ? "px-6" : "px-12"} pb-24 ${art ? "pt-5" : "pt-9"} text-[13.5px] leading-[1.6]`} style={{ fontFamily: "var(--font-serif)" }}>
          <p className={`ob-note-title ${compact ? "text-[26px]" : "text-[34px]"}`}>Welcome to Folevi</p>
          <p className="mt-3">Folevi is a quiet place for ideas that keep growing. Start with a loose thought, give it shape when you are ready, and find it again when you need it.</p>
          <p className="ob-note-callout mt-3 flex gap-2.5 px-3.5 py-2.5">
            <Asterisk size={14} className="ob-note-accent mt-[3px] flex-none" />
            <span>Everything you type here is saved as you go.</span>
          </p>
          <p className="ob-note-h mt-4 text-[19px]">Capture in three seconds</p>
          <p className="mt-1.5 flex gap-2">
            <span className="ob-note-accent">•</span>
            <span>
              Type <span className="ob-note-accent font-sans font-semibold">/</span> on an empty line for headings, checklists and tables.
            </span>
          </p>
          <p className="mt-1 flex gap-2">
            <span className="ob-note-accent">•</span>
            <span>
              Type <span className="ob-note-accent font-sans font-semibold">[[</span> to link to another page.
            </span>
          </p>
          <p className="ob-note-h mt-4 text-[19px]">Try these</p>
          <p className="mt-1.5 flex items-center gap-2.5">
            <span className="ob-note-check" />
            Add a task with Quick Add
          </p>
          <p className="mt-1 flex items-center gap-2.5">
            <span className="ob-note-check" data-checked="true">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="ob-note-muted line-through">Open Folevi for the first time</span>
          </p>
        </div>
      </article>
      <AskPanel on={ai && highlight === "ai"} compact={compact} />
      <Dock ai={ai} highlight={highlight} compact={compact} />
    </div>
  );
}

function Dock({ ai, highlight, compact }: { ai: boolean; highlight: "style" | "ai" | null; compact?: boolean }) {
  const items = [
    {
      id: "ai",
      label: "AI",
      icon: (
        <span className="ob-ai-mark grid place-items-center" data-on={ai}>
          <AiIcon size={14} />
        </span>
      ),
    },
    { id: "insert", label: "Insert", icon: <Plus size={14} /> },
    { id: "format", label: "Format", icon: <Type size={14} /> },
    { id: "style", label: "Style", icon: <Paintbrush size={14} /> },
    { id: "info", label: "Info", icon: <Info size={14} /> },
  ];
  return (
    <div className="ob-pop absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[12px] p-1">
      {items.map((item) => {
        const hidden = item.id === "ai" && !ai;
        return (
          <span
            key={item.id}
            className={`flex h-8 items-center gap-1.5 overflow-hidden rounded-[8px] text-[12.5px] font-medium transition-all duration-500 ${hidden ? "max-w-0 px-0 opacity-0" : "max-w-[100px] px-2.5"} ${highlight === item.id ? "ob-dock-on" : "text-ink"}`}
          >
            {item.icon}
            <span className={compact && highlight !== item.id ? "hidden" : ""}>{item.label}</span>
          </span>
        );
      })}
      {compact ? null : (
        <>
          <span className="mx-1 h-5 w-px bg-line-strong opacity-60" />
          <span className="grid size-8 place-items-center text-ink">
            <MessageSquare size={14} />
          </span>
          <span className="grid size-8 place-items-center text-ink">
            <Share2 size={14} />
          </span>
        </>
      )}
      <span className="grid size-8 place-items-center text-ink">
        <Ellipsis size={14} />
      </span>
    </div>
  );
}

/** The Ask AI panel, floating above the dock, with one question and its answer. */
function AskPanel({ on, compact }: { on: boolean; compact?: boolean }) {
  return (
    <div className={`ob-ai-pop ob-pop absolute bottom-16 flex flex-col overflow-hidden rounded-[16px] text-[12.5px] ${compact ? "inset-x-4" : "right-6 w-[330px]"}`} data-on={on}>
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <AiIcon size={15} />
        <p className="flex-1 text-[13.5px] font-semibold text-heading">Ask AI</p>
        <X size={14} className="text-muted" />
      </div>
      <div className="space-y-2 px-3.5 py-3">
        <p className="ml-auto w-fit max-w-[85%] rounded-[12px] rounded-br-[4px] bg-heading px-3 py-1.5 text-canvas">What should I try first?</p>
        <div className="rounded-[12px] rounded-bl-[4px] bg-[var(--glass-active)] px-3 py-2.5 leading-relaxed text-ink shadow-[var(--glass-edge)]">
          <p>Start with the Try these list on your Welcome page: add a task with Quick Add, then give it a due date.</p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--glass-hover)] px-2 py-0.5">
              <FileText size={11} /> Welcome to Folevi
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
