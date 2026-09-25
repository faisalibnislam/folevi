"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { StatusPill } from "../mini";
import { cx } from "../ui";
import { DemoCard, LiveRegion } from "./DemoCard";

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "todo" | "bulleted" | "quote" | "callout";
type Block = { id: number; type: BlockType; text: string; checked?: boolean };

const OPTIONS: Array<{ type: BlockType; label: string; glyph: string; keys?: string; aliases: string[] }> = [
  { type: "paragraph", label: "Text", glyph: "T", aliases: ["text", "paragraph", "plain"] },
  { type: "h1", label: "Heading 1", glyph: "H1", keys: "⌥⌘1", aliases: ["h1", "heading", "title"] },
  { type: "h2", label: "Heading 2", glyph: "H2", keys: "⌥⌘2", aliases: ["h2", "heading", "subheading"] },
  { type: "h3", label: "Heading 3", glyph: "H3", keys: "⌥⌘3", aliases: ["h3", "heading"] },
  { type: "todo", label: "Checklist", glyph: "☐", keys: "⇧⌘8", aliases: ["todo", "task", "check", "checkbox"] },
  { type: "bulleted", label: "Bulleted list", glyph: "•", aliases: ["bullet", "list", "ul"] },
  { type: "quote", label: "Quote", glyph: "❝", aliases: ["quote", "blockquote"] },
  { type: "callout", label: "Callout", glyph: "💡", aliases: ["callout", "note", "info"] },
];

const LABEL: Record<BlockType, string> = Object.fromEntries(OPTIONS.map((o) => [o.type, o.label])) as Record<BlockType, string>;

const PLACEHOLDER: Record<BlockType, string> = {
  paragraph: "Type “/” for blocks…",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  todo: "To-do",
  bulleted: "List item",
  quote: "Quote",
  callout: "Callout",
};

const INITIAL: Block[] = [
  { id: 1, type: "h2", text: "Train notes" },
  { id: 2, type: "paragraph", text: "Ideas show up between stations. Write them down before the doors close." },
  { id: 3, type: "todo", text: "Sketch the reading nook", checked: false },
];

const typeText: Record<BlockType, string> = {
  paragraph: "text-[15px] leading-[1.6]",
  h1: "text-[24px] font-semibold leading-tight tracking-[-0.01em]",
  h2: "text-[19px] font-semibold leading-snug",
  h3: "text-[16px] font-semibold leading-snug",
  todo: "text-[15px] leading-[1.6]",
  bulleted: "text-[15px] leading-[1.6]",
  quote: "text-[15px] leading-[1.6] italic",
  callout: "text-[14.5px] leading-[1.55]",
};

function matches(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return OPTIONS;
  return OPTIONS.filter((o) => o.label.toLowerCase().startsWith(q) || o.label.toLowerCase().split(" ").some((w) => w.startsWith(q)) || o.aliases.some((a) => a.startsWith(q)));
}

