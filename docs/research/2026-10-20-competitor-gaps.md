# Where competitors are ahead of Folevi (2026-10-20)

Date: 2026-10-20. Research only; no code was changed. This report answers one question from the owner: what do competitors do better, feature by feature, and what should Folevi build or fix first.

**How it was made.** Folevi's side comes from `docs/PRODUCT.md`, `docs/VISUAL_BLOCKS_PLAN.md`, `docs/AI_ASSISTANT.md`, `docs/IOS.md`, `docs/DESKTOP.md`, `docs/BILLING.md`, the git log since 2026-10-14 and spot checks in the code (`convex/`, `apps/web/src`, `packages/editor-schema`). The competitor side comes from five research passes on 2026-10-20 over official sites, changelogs, help centres, pricing pages and App Store listings, plus forums. Every competitor claim has a source in Part 6. Items marked **(unverified)** could not be confirmed on a vendor page. Items marked **(third-party)** come from a review site, tracker or press, not the vendor. Reddit blocked the research tools, so user sentiment comes from HN, TidBITS, MacPowerUsers, official forums and Trustpilot.

**Scales.** Effort: **S** days, **M** 1 to 4 weeks, **L** months (one developer with Claude Code). Impact on winning and keeping users: **H** high, **M** medium, **L** low.

---

## What changed since the 2026-10-14 analysis

The earlier report (`docs/research/2026-10-14-competitive-analysis.md`) listed many gaps that are now built (commits 2026-10-14 to 2026-10-20). They are not repeated below as gaps:

- **Data in and out:** remote MCP server with OAuth (read and write, every plan), REST API v1 with personal access tokens, signed outbound webhooks, web clipper for Chrome and Edge (built, not yet in the stores), email-to-note address, PWA share target and bookmarklet, importers for Notion, Evernote, Word, HTML and CSV, embed block (YouTube, Vimeo, Loom, Figma, Google Maps).
- **Tasks:** natural-language dates, repeating tasks, email and push reminders, a private iCal feed, read-only ICS calendar subscriptions, calendar week view with an hour grid, calendar view for collections, Move task to another page.
- **Collaboration:** live carets (`apps/web/src/components/doc/LiveCarets.tsx`), edits sent within half a second when others are present, comment reactions, a Changes inbox, "Since you were away", copy a note between Personal and a workspace, nested folders (5 levels).
- **Foli AI:** search by meaning in ⌘K across all places (Pro tiers), routines (Morning brief, Open loops), transcription of recordings of any length, call recording on Mac (mic plus system audio), meeting notes into dated, assigned to-dos, spaced repetition for flashcards, Word attachments.
- **Accounts:** passkeys, breached-password check, Sign in with Google.
- **Platforms:** an iPhone and iPad app (Capacitor shell) with interactive widgets, Lock Screen widgets, a Control Center control, a share extension, Siri and Shortcuts actions, Spotlight, a document scanner with text recognition, Face ID lock and push notifications. Windows was dropped on 2026-10-16.
- **Visual blocks and tables (2026-10-19):** mind map, sticky notes board, chart, wireframe, flowchart full canvas, table formulas with A1 and column-name references, number formats, totals and saved views, block copy and cut.

What has **not** changed: the Mac app is still not notarized or distributed, the iOS app is not on the App Store (no Apple Developer Program yet), co-editing is still block-level, and Foli AI is still Gemini only.

**Inconsistencies found.** Folevi's own marketing understates the product. `apps/web/src/components/marketing/content/compare.tsx` still says "Mac app coming soon. No iOS, iPad, Android or Windows app yet" and "Import: Markdown and text files", and `AVAILABILITY` in `convex/lib/plans.ts:210` is "On the web · Mac app coming soon". `docs/PRODUCT.md` still lists the iOS client under "Next". These cost sign-ups today and take minutes to fix.

---

## Part 1. Summary: the 10 most important things competitors do better

Ranked by impact on winning and keeping users.

| # | What competitors do better | Who | What Folevi should do |
|---|---|---|---|
| 1 | **You can download them.** Every close rival is in the App Store and ships signed desktop apps; Notion's iOS app has 4.8 stars from 90K ratings, Evernote 78K, Goodnotes 463K. Folevi's iPhone, iPad and Mac apps are built but nobody can install them, and the clipper isn't in a store. | Notion, Craft, Apple Notes, Bear, Obsidian, Evernote, Capacities | Join the Apple Developer Program, notarize the Mac app, ship TestFlight then the App Store, submit the clipper to the Chrome and Edge stores. |
| 2 | **Writing together without conflicts.** Google Docs, Notion and Apple Notes merge edits letter by letter; Google Docs adds suggesting mode with accept and reject. Folevi turns two people in one block into a conflict and has no human suggest mode. | Google Docs, Notion, Apple Notes, Goodnotes Pro | Move block text to a CRDT (character merge), then add suggesting mode on top of the existing AI preview and accept flow. |
| 3 | **Calendar in both directions, with meetings attached.** Two-way Google, Outlook and iCloud sync, meeting notes tied to calendar events, briefs before a meeting, calls detected automatically. Folevi reads ICS links and publishes a feed only, and recording is manual. | Notion Calendar, Capacities, Tana, Granola, Mem, Evernote | Two-way Google and Outlook calendar, then "meeting note from event" with a Foli AI brief before it and the recorder linked to it. |
| 4 | **Deeper databases.** Notion has 10 view types (timeline, list, form, chart, map, dashboard), formulas, rollups and automations; Obsidian Bases has formulas and summaries; Capacities queries calculate. Folevi collections have 4 views and no formulas or rollups. | Notion, Obsidian, Capacities, Coda | Reuse the table formula engine for collection formula and rollup properties; add list and timeline views; then simple automations and forms. |
| 5 | **Choice of AI model, your own key, free on-device AI.** Notion offers many frontier models with cost scorecards and lets Business pay with a ChatGPT plan; Craft runs Apple's on-device models free and takes OpenAI or Anthropic keys; Heptabase, Tana and Capacities have model pickers. | Notion, Craft, Heptabase, Tana, Capacities, Reflect, Granola | Add a second and third provider behind the existing adapter (`convex/lib/ai/provider.ts`), a model picker on Pro AI, then BYOK. |
| 6 | **Finding text inside images, PDFs and handwriting.** Evernote, Apple Notes and Bear Pro search scans, photos and PDFs; Goodnotes and Apple Notes search handwriting; Heptabase and Capacities annotate PDFs. Folevi's search covers note text only and files are cards. | Evernote, Apple Notes, Bear, Goodnotes, Heptabase, Capacities | Extract text from uploaded PDFs and images into search (Gemini vision on paid plans, the iOS Vision recogniser where possible); add an inline PDF viewer with highlights. |
| 7 | **Page layout tools.** Columns, synced blocks or block references, tabs inside a page and presentation mode. | Notion, Capacities, Craft, Evernote, Google Docs | Ship a columns block, then presentation mode from headings or dividers, then synced blocks. |
| 8 | **Publishing a site on your own domain.** Multi-page sites with custom domains. Folevi publishes single pages on its own domain. | Notion Sites, Obsidian Publish, Craft, Coda | Publish a page with its subpages as a site, with navigation and a custom domain as a paid add-on. |
| 9 | **Connected to the tools teams already use.** Slack and Teams notifications, Jira, GitHub, Drive, listed Zapier apps, an AI that can reach other tools, listings in the ChatGPT and Claude directories. | Notion, Coda, Tana, Mem, Miro, Heptabase | List Folevi's MCP server in the Claude and ChatGPT directories, publish a Zapier app on top of the REST API and webhooks, add Slack notifications. |
| 10 | **Speaks the user's language.** Notion has 22 languages including right-to-left, Obsidian 42, UpNote 52, Evernote 26, Craft 13. Folevi is English only. | Notion, Obsidian, UpNote, Evernote, Craft, Granola | Finish moving strings into the catalog (`docs/LOCALIZATION.md`) and launch 4 to 6 languages, starting with Spanish, German, French, Portuguese and Japanese. |

Just outside the top 10: **user-defined Foli AI agents** (Notion Custom Agents, Tana, Mem; Folevi has 2 preset routines), **end-to-end encryption** (Apple Notes, Obsidian, Bear, Anytype), **SSO and audit logs** for team sales (Notion, Tana, Goodnotes, Whimsical, Miro), a **native Android app** (dropped by decision; Obsidian, Craft, Capacities, Heptabase and Granola all have one), and **daily notes** (Craft, Obsidian, Capacities, Reflect, Heptabase; Folevi retired them).

