// "@Name" in AI-written text turned into real mentions (a meeting summary's owners, docs/AI_ASSISTANT.md
// milestone 8). Shared by the web app (inserting into a note) and the server (saving a new note), so both
// link the same names the same way.
import { TEXT_BLOCK_TYPES, type InlineNode } from "./generated/schema";
import type { WireBlock } from "./types";
import { normalizeInline } from "./richtext";

/** Someone who can be mentioned in a note. */
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
 * AI-written blocks with "@Name" turned into real mentions of `people`, and a to-do that mentions someone
 * (and has no assignee) assigned to the first of them. Names that match nobody stay as written.
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

/** Someone a proposed to-do can be assigned to; `isYou` is the person asking. */
export interface AssignablePerson extends MentionablePerson {
  isYou?: boolean;
}

/**
 * How an owner's name, as a note wrote it, matched the people a to-do can go to: one person ("matched"),
 * several ("ambiguous": two Sams), nobody ("unknown"), or no name was given ("none").
 */
export interface OwnerMatch {
  assigneeId: string | null;
  status: "matched" | "ambiguous" | "unknown" | "none";
}

/** Words that mean the person writing the note ("I'll send it", "me"). */
const ME = new Set(["me", "i", "myself", "my self"]);
const nameKey = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/^@+/, "")
    .replace(/[.,;:!?)("']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
const firstName = (s: string) => nameKey(s).split(" ")[0] ?? "";

/**
 * Matches an action item's owner (a name as written, or "me") to one of `people`, case-insensitively: "me"
 * is the person asking, then a whole display name, then a first name ("Sam" for Sam Rivera, or "Sam Lee"
 * for someone called just Sam). Only a single match counts: two people with that first name is ambiguous,
 * and the to-do stays unassigned. In Personal, `people` is only the person, so only their own name or "me"
 * matches.
 */
export function matchOwner(owner: string | null | undefined, people: readonly AssignablePerson[]): OwnerMatch {
  const key = nameKey(owner ?? "");
  if (!key) return { assigneeId: null, status: "none" };
  const one = (found: readonly AssignablePerson[]): OwnerMatch | null =>
    found.length === 1 ? { assigneeId: found[0]!.profileId, status: "matched" } : found.length > 1 ? { assigneeId: null, status: "ambiguous" } : null;
  const named = people.filter((p) => nameKey(p.displayName));
  if (ME.has(key)) return one(named.filter((p) => p.isYou)) ?? { assigneeId: null, status: "unknown" };
  return (
    one(named.filter((p) => nameKey(p.displayName) === key)) ??
    // "Sam" for Sam Rivera; "Sam Lee" for someone whose whole display name is Sam.
    one(named.filter((p) => (!key.includes(" ") && firstName(p.displayName) === key) || (!nameKey(p.displayName).includes(" ") && firstName(key) === nameKey(p.displayName)))) ?? {
      assigneeId: null,
      status: "unknown",
    }
  );
}
