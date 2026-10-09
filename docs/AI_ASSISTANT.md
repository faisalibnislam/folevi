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

### Attachments

Files already in Convex storage are sent to Gemini as inline data (images, PDFs up to the inline limit; larger PDFs
through the Gemini Files API). Text, Markdown, CSV and HTML are read directly. DOCX, XLSX and PPTX are read where a
parser already exists in the app (import/export code); otherwise they are offered as "not supported yet" rather than
guessed. Numbers in spreadsheets go through the `calculate` tool, never model arithmetic. Audio blocks get a
Transcribe action (Gemini audio input), never automatic.

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

### Settings (AI section)

AI on or off (existing), conversation history, memory, proactive suggestions, attachment reading, web research,
digests. Each setting is enforced on the server.

### Credits and limits

Every model call goes through `metered()` and is charged to the right account (`aiAccountFor`). Embeddings and graph
extraction for eligible plans are platform-paid and rate-limited per account. Long jobs (deep research, digests,
bulk agent runs) hold credits up front and settle at the end. The usage view in Settings shows the plan's
allowance, use this period and what's left.

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