---

## Part 2. Gaps by dimension

Each table lists only places where a competitor is ahead today. "Folevi today" describes this repository as of 2026-10-20.

### 2.1 Editor and writing

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Columns (side-by-side blocks) | Notion, Capacities, Craft | Notion columns are a core block; Capacities added two-column blocks (Jun 2026); Craft lays out up to 5 cards per row (Aug 2026) | None. Blocks stack in one column | M | H |
| Synced blocks or block references | Notion, Capacities, Logseq | Notion synced blocks (since 2021); Capacities block references (Jun 2026); Logseq is built on them | Page links and backlinks only | M | M |
| Tabs inside a page | Notion, Evernote, Google Docs | Notion `/tabs` block (2026-03-30); Evernote v11 tabs; Docs tabs | Browser-style tabs between pages, not inside one | S | L |
| Presentation mode | Notion, Capacities, Whimsical, Apple Freeform | Notion turns dividers into slides (Plus, beta, 2026-03); Capacities presentation mode (Jul 2026); Freeform Scenes | None | M | M |
| Human suggesting mode | Google Docs | Suggest edits, accept or reject one by one or in bulk; Gemini drafts replies to comments and proposes edits (2026-07-28) | Foli AI changes are previewed and accepted; people can't suggest edits to each other | M | H |
| Native-speed writing feel | Bear, Craft, Apple Notes | Native editors; Craft 3.7 reports up to 5x faster typing in large docs (2026-10-11); Bear praised for speed | Web editor in shells; no measured large-document numbers | M | H |
| Dictation and voice drafting | Google Docs, Keep, Notion, Apple Notes | Docs Live drafts by voice (Pro and Ultra, 2026-09, third-party); Keep Live; Notion Mac dictation; Apple Watch dictation into Notes and Bear | Audio recording and transcription; no live dictation into the text | M | M |
| DOCX and ePub export | Bear, Craft | Bear exports PDF, HTML, DOCX, ePub; Craft exports DOCX on web | Markdown, HTML, PDF (print), ZIP; Word import only | S | M |
| Copy as Markdown, Markdown paste | Apple Notes, Google Docs | iOS 27 Notes pastes Markdown as rich text and copies as Markdown; Docs edits Markdown natively (2026-10-05) | Markdown paste is supported; "Copy as Markdown" for a selection not checked (unverified) | S | L |
| Agent-built interactive blocks | Notion | Notion 3.6 HTML blocks built by agents (calculators, quizzes, org charts) | None | M | L |
| Typewriter mode | Bear (beta) | Bear 3.0.3 beta (2026-10-16) | Focus mode (sidebar and inspector hidden); no typewriter scrolling | S | L |

Notes: the editor's block range is now wider than most rivals (mind map, stickies, chart, wireframe, flowchart, formulas in tables). The gaps are layout (columns, tabs, presentation) and collaboration flow (suggesting). Columns are the most requested layout feature in this category and the one most visible in templates people import from Notion; the Notion importer will flatten them today.

### 2.2 Databases, collections and views

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| More view types | Notion, Obsidian, Capacities | Notion: table, board, calendar, timeline, gallery, list, form, chart, map, dashboard; Obsidian Bases: table, list, cards, map, kanban (kanban 2026-09-02); Capacities: table, gallery, card, list | Table, board, gallery, calendar | M | H |
| Formula and rollup properties | Notion, Obsidian Bases, Capacities, Coda | Notion formulas and rollups (long-standing, not re-checked); Bases formulas, functions and summaries; Capacities query calculations (sum, average, date range; 2026-10-02) | Property types: text, number, checkbox, date, select, multi-select, URL, person, relation. Formulas exist only in table blocks | M | H |
| Automations | Notion, Coda | Notion database automations (Plus and up); Coda automations by plan | None | M | M |
| Forms | Notion | Forms into a database, conditional logic on Business | None | M | M |
| Dashboards | Notion | Dashboard view with up to 12 widgets (Business, 2026-03) | Chart block can read a collection live; no dashboard view | M | L |
| AI autofill of properties | Notion | AI Autofill (trial on Free) | Foli AI fills and cleans table blocks; not collection properties | S | M |
| Typed objects | Capacities, Tana | Object types (Person, Book, Meeting) with properties and templates; Tana supertags and fields | Collections plus pages; no types on pages | L | M |
| Bulk edit and merge | Capacities | Bulk property editing (2026-09-18); merge objects (2026-10-02) | Bulk actions in the note browser; not in collections (unverified) | S | L |
| Synced databases from other tools | Notion | GitHub, Jira, Salesforce synced databases with sync health (3.8, 2026-10-13) | None | L | L |
| Column-level permissions | Notion | Owners choose which properties each person or agent sees or edits (3.8) | Page-level restrictions only | M | L |

Notes: this is Folevi's biggest structural gap against Notion and the one switchers notice first after importing. The fastest path is to reuse `packages/editor-schema/src/tableFormulas.ts` (the evaluator built for table blocks) for a formula property, then rollups over relations. List and timeline views follow from the calendar view's date handling.

### 2.3 Tables and formulas

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Merge cells | Notion (simple tables) | Release 2026-05-26 (title only; details unverified) | No merged cells | S | L |
| Formulas anywhere in the doc | Coda (Superhuman Docs) | Formulas and buttons on the page canvas, not only in tables (long-standing, not re-verified) | Formulas live inside a table block | M | L |
| Large shared tables | Coda | Superhuman Databases up to 1,000,000 rows shared across docs (closed beta, 2026-07-08) | Tables are blocks with size limits | L | L |

Notes: as of 2026-10-19 Folevi's table block is ahead of the notes-app field here. Notion's simple tables don't calculate (formulas live in databases; long-standing, not re-checked), and neither Craft nor Apple Notes tables compute. Few gaps remain; keep the advantage visible in marketing.

### 2.4 Visual blocks (whiteboard, mind map, diagrams, charts)

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Canvas as a place of its own | Miro, Whimsical, Heptabase, Obsidian Canvas, Craft, Freeform | Infinite boards with notes, cards, files and shapes; Whimsical multi-page files (2026.12); Heptabase cards on whiteboards; Craft whiteboards with stickies and live cursors | Each visual is a block inside a note, with a full-canvas mode; the whiteboard is freehand only | M | M |
| Board from one prompt, agent on the canvas | Miro, Whimsical | Miro Sidekicks build whole boards with voice input (Canvas 26, 2026-05-19); Ask Whimsical creates diagrams, wireframes and mind maps (2026.8) | Foli AI per block (flowchart, mind map, stickies, chart, wireframe) | S | M |
| More diagram kinds from AI | Miro | ER, UML sequence and class, org chart, editable, 1 credit each | Flowchart, mind map, org chart (chart block), Mermaid covers sequence and ER as code | S | L |
| Paste from other canvas tools | Whimsical | Paste from Miro, FigJam, Lucid, Excalidraw, tldraw, Canva, Visio, Mural as editable objects (2026.13) | None | M | L |
| Facilitation | Miro | Engage activities for up to 50, follow, private mode, timer and voting from Starter | Stickies have votes and a shared timer; no follow or private mode | M | L |
| Async video walkthroughs | Miro | Talktrack: record, edit and embed walkthroughs | None | L | L |
| Handwriting recognition and pressure | Goodnotes, Apple Notes, OneNote | Goodnotes handwriting search, Scribble to text, Restyle (2026-10); Apple Smart Script and Math Notes; OneNote Copilot reads ink | Whiteboard takes Pencil, palm rejection after a pen draws; fixed stroke width; no recognition | L | M |
| Live pointers on the canvas | Miro, Craft, Whimsical | Real-time cursors on boards | Live carets in text; canvas pointers not checked (unverified) | S | L |

Notes: Folevi is ahead of every notes app on visuals inside notes (mind map, stickies with votes and timer, live charts from tables, wireframes). The visual-tool specialists are ahead on the canvas as a whole surface and on meeting facilitation. Don't chase Miro; a "board" page type that holds several visual blocks, plus presentation mode (2.1), covers most of what notes users want.

