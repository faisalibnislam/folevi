# Folevi AI: the assistant plan

Folevi AI turns the notes app into a knowledge workspace: it understands, finds, writes, organizes and connects
what people keep in Folevi, and it never changes anything without showing the change first. This document is the
build plan and the contract every part follows. Decisions recorded here were made with the owner on 2026-10-09.

## Decisions

| Topic | Decision |
| --- | --- |
| Scope | Everything in this document, landed as the milestones below, each one shippable and tested on its own. |
| Providers | Gemini only for now, behind a provider adapter and a capability registry, so another provider is configuration, not a rewrite. |
| Semantic search | Embeddings and vector search for Pro, Pro AI and paid team workspaces (their notes). Free, trial and Core keep keyword search. Folevi pays for indexing; it isn't charged to credits. |
| Web research | Gemini's Google Search grounding. Priced into credits like any other request. |
| Conversations | Saved on the server, private, until deleted. Rename, pin, search, export, delete. Settings has an off switch for history. |
| Sharing | A conversation can be shared on request with workspace members; a member sees it only if they can open every note it cites. |
| Agent undo | Every agent run that changes notes saves a version of each note first; the run's result card has one Undo that restores them and reverses moves, renames and created notes. |
| Surfaces | The note's AI sidebar (always about that note), the floating chat (everywhere else), and a full-screen AI page (`/ai`) with the conversation list. |
| Knowledge graph | Derived from notes (never a separate source of truth), used for related notes, duplicates and contradictions, plus a visual graph view. |
| Modules | Memory and personalization, proactive suggestions, study and meeting tools, recurring digests, audio transcription on request. |
| Platforms | The web app. The Mac app is the web app in Electron, so it follows. There is no iOS app in the repo. |

## What exists (before this plan)

- `convex/ai.ts`: Gemini over `fetch` (`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FAST_MODEL`), streaming through the
  `aiStreams` table, actions `ask`, `write`, `brief`, `flowchart`, proposed changes (`convex/lib/aiActions.ts`,
  `convex/aiActions.ts`).
- Credits: `convex/lib/credits.ts` (1 credit = $0.01 of model cost), holds and settlement, plan gating (`aiBlockedIn`,
  Core has no AI), rate limits `ai` / `aiHigh`, `profiles.aiEnabled`.
- Retrieval: keyword search on `documents.searchText` only. Permission checks with `documentAccess`, `PageReader`,
  `ReaderLabels`.
- Web: `components/ai/*` (AskAiChat, AiPanel, InlineAi, CatchUp, FlowchartAi, TitleAi), selection actions in `useAi.ts`.

Everything below extends these; nothing is replaced wholesale.

## Architecture

### Provider layer (`convex/lib/ai/`)

