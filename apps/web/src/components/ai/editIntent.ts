// How Foli handles a message in Chat: a question gets the quick answer from your notes (one model call,
// with sources); a request to change notes goes to the agent, which proposes the changes (edits to a
// note's own blocks, moves, tags, new notes…), previewed and applied only on approval, with one Undo.

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

/** Requests to organise notes: move or file them, tag them, make notes, folders, checklists or tasks, merge. */
const ORGANIZE =
  /\b((move|put|file) (it|this|these|them|my|the|all|every)\b.{0,60}\b(into|in|to|under)\b|(tag|label) (it|this|these|them|my|the|all)\b|add (a |the )?tags?\b|(create|make|start) (a |an |new )*(note|page|folder|checklist|to-?do list|task list)s?\b|(create|make|add) (tasks|to-?dos)\b|merge (these|the|my|them|those)\b|link (it|this|these|them) to\b)/;

/** Whether a message should go to the agent (a change to notes) rather than get a quick answer. */
export function wantsAgent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (asksToChange(t)) return true;
  if (QUESTION.test(t) && !REQUEST.test(t)) return false;
  return ORGANIZE.test(t);
}

/** What the person says when they ask the agent to make an answer's changes ("Make these changes"). */
export const FIX_IN_NOTE = "Make these changes in the note itself.";
