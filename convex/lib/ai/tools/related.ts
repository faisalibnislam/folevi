// find_related: notes about the same things as a given note. The knowledge graph (aiGraph.related:
// links, shared entities, inferred relations, every note already checked for access) comes first; a
// hybrid search (keyword plus, where the plan includes it, semantic) on the note's own title and opening
// text fills up the rest. The tool only calls `findRelated`, so either half can change on its own.
import type { SourceNote } from "../../../ai";

export interface RelatedInput {
  note: { id: string; title: string; text: string };
  limit: number;
}

export interface RelatedHost {
  /** The knowledge graph's related notes, best first (none where the plan has no graph). */
  graphRelated?(noteId: string): Promise<{ id: string; title: string; reasons: string[] }[]>;
  search(input: { question: string; queries: string[]; limit: number; exclude?: string }): Promise<SourceNote[]>;
}

/** Up to `limit` notes related to `note` (never the note itself), best first: the graph's, then search's. */
export async function findRelated(host: RelatedHost, input: RelatedInput): Promise<{ id: string; title: string; excerpt: string }[]> {
  const { note, limit } = input;
  const out: { id: string; title: string; excerpt: string }[] = [];
  const seen = new Set([note.id]);
  const graph = host.graphRelated ? await host.graphRelated(note.id).catch(() => []) : [];
  for (const g of graph) {
    if (out.length >= limit || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push({ id: g.id, title: g.title || "Untitled", excerpt: g.reasons.join("; ") });
  }
  if (out.length >= limit) return out;
  const words = `${note.title} ${note.text}`.replace(/\s+/g, " ").trim();
  const queries = [note.title, words.split(" ").slice(0, 8).join(" ")].filter((s) => s.trim()).slice(0, 2);
  const found = await host.search({ question: words.slice(0, 1_000), queries: queries.length ? queries : [note.id], limit: limit + 1, exclude: note.id });
  for (const n of found) {
    if (out.length >= limit || seen.has(n.id) || n.recent) continue;
    seen.add(n.id);
    out.push({ id: n.id, title: n.title, excerpt: n.text.replace(/\s+/g, " ").slice(0, 300) });
  }
  return out;
}
