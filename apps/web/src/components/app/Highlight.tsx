import { highlightRanges } from "@folevi/editor-schema";

/** Renders text with <mark> around case/diacritic-insensitive matches of the query. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = highlightRanges(text, query);
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, i) => {
    if (r.start > at) parts.push(text.slice(at, r.start));
    parts.push(
      <mark key={i} className="rounded-[4px] bg-highlight-yellow px-px text-ink" style={{ background: "var(--color-highlight-yellow)" }}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    at = r.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
