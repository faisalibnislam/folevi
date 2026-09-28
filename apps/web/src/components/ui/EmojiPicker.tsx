"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useLocalStorage } from "@/lib/hooks/useEngine";

interface Emoji {
  unicode: string;
  label: string;
  tags?: string[];
  group?: number;
  order?: number;
}

// Unicode emoji groups (emojibase); 2 is skin-tone components, which aren't picked on their own.
const GROUPS: { id: number; name: string; icon: string }[] = [
  { id: 0, name: "Smileys & emotion", icon: "😀" },
  { id: 1, name: "People & body", icon: "👋" },
  { id: 3, name: "Animals & nature", icon: "🌿" },
  { id: 4, name: "Food & drink", icon: "🍋" },
  { id: 5, name: "Travel & places", icon: "✈️" },
  { id: 6, name: "Activities", icon: "⚽️" },
  { id: 7, name: "Objects", icon: "💡" },
  { id: 8, name: "Symbols", icon: "❤️" },
  { id: 9, name: "Flags", icon: "🏳️" },
];

let cache: Promise<Emoji[]> | null = null;
/** All standard emoji (loaded once, on first open — the list is ~570 KB). */
function loadEmoji(): Promise<Emoji[]> {
  cache ??= import("emojibase-data/en/compact.json").then((m) =>
    ((m.default ?? m) as unknown as Emoji[]).filter((e) => e.group !== undefined && e.group !== 2).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  );
  return cache;
}

/**
 * Every standard emoji, searchable by name and keywords, grouped by category with a Recent row.
 * Choosing one calls onPick; there's intentionally no "remove" (notes always have an icon).
 */
export function EmojiPicker({ onPick, label = "Choose an icon" }: { onPick: (emoji: string) => void; label?: string }) {
  const [all, setAll] = useState<Emoji[] | null>(null);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useLocalStorage<string[]>("folevi:recent-emoji", []);
  const searchId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void loadEmoji().then((e) => alive && setAll(e));
    return () => {
      alive = false;
    };
  }, []);

  const results = useMemo(() => {
    const terms = q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!all || !terms.length) return null;
    return all.filter((e) => {
      const hay = `${e.label} ${(e.tags ?? []).join(" ")}`.toLocaleLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [all, q]);

  const byGroup = useMemo(() => {
    const m = new Map<number, Emoji[]>();
    for (const e of all ?? []) {
      const list = m.get(e.group!) ?? [];
      list.push(e);
      m.set(e.group!, list);
    }
    return m;
  }, [all]);

  const pick = (emoji: string) => {
    setRecent([emoji, ...recent.filter((r) => r !== emoji)].slice(0, 16));
    onPick(emoji);
  };

  const cell = (e: { unicode: string; label: string }, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => pick(e.unicode)}
      aria-label={e.label}
      title={e.label}
      className="grid h-9 w-9 place-items-center rounded-[6px] text-[22px] leading-none transition-transform hover:scale-110 hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none"
    >
      {e.unicode}
    </button>
  );

  return (
    <div className="flex h-full flex-col" role="group" aria-label={label}>
      <div className="flex-none p-2.5 pb-1.5">
        <label htmlFor={searchId} className="sr-only">
          Search emoji
        </label>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            id={searchId}
            autoFocus
            type="text"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results?.[0]) {
                e.preventDefault();
                pick(results[0].unicode);
              }
            }}
            placeholder="Search emoji"
            className="ui-input h-9 w-full rounded-[6px] pl-8 pr-8 text-sm"
            aria-describedby={`${searchId}-status`}
          />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[6px] text-faint hover:text-ink">
              <X size={13} aria-hidden />
            </button>
          ) : null}
        </div>
        {!results ? (
          <div className="mt-2 flex justify-between" role="toolbar" aria-label="Emoji categories">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-label={g.name}
                title={g.name}
                onClick={() => scroller.current?.querySelector(`[data-group="${g.id}"]`)?.scrollIntoView({ block: "start" })}
                className="grid h-8 w-8 place-items-center rounded-[6px] text-[17px] opacity-75 transition-opacity hover:bg-accent-soft hover:opacity-100"
              >
                {g.icon}
              </button>
            ))}
          </div>
        ) : null}
        <p id={`${searchId}-status`} role="status" className="sr-only">
          {results ? `${results.length} emoji found` : ""}
        </p>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">
        {!all ? (
          <p className="py-10 text-center text-sm text-muted">Loading emoji…</p>
        ) : results ? (
          results.length ? (
            <div className="grid grid-cols-8 gap-0.5">{results.slice(0, 400).map((e) => cell(e, e.unicode))}</div>
          ) : (
            <p className="py-10 text-center text-sm text-muted">No emoji match “{q.trim()}”.</p>
          )
        ) : (
          <>
            {recent.length ? (
              <section aria-label="Recent">
                <h3 className="sticky top-0 z-10 bg-[var(--color-surface-raised)] py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Recent</h3>
                <div className="grid grid-cols-8 gap-0.5">{recent.map((u) => cell({ unicode: u, label: all.find((e) => e.unicode === u)?.label ?? u }, `r-${u}`))}</div>
              </section>
            ) : null}
            {GROUPS.map((g) => (
              <section key={g.id} data-group={g.id} aria-label={g.name} className="[content-visibility:auto] [contain-intrinsic-size:auto_600px]">
                <h3 className="sticky top-0 z-10 bg-[var(--color-surface-raised)] py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{g.name}</h3>
                <div className="grid grid-cols-8 gap-0.5">{(byGroup.get(g.id) ?? []).map((e) => cell(e, e.unicode))}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
