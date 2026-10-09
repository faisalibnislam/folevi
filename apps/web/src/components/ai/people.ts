import { TEXT_BLOCK_TYPES, normalizeInline, type InlineNode, type WireBlock } from "@folevi/editor-schema";

/** Someone who can be mentioned in a note (comments.mentionable). */
export interface MentionablePerson {
  profileId: string;
  displayName: string;
}

const TEXT_TYPES: ReadonlySet<string> = new Set(TEXT_BLOCK_TYPES);
const WORD = /[\p{L}\p{N}_]/u;

/** "@Name" in plain text, as text and mention nodes: the longest name that matches, ending at a word boundary. */
function mentionsIn(text: string, people: readonly MentionablePerson[]): InlineNode[] | null {
  const byLength = [...people].filter((p) => p.displayName.trim()).sort((a, b) => b.displayName.length - a.displayName.length);
  const out: InlineNode[] = [];
  let rest = 0;
  let found = false;
  for (let i = text.indexOf("@"); i >= 0; i = text.indexOf("@", i + 1)) {
    if (i < rest || (i > 0 && WORD.test(text[i - 1]!))) continue;
    const after = text.slice(i + 1);
    const who = byLength.find((p) => after.toLowerCase().startsWith(p.displayName.toLowerCase()) && !WORD.test(after[p.displayName.length] ?? ""));
    if (!who) continue;
    if (i > rest) out.push({ type: "text", text: text.slice(rest, i) });
    out.push({ type: "mention", userId: who.profileId, label: who.displayName });
    rest = i + 1 + who.displayName.length;
    found = true;
  }
  if (!found) return null;
  if (rest < text.length) out.push({ type: "text", text: text.slice(rest) });
  return out;
}

/**
 * AI-written blocks with "@Name" turned into real mentions of people who can be mentioned in the note, and
 * a to-do that mentions someone (and has no assignee) assigned to the first of them. Names that match
 * nobody stay as written.
 */
export function linkPeople(blocks: readonly WireBlock[], people: readonly MentionablePerson[] | undefined): WireBlock[] {
  if (!people?.length) return [...blocks];
  return blocks.map((b) => {
    if (!TEXT_TYPES.has(b.type)) return b;
    let changed = false;
    const text = b.text.flatMap((n): InlineNode[] => {
      if (n.type !== "text" || n.marks?.length) return [n];
      const linked = mentionsIn(n.text, people);
      if (!linked) return [n];
      changed = true;
      return linked;
    });
    if (!changed) return b;
    const first = text.find((n) => n.type === "mention");
    const props = b.type === "todo" && first && !b.props.assigneeId ? { ...b.props, assigneeId: (first as { userId: string }).userId } : b.props;
    return { ...b, text: normalizeInline(text), props };
  });
}
