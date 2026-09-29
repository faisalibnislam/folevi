"use client";

import { ArrowUpRight, FileText } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../icons";
import { cx } from "../ui";
import { DemoCard, LiveRegion } from "./DemoCard";

type PageId = "seed" | "reading" | "studio";
type Segment = { kind: "text"; text: string } | { kind: "link"; page: PageId };

const PAGES: Record<PageId, { title: string; staticBacklinks: string[] }> = {
  seed: { title: "Seed library", staticBacklinks: ["Planting calendar"] },
  reading: { title: "Reading list", staticBacklinks: [] },
  studio: { title: "Studio move", staticBacklinks: ["Weekly review"] },
};
const PAGE_IDS: PageId[] = ["seed", "reading", "studio"];
const SOURCE = "Thursday notes";

const INITIAL: Segment[][] = [
  [{ kind: "text", text: "The printer can do the seed labels by Friday. Details in " }, { kind: "link", page: "seed" }, { kind: "text", text: "." }],
];

function linkedPages(paragraphs: Segment[][]): Set<PageId> {
  const set = new Set<PageId>();
  for (const p of paragraphs) for (const s of p) if (s.kind === "link") set.add(s.page);
  return set;
}

function plain(segments: Segment[]): string {
  return segments.map((s) => (s.kind === "text" ? s.text : PAGES[s.page].title)).join("");
}

