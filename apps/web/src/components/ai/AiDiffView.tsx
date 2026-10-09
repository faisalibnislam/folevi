"use client";

import type { TextPart } from "@/lib/history/diff";

/**
 * An AI rewrite's changes to the selected text: removed words struck through, added words marked (the
 * version history's styles, editor.css .fb-diff-*), with "added" and "removed" spoken to screen readers.
 */
export function AiDiffView({ parts, id }: { parts: TextPart[]; id?: string }) {
  return (
    <div id={id} role="group" aria-label="Changes to the selected text" className="fb-ai-diff whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink">
      {parts.map((p, i) =>
        p.kind === "added" ? (
          <ins key={i} className="fb-diff-added">
            {p.text}
          </ins>
        ) : p.kind === "removed" ? (
          <del key={i} className="fb-diff-removed">
            {p.text}
          </del>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
}

/** What the marks mean, under the changes. */
export function AiDiffLegend() {
  return (
    <p className="mt-2 flex gap-3 text-[11.5px] text-muted" aria-hidden>
      <span>
        <del className="fb-diff-removed">Removed</del>
      </span>
      <span>
        <ins className="fb-diff-added">Added</ins>
      </span>
    </p>
  );
}
