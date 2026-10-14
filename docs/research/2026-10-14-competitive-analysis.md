# Folevi: competitive analysis, feature gaps and product roadmap

Date: 2026-10-14. Status: research and planning only. No code was changed to produce this document.

**How this was made.** One agent audited the Folevi codebase feature by feature. Four agents researched competitors and platforms on the web: incumbents, AI-native apps, Apple-native and open-source apps, and MCP plus macOS plus local AI. Their source URLs are kept inline where a claim depends on them.

**Evidence labels used throughout**

- **[V]** Verified. For Folevi, it was found in code with a UI entry point, a backend function and a test. For competitors, it was confirmed on the vendor's own site, docs, changelog or repo.
- **[3P]** Third-party source (review site, press, pricing tracker, forum).
- **[U]** Unverified: inferred, background knowledge, or conflicting sources.
- **[I]** Inferred about Folevi from reading code without a test.

User sentiment from review sites and forums is directional only. The agents found few 2026 Reddit or HN threads.

**Effort scale** (one developer working with Claude Code): XS under 1 day, S 1 to 3 days, M 1 to 2 weeks, L 3 to 6 weeks, XL more than 6 weeks.

---

## Part 1. Executive summary

**Where Folevi stands.** Folevi is a polished, broad web app. It has a 21-block editor and local-first offline editing in the browser, and its team model includes free guests and per-page permissions. Version history attributes every line to an author. The 57 note themes are the most expressive design system in the category. Foli AI is unusually complete: chat with citations, an agent that edits with approval and one-click undo, web research, study tools, digests, a knowledge graph and memory.

On AI and pricing Folevi is level with or ahead of most rivals. The gaps are elsewhere: how people get data in and out, and the places Folevi can run.

**The five things that matter most**

1. **Every serious competitor now ships an MCP server; Folevi doesn't.** Notion, Craft, Evernote, Bear, Capacities, Tana, Heptabase, Mem, AFFiNE and Agenda all have one [V]. Claude, ChatGPT, Cursor and Codex users now expect to connect their notes. Folevi's agent, sync engine and approval model already contain most of what a server needs, so this is the single highest-leverage build.
2. **Folevi can't take payment yet.** Polar is coded but shows "Coming soon" [V]. This is not a feature, but no roadmap item matters commercially until it is live.
3. **Basic task features are missing:** recurrence, natural-language dates, email or push reminders, and calendar feeds [V]. These are cheap to add, and their absence is felt every day.
4. **Folevi only runs in a browser.** There is no mobile app, and the Mac app isn't notarized or distributed [V]. Every rival except Microsoft Loop has native mobile apps.
5. **Real-time collaboration is block-level, with up to 2.5 s of delay and conflicts instead of merges [V].** That is good enough for async teams. Next to Notion, Craft or Apple Notes it feels weaker, and it can be improved in stages.

**Where Folevi is already stronger than the market**

- **Offline editing in the browser.** Notion's offline mode works only in its apps, and only Business and Enterprise auto-download pages [V]. Craft's web offline needs setup, Loop has none, and Obsidian has no web app.
- **Predictable AI pricing.**
  - Pro AI at $13.99 sits under Heptabase Premium ($17.99), Tana ($20 to $30 per seat) and Mem Pro ($29 for 100 messages) [V].
  - Notion's credits produce bill shock [3P], and Evernote doesn't publish its limits [V].
- **A real no-AI plan at $1.99.** Users tired of having AI pushed at them have few honest options, and this is one.
- **An approval and undo agent.** This is now the 2026 norm (Notion "Suggest edits", Tana merge proposals, Capacities review), and Folevi already has it.
- **Small-team pricing.** Craft caps teams at 10 seats in fixed bundles [V]. Obsidian has no real-time co-editing. Tana charges $20 to $30 per seat.

**Recommended path in one line.** Go live with payments, then work in this order:

1. Ship the easy task and capture wins (2 weeks).
2. Ship a read-only MCP server, then approval-gated writes (about 4 weeks).
3. Distribute the Mac app properly.
4. Add proactive Foli AI routines and meeting capture.
5. Decide on mobile with real usage data.

Avoid building an MCP client, on-device AI, end-to-end encryption, database formulas or a native iOS app before then.

---

## Part 2. Current application audit

The full feature-by-feature inventory (about 320 lines, with file paths and test names) is reproduced in Appendix A. This part classifies it.

### 2.1 Fully implemented and working (verified unless marked)

| Area | Features |
|---|---|
| Editor | 21 block types; slash menu; Insert panel; Markdown shortcuts; inline formatting with 6 colours and 4 highlights; nesting to depth 8; drag and multi-select; find and replace; HTML and Markdown paste; context menu; undo that survives remote edits |
| Rich blocks | Code (27 languages), Mermaid, TeX block formulas, simple tables (200×20), images (with Unsplash when the key is set), files to 100 MB, audio recording to 60 min, bookmarks, flowcharts (7 shapes, auto-layout, AI create and edit) |
| Linking | `[[ ]]` page links with broken-link status; backlinks; @mentions with notifications; inline dates |
| Organisation | Nested pages; tags; starred; drafts; archive; trash (30 days); Home dashboard; note browser with three layouts and bulk actions; 26 templates plus Save as template and AI templates |
| History | Auto-versions; word-level diff coloured by author; named versions kept forever; restore that can be undone; per-line author attribution |
| Collaboration | Personal vs workspaces; Owner/Admin/Member roles; guests with page-level grants; per-page restricted access; public links with expiry and password; comments with threads and resolve; notifications plus 11 email templates and a daily digest; conflict banner |
| Sync | IndexedDB op queue; idempotent ops; server revisions; offline cold start; upload queue with retry; sync status UI; device limit |
| Import and export | Markdown/TXT/ZIP import with a warnings report; per-page MD/HTML/PDF export (PDF through the print dialog); whole-scope ZIP export; AI conversation export |
| Foli AI | Chat with block citations; hybrid retrieval; agent with approve and undo; writing help; title suggestions; flowchart AI; flashcards and quiz; meeting summary; transcription; "Think it through" frameworks; whole-note translation; web research; Catch me up; digests; suggestions; knowledge graph; memory; sharing conversations; usage view |
| Accounts | Email and password; TOTP 2FA; session list and revoke; account deletion with grace period; admin console with an audit log, maintenance mode and feature flags |
| Appearance | Light, dark and system; 57 note themes; page style (font, width, background, sheet and text colour, accent); covers and icons |
| Mac shell | ⌥Space Quick Add, menu bar, open at login, native notifications, Dock badge, spellcheck, offline page [V] |

### 2.2 Implemented but needs improvement