export function ConnectDemo() {
  const baseId = useId();
  const listId = `${baseId}-pages`;
  const [paragraphs, setParagraphs] = useState<Segment[][]>(INITIAL);
  const [current, setCurrent] = useState<Segment[]>([]);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [message, setMessage] = useState("");
  const [fresh, setFresh] = useState<PageId | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trigger = draft.lastIndexOf("[[");
  const query = trigger >= 0 && !draft.slice(trigger).includes("]]") ? draft.slice(trigger + 2) : null;
  const options = useMemo(
    () => (query === null ? [] : PAGE_IDS.filter((id) => PAGES[id].title.toLowerCase().includes(query.trim().toLowerCase()))),
    [query],
  );
  const open = focused && query !== null && !dismissed && options.length > 0;
  const active = options[Math.min(activeIndex, options.length - 1)];

  const all = [...paragraphs, current];
  const links = linkedPages(all);
  const snippetFor = (page: PageId) => {
    const p = all.find((segments) => segments.some((s) => s.kind === "link" && s.page === page));
    return p ? plain(p) : "";
  };

  const choose = (page: PageId) => {
    const before = draft.slice(0, trigger);
    setCurrent((segments) => [...segments, ...(before ? [{ kind: "text" as const, text: before }] : []), { kind: "link", page }]);
    setDraft("");
    setFresh(page);
    setMessage(`Linked to ${PAGES[page].title}. A backlink from ${SOURCE} now appears on ${PAGES[page].title}.`);
    inputRef.current?.focus();
  };

  const commitParagraph = () => {
    const segments: Segment[] = [...current, ...(draft ? [{ kind: "text" as const, text: draft }] : [])];
    if (segments.length === 0) return;
    setParagraphs((ps) => [...ps, segments].slice(-4));
    setCurrent([]);
    setDraft("");
    setMessage("New paragraph.");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((i) => (Math.min(i, options.length - 1) + delta + options.length) % options.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && active) {
        event.preventDefault();
        choose(active);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitParagraph();
    } else if (event.key === "Backspace" && draft === "" && current.length > 0) {
      event.preventDefault();
      const last = current[current.length - 1]!;
      setCurrent((segments) => segments.slice(0, -1));
      if (last.kind === "link") setMessage(`Removed the link to ${PAGES[last.page].title}.`);
      else setDraft(last.text);
    }
  };

  const reset = () => {
    setParagraphs(INITIAL);
    setCurrent([]);
    setDraft("");
    setFresh(null);
    setMessage("Demo reset.");
  };

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:gap-4">
      <DemoCard title={SOURCE} onReset={reset} clip={false}>
        <div className="space-y-3 px-5 pb-5 pt-4 text-[15px] leading-[1.7] text-ink">
          {paragraphs.map((segments, i) => (
            <p key={i}>
              <Segments segments={segments} />
            </p>
          ))}
          <div className="relative">
            <div
              className={cx(
                "flex min-h-11 flex-wrap items-center gap-x-1 rounded-[6px] border border-dashed px-3 py-1 transition-colors duration-150",
                focused ? "border-(--color-ink-faint) bg-(--color-surface-sunken)" : "border-line-strong",
              )}
              onClick={() => inputRef.current?.focus()}
            >
              <Segments segments={current} />
              <label htmlFor={`${baseId}-input`} className="sr-only">
                Keep writing. Type two opening square brackets to link a page.
              </label>
              <input
                ref={inputRef}
                id={`${baseId}-input`}
                type="text"
                role="combobox"
                autoComplete="off"
                spellCheck={false}
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={open && active ? `${baseId}-opt-${active}` : undefined}
                value={draft}
                placeholder={current.length ? "" : "Keep writing… type [[ to link"}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.lastIndexOf("[[") !== draft.lastIndexOf("[[")) setDismissed(false);
                  setActiveIndex(0);
                  setDraft(value);
                }}
                onKeyDown={onKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className="h-9 min-w-[10ch] flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
              />
            </div>
            <ul
              id={listId}
              role="listbox"
              aria-label="Pages"
              hidden={!open}
              className="mk-card mk-appear absolute left-0 z-10 mt-1.5 w-[min(260px,100%)] p-1.5 shadow-(--shadow-pop)"
            >
              <li role="presentation" className="mk-caps px-2 pb-1 pt-0.5">
                Link to page
              </li>
              {options.map((id) => {
                const selected = id === active;
                return (
                  <li
                    key={id}
                    id={`${baseId}-opt-${id}`}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(id)}
                    onMouseMove={() => setActiveIndex(options.indexOf(id))}
                    className={cx("flex h-10 cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-[14px]", selected ? "bg-(--color-surface-sunken) text-(--color-heading)" : "text-ink")}
                  >
                    <FileText size={14} aria-hidden="true" className="shrink-0 text-muted" />
                    {PAGES[id].title}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </DemoCard>

      <ul className="grid content-start gap-2.5" aria-label="Pages and their backlinks">
        {PAGE_IDS.map((id) => {
          const page = PAGES[id];
          const linked = links.has(id);
          const count = page.staticBacklinks.length + (linked ? 1 : 0);
          return (
            <li key={id} className={cx("mk-card px-4 py-3 transition-shadow duration-200", linked && "shadow-[var(--shadow-card),0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_30%,transparent)]")}>
              <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <FileText size={14} aria-hidden="true" className="shrink-0 text-muted" />
                {page.title}
                <span className="ml-auto text-[11.5px] font-normal text-muted">
                  {count} backlink{count === 1 ? "" : "s"}
                </span>
              </p>
              {count > 0 ? (
                <ul className="mt-2 space-y-1 border-t mk-hair pt-2" aria-label={`Backlinks to ${page.title}`}>
                  {linked ? (
                    <li key={`${id}-${fresh === id ? "fresh" : "static"}`} className={cx("rounded-[4px] px-1.5 py-1 text-[12.5px]", fresh === id && "mk-appear mk-flash")}>
                      <span className="flex items-center gap-1.5 font-medium text-(--color-heading)">
                        <Icon name="link" size={12} /> {SOURCE}
                      </span>
                      <span className="line-clamp-1 text-muted">{snippetFor(id)}</span>
                    </li>
                  ) : null}
                  {page.staticBacklinks.map((source) => (
                    <li key={source} className="flex items-center gap-1.5 px-1.5 py-0.5 text-[12.5px] text-muted">
                      <Icon name="link" size={12} /> {source}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[12.5px] text-faint">No backlinks yet</p>
              )}
            </li>
          );
        })}
      </ul>
      <LiveRegion message={message} />
    </div>
  );
}

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === "text" ? (
          <span key={i} className="whitespace-pre-wrap">
            {segment.text}
          </span>
        ) : (
          <span
            key={i}
            className="mx-0.5 inline-flex items-center gap-0.5 align-baseline text-[15px] font-medium text-(--color-heading) underline decoration-(--color-line-strong) underline-offset-[3px]"
          >
            <ArrowUpRight size={13} aria-hidden="true" className="shrink-0 text-muted" />
            {PAGES[segment.page].title}
          </span>
        ),
      )}
    </>
  );
}
