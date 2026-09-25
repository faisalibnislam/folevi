"use client";

import { flattenTree, plainText, type WireBlock } from "@folevi/editor-schema";
import { useEngineState } from "@/lib/hooks/useEngine";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";

/** Outline generated from headings and nested pages; click to jump. */
export function Outline({ documentId, onJump }: { documentId: string; onJump: (blockId: string) => void }) {
  const { engine } = useAppState();
  useEngineState(engine); // re-render as blocks change
  const blocks: WireBlock[] = engine?.documentBlocks(documentId) ?? [];
  const items = flattenTree(blocks)
    .map(({ block }) => block)
    .filter((b) => b.type === "heading" || b.type === "page");
  if (items.length < 2) return null;
  return (
    <nav aria-label="Outline" className="sticky top-6 hidden max-h-[calc(100dvh-8rem)] w-52 flex-none overflow-y-auto pr-2 2xl:block">
      <p className="mb-2 px-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-faint">Outline</p>
      <ul className="space-y-px text-[13px]">
        {items.map((b) => {
          const p = b.props as { level?: number; documentId?: string; titleCache?: string };
          if (b.type === "page") {
            return (
              <li key={b.id}>
                <AppLink href={`/d/${p.documentId}`} className="block truncate rounded-[6px] px-2 py-1 text-muted hover:bg-sunken hover:text-ink">
                  ↳ {p.titleCache || "Nested page"}
                </AppLink>
              </li>
            );
          }
          const level = Number(p.level ?? 1);
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onJump(b.id)}
                className={`block w-full truncate rounded-[6px] py-1 pr-2 text-left hover:bg-sunken hover:text-ink ${level === 1 ? "pl-2 font-medium text-ink" : level === 2 ? "pl-4 text-muted" : "pl-6 text-muted"}`}
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