- `provider.ts`: one interface for `generate` (text or JSON, streaming or not, tools, attachments) and `embed`.
- `gemini.ts`: the adapter (moves today's `gemini()` here unchanged in behaviour: fallback model, timeouts, usage).
- `capabilities.ts`: per model: text, vision, audio input, tool calling, structured output, long context, search
  grounding, embeddings, context window, prices. The client only offers what the active model can do.
- A fake provider for tests (`convex-test` stubs `fetch` today; the fake keeps that pattern for agent and tool tests).

### Conversations (`convex/aiChat.ts`)

Tables (all scoped like other rows: `ownerProfileId`, optional `workspaceId`):

- `aiConversations`: `publicId`, owner, title, pinned, context (kind: note | folder | workspace | selection | notes,
  ids), model, `sharedWith` (none | workspace), `createdAt`, `updatedAt`, `lastMessageAt`.
- `aiMessages`: conversation, role (user | assistant | tool), text (markdown), citations (note id, block id,
  quote), tool calls and results (structured), attachments (file ids), status (streaming | done | stopped | error),
  usage (credits), `createdAt`. Large tool results are stored truncated with a reference.
- History off: conversations live only for the session (rows deleted when the chat closes and by a sweep).

Streaming keeps the `aiStreams` mechanism (the assistant message row is the stream target).

### Retrieval (`convex/aiIndex.ts`, `convex/lib/ai/retrieval.ts`)

- Chunking: a note's blocks become chunks of about 1,000 characters along heading and block boundaries; each chunk
  keeps its block ids for citations and highlighting.
- `aiChunks`: note, scope, chunk index, text, block ids, content hash, embedding (768 dims, `gemini-embedding-001`
  with `outputDimensionality: 768`), `embeddingModel`, `indexedAt`. Vector index `by_embedding` filtered by
  `ownerProfileId` and `workspaceId`.
- Indexing: a note whose `contentSeq` moved schedules a debounced job (only for eligible scopes); unchanged chunks
  (same hash) keep their embedding; deleted, trashed or out-of-plan notes lose their chunks. A backfill job indexes
  an account when it becomes eligible.
- Hybrid search: keyword (existing full-text index) plus vector search, merged with reciprocal rank fusion, then
  filtered per note through `documentAccess` (never only through the index filter), deduplicated, token-budgeted.
- Ineligible scopes run the same pipeline without the vector half.

### Tools and the agent (`convex/lib/ai/tools/`, `convex/aiAgent.ts`)

Every tool: validates its arguments, runs as the person (their profile, their access), checks write access before
any change, returns structured results, and is audited. Read tools: `search_notes`, `get_note`, `get_notes`,
`list_folders`, `list_tags`, `find_related`, `find_duplicates`, `compare_notes`, `get_workspace_context`,
`read_attachment`, `search_web`, `calculate`. Write tools (proposals only): `create_note`, `update_note` (block-level
edits), `append_to_note`, `rename_note`, `move_note`, `create_folder`, `add_tags`, `create_checklist`,
`create_tasks`, `merge_notes`.

Agent runs: understand, plan, inspect (read tools), then a **preview** of every proposed write (diffs for edits,
lists for bulk moves), the person approves all or some, the server re-validates and executes in batches, verifies,
and reports with links. Before any write the run saves a version of each affected note (`documentSnapshots`, reason
`ai_run`) and records inverse operations in `aiRuns` so Undo restores everything. Runs have timeouts, cancellation,
idempotency keys per operation, and rate limits. Text from notes, files and web pages is data: it is wrapped and
labelled as untrusted and can never call a tool on its own.

### Attachments (`convex/aiAttachments.ts`, `convex/lib/ai/attachments.ts`, `convex/lib/ai/attachmentFiles.ts`)

Files already in Convex storage are sent to Gemini as inline data (images, PDFs up to the inline limit; larger PDFs
through the Gemini Files API). Text, Markdown, CSV and HTML are read directly. DOCX, XLSX and PPTX are read where a
parser already exists in the app (import/export code); otherwise they are offered as "not supported yet" rather than
guessed. Numbers in spreadsheets go through the `calculate` tool, never model arithmetic. Audio blocks get a
Transcribe action (Gemini audio input), never automatic.

As built (milestone 5):

- What can be attached: a file of a note the person can read (its images, files and recordings), or a file uploaded
  into the chat. Chat uploads are `files` rows of kind `attachment`, stored through the normal upload path in the
  conversation's scope (they count toward its storage), and only their uploader can open them, even in a shared
  workspace. The first message that sends one claims it for its conversation (`files.conversationId`); it is deleted
  with that conversation, the account or the workspace, and one never sent is swept after a day.
- Kinds and limits: PNG, JPEG and WebP images (7 MB), PDFs (14 MB), recordings (14 MB), and text, Markdown, CSV, HTML
  (stripped to its text) and JSON (2 MB, the first 100,000 characters read, 200,000 per message). At most 5 files per
  message, and at most 14 MB of images, PDFs and recordings together (base64 keeps a request under Gemini's 20 MB).
  A larger PDF or recording is refused with the limit: the Gemini Files API isn't used yet. No DOCX, XLSX or PPTX
  parser exists in the app, so those are "not supported yet", refused in the composer before anything is uploaded.
- Every file is checked again as the person when it's read (they can still open it, Settings > AI allows it, the
  model takes it in), and its text reaches the model wrapped as untrusted. Follow-ups carry the conversation's
  earlier files (up to the same limits). A message with files is answered from them and the conversation's notes
  (no search, no web). With CSV data the model gets `calculate` and is told to use it for every number.
- The agent's `read_attachment` reads a file sent in its conversation or a file of a note in its place (get_note
  shows file ids): text formats directly, images, PDFs and recordings through one model call that writes out what
  is in them.