export function CaptureDemo() {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [blocks, setBlocks] = useState<Block[]>(INITIAL);
  const [draft, setDraft] = useState("");
  const [draftType, setDraftType] = useState<BlockType>("paragraph");
  const [dismissed, setDismissed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [message, setMessage] = useState("");
  const nextId = useRef(10);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = draft.startsWith("/") ? draft.slice(1) : null;
  const options = useMemo(() => (query === null ? [] : matches(query)), [query]);
  const open = focused && query !== null && !dismissed && options.length > 0;
  const active = options[Math.min(activeIndex, options.length - 1)];

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks.length]);

  const choose = (type: BlockType) => {
    setDraftType(type);
    setDraft("");
    setMessage(`Line turned into ${LABEL[type]}. Keep typing, then press Enter.`);
    inputRef.current?.focus();
  };

  const commit = () => {
    const text = draft.trim();
    if (!text) return;
    const block: Block = { id: nextId.current++, type: draftType, text, ...(draftType === "todo" ? { checked: false } : {}) };
    setBlocks((current) => [...current, block].slice(-8));
    setDraft("");
    const continues = draftType === "todo" || draftType === "bulleted";
    if (!continues) setDraftType("paragraph");
    setMessage(`Added ${LABEL[draftType]}: ${text}.`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((i) => (Math.min(i, options.length - 1) + delta + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (active) {
          event.preventDefault();
          choose(active.type);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        setMessage("Block menu closed.");
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && draft === "" && draftType !== "paragraph") {
      event.preventDefault();
      setDraftType("paragraph");
      setMessage("Turned back into text.");
    }
  };

  const reset = () => {
    setBlocks(INITIAL);
    setDraft("");
    setDraftType("paragraph");
    setMessage("Demo reset.");
  };

  return (
    <DemoCard title="Train notes" icon="🚆" meta={<StatusPill status="Saved" />} onReset={reset} clip={false}>
      <div ref={scroller} className="max-h-[300px] min-h-[228px] space-y-2 overflow-y-auto px-5 pb-2 pt-5 sm:px-6">
        {blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            onToggle={() =>
              setBlocks((current) => current.map((b) => (b.id === block.id ? { ...b, checked: !b.checked } : b)))
            }
          />
        ))}
      </div>
      <div className="relative px-5 pb-5 sm:px-6">
        <div
          className={cx(
            "flex min-h-11 items-center gap-2.5 rounded-[8px] border border-dashed px-3 transition-colors duration-150",
            focused ? "border-moss bg-moss-soft/40" : "border-line-strong",
            draftType === "quote" && "border-l-2 border-l-ink",
            draftType === "callout" && "bg-moss-soft",
          )}
        >
          <DraftPrefix type={draftType} />
          <label htmlFor={`${baseId}-input`} className="sr-only">
            New block. Type slash to choose a block type.
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
            aria-activedescendant={open && active ? `${baseId}-opt-${active.type}` : undefined}
            aria-describedby={`${baseId}-kind`}
            value={draft}
            placeholder={PLACEHOLDER[draftType]}
            onChange={(event) => {
              const value = event.target.value;
              if (value.startsWith("/") && !draft.startsWith("/")) setDismissed(false);
              setActiveIndex(0);
              setDraft(value);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className={cx(
              "h-11 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint",
              typeText[draftType],
              "leading-normal",
            )}
          />
          <span id={`${baseId}-kind`} className="shrink-0 rounded-[5px] bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-muted">
            {LABEL[draftType]}
          </span>
        </div>

        <ul
          id={listId}
          role="listbox"
          aria-label="Block types"
          hidden={!open}
          className="mk-card mk-appear absolute left-5 z-10 mt-1.5 max-h-[248px] w-[min(280px,calc(100%-2.5rem))] overflow-y-auto p-1.5 sm:left-6"
        >
          {options.map((option) => {
            const selected = option.type === active?.type;
            return (
              <li
                key={option.type}
                id={`${baseId}-opt-${option.type}`}
                role="option"
                aria-selected={selected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.type)}
                onMouseMove={() => setActiveIndex(options.indexOf(option))}
                className={cx(
                  "flex h-10 cursor-pointer items-center gap-3 rounded-[7px] px-2 text-[14px]",
                  selected ? "bg-moss-soft text-moss-ink" : "text-ink",
                )}
              >
                <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-[6px] border mk-hair bg-surface text-[12px] font-semibold">
                  {option.glyph}
                </span>
                <span className="flex-1">{option.label}</span>
                {option.keys ? <span className="text-[12px] text-muted">{option.keys}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
      <LiveRegion message={message} />
    </DemoCard>
  );
}

function DraftPrefix({ type }: { type: BlockType }) {
  if (type === "todo") return <span aria-hidden="true" className="size-[16px] shrink-0 rounded-[4px] border border-line-strong bg-raised" />;
  if (type === "bulleted") return <span aria-hidden="true" className="size-[6px] shrink-0 rounded-full bg-ink/70" />;
  if (type === "callout") return <span aria-hidden="true">💡</span>;
  return null;
}

function BlockView({ block, onToggle }: { block: Block; onToggle: () => void }) {
  const text = cx("text-ink", typeText[block.type]);
  switch (block.type) {
    case "h1":
    case "h2":
    case "h3":
      return <p className={cx(text, "mk-appear pt-1")}>{block.text}</p>;
    case "todo":
      return (
        <label className="mk-appear flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={Boolean(block.checked)}
            onChange={onToggle}
            className="mt-[5px] size-[16px] shrink-0 accent-[var(--color-accent)]"
          />
          <span className={cx(text, block.checked && "text-faint line-through")}>{block.text}</span>
        </label>
      );
    case "bulleted":
      return (
        <p className={cx(text, "mk-appear flex items-start gap-3")}>
          <span aria-hidden="true" className="mt-[10px] size-[6px] shrink-0 rounded-full bg-ink/70" />
          <span>{block.text}</span>
        </p>
      );
    case "quote":
      return <blockquote className={cx(text, "mk-appear border-l-2 border-ink/70 pl-3")}>{block.text}</blockquote>;
    case "callout":
      return (
        <p className={cx(text, "mk-appear flex gap-2 rounded-[8px] bg-moss-soft px-3 py-2 text-moss-ink")}>
          <span aria-hidden="true">💡</span>
          <span>{block.text}</span>
        </p>
      );
    default:
      return <p className={cx(text, "mk-appear")}>{block.text}</p>;
  }
}
