// Whether a request to Foli asks to change the note (fix, reorganise, rename, shorten…) rather than to
// answer a question or write something new. Such requests go to the agent, which edits the note's own
// blocks in place (previewed, approved, one Undo) instead of adding a corrected copy at the end.

/** Verbs and phrases that ask for the note itself to change. */
const CHANGE =
  /\b(fix(es|ed)?|correct|clean ?up|tidy( up)?|reorgani[sz]e|restructure|re-?number|rename|re-?format|format (it|this|the)|rewrite|rephrase|reword|shorten|condense|simplify|proofread|polish|standardi[sz]e|sort|re-?order|reorder|merge|split|convert|turn (it|this|these|them|the [a-z ]{1,30}) into|translate (it|this|the|my) note|capitali[sz]e|de-?duplicate|(remove|delete) (the |all |any )?(duplicate|extra|empty|repeated)|make (it|this|them|the [a-z ]{1,30}) (consistent|shorter|clearer|concise|tighter|simpler|better|proper|tidy|uniform))\b/;
/** Complaints about the note that, with a "please" or a fix verb, ask for a change. */
const SYMPTOM = /\b(messed up|is wrong|are wrong|broken|typos?|inconsistent|out of order|duplicated?|all over the place)\b/;
/** Opening words of a question (how do I fix…? is a question; can you fix…? is a request). */
const QUESTION = /^(what|why|how|who|when|where|which|whose|is|are|was|were|do|does|did|should|summari[sz]e|explain|list|find|tell me|show me)\b/;
const REQUEST = /\b(can|could|would|will) you\b|\bplease\b/;

export function asksToChange(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (QUESTION.test(t) && !REQUEST.test(t)) return false;
  return CHANGE.test(t) || (SYMPTOM.test(t) && REQUEST.test(t));
}

/** What the person says when they ask the agent to make an answer's changes ("Fix in note"). */
export const FIX_IN_NOTE = "Make these changes in the note itself.";