- Transcribe on an audio block sends the recording to Gemini, shows the transcript in a preview under the block, and
  inserts it (or its summary, through the writing assistant's `summarizeText`) below the block only on Insert below.
- Settings > AI "Read attachments" off: uploads, attaching, `read_attachment` and transcription are refused on the
  server, and the Attach control and Transcribe action are hidden. Credits: every call goes through `metered()`;
  Gemini's usage metadata counts the files' tokens.

### Knowledge graph (`convex/aiGraph.ts`)

Derived per note in the background for eligible scopes: entities (people, projects, organizations, topics,
decisions) and relations (links, references, related, contradicts, supersedes), with the note and block they came
from. Explicit links come from `documentLinks`; inferred ones are marked as inferred. Rebuilt when a note changes;
removed with it. A graph view page shows notes and entities the person can open.

### Memory, suggestions, digests

- `aiMemories`: entries the person approved (tone, language, length, terms, instructions), per account and
  optionally per workspace; a Settings page lists, edits and deletes them; memory can be turned off.
- Proactive suggestions: computed from the index and graph without model calls (related notes, possible duplicates,
  open questions, action items found by patterns), shown as quiet chips; dismissals remembered; off switch.
- Digests: opt-in daily or weekly summaries generated on a schedule within the person's credits, delivered as a
  note in their Inbox and an in-app notification.

As built (milestone 8, part A: `convex/aiMemory.ts`, `convex/aiSuggestions.ts`, `convex/aiDigest.ts`, and
`convex/lib/ai/{memory,suggestions,digest}.ts`):

- Memory (`aiMemories`, scoped): entries of kind tone, language, length, term or instruction (200 characters
  each, 40 per place), private to the person. One in their Personal applies everywhere they use AI; one in a
  workspace only there. They only come from the person: Settings > AI (add, edit, delete, clear all), or Save
  on an offer under a chat answer. While memory is on, a chat answer may end with a `[[remember]]` line (JSON
  kind and text); it's taken out of the answer and stored on the message as an offer (`aiMessages.memory`,
  status proposed, saved or dismissed). Nothing is remembered until `aiMemory.saveProposal`; "Not now" is
  `dismissProposal`.
- Injection: `metered` (convex/ai.ts) reads the preferences for the request's credit hold
  (`aiMemory.forHold`: the person, and the workspace the request runs in) and carries them on the meter; the
  provider layer (`lib/ai/provider.ts`) appends them to the system prompt of every call made with it, labelled
  as the person's preferences, at most 1,600 characters. So chat, the agent, writing, research, study tools
  and digests all get them, background jobs too. Left out: quick fast JSON calls (search terms) and calls that
  copy a file's content (`noMemory`: reading attachments, transcription).
- Memory off: `forHold` returns nothing, chats aren't told they may offer one, Save is refused. Entries stay
  (listed with a note that memory is off, and deletable one by one or all at once) until the person deletes
  them. They're deleted with the account (Personal purge and `by_profile`) and with a workspace.
