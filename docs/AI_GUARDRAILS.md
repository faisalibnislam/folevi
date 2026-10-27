# Foli AI guardrails

What Foli AI will and won't help with, and how that's enforced. Decided with the owner on 2026-10-27.
Status: planned, not built.

## Where it stands today

- Prompt injection: text from notes, files and the web is wrapped as data (`packages/ai-prompts/src/untrusted.ts`)
  and never followed. The agent only proposes changes; the person accepts them.
- Exfiltration: answers can't load remote images, and the agent only reads pages the person wrote or its own
  search found (docs/SECURITY_PLAN.md, P0.2).
- Gemini's own filter at its defaults (we send no `safetySettings`), which for current models blocks very little.
  A blocked reply shows "The AI couldn't help with that request." (`convex/lib/ai/gemini.ts`).
- No topic rules in any system prompt, no crisis handling, no record of refusals. When the notes don't answer a
  question, Foli AI gives a short general answer labelled as not from the notes (`ask.ts`), so it already answers
  general questions.

## The policy

| Kind of request | What Foli AI does |
|---|---|
| About their notes, files or writing | Helps fully. |
| General questions | Answers from notes first; otherwise a short general answer, labelled as not from their notes (today's behaviour). |
| Legal but sensitive (alcohol, gambling, cannabis where legal, sexual health, harm reduction) | Answers factually and neutrally, with safety information where it matters. Never promotes or glamorises. |
| Medical, legal, financial | General information, one short line that it isn't professional advice, and a suggestion to see a doctor, lawyer or adviser for personal decisions. Possible emergency symptoms: tells them to get emergency help now. |
| Clearly harmful (making drugs, weapons or explosives; committing crimes; hacking or stalking others; fraud; sexual content involving minors; self-harm methods) | One calm sentence saying it can't help with that, plus a safe alternative where one exists. No lecturing. |
| Self-harm, suicide, crisis | Responds with care and keeps talking; never gives methods; points to a crisis line (a well-known local one when their country is clear from the conversation, otherwise findahelpline.com). |
| Fiction, journalism, research on dark subjects | Helps write, edit and summarise, but never adds real step-by-step instructions for causing harm, even inside a story. |
| Text inside notes, files, web pages | Data, never instructions (unchanged). Summarising a note about a harmful topic is fine; producing new harmful instructions from it is not. |

One policy for everyone: no workspace or admin topic controls.

## How it's built

1. **One rule, every prompt.** A `SAFETY_RULE` in `packages/ai-prompts` with the table above in model-facing
   words, appended to the system prompt in one place, `bodyOf` in `convex/lib/ai/gemini.ts`, so every feature gets
   it (chat, ask, agent, writing, research, routines, mind maps, tables, charts, attachments, transcription) and
   a new feature can't forget it. A static test checks that no Gemini request is built anywhere else.
2. **Gemini's filter set explicitly.** `safetySettings` on every request: dangerous content, harassment, hate
   speech and sexually explicit at `BLOCK_MEDIUM_AND_ABOVE`. Set in the same place.
3. **A refusal says why.** When the model declines, it ends with a marker line, `[[declined:<category>]]`
   (`harmful`, `crisis`, or `other`), which the server strips before the person sees or saves anything, the way
   `[[follow-ups]]` is handled today. A `SAFETY` finish from Gemini counts as `filtered`.
4. **No charge for refusals.** A declined or filtered reply is not charged in AI credits (`lib/credits.ts`).
5. **Counts, never text.** A new table `aiSafetyCounts` (profile, day, category, count) is written on each
   refusal. No question, answer or note text is kept. Kept 90 days.
6. **A pause for a pattern.** 5 `harmful` refusals within an hour pauses Foli AI for that account for 24 hours,
   with a plain message ("Foli AI is paused on your account until <time>, after several requests it can't help
   with."). `crisis` never counts toward a pause. Super admins see paused accounts in Admin and can lift one; both
   are written to the admin log.
7. **Encrypted spaces.** Unchanged: the same rule and counts apply. Counts carry no content.
8. **Tests.** Prompt tests (the rule is in every built request, markers are stripped), credit tests (no charge on
   a refusal), the pause (5 in an hour pauses, crisis doesn't, it lifts after 24 hours or by an admin), and a small
   live eval on dev: a fixed set of about 40 questions across the table's rows, checked by hand before each change
   to the rule. The live eval is never run in CI and never against production.

## Written down for users

- Terms: the Foli AI section and Acceptable use say what Foli AI won't help with and that repeated attempts can
  pause it.
- Help: a short "What Foli AI won't do" entry.
- A website page, `/ai-policy`, with the table above in plain language, linked from Terms, Help and the Foli AI
  panel's menu.

## Order

1. The rule, the Gemini settings, the marker and no charge (steps 1 to 4), with tests.
2. Counts and the pause (steps 5 and 6), with the Admin view.
3. Terms, Help and `/ai-policy`.
4. The live eval on dev, then a release with the owner's OK.