### 2.5 AI

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Model choice | Notion, Tana, Heptabase, Capacities, Granola, Craft | Notion's picker with speed, intelligence and cost scorecards, admin allow-list (2026-08 and 09); Heptabase Opus 5.5, GPT-6, Gemini 4 and open models; Capacities OpenAI, Anthropic, Google, xAI and Auto (2026-08-17) | Gemini only | M | H |
| BYOK or pay with your own subscription | Craft, Reflect, Heptabase, Tana Outliner, Notion | Craft: ChatGPT sign-in, Anthropic key, local models, works without a plan; Reflect Open BYOK with keys in the keychain; Heptabase custom endpoint; Notion Business pays through a ChatGPT plan (3.8) | None | M | M |
| Free on-device AI | Craft, Apple Notes | Craft uses Apple Foundation Models offline at no credit cost (2026-06-05); Apple Intelligence in Notes | None; every request goes to Gemini | M | M |
| User-defined agents on a schedule or trigger | Notion, Tana, Mem | Notion Custom Agents with triggers, sub-agents, Skills (3.3 to 3.8); Tana agents described in plain English, e.g. a daily brief to Slack (2026-08-28); Mem Custom Routines (from $29) | Two preset routines (Morning brief, Open loops) and digests | M | H |
| Meeting notes tied to the calendar | Notion, Granola, Tana, Mem, Evernote | Notion AI Meeting Notes, no bot, speaker labels, linked to Google and Outlook events (Business, 2026-07); Granola pre-meeting briefs; Tana auto-detects unscheduled calls (2026-08-25); Evernote speaker recognition | Manual recording and transcription, meeting summary to to-dos; Mac call capture not distributed; no calendar link or speaker names | M | H |
| Live in-meeting help and voice agents | Tana, Mem | Tana live suggestions and silent "Hey Tana" (2026-09-08), voice agent on mobile (2026-10-08); Mem Heads Up Live and Voice Mode | None | L | M |
| Search across other tools | Notion, Mem, Tana | Notion Enterprise Search over Slack, Drive, GitHub, Salesforce (Business, beta); Mem connections to Gmail, Slack, Todoist; Tana connects to MCP servers | Foli AI reads Folevi notes and the web; Folevi is an MCP server but not a client | L | M |
| Reusable skills | Notion, Heptabase, Google | Notion Skills exportable as SKILL.md, Skills API (3.7, 3.8); Heptabase AI skills (2026-07-23); Gemini skills (2026-10-02) | Memory entries and AI templates; no named, shareable skills | S | M |
| Image generation | Notion, Capacities, Google Docs, Apple | Notion (Business beta, 10 a day); Capacities (Pro, 2026-09-01); Gemini in Docs makes images and infographics (2026-07-28); Image Playground | None | S | L |
| Audio overviews and code over sources | Gemini Notebook | Audio and Video Overviews; a cloud computer per notebook that runs code (2026-07-16) | Flashcards, quizzes, `calculate` tool | M | L |
| AI in comment threads | Google Docs | Summarises threads, drafts replies, proposes edits (2026-07-28) | None | S | M |
| Office files in and out | Notion | Agents read and create PPTX, XLSX, DOCX, PDF (3.6) | Reads DOCX, PDF, CSV; XLSX and PPTX "not supported yet" | M | L |
| Some AI on the free plan | Craft, Tana, Mem, Miro, Apple | Craft Free 15 credits; Tana Free 50 queries; Mem Free 25 messages; Miro Free 10 credits; Apple free | Free has Foli AI only in the 7-day trial | S | M |
| Graceful credit run-out | Heptabase | Out of premium credits drops to basic models instead of stopping (2026-07-23) | Refused with an upgrade or credit-pack offer | S | M |

Notes: Foli AI is broad (agent with preview and undo, research, study, graph, memory, routines, visual-block AI) and cheap. The 2026 frontier has moved to four things Folevi lacks: model choice, calendar-aware meetings, user-built agents, and reaching other tools. The provider adapter and capability registry in `convex/lib/ai/` were built for exactly the first one.

### 2.6 Search and organisation

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Search inside images, PDFs and scans | Evernote, Apple Notes, Bear, Heptabase | Evernote searches PDFs, images and handwriting; Apple Notes searches handwriting, objects in images and scanned text; Bear Pro OCR; Heptabase OCR (Premium) | Note text only; iOS scanner inserts recognised text into the note | M | H |
| PDF reader with highlights | Heptabase, Capacities, Goodnotes | Heptabase PDF highlights and annotation; Capacities reader view and PDF annotation (Believer first, 2026-08 and 09) | Files are cards; Foli AI reads PDFs; no inline viewer | M | M |
| Daily notes or journal | Craft, Obsidian, Capacities, Reflect, Heptabase, Logseq | Craft daily notes with a template and date-range export (2026-08 and 09); Reflect daily note beside calendar events | Retired on purpose; old daily notes stay as pages | S | M |
| Smart folders and saved searches | Apple Notes, Obsidian | Apple Notes Smart Folders by tag and filter; Obsidian Bases as saved queries | Tags, folders, starred; no saved search | S | M |
| Tag workspaces and nested tags | Bear | Nested tags, TagCons, "Tag as Workspace" (2.9, 2026-07-16) | Flat tags | S | L |
| Plugin and theme ecosystem | Obsidian | Over 8,000 plugins and themes, doubled since May 2026 | No plugins; 57 built-in themes | L | M |

Notes: Folevi's ⌘K now searches every place at once and by meaning on Pro tiers, and the knowledge graph covers what Obsidian and Capacities graphs do. The clear gap is content inside attachments, which matters most to Evernote switchers, the audience Folevi's Evernote importer targets.