- Suggestions (`aiSuggestions.forNote`, no model call): open questions (a line ending in "?" with no answer
  below: the next line is missing, a heading, a divider or another question; struck-through or "resolved"
  lines skipped) and action items ("TODO", "Action:", "Next step:", "Follow-up:", "@name will", "need to",
  not already to-dos), at most 3 and 5, on any plan with AI; related notes not linked yet and likely duplicates
  from the graph, at most 3 and 2, on plans with the graph. Every note shown is one the person can open. They
  show as a quiet "Suggestions" row of chips under the note, above backlinks: the chip opens the line or the
  note, and (with edit access) links the other note at the end of this one or turns the line into an
  unchecked to-do (leaving out "TODO:"), each one undo step in the editor; Dismiss is remembered per person,
  note and key (`aiSuggestionDismissals`, deleted with the note, account or workspace). Suggestions off, AI
  off, or a Core scope: nothing is computed or shown.
- Digests (`aiDigests`, one row per person): off by default. Turning them on in Settings > AI
  (`aiDigest.save`) sets daily or weekly, the hour and weekday in the person's time zone (`profiles.timeZone`,
  clock changes included), and whether it's about their Personal or a workspace where they can add pages.
  A cron every 15 minutes (`aiDigest.due`) moves each due digest on to its next time first, then starts a job.
  The job checks digests and AI are still on, access, and that the plan has AI (Core: skipped before anything
  is read or sent), reads what changed since the last digest as the person (up to 12 edited notes, 900
  characters each; 15 new and 15 due tasks, theirs in a workspace; 12 comments by others; only what they can
  open), skips quietly when nothing changed (due tasks alone don't count), then holds credits
  (`ai.holdFor`, as `begin` does), makes one call (at most 1,200 output tokens) and settles. The digest is a
  note under their Inbox page there (restricted in a workspace), with links to the notes it covered and a card
  for it in the Inbox, plus an in-app notification. A skip (no AI on the plan, out of credits, no longer able
  to add pages there, the model failed) is told once per reason in the bell. Note content is never emailed.
  Digests or AI off: `due` clears the schedule and nothing runs.

### Study, meetings, translation, frameworks (`convex/lib/ai/studyTools.ts`, `convex/lib/ai/translate.ts`, `convex/aiStudy.ts`)

As built (milestone 8, part B):

- Meeting summary, flashcards, quiz, and the "Think it through" frameworks (pros and cons, decision matrix,
  SWOT, risks and mitigations, pre-mortem, mind map, "How might we", SCAMPER, six thinking hats) are writing
  tasks of kind `about`: the selected text, or the whole note when nothing is selected. Same `ai.write`, same
  gates and credits, same preview (Insert below, Insert above, Append, Create note). Offered in the inline
  composer ("Meetings and study", "Think it through"), as "/" items ("AI: Meeting summary"…), in the note's AI
  panel, and (meeting summary) in a recording's transcript preview.
- Meeting summaries, flashcards and quizzes answer in JSON, checked field by field and turned into Markdown on
  the server: action items are always to-dos, "@Owner:" first and "(due YYYY-MM-DD)" only for a real date;
  inserting turns "@Name" into a mention (and the to-do's assignee) when that person can be mentioned in the
  note. Frameworks answer in Markdown: tables are made well formed, the decision matrix's weighted totals are
  worked out on the server, a pre-mortem's last section becomes to-dos. Every result is capped at 20,000
  characters.
- Flashcards and quiz questions are stored in the note as toggles (the question is the toggle, the answer, or
  the lettered options and "Answer: B. why", inside it). The AI panel's Study tab reads them from the note as
  it is: flip, Know it or Again, progress; a quiz with right or wrong, the explanation and a score. Study
  progress is kept for the session only (nothing is stored), so there's no table to sweep or share.
- Whole-note translation (`aiStudy.translateNote`): each text block and table cell is a segment, with
  mentions, dates, page links and inline code as placeholders and link targets as stand-ins; code blocks and
  other blocks never go to the model. Chunks of about 6,000 characters (at most 14 calls, notes up to 60,000
  characters), all held up front. A segment that comes back wrong keeps its text. "New note" makes
  "Title (Language)" beside the original; "Replace text" previews it, saves a version first
  (`aiStudy.versionBeforeReplace`, reason `ai_run`, "Before AI changes"), then swaps each block's text in the
  editor as one undo step.

### Polish: onboarding, empty states, accessibility, the graph

As built (milestone 9, part B). The assistant is called Foli in the interface.

- Introduction: the first AI surface someone opens (the floating chat, the AI page's new chat, a note's AI
  panel) shows a small dismissible card (`components/ai/AiIntro.tsx`): what Foli does there, that it never
  changes a note without showing the change first, that requests and the notes they need go to Google
  Gemini, credits left, and two or three starters for the place (a note runs summarize or action items or
  asks about it; a chat fills the box, nothing is sent). Dismissing it or using a starter sets
  `profiles.aiIntroDismissedAt` (`users.setAiIntroSeen`), so no surface or device shows it again. Not shown
  while AI is off or not on the plan.
- Empty and gated states: AI off says how to turn it on, Core (or a workspace or shared note without AI)
  says what the plans with Foli include and links to Upgrade or plans (`AiUnavailable.tsx`, on the AI page
  and in a note's AI tab). A note's Ask mode offers questions about that note; an empty note says where to
  start; Study offers "Use all toggles" when the note has toggles the AI didn't make; Related, Research,
  memory and a graph with few or unlinked notes each say how they fill up.
- Accessibility: streamed text is never a live region; each surface announces once, politely, when an
  answer or result is ready (`components/ai/announce.tsx`). Focus goes back where it was when the floating
  chat closes (the launcher, or on a note where you were), to the prompt when a result is discarded, and to
  the draft's name when a generated note is ready. AI chrome inside a styled page (a night sheet, artwork
  colours) takes the app's own colours (`.ui-app-colors` in globals.css), so the inline composer and the
  transcript preview keep their contrast on any note style. `e2e/ai-a11y.spec.ts` runs axe over every AI
  surface in light and dark.
- Graph: nodes are sized by connections, never drawn under 4.5 px and hit within 12 px, the 12
  best-connected are labelled (others on hover, focus, search or zoom), entities have a shape per kind
  (people diamonds, projects squares, organizations hexagons, topics triangles, decisions pentagons), edges
  are quiet until a node is highlighted. The layout runs a few milliseconds per frame, at most 300 steps,
  and shows once, fitted. Nodes are buttons with one Tab stop: arrow keys move to the nearest node that way,
  Enter opens a note or shows an entity's notes, Shift and the arrows pan.
- Study reads only toggles the AI made as cards or quiz questions: the generator writes
  `<details data-study="card|quiz">`, which becomes the toggle's `study` prop (editor-schema `StudyKind`,
  round-tripped through Markdown). "Use all toggles" reads every toggle, for the session.
- The chat's mode (Chat, Agent, Research) is remembered per person on the device (localStorage, read and
  written in try/catch); the note's Agent tab keeps its own.
