// The words Folevi for Mac's Quick Add reads as it's typed (docs/MAC_POLISH_PLAN.md §3.8), besides dates and
// repeats (lib/nlDate.ts, parseRepeatPhrase): "!high" (or !!!, !med, !!, !low, !) is a priority and "#Project" (or
// #"Two words") a page to add the task to. Each comes out of the task's words; a token the person said to keep
// as text (the chip's ×) stays in them.

export type TokenPriority = "low" | "medium" | "high";

export interface QuickAddTokens {
  /** The task's words without the tokens read. */
  rest: string;
  priority: { level: TokenPriority; text: string } | null;
  page: { query: string; text: string } | null;
}

const PRIORITY = /(^|\s)(!{1,3}|!(?:high|hi|h|medium|med|m|low|lo|l))(?=\s|$)/i;
const PAGE = /(^|\s)(#(?:"([^"]+)"|([\p{L}\p{N}][\p{L}\p{N}_\-./]*)))(?=\s|$)/u;

function level(token: string): TokenPriority {
  const t = token.toLowerCase();
  if (t === "!!!" || t.startsWith("!h")) return "high";
  if (t === "!!" || t.startsWith("!m")) return "medium";
  return "low";
}

const tidy = (s: string) => s.replace(/\s{2,}/g, " ").trim();

/** Reads the priority and page tokens in `text`, leaving those in `kept` as words. */
export function readQuickAddTokens(text: string, kept: ReadonlySet<string> = new Set()): QuickAddTokens {
  let rest = text;
  let priority: QuickAddTokens["priority"] = null;
  let page: QuickAddTokens["page"] = null;
  const p = PRIORITY.exec(rest);
  if (p && !kept.has(p[2]!)) {
    priority = { level: level(p[2]!), text: p[2]! };
    rest = rest.slice(0, p.index) + p[1] + rest.slice(p.index + p[0].length);
  }
  const g = PAGE.exec(rest);
  if (g && !kept.has(g[2]!)) {
    page = { query: (g[3] ?? g[4] ?? "").trim(), text: g[2]! };
    rest = rest.slice(0, g.index) + g[1] + rest.slice(g.index + g[0].length);
  }
  return { rest: priority || page ? tidy(rest) : text, priority, page: page && page.query ? page : null };
}

/** The page a "#query" names among search results: one whose title starts with it, else one containing it. */
export function pageForQuery<T extends { title: string }>(query: string, docs: readonly T[]): T | null {
  const q = query.toLowerCase();
  return docs.find((d) => d.title.toLowerCase() === q) ?? docs.find((d) => d.title.toLowerCase().startsWith(q)) ?? docs.find((d) => d.title.toLowerCase().includes(q)) ?? null;
}
