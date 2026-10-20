// Authoring and copying blocks: the compact format seed content, templates and programmatic notes are
// written in, and deep copies with fresh ids. Shared by the server (convex/lib/create.ts) and the local
// backend, so a note made from the same specs has the same blocks either way.
import type { InlineNode } from "./generated/schema";
import type { WireBlock } from "./types";
import { SCHEMA_VERSION } from "./generated/schema";
import { parseInlineMarkdown } from "./markdown";
import { rankSequence } from "./rank";
import { ulid } from "./ids";

/** Compact authoring format for seed content, templates and programmatic documents. */
export interface BlockSpec {
  type: string;
  /** Inline Markdown (bold, italic, code, links). */
  md?: string;
  text?: InlineNode[];
  props?: Record<string, unknown>;
  children?: BlockSpec[];
}

/** Specs as wire blocks with new ids, in order, children right after their parent. */
export function specsToWireBlocks(specs: BlockSpec[], parentId: string | null = null): WireBlock[] {
  const ranks = rankSequence(specs.length);
  const out: WireBlock[] = [];
  specs.forEach((spec, i) => {
    const id = ulid();
    out.push({
      id,
      type: spec.type,
      parentId,
      rank: ranks[i]!,
      schemaVersion: SCHEMA_VERSION,
      text: spec.text ?? (spec.md ? parseInlineMarkdown(spec.md) : []),
      props: spec.props ?? {},
    });
    if (spec.children?.length) out.push(...specsToWireBlocks(spec.children, id));
  });
  return out;
}

/** Deep-copies blocks with fresh ids, preserving the tree. */
export function cloneBlocks(blocks: WireBlock[]): WireBlock[] {
  const map = new Map<string, string>();
  for (const b of blocks) map.set(b.id, ulid());
  return blocks.map((b) => ({
    ...b,
    id: map.get(b.id)!,
    parentId: b.parentId ? (map.get(b.parentId) ?? null) : null,
    revision: undefined,
  }));
}