- A meeting summary saved as a new note (`aiWriting.saveDraft` with `people`) turns "@Name" into mentions
  on the server, of the scope's members (only the owner in Personal); the linking is shared with the editor
  (editor-schema `linkPeople`).
- The agent may offer to remember a preference like a chat answer (the same `[[remember]]` line, only while
  memory is on); the offer is stored on the message and saved only on Save.

### Settings (AI section)

AI on or off (existing), conversation history, memory, proactive suggestions, attachment reading, web research,
digests. Each setting is enforced on the server.

### Credits and limits

Every model call goes through `metered()` and is charged to the right account (`aiAccountFor`). Embeddings and graph
extraction for eligible plans are platform-paid and rate-limited per account. Long jobs (deep research, digests,
bulk agent runs) hold credits up front and settle at the end. The usage view in Settings shows the plan's
allowance, use this period and what's left.

### Sharing, export, usage and streaming (as built, milestone 9 part A)

- Sharing (`convex/aiSharing.ts`, `convex/lib/ai/sharing.ts`): only on request, from a conversation's menu (the
  `/ai` header and list, the floating chat). Only a kept conversation in a team workspace, by its own person;
  Personal ones can't be shared (the menu item is disabled and says so; the server refuses too). Shared means
  read-only for the workspace's members (not guests): nobody else can ask, regenerate, rename, delete, approve or
  undo. A member sees it under "Shared with you" and can open it only while they can open every note it
  depends on: what its answers cite, what it's about, notes whose files were attached, notes a proposed move
  names, and notes an agent run changes, merges or made (`noteRefs`, kept up to date as answers settle, and
  worked out again from the shown messages on every open). Checked through `documentAccess` per viewer on every
  read; it also disappears when its person leaves the workspace. Chat uploads stay private ("File not shared");
  a note's file shows to someone who can open the note. Web citations show. Credits, memory offers and
  follow-ups aren't shown. Share and unshare log `audit.user` lines with counts only. Unshare any time.
