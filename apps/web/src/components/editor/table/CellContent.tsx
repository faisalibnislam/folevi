"use client";

import { Fragment } from "react";
import { sanitizeHref, type InlineNode, type Mark } from "@folevi/editor-schema";

/** A date chip's label, as the editor shows it (DateMention in extensions.ts). */
function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, (m || 1) - 1, d || 1);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : date;
}

/** Text with the editor's marks, drawn with the same classes as in a note. */
export function marked(text: React.ReactNode, marks: readonly Mark[] | undefined, key?: React.Key): React.ReactNode {
  let el: React.ReactNode = text;
  for (const m of marks ?? []) {
    if (m.type === "bold") el = <strong>{el}</strong>;
    else if (m.type === "italic") el = <em>{el}</em>;
    else if (m.type === "underline") el = <u>{el}</u>;
    else if (m.type === "strike") el = <s>{el}</s>;
    else if (m.type === "code") el = <code className="fb-inline-code">{el}</code>;
    else if (m.type === "color") el = <span className={`fb-color-${m.value}`}>{el}</span>;
    else if (m.type === "highlight") el = <mark className={`fb-hl-${m.value}`}>{el}</mark>;
    else if (m.type === "link") {
      const href = sanitizeHref(m.href);
      el = href ? (
        <a className="fb-link" href={href} target="_blank" rel="noopener noreferrer nofollow">
          {el}
        </a>
      ) : (
        el
      );
    }
  }
  return <Fragment key={key}>{el}</Fragment>;
}

/** A cell's content as it reads (the same as its editor shows it while editing). */
export function CellContent({ nodes }: { nodes: readonly InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === "mention")
          return (
            <span key={i} className="fb-mention" data-mention={n.userId}>
              @{n.label}
            </span>
          );
        if (n.type === "date")
          return (
            <time key={i} className="fb-date" dateTime={n.date}>
              {dateLabel(n.date)}
            </time>
          );
        if (n.type === "pageLink")
          return (
            <a key={i} className="fb-page-link" href={`/d/${n.documentId}`}>
              {n.label || "Untitled"}
            </a>
          );
        const parts = n.text.split("\n");
        return marked(
          parts.map((part, j) => (
            <Fragment key={j}>
              {part}
              {j < parts.length - 1 ? <br /> : null}
            </Fragment>
          )),
          n.marks,
          i,
        );
      })}
    </>
  );
}
