// Proactive suggestions found by patterns in a note's lines (convex/aiSuggestions.ts has the rest): open
// questions and action items. No model is involved: these are plain rules over the text, cheap enough to
// run whenever the note is shown.
//
//   Open question: a line ending in "?" (three words or more) with no answer below it: the next line
//                  with text is missing, a heading, or another question. A line nested under it counts as
//                  an answer; a heading or divider ends the section. Struck-through lines and ones marked
//                  resolved or answered are skipped.
//   Action item:   a line that isn't a to-do yet and reads like one: "TODO ...", "Action: ...", "Next step:
//                  ...", "Follow-up: ...", "@Sam will ...", "we need to ...".

/** A line of a note as the rules see it (document order). */
export interface SuggestionLine {
  id: string;
  type: string;
  text: string;
  depth: number;
  /** Every bit of its text is struck through. */
  struck?: boolean;
}

export type PatternHit =
  | { kind: "question"; blockId: string; text: string }
  /** `strip`: characters of a leading marker ("TODO:", "Action:") a to-do made from it leaves out. */
  | { kind: "action"; blockId: string; text: string; strip: number };

/** Lines that can hold a question or an action item (not to-dos, headings, code or tables). */
const PROSE = new Set(["paragraph", "bulleted", "numbered", "quote", "callout", "toggle"]);

export const QUESTIONS_SHOWN = 3;
export const ACTIONS_SHOWN = 5;
/** Lines read per note, at most (a huge note is only read this far). */
export const LINES_READ = 2_000;
/** How much of a line a suggestion shows. */
const LABEL_CHARS = 140;

const label = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > LABEL_CHARS ? `${t.slice(0, LABEL_CHARS - 1)}…` : t;
};

const words = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
const isQuestion = (l: SuggestionLine) => PROSE.has(l.type) && /\?\s*$/.test(l.text) && words(l.text) >= 3;
const RESOLVED = /\b(resolved|answered)\b|✅|☑/i;

/** A leading marker that says "this is a to-do". */
const MARKER = /^\s*(?:(?:TODO|FIXME)\b\s*[:.-]?|(?:action(?:\s+items?)?|next\s+steps?|follow[\s-]?ups?)\s*:)\s*/i;
/** "@Sam will …", "@Dana Lee to …" (a mention or a typed @name, then what they'll do). */
const PERSON_WILL = /(?:^|\s)@[\p{L}][\p{L}\p{N}._'-]*(?:\s+[\p{Lu}][\p{L}'-]*)?\s+(?:will|to|should|must|needs?\s+to)\s+\p{L}/u;
const NEED_TO = /\bneeds?\s+to\s+\p{L}/iu;
const SHOUTED_TODO = /\bTODO\b/;

/** Whether a line reads like an action item, and the marker a to-do would drop. */
export function actionItem(text: string): { strip: number } | null {
  const t = text.trim();
  if (t.length < 6 || /\?\s*$/.test(t)) return null;
  const marker = MARKER.exec(text);
  if (marker) return text.slice(marker[0].length).trim().length >= 3 ? { strip: marker[0].length } : null;
  if (SHOUTED_TODO.test(t) || PERSON_WILL.test(t) || NEED_TO.test(t)) return { strip: 0 };
  return null;
}

/** Open questions and action items in a note's lines, in document order, a few of each. */
export function patternSuggestions(lines: SuggestionLine[], limits = { questions: QUESTIONS_SHOWN, actions: ACTIONS_SHOWN }): PatternHit[] {
  const out: PatternHit[] = [];
  let questions = 0;
  let actions = 0;
  const read = lines.slice(0, LINES_READ);
  read.forEach((line, i) => {
    if (!PROSE.has(line.type) || line.struck || !line.text.trim()) return;
    if (isQuestion(line)) {
      if (questions >= limits.questions || RESOLVED.test(line.text)) return;
      const next = read.slice(i + 1).find((l) => l.text.trim() || l.type !== "paragraph");
      const answered = next !== undefined && (next.depth > line.depth || (next.type !== "heading" && next.type !== "divider" && !isQuestion(next)));
      if (answered) return;
      questions++;
      out.push({ kind: "question", blockId: line.id, text: label(line.text) });
      return;
    }
    if (actions >= limits.actions) return;
    const hit = actionItem(line.text);
    if (!hit) return;
    actions++;
    out.push({ kind: "action", blockId: line.id, text: label(line.text.slice(hit.strip)), strip: hit.strip });
  });
  return out;
}

/** The key a suggestion is dismissed by (per note): its kind and what it points at. */
export function suggestionKey(kind: "connection" | "duplicate" | "question" | "action", target: string): string {
  const prefix = { connection: "link", duplicate: "dup", question: "q", action: "act" }[kind];
  return `${prefix}:${target}`;
}

/** A dismissal key as clients send it back: one of ours, short, nothing else. */
export const validSuggestionKey = (key: string) => /^(link|dup|q|act):[0-9A-Za-z_-]{1,64}$/.test(key);