- Export: Markdown (one conversation, or one answer with its question: agent reports list their changes),
  "Copy as Markdown", and "Save as note" (`aiChat.saveAsNote`: cited notes become page links as the person sees
  them; in a workspace the note starts restricted to them). Research reports keep their own Save as note.
  Settings > AI "Export all conversations" zips every kept conversation (history-off ones aren't kept), one
  folder per place, from `aiChat.exportAll` pages of 10.
- Usage: every hold names its feature (chat, agent, writing, research, attachments, transcription, digests;
  `other` for an untagged one), and settling adds the credits to the account's period row
  (`aiCreditPeriods.features` and `.days`). Settings > AI's Usage card (`billing.aiUsage`) shows the account
  where you're working (a seat in a paid workspace, otherwise Personal): allowance, used, extra, left, reset,
  by feature, and a per-day bar chart with a table for screen readers.
- Streaming: a chat answer's text so far goes to an `aiStreams` row (`aiMessages.streamId`, `aiChat.streamText`)
  instead of the message, so `aiChat.get` isn't re-run per chunk; Stop, finish and the sweep put the text back
  on the message. Measured (tests/convex/ai-streaming.test.ts): a 42-message conversation's `get` reads 45
  documents and the stream query 4, so a 40-chunk answer costs about 250 reads instead of 1,800.

## Milestones

1. **Foundation**: provider adapter and capability registry, conversations and messages, settings switches, the
   `/ai` page with the conversation list, chat with streaming markdown (tables, code), stop, regenerate, edit and
   resend, follow-up suggestions, context chips, citations that open the note at the block.
2. **Retrieval**: chunking, embeddings, vector index, incremental indexing and backfill, plan eligibility, hybrid
   search, permission filtering, cited answers, "not found" honesty.
3. **Agent**: tools, plan, preview, approval, execution, verification, report, run Undo, audit, safety limits.
4. **Writing assistant**: every selection action and tone, custom instructions, diff preview, insert above, below,
   append, AI slash commands, note generation, AI templates saved as templates.
5. **Attachments and audio**: PDFs, images, text formats, spreadsheets with `calculate`, transcription.
6. **Research**: web search with Google grounding, page reading, combined research, deep research jobs with
   progress, cancellation and saved reports.
7. **Knowledge graph**: extraction, related notes, duplicates, contradictions, missing connections, graph view.
8. **Memory, suggestions, study, meetings, digests**: memory settings, proactive chips, flashcards and quizzes,
   meeting summaries, recurring digests, translation of whole notes, decision and brainstorming frameworks.
9. **Polish**: onboarding, empty states per context, usage view, accessibility pass, sharing conversations, export.

Every milestone ships with Convex tests (with the fake provider), web unit tests and e2e coverage, and keeps the
existing AI features working.