| Feature | Gap | Evidence |
|---|---|---|
| Real-time co-editing | Block-level. Saves are batched every 2.5 s (`BLOCK_SAVE_DELAY`, `apps/web/src/lib/sync/engine.ts:325`). Two people editing one block get a conflict, not a merge. No live carets | [V] |
| Presence | Shows only which block each person is in | [I] |
| Collections | Table, gallery and kanban only. No calendar or timeline view, formulas or rollups. Edits are plain mutations, so probably online-only | [V] / offline [I] |
| Whiteboard | Freehand strokes only. No shapes, text, sticky notes or infinite canvas | [V] |
| Calendar | Tasks only, in month and agenda views. No events, no week or day view, no external sync | [V] |
| Reminders | In-app, plus native notifications on Mac. No email, web push or mobile push | [I] |
| Search (⌘K) | Keyword only; one scope at a time; 50 results | [V] |
| Folders | One level of sub-folders | [V] |
| AI attachments | No DOCX/XLSX/PPTX. 14 MB recordings (the Gemini Files API isn't used) | [V] |
| Study | Flashcard progress isn't saved; no spaced repetition | [V] |
| Offline | Only document and block edits are durable offline. Comments, collections, folders, tags, sharing and task fields need a connection | [I] |
| Graph and semantic retrieval | Pro tiers only; not during the trial | [V] |

### 2.3 Partially implemented

| Feature | State |
|---|---|
| Payments (Polar) | Code complete: checkout, portal, webhooks, seat sync, credit packs. Not configured in production; the UI says "Coming soon" [V] |
| Mac app | Works, but it is arm64 only, signed with a development certificate, not notarized, and has no auto-update or deep links (`apps/desktop/electron-builder.yml`, `docs/DESKTOP.md`) [V] |
| Import from other apps | Markdown exports from Notion and Obsidian partly work through the generic path [I]. No dedicated importers |

### 2.4 Scaffolded, hidden or legacy (backend with no UI)

| Capability | Where | Opportunity |
|---|---|---|
| `aiGraph.missingConnections` | `convex/aiGraph.ts` (tested) | A "Notes you could link" panel. XS to S |
| `tasks.moveToDocument` | `convex/tasks.ts:340` | "Move task to…" in the task row menu. XS |
| Public link `allowIndexing` | `sharing.createPublicLink`, honoured by `/s/[token]` | A "Let search engines index this page" toggle. XS |
| `sync.pull/pullJson/pushJson/head` and the PKCE `nativeAuth` plugin | `convex/sync.ts`, `convex/lib/nativeAuth.ts` | A platform-neutral sync API left over from the archived Swift app, reusable by a future mobile client. Not suitable as a public API |
| Daily notes | `documents.daily/dailyDates`, read-only | Retired on purpose. Leave it |
| Entitlement flags `advancedPermissions`, `auditLog`, `workspaceAnalytics`, `securityControls`, `prioritySupport` | `convex/lib/plans.ts` ~l.93 | Always false. Placeholders for a future Business tier |
| `AVAILABILITY = "On the web · Mac app coming soon"` | `convex/lib/plans.ts:210`, OG image, metadata | Update this when the Mac app ships |

### 2.5 Missing (verified absent in code)

- **Tasks:** recurrence; natural-language dates; email and push reminders; calendar events; external calendar sync or feed.
- **Editor:** video and iframe embeds; columns; synced blocks; inline math; comment reactions; live carets.
- **Data in and out:** a public API and tokens; webhooks; an MCP server; a web clipper; email-to-note; Zapier.
- **Importers:** Notion, Evernote, HTML and DOCX.
- **Organisation:** nested folders beyond one level; moving or copying between Personal and a workspace; search across all scopes; semantic search in ⌘K.
- **Accounts:** passkeys; SSO/SAML; a breached-password check; a customer-facing audit log.
- **Reach:** native mobile apps; Windows and Linux desktop builds; languages other than English.
- **Foli AI:** model choice; bring your own key; autocomplete while typing; image generation; voice chat.

### 2.6 Test footprint (counted, not run)

About 530 Convex integration tests, 286 web unit tests, 100 editor-schema tests and 170 Playwright e2e tests in 66 specs, with axe accessibility checks. E2E runs only on Chromium, with Safari and Firefox checked by hand. `docs/PRODUCT.md` still gives older counts.

---

## Part 3. Competitor landscape

These 10 were chosen to cover each group:

- **Market leaders:** Notion, Evernote.
- **Modern and fast-growing:** Craft, Capacities, Heptabase.
- **AI-native:** Mem, Tana.
- **Native macOS:** Apple Notes, Bear.
- **Open source:** Obsidian (local files with a closed-source app), with AFFiNE as the open-source reference.

Short notes on Anytype, Logseq, AppFlowy, Reflect, Agenda, NotebookLM (now Gemini Notebook), Granola and Microsoft Loop follow at the end.

### 3.1 Notion

| Aspect | Findings |
|---|---|
| Core | Block pages, wikis, databases with table/board/list/calendar/timeline/gallery/form/chart/map/dashboard views, Sites, forms, Notion Calendar [V] |
| Advanced | SAML SSO, private teamspaces, database permissions down to columns (2026-10-13), synced databases for GitHub/Jira/Salesforce, SCIM and audit log on Enterprise [V] |
| USP | Docs plus databases plus agents in one place, with the largest template and integration ecosystem |
| AI | Notion Agent runs multi-step work for 20+ min; Custom Agents (GA May 2026, billed in credits); Suggest edits (approve one by one, Aug 2026); a model picker that now includes Opus 5.5 and Sonnet 5.5; Business users can pay through their ChatGPT plan (Oct 2026) [V]. Free and Plus get a trial only [V] |
| Automation | Public API, webhooks, Zapier, Workers (a hosted code runtime), CLI, External Agents API (alpha), Agent SDK, Skills [V/3P] |
| MCP | Official remote server with OAuth and about 38 tools. Also connects out to 150+ tools, with admin controls [V] |
| UX | Polished and flexible; heavy and laggy in large workspaces [3P] |
| Platforms | Web, Mac, Windows, iOS, Android. Electron desktop [U] |
| Offline | Desktop and mobile only. Pages are downloaded one at a time, databases only their first 50 rows. Business and Enterprise auto-download recent pages [V] |
| Pricing | Free; Plus $10 and Business $20 per member a month, billed yearly [V]; $12 and $24 monthly [U]; credits $10 per 1,000 [V] |
| Strengths | Breadth, ecosystem, agent platform, enterprise controls |
| Weaknesses | Real AI needs Business at $20+ per seat; credit billing is hard to predict; offline is limited |
| Sentiment | Loved: flexibility and templates. Complaints: credit bills (one team reportedly spent $1,500 in a month), lag, price rises [3P] |
| Direction | Becoming a hub that serves outside agents (MCP, Skills, External Agents API) |

### 3.2 Obsidian

| Aspect | Findings |
|---|---|
| Core | Local Markdown vault, wiki links, graph, Canvas (JSON Canvas), Bases database views with kanban since 1.14 [V] |
| Advanced | Sync (end-to-end encrypted, 1 to 100 GB), Publish, thousands of community plugins [V] |
| USP | You own the files; local-first; free for work too |
| AI | None built in; community plugins only [V] |
| Automation | Official CLI (1.12, Feb 2026) aimed at agents; Headless Sync (beta) for CI and agents [V] |
| MCP | No official server; community wrappers around the CLI [3P] |
| UX | Fast; steep learning curve; clunkier on mobile [3P] |
| Platforms | Mac, Windows, Linux, iOS, Android; Electron; no web app [V/U] |
| Offline | Fully offline |
| Pricing | App free; optional $50/yr commercial licence; Sync $4 to $5 a month; Publish $8 to $10 [V] |
| Strengths | Ownership, speed, plugins, a loyal community |
| Weaknesses | No native AI, no real-time co-editing, setup overhead |
| Sentiment | Loved: plain files, plugins. Complaints: endless tinkering, mobile, paid Sync [3P] |
| Direction | Stay files-first and become scriptable for agents without shipping AI itself |

### 3.3 Craft

| Aspect | Findings |
|---|---|
| Core | Designed block documents, daily notes, tasks, collections (table, gallery, kanban), whiteboards, publishing [V] |
| Advanced | Shared Spaces, Quick Entry on Mac, presentation mode, import microsites for Evernote/Notion/Google Docs, system calendar on Apple devices [V] |
| USP | Native Apple-quality design and **free, unlimited on-device AI** on Mac, iPad and iPhone [V] |
| AI | Assistant edits and organises across a space in the background; BYO OpenAI or Anthropic key; cloud models Core/Fast/Max; paid top-ups [V] |
| Automation | API scoped per connection; Craft Agents (open-source agent desktop) [V] |
| MCP | Official, per connection or whole space, **included on Free**; listed clients: Claude, ChatGPT, Cursor, VS Code, Raycast [V] |
| UX | Widely seen as the most beautiful; long-running text-selection bugs [3P] |
| Platforms | Native macOS/iOS, Windows, Android, web [V] |
| Offline | Mac and iOS out of the box; web and Windows after setup; Android "in development" [V] |
| Pricing | Free (1 GB, 1,500 blocks); Plus $10 a month or $96 a year (a sale at $8 seen); Family $18; Team $60 a month for up to 10 [V] |
| Strengths | Design, free on-device AI, generous MCP |
| Weaknesses | 10-seat team cap, fixed bundles, small ecosystem |
| Sentiment | Loved: looks, templates. Complaints: bugs, "not Notion" for structured work [3P] |
| Direction | Ships every 2 to 4 weeks: offline everywhere, kanban, Assistant upgrades, BYOK, MCP v2 |

**Relevance:** Craft is Folevi's UI reference, and its playbook (design plus AI plus MCP on Free) is the one most directly aimed at Folevi's users.

### 3.4 Evernote (Bending Spoons)

| Aspect | Findings |
|---|---|
| Core | Notes, notebooks, tags, Spaces, the most mature web clipper, scanning, search inside PDFs, images and handwriting, tasks, calendar connections [V/3P] |
| AI | v11 (Jan 2026): AI Assistant, semantic search, meeting notes, transcription. Per-plan limits not published; may be Advanced-only [3P] |
| MCP | Official connector for Claude, ChatGPT and others (paid plans) [V]. Tool list unknown [U] |
| Platforms | Web, Mac, Windows, iOS, Android; offline on all plans [V] |
| Pricing | Free (50 notes, 1 device); Starter $14.99 a month or $99 a year; Advanced $24.99 a month or $249.99 a year [3P] |
| Strengths | Capture and search inside attachments |
| Weaknesses | Repeated price rises, a crippled free plan, distrust of the owner [3P] |
| Direction | More revenue per loyal user; AI relaunch; MCP |

**Relevance:** Evernote refugees are a ready audience. An ENEX importer plus Folevi's prices is a direct pitch to them.

### 3.5 Apple Notes (macOS/iOS 26 and 27)

| Aspect | Findings |
|---|---|
| Core | Rich text, folders, tags, checklists, tables, scanning, shared notes with per-person highlights [V] |
| Advanced | Markdown import and export (26); copy as Markdown, section links and drawing on Mac (27); Math Notes [V] |
| AI | Apple Intelligence: recording with live transcription and summaries, Writing Tools, call recordings. Siri writes into notes in 27 [V] |
| Automation | Shortcuts actions; App Intents to Spotlight and Siri. No API [V/U] |
| MCP | None official. Community servers exist. MCP groundwork appeared in App Intents in the 26.1 betas; system-wide MCP in 27 is unconfirmed [V/U] |
| Platforms | Apple only; iCloud.com in a browser elsewhere [V] |
| Pricing | Free |
| Strengths | Zero friction, OS-level capture, on-device AI |
| Weaknesses | Apple only; basic Markdown; no backlinks or databases [V/U] |
| Direction | Toward Siri and agents through App Intents |

### 3.6 Bear

| Aspect | Findings |
|---|---|
| Core | Markdown notes, nested tags, wiki links, OCR search, export to PDF/HTML/DOCX/ePub, Mermaid (Jul 2026) [V] |
| USP | Beautiful writing, a native Apple feel, 28+ themes [V] |
| AI | None built in. Bring your own AI through the CLI, a Claude connector and MCP [V] |
| MCP | Official since 2.8 (Apr 2026): local stdio `bearcli mcp-server`, Mac only, keyword search [V] |
| Platforms | Mac, iPhone, iPad, Watch; Bear Web in beta since Jul 2025 [V] |
| Pricing | Pro $2.99 a month or $29.99 a year [V] |
| Weaknesses | Apple only; no collaboration [V] |
| Direction | Bear 3.0 shipped in Sept 2026; strong agent story [V] |

**Relevance:** Bear is the closest match to Folevi's themed, design-led positioning on price. Folevi wins on collaboration, the web and built-in AI. Bear wins on native feel and Apple integration.

### 3.7 Capacities

| Aspect | Findings |
|---|---|
| Core | Typed objects with properties, backlinks, daily notes, tasks, calendar (CalDAV), version history, PDF annotation [V] |
| AI | Chat that edits objects and calendar events, with review by default; model picker (OpenAI, Anthropic, Google); a monthly AI budget plus a Plus add-on; system-audio meeting recording (R71, Sept 2026) [V] |
| MCP | Official "AI Chat Connectors" with read and write; setup documented for 20+ clients [V] |
| Platforms | Mac, Windows, Linux, iOS, Android, web; Electron desktop; offline on every plan [V/3P] |
| Pricing | Free; Pro $9.99; Believer from $12.49; AI Plus $8.33 a month billed yearly [V] |
| Weaknesses | Single-player by design; opaque AI budget; learning curve [V/3P] |
| Direction | AI that acts, audio capture, an MCP hub |

### 3.8 Tana (Tana Outliner and the new Tana)

| Aspect | Findings |
|---|---|
| Core | Outliner with supertags and fields. The new Tana (Mar 2026) adds docs, canvas, tasks and **built-in video calls** [V] |
| AI | Custom agents described in plain English, running in chat, by voice or on a schedule; "Hey Tana"; model switching; AI changes arrive only as merge proposals [V] |
| MCP | The strongest in the set: local and hosted servers (18 tools), **and** lets you plug your own MCP servers into Tana chat [V] |
| Platforms | Web plus Electron desktop; native mobile "coming"; limited offline [V] |
| Pricing | New Tana Pro $20 per user a month (list $30); Outliner $8 to $14 [V] |
| Weaknesses | The confusing product split, an immature new app, price [V/3P] |
| Direction | An agent-driven meeting and team workspace |

### 3.9 Heptabase

| Aspect | Findings |
|---|---|
| Core | Cards on whiteboards, journal, tag databases, PDF annotation, real-time collaboration [V] |
| AI | An agent that edits cards, databases and whiteboards; AI Tutor; Skills ("Break down book"); Codex inside the app. Pro is Gemini-only, Premium adds GPT and Claude [V] |
| MCP | Official remote server with read, search, create and edit (Aug 2026); CLI; Claude and ChatGPT plugins [V] |
| Platforms | Every desktop and mobile platform plus web; Electron; offline [V/3P] |
| Pricing | No free plan. Pro $8.99, Premium $17.99, Premium+ $53.99 [V] |
| Weaknesses | Paid only; a steep jump for heavy AI; lock-in to its whiteboards [V/U] |

### 3.10 Mem

| Aspect | Findings |
|---|---|
| Core | Folderless notes, collections, semantic Deep Search, clipper, email-in, calendar. Offline-first rebuild (Mem 2.0, Oct 2025) [V] |
| AI | **Mem Agent** (Jul 2026): proactive briefs before meetings, open-loop nudges, routines, voice mode [V/3P] |
| MCP | Official hosted server with OAuth and 24 tools [V] |
| Platforms | Mac, Windows, iOS, web; **no Android** [V/3P] |
| Pricing | Seven metered tiers since Aug 2026: Pro is $29 for 100 messages a month, rising to $199 [V] |
| Weaknesses | Very low caps; pricing changed twice in 6 weeks; not end-to-end encrypted [V] |
| Direction | An always-on agent priced by usage |

### 3.11 Short notes on the rest

- **AFFiNE** (open source, 73.5k stars):
  - Docs plus an infinite whiteboard, databases with a calendar view, Google Calendar and CalDAV, importers for Notion, Obsidian, Bear and OneNote [V].
  - **Official remote MCP** at `/api/workspaces/{id}/mcp`, with revocable bearer tokens per workspace; read-only by default [V]. This is the closest model to the server Folevi should build.
  - The backend licence isn't truly open [V].
- **Anytype:**
  - End-to-end encrypted, peer-to-peer and self-hostable, with a local API and an official Agents Skill [V].
  - No built-in AI. Complaints about complexity and sync speed [V].
- **Logseq:**
  - Split in Apr 2026 into "OG" (Markdown, maintenance only) and a DB version still in beta, with fears of data loss [V].
  - CLI and MCP on the roadmap [V].
- **AppFlowy:**
  - Flutter plus Rust, not Electron; local AI through Ollama [V].
  - The open self-hosted backend is unsupported; the maintained backend is closed, and Pro costs $16 to $20 [V].
- **Reflect:**
  - Forked in Jul 2026: Reflect Open (MIT, local Markdown, BYOK AI, Mac and iPhone) plus Reflect Classic (end-to-end encrypted cloud) [V].
- **Agenda:**
  - Native date-centric notes, on-device Apple Intelligence Q&A, and an **official built-in MCP server on macOS** [V].
- **NotebookLM, now Gemini Notebook:**
  - Free, source-grounded research with Audio and Video Overviews, slides, flashcards and code execution [V/3P].
  - Not a notes app, and no official MCP [V].
- **Granola:**
  - Sets the bar for bot-free meeting notes; Business is $14 per user [V].
  - Official MCP [3P].
- **Microsoft Loop:**
  - Live components inside Teams and Outlook. Copilot needs a work licence [V].
  - No desktop app, no offline, and still in preview for personal accounts [V].

### 3.12 Patterns across the market (October 2026)

**Table stakes now**

- An official MCP server.
- An agent that edits across pages with review.
- Model choice or BYOK.
- Kanban views over notes.
- Native mobile apps.
- Some form of meeting capture.

**The 2026 frontier**

- Proactive and scheduled agents: Mem Agent, Tana scheduled agents, Notion Custom Agents.
- System-audio meeting capture without a bot: Mem, Capacities, Tana, Granola.
- Two-way MCP, as Tana does.
- Agent-friendly CLIs: Obsidian, Heptabase, Reflect, Bear.

**Where the market is weak**

- Offline in the browser.
- Predictable AI pricing.
- Small-team pricing.
- Product stability: Mem, Tana, Reflect and Logseq all forked, renamed or repriced in 2026.
- Privacy, among AI-heavy apps.

**Electron is normal.** Notion, Obsidian, Capacities, Tana, Heptabase, AFFiNE and Anytype all ship Electron desktop apps [V/3P/U]. Folevi's shell is at parity on technology. What's behind is distribution and native OS hooks.

---

## Part 4. Competitive feature matrix

Key: ✓ yes · ◐ partial or limited · ✗ no · ? not confirmed. Competitor cells come from Part 3 sources; cells marked ? had no reliable source and should not be cited publicly.

### A. Essential

| Feature | Folevi | Notion | Obsidian | Craft | Apple Notes | Bear | Capacities | Heptabase | AFFiNE |
|---|---|---|---|---|---|---|---|---|---|
| Block editor | ✓ | ✓ | ◐ Markdown | ✓ | ◐ rich text | ◐ Markdown | ✓ | ✓ | ✓ |
| Nested pages | ✓ | ✓ | ◐ folders | ✓ | ✗ | ✗ | ◐ objects | ◐ cards | ✓ |
| Folders / hierarchy | ◐ 1 level | ✓ | ✓ | ✓ | ✓ | ◐ nested tags | ◐ types | ◐ | ✓ |
| Full-text search | ✓ keyword | ✓ | ✓ | ✓ | ✓ | ✓ OCR | ✓ | ✓ | ✓ |
| Backlinks | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |
| To-dos / tasks | ✓ | ✓ | ◐ | ✓ | ◐ checklists | ◐ | ✓ Pro | ✓ | ◐ |
| Templates | ✓ 26 + own | ✓ | ✓ | ✓ | ✗ | ? | ✓ | ? | ✓ |
| Version history | ✓ 30 d + named | ✓ | ◐ Sync | ✓ | ✗ | ? | ✓ Pro | ? | ? |
| Markdown export | ✓ | ✓ | ✓ native | ✓ | ✓ (26) | ✓ | ✓ | ◐ | ✓ |
| Import from other apps | ◐ MD only | ✓ | ✓ Importer [U] | ✓ | ◐ MD | ? | ? | ◐ Readwise | ✓ 4 apps |
| Offline | ✓ web + Mac (docs) | ◐ apps only | ✓ | ✓ / ◐ web | ✓ | ✓ | ✓ | ✓ | ✓ |
| Native mobile apps | ✗ (responsive web) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Real-time co-editing | ◐ block-level | ✓ | ✗ | ✓ [U] | ✓ | ✗ | ✗ | ✓ | ✓ |
| Public sharing | ✓ links, expiry, password | ✓ Sites | ◐ Publish (paid) | ✓ | ◐ | ✗ | ? | ? | ✓ [U] |

### B. Advanced

| Feature | Folevi | Notion | Obsidian | Craft | Apple Notes | Bear | Capacities | Heptabase | AFFiNE |
|---|---|---|---|---|---|---|---|---|---|
| Database views | ◐ table/gallery/kanban | ✓ 10+ views | ✓ Bases + kanban | ✓ table/gallery/kanban | ✗ | ✗ | ✓ queries | ◐ table/kanban | ✓ + calendar |
| Calendar / timeline view of data | ✗ (tasks calendar only) | ✓ | ? | ◐ system calendar | ✗ | ✗ | ✓ calendar | ◐ journal | ✓ |
| Formulas / rollups | ✗ | ✓ | ◐ Bases | ? | ✗ | ✗ | ? | ✗ | ? |
| Whiteboard / canvas | ◐ strokes | ✗ [U] | ✓ Canvas | ✓ | ◐ drawing | ◐ sketch | ✗ | ✓ core | ✓ core |
| Flowcharts / diagrams | ✓ native + Mermaid + AI | ? | ◐ Mermaid | ? | ✗ | ✓ Mermaid | ? | ◐ | ✓ Mermaid |
| Audio recording + transcription | ✓ (14 MB AI limit) | ✓ meeting notes [U] | ✗ | ? | ✓ | ✗ | ✓ system audio | ✓ credits | ◐ |
| PDF annotation | ✗ | ✗ [U] | ◐ plugins | ? | ◐ markup | ✗ | ✓ | ✓ | ? |
| Recurring tasks | ✗ | ✓ [U] | ◐ plugins | ? | ◐ via Reminders | ✗ | ? | ? | ? |
| Push/email reminders | ◐ in-app + Mac | ✓ [U] | ◐ plugins | ✓ reminders | ✓ | ✗ | ? | ? | ? |
| Guests + page permissions | ✓ free guests | ✓ | ✗ | ◐ Spaces | ◐ per note | ✗ | ✗ | ✓ free collaborators | ✓ |
| Comments | ✓ threads, no reactions | ✓ | ✗ | ✓ [U] | ✗ | ✗ | ✗ | ? | ✓ [U] |
| Author-attributed history | ✓ per line | ◐ [U] | ✗ | ? | ◐ highlights | ✗ | ✗ | ? | ? |

### C. Modern experience

| Feature | Folevi | Notion | Obsidian | Craft | Apple Notes | Bear | Capacities | Heptabase | AFFiNE |
|---|---|---|---|---|---|---|---|---|---|
| Command palette + slash menu | ✓ | ✓ | ✓ | ✓ | ✗ | ◐ | ✓ | ✓ | ✓ |
| Rich theming / design | ✓ 57 themes + page style | ◐ | ✓ community themes | ✓ | ✗ | ✓ 28 themes | ◐ | ◐ | ◐ |
| Offline in the browser | ✓ | ✗ | n/a | ◐ setup | ✗ | ◐ beta | ? | ? | ✓ [U] |
| Global quick capture | ✓ Mac ⌥Space | ? | ◐ iOS widgets | ✓ Quick Entry | ✓ system | ✓ | ✓ messengers | ? | ? |
| Web clipper | ✗ | ✓ | ✓ | ? | ◐ share sheet | ✓ | ✓ | ✓ web cards | ? |
| Email to note | ✗ | ? | ✗ | ? | ✗ | ✗ | ✓ | ? | ? |
| Graph view | ✓ Pro (entities) | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ [U] | ◐ whiteboards | ? |
| Live carets | ✗ | ✓ | ✗ | ✓ [U] | ✓ | ✗ | ✗ | ✓ [U] | ✓ [U] |
| Tabs | ✓ | ✓ [U] | ✓ | ? | ✗ | ✗ | ✓ | ✓ | ? |

### D. AI and automation

| Feature | Folevi | Notion | Craft | Apple Notes | Capacities | Heptabase | Mem | Tana | AFFiNE |
|---|---|---|---|---|---|---|---|---|---|
| Chat over notes with citations | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Agent edits with approval/undo | ✓ approve + undo | ✓ Suggest edits | ✓ background | ✗ | ✓ review | ◐ snapshots | ◐ version rollback | ✓ proposals | ◐ |
| Semantic search | ◐ in chat, Pro only | ✓ | ? | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ [U] |
| Writing tools | ✓ | ✓ | ✓ | ✓ on-device | ✓ | ✓ | ✓ | ✓ | ✓ |
| Meeting summary | ✓ | ✓ | ? | ✓ | ✓ | ? | ✓ | ✓ live | ? |
| System-audio meeting capture | ✗ | ✓ [U] | ? | ✓ calls | ✓ | ? | ✓ | ✓ | ◐ |
| Web research | ✓ | ✓ Business | ? | ✗ | ◐ links | ? | ? | ? | ? |
| Study tools | ✓ (no SRS) | ✗ | ✗ | ✗ | ✗ | ✓ Tutor | ✗ | ✗ | ✗ |
| Proactive / scheduled AI | ◐ digests | ✓ Custom Agents | ◐ background | ◐ Siri | ✗ | ✗ | ✓ Mem Agent | ✓ scheduled | ✗ |
| Model choice | ✗ | ✓ | ◐ tiers | ✗ | ✓ | ✓ Premium | ✗ | ✓ | ◐ |
| BYOK | ✗ | ◐ ChatGPT billing | ✓ | ✗ | ✗ | ◐ transcription | ✗ | ✗ | ◐ experimental |
| On-device AI | ✗ | ✗ | ✓ free | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Predictable AI price | ✓ fixed monthly credits | ✗ credits | ◐ sessions | ✓ free | ◐ opaque budget | ◐ credits | ✗ metered | ◐ credits | ◐ add-on |

### E. Integrations and connectivity

| Feature | Folevi | Notion | Obsidian | Craft | Apple Notes | Bear | Capacities | Heptabase | AFFiNE |
|---|---|---|---|---|---|---|---|---|---|
| Official MCP server | ✗ | ✓ remote | ✗ (CLI) | ✓ remote | ✗ | ✓ local | ✓ | ✓ remote | ✓ remote |
| Public API | ✗ | ✓ | ◐ CLI/plugins | ✓ | ✗ | ◐ x-callback/CLI | ✓ Pro | ◐ CLI | ✗ removed |
| Webhooks | ✗ | ✓ | ✗ | ? | ✗ | ✗ | ? | ✗ | ✗ |
| Zapier / automation | ✗ | ✓ | ✗ | ✓ n8n guides | ✗ | ✗ | ? | ✗ | ✗ |
| Calendar sync | ✗ | ✓ Notion Calendar | ✗ | ✓ system | ✗ | ✗ | ✓ CalDAV | ✗ | ✓ Google/CalDAV |
| Shortcuts / Siri | ✗ | ? | ◐ | ✓ | ✓ | ✓ | ? | ? | ✗ |
| Deep links / URL scheme | ✗ | ✓ [U] | ✓ | ✓ | ◐ | ✓ | ? | ? | ? |
| SSO / SAML | ✗ | ✓ Business | ✗ | ? | n/a | n/a | ✗ | ? | ? |

### F. Differentiating

| Trait | Folevi | Best rival | Notes |
|---|---|---|---|
| Expressive note themes that restyle text, highlights and blocks | ✓ 57 | Bear (28 themes, app-wide) | Folevi themes are per note and collaborative |
| No-AI plan priced below $2 | ✓ Core $1.99 | Bear Pro $2.99 (no AI) | A rare, honest position |
| Offline editing on the web | ✓ | AFFiNE [U] | Notion, Craft and Loop are weak here |
| Free guests with per-page permissions | ✓ | Heptabase free collaborators, Notion guests | Strong for freelancers and clients |
| Per-line author attribution in history | ✓ | Apple Notes highlights | Folevi's is stronger |
| Flowcharts with AI, plus a Mermaid round trip | ✓ | Bear/Evernote Mermaid, AFFiNE | A visible "wow" feature |
| Built-in study tools | ✓ | Heptabase Tutor, NotebookLM | Needs spaced repetition to be complete |
| No third-party trackers | ✓ | Reflect Open, Obsidian | Worth marketing |

---

## Part 5. Missing features and gaps

Each gap is rated by how much it costs Folevi today.

### Critical (losing deals or users now)

1. **MCP / agent access.** Every major rival markets one. Folevi's own compare page already cites Bear's MCP as a competitor feature (`apps/web/src/components/marketing/content/compare.tsx:482`).
2. **Payments not live.** The product can't monetise.
3. **Task basics.** Recurrence, natural-language dates, and reminders that reach you when the tab is closed.
4. **Mobile.** No app-store presence. A responsive PWA without web push can't remind or capture well on phones.

### High (felt weekly)

5. **Capture.** No clipper, email-in or share target. The Mac global shortcut is the only fast path, and the Mac app isn't distributed.
6. **Importers.** Notion and Evernote are where switchers come from, and Folevi only accepts Markdown.
7. **Collaboration fidelity.** The 2.5 s delay, conflicts inside a block, and no carets.
8. **Search.** ⌘K is keyword-only and scope-bound, and semantic search is hidden inside AI chat.
9. **Calendar.** Tasks only; no feed or external calendars; no week view.

### Medium (expected by power users)

10. Embeds (video, Figma, Loom, Maps).
11. Collection calendar view.
12. Nested folders.
13. Copying between Personal and a workspace.
14. DOCX in AI attachments and import.
15. Spaced repetition.
16. Passkeys.
17. Comment reactions.
18. Long recordings and system-audio capture for meetings.
19. Proactive Foli AI.

### Low or deliberately skipped (see Part 13, "What to avoid")

20. Formulas and rollups.
21. Columns.
22. Synced blocks.
23. Inline math.
24. Whiteboard shapes.
25. End-to-end encryption.
26. On-device AI.
27. Model choice and BYOK.
28. SSO/SAML (until a Business tier exists).
29. Windows and Linux builds.
30. Localisation.

### Inconsistencies found during research

These are not Folevi gaps but should be fixed in `compare.tsx`:

- Notion auto-downloads offline pages only on Business and Enterprise, not on paid plans in general [V].
- Evernote's AI may be Advanced-only [3P]. Check by hand before claiming AI on every plan.
- The Craft help center and pricing page disagree ($10 vs $8 for Plus) [V].
- An "MCP / agent access" row would currently count against Folevi. Add it after the MCP server ships.

---

## Part 6. Top 20 easy wins

These are ordered by priority, then by effort. Every item reuses something that already exists in the codebase. Libraries named are free and open source.

### 1. Natural-language dates

- **Problem:** Quick Add and to-do details need explicit date fields [V]. Typing "call Sam tomorrow 3pm" doesn't schedule anything.
- **Solution:**
  - Parse the text with `chrono-node` (MIT) on the client in `apps/web/src/components/app/QuickAddTask.tsx` and in the to-do text. Show a highlighted chip ("Tomorrow 15:00") that can be dismissed, and on confirm set `dueDate`/`dueTime` and strip the phrase.
  - Support "every Monday" once recurrence exists (#5).
- **User value:** High; it is used dozens of times a week.
- **Complexity:** Low.
- **Effort:** S (2 to 3 days including tests).
- **Dependencies:** None.
- **Competitive impact:** Brings Folevi level with Todoist-style capture, which Notion, Craft and Apple Reminders users expect.
- **Priority:** **P0**

### 2. Faster co-editing when others are present

- **Problem:** Block saves wait 2.5 s even when a collaborator is watching, so co-editing feels laggy.
- **Solution:**
  - Make the flush delay depend on presence: about 400 ms when `presence` shows another active viewer in the same note, and 2.5 s when you're alone.
  - Implement it in `apps/web/src/lib/sync/engine.ts` (`scheduleFlush(BLOCK_SAVE_DELAY)` at l.325/373/390) with a `setCollaborative(boolean)` that `DocumentView.tsx` drives from presence.
  - Keep the earliest-wins flush rule.
- **User value:** High for teams.
- **Complexity:** Low.
- **Effort:** S.
- **Dependencies:** None.
- **Competitive impact:** Closes most of the perceived gap with Notion and Craft without a CRDT.
- **Priority:** **P0**
- **Trade-off:** More writes only while two people share a note. That is the margin cost the 2.5 s batching was added to avoid, but it is scoped to the case where the value is real.

### 3. Email reminders

- **Problem:** Reminders only reach someone with Folevi open, or with the Mac app running [V].
- **Solution:**
  - In `tasks.processReminders` (`convex/tasks.ts:366`, every-minute cron), also send a Mailtrap email using a new template in `packages/email`.
  - Add a per-user preference in Settings → Notifications: in-app, email, or both.
  - Emails show the task text only and link to the note. That is a policy change: today's emails never include note text, so ask the owner whether task text is acceptable or whether the email should say only "You have a reminder".
- **User value:** High.
- **Complexity:** Low.
- **Effort:** S.
- **Dependencies:** Email infrastructure (exists).
- **Competitive impact:** Table stakes.
- **Priority:** **P0**

### 4. Private iCal feed of tasks

- **Problem:** Dated tasks don't show up in the user's real calendar.
- **Solution:**
  - Add a tokenised HTTP route in `convex/http.ts`: `GET /ical/{token}.ics`. It returns VTODO or all-day VEVENT entries for tasks with a due date, in the user's scopes, read-only.
  - Settings → Calendar shows "Subscribe in Google Calendar / Apple Calendar" with a copy button and a rotate-token button.
  - Store a hashed token in a new `calendarFeeds` table.
- **User value:** High.
- **Complexity:** Low.
- **Effort:** S.
- **Dependencies:** None.
- **Competitive impact:** Gets most of the value of calendar sync for about 1/10 of the effort of OAuth calendar integration.
- **Priority:** **P1**

### 5. Recurring tasks

- **Problem:** There is no recurrence anywhere [V].
- **Solution:**
  - Add an optional `repeat` prop to the to-do block in `packages/editor-schema/spec/folevi-blocks.v1.json`. This is an additive optional field, so schema v1 stays compatible; confirm against `docs/EDITOR_SCHEMA.md`.
  - The value is a small RRULE subset: daily, weekdays, weekly on a set of days, monthly on a day, yearly, every N.
  - When a repeating to-do is checked, the server-side task projection appends a new unchecked to-do block with the next due date. It goes through SyncEngine, so every client sees it.
  - UI: a "Repeat" row in the task details popover, and natural-language "every …" from #1.
- **User value:** High.
- **Complexity:** Medium.
- **Effort:** M (1 week).
- **Dependencies:** #1 is nice to have.
- **Competitive impact:** Table stakes.
- **Priority:** **P1**

### 6. Search by meaning in ⌘K (Pro tiers)

- **Problem:** Semantic retrieval exists but only inside AI chat [V].
- **Solution:**
  - Add a "Meaning" toggle (or run it automatically when keyword results are few) in `apps/web/src/components/app/CommandPalette.tsx`.
  - It calls a new `search.semantic` query or action that reuses `aiIndex.hybridSearch`, deduplicated to one result per note.
  - Plan-gated the same way as retrieval.
  - Cost: one embedding call per search.
- **User value:** High.
- **Complexity:** Low.
- **Effort:** S.
- **Dependencies:** Existing index.
- **Competitive impact:** Matches Mem's "Deep Search" and Capacities.
- **Priority:** **P1**

### 7. `folevi://` deep links on Mac, with Shortcuts and Raycast recipes

- **Problem:** Nothing outside the app can open a note or start a capture.
- **Solution:**
  - Add `app.setAsDefaultProtocolClient("folevi")` plus an `open-url` handler in `apps/desktop/src/main.ts`, and `protocols` in `electron-builder.yml`.
  - Route through the existing `appUrl()` sanitiser.
  - Support: `folevi://d/{id}`, `folevi://quick-add?text=`, `folevi://new?title=`, `folevi://search?q=`.
  - Document a Shortcuts Quick Action ("Send selection to Folevi") and a Raycast script.
- **User value:** Medium.
- **Complexity:** Low.
- **Effort:** XS to S.
- **Dependencies:** None.
- **Competitive impact:** Gets most of what native Services and Shortcuts would give, nearly for free.
- **Priority:** **P1**

### 8. Embed block

- **Problem:** YouTube, Loom, Figma and Maps links can only be bookmarks [V].
- **Solution:**
  - Add a new `embed` block type in the schema, holding a URL plus a provider.
  - Use a strict provider allowlist that maps to official embed URLs: YouTube with the `youtube-nocookie.com` domain, Vimeo, Loom, Figma, Google Maps, CodePen, Spotify.
  - Render in a sandboxed iframe (`sandbox="allow-scripts allow-same-origin allow-presentation"`) and add the providers to the CSP `frame-src`.
  - Unknown URLs fall back to a bookmark.
  - Pasting an allowlisted URL offers "Embed".
  - Export to HTML as an iframe and to Markdown as a link.
- **User value:** Medium to high.
- **Complexity:** Low to medium.
- **Effort:** M (about 5 days; an editor-schema change needs reducer, export and tests).
- **Dependencies:** None.
- **Competitive impact:** Table stakes against Notion and Craft.
- **Priority:** **P1**

### 9. DOCX support (AI attachments and import)

- **Problem:** Uploading DOCX to AI chat shows "not supported yet", and DOCX can't be imported [V].
- **Solution:**
  - Use `mammoth` (BSD-2) to convert DOCX to HTML, then run the existing HTML paste normaliser (`editor/clipboardHtml.ts`) or `markdownToBlocks`.
  - For AI attachments, convert to text before the model call in `convex/lib/ai/attachments.ts`. It may need a Node action.
  - Accept `.docx` and `.html` in Settings → Data → Import.
- **User value:** Medium.
- **Complexity:** Low.
- **Effort:** S.
- **Dependencies:** None.
- **Competitive impact:** Removes a visible "not supported".
- **Priority:** **P1**

### 10. Email to note

- **Problem:** No email capture.
- **Solution:**
  - Mailtrap Inbound is already wired (`/webhooks/mailtrap-inbound`, `convex/support.ts`).
  - Add a per-user address `n-{token}@in.folevi.com`. Route it by the local part: support mail goes to support, `n-` mail goes to a new `inboundNotes` handler.
  - The handler creates a note in the user's Inbox with sanitised HTML converted to blocks. Attachments upload against the user's storage.
  - Settings shows the address and lets the user rotate it.
- **User value:** Medium.
- **Complexity:** Medium.
- **Effort:** S to M.
- **Dependencies:** DNS for the `in.` subdomain.
- **Competitive impact:** Matches Mem, Evernote and Capacities.
- **Priority:** **P2**
- **Risk:** Spam. Accept only mail from the account's own verified address by default.

### 11. Expose `allowIndexing` on public links

- **Problem:** The feature is built but has no UI [V].
- **Solution:** A "Let search engines find this page" switch in `doc/ShareDialog.tsx`, off by default. Update the copy that says links are never indexed.
- **User value:** Low to medium; helps people who publish.
- **Complexity:** Trivial.
- **Effort:** XS.
- **Dependencies:** None.
- **Competitive impact:** A small step towards "publish".
- **Priority:** **P2**

### 12. "Notes you could link" panel

- **Problem:** `aiGraph.missingConnections` is tested but has no UI [V].
- **Solution:** Show it in the note ••• → Related notes panel (`doc/RelatedPanel.tsx`) for Pro tiers, with a one-click "Add link" that appends a `[[ ]]` in a "Related" line.
- **User value:** Medium.
- **Complexity:** Low.
- **Effort:** S.
- **Dependencies:** Graph (Pro).
- **Competitive impact:** Adds to the Pro AI story ("your notes connect themselves").
- **Priority:** **P2**

### 13. Spaced repetition for flashcards

- **Problem:** Study progress lasts only for a session [V].
- **Solution:**
  - Store per-card review state with `ts-fsrs` (MIT) in a new `studyReviews` table keyed by profile and block id.
  - Add a "Due today: 12 cards" shelf on the Home dashboard, and a review mode inside `components/ai/StudyMode.tsx`.
  - No model calls, so no credits are used.
- **User value:** Medium for students; strongly differentiating.
- **Complexity:** Low to medium.
- **Effort:** M (about 4 days).
- **Dependencies:** None.
- **Competitive impact:** Only Heptabase (Tutor) and NotebookLM come close, and neither has spaced repetition [V].
- **Priority:** **P2**

### 14. Web push for reminders and mentions

- **Problem:** The PWA has no push [V].
- **Solution:**
  - Add VAPID keys, a `pushSubscriptions` table, and send from a Convex Node action using `web-push` (MPL-2.0).
  - Add a push handler to `apps/web/public/sw.js`.
  - Ask permission only after the user sets their first reminder.
  - Works in Chrome, Edge, Firefox and Safari (macOS, and iOS 16.4+ when installed to the Home Screen) [U on current Safari limits].
- **User value:** High on phones.
- **Complexity:** Medium.
- **Effort:** M (about 4 days).
- **Dependencies:** #3 preference UI.
- **Competitive impact:** A partial stand-in for a mobile app.
- **Priority:** **P1**

### 15. Search every scope at once

- **Problem:** ⌘K searches Personal or one workspace [V].
- **Solution:**
  - Add an "All places" scope chip that fans out the existing `search` query per scope the user belongs to, then merges by score. Results are labelled by place.
  - Cap at 5 scopes per query, for read cost.
- **User value:** Medium for people in several workspaces.
- **Complexity:** Low.
- **Effort:** S.
- **Dependencies:** None.
- **Competitive impact:** Small, but it removes friction.
- **Priority:** **P2**

### 16. Comment reactions

- **Problem:** People reply "👍" as a comment.
- **Solution:**
  - Add a `commentReactions` table (comment, profile, emoji from a fixed set of 6) and a hover bar in `doc/Comments.tsx`.
  - No notifications for reactions.
  - Note the "notes show no emoji" rule: this is UI on comments, not note content, so confirm with the owner.
- **User value:** Low to medium.
- **Complexity:** Trivial.
- **Effort:** XS to S.
- **Dependencies:** None.
- **Competitive impact:** Polish.
- **Priority:** **P3**

### 17. Move a task to another page

- **Problem:** `tasks.moveToDocument` exists with no UI [V].
- **Solution:** "Move to…" in the task row menu in `views/TasksView.tsx`, using the existing page picker (`MovePageDialog`).
- **User value:** Low to medium.
- **Complexity:** Trivial.
- **Effort:** XS.
- **Dependencies:** None.
- **Competitive impact:** Small.
- **Priority:** **P3**

### 18. Week view in Calendar

- **Problem:** Calendar has month and agenda only [V].
- **Solution:**
  - Add a 7-column week view with timed tasks placed by `dueTime` and untimed tasks in an all-day row.
  - Drag to reschedule reuses the month view's logic in `views/CalendarView.tsx`.
- **User value:** Medium.
- **Complexity:** Low to medium.
- **Effort:** S to M.
- **Dependencies:** None.
- **Competitive impact:** Expected of any planner.
- **Priority:** **P2**

### 19. Passkeys and a breached-password check

- **Problem:** No passkeys, and no breached-password check [V].
- **Solution:**
  - Use the Better Auth passkey plugin (a separate package since 1.6; check its compatibility with `@convex-dev/better-auth` 0.12.5 first).
  - Add an HIBP Pwned Passwords k-anonymity check on sign-up and password change. It is free, sends only the first 5 hex characters of the SHA-1, and Better Auth has a `haveIBeenPwned` plugin [U on its exact name and version].
  - In the Electron shell, passkeys are device-bound and not synced through iCloud Keychain [V]. Sign in through the system browser with the existing PKCE `/connect` flow instead.
- **User value:** Medium.
- **Complexity:** Low to medium.
- **Effort:** S to M.
- **Dependencies:** None.
- **Competitive impact:** A trust signal.
- **Priority:** **P2**

### 20. PWA share target and a bookmarklet

- **Problem:** No way to send a page or text into Folevi from a phone or another browser tab.
- **Solution:**
  - Add `share_target` to `apps/web/src/app/manifest.ts`, using POST to `/quick-add` with title, text and url. This works on Android Chrome and desktop Chromium; iOS Safari doesn't support it [U].
  - Add a "Save to Folevi" bookmarklet on the Help page that opens `/quick-add?url=…` in a popup.
  - The existing Quick Add creates the note or task.
- **User value:** Medium.
- **Complexity:** Trivial.
- **Effort:** XS to S.
- **Dependencies:** None.
- **Competitive impact:** A cheap stand-in until the web clipper (7.8) ships.
- **Priority:** **P2**

**Batch plan.** Items 1, 2, 3, 11, 12, 16 and 17 fit in one sprint, roughly 8 to 10 working days for one developer with Claude Code.

---

## Part 7. Advanced feature opportunities

Each of these is bigger than an easy win. They are listed in the order recommended.

### 7.1 Remote MCP server (see Part 8 for the full design)

L (3 to 4.5 weeks to reach the directory). Foundational: the same OAuth and token layer serves a public API, Shortcuts, widgets and a clipper.

### 7.2 Foli AI routines (proactive AI)

- **What:** Generalise `aiDigest` into Routines the user schedules or triggers:
  - Morning brief: today's tasks, notes changed by others, open questions.
  - Weekly open loops: unchecked to-dos older than 7 days, unanswered questions, contradictions from the graph.
  - Meeting prep: a brief for a note titled after a calendar event. This needs calendar data, so it is phase 2.
  - Each routine writes a note and sends a notification, and later an email or push.
- **Why:** Mem Agent, Tana scheduled agents and Notion Custom Agents define the 2026 frontier. Folevi has the pieces: digests, suggestions heuristics, the graph's contradictions, and Catch me up.
- **How:**
  - Add a `routines` table (kind, schedule, scope, lastRunAt, enabled).
  - Reuse the 15-minute digest cron.
  - Each kind is a prompt plus a set of read tools. Runs are capped in credits, and the estimate is shown before enabling.
  - Never write into existing notes. Output is always a new note in the Inbox, or a proposal.
- **Effort:** M to L (2 to 3 weeks).
- **Risk:** Credit burn on Pro (180 credits). Mitigate with a monthly routine budget and model selection (flash-lite where possible).

### 7.3 Meeting capture: system audio on Mac, long recordings everywhere

- **What:** Record both sides of a call (mic plus system audio) from the Mac app, then transcribe and summarise recordings of any length.
- **How:**
  - Long recordings: move transcription to the Gemini Files API instead of 14 MB inline, which removes the cap. This applies to all platforms.
  - System audio: Electron's `desktopCapturer`/`setDisplayMediaRequestHandler` with macOS loopback audio [U: confirm in the Electron 44 typings that `audio: 'loopback'` is supported on macOS, which needs macOS 13+ and the screen recording permission].
  - The web keeps mic-only recording.
- **Why:** Granola, Mem, Capacities and Tana all moved here in 2025 and 2026.
- **Effort:** M to L. **Risk:** permissions UX, the legal duty to tell people they are being recorded, and transcription cost per hour. Price long recordings in credits, and show the estimate first.

### 7.4 Ship the Mac app properly

- **What:**
  - Developer ID Application signing and notarisation.
  - A universal or x64 build.
  - Auto-update with `electron-updater` from a static host such as Cloudflare R2 or GitHub Releases. Built-in `autoUpdater` with update.electronjs.org needs a public repo [U].
  - Deep links (#7).
  - Drag a note out as `.md` (`webContents.startDrag`) [V typings].
  - Then update `AVAILABILITY`.
- **Effort:** M (about 1 week plus Apple account setup, about $99 a year).
- **Skip:** the Mac App Store. The sandbox breaks global shortcuts and login items [U].

### 7.5 Native macOS extensions (only after 7.4 and Part 8)

- Spotlight (Core Spotlight via a native addon), a WidgetKit widget, an App Intents extension, and a share extension.
- Each is a Swift `.appex` costing 1 to 2 weeks plus signing work. They read data through the MCP or API OAuth tokens [V/U per Part 8 research].
- Value is real but narrow. Do them only if Mac usage justifies it.
- **macOS 27** adds Siri entity schemas and a Spotlight semantic index via App Intents [V], so the intents extension is the most strategic of the four.

### 7.6 Collaboration upgrade, in stages

1. Presence-driven flush (Easy win #2).
2. **Live carets:** broadcast `{blockId, anchor, head}` over the existing presence heartbeat at about 5 Hz while typing. Render coloured carets with name flags (the marketing site's hero already has this design). M.
3. **Character-level merge inside a block:** run Yjs (`Y.Text` per text block) only for blocks with two or more concurrent editors, and store the block's text through the existing op as before. An alternative is OT on the block's text using ProseMirror steps rebased on the server. Both are L to XL, and the riskiest change in this document.
   - Recommendation: stages 1 and 2 now. Defer stage 3 until conflict telemetry shows a need. Add a counter for `conflict` events per 1,000 edits in `dailyMetrics`.

### 7.7 Importers

- **Notion:** the Markdown and CSV export ZIP. Map pages to notes, sub-pages to nested pages, CSVs to collections, and callouts, toggles and to-dos to blocks. M.
- **Evernote:** ENEX XML with ENML. Notebooks become folders, tags become tags, resources become files. M.
- Both run in the browser like the current import (`doc/importBundle.ts`), reuse the warnings report, and stay under the existing batch limits.
- These are the cheapest acquisition features Folevi can build: they target users who are actively unhappy with price rises (Evernote) or AI pricing (Notion).

### 7.8 Web clipper (Manifest V3 browser extension)

- Clip the selection, simplified article (Readability, Apache-2.0), or bookmark to the Inbox or a chosen note.
- Auth uses the OAuth tokens from Part 8, with the `notes:write` scope limited to create and append.
- Chrome first, then Firefox and Safari via `xcrun safari-web-extension-converter`.
- M to L. Depends on Part 8 auth.

### 7.9 Collections: calendar view, then light formulas

- A calendar view over a date property, reusing the CalendarView grid. M.
- Formulas and rollups: defer. They are high complexity for a minority of users, and Notion and AppFlowy own this space.

### 7.10 Public API and outbound webhooks

- A by-product of Part 8: REST endpoints over the same tool functions (`GET /api/v1/notes`, `POST /api/v1/notes`), with personal access tokens for scripts.
- Webhooks for note created/updated and task completed, with HMAC signatures and retries.
- M after MCP. Unlocks Zapier and n8n.

### 7.11 iPhone app decision

- **Options:**
  - (a) Improve the PWA: push (#14), share target, offline. Cost S to M.
  - (b) A Capacitor wrapper around the web app. M to L, and gets App Store presence.
  - (c) Native Swift reusing `sync.pullJson`/`pushJson` and PKCE. XL.
- **Recommendation:** (a) now. Decide between (b) and (c) after MCP and payments, based on mobile web traffic share. Note `docs/FUTURE_IOS.md` already marks it out of scope.

### 7.12 Offline for everything

- Move comments, folders, tags and task-field edits into the op queue.
- The sync protocol already has typed ops; each new op type needs a reducer case, server handler and golden scenario.
- L. This is a real differentiator ("fully offline in the browser"), but no user is asking for it yet. P2.

---

## Part 8. MCP and AI integration strategy

### 8.1 Decision summary

| Question | Recommendation |
|---|---|
| Server, client or both? | **Server now. Client later**, or never |
| Transport | **Streamable HTTP, remote and hosted.** No local stdio companion: the data lives in Convex, so a local process would only proxy the same API |
| Spec version | Support **2026-07-28** (stateless, `server/discover`) **and** 2025-11-25 (`initialize`) on one endpoint, which the spec calls dual-era. Legacy clients can't talk to a modern-only server [V] |
| Where it runs | A Convex HTTP action at `/mcp`, behind a Next.js rewrite at `https://app.folevi.com/mcp`, mirroring the existing `/api/auth/*` proxy |
| Auth | OAuth 2.1 with PKCE (S256) via **Better Auth `@better-auth/oauth-provider` 1.6.33**, matching the installed better-auth 1.6.33. Dynamic Client Registration now. CIMD (`@better-auth/cimd`) after upgrading to better-auth 1.7, once `@convex-dev/better-auth` allows it [V] |
| Permissions | Scopes `notes:read`, `notes:write`, `tasks:read`, `tasks:write`, plus a **place picker at consent** (Personal and/or chosen workspaces) and "Include pages shared with me" off by default |
| Plans | Owner decision. Suggested: **read on every plan** (keyword search; semantic search where the plan already has it), **writes on paid plans**. MCP uses the client's model, so it costs no Foli AI credits |
| Distribution | Claude Connectors Directory, ChatGPT app (developer mode first), and setup docs for Claude Code, Cursor, VS Code and Gemini CLI |

**Why it's the top priority.**

1. It is table stakes in 2026: ten direct rivals ship one [V].
2. It turns Claude, ChatGPT and Cursor into acquisition channels.
3. It is a "bring your own model" story that costs Folevi nothing in AI spend.
4. Folevi already has the hard parts:
   - read tools (`convex/lib/ai/tools/read.ts`);
   - hybrid search;
   - `blocksToMarkdown`/`markdownToBlocks`;
   - proposal-safe writes through `SyncEngine` with snapshots and undo (`convex/lib/ai/tools/execute.ts`);
   - `untrusted()` wrapping;
   - rate limits;
   - a hand-rolled PKCE flow, which shows the auth patterns are understood.

### 8.2 Architecture

```
Claude / ChatGPT / Cursor / Claude Code
        │  HTTPS, Authorization: Bearer <access token>
        ▼
app.folevi.com/mcp ──(Next rewrite)──► Convex HTTP action  convex/mcp/http.ts
        │                                   │ verify JWT: iss, aud = https://app.folevi.com/mcp, exp, scope
        │                                   │ load mcpGrants row: not revoked, profile active, plan allows
        │                                   ▼
        │                              JSON-RPC router (dual-era)  convex/mcp/rpc.ts
        │                                   │ server/discover | initialize | tools/list | tools/call | resources/* | prompts/*
        │                                   ▼
        │                              Tool handlers  convex/mcp/tools/*.ts
        │                                   │ reads: READERS + aiIndex.hybridSearch with ReadEnv limited to grant places
        │                                   │ writes: SyncOps → new SyncEngine(ctx, profile, "mcp:" + clientId)
        ▼                                   ▼
/.well-known/oauth-protected-resource/mcp   mcpEvents (user-visible audit), rateLimit (per grant + per profile)
/.well-known/oauth-authorization-server  ──► Better Auth oauth-provider (/api/auth/oauth2/*)
/oauth/consent (Next page)                   consent: client name + redirect host, scopes, place picker, toggles
Settings → Connected apps                    list grants, last used, scopes, places, Revoke
```

**Spike first (2 to 3 days).** Two unknowns:

1. Does `@modelcontextprotocol/server` 2.x or `mcp-handler` run in Convex's V8 runtime? If not, hand-write the JSON-RPC layer: about 400 to 600 lines for discover, initialize, tools, resources and prompts.
2. Can the oauth-provider's `jwt()` requirement live beside the Convex plugin's own JWT/JWKS?

Test both with MCP Inspector and `claude mcp add --transport http`.

### 8.3 Tool surface (v1)

All tools have a `title`, annotations (required by Anthropic's directory [V]), `outputSchema` with `structuredContent`, and a text fallback. Results include `https://app.folevi.com/d/{id}` links. Tool descriptions are static strings: nothing user-written is ever interpolated into them.

| Tool | Scope | Annotation | Implementation |
|---|---|---|---|
| `list_places` | notes:read | readOnly | Personal plus workspaces in the grant |
| `search_notes(query, place?, limit≤20)` | notes:read | readOnly | Keyword `search` for every plan; `hybridSearch` where the plan has vectors. Returns id, title, snippet, url, updatedAt |
| `get_note(id, maxChars≤40k)` | notes:read | readOnly | `blocksToMarkdown`, wrapped in `untrusted()`, plus title, folder, tags, url |
| `list_recent_notes(place?, limit)` | notes:read | readOnly | Existing recent query |
| `list_folders`, `list_tags` | notes:read | readOnly | READERS |
| `list_tasks(status, dueFrom?, dueTo?, place?)` | tasks:read | readOnly | `tasks.range` and views |
| `create_note(title, markdown, place, folderId?)` | notes:write | not destructive | `markdownToBlocks` → SyncEngine |
| `append_to_note(id, markdown)` | notes:write | not destructive | Snapshot first, then blocks after the last block via `rankBetween` |
| `add_task(text, dueDate?, noteId?)` | tasks:write | not destructive | `tasks.quickAdd` logic |
| `complete_task(id)` / `update_task(id, due?, priority?)` | tasks:write | idempotent | To-do block prop update through SyncEngine, with `baseRevision` |

**Also included:**

- A resource template `folevi://note/{id}` (Markdown).
- A "Weekly review" prompt.

**Left out of v1 on purpose:** delete, move, merge, overwrite, share, public links and invites. These are destructive, or they could be used to send data out.

### 8.4 Write safety

- Every write is a set of SyncOps applied as device `mcp:<clientId>`. Offline clients pull it like any other device's edit, and tasks, links, search and the AI index all update.
- Op ids come from an idempotency key: a hash of the grant, the JSON-RPC id and the arguments. A retried call returns `duplicate`.
- Before an existing note changes, a `documentSnapshots` entry is saved with reason `mcp`, so undo lives in version history.
- Edits are attributed as "Connected app: <name>".
- Edits to existing blocks send `baseRevision`. A conflict returns a tool error ("note changed, fetch again") and never overwrites.
- Consent includes an optional "Only create new notes" toggle.
- Write confirmation relies on client annotations. Claude, ChatGPT and Cursor prompt for each write, and ChatGPT starts new actions disabled [V]. Don't depend on elicitation: it was reshaped in 2026-07-28 and client support varies.

### 8.5 Security and privacy

- **Isolation.** Every note is re-checked through `documentAccess` as the profile, plus the grant's place filter. Inaccessible notes return `not_found`. Responses use `cacheScope: "private"`.
- **Prompt injection.** Notes, especially other people's shared pages, are untrusted input to the *client's* model. Mitigations:
  - `untrusted()` markers;
  - no exfiltration tools;
  - shared-with-me off by default;
  - read-only by default;
  - a help article on the "lethal trifecta" (private data plus untrusted content plus an outbound channel) [V].
- **Transport.**
  - 403 for an invalid `Origin` [V].
  - No CORS unless needed.
  - Tokens are never put in query strings.
  - No token passthrough to Gemini or any other service.
- **Tokens.**
  - Access JWTs last about 1 h, with `aud` set to the resource URI.
  - Refresh tokens rotate (`offline_access`).
  - Revoke kills refresh tokens and fails the grant check immediately.
- **Consent screen.**
  - Show the client name *and its redirect host*, marked "unverified app" (DCR metadata is set by the client).
  - Require a fresh session, and TOTP for admins.
- **Audit.** A user-visible `mcpEvents` table (grant, tool, target ids, outcome, time; arguments hashed, never stored raw) shown under Connected apps. Keep `adminAuditLogs` admin-only.
- **Rate limits** (starting values [U]): reads about 300 a minute; searches about 120 a minute (each semantic search costs an embedding); writes about 30 a minute and about 500 a day, per grant and per profile. Input capped with `MAX_OP_MARKDOWN`.

### 8.6 Should Foli AI become an MCP client?

**Not now.** It would bring the lethal trifecta *inside* Folevi's own agent, and it would require a per-user OAuth client with encrypted token storage. Billing arbitrary third-party output in credits is hard, and the support burden is large. Users who want cross-tool AI already have Claude, ChatGPT or Cursor, and those can use Folevi's server.

**Revisit after the server ships** with a short, curated allowlist of read-only connectors (calendar, Drive, Linear). Every result would be wrapped `untrusted`, and writes would still go through the existing preview-and-approve card. Estimated 3 to 5 weeks.

### 8.7 Other AI integration decisions

| Option | Verdict | Why |
|---|---|---|
| Model choice / BYOK | P2, later | The provider adapter (`convex/lib/ai/provider.ts`) makes it feasible, but it complicates credits, support and evaluation. MCP is the better "bring your own model" answer |
| Apple Foundation Models | No (for now) | Swift-only. Results would be Mac-only, which breaks "Mac matches web". Free Private Cloud Compute requires the App Store Small Business Program [V], which Folevi isn't in |
| Chrome built-in AI (Translator, Summarizer, Prompt API) | Progressive enhancement only | Chrome only, large hardware requirements [V], probably absent inside Electron [U] |
| WebGPU local embeddings (transformers.js) | Worth a spike, P2 | Free and offline semantic search for Free and Core plans at no server cost. Needs a separate client-side index, because the vector spaces differ from `gemini-embedding-001` |
| Ollama / local LLM | No | Foli AI runs server-side, and Convex can't reach `localhost` |
| "Folevi skill" file | Yes, XS | A `SKILL.md` describing how to use the Folevi MCP tools well, published next to the docs (Notion and Anytype ship skills [V]) |

### 8.8 MCP effort and phases

| Phase | Scope | Effort |
|---|---|---|
| 0. Spike | SDK in Convex V8 or a hand-rolled RPC; oauth-provider with the Convex plugin; Inspector plus Claude Code test | 2 to 3 days |
| 1. Read-only | Authorization server (DCR, consent with place picker, refresh, revoke), discovery rewrites, `mcpGrants`, Connected apps page, read tools, resource template, rate limits, `mcpEvents`, dual-era protocol, convex-test coverage | 1.5 to 2.5 weeks |
| 2. Writes | create, append and task tools via SyncEngine, idempotency, snapshots, step-up scopes (403 `insufficient_scope`) | about 1 week |
| 3. Distribution | Directory submission (annotations, privacy policy, docs, test account), ChatGPT app, help article, compare-page row | 3 to 5 days |
| 4. CIMD | Better Auth 1.7 with `@better-auth/mcp` and `@better-auth/cimd` | 1 to 2 days, when unblocked |
| Optional | MCP Apps UI (note card, task list) | about 1 week |

---

## Part 9. Innovative and differentiating features

Each idea is described in seven points:

1. **Concept**
2. **Problem**
3. **Why it's different**
4. **How it works**
5. **Effort**
6. **Risks**
7. **Measure of success**

The ideas lean on what Folevi already does unusually well: themes, approval and undo, author-attributed history, offline in the browser, predictable pricing, and study tools.

### 9.1 Change Inbox: one place to review every proposed edit

1. **Concept:** A single review queue for changes that came from Foli AI, connected apps (MCP), email-in and routines. Each change shows Folevi's word-level, author-coloured diff, with Accept, Reject and Undo.
2. **Problem:** As more agents write into notes, people lose track of what changed and why.
3. **Why it's different:** Tana has merge proposals and Notion has Suggest edits, but each one is limited to its own agent [V]. A cross-source inbox with per-line attribution is new.
4. **How it works:**
   - Writes from MCP clients and routines can be marked "propose" instead of "apply". They are stored as pending SyncOp batches, reusing the `AgentRunCard` preview.
   - A new `/review` view plus a badge.
   - Version history already supplies the diff and attribution.
5. **Effort:** M after MCP phase 2.
6. **Risks:** Review fatigue. Default to "apply with undo" for create and append, and "propose" only for edits to existing notes.
7. **Measure:** Share of external writes reviewed within 24 h; undo rate.

### 9.2 Scoped connected apps ("give Claude only this folder")

1. **Concept:** MCP grants limited to chosen folders or pages, not just places.
2. **Problem:** People want AI help on one project without exposing their journal.
3. **Why it's different:** Craft scopes by document or space; most others scope by workspace [V].
4. **How it works:** A `folderIds[]` filter on `mcpGrants`, checked in the same `documentAccess` pass; the folder tree is shown at consent.
5. **Effort:** S on top of MCP phase 1.
6. **Risks:** Notes moved out of a folder silently leave the grant. Show this in Connected apps.
7. **Measure:** Share of grants that use folder scope; conversion of privacy-sensitive users.

### 9.3 No-surprise AI: cost shown before every action

1. **Concept:** Every Foli AI action shows an estimated cost in credits before it runs. The plan shows days of credits left at the current pace.
2. **Problem:** Notion's credit bills and Mem's caps made AI spending a top complaint [3P].
3. **Why it's different:** Nobody in the set shows a per-action estimate [U].
4. **How it works:** Estimates use the credit charges already recorded per feature (`billing.aiUsage`, by feature and day). Show a p50/p90 cost per feature and size in the button tooltip and confirm sheet; add a burn-rate line in Settings → AI.
5. **Effort:** S.
6. **Risks:** Estimates that are wrong erode trust. Show ranges.
7. **Measure:** Fewer support tickets about credits; Pro AI retention.

### 9.4 Themed publishing

1. **Concept:** Public pages and a "Publish as site" option that keep the note theme, with a theme-coloured social card and an optional index page for a folder.
2. **Problem:** Public notes elsewhere look generic. Folevi's 57 themes are its most visible asset.
3. **Why it's different:** Notion Sites and Obsidian Publish use a site-wide look; per-note artwork themes are unique [V Folevi, U others].
4. **How it works:**
   - `/s/[token]` already renders the note. Apply `artVars`/`paletteVars` and add a per-link OG image (the `opengraph-image` pattern exists).
   - Folder publishing = a public link on a folder that lists its notes.
   - Turns on `allowIndexing` (easy win #11).
5. **Effort:** M.
6. **Risks:** Abuse and SEO spam. Rate-limit indexing per account, and allow indexing only on paid plans.
7. **Measure:** Public link views; signups from `/s/` pages.

### 9.5 Notes that schedule themselves

1. **Concept:** After a meeting note, Foli AI proposes dated to-dos with assignees ("Sam: send deck by Friday" becomes a to-do due Friday, assigned to Sam). Accepted items flow to the calendar feed and reminders.
2. **Problem:** Action items stay buried in notes.
3. **Why it's different:** Folevi's to-do block *is* the task. Rivals keep separate task objects or no tasks at all.
4. **How it works:**
   - Extend the meeting-summary tool with `chrono-node` parsing of the extracted items, then a `create_tasks` proposal.
   - Combines easy wins #1, #3 and #4.
5. **Effort:** S once those ship.
6. **Risks:** Wrong dates. Always show them in the proposal before creating.
7. **Measure:** Tasks created per meeting note; completion rate.

### 9.6 Review queue for everything you study

1. **Concept:** Spaced repetition (easy win #13) for flashcards from any note, a "Today's reviews" shelf, and an optional morning nudge.
2. **Problem:** Students generate cards and then never review them.
3. **Why it's different:** NotebookLM and Heptabase generate study material but have no long-term review [V].
4. **How it works:** FSRS scheduling in `studyReviews`; no model calls.
5. **Effort:** M.
6. **Risks:** Scope creep towards an Anki clone. Keep it to the review flow only.
7. **Measure:** Weekly review sessions; student-segment retention.

### 9.7 Open-loops routine

1. **Concept:** A weekly brief of unanswered questions, overdue to-dos, contradictions between notes, and notes that should link but don't.
2. **Problem:** Knowledge bases rot quietly.
3. **Why it's different:** Mem Agent does nudges [V], but Folevi can cite the exact block, and its contradictions come from the graph.
4. **How it works:** Mostly heuristic: `suggestionLines`, `patternItems`, `missingConnections`, graph contradictions. One model call to summarise, and the output is a note.
5. **Effort:** S to M after Routines (7.2).
6. **Risks:** Noise. Cap at 7 items and remember dismissals (already supported).
7. **Measure:** Click-through on items; dismiss rate.

### 9.8 "Since you were away" on every note

1. **Concept:** When you open a shared note that others changed since your last view, a quiet banner offers "See changes", showing the author-coloured diff since your last visit.
2. **Problem:** Team notes change while you're away, and version history is too heavy to check.
3. **Why it's different:** It builds on Folevi's per-line attribution, which is stronger than any rival found [V Folevi].
4. **How it works:**
   - Store `lastViewedRev` per profile and note (presence already tracks visits).
   - Diff the current blocks against the nearest snapshot at or before that revision, using the `version-diff` code.
   - No AI needed; an optional "Summarise changes" costs 1 credit.
5. **Effort:** M.
6. **Risks:** Storage. Reuse snapshots and don't create extra ones.
7. **Measure:** Banner use; fewer "what changed?" comments.

### 9.9 Markdown mirror on Mac

1. **Concept:** The Mac app can keep a read-only folder of your notes as Markdown files on disk, updated as they sync, with no lock-in.
2. **Problem:** Lock-in fear is the main reason users choose Obsidian or Reflect Open [V].
3. **Why it's different:** Logseq DB has a read-only Markdown mirror [V]; no cloud block editor does this [U].
4. **How it works:**
   - The Electron main process subscribes through the existing bridge, writes `blocksToMarkdown` output into `~/Folevi/<Place>/<Folder>/<Title>.md`, and debounces writes.
   - Opt-in, with a folder picker. Spotlight and Quick Look then index the files for free, which also covers part of 7.5.
5. **Effort:** M.
6. **Risks:** Privacy, because note text is on disk; make this explicit at opt-in. File-name collisions.
7. **Measure:** Opt-in rate; it can be cited in marketing against lock-in.

### 9.10 Guest client portals

1. **Concept:** A themed page shared with a guest becomes a lightweight client portal: comments, a task list assigned to them, and a "what changed" banner (9.8).
2. **Problem:** Freelancers stitch together Notion pages, email and Trello for each client.
3. **Why it's different:** Folevi guests are free and have page-level grants [V]. Notion charges for guests above certain limits [U].
4. **How it works:** Mostly packaging: a template, assigning to guests, and email reminders for guests.
5. **Effort:** S to M.
6. **Risks:** Support load from guests who have no account.
7. **Measure:** Guest invites per workspace; conversions of guests to paid.

### 9.11 Outline ↔ flowchart round trip

1. **Concept:** Turn any bulleted outline into a flowchart and back. The flowchart stays linked to the outline and updates with it, if the user chooses.
2. **Problem:** Diagrams go stale as notes change.
3. **Why it's different:** Folevi already has native flowcharts with AI and a Mermaid round trip [V]. Rivals have Mermaid only.
4. **How it works:**
   - Deterministic conversion of nesting into nodes and edges, using the tidy auto-layout that exists. AI is optional, for labelling edges.
   - "Linked" mode re-renders on outline changes.
5. **Effort:** M.
6. **Risks:** Unclear UX when someone edits both sides. Make the outline the source of truth.
7. **Measure:** Flowcharts created from outlines.

### 9.12 Offline-first semantic search for every plan

1. **Concept:** Free and Core get on-device semantic search and related notes using a small WebGPU embedding model. Pro keeps server-side hybrid search.
2. **Problem:** Keyword search misses things, and server vectors cost money.
3. **Why it's different:** AppFlowy does local AI through Ollama, which requires setup [V]. This runs in the browser with no setup.
4. **How it works:** transformers.js v4 with a MiniLM-class model, an IndexedDB vector store over cached notes, and lazy download after opt-in [V-ish].
5. **Effort:** M to L.
6. **Risks:** A 20 to 300 MB download, battery use, and different quality on each device.
7. **Measure:** Search success rate on Free; upgrade rate to Pro.

---

## Part 10. Prioritised backlog with weighted scores

**Formula.** Each factor is scored 1 to 10, where 10 is best. Higher Simplicity means easier, and higher Maintenance means cheaper to maintain.

Score = 0.30 × User value + 0.20 × Competitive importance + 0.20 × Simplicity + 0.15 × Strategic differentiation + 0.10 × Technical feasibility + 0.05 × Maintenance efficiency.

**Precondition, not scored:** take payments live (Polar production configuration and the Pro AI prices of $13.99/$159 in Polar). It is mostly configuration (XS to S of work) and blocks revenue from every item below.

| # | Item | UV | CI | Simp | Diff | Feas | Maint | Score | Priority |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Remote MCP server (read, then approval-gated writes) | 8 | 10 | 5 | 7 | 8 | 7 | **7.60** | **P0** |
| 2 | Natural-language dates in Quick Add and to-dos | 8 | 7 | 9 | 3 | 10 | 9 | **7.50** | **P0** |
| 3 | Search by meaning in ⌘K (Pro) | 7 | 7 | 8 | 5 | 9 | 8 | **7.15** | P1 |
| 4 | Foli AI routines (proactive briefs, open loops) | 7 | 7 | 6 | 8 | 8 | 6 | **7.00** | P1 |
| 5 | Faster co-editing when others are in the note | 7 | 6 | 9 | 3 | 9 | 9 | **6.90** | **P0** |
| 6 | Private iCal feed of tasks | 6 | 6 | 9 | 4 | 10 | 9 | **6.85** | P1 |
| 7 | Recurring tasks | 8 | 8 | 6 | 2 | 9 | 7 | **6.75** | P1 |
| 8 | Email (P0) and web push (P1) reminders | 8 | 7 | 7 | 2 | 9 | 7 | **6.75** | **P0**/P1 |
| 9 | Notion import (Markdown + CSV ZIP) | 8 | 8 | 6 | 3 | 8 | 6 | **6.75** | P1 |
| 10 | Ship the Mac app (notarize, auto-update, folevi:// links) | 7 | 7 | 7 | 4 | 9 | 6 | **6.70** | P1 |
| 11 | Embed block (YouTube, Vimeo, Loom, Figma, Maps) | 7 | 7 | 7 | 2 | 9 | 7 | **6.45** | P1 |
| 12 | Meeting capture: system audio on Mac + long recordings | 7 | 7 | 5 | 6 | 7 | 6 | **6.40** | P1 |
| 13 | Spaced repetition for flashcards | 6 | 4 | 7 | 7 | 9 | 8 | **6.35** | P2 |
| 14 | Personal access tokens + read-only REST API | 6 | 7 | 6 | 4 | 9 | 6 | **6.20** | P2 (after MCP) |
| 15 | DOCX/HTML import + DOCX in AI attachments | 6 | 6 | 8 | 2 | 9 | 8 | **6.20** | P1 |
| 16 | Expose hidden features (indexing toggle, missing links, move task) | 5 | 3 | 10 | 4 | 10 | 9 | **6.15** | P1 (XS, in sprint 1) |
| 17 | Web clipper extension | 7 | 7 | 5 | 3 | 8 | 5 | **6.00** | P2 |
| 18 | Email to note | 6 | 6 | 7 | 3 | 8 | 7 | **6.00** | P2 |
| 19 | iPhone app | 9 | 9 | 1 | 4 | 5 | 3 | **5.95** | P2 (decision gate) |
| 20 | Collection calendar view | 6 | 7 | 6 | 2 | 8 | 7 | **5.85** | P2 |
| 21 | Evernote ENEX import | 6 | 6 | 6 | 3 | 8 | 7 | **5.80** | P2 |
| 22 | Calendar week view + read-only external calendars | 7 | 7 | 4 | 4 | 6 | 5 | **5.75** | P2 (week view first) |
| 23 | Model choice / bring your own key | 5 | 7 | 6 | 4 | 8 | 5 | **5.75** | P3 |
| 24 | Passkeys + breached-password check | 5 | 5 | 8 | 2 | 9 | 8 | **5.70** | P2 |
| 25 | Live carets and selections | 6 | 7 | 5 | 3 | 7 | 6 | **5.65** | P2 |
| 26 | Search every scope at once | 6 | 4 | 7 | 3 | 8 | 8 | **5.65** | P2 |
| 27 | Nested folders | 6 | 6 | 6 | 2 | 8 | 7 | **5.65** | P2 |
| 28 | Comment reactions | 4 | 5 | 9 | 1 | 10 | 9 | **5.60** | P3 |
| 29 | Copy a note between Personal and a workspace | 6 | 4 | 6 | 3 | 8 | 7 | **5.40** | P2 |
| 30 | Windows build of the desktop shell | 5 | 5 | 7 | 2 | 8 | 6 | **5.30** | P3 |
| 31 | PWA share target + bookmarklet | 4 | 3 | 9 | 2 | 9 | 9 | **5.25** | P2 |
| 32 | Offline for collections, comments, folders | 6 | 4 | 3 | 7 | 7 | 5 | **5.20** | P2 |
| 33 | Outbound webhooks | 4 | 5 | 7 | 2 | 9 | 6 | **5.10** | P3 |
| 34 | Character-level merge inside a block | 7 | 7 | 2 | 3 | 5 | 4 | **5.05** | P3 (data-gated) |
| 35 | On-device AI on Mac (Apple Foundation Models) | 5 | 5 | 3 | 8 | 5 | 4 | **5.00** | P3 |
| 36 | Columns layout | 5 | 6 | 4 | 2 | 7 | 5 | **4.75** | P3 |
| 37 | Whiteboard shapes, text and sticky notes | 5 | 5 | 4 | 3 | 7 | 5 | **4.70** | P3 |
| 38 | Inline math | 3 | 3 | 8 | 1 | 9 | 8 | **4.55** | P3 |
| 39 | Collection formulas and rollups | 5 | 6 | 3 | 2 | 7 | 4 | **4.50** | P3 |
| 40 | End-to-end encrypted private notes | 5 | 4 | 2 | 7 | 4 | 3 | **4.30** | P3 (avoid for now) |
| 41 | Mac Shortcuts and App Intents (Swift extension) | 4 | 4 | 3 | 6 | 5 | 4 | **4.20** | P3 |

**Where the priority is not simply the score, and why**

- **Co-editing speed (#5, 6.90) is P0, above routines (#4, 7.00).** It is a 2-day change that removes the most visible weakness for paying teams. Routines need a credit budget design first.
- **Email reminders are P0 but web push is P1.** Email reuses existing infrastructure in about 2 days. Push needs keys, a service-worker handler and a permission flow.
- **Hidden features (#16) jump to sprint 1.** At XS effort, their low user value still pays back.
- **The iPhone app (#19) is a decision gate, not a build.** Its score is held down by the 20% weight on simplicity. Strategically it may be the most important item in the list. Decide after MCP and payments, using the share of mobile web traffic. Push plus a share target (#8, #31) buys time.
- **REST API (#14) comes after MCP.** It reuses the same auth and tool functions, so building it first would duplicate work.
- **Character merge (#34) is gated on data.** Add conflict telemetry first (7.6). If conflicts stay rare after #5 and #25, skip it.
- **E2EE (#40) is P3 on purpose.** It conflicts with server-side AI, search and the agent, which are Folevi's core value. A narrow "private, no-AI" vault could come later.

---

## Part 11. Technical implementation blueprint

### 11.1 Foundations to build once and reuse

| ID | Foundation | Used by | Where |
|---|---|---|---|
| F1 | **OAuth authorization server + grants**: Better Auth oauth-provider 1.6.33, `mcpGrants`, consent page, Connected apps | MCP, REST API, clipper, Mac extensions, Raycast | `convex/auth.ts`, `convex/betterAuth/schema.ts`, `apps/web/src/app/oauth/consent`, `views/settings/ConnectedAppsSection.tsx` |
| F2 | **Notification channels**: in-app, email, web push, Mac, with per-kind preferences | Reminders, routines, mentions, digests | `convex/notifications.ts`, `packages/email`, `apps/web/public/sw.js`, new `pushSubscriptions` |
| F3 | **Task model extension**: `repeat` prop on to-dos plus NL parsing | Recurrence, NL dates, iCal, meeting-to-tasks | `packages/editor-schema/spec/folevi-blocks.v1.json`, `src/tasks.ts`, `convex/tasks.ts` |
| F4 | **Importer framework**: parse in the browser into blocks, then `imports` | Notion, Evernote, DOCX, HTML, email-in | `doc/importBundle.ts`, `convex/imports.ts`, `markdownToBlocks` |
| F5 | **Desktop release pipeline**: Developer ID, notarisation, auto-update, protocols | Mac distribution, deep links, native extensions later | `apps/desktop/electron-builder.yml`, CI workflow |
| F6 | **Routine runner**: schedule, budget, output as note or proposal | Routines, open loops, meeting prep, Change Inbox | `convex/aiDigest.ts` generalised to `convex/routines.ts` |

### 11.2 Data model additions (Convex)

These are sketches; follow the validator style in `convex/schema.ts`.

```ts
mcpGrants: defineTable({
  profileId: v.id("profiles"),
  clientId: v.string(),            // oauth client id
  clientName: v.string(),
  redirectHost: v.string(),
  scopes: v.array(v.string()),     // notes:read, notes:write, tasks:read, tasks:write
  places: v.array(v.union(v.literal("personal"), v.id("workspaces"))),
  folderIds: v.optional(v.array(v.id("folders"))),   // 9.2
  includeShared: v.boolean(),
  createOnly: v.boolean(),         // "Only create new notes"
  createdAt: v.number(), lastUsedAt: v.optional(v.number()), revokedAt: v.optional(v.number()),
}).index("by_profile", ["profileId"]).index("by_client_profile", ["clientId", "profileId"]),

mcpEvents: defineTable({
  grantId: v.id("mcpGrants"), profileId: v.id("profiles"),
  tool: v.string(), targetIds: v.array(v.string()),
  outcome: v.union(v.literal("ok"), v.literal("denied"), v.literal("error"), v.literal("duplicate")),
  argsHash: v.string(), at: v.number(),
}).index("by_profile_at", ["profileId", "at"]).index("by_grant_at", ["grantId", "at"]),

pushSubscriptions: defineTable({
  profileId: v.id("profiles"), endpoint: v.string(), p256dh: v.string(), auth: v.string(),
  userAgent: v.optional(v.string()), createdAt: v.number(), failedAt: v.optional(v.number()),
}).index("by_profile", ["profileId"]).index("by_endpoint", ["endpoint"]),

calendarFeeds: defineTable({
  profileId: v.id("profiles"), tokenHash: v.string(), createdAt: v.number(), rotatedAt: v.optional(v.number()),
}).index("by_token", ["tokenHash"]).index("by_profile", ["profileId"]),

studyReviews: defineTable({
  profileId: v.id("profiles"), documentId: v.id("documents"), blockId: v.string(),
  due: v.number(), stability: v.number(), difficulty: v.number(), reps: v.number(), lapses: v.number(),
  state: v.number(), lastReview: v.optional(v.number()),
}).index("by_profile_due", ["profileId", "due"]).index("by_block", ["profileId", "blockId"]),

routines: defineTable({
  profileId: v.id("profiles"), scope: v.union(v.literal("personal"), v.id("workspaces")),
  kind: v.union(v.literal("morning"), v.literal("openLoops"), v.literal("meetingPrep")),
  schedule: v.object({ cadence: v.union(v.literal("daily"), v.literal("weekly")), hour: v.number(), weekday: v.optional(v.number()), tz: v.string() }),
  monthlyCreditCap: v.number(), enabled: v.boolean(), lastRunAt: v.optional(v.number()), nextAt: v.number(),
}).index("by_next", ["enabled", "nextAt"]).index("by_profile", ["profileId"]),

commentReactions: defineTable({
  commentId: v.id("comments"), profileId: v.id("profiles"), emoji: v.string(), at: v.number(),
}).index("by_comment", ["commentId"]).index("by_comment_profile", ["commentId", "profileId"]),
```

**Block schema (additive in v1).**

- To-do gets `repeat?: { freq: "daily"|"weekly"|"monthly"|"yearly", interval?: number, byWeekday?: number[], byMonthDay?: number }`.
- A new `embed` block with `{ url: string, provider: EmbedProvider, height?: number }`.
- Older clients preserve unknown types read-only [V], so the change is safe.
- Bump the spec's minor version, update the reducer, export (`doc/export.ts`), `blocksToMarkdown`/`markdownToBlocks`, and the golden fixtures.

### 11.3 HTTP surface additions (`convex/http.ts` plus Next rewrites)

| Route | Purpose |
|---|---|
| `POST /mcp` | MCP JSON-RPC (dual-era). `GET` returns 405 (modern clients) or the legacy stream (only if needed) |
| `GET /.well-known/oauth-protected-resource/mcp` | RFC 9728 metadata pointing at the Better Auth issuer |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata (Better Auth) |
| `GET /ical/{token}.ics` | Tasks feed. Cache-Control private, max-age 300 |
| `POST /webhooks/mailtrap-inbound` | Existing. Route `n-*` local parts to `inboundNotes.receive` |
| `GET/POST /api/v1/*` (later) | REST over the same tool functions, with bearer tokens from F1 |

### 11.4 Client changes (web)

| Area | Change |
|---|---|
| Sync engine | `setCollaborative(on)` changes the flush delay (2.5 s → about 0.4 s); presence-driven from `DocumentView.tsx` |
| Quick Add and to-dos | A chrono-node parser with a dismissible chip; "every …" fills `repeat` |
| ⌘K | "Meaning" toggle and "All places" scope; results labelled by place |
| Settings | Notifications (channels), Calendar (feed URL), Connected apps (grants, events, revoke), Email-in address |
| Editor | Embed NodeView with a sandboxed iframe and paste-to-embed; reactions bar in Comments |
| Service worker | `push` and `notificationclick` handlers |
| Manifest | `share_target` |

### 11.5 Desktop changes (`apps/desktop`)

- `protocols: [{ name: "Folevi", schemes: ["folevi"] }]` in `electron-builder.yml`.
- `setAsDefaultProtocolClient`, `open-url` handled through `appUrl()`, and single-instance forwarding.
- `startDrag` to drag a note out as Markdown, writing a temp file in the main process.
- A Developer ID certificate, `notarize: true`, x64 + arm64 (universal), and `electron-updater` with a `latest-mac.yml` feed.
- An optional Markdown mirror (9.9) behind a setting. It writes only under a user-chosen folder.

### 11.6 Cross-cutting rules every item must follow

- **Margins:** apply the 30% margin rule from the pricing decision. Anything that calls a model or the embeddings API needs a credit cost or a plan gate, plus a rate-limit entry in `convex/lib/rateLimit.ts`.
- **Mac matches web:** nothing ships only on Mac except OS entry points (deep links, the mirror, system audio) that open the same web UI.
- **Design:** neutral app chrome, the custom Select (no OS-default controls), token corner classes, and copy that follows the house writing style with no em dashes.
- **Security:** re-check `documentAccess` for every read path. Wrap untrusted text. No secrets in client code. Tokens are hashed at rest.
- **Tests:**
  - Convex integration tests in `tests/convex/*` for each new mutation, query or HTTP route, including authorization invariants.
  - editor-schema unit tests and golden sync scenarios for block changes.
  - Playwright e2e for every user flow, run with `E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1`.
  - axe checks on new views.
- **Feature flags:** add flags (`convex/lib/flags.ts`) for `mcp`, `routines`, `email_in` and `push`, so production can roll out gradually.
- **Docs:** update `docs/PRODUCT.md`, `docs/AI_ASSISTANT.md` (routines), `docs/SECURITY.md` (MCP, tokens), `docs/DESKTOP.md` and the help pages with each release.

---

## Part 12. Development roadmap

Each phase is about 2 to 4 weeks for one developer working with Claude Code. Items marked **[F]** are foundational; others are independent and can be reordered.

### Phase 0: Revenue and quick wins (weeks 1 to 2)

**0.1 Payments live** [F, precondition]

| Field | Detail |
|---|---|
| Functional requirements | Polar production products for every plan, monthly and yearly, plus credit packs; webhooks verified; the "Coming soon" text removed |
| UX | Existing Billing and Workspace billing screens |
| Approach | Configuration in Polar and Convex env (`POLAR_*`), plus a production checkout test with a real card. That last step is for the owner to do |
| Architecture change | None |
| Dependencies | None |
| Effort | XS to S |
| Risks | Webhook signature errors; seat sync bugs |
| Acceptance criteria | Upgrade, downgrade, cancel, seat change and credit pack all reflected within 1 minute; invoices visible in the portal |
| Testing | Existing `billing.test`, `workspace-billing.test`; manual production checklist in `docs/BILLING.md` |
| Benefit | Revenue |

**0.2 Sprint 1 batch**

| Field | Detail |
|---|---|
| Scope | NL dates (#1); co-editing delay (#2); email reminders (#3); allowIndexing toggle (#11); "Notes you could link" (#12); move task (#17); conflict telemetry counter |
| Acceptance criteria | "call Sam tomorrow 3pm" creates a task due tomorrow at 15:00. Two browsers on one note see each other's typing within about 1 s. A reminder at T sends an email by T+2 min when email is enabled. The toggle exists. The Pro panel shows link suggestions. Moving a task updates both pages |
| Testing | Unit tests for the parser; e2e for the two-browser latency (`cross-workspace.spec` pattern); Convex tests for the reminder email path |
| Effort | 8 to 10 days |

### Phase 1: MCP read-only and task depth (weeks 3 to 6)

**1.1 MCP read-only** [F1]

| Field | Detail |
|---|---|
| Functional requirements | OAuth (DCR, PKCE, refresh, revoke); consent with a place picker; read tools; resource template; dual-era protocol; Connected apps page; `mcpEvents`; rate limits |
| UX | Consent page in Folevi's auth style; Settings → Connected apps with a card per grant (client, places, scopes, last used, Revoke) |
| Approach | Part 8 |
| Architecture changes | New `convex/mcp/*`, two tables, oauth-provider plugin, Next rewrites |
| Dependencies | Spike outcome |
| Effort | 2 to 3 weeks including the spike |
| Risks | SDK runtime fit; JWT plugin coexistence; client quirks |
| Acceptance criteria | Claude.ai, Claude Code, ChatGPT (developer mode) and Cursor connect via OAuth, list places, search, read a note and list tasks. Revoke stops access within one request. Inaccessible notes return not_found. A legacy (2025-11-25) client and a 2026-07-28 client both work |
| Testing | Convex tests for token verification, grant filters, access invariants and rate limits; MCP Inspector scripted run; a manual matrix per client |
| Benefit | Table stakes; acquisition channel |

**1.2 Recurring tasks + iCal feed + web push** [F2, F3]

| Field | Detail |
|---|---|
| Acceptance criteria | Checking a weekly to-do creates the next one due 7 days later, visible in Tasks and Calendar. Subscribing the feed in Apple Calendar shows dated tasks within its refresh interval. Push arrives with the tab closed in Chrome and Safari |
| Risks | Duplicate next-occurrences on concurrent checks (make the op id deterministic: hash of block id and due date); feed token leakage (rotate) |
| Testing | Reducer tests for recurrence; Convex tests for the ICS route (auth, format, privacy); Playwright for push permission (mocked) |
| Effort | About 2 weeks |

### Phase 2: MCP writes, distribution and switching (weeks 7 to 10)

| Item | Effort | Acceptance criteria |
|---|---|---|
| 2.1 MCP writes + directory submission | 1.5 to 2 weeks | create, append and task tools go through SyncEngine. A retried call returns duplicate. An edit after someone else's change returns a conflict error. A snapshot appears in history labelled with the app name. The directory submission is accepted |
| 2.2 Semantic ⌘K (Pro) + all-places search | 3 to 4 days | "notes about pricing" finds a note titled "Plans and margins". Results are labelled by place. Free and Core see keyword only |
| 2.3 Notion importer (then Evernote) | 1 to 1.5 weeks each | A Notion export ZIP of 200 pages with 3 databases imports with nesting, collections and to-dos intact, plus a warnings report |
| 2.4 Mac distribution [F5] | About 1 week | A notarized universal DMG installs on a clean Mac. Auto-update moves 1.2.0 to 1.2.1. `folevi://d/{id}` opens the note. `AVAILABILITY` is updated |
| 2.5 Embed block + DOCX | About 1 week | Pasting a YouTube URL offers Embed. Export round-trips. A DOCX imports and can be attached in AI chat |

### Phase 3: Proactive Foli AI and capture (weeks 11 to 15)

| Item | Effort | Acceptance criteria |
|---|---|---|
| 3.1 Routines [F6] + open loops (9.7) | 2 to 3 weeks | A user can enable Morning and Weekly routines with a credit cap. The output note cites blocks. The cap stops runs and notifies |
| 3.2 Long recordings + Mac system audio | 1.5 to 2 weeks | A 90-minute recording transcribes, with the cost shown first. On Mac both sides of a call are captured after permission |
| 3.3 Notes that schedule themselves (9.5) | 3 to 4 days | A meeting summary proposes dated, assigned to-dos, and accepted ones appear in Calendar and the feed |
| 3.4 Web clipper (Chrome) | 1.5 to 2 weeks | Clipping an article creates a clean note in the Inbox via an OAuth grant with create-only scope |
| 3.5 Email to note | 3 to 5 days | Mail from the account's own address arrives as a note within 1 minute. Other senders are rejected |

### Phase 4: Collaboration and planning depth (weeks 16 to 22)

| Item | Effort | Note |
|---|---|---|
| 4.1 Live carets | 1 to 1.5 weeks | Over the presence heartbeat |
| 4.2 Change Inbox (9.1) + "Since you were away" (9.8) | 2 to 3 weeks | Builds on version diff |
| 4.3 Collection calendar view + Calendar week view | 1.5 weeks | |
| 4.4 Spaced repetition (9.6) | 4 to 5 days | |
| 4.5 Mobile decision | none | PWA vs Capacitor vs native, based on traffic data |
| 4.6 Themed publishing (9.4) | 1 to 1.5 weeks | |

### Dependency graph

```
Payments ─┐
          ├─► (everything commercial)
F1 OAuth ─┬─► MCP read ─► MCP write ─► Change Inbox (9.1), Scoped grants (9.2)
          ├─► Web clipper
          ├─► REST API ─► Webhooks ─► Zapier/n8n
          └─► Mac native extensions (Spotlight, widget, intents)
F2 Channels ─► Email/push reminders ─► Routines notifications
F3 Task model ─► NL dates ─► Recurrence ─► iCal feed ─► Notes that schedule themselves (9.5)
F4 Importers ─► Notion ─► Evernote ─► DOCX/HTML ─► Email to note
F5 Desktop pipeline ─► Deep links ─► Markdown mirror (9.9) ─► native extensions
F6 Routine runner ─► Open loops (9.7) ─► Meeting prep (needs calendar data)
```

**Independent items** that can be slotted in anywhere: embed block, comment reactions, week view, nested folders, copy between scopes, passkeys, spaced repetition, share target.

---

## Part 13. Final strategic recommendations

### 1. Five biggest weaknesses

1. **No agent access (MCP or API).** It is now table stakes, and every week without it sends AI-forward users to Craft, Notion or Capacities.
2. **Can't take money.** Payments are not live.
3. **Thin task basics.** No recurrence, natural-language dates, reminders outside the app, or calendar feed.
4. **Browser-only reach.** No mobile app, and the Mac app isn't distributed.
5. **Co-editing fidelity.** A 2.5 s delay, conflicts inside a block, and no carets.

### 2. Five existing features to improve first

1. Real-time co-editing: the presence-driven delay now, carets next.
2. Reminders: add email and push.
3. ⌘K search: add meaning and all places.
4. AI transcription: lift the 14 MB cap with the Files API.
5. Study: save progress with spaced repetition.

### 3. Ten easiest high-impact additions

1. Natural-language dates.
2. Presence-driven save delay.
3. Email reminders.
4. iCal feed.
5. `folevi://` deep links.
6. Semantic ⌘K.
7. DOCX import and attachments.
8. The allowIndexing toggle.
9. "Notes you could link".
10. PWA share target and bookmarklet.

### 4. Essential advanced features

- The remote MCP server.
- Recurring tasks.
- Notion and Evernote importers.
- Mac distribution with auto-update.
- Foli AI routines.
- Meeting capture with long recordings.
- A web clipper.

### 5. Technologies worth adopting

- **Better Auth oauth-provider** (now) and the **mcp/cimd** plugins (after the 1.7 upgrade).
- **MCP spec 2026-07-28**, served dual-era alongside 2025-11-25.
- **chrono-node**, **ts-fsrs**, **mammoth**, **Readability** and **web-push**. All free, all small.
- **electron-updater** with **notarytool**.
- **Gemini Files API** for long audio.
- Later, **transformers.js v4 with WebGPU** for on-device embeddings.

Skip: Apple Foundation Models, Ollama, and Chrome's Prompt API, for now (Part 8.7).

### 6. Should MCP be a priority?

**Yes, the top engineering priority after payments.**

- Ten direct rivals ship one [V]. Folevi's compare page already names Bear's.
- It is a new acquisition channel through Claude, ChatGPT and Cursor.
- It costs no AI credits.
- It reuses the agent's read tools and safe write path almost entirely.
- The same OAuth layer unlocks the clipper, the API and Mac extensions.

Build it as a **server only**, remote, read-only first, with writes kept narrow (create, append, tasks).

### 7. Most practical AI features to add

1. Routines (morning brief, open loops).
2. Notes that schedule themselves.
3. Semantic ⌘K.
4. Long-recording transcription and Mac system audio.
5. A cost estimate before each action.
6. Spaced repetition (no model calls).

Skip model pickers, BYOK, image generation and voice chat for now.

### 8. What to avoid

- **An MCP client inside Foli AI.** It brings security risk and support burden for little gain.
- **End-to-end encryption.** It would break server-side AI and search.
- **Database formulas and rollups.** Notion and AppFlowy own this; it is high complexity for a minority.
- **Columns and synced blocks before the basics.**
- **A native iOS app before the mobile-traffic data and MCP exist.**
- **Mac App Store distribution.** The sandbox breaks global shortcuts.
- **Mac-only AI.** It breaks "Mac matches web".
- **Metered AI pricing changes.** Predictable pricing is a competitive advantage that Mem and Notion have lost.
- **Daily-notes revival.** It was retired on purpose.
- **Chasing every Notion database feature.**

### 9. Why users would choose Folevi

- **"Beautiful notes that work offline in your browser, with an AI that asks before it changes anything, at a price that doesn't move."**
- Concretely:
  - Note themes nobody else has.
  - Offline on the web.
  - Approval and undo on every AI edit.
  - Fixed monthly AI with no metering.
  - An honest $1.99 no-AI plan.
  - Free guests for small teams.
  - Author-attributed history.
  - No trackers.
- After MCP, add: "and it works inside Claude, ChatGPT and Cursor."

### 10. The most efficient path to category leadership

1. **Weeks 1 to 2:** payments live, plus the sprint 1 easy wins.
2. **Weeks 3 to 10:** MCP (read, then write) plus task depth plus importers plus Mac distribution. This removes every "table stakes" objection.
3. **Weeks 11 to 15:** routines, meeting capture, clipper. Folevi catches up with the AI-native frontier at a fixed price.
4. **Weeks 16 to 22:** collaboration polish, Change Inbox, themed publishing. These lean into what only Folevi does.
5. **Then the mobile decision**, with data.

Throughout: keep pricing predictable, keep the agent approval-gated, and market the combination of themes, browser offline, approval and fixed price. No competitor has all four.

---

## Appendix A. Codebase audit (full inventory)

This is the codebase agent's inventory, reproduced as written on 2026-10-14. File paths are relative to the repo root.

Repo: `/Users/faisalislam/Documents/GitHub/Airly Studio/folevi`. The working tree is clean. The last commit is 2026-10-11.

**How to read the labels.** VERIFIED means I found all three in the code: a UI entry point, a backend function, and at least one test that exercises the feature (Playwright e2e in `apps/web/e2e/*.spec.ts` or a Convex integration test in `tests/convex/*.test.ts`). I did not run any tests, so VERIFIED says the tests exist, not that they pass. INFERRED means I judged from the code alone.

Most paths below are relative to the repo root: `apps/web/src/...`, `convex/...`, `packages/editor-schema/...`.

---

### 0. Surfaces and stack

| Item | Status |
|---|---|
| Web app `app.folevi.com` | Live. Next.js 16 with one client-side catch-all route (`apps/web/src/app/(app)/[...path]/page.tsx`, router in `lib/app/router.tsx`). Routes: `/documents` (Home), `/notes`, `/d/:id`, `/ai[/:id]`, `/graph`, `/tasks/{inbox,today,upcoming,all,completed,mine}`, `/calendar[/YYYY-MM]`, `/shared`, `/templates`, `/starred`, `/archive`, `/trash`, `/drafts`, `/folders[/:id]`, `/tags[/:id]`, `/settings/<section>`, `/help`, `/onboarding`, `/quick-add`, `/invite/:token`, `/share-invite/:token`. Public pages are at `/s/[token]`. |
| Backend | Convex (`convex/`, about 22k lines). Schema has about 75 tables (`convex/schema.ts`). |
| PWA | Installable (`apps/web/src/app/manifest.ts`). Service worker `apps/web/public/sw.js` keeps an offline app shell. **No web push.** |
| Mac app | Electron shell that loads `app.folevi.com` (`apps/desktop/src/main.ts`, `preload.ts`). Version 1.1.0, arm64 only, signed with a personal development certificate, **not notarized and not distributed** (`docs/DESKTOP.md`). |
| iOS / Android / Windows / Linux desktop | **None.** Explicitly out of scope (`docs/FUTURE_IOS.md`). |
| Language | English only. An i18n catalog exists (`apps/web/src/i18n/messages/en.ts`, `docs/LOCALIZATION.md`). |

---

### 1. Editor and blocks

The block model is defined in `packages/editor-schema/spec/folevi-blocks.v1.json` (schema v1). The editor is Tiptap/ProseMirror with a custom flat schema: one node per block, nesting via `depth` (`components/editor/extensions.ts`, `convert.ts`, `NodeViews.tsx`).

There are 21 block types: paragraph, heading, bulleted, numbered, todo, toggle, quote, callout, divider, pageBreak, code, image, file, table, page, bookmark, collection, formula, whiteboard, flowchart, audio. Unknown future types are preserved read-only.

#### Block types

| Feature | Description / where | How a user reaches it | Maturity | Limits / notes |
|---|---|---|---|---|
| Text, Heading 1–3, bulleted, numbered, quote | Core text blocks | `/` menu (`EditorMenus.tsx` ~l.697), Insert panel (`doc/InsertPanel.tsx`), markdown shortcuts, ⌘⌥0–3, ⌘⇧7/8 | Fully implemented & functional, **VERIFIED** (`editor.spec`, `editor-keyboard.spec`, `insert-blocks.spec`) | Only 3 heading levels. 20,000 characters per block. |
| To-do | Checkbox block. Can carry due date/time, priority, assignee, reminder, canceled state | `[]`, ⌘⇧9, `/To-do`. Details via ⌘⇧D or "Task details…" | Fully implemented, **VERIFIED** (`tasks.spec`) | Every to-do becomes a task (§3). |
| Toggle | Collapsible block. Collapse state syncs last-writer-wins | `/Toggle` | Fully implemented, VERIFIED (`organize-notes.spec`, schema tests) | Also stores AI flashcards and quizzes (`study` prop). |
| Callout | Five tones (note/info/success/warning/danger), optional icon | `!! ` shortcut, `/Callout` | Fully implemented, INFERRED (no specific e2e) | |
| Divider | Four weights. Page style can switch to line/dots/doodle | `---` or `***`, `/Divider: …`, Insert → Separators | Fully implemented, VERIFIED (`insert-blocks.spec`) | |
| Page break | Sheet break in the editor; `break-after: page` in print/PDF | `/Page break` | Fully implemented, VERIFIED (`page-breaks.spec`) | |
| Code | 27 languages, syntax view (`editor/codeView.ts`) | ```` ``` ````, `/Code` | Fully implemented, VERIFIED | 100,000 characters. |
| Mermaid diagram | A code block with `language: mermaid`, rendered as a live SVG preview | `/Mermaid diagram`, Insert | Fully implemented, VERIFIED (`insert-blocks.spec`, `flowchart.spec`) | |
| TeX formula | KaTeX, `trust:false` (`editor/FormulaView.tsx`) | `/TeX formula` | Fully implemented, VERIFIED (`documents.spec`, `insert-blocks.spec`) | 10,000 characters. Block-level only. I found no inline-math node. |
| Table (simple) | Rich-text cells, optional header row, size picker | `/Table` (3×3), Insert grid picker | Fully implemented, VERIFIED | 200 rows × 20 columns. No formulas or cell types. |
| Collections (database) | Rows are pages. Nine property types: text, number, checkbox, date, select, multiSelect, url, person, relation. Views: **table, gallery, kanban (board)**, with filters, sorts, group-by, visible properties, card preview and size, kanban drag (`editor/CollectionEmbed.tsx`, `convex/collections.ts`) | `/Collection`, `/Gallery`, `/Kanban`, Insert → Collections | Implemented, needs improvement. **VERIFIED** (`collections.spec`, 1 test; Convex `backend.test` and others) | 40 properties, 2,000 rows, 20 views per collection. **No calendar or timeline view, no formulas, no rollups.** Edits are direct Convex mutations, not the offline queue, so they are likely online-only (INFERRED). |
| Page / Card (nested page) | `page` block in link or card display; titles kept in sync server-side | `/Page`, `/Card`, Insert → Nested content | Fully implemented, VERIFIED (`nested-pages.test`, `page-layout.spec`) | Nesting depth limited by `maxDepth` 8 for blocks; page nesting via `parentDocumentId`. |
| Inline page link `[[ ]]` | `pageLink` inline node; broken links are flagged (`editor/pageLinkStatus.ts`) | Type `[[`, or `/Link to page` | Fully implemented, VERIFIED (`page-link-status.spec`) | |
| @mentions (people) | `mention` inline node. Notifies the person and can email them | Type `@` | Fully implemented, VERIFIED (`documents.spec`, `comments-notifications.test`) | |
| Dates (inline) | `date` inline node | `@today` etc., `/Today's date`, `/Date…` | Fully implemented, INFERRED | |
| Image | Upload. Server strips metadata and sniffs the type. Resizable, caption | `/Image`, paste, drop | Fully implemented, VERIFIED (`images.test`, `covers.spec`) | 20 MB, 50 MP. |
| Image from Unsplash | Search dialog (`editor/UnsplashDialog.tsx`, `convex/unsplash.ts`) | `/Image from Unsplash` | Implemented. **Only works when `UNSPLASH_ACCESS_KEY` is set.** VERIFIED (`insert-blocks.spec`/`.test`) | 60 searches per hour. |
| File attachment | Any file. Served via signed short-lived URLs | `/File`, Insert → Media | Fully implemented, VERIFIED | 100 MB per file. Counts against plan storage. |
| Audio recording | In-browser recorder (`editor/AudioRecorder.tsx`, `AudioPlayer.tsx`), `audio` block (marked webOnly) | `/Audio recording` | Fully implemented, VERIFIED (`audio.spec`) | Up to 60 minutes. AI transcription is a separate action (§7). |
| Bookmark | URL card filled server-side (`convex/bookmarks.ts`) | `/Bookmark` | Fully implemented, VERIFIED (`bookmarks.test`; no e2e) | 120 previews per hour. |
| Whiteboard | Freehand SVG with pen, highlighter, stroke eraser, undo (`editor/WhiteboardView.tsx`) | `/Whiteboard` | Implemented, needs improvement. VERIFIED (inserted in `insert-blocks.spec`) | **Strokes only**: no shapes, text, sticky notes or infinite canvas. 200 KB of data. Height 120–2400. |
| Flowchart | Seven shapes (process/decision/terminator/io/circle/note/text), connectors, colours, tidy auto-layout, zoom, AI create/edit, Mermaid export (`editor/flowchart/*`, `packages/editor-schema/src/flowchart*.ts`) | `/Flowchart` | Fully implemented, VERIFIED (`flowchart.spec`, `flowchart.test`) | 200 KB of data. Height 200–1600. |
| Video / embeds (YouTube, Figma, etc.) | n/a | n/a | **Missing** | Bookmark is the only link-preview block. |
| Columns layout, synced blocks, inline database | n/a | n/a | **Missing** | |

#### Editing mechanics

| Feature | Where / how | Maturity | Notes |
|---|---|---|---|
| Slash menu `/` | `editor/EditorMenus.tsx`. Covers all blocks above plus AI commands | Fully implemented, VERIFIED | |
| Insert panel | Bottom page dock → Insert (`doc/InsertPanel.tsx`, `doc/PageDock.tsx`). Searchable gallery with previews | Fully implemented, VERIFIED (`insert-blocks.spec`) | |
| Markdown shortcuts | `editor/plugins.ts` ~l.1000: `#`/`##`/`###`, `-*+`, `1.`, `[]`/`[x]`, `>`, `!!` (callout), ```` ```lang ````, `---`. Inline `**b**`, `_i_`, `` `c` ``, `~~s~~` | Fully implemented, VERIFIED | Each shortcut is its own undo step. |
| Inline formatting | Bold, italic, underline, strike, code, link, 6 text colours, 4 highlights (⌘B/I/U, ⌘⇧X, ⌘E, ⌘⇧H). Selection toolbar plus Format panel (`doc/FormatPanel.tsx`) | Fully implemented, VERIFIED | |
| Block styling | Per-block colour (11), alignment, font, decoration (focus/block), group (page/card); text style strong/caption | Fully implemented, INFERRED | |
| Nesting, indent | Tab / ⇧Tab on any block | Fully implemented, VERIFIED | Max depth 8. |
| Move blocks | ⌥⇧↑/↓, drag handles (`editor/blockDrag.ts`), multi-block selection (`blockSelection.ts`) | Fully implemented, VERIFIED (`drag.spec`, `editor-keyboard.spec`) | |
| Duplicate / delete | ⌘D, ⌘⇧⌫, block menu (⌘.) | Fully implemented | |
| Undo / redo | ⌘Z / ⌘⇧Z. Survives remote edits (`editor/remoteApply.ts`) | Fully implemented, VERIFIED (`editor-remote.test`) | |
| Find & replace | ⌘F finds; ⌘⌥F or page menu replaces (`doc/FindBar.tsx`, `editor/findReplace.ts`). Sidebar also has a "Find in page" tab | Fully implemented, VERIFIED (`find-replace.test`) | Current note only. |
| Paste normalisation | HTML and Markdown paste (`editor/paste.ts`, `clipboardHtml.ts`); autolink | Fully implemented, VERIFIED (unit tests) | |
| Context menu | Right-click or long-press (`editor/EditorContextMenu.tsx`): turn into, colour, highlight, copy link to block, comment, Ask AI, etc. | Fully implemented, VERIFIED (`touch-long-press.spec`) | |
| Keyboard shortcut list | Help view (`views/HelpView.tsx`). Global shortcuts in `app/Shell.tsx`: ⌘K palette, ⌘⌥N new doc, ⌘⇧A quick add, ⌘\ sidebar, ⌘⌥I inspector, ⌘⌥T Today, ⌘J AI, ⌘⌥M comment | Fully implemented | Not rebindable. |
| Comments | Block-anchored threads, replies, edit/delete, resolve/reopen, read/unread, @mentions, Comments panel, follow/mute a note (`doc/Comments.tsx`, `convex/comments.ts`) | Fully implemented, VERIFIED (`comments-tab.spec`, `comments-notifications.test`) | Anchored to a block, not a text range. **No reactions.** |
| Page sidebar | Contents, Comments, Tasks in page, Attachments & links, Find (`doc/DocumentSidebar.tsx`) | Fully implemented | |
| Inspector / Info | Folder, tags, word count, dates, page actions (`doc/Inspector.tsx`) | Fully implemented | |
| Browser-style tabs, back/forward | `app/TabStrip.tsx`, `lib/app/tabs.tsx`, `app/BackForward.tsx` | Fully implemented, VERIFIED (`tab-*.spec`, `navigation-back.spec`) | |
| Presence | Avatars plus a coloured marker on the block each viewer has focused. Heartbeat, 45 s active window (`convex/presence.ts`, `DocumentView.tsx` ~l.261) | Implemented, INFERRED (no e2e; only a perf test) | **No live character-level cursors or selections.** |

---

### 2. Organisation

| Feature | Where / UI | Maturity | Notes |
|---|---|---|---|
| Nested pages and page tree | `documents.pageTree`, `MovePageDialog.tsx`, sidebar "Pages in this note" | Fully implemented, VERIFIED (`nested-pages.test`) | |
| Folders | Sidebar section, `/folders` index, colours, folder cards (`organization.ts`, `OrganizeIndex.tsx`) | Fully implemented, VERIFIED (`organization.spec`, `organize*.spec`) | **One level of sub-folders only.** |
| Tags | Coloured tags, `/tags`, Inspector tag field | Fully implemented, VERIFIED | |
| Starred (favourites) | Sidebar, Home shelf, `/starred` | Fully implemented, VERIFIED | |
| Drafts | Pages not in any folder (`/drafts`) | Fully implemented | |
| Archive | `/archive`, page menu | Fully implemented, VERIFIED (`organize-notes.spec`) | |
| Trash | `/trash`, restore, delete permanently, empty | Fully implemented, VERIFIED | 30-day retention (cron `purgeExpiredTrash`). |
| Recent | Home "Recent notes" carousel, hide-from-recent | Fully implemented | |
| Home dashboard | Recent notes, Starred, Recent folders, AI "Catch me up" (`views/HomeDashboard.tsx`) | Fully implemented, VERIFIED (`home-editor.spec`) | |
| Note browser | Grid / compact / list layouts; sort by updated, created, title or manual; multi-select bulk actions (`views/DocumentBrowser.tsx`, `SelectionBar.tsx`) | Fully implemented, VERIFIED | |
| Templates | 26 built-ins (`convex/lib/templates.ts`). "Save as template" from the page menu; AI-generated templates (`ai/AiGenerateDialog.tsx`); public template gallery leads into signup (`template-signup.spec`). Admins can disable a built-in | Fully implemented, VERIFIED | |
| Search / ⌘K | Command palette (`app/CommandPalette.tsx`, `convex/search.ts`). Full-text over title, body, code, captions, cells, attachment names and tags. Filters: folder, tag, creator, updated in last 7/30/365 days. Highlighted snippets; "Ask Foli AI: …" shortcut | Fully implemented, VERIFIED (`backend.test`) | **Keyword only** (semantic search exists only inside AI chat). Searches one scope at a time (Personal or a single workspace). At most 50 results. |
| Backlinks | "Linked from" section under the note (`documents.backlinks`, `documentLinks` table) | Fully implemented, VERIFIED (`page-layout.spec`) | |
| Graph view | `/graph` (`views/GraphView.tsx`, `lib/graph/layout.ts`, `aiGraph.graph`). Notes and links for everyone. Pro/Pro AI also see entities (people, projects, organisations, topics, decisions) and similar notes. Keyboard-navigable | Implemented, VERIFIED (`ai-graph.spec`) | Full graph needs Pro/Pro AI; **not available during the trial** (`lib/ai/indexing.ts`: `!e.trialing`). A note's graph is rebuilt at most every 6 hours. |
| Version history | Auto-versions (after a 2-min pause, on leaving, at least every 10 min of editing). Word-level diff coloured by author, named versions, restore (undoable), make a copy, "Show editors" per-line attribution (`doc/VersionHistory.tsx`, `documents.versions/restoreSnapshot/blockAuthors`) | Fully implemented, VERIFIED (`version-history.spec`, `versions.test`, `version-diff.test`) | 30-day retention on every plan; named versions kept forever. Editors only. |
| Move note | Folder or nest under a page (`doc/MoveNoteDialog.tsx`) | Fully implemented | **No move or copy between Personal and a workspace** (sync forbids cross-scope moves). Duplicate stays in the same scope. |

---

### 3. Tasks and planning

| Feature | Where / UI | Maturity | Notes |
|---|---|---|---|
| Tasks from to-dos | Server projection `tasks` table, updated on every sync (`convex/tasks.ts`, `packages/editor-schema/src/tasks.ts`) | Fully implemented, VERIFIED | The to-do block is canonical. |
| Task views | `/tasks/{inbox,today,upcoming,all,completed,mine}` (`views/TasksView.tsx`). Text filter; inline editor for status, due date/time, priority, assignee | Fully implemented, VERIFIED (`tasks.spec`) | **No saved filters, no project or label grouping, no subtasks beyond block nesting.** |
| Calendar | `/calendar` month grid and agenda (next 30 days); drag a task to reschedule (`views/CalendarView.tsx`, `tasks.range`) | Implemented, needs improvement. VERIFIED (`tasks.spec`, `organize.spec`) | Shows tasks only. **No events, no week/day views, no external calendar sync.** |
| Quick Add | ⌘⇧A dialog (`app/QuickAddTask.tsx`) into the open page or the Inbox page; Mac global ⌥Space (`DesktopQuickAdd.tsx`) | Fully implemented, VERIFIED (`tasks.spec`, `desktop-app.spec`) | **No natural-language date parsing** (explicit date fields). |
| Reminders | `reminderAt` on to-dos. A cron every minute creates an in-app notification (`tasks.processReminders`); Mac shell turns it into a native notification | Implemented, needs improvement. INFERRED (only a query-read test) | **In-app and Mac only: no email, no web push, no mobile push.** |
| Recurrence | n/a | **Missing** | No recurring tasks anywhere. The only "recurring" in the schema is billing. |
| Priority, assignee | `priority` none/low/medium/high; `assigneeId` | Fully implemented | |
| Daily notes | Retired. `/daily` redirects; `documents.daily`/`dailyDates` kept read-only | Scaffolded / legacy | |
| Unused backend | `tasks.moveToDocument` (no UI caller) | Hidden | |

---

### 4. Collaboration and sharing

| Feature | Where / UI | Maturity | Notes |
|---|---|---|---|
| Personal vs workspaces | Personal is private and not a workspace; team workspaces have their own plan, storage and billing (`convex/workspaces.ts`, `app/WorkspaceMenu.tsx`, `docs/ACCOUNT_MODEL_PLAN.md`) | Fully implemented, VERIFIED (`switcher.spec`, `personal-scope.test`, `account-scopes.test`) | A few production clean-up migrations are still pending. |
| Roles | Owner / Admin / Member; members get edit, comment or view access. Transfer ownership, billing manager, workspace logo, scheduled deletion (7 days) | Fully implemented, VERIFIED (`members-guests.test`, `organization.spec`) | Default abuse cap of 50 members (admin-adjustable). |
| Invitations | Email invites bound to the address, 7-day expiry (`InviteDialog.tsx`, `MembersSection.tsx`) | Fully implemented, VERIFIED | |
| Guests | Page-level grants (editor/commenter/viewer), not billed; email invite even without an account (`pageInvites`). Guests list with member ↔ guest conversion (`GuestsSection.tsx`) | Fully implemented, VERIFIED (`guests.spec`, `members-guests.test`) | |
| Per-page permissions | `accessMode` workspace or restricted, plus explicit grants inherited by nested pages (`convex/sharing.ts`, `doc/ShareDialog.tsx`) | Fully implemented, VERIFIED (`sharing.spec`) | |
| Public links | Off by default. Optional expiry and password (≥5 characters); revocable; view count; read-only page at `/s/[token]` | Fully implemented, VERIFIED (`sharing.spec`, `shell-offline-share.spec`) | Excludes comments and nested pages. The backend has an `allowIndexing` option the UI never exposes (see §12). |
| Real-time co-editing | Block-granular, not a CRDT. Ops are batched; Convex subscriptions push changed blocks; `remoteApply.ts` patches the editor in place | Implemented, needs improvement. VERIFIED (`cross-workspace.spec` "owner sees it live", `sync-concurrent-edits.test`) | Block edits are held up to **2.5 s** before sending (`lib/sync/engine.ts` `BLOCK_SAVE_DELAY`), so others see typing with a delay. **Concurrent edits to the same block produce a conflict, not a merge.** Character-level merging is listed as "Next" in `docs/PRODUCT.md`. |
| Conflict handling | Banner with Keep mine / Keep theirs / Keep both (`DocumentView.tsx` ~l.1530) | Fully implemented, VERIFIED (`conflict.spec`) | |
| Notifications | Bell (`app/NotificationsButton.tsx`). Kinds: invite, mention, comment, reply, share, share_change, system (reminders, AI digests). Bursts are folded; read/unread; per-kind in-app prefs | Fully implemented, VERIFIED (`notifications.test`) | |
| Email notifications | 11 templates via Mailtrap (`packages/email`, `convex/email.ts`). Comments, replies and mentions arrive as they happen or in a daily digest (cron `digest.sendDailyDigests`) | Fully implemented, VERIFIED (`email-mailtrap.test`, `comments-notifications.test`) | Emails never include note text. |
| Cross-scope edit queue | One durable queue per account; guests editing pages from other scopes | Fully implemented, VERIFIED (`cross-workspace.spec`, `sync-routing.test`) | |
| Workspace audit log / analytics for customers | n/a | **Missing** | Entitlement flags exist but are always false (§12). The admin audit log is staff-only. |

---

### 5. Sync and offline

| Feature | Where | Maturity | Notes |
|---|---|---|---|
| Local-first op queue | IndexedDB (`lib/sync/db.ts`, `lib/sync/engine.ts` ~44 KB) wraps the shared reducer (`packages/editor-schema/src/sync.ts`). Idempotent ULID ops; "Saved" shows only after the server acknowledges | Fully implemented, VERIFIED (`offline.spec`, `engine*.test`, 9 golden scenarios in `fixtures/sync-scenarios.json`) | Batches of at most 100 ops; 600 batches per minute rate limit. |
| Server protocol | `convex/sync.ts`, `convex/lib/syncEngine.ts`, `docs/SYNC_PROTOCOL.md`. Revisions, contentRev/positionRev, last-writer-wins position, tombstones, rank rebalance | Fully implemented, VERIFIED | Op log kept 30 days. |
| Offline editing and cold start | Service worker shell plus offline snapshot (`lib/app/offlineSnapshot.ts`) | Fully implemented, VERIFIED (`offline.spec`, `shell-offline-share.spec`) | Needs one online visit first. **Only document and block edits are durable offline.** Comments, collections, folders/tags, sharing and task-metadata edits are plain mutations (INFERRED online-only). |
| Upload queue | Two-phase upload with retry and backoff (`lib/sync/uploads.ts`) | Fully implemented | |
| Sync status UI | Saved / Saving / Offline (count) / Syncing / Conflict / Error, plus a list of pending pages (`app/SyncStatus.tsx`, `usePendingDocs.ts`) | Fully implemented | |
| Device limit | Free Personal allows 2 devices; other plans unlimited (`convex/lib/devices.ts`, `app/DeviceLimit.tsx`, Settings → Devices) | Fully implemented, VERIFIED (`devices.spec`) | |
| Clear local data | Settings → Sync (`SyncSection.tsx`) | Fully implemented | |

---

### 6. Import and export

| Direction | Formats | Where / UI | Maturity | Limits |
|---|---|---|---|---|
| Import | Markdown (.md), plain text (.txt), a folder, or a ZIP of them. Relative images are uploaded; GitHub callouts, tables, `$$` math, page breaks and front-matter title are kept. Unsupported constructs come back as a warnings report | Settings → Data (`views/settings/DataSection.tsx`, `doc/importBundle.ts`, `convex/imports.ts`, `markdownToBlocks`) | Fully implemented, VERIFIED (`import-export.spec`) | 50 documents per batch, 2 MB of text per file, 5,000 blocks. |
| Import from Notion, Evernote, Obsidian (as a product), HTML, DOCX, CSV | n/a | n/a | **Missing** | Notion and Obsidian Markdown exports partly work through the generic Markdown path (INFERRED). |
| Export, single page | Markdown, HTML, PDF (browser print dialog, "Save as PDF") | Page ••• → Export… (`doc/ExportDialog.tsx`, `doc/export.ts`) | Fully implemented, VERIFIED (`documents.spec`) | PDF is browser print, not server-rendered. Formulas export as MathML; whiteboards as SVG; flowcharts as SVG (HTML) or Mermaid (Markdown). |
| Export, whole scope | ZIP of Markdown in folder structure, plus assets and `manifest.json` | Settings → Data / Workspace data (`convex/exports.ts`) | Fully implemented, VERIFIED (`export-deletion.spec`) | 20 exports per hour. ZIP files kept 1 day. Feature flag `workspace_export`. |
| Export AI conversations | ZIP of Markdown | Settings → AI → Export (`AiExport.tsx`, `aiChat.exportAll`) | Fully implemented, VERIFIED (`ai-export.test`) | |

---

### 7. AI (Foli AI)

- **Provider.** Google Gemini only, behind an adapter (`convex/lib/ai/provider.ts`, `gemini.ts`, `capabilities.ts`). Main model `gemini-3.8-flash`; cheap tasks use `gemini-flash-lite-latest`; embeddings use `gemini-embedding-001` at 768 dimensions.
- **Credits.** 1 credit = $0.01 of model cost (`convex/lib/credits.ts`). Monthly allowances: Pro 180, Pro AI 550, trial 100 (7 days). Free has no AI after the trial; **Core has no AI at all**. Credit packs (500/1,000) are available on Pro and Pro AI.
- **Hourly limits.** ai 150, aiHigh 300 (Pro AI), aiAgent 40, aiAgentApply 60, aiResearch 10 (`convex/lib/rateLimit.ts`).
- **Privacy switches.** Settings → AI (`AiSection.tsx`): AI on/off, keep conversations, memory, suggestions, read attachments, web research, digests. All are enforced on the server.
- **Design doc.** `docs/AI_ASSISTANT.md`. All nine milestones are marked "as built".

| Capability | Where | UI entry | Maturity | Limits / notes |
|---|---|---|---|---|
| Chat / Ask with sources | `convex/aiChat.ts`, `lib/ai/chat.ts`, `components/ai/chat/*` | Floating chat (⌘J outside a note), `/ai` page, ⌘K "Ask Foli AI", note AI panel "Ask" | Fully implemented, VERIFIED (`ai.spec`, `ai-page.spec`, `ai-chat.test`) | Streaming, stop, regenerate, edit and resend, citations to the block, context chips (up to 5 notes), rename, pin, search. |
| Semantic and hybrid retrieval | `convex/aiIndex.ts`, `lib/ai/retrieval.ts`. About 1,000-character chunks, vector plus keyword, merged by reciprocal rank fusion, filtered per note by access | Inside AI chat only | Fully implemented, VERIFIED (`ai-retrieval.test`) | **Pro, Pro AI and paid team only, not during the trial.** 200 chunks per note. Others get keyword search. |
| Agent (edits notes with approval and undo) | `convex/aiAgent.ts`, `lib/ai/tools/*`. Read tools: search_notes, get_note(s), list_folders/tags, find_related/duplicates, compare_notes, get_workspace_context, calculate, read_attachment, search_web, read_web_page. Write proposals: create/update/append/rename/move/merge notes, create_folder, add_tags, create_checklist, create_tasks | Same chat; edit intent is detected by `components/ai/editIntent.ts`; `AgentRunCard.tsx` previews and approves | Fully implemented, VERIFIED (`ai-agent.spec`, `ai-agent.test`) | 6 model calls, 12 tool calls, 150 s per run, 20 ops per run, 3 web searches and 3 pages. Version saved first; one-click Undo. |
| Writing help (⌘J inline) | `components/ai/InlineAi.tsx`, `useAi.ts`, `convex/lib/ai/writing.ts` | ⌘J in a note, `/` AI items, selection toolbar, block menu | Fully implemented, VERIFIED (`ai-writing.spec`, `ai-writing.test`) | Improve, fix grammar, shorter, longer, simplify, translate, 6 tones, turn into list/table/checklist, summarize, explain, continue, extract action items. Note-level: continue, summarize, action items, outline, brainstorm, draft from prompt, generate page. Diff preview with insert above/below, append, or create note. |
| Title suggestions | `doc/TitleAi.tsx` | Pill next to the title; AI panel "Title" | Fully implemented, INFERRED | |
| Flowchart generation and editing | `ai.flowchart`, `editor/flowchart/FlowchartAi.tsx`, `lib/flowchartAi.ts` | AI button in the flowchart toolbar | Fully implemented, VERIFIED (`flowchart.spec`) | About 3–5 credits. |
| Study: flashcards and quiz | `lib/ai/studyTools.ts`, `components/ai/StudyMode.tsx`, `study.ts` | AI panel Study tab; `/Foli AI: Flashcards`, `/Quiz` | Fully implemented, VERIFIED (`ai-study.spec`, `ai-study.test`) | Cards are stored as toggles. **Progress is per session only** (no spaced repetition, nothing persisted). |
| Meeting summary | Same tools; turns "@Name" into a mention and assignee | AI panel "Meeting", `/` item, transcript preview | Fully implemented, VERIFIED | |
| Audio transcription | `aiAttachments.transcribe`, `components/ai/AudioTranscribe.tsx`, `TranscriptPreview.tsx` | Transcribe action on an audio block (on request only) | Fully implemented, VERIFIED (`ai-attachments.spec`) | Recordings up to 14 MB (inline; Gemini Files API not used). **No live or real-time transcription.** |
| "Think it through" frameworks | Pros/cons, decision matrix (totals computed on the server), SWOT, risks, pre-mortem, mind map (as Markdown), How might we, SCAMPER, six hats | AI panel, `/` items | Fully implemented, VERIFIED (`ai-polish.test`) | |
| Whole-note translation | `aiStudy.translateNote`, `components/ai/TranslateNote.tsx` | AI panel / selection "Translate…" | Fully implemented, VERIFIED | Notes up to 60,000 characters, 14 calls. New note or replace (version saved first). |
| Research with web search | `convex/aiResearch.ts`, `lib/ai/research.ts`, `lib/ai/web.ts` (Google Search grounding plus guarded page fetch) | Chat "Research" mode, `/ai`; `ResearchCard`/`ResearchList` | Fully implemented, VERIFIED (`ai-research.spec`, `ai-research.test`) | Background job with live progress and cancel. 4 searches, 3 pages, 12 web sources, 6 notes. Save as note. Needs the Web research setting. |
| Catch me up (brief) | `ai.brief`, `components/ai/CatchUp.tsx` | Home dashboard | Fully implemented, VERIFIED (`ai.spec`, `ai-setting.spec`) | About 2 credits. |
| Scheduled digests | `convex/aiDigest.ts`, cron every 15 min | Settings → AI → Digest (`AiDigest.tsx`) | Fully implemented, VERIFIED (`ai-digests.test`) | Daily or weekly, written as a note in your Inbox plus a bell notification. Never emailed. Off by default. |
| Suggestions | `convex/aiSuggestions.ts`, `lib/ai/suggestions.ts` (heuristic, no model call; computed on the device per the last commit), `doc/NoteSuggestions.tsx` | Chip row under the note | Fully implemented, VERIFIED (`ai-suggestions.test`) | Open questions (3), action items (5), related-not-linked (3), duplicates (2). Dismissals are remembered. |
| Knowledge graph | `convex/aiGraph.ts`, `lib/ai/graph.ts`. Entities and relations via the fast model; related notes, duplicates, contradictions | `/graph`; note ••• → "Related notes" (`doc/RelatedPanel.tsx`) | Fully implemented, VERIFIED (`ai-graph.spec`, `ai-graph.test`) | Pro tiers only. 30 entities per note. Platform-paid, not charged to credits. `missingConnections` has no UI (§12). |
| Memory | `convex/aiMemory.ts`. Tone, language, length, term or instruction entries | Settings → AI → Memory; "Save" offer under chat answers | Fully implemented, VERIFIED (`ai-memory.spec`) | 200 characters per entry, 40 per scope, 1,600 characters injected. Only saved when the user approves. |
| Attachments in chat | `convex/aiAttachments.ts`, `lib/ai/attachments.ts` | Attach in the chat composer | Implemented, needs improvement. VERIFIED | PNG/JPEG/WebP 7 MB, PDF 14 MB, recordings 14 MB, text/MD/CSV/HTML/JSON 2 MB; 5 files per message. **No DOCX, XLSX or PPTX** ("not supported yet"). |
| Sharing conversations | `convex/aiSharing.ts` | Conversation menu → "Share with workspace…" | Fully implemented, VERIFIED (`ai-sharing.spec`) | Team workspaces only, read-only, visible only if the viewer can open every cited note. |
| Usage view | `AiUsage.tsx`, `billing.aiUsage` | Settings → AI | Fully implemented, VERIFIED (`ai-usage.test`) | Broken down by feature and by day. |
| Onboarding, a11y, gated states | `AiIntro.tsx`, `AiUnavailable.tsx`, `announce.tsx` | First AI surface | Fully implemented, VERIFIED (`ai-onboarding.spec`, `ai-a11y.spec`) | |
| Not present | n/a | n/a | Missing | Image generation, voice chat, a choice of AI model, bring-your-own key, AI autocomplete while typing. |

---

### 8. Platform and integrations

| Item | Status |
|---|---|
| Web app (responsive, touch long-press) | Present, VERIFIED. |
| PWA (installable, offline shell) | Present. |
| Mac app (Electron) | Quick Add global shortcut ⌥Space (configurable or off), menu bar icon (quick add, new note, recent notes, save state), open at login, Mac notifications (comments, mentions, reminders), Dock unread badge, File/Go menus, ⌘N/⇧⌘N/⌘[/⌘], spellcheck, offline page, remembered window state. Settings → Desktop app. VERIFIED (`desktop-app.spec`, `apps/desktop/src/shell.test.ts`). **Not notarized or distributed, arm64 only, no auto-updater, no custom URL scheme or deep links** (no `setAsDefaultProtocolClient` or `open-url`). |
| iOS / iPadOS / Android / Windows | **Missing** (out of scope). |
| Public REST/GraphQL API, API keys, personal access tokens | **Missing.** `sync.pushJson`/`pullJson` and Better Auth PKCE endpoints (`convex/lib/nativeAuth.ts`) exist for the retired native app; not a public API. |
| Outbound webhooks for users | **Missing.** The only webhooks are inbound: `/webhooks/polar`, `/webhooks/mailtrap`, `/webhooks/mailtrap-inbound` (`convex/http.ts`). |
| MCP server | **Missing.** |
| Browser clipper / extension | **Missing.** |
| Calendar integrations (Google/Outlook/iCal feed) | **Missing.** |
| Zapier / Make / Slack / GitHub, etc. | **Missing.** |
| Email-in (email to note) | **Missing.** The inbound mail webhook only feeds **support tickets** (`convex/support.ts`). |
| Unsplash | Present when configured. |
| In-app support | Help → support form leads to an admin Support inbox with email threading (`components/support/*`, `convex/support.ts`). VERIFIED (`support.spec`, `support.test`). |

---

### 9. Accounts, billing and admin

| Feature | Where | Maturity | Notes |
|---|---|---|---|
| Email and password auth | Better Auth inside Convex (`convex/auth.ts`, `docs/AUTH_DECISION.md`). Confirmed email, reset, change password | Fully implemented, VERIFIED (`account.spec`, `identity.spec`, `auth-hardening.test`) | **No social sign-in (by design), no magic links, no passkeys, no SSO/SAML, no breached-password check.** Email change is support-only. |
| 2FA (TOTP) | Optional; 10 backup codes, 30-day trusted device, move to a new authenticator (`SecuritySection.tsx`, `components/auth/TwoFactor.tsx`) | Fully implemented, VERIFIED | Required for the admin console. |
| Sessions | List and revoke one or all others; revocation is instant | Fully implemented, VERIFIED | Revoking from Settings is listed as "not yet checked on production". |
| Account deletion | 7-day grace; blocked while you own a workspace others use | Fully implemented, VERIFIED (`export-deletion.spec`, `account-cleanup.test`) | |
| Plans | Free, Core ($1.99), Pro ($4.99), Pro AI ($13.99) for Personal and per-seat Team (`convex/lib/plans.ts`, `docs/BILLING.md`). Storage: 500 MB pooled (Free), 10 GB, 10 GB, 50 GB | Plan logic implemented, VERIFIED (`billing.test`, `workspace-billing.test`, `credits.spec`) | |
| Payments (Polar) | Checkout, portal, webhooks, seat sync, credit packs (`convex/billing.ts`, `workspaceBilling.ts`, `lib/polar.ts`) | **Partially implemented: code complete, not configured on production.** UI shows "Coming soon" / "Online payments are coming soon" (`BillingSection.tsx` ~l.293, `WorkspaceBillingSection.tsx` ~l.255). Test purchases only outside production | |
| Admin console `/admin` | Users, workspaces, billing setup, revenue, analytics (aggregates), email log, support inbox, theme manager, feature flags, rate limits, maintenance or read-only mode, deletion jobs, append-only audit log. Three staff roles; MFA required; no content viewer (`docs/ADMIN.md`, `convex/admin*.ts`) | Fully implemented, VERIFIED (`admin.spec`, 11 tests) | |
| Feature flags | `public_links`, `workspace_invites`, `new_signups`, `workspace_export`, all default on (`convex/lib/flags.ts`) | Present | |
| Product analytics | Server-side aggregate metrics only (`dailyMetrics` cron, `adminAnalytics.ts`). No third-party trackers | Present | |

---

### 10. Themes and appearance

| Feature | Where | Maturity | Notes |
|---|---|---|---|
| Dark mode | Light / Dark / System, plus editor text size (`AppearanceSection.tsx`) | Fully implemented, VERIFIED (axe checks in light and dark) | |
| Note themes | 57 built-in artwork themes (`art-01`…`art-57`) that also colour text, highlights and blocks; theme gallery (`doc/ThemeGallery.tsx`); admins can add, retire or reorder themes and gate them by plan (`convex/adminThemes.ts`, `lib/noteThemes.ts`) | Fully implemented, VERIFIED (`note-themes.spec`, `note-themes.test`) | |
| Page style | Font (sans/serif/mono/rounded), width (narrow/default/wide), background (paper/plain/tinted/grid), sheet colour (7), text colour (7), accent, card style, separator style, blur; own image as backdrop (Style panel, `Inspector.tsx`) | Fully implemented, VERIFIED (`page-layout.spec`) | |
| Covers and icons | Cover kinds none/colour/gradient/image/art, toned covers; emoji page icons (`lib/cover.ts`) | Fully implemented, VERIFIED (`covers.spec`) | |
| Custom CSS, workspace branding | Only a workspace logo and avatars | Mostly missing | |

---

### 11. Architecture, performance and tests

- **Stack.** Next.js 16 on Vercel, Convex (database, functions, file storage, auth via Better Auth), Tiptap/ProseMirror, IndexedDB, Mailtrap (email), Polar (payments, not live), Gemini (AI), Electron 44 (Mac).
- **Sync design.** Block-level operations with fractional ranks (base-62). Per-scope sequence counters (`scopeCounters`). Server-authoritative revisions. Conflicts are typed. Not a CRDT.
- **Typing cost** (last commit). Block saves are batched every 2.5 s; the note's row settles every 30 s (`convex/lib/editSettle.ts` `SETTLE_MS`); auto-versions every 10 min.
- **Schema limits** (`spec/folevi-blocks.v1.json`):
  - 5,000 blocks per document
  - 20,000 characters per text block; 100,000 per code block
  - depth 8
  - tables 200×20
  - formula 10,000 characters
  - whiteboard and flowchart data 200 KB each
- **Other limits:**
  - files 100 MB; images 20 MB / 50 MP
  - collections: 2,000 rows, 40 properties, 20 views
  - import: 2 MB of text per file, 50 docs per batch
  - search: at most 50 results
  - sync: 100 ops per batch
  - audio: 60 minutes
- **Background jobs** (`convex/crons.ts`):
  - every few minutes or hourly: deletion jobs (5 min), reminders (1 min), presence cleanup, AI stream/chat/research sweeps, AI digests (15 min), expired plans
  - daily: trash (30 d), tombstones, housekeeping, snapshot retention (30 d), comment email digest, orphaned uploads, export retention, metrics, AI index and graph sweeps
- **Test coverage.** These counts come from grepping the test files; I did not run them. `docs/PRODUCT.md` still says 107 / 64 / about 80, so it is out of date.
  - Convex integration: about **530** test cases in 50 files (`tests/convex/`), including static invariants and performance/read-count tests.
  - Web unit: about **286** in 47 files (`apps/web/test`).
  - editor-schema: about **100** in 14 files.
  - Playwright e2e: about **170** tests in **66** specs (about 6,500 lines), with axe WCAG checks. Chromium only; Safari and Firefox are on a manual checklist.
  - Desktop shell: unit tests plus one Electron e2e.
- **Security.** Not end-to-end encrypted (`docs/SECURITY.md`). CSP/HSTS, signed file URLs, metadata stripping, authorization invariants enforced in CI.

---

### 12. Hidden capabilities, stubs, flags and "coming soon"

**Backend with no UI entry point**
- `aiGraph.missingConnections` (`convex/aiGraph.ts` l.496): tested, never called by the web.
- `tasks.moveToDocument` (`convex/tasks.ts` l.340): moves a task to another page; no UI.
- `documents.daily` / `documents.dailyDates`: the retired Daily Notes, kept read-only.
- `documents.children`, `documents.create`, `documents.snapshots`, `comments.unreadCount`/`markRead`, `blocks.deleted`, `aiChat.create`, `settings.ping`: not referenced by the web (legacy or alternate paths).
- `sync.pull`, `pullJson`, `pushJson`, `head`, plus the PKCE native sign-in (`convex/lib/nativeAuth.ts`): a platform-neutral API left over from the archived Swift app, intended for a future iOS client. The web uses `sync.push` plus live queries.
- Public links `allowIndexing`: accepted by `sharing.createPublicLink` and honoured by `/s/[token]/page.tsx` l.86, but `ShareDialog` never sets it, and the UI copy says links are never indexed.

**Declared but always false (placeholders for future tiers):** `PlanEntitlements.advancedPermissions`, `auditLog`, `workspaceAnalytics`, `securityControls`, `prioritySupport` (`convex/lib/plans.ts` ~l.93). Nothing enforces or reads them outside `plans.ts`.

**"Coming soon" and not live**
- Polar payments: the Billing and Workspace-billing UIs show "Coming soon".
- `AVAILABILITY = "On the web · Mac app coming soon"` (`convex/lib/plans.ts` l.210). App metadata and the OG image (`app/layout.tsx`, `opengraph-image.tsx`) say the same.
- The AI settings component supports a `soon` badge, but no setting currently uses it.

**Configuration-dependent:** Unsplash (`UNSPLASH_ACCESS_KEY`), Polar (`POLAR_*`), Gemini (`GEMINI_API_KEY`), Mailtrap inbound for support (`MAILTRAP_INBOUND_API_TOKEN`).

**Known gaps the docs themselves state:** no breached-password check, no passkeys, no character-level merge, Mac app not notarized, no public status dashboard, Gemini Files API not used (so the 14 MB cap), no DOCX/XLSX/PPTX parsing, some production checks still open (public link create/revoke, export, session revoke).

**Not built anywhere (competitive gaps):**
- Recurring tasks
- Natural-language dates in Quick Add
- Calendar events or external calendar sync
- Email or push reminders
- Live cursors
- Comment reactions
- Video/iframe embeds, columns, synced blocks
- Database calendar/timeline views, formulas, rollups
- Inline math
- Nested folders beyond one level
- Cross-scope (Personal ↔ workspace) move or copy
- Semantic search in ⌘K
- Notion/Evernote/Obsidian importers, HTML/DOCX import
- Public API, webhooks, MCP, clipper, Zapier, email-in
- SSO/SAML, passkeys
- Customer-facing workspace audit log and analytics
- Native mobile apps, Windows/Linux desktop
- Languages other than English