### 2.7 Tasks and calendar

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Two-way calendar sync | Notion Calendar, Capacities, Tana, Mem, Evernote, Goodnotes | Notion Calendar edits Google, Outlook (2026-06) and iCloud events and RSVPs; Capacities two-way with Google, Outlook, iCloud and CalDAV (moving an object's date moves the event); Tana two-way Google and Outlook (2026-07) | Read-only ICS subscriptions in; private iCal feed of tasks out | M | H |
| Scheduling links and auto-blocking | Notion Calendar | Booking links and auto-block of busy time across calendars (free) | None | M | L |
| Apple Reminders and Calendar on device | Craft | Apple Reminders beside Craft tasks; Apple Calendar events in the calendar (2026-07, 08) | None in the iOS shell | M | M |
| Meeting note from an event | Reflect, Notion, Evernote | Reflect spawns meeting notes from Apple Calendar events; Evernote suggests the calendar link for a recording | None | S | M |

Notes: Folevi's task layer (every to-do is a task, recurrence, natural dates, reminders on every channel, widgets) is now as good as Craft's and ahead of Notion's. The missing half is events. Two-way Google and Outlook is the item that unlocks the meeting features in 2.5.

### 2.8 Collaboration

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Character-level co-editing | Google Docs, Notion, Apple Notes, Goodnotes Pro | Letter-by-letter merging (long-standing; not re-verified on a 2026 page); Apple shared notes near real time with highlights and an activity view | Block-level: two people in one block get a Keep mine, Keep theirs, Keep both conflict; live carets shown | L | H |
| Suggesting mode | Google Docs | See 2.1 | None for people | M | H |
| Assign a comment | Google Docs | Assign tasks from comments | Comments with threads, reactions, resolve; no assignee | S | M |
| Notifications in Slack or Teams | Notion, Tana | Notion sends mentions, comments and access requests to Teams with replies (3.8); Tana Slack app | Email, web push, APNs, Mac notifications | S | M |
| Private team areas | Notion | Private teamspaces (Business), permission groups (Enterprise) | Restricted pages with grants; no team areas inside a workspace | M | M |
| Chat and channels | Anytype | Built-in chat and channels | Comments only | L | L |

Notes: for async teams Folevi is strong (free guests, roles, Changes inbox, author-coloured history). For co-writing it falls short of Docs and Notion. Character merging is the one engineering investment in this report that can't be shortcut, so start it early.

### 2.9 Publishing and sharing

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Multi-page sites | Notion Sites, Obsidian Publish, Coda | Notion Sites (1 notion.site domain Free, 5 on paid); Obsidian Publish sites with navigation, a reader graph, custom CSS and JS, 4 GB | Single public pages with themes, password, expiry, indexing switch | M | H |
| Custom domains | Notion, Obsidian, Craft, Coda | Notion $8 a month yearly or $10 monthly per domain; Obsidian Publish $8 to $10 per site; Craft custom subdomains on Plus; Coda custom domains on Pro | None | M | M |
| Access by email domain | Craft | Publish restricted to an email domain, with expiry and indexing controls (3.7, 2026-10-11) | Password and expiry only | S | L |
| Forms | Notion | Forms into databases | None | M | M |

Notes: themed public pages are already a differentiator. A "publish with subpages" site plus a custom domain add-on turns them into a creator feature and a small revenue line.

### 2.10 Import, export and integrations

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Store-listed web clipper, many browsers | Obsidian, Evernote, Milanote | Obsidian clipper free, open source, 8 browsers, highlights and templates with site rules; Evernote's long-standing clipper | Chrome and Edge build, not yet in the stores; no Safari or Firefox; iOS share sheet covers Safari on iPhone | S | H |
| More importers | Craft, Capacities, Obsidian | Craft imports Apple Notes and Google Docs (OAuth), Quip in development; Capacities imports Readwise, Kindle, Todoist, Things, Reminders; Obsidian added Airtable (2026-08) | Notion, Evernote, Word, HTML, CSV, Markdown and ZIP | S | H |
| Listed Zapier and Make apps | Coda, Capacities (roadmap) | Coda on Zapier; Capacities lists Zapier, Make and n8n on its roadmap | REST API and webhooks usable from Zapier by hand; no listed app | S | M |
| Slack, GitHub, Jira, Drive | Notion, Coda, Tana, Miro | Notion native connections; Coda Packs (about 40 to 89 by plan); Tana Send to Linear and Jira (2026-08-21); Miro two-way connectors | None | M | M |
| Listed in AI directories, a CLI | Heptabase, Mem, Bear, Obsidian, Craft | Heptabase ChatGPT plugin (2026-09-23) and Claude plugin (2026-10-09) plus a CLI; Mem and Bear Claude connectors; Obsidian CLI (2026-02-27) | Remote MCP server with OAuth on every plan; registry listing docs; no directory listing or CLI | S | M |
| Capture by chat apps | Capacities | Capture through WhatsApp, Telegram and email | Email-in, share sheet, clipper, bookmarklet | M | L |
| Email-in commands | Evernote | Subject-line commands for notebook, tag and reminder, up to 200 a day | Mail becomes an Inbox note | S | L |

Notes: Folevi's developer surface (MCP read and write on Free, REST, webhooks) is better than most rivals'. What's missing is reach: store listings and directory listings, which are mostly paperwork. Apple Notes and Google Docs importers are the next switching levers after Notion and Evernote.

### 2.11 Offline, sync, performance and reliability

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Works offline from first launch | Obsidian, Craft, Capacities, Apple Notes, Bear | Native apps with local data | Mac and iOS need one online visit before offline works (service worker) | M | M |
| Offline AI | Craft, Apple Notes | On-device models | None | M | L |
| Performance in very large workspaces | Craft, Tana Outliner | Craft 3.7: docs open up to 2.3x faster, typing up to 5x faster (2026-10-11); Tana Outliner indexes up to 4M nodes offline (2026-10-12) | No published benchmark | M | M |
| Public status page | Most SaaS rivals (unverified for each) | Live status dashboards | The Status page says there is none yet | S | M |

Notes: Folevi is **ahead** on offline in the browser. Notion has no web offline and asks people to pick pages per device; Miro has none; Docs needs a Chrome or Edge extension. Rivals' weak spots are reliability (Obsidian forum data-loss threads, Apple Notes iCloud sync bug in 26.4, Logseq DB beta warns it can lose data), which Folevi's "Saved means saved" protocol answers. A published benchmark and a status page would turn this into a claim.

### 2.12 Mobile and iPad

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| In the App Store, with ratings | Everyone in the set | Notion 4.8 from 90K ratings; Evernote 4.4 from 78K; Goodnotes 463K ratings | Built; Simulator only, waiting for the Apple Developer Program | S | H |
| Android app | Obsidian, Craft, Capacities, Heptabase, Granola, Evernote, UpNote | Native Android apps | Browser PWA with share target (decision 2026-10-16) | L | M |
| Handwriting notes with recognition | Goodnotes, Apple Notes, OneNote | Handwriting search, Scribble to text in typed documents, Smart Script, Math Notes | Pencil on the whiteboard; Scribble in text fields | L | M |
| Siri that reads and searches | Craft | Siri searches, reads and creates documents and tasks (3.6.5, 2026-09-15); background Shortcuts (3.7) | Add task, New note, Open note, Show today's tasks | S | M |
| Live Activities | Obsidian | Quick Capture Live Activity (2026) | None | S | L |
| Apple Watch | Apple Notes, Bear, Granola | Dictation into notes on the Watch | None | M | L |
| Vision Pro | Notion, Craft, Bear | Listed apps | None (iPad apps can run there once in the store; unverified for Folevi) | S | L |
| Several windows on iPad | Craft (multiple windows on Mac and iPad, unverified for iPad) | Multiple scenes | One window (Capacitor has one scene) | M | L |
| Pencil pressure | Goodnotes, Apple Notes | Pressure and tilt | Fixed stroke width | S | L |

Notes: the iOS shell already has more system hooks than most rivals (interactive widgets, Control Center control, share extension, Spotlight, scanner, Face ID lock, push with Done and Snooze). None of it counts until it's in the store.

### 2.13 Mac native feel

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Downloadable, signed, updating | All rivals | Notarized apps with auto-update | Personal certificate, arm64 only, not notarized; update pipeline ready for R2 | S | H |
| Native app | Craft, Bear, Apple Notes | AppKit or Catalyst apps with the OS 27 Liquid Glass layout (Craft) | Electron shell of the web app | L | M |
| Quick Look, Open with, document icons | Obsidian | Quick Look of notes, "Open with", document icons (1.14, 2026-09-29) | Drag a note out as Markdown | S | L |
| Spotlight, Dock menu, Services | Craft | Spotlight, Dock menu, multiple windows and tabs (3.5 and 3.6) | Menu bar icon, Quick Add ⌥Space, New Window, deep links | S | M |
| Quick Entry on every device | Craft, Apple Notes | Craft Quick Entry on iPhone and iPad (⌥⌘Space); Apple Quick Note from any app | Quick Add on Mac; Control Center control on iOS | S | L |

### 2.14 Security and privacy

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| End-to-end encryption | Apple Notes, Obsidian, Anytype, Bear | Apple Advanced Data Protection; Obsidian Sync AES-256; Anytype Any-Sync; Bear per-note encryption with attachments | Encrypted in transit and at rest, not end to end | L | M |
| Locked notes | Bear, Apple Notes | Bear Pro encrypts chosen notes; Apple locked notes | Face ID app lock on iOS; no per-note lock | M | M |
| SSO, SCIM, audit log, data residency | Notion, Tana, Goodnotes, Whimsical, Miro, Coda | Notion SAML on Business, SCIM, audit log and residency on Enterprise; Tana Business SAML and audit logs; Goodnotes Teams SAML; Miro residency in 4 regions | Placeholders in `convex/lib/plans.ts` always false; admin audit log is internal only | M | M |
| Certifications | Notion, Craft, Tana, Mem | Notion SOC 2, ISO 27001, 27701, 27018; Craft SOC 2; Tana and Mem SOC 2 Type II | None | L | M |
| Zero data retention with AI providers | Notion | Enterprise ZDR and HIPAA-compliant AI | Not stated publicly | S | M |
| No account needed | Obsidian | The app works without an account | Account required | L | L |

Notes: Folevi's privacy story (no trackers, server-enforced AI switch, passkeys, breached-password check, approval for every AI change) is good for consumers. Team buyers will ask for SSO and a customer-facing audit log before any certification.

### 2.15 Pricing and plan value

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Some AI every month on Free | Craft, Tana, Mem, Miro, Whimsical | Small monthly allowances (15 credits, 50 queries, 25 messages, 10 credits) | AI only during the 7-day trial | S | M |
| Family plan | Craft, Microsoft 365 | Craft Family $15 a month for 2 to 6 people | Per person or per seat only | S | L |
| Lifetime or one-time option | UpNote, Goodnotes | UpNote $39.99 lifetime; Goodnotes 6 one-time $28.99 | Subscriptions only | S | L |
| Big storage in a bundle | Google, Microsoft, Apple | Google AI Plus $4.99 with 400 GB (third-party); M365 Personal 1 TB | 10 GB on Core and Pro, 50 GB on Pro AI | n/a | L |

Notes: on price Folevi is ahead almost everywhere (Part 4). The gap is how it feels on Free: rivals let people try AI forever in small amounts, which keeps them around until they need more.

### 2.16 Onboarding, templates and community

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Template marketplace | Notion, Obsidian | Notion's marketplace (not re-verified this session); Obsidian's 8,000+ community plugins and themes | 26 built-in templates, your own, and a template gallery on the site | M | M |
| Community | Obsidian, Craft, Miro, Bear | Official forums and communities | Support email; no forum | S | M |
| Localised templates | Craft | Rolling out with 3.7 (2026-10-11) | English only | S | L |
| Import microsites | Craft | Guides for each source app (from the 2026-10-14 report) | Import docs | S | M |

### 2.17 Accessibility and localisation

| Feature | Who does it better | How they do it | Folevi today | Effort | Impact |
|---|---|---|---|---|---|
| Interface languages | UpNote, Obsidian, Granola, Evernote, Notion, Craft | UpNote 52; Obsidian 42 with a full right-to-left flip (1.14); Granola 32 (2026-09-02); Evernote 26; Notion 22 including Arabic and Hebrew; Craft 13 | English only; catalog started | M | H |
| AI in many languages | Google, Tana, Gemini Notebook | Gemini in Docs 19 languages (2026-07-16); Tana transcription 33 languages; Notebook overviews in 80 | Gemini handles many languages, but the UI and prompts are English (unverified how well non-English notes work) | S | M |
| High contrast mode | Notion | Desktop and web (2026-07-30) | Light, dark, system; WCAG 2.2 AA tested | S | M |
| Published VPAT | Miro | VPAT dated March 2026 after a 188-issue audit | axe in CI; no VPAT | S | M |
| Braille mode | Google Docs | Braille mode with cursor routing | Screen-reader support tested with axe only | L | L |

---

## Part 3. Where Folevi is already ahead

- **Offline in the browser.** Every edit is queued on the device and "Saved" means the server has it. Notion has no web offline, Miro has none, Docs needs an extension, Obsidian has no web app.
- **AI at a fair price, and a real no-AI plan.** Foli AI starts at $4.99 (Pro). Notion's full AI needs Business at $20 a seat plus credits for agents; Tana Pro is $20 to $30; Mem Pro is $29 for 100 messages; Heptabase Premium is $17.99. Core at $1.99 is an honest plan for people who want no AI at all.
- **An agent people can trust.** Every change is previewed, approved and undoable in one click. Notion added line-by-line agent suggestions only on 2026-08-28.
- **MCP read and write on every plan, including Free.** Evernote's MCP (2026-08) reads, searches and creates; Reflect's was read-only until April; Miro caps MCP calls by plan.
- **Visuals and tables inside notes.** Mind maps, sticky boards with votes and a timer, live charts from tables and collections, wireframes, AI flowcharts and spreadsheet formulas in tables. No notes app in the set has all of these, and the canvas tools don't have notes this good.
- **Study tools.** Flashcards with spaced repetition, quizzes and frameworks. Only Heptabase (AI Tutor) and Gemini Notebook come close.
- **Small-team pricing.** Same price per seat as personal, free guests, no seat bundles. Craft caps Team at 10 people; Capacities and Mem have no team plans now; Heptabase has no free plan.
- **Design.** 57 note themes and themed public pages. Only Bear (28+ themes) and Craft compete on look.
- **Capture everywhere.** Email-in, share sheet, clipper, bookmarklet, Quick Add on Mac, iOS widgets and Siri actions, on every plan.
- **History you can read.** Versions coloured by author with word-level changes, named versions kept forever.
- **Stability while rivals churn.** In 2026 Mem changed pricing three times and retired Teams, Tana split into two products, Reflect forked, Coda became Superhuman Docs with higher prices, Notion shut down Mail, Evernote raised Advanced to $249.99 a year, Capacities dropped BYOK, and Bending Spoons is buying Miro. Steady pricing and a clear product are selling points; say so on the site.

---

## Part 4. Pricing comparison (checked 2026-10-20, USD)

Prices are per person per month unless stated. "Yearly" is the monthly equivalent when billed yearly, or the yearly total where noted. AI credits are not comparable across vendors: each defines a credit differently (Folevi: 1 credit = $0.01 of model cost).

| Product | Free | Paid tiers | AI included | Notes |
|---|---|---|---|---|
| **Folevi** | $0: 500 MB, 2 devices, AI only in the 7-day trial | Core $1.99 or $19 a year (10 GB, no AI); Pro $4.99 or $49 a year (10 GB); Pro AI $13.99 or $159 a year (50 GB) | Pro 180 credits a month, Pro AI 550; packs 500 for $7.99, 1,000 for $14.99 | Team plans same price per seat; guests free; 7-day Pro AI trial, no card |
| **Notion** | $0: 7-day history, 10 guests, AI trial | Plus $10 yearly (about $12 monthly, third-party); Business $20 (about $24); Enterprise custom | Free and Plus: trial only. Business: Agent, meeting notes, Enterprise Search. Custom Agents $10 per 1,000 credits extra | Custom domain $8 to $10 a month per domain; iOS in-app Plus $11.99 |
| **Craft** | $0: 1,500 blocks, 1 GB, 15 AI credits | Plus $8 monthly or about $6.40 yearly; Family $15 (2 to 6 people); Team $50 flat for up to 10 | Plus 50 credits and the Max model; on-device and BYOK AI free | App Store prices about 25% higher; frequent 40% codes |
| **Obsidian** | App free, also for work | Sync $4 yearly or $5 (1 GB), Sync Plus $8 or $10 (10 GB, up to 100 GB); Publish $8 or $10 per site; optional commercial licence $50 a year | No first-party AI | Catalyst $25 one-time |
| **Apple Notes** | Free | iCloud+ 50 GB $0.99, 200 GB $2.99, 2 TB $9.99 | Apple Intelligence free on supported hardware | Apple devices only |
| **Bear** | Free | Pro $2.99 or $29.99 a year | No AI | OCR search and encryption on Pro |
| **Evernote** | 50 notes, 1 notebook, 1 device | Starter $14.99 or $99 a year; Advanced $24.99 or $249.99 a year (third-party, quoting a customer notice); teams from €10 a seat | AI features by plan unverified | Pricing page shows no prices |
| **Capacities** | Basic: 5 GB, then 100 MB a month | Pro $9.99 yearly or $11.99 monthly; Believer from $12.49 or $14.99 | AI budget on Pro; AI add-on about $8.33 a month yearly | No team plans; BYOK removed 2026-08 |
| **Tana (new)** | 50 AI queries, 5 hosted meetings a month | Pro $20 early-bird or $30 per user; Business custom | Pro: 20x Free's AI, unlimited meetings; top-ups never expire | Tana Outliner: Plus $8, Pro $14 (500, 2,000, 5,000 credits) |
| **Mem** | 25 messages a month | Plus $9 (50); Pro $29 (100); Pro 2x $49; 5x $99; 10x $149; 20x $199 (2,000) | Metered by messages | Teams retired 2026-07 |
| **Heptabase** | None | Pro $8.99; Premium $17.99; Premium+ $53.99 (billed yearly; monthly about 25 to 33% more) | 100, 1,800, 8,100 credits | Falls back to basic models when out |
| **Reflect** | Reflect Open free on Mac (iPhone in TestFlight) | Classic $10 a month billed yearly | BYOK only on Open | Classic in maintenance |
| **Coda (Superhuman Docs)** | Free: 7-day history | Pro $12 yearly or $15 per Doc Maker; Business $33 or $40; Enterprise custom | Docs AI in beta on Pro | Editors and viewers free; prices rose 2026-07-08 |
| **Goodnotes** | 3 notebooks, 100 MB | Essential $11.99 a year (5 GB); Pro $35.99 a year; Teams $120 a seat a year | Full AI on Pro; AI Pass $9.99 a month extra | Goodnotes 6 one-time $28.99 |
| **UpNote** | 50 notes | Premium $1.99 a month or $39.99 lifetime | No AI | 52 languages |
| **Anytype** (third-party) | 100 MB remote | Plus $4 or $5 (1 GB); Pro $8 or $10 (10 GB); Ultra $16 or $20 (100 GB) | Experimental local agent, own key | |
| **Granola** | Basic $0, 30-day history | Business $14; Enterprise $35 per user | Model choice on Business | Meetings tool |
| **Gemini Notebook** | Free: 100 notebooks, 50 sources, 3 audio overviews a day (third-party) | With Google AI Pro $19.99: 300 sources, 20 overviews a day (third-party) | Gemini | |
| **Miro** | 3 boards, 10 AI credits | Starter $8; Business $20; Enterprise custom (yearly) | 25 and 50 credits a month; Enterprise 2,500 pooled | MCP calls capped by plan |
| **Whimsical** | 10 AI credits, 1 GB | Pro $10; Business $20 per editor (yearly) | Extra credits sold | |
| **Milanote** | 100 items | $9.99 yearly or $12.50 monthly; Team $49 a month | None found | |
| **Google** | Docs and Keep free | Workspace Starter $7, Standard $14, Plus $22; Google AI Plus $4.99 (400 GB, third-party), AI Pro $19.99 (5 TB), Ultra $100 and $200 | Gemini in Docs from Workspace Standard or AI Pro | |
| **Microsoft 365** | OneNote free | Personal $9.99 or $99.99 a year; Family $12.99 or $129.99; Premium $19.99 or $199.99; Business Standard $14 from 2026-07-01 | Personal about 60 Copilot credits a month (third-party); Copilot Chat in Business plans; full Copilot about $30 add-on (third-party) | |

**What the table says**

- **Cheapest AI notes plan in the set.** Folevi Pro ($4.99 with AI) undercuts Craft Plus ($8), Miro Starter ($8), Capacities Pro ($9.99), Notion Business ($20 for full AI) and Tana Pro ($20 to $30). Only Google AI Plus matches it on price, and that plan doesn't include full Gemini in Docs.
- **Folevi's Pro allowance looks small next to rivals' numbers** (180 credits against Tana Outliner Free's 500 or Heptabase Premium's 1,800), even though the units differ. Show what 180 credits buys in plain terms ("about N chat answers or M minutes of transcription") so it doesn't read as stingy.
- **Free is the weak spot.** Rivals give a small amount of AI every month; Folevi gives none after 7 days. A small Free allowance (say 20 credits) costs at most $0.20 a person a month.
- **Teams.** Folevi at $4.99 to $13.99 a seat is well under Notion Business ($20), Tana ($20 to $30), Miro Business ($20) and Coda Business ($33 per Doc Maker).
- **Custom domains are a paid extra everywhere** ($8 to $10 a month): a natural add-on for Folevi once sites exist.

---

## Part 5. Prioritised roadmap

Ordered by impact over effort. Items marked **owner** need the owner (accounts, money, store paperwork), not code.

### Quick wins (days)

1. **Get the apps into people's hands (owner).** Join the Apple Developer Program, set the team, ship TestFlight, then the App Store (`docs/IOS.md` "After joining the Apple Developer Program"). Get a Developer ID, notarize and make a universal Mac build with updates from R2 (`docs/DESKTOP.md`). Submit the clipper to the Chrome Web Store and Edge Add-ons.
2. **Fix what the site says.** Update `compare.tsx` (apps, import list, collaboration line), `AVAILABILITY` in `convex/lib/plans.ts` and `docs/PRODUCT.md`. Add a "Folevi vs" line on steady pricing and offline in the browser.
3. **List the MCP server** in the Claude and ChatGPT connector directories, and the API on Zapier as a private app first.
4. **A small Free AI allowance** (about 20 credits a month) instead of trial-only, and a fall-back to the fast model when credits run out (Heptabase's pattern), not a hard stop.
5. **Assign a comment to someone** (it becomes their task), reusing tasks and mentions.
6. **Slack notifications** for mentions and comments through the existing webhooks, with a simple Slack app.
7. **List view for collections** and **saved searches** (smart folders in the sidebar).
8. **DOCX export**, reusing the Word reader's mapping in reverse.
9. **A high contrast setting** and a short accessibility statement (VPAT-style) from the axe results already in CI.
10. **Siri reads and searches notes**: an App Intent that returns a note's text, plus a Live Activity for a running recording.

### Next (weeks)

1. **Columns block**, then **presentation mode** (headings or dividers become slides, full screen, works on iPad), then **synced blocks**.
2. **Collection formulas and rollups** on top of `tableFormulas.ts`, then **timeline view**, **forms** and simple **automations** (when a property changes, set another, notify, create a task).
3. **Two-way Google and Outlook calendar** (OAuth): events in Calendar and Week view, create and move events, then "meeting note from event" with a Foli AI brief before the meeting and the recorder linked to the event. Add speaker names to transcripts.
4. **Model choice and BYOK.** Add Anthropic and OpenAI adapters behind `convex/lib/ai/provider.ts`, a picker on Pro AI with cost per answer shown, then bring-your-own-key on any plan.
5. **Text inside attachments.** Extract text from uploaded PDFs and images into search (Gemini vision, platform-paid and rate-limited on paid plans), use the iOS Vision recogniser for scans, and add an inline PDF viewer with highlights that become quotes in the note.
6. **Sites.** Publish a page with its subpages as a site with navigation and a theme; custom domains as a paid add-on.
7. **Custom Foli AI agents**: let people write their own routine in plain words (what to read, when to run, where to deliver), on the same credit caps as today's routines; add named, reusable skills.
8. **Languages**: finish the string catalog, launch Spanish, German, French, Portuguese (Brazil) and Japanese, with right-to-left groundwork.
9. **Importers for Apple Notes, Google Docs and Obsidian vaults** (wikilinks, front matter), then Readwise.
10. **Safari and Firefox clipper** (Safari web extension in the Mac app once notarized).

### Bigger bets (months)

1. **Character-level co-editing.** Move block text to a CRDT (for example Yjs over the existing sync), keep the durable offline queue, then add **suggesting mode** for people on the same accept and reject UI as Foli AI's previews.
2. **Team tier for buyers**: SAML SSO, SCIM, a customer-facing audit log, private team areas, then SOC 2.
3. **Meeting capture to the frontier**: automatic call detection on Mac, live notes during the call, voice questions to Foli AI, and briefs before meetings with the same people.
4. **Locked notes with end-to-end encryption** for chosen pages (no Foli AI or server search on them), as Bear and Apple Notes do, instead of whole-account E2EE.
5. **On-device AI** in the Apple apps (Apple Foundation Models through the shell's bridge) for free, offline writing help.
6. **Handwriting on iPad**: a handwriting block with pressure, recognition and search.
7. **Board pages**: a page type that holds several visual blocks on one canvas, with presentation and follow mode.
8. **Revisit Android** with usage data from the PWA; Obsidian, Craft, Capacities, Heptabase and Granola all ship native Android apps.

---

## Part 6. Sources

All fetched or searched on 2026-10-20 unless a date is given. (third-party) marks a non-vendor source.

**Notion**
- https://www.notion.com/releases (2026 release list)
- https://www.notion.com/releases/2021-06-29 (synced blocks)
- https://www.notion.com/releases/2026-03-26 (sidebar redesign)
- https://www.notion.com/releases/2026-03-30 (tabs block)
- https://www.notion.com/releases/2026-07-01 (3.6)
- https://www.notion.com/releases/2026-09-15 (3.7)
- https://www.notion.com/releases/2026-10-13 (3.8)
- https://notion.com/releases/2025-08-19 (offline, 2025)
- https://www.notion.com/help/presentation-mode
- https://www.notion.com/help/dashboards
- https://www.notion.com/help/charts
- https://www.notion.com/help/views-filters-and-sorts
- https://www.notion.com/help/ai-meeting-notes
- https://www.notion.com/help/notion-ai-faqs
- https://www.notion.com/help/custom-agent-pricing
- https://www.notion.com/help/change-your-language
- https://www.notion.com/product/ai
- https://www.notion.com/product/calendar
- https://www.notion.com/pricing
- https://www.notion.com/security
- https://developers.notion.com/guides/data-apis/working-with-views
- https://apps.apple.com/us/app/notion-notes-tasks-ai/id1232780281
- https://releases.sh/notion/notion-releases/highlights (third-party)
- https://alternativeto.net/news/2026/7/notion-calendar-integrates-ai-meeting-notes-with-outlook/ (third-party)
- https://alternativeto.net/news/2026/6/notion-calendar-introduces-outlook-integration-for-unified-event-management/ (third-party)
- https://www.gigazine.net/gsc_news/en/20260626-notion-mail-is-going-away (third-party)
- https://www.waimakers.com/en/resources/ai-data-security/notion-ai (third-party, 2026-06)
- https://automationatlas.io/answers/notion-pricing-explained-2026/ (third-party)
- https://findskill.ai/de/blog/notion-custom-agents-paid-switch-pm-audit-mai-2026/ (third-party)
- https://matthiasfrank.de/en/notion-agent-pricing/ (third-party)
- https://capterra.com/p/186596/Notion/ (third-party)
- https://saascrmreview.com/notion-review/ (third-party)
- https://2sync.com/pt/blog/como-usar-notion-offline (third-party)
- https://falconer.com/guides/why-is-notion-slow/ (third-party, vendor)
- https://clickup.com/learn/?p=71011 (third-party, vendor)

**Coda (Superhuman Docs)**
- https://blog.superhuman.com/introducing-superhuman-docs/ (2026-07-08)
- https://connect.superhuman.com/t/launched-publish-your-docs-as-websites-with-custom-domains/38189
- https://connect.superhuman.com/t/superhuman-docs-rebrand-question/60947?page=3
- https://connect.superhuman.com/t/2-18-2026-roundtable-summary-building-made-easy-with-docs-ai/59850
- https://zapier.com/apps/coda/integrations/coda
- https://coworker.ai/blog/coda-pricing (third-party)
- https://pricingsaas.com/companies/coda/diffs/2026W29 (third-party)
- https://www.breeze.pm/articles/coda-is-now-superhuman-docs (third-party)
- https://releasebot.io/updates/coda/coda (third-party)
- https://ai-cmo.net/tools/coda (third-party)
- https://appshunter.io/ios/app/superhuman-docs/id1397968110 (third-party)

**Craft**
- https://www.craft.do/blog/craft-update-3-7-0 (2026-10-11)
- https://www.craft.do/blog/craft-update-3-6-5 (2026-09-15)
- https://www.craft.do/blog/craft-update-3-6-0 (2026-09-01)
- https://www.craft.do/blog/craft-update-3-5-4 (2026-08-10)
- https://www.craft.do/blog/craft-update-3-5-0 (2026-07-07)
- https://www.craft.do/blog/craft-update-3-4-4 (2026-06-05)
- https://www.craft.do/blog/craft-update-3-4 (2026-04-13)
- https://www.craft.do/blog/craft-update-3-3-10 (2026-03-09)
- https://www.craft.do/blog/craft-update-3-3-9 (2026-02-17)
- https://www.craft.do/blog/introducing-craft-agents (2026-02)
- https://www.craft.do/blog/in-house-sync-protocol (2024)
- https://www.craft.do/pricing
- https://support.craft.do/en/write-and-edit/whiteboards
- https://support.craft.do/en/share-and-publish/publish/domains
- https://support.craft.do/hc/en-us/articles/release-notes
- https://support.craft.do/hc/en-us/articles/19135342358812
- https://apps.apple.com/us/app/craft-notes-documents-ai/id1487937127
- https://websites2know.com/craft-do-review (third-party, 2026)
- https://thesunrisedigest.com/focus/craft-review-2026 (third-party, 2025-12-03)

**Apple Notes and Freeform**
- https://9to5mac.com/2026/09/28/heres-everything-new-for-apple-notes-in-ios-27 (third-party)
- https://9to5mac.com/2025/10/16/heres-everything-new-for-apple-notes-in-ios-26 (third-party, 2025)
- https://www.cultofmac.com/how-to/ios-27-notes-features (third-party, 2026-07-01)
- https://apple.gadgethacks.com/news/ios-27-notes-app-features (third-party)
- https://www.apple.com/newsroom/2026/06/ (Siri AI and Apple Intelligence announcements, WWDC 2026)
- https://www.apple.com/newsroom/2024/09/ipados-18-is-now-available (2024)
- https://support.apple.com/guide/ipad/enter-formulas-and-equations-ipad10f28bec/ipados
- https://support.apple.com/guide/iphone/record-and-transcribe-audio-iphbe11247b5/ios
- https://support.apple.com/guide/iphone/search-notes-iphb8628c6b8/ios
- https://support.apple.com/en-us/102288
- https://support.apple.com/guide/notes/collaborate-with-shared-notes-and-folders-apd4e6e2c9a6/mac
- https://support.apple.com/guide/ipad/use-quick-notes-ipad5d91fd88/ipados
- https://support.apple.com/en-us/102651
- https://support.apple.com/en-us/108047
- https://support.apple.com/guide/freeform/welcome/mac
- https://9to5mac.com/2025/11/04/ios-26-2-gives-freeform-app-brand-new-tables-feature/ (third-party, 2025-11)
- https://consomac.fr/news-23133-la-version-creator-studio-de-freeform-debarque-sur-ios-26.4.html (third-party, 2026-02-17)
- https://preslav.me/2026/08/12/bear-notes (third-party, also on Apple Notes)

**Bear**
- https://apps.apple.com/us/app/bear-markdown-notes/id1016366447
- https://bear.app/faq/features-and-price-of-bear-pro
- https://blog.bear.app/2026/04/bear-2-8-bearcli-claude-connector-and-mcp-server
- https://blog.bear.app (2026-06-18 Lettera, 2026-07-16 2.9, 2026-07-28 Mermaid)
- https://blog.bear.app/2025/07/bear-web-public-beta-you-are-invited (2025)
- https://community.bear.app (2026-10-16 typewriter mode beta)

**UpNote and Goodnotes**
- https://getupnote.com
- https://help.getupnote.com/resources/frequently-asked-questions
- https://talk.macpowerusers.com (UpNote PDF complaints)
- https://apps.apple.com/us/app/goodnotes-ai-notes-docs-pdf/id1444383602
- https://www.goodnotes.com/blog/whats-new-in-goodnotes-july-september-2026
- https://www.goodnotes.com/blog/the-new-goodnotes (2025-09)
- https://www.goodnotes.com/pricing
- https://www.imore.com (Pencil Pro support, 2024, third-party)

**Obsidian**
- https://obsidian.md/changelog/ (1.14, 2026-09 to 10)
- https://obsidian.md/changelog/page/3/ (CLI, headless Sync, 2026-02)
- https://obsidian.md/help/bases
- https://obsidian.md/roadmap/
- https://obsidian.md/blog/2026-obsidian-october/
- https://obsidian.md/sync
- https://obsidian.md/publish
- https://obsidian.md/clipper
- https://obsidian.md/pricing
- https://forum.obsidian.md/tag/data-loss/89
- https://forum.obsidian.md/t/obsidian-native-sync-is-slow-on-iphone-and-ipad/76382/2 (older)
- https://apps.apple.com/us/app/obsidian-connected-notes/id1557175442

**Evernote**
- https://evernote.com/release-notes/11.38.5
- https://evernote.com/release-notes/11.37.5
- https://evernote.com/compare-plans
- https://evernote.com/enterprise-plans
- https://help.evernote.com/hc/en-us/articles/45695698380563
- https://help.evernote.com/hc/articles/222177927
- https://help.evernote.com/hc/articles/209005347
- https://apps.apple.com/us/app/evernote-notes-organizer/id281796108
- https://tidbits.com/watchlist/evernote-11-30-6/ (third-party, 2026-08-24)
- https://talk.tidbits.com/t/evernote-2026-price-tiers-floored-me/33792 (third-party, 2026-07 to 10)
- https://au.trustpilot.com/review/www.evernote.com (third-party, 2026)
- https://alternativeto.net/news/2025/10/evernote-v11-debuts-ai-assistant-semantic-search-and-smarter-meeting-notes (third-party)
- https://clickup.com/learn/topic/productivity/tools/evernote/ (third-party, competitor, 2026-06)
- https://getcoai.com/?p=87162 (third-party)
- https://www.eesel.ai/blog/evernote-pricing (third-party)
- https://www.apkmirror.com/apk/evernote-corporation/evernote/evernote-10-81-0-release/ (third-party, about 2024)

**Capacities**
- https://capacities.io/product
- https://capacities.io/pricing
- https://capacities.io/whats-new/release-66 (2026-06-24)
- https://capacities.io/whats-new/release-67 (2026-07-08)
- https://capacities.io/whats-new/release-68 (2026-08-06)
- https://capacities.io/whats-new/release-69 (2026-08-17)
- https://capacities.io/whats-new/release-70 (2026-09-01)
- https://capacities.io/whats-new/release-71 (2026-09-18)
- https://capacities.io/whats-new/release-72 (2026-10)
- https://www.capacities.io/blog/why-we-are-introducing-pro-plus
- https://docs.capacities.io/reference/calendar-integrations
- https://docs.capacities.io/misc/offline-support
- https://apps.apple.com/us/app/capacities-notes-pkm/id1670188548

**Anytype and Logseq**
- https://blog.anytype.io/february-community-update-2026/
- https://community.anytype.io/t/api-developer-portal-mcp/27945
- https://korben.info/en/anytype-notion-alternative-private-local-first.html (third-party)
- https://checkthat.ai/brands/anytype/pricing (third-party)
- https://kompozy.io/news/logseq-2-0-db-version-beta (third-party, 2026-07)
- https://discuss.logseq.com/t/whats-new-with-logseq-db-april-26-2026/34977
- https://zeli.app/en/story/48896229 (third-party)

**Tana, Reflect, Mem, Heptabase**
- https://tana.inc/
- https://tana.inc/pricing
- https://tana.inc/changelog
- https://tana.inc/blog/tana-auto-detects-external-meetings (about 2026-08-25)
- https://outliner.tana.inc/blog/tana-current-march-2026
- https://outliner.tana.inc/changelog
- https://outliner.tana.inc/changelog/2026-w21-22
- https://outliner.tana.inc/learn/features/payment-billing-and-ai-credits
- https://outliner.tana.inc/pricing
- https://costbench.com/software/note-taking/tana (third-party)
- https://talk.macpowerusers.com/t/replacement-for-tana/44724 (third-party, 2026-03)
- https://outlinersoftware.com/topics/viewt/12697 (third-party)
- https://reflect.app/
- https://reflect.app/blog/reflect-open (2026-07-14)
- https://reflect.app/blog/mcp-support-for-coding-agents
- https://costbench.com/software/note-taking/reflect/ (third-party)
- https://outlinersoftware.com/topics/viewt/12690 (third-party, 2026-07-15)
- https://get.mem.ai/
- https://get.mem.ai/pricing
- https://get.mem.ai/blog/product-update-roundup-calendar-integration-claude-connector-referral-program-plus-experimental-features-for-pro-users (2026-03-23)
- https://usagepricing.com/blueprint/activity/mem-2026-07-14-launch (third-party)
- https://usagepricing.com/blueprint/activity/mem-2026-08-25-packaging (third-party)
- https://costbench.com/changelog/mem-plans-renamed-2026-02/ (third-party)
- https://heptabase.com/
- https://heptabase.com/pricing
- https://wiki.heptabase.com/changelog
- https://usagepricing.com/blueprint/heptabase (third-party)
- https://usagepricing.com/blueprint/activity/heptabase-2026-08-28-packaging (third-party)

**Other AI entrants**
- https://www.granola.ai/updates
- https://www.granola.ai/pricing
- https://www.reworked.co/digital-workplace/granola-raises-125m-launches-enterprise-context-tools/ (third-party, 2026-03)
- https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/ (2026-07-16)
- https://www.pcworld.com/article/3111791/gemini-adds-claude-style-notebooks-for-context-and-organization.html (third-party)
- https://freeacademy.ai/blog/notebooklm-free-vs-plus-2026 (third-party)
- https://kingy.ai/news/ai-launch-tracker-openais-new-chatgpt-memory-system-leads-june-8-2026/ (third-party)
- https://geekflare.com/news/chatgpt-can-now-listen-and-summarize-your-meetings (third-party)
- https://pasqualepillitteri.it/en/news/8685/claude-managed-projects-anthropic-autonomous (third-party, unverified)
- https://m365admin.handsontek.net/notebooks-microsoft-365-copilot-organize-work-across-conversations/ (third-party)
- https://affine.pro/blog/tag/ai
- https://www.eesel.ai/blog/saner-ai-pricing (third-party)

**Miro, Whimsical, Milanote**
- https://miro.com/blog/canvas-26-product-highlights/ (2026-05-19)
- https://miro.com/blog/whats-new-april-2026/
- https://community.miro.com/product-news-31/what-s-new-what-we-launched-in-february-2026-27745
- https://miro.com/ai/diagram-ai/
- https://miro.com/pricing/
- https://miro.com/ru/accessibility/changelog/ (2026-03)
- https://help.miro.com/hc/articles/19506114302354-Overview-of-Miro-Accessibility
- https://help.miro.com/hc/articles/4957762934802
- https://community.miro.com/ideas/offline-mode-925
- https://community.miro.com/ask-the-community-45/ipad-presentation-mode-7665
- https://www.reworked.co/collaboration-productivity/bending-spoons-acquires-miro-for-136b/ (third-party, 2026-09)
- https://thenextweb.com/news/bending-spoons-miro-acquisition-1-355bn (third-party)
- https://whimsical.com/releases
- https://whimsical.com/releases/2026-13-paste-from-anywhere
- https://whimsical.com/pricing
- https://whimsical.com/blog/product (2025-11-20)
- https://milanote.com/
- https://milanote.com/plans
- https://help.milanote.com/en/articles/5537688-drawing

**Microsoft and Google**
- https://mc.merill.net/message/RM393539 (2025-10)
- https://mc.merill.net/message/MC1267976 (2026-04-02)
- https://mc.merill.net/message/MC1409042 (2026-06-29)
- https://mc.merill.net/message/MC1307979
- https://blog-en.topedia.com/?p=61504 (third-party)
- https://www.anoopcnair.com/copilot-in-onenote-supports-inked-notes-written/ (third-party, 2024)
- https://www.hubsite365.com/de-ww/crm-pages/7-new-features-in-microsoft-onenote-for-2026.htm (third-party, 2026-01)
- https://www.hubsite365.com/en-ww/crm-pages/is-microsoft-loop-worth-using-in-teams-yet.htm (third-party)
- https://itprotoday.com/ios/onenote-update-brings-support-handwriting-recognition-and-ocr-ipad (third-party, old)
- https://heise.de/-11103991 (third-party)
- https://supersimple365.com/category/loop/ (third-party, 2022 to 2024)
- https://www.microsoft.com/en-us/microsoft-365/buy/compare-all-microsoft-365-products
- https://www.digitalcitizen.life/microsoft-365-personal-and-family-plans-see-a-price-increase-with-copilot-ai/ (third-party)
- https://support.google.com/docs/answer/6033474
- https://support.google.com/docs/answer/6388102
- https://support.google.com/docs/answer/6282736
- https://workspace.google.com/products/docs/
- https://workspace.google.com/pricing
- https://workspaceupdates.googleblog.com/search/label/Google%20Docs
- https://workspaceupdates.googleblog.com/2026/04/new-gemini-capabilities-in-google-docs-help-you-go-from-blank-page-to-brilliance.html
- https://workspaceupdates.googleblog.com/2026/07/expanded-language-support-for-gemini-in-Google-Docs.html
- https://workspaceupdates.googleblog.com/2026/07/streamline-collaboration-in-google-docs-with-Gemini-powered-comment-workflows.html
- https://workspaceupdates.googleblog.com/2026/09/create-content-schedule-events-and-coordinate-tasks-across-Workspace-regardless-of-what-app-you-are-in.html
- https://workspaceupdates.googleblog.com/2026/10/weekly-recap-10-02-2026.html
- https://workspaceupdates.googleblog.com/2026/10/preview-edit-and-collaborate-on-Markdown-files-natively-across-Drive-and-Docs.html
- https://arynews.tv/google-adds-gemini-voice-tools-to-gmail-docs-and-keep (third-party)
- https://www.tuttoandroid.net/news/2026/06/30/google-keep-live-gemini-integrazione-in-sviluppo-1160550/ (third-party)
- https://www.androidauthority.com/google-keep-handwriting-3498599/ (third-party, 2024)
- https://one.google.com/about/google-ai-plans/
- https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/ (2026-05-19)
- https://braindetox.kr/en/posts/google_ai_plus_price_cut_2026.html (third-party)

**General roundups (directional only, several are vendor blogs)**
- https://fireflies.ai/blog/note-taking-apps-for-ipad/
- https://tech-insider.org/ca/best-note-taking-apps/
- https://getrocketbook.com/blogs/news/5-of-the-best-note-taking-apps-in-2026

**Folevi (this repository)**
- `docs/PRODUCT.md`, `docs/VISUAL_BLOCKS_PLAN.md`, `docs/AI_ASSISTANT.md`, `docs/IOS.md`, `docs/DESKTOP.md`, `docs/BILLING.md`, `docs/LOCALIZATION.md`, `docs/research/2026-10-14-competitive-analysis.md`
- `convex/lib/validators.ts` (collection property and view types), `convex/lib/plans.ts` (prices, entitlements, `AVAILABILITY`), `convex/presence.ts` and `apps/web/src/components/doc/LiveCarets.tsx` (live carets), `apps/web/src/lib/sync/engine.ts` (block save delay), `packages/editor-schema/src/html.ts` (block types), `apps/web/src/components/marketing/content/compare.tsx` (site comparison copy), `apps/ios/ios/App/Native/DocumentScanner.swift` (scanner text recognition)
- `git log` 2026-10-14 to 2026-10-20
