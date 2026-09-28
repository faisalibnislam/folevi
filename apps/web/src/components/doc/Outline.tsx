"use client";

import { useEffect, useState } from "react";
import { flattenTree, plainText, type WireBlock } from "@folevi/editor-schema";
import { useEngineState } from "@/lib/hooks/useEngine";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";

/** Outline generated from headings and nested pages; click to jump. The section in view is marked. */
export function Outline({ documentId, onJump }: { documentId: string; onJump: (blockId: string) => void; variant?: "panel" }) {
  const { engine } = useAppState();
  useEngineState(engine); // re-render as blocks change
  const blocks: WireBlock[] = engine?.documentBlocks(documentId) ?? [];
  const items = flattenTree(blocks)
    .map(({ block }) => block)
    .filter((b) => b.type === "heading" || b.type === "page");
  const current = useCurrentHeading(items.filter((b) => b.type === "heading").map((b) => b.id));

  if (!items.length) {
    return <p className="px-1 py-6 text-center text-sm text-muted">Add headings or nested pages and they’ll appear here.</p>;
  }
  return (
    <nav aria-label="Outline">
      <ul className="space-y-0.5 text-[13px]">
        {items.map((b) => {
          const p = b.props as { level?: number; documentId?: string; titleCache?: string };
          if (b.type === "page") {
            return (
              <li key={b.id}>
                <AppLink href={`/d/${p.documentId}`} className="block truncate rounded-[6px] px-2.5 py-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-heading">
                  ↳ {p.titleCache || "Nested page"}
                </AppLink>
              </li>
            );
          }
          const level = Number(p.level ?? 1);
          const on = current === b.id;
          return (
            <li key={b.id} className="relative">
              {on ? <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-heading" /> : null}
              <button
                type="button"
                onClick={() => onJump(b.id)}
                aria-current={on ? "location" : undefined}
                className={`block w-full truncate rounded-[6px] py-1.5 pr-2 text-left transition-colors hover:bg-accent-soft hover:text-heading ${
                  level === 1 ? "pl-3 font-semibold" : level === 2 ? "pl-6" : "pl-9"
                } ${on ? "text-heading" : level === 1 ? "text-ink" : "text-muted"}`}
              >
                {plainText(b.text) || "Untitled heading"}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The last heading whose top has scrolled above ~30% of the viewport. */
function useCurrentHeading(ids: string[]): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const key = ids.join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    const update = () => {
      let found: string | null = list[0] ?? null;
      for (const id of list) {
        const el = document.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
        if (!el) continue;
        if (el.getBoundingClientRect().top < window.innerHeight * 0.3) found = id;
      }
      setCurrent(found);
    };
    update();
    window.addEventListener("scroll", update, true);
    return () => window.removeEventListener("scroll", update, true);
  }, [key]);
  return current;
}
