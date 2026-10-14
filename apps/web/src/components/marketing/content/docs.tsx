import Link from "next/link";
import type { ReactNode } from "react";
import { CREDIT_PACKS, MONTHLY_CREDITS, PACK_VALID_MONTHS, STORAGE_BYTES, TIER_NAMES, TRIAL_CREDITS, TRIAL_DAYS, formatPrice, sizeLabel } from "@/lib/plans";
import { ShortcutTable } from "../mac/ShortcutTable";
import { SECURITY_EMAIL, SIGN_UP_URL, SUPPORT_EMAIL } from "../site";

/*
 * The documentation, one article per page (/docs/<slug>). The index (/docs) keeps the old in-page anchors
 * (`legacyAnchor`, e.g. /docs#sync) and forwards them to the article. `updated` is the day the article's
 * content last changed (YYYY-MM-DD): the sitemap and the article's structured data use it, so change it with
 * the text.
 */

export type DocArticle = {
  slug: string;
  /** The article's H1 and <title>. */
  title: string;
  /** Short label for the docs navigation. */
  nav: string;
  description: string;
  /** The anchor this section had on the single /docs page, if it had one. */
  legacyAnchor?: string;
  published: string;
  updated: string;
  body: () => ReactNode;
};

const blocks: Array<[string, string]> = [
  ["Text", "A plain paragraph. Where most writing happens."],
  ["Heading 1, 2, 3", "Section titles. They also build the page outline in the inspector."],
  ["Bulleted and numbered list", "Lists that can be nested to any sensible depth."],
  ["Checklist", "A task with a checkbox. Can have a due date, time and priority."],
  ["Toggle", "A line that folds its nested blocks away."],
  ["Quote", "Set a passage apart."],
  ["Callout", "A tinted note with an icon: note, info, success, warning or danger."],
  ["Divider", "A quiet horizontal rule."],
  ["Code", "Monospaced code with a language label."],
  ["Table", "Rows and columns, with an optional header row."],
  ["Image and file", "Upload from your device or drag in from Finder."],
  ["Audio recording", "Record from your microphone, up to an hour, and play it back in the note. Saved on your device first, then uploaded."],
  ["Bookmark", "A link preview card for a web page."],
  ["Embed", "A YouTube, Vimeo or Loom video, a Figma file or a Google Map, playable in the note and on shared pages."],
  ["Page", "A sub-page, shown as a link or as a card."],
  ["Flowchart", "Shapes and connectors on a canvas, with Tidy up and AI. See Flowcharts and diagrams."],
  ["Mermaid diagram", "A code block in Mermaid syntax, drawn as a diagram. Flowchart diagrams can be converted to a flowchart block."],
  ["Whiteboard", "A canvas for sketches with a pen, a highlighter and an eraser."],
  ["TeX formula", "A maths formula written in TeX."],
  ["Collection, Gallery, Kanban", "A set of pages with properties, shown as a table, as cards or as a board."],
];

const statuses: Array<[string, ReactNode]> = [
  ["Saved", "Everything has reached our servers and been confirmed. Folevi never shows Saved before that."],
  ["Saving", "You’re online and recent edits are on their way."],
  ["Offline", "No connection. Edits are stored on this device, with a count of how many are waiting."],
  ["Syncing", "You’ve reconnected; Folevi is fetching changes from other devices and sending yours."],
  ["Conflict", "The same block was changed in two places. Folevi keeps both versions, throws nothing away and shows you the conflict so you can decide."],
  ["Not saved", "A change couldn’t be applied, or syncing failed repeatedly. Open the status for details and a retry button."],
];

function Table({ label, head, rows }: { label: string; head: [string, string]; rows: Array<[string, ReactNode]> }) {
  return (
    <div className="mk-table-card overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th scope="col">{head[0]}</th>
            <th scope="col">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, body]) => (
            <tr key={name}>
              <th scope="row" className="font-medium text-ink sm:whitespace-nowrap">
                {name}
              </th>
              <td>{body}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const DOC_ARTICLES: DocArticle[] = [
  {
    slug: "getting-started",
    title: "Getting started with Folevi",
    nav: "Getting started",
    description: "Create a Folevi account, write your first page, turn lines into blocks with the slash menu, link pages with [[ and find anything with ⌘K.",
    legacyAnchor: "getting-started",
    published: "2026-09-25",
    updated: "2026-10-01",
    body: () => (
      <>
        <ol>
          <li>
            <a href={SIGN_UP_URL}>Create an account</a> and confirm your email address.
          </li>
          <li>
            Your Personal space opens. It’s just yours. Create a page with the New page button and start typing. To work with a team, create a workspace from the menu at the bottom of the sidebar and switch between Personal and your workspaces there.
          </li>
          <li>
            Type <code>/</code> on any line to turn it into a heading, checklist, quote or any other block, or <code>/record</code> to record a voice note.
          </li>
          <li>
            Link pages together with <code>[[</code>, and find anything later with <Link href="/features/search">search</Link> (<code>⌘K</code>).
          </li>
        </ol>
        <p>
          Loose notes can live in <strong>Drafts</strong> until you decide where they belong. Pages can be nested inside other pages, filed in folders, tagged and starred.
        </p>
        <h2 id="next">Where to go next</h2>
        <ul>
          <li>
            <Link href="/docs/blocks-and-slash-commands">Blocks and slash commands</Link> lists every kind of block.
          </li>
          <li>
            <Link href="/docs/tasks-and-calendar">Tasks and calendar</Link> explains how to-dos become tasks.
          </li>
          <li>
            <Link href="/template-gallery">The template gallery</Link> has 26 pages you can start from.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: "keyboard-shortcuts",
    title: "Keyboard shortcuts",
    nav: "Keyboard shortcuts",
    description: "Folevi keyboard shortcuts for new documents and windows, search, the sidebar and inspector, headings, checklists, moving blocks and text formatting.",
    legacyAnchor: "shortcuts",
    published: "2026-09-25",
    updated: "2026-10-09",
    body: () => (
      <>
        <p>
          These shortcuts work in Folevi for Mac (coming soon). On the web, most work the same way; shortcuts your browser reserves for itself (such as <code>⌘N</code> for a new browser window) are left to the browser, so use <code>⌥⌘N</code> for a new note there. Quick Add from any app (<code>⌥Space</code>) is only in the Mac app.
        </p>
        <div className="mk-card p-5 sm:p-6">
          <ShortcutTable caption="Folevi keyboard shortcuts" />
        </div>
      </>
    ),
  },
  {
    slug: "blocks-and-slash-commands",
    title: "Blocks and slash commands",
    nav: "Blocks and slash commands",
    description: "Every paragraph in Folevi is a block. Use the / menu for headings, checklists, tables, flowcharts and audio, move blocks from the keyboard and style a page.",
    legacyAnchor: "blocks",
    published: "2026-09-25",
    updated: "2026-10-01",
    body: () => (
      <>
        <p>
          Every paragraph in Folevi is a block. Type <code>/</code> at the start of a line to open the block menu, keep typing to filter it (for example <code>/check</code>, or <code>/record</code> for a voice note), then press Return. Use the handle beside a block to drag it, or <code>⌥⇧↑</code> and <code>⌥⇧↓</code> to move it. Nested blocks move with their parent.
        </p>
        <Table label="Block types table" head={["Block", "What it’s for"]} rows={blocks} />
        <p>Inside a block you can use bold, italic, underline, strikethrough, inline code, links, text colours and highlights, and insert dates, mentions and links to other pages. See <Link href="/features/blocks">Blocks and the / menu</Link> for a tour.</p>
        <h2 id="page-style">Page style</h2>
        <p>
          Each page has a note theme: one of 57 artworks, Plain, or your own image. The theme colours the cover, the paper and the text. In the Style panel you can also blur the theme image behind the page, pick the document and text colours, the separator style, the font (Modern, Serif, Mono or Soft) and the page width (Narrow or Wide). See <Link href="/features/note-themes">Note themes</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "tasks-and-calendar",
    title: "Tasks and calendar",
    nav: "Tasks and calendar",
    description: "Any checklist item in Folevi is a task. Give it a date, time and priority, find it in Today, Tasks and the Calendar, and add tasks with Quick Add.",
    legacyAnchor: "tasks",
    published: "2026-09-25",
    updated: "2026-09-30",
    body: () => (
      <>
        <p>
          Any checklist item is a task. Give it a due date (and optionally a time and a priority) and it appears in <strong>Today</strong> on that day, and in <strong>Tasks</strong> alongside every other open task in your Personal (or the workspace you’re in). Overdue tasks show up there too, so nothing slips quietly past.
        </p>
        <p>
          The <Link href="/features/calendar">Calendar</Link> shows dated tasks by day. <strong>Quick Add</strong> (⇧⌘A) saves a task straight into your <strong>Inbox</strong> page, so it always lives somewhere you can find it.
        </p>
        <h2 id="views">Task views</h2>
        <ul>
          <li>
            <strong>Inbox</strong>: tasks without a due date.
          </li>
          <li>
            <strong>Today</strong>: tasks due today, and overdue ones.
          </li>
          <li>
            <strong>Upcoming</strong>: tasks with a date after today.
          </li>
          <li>
            <strong>All</strong>: every open task.
          </li>
          <li>
            <strong>Completed</strong>: done and canceled tasks.
          </li>
          <li>
            <strong>My Tasks</strong>: tasks assigned to you in a workspace.
          </li>
        </ul>
        <p>A task can also have an assignee (in a workspace) and a reminder. At the reminder time, Folevi adds a notification.</p>
      </>
    ),
  },
  {
    slug: "sync-and-offline",
    title: "Sync and offline",
    nav: "Sync and offline",
    description: "How offline editing works in Folevi, what the Saved, Saving, Offline, Syncing, Conflict and Not saved statuses mean, and how version snapshots work.",
    legacyAnchor: "sync",
    published: "2026-09-25",
    updated: "2026-09-30",
    body: () => (
      <>
        <p>
          Folevi saves every change on your device first, then syncs it. On the web, your notes are kept in the browser’s storage; Folevi for Mac keeps them the same way, on your Mac. You can keep writing with no connection at all.
        </p>
        <h2 id="statuses">Sync statuses</h2>
        <p>Each page shows one of these statuses:</p>
        <Table label="Sync statuses table" head={["Status", "What it means"]} rows={statuses} />
        <p>
          When a page shows a conflict, choose <strong>Keep mine</strong>, <strong>Keep theirs</strong> or <strong>Keep both</strong>.
        </p>
        <h2 id="versions">Version snapshots</h2>
        <p>
          Version snapshots are taken automatically as you work, so you can go back to an earlier state of a page. See <Link href="/features/version-history">Version history</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "sharing-and-permissions",
    title: "Sharing and permissions",
    nav: "Sharing and permissions",
    description: "Who can open a Folevi page, how to restrict one, share it by email to view, comment or edit, and make a public link with an expiry and password.",
    legacyAnchor: "sharing",
    published: "2026-09-25",
    updated: "2026-09-30",
    body: () => (
      <>
        <p>Pages in your Personal are private to you, and pages in a workspace are open to its members, by default. From a page’s Share menu you can:</p>
        <ul>
          <li>
            <strong>Restrict a page</strong> so only the people you add can open it (in a workspace, its owner and admins still can).
          </li>
          <li>
            <strong>Share with people by email</strong>: they can view, comment or edit. People without a Folevi account get an invitation to accept first; people outside a workspace join that page as guests, who aren’t billed. They get an email and find the page under Shared.
          </li>
          <li>
            <strong>Create a public link</strong> for anyone with the URL. You can set an expiry date, require a password of at least 8 characters, and revoke the link at any time. It stops working immediately.
          </li>
        </ul>
        <p>
          People who can comment or edit can also leave <Link href="/features/comments">comments</Link>. More in <Link href="/features/sharing">Sharing notes</Link> and on the <Link href="/security#sharing">Security</Link> page.
        </p>
      </>
    ),
  },
  {
    slug: "workspaces-and-plans",
    title: "Workspaces and plans",
    nav: "Workspaces and plans",
    description: "Your Personal and a Folevi workspace compared: roles, per-member plans, separate storage and AI credits, and what happens when someone leaves.",
    legacyAnchor: "workspaces",
    published: "2026-09-25",
    updated: "2026-09-30",
    body: () => (
      <>
        <p>
          Your <strong>Personal</strong> is yours alone and isn’t a workspace: nobody can join it, and your personal plan (Free, Core, Pro or Pro AI) covers it: its storage, your devices and your AI credits. A <strong>workspace</strong> is shared with a team and has its own plan, storage and billing.
        </p>
        <ul>
          <li>
            <strong>Roles.</strong> Every workspace has one owner. Admins manage members, guests and settings; members work on the workspace’s pages (some members can only comment or view). Guests aren’t members: they see only the pages shared with them.
          </li>
          <li>
            <strong>Plans.</strong> Free, Core, Pro and Pro AI, the same as personal plans. Paid plans are billed per member seat. The owner, admins and members each take one and get the plan’s storage and AI credits in the workspace; guests and pending invitations are free. On Core, nobody in the workspace can use AI. The owner, and admins the owner allows, manage the plan in Settings → Plan & billing. See <Link href="/pricing">Pricing</Link>.
          </li>
          <li>
            <strong>Separate plans.</strong> A personal plan never upgrades a workspace, and a workspace plan never changes your Personal. On Free, your Personal and the free workspaces you own share {sizeLabel(STORAGE_BYTES.free)}, and in a free workspace each member uses their own personal AI credits. On paid plans, storage and AI credits are per person. If a space goes over its limit, nothing is deleted. New uploads wait until there’s room.
          </li>
          <li>
            <strong>Leaving and deleting.</strong> Content in a workspace belongs to the workspace and stays when someone leaves. The owner can’t leave until they transfer ownership or delete the workspace; a deleted workspace is removed after 7 days, and the owner can cancel until then.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: "import-and-export",
    title: "Import and export",
    nav: "Import and export",
    description: "Import from Notion, Evernote, Word, HTML, CSV, Markdown and text into Folevi, and export any page as Markdown, HTML or PDF, or everything as a ZIP.",
    legacyAnchor: "import-export",
    published: "2026-09-25",
    updated: "2026-10-14",
    body: () => (
      <>
        <h2 id="import">Import</h2>
        <p>Bring your notes in and Folevi turns them into blocks: headings, lists, checklists, tables and all.</p>
        <p>In Settings → Import & export, choose files or a whole folder:</p>
        <ul>
          <li>
            <strong>Notion:</strong> the ZIP from Notion’s Export (Markdown & CSV). Pages keep their nesting, links between them become page links, and databases come in as tables.
          </li>
          <li>
            <strong>Evernote:</strong> <code>.enex</code> files. Each notebook becomes a folder, and images and to-dos come with the notes.
          </li>
          <li>
            <strong>Word:</strong> <code>.docx</code> files, with headings, lists, tables and images.
          </li>
          <li>
            <strong>Web pages and spreadsheets:</strong> <code>.html</code> files, and <code>.csv</code> files as tables.
          </li>
          <li>
            <strong>Markdown and text:</strong> <code>.md</code>, <code>.markdown</code>, <code>.txt</code>, or a <code>.zip</code> of them. Images the Markdown points to by a relative path come in as image blocks.
          </li>
        </ul>
        <p>Up to 400 pages go in one import, and Folevi lists anything it couldn’t bring across.</p>
        <h2 id="export">Export</h2>
        <ul>
          <li>Any page as Markdown, HTML or PDF.</li>
          <li>Everything in your Personal, or (for owners and admins) in a workspace, as a ZIP archive.</li>
        </ul>
        <p>
          A single page exports from its ••• menu. PDF uses your browser’s print dialog (Save as PDF). The ZIP holds every document as Markdown, in folders that match your sidebar, the attachments in an <code>assets</code> folder, and a <code>manifest.json</code> that describes the folders, documents and files.
        </p>
        <p>In the Mac app, the Export window also shows the page as a Markdown file you can drag straight to Finder or another app.</p>
        <p>Exports are yours to keep. Nothing in Folevi is locked to Folevi.</p>
      </>
    ),
  },
  {
    slug: "ai-assistant",
    title: "Foli AI and AI credits",
    nav: "Foli AI and credits",
    description: "How Foli AI, Folevi’s AI assistant, works: Ask Foli AI, editing and writing with ⌘J, titles, Catch me up and flowcharts, AI credits per plan, and turning AI off.",
    published: "2026-09-30",
    updated: "2026-10-01",
    body: () => (
      <>
        <p>
          Foli AI answers questions from the notes you can open, helps you write, and writes a short brief of your week. It runs on Google Gemini. It’s part of every plan except Core.
        </p>
        <h2 id="use">Where to find it</h2>
        <ul>
          <li>
            <strong>Ask Foli AI</strong>: press <code>⌘J</code> anywhere outside a note, or pick Ask Foli AI about your notes in the <code>⌘K</code> palette. Ask a question and get an answer with links to the notes it used, then ask follow-ups. From a folder’s menu, Ask Foli AI about this folder keeps the answers inside that folder.
          </li>
          <li>
            <strong>Editing a selection</strong>: select text and press <code>⌘J</code>, or use the AI button in the selection toolbar or Ask Foli AI… in a block’s handle menu. Improve it, fix spelling and grammar, make it shorter or longer, simplify it, make it sound professional or casual, translate it into one of 15 languages, explain it or summarize it. Or type your own instruction. Then Replace, Insert below, Try again, or tweak the result with Shorter, Longer, Simpler, More formal or More casual.
          </li>
          <li>
            <strong>Writing</strong>: on an empty line, type <code>/</code> and pick an AI item, or press <code>⌘J</code>, to continue writing, summarize the note, make an outline, brainstorm ideas or find the action items (written as to-dos, so they appear in Tasks). The AI panel in a note’s dock has the same tools, plus questions about the note.
          </li>
          <li>
            <strong>Titles</strong>: select words in a title for Edit with AI, or let it suggest a title from the note. Untitled notes with some text offer Suggest a title.
          </li>
          <li>
            <strong>Catch me up</strong>: on Home, a short brief of your week: recent notes and what’s due.
          </li>
          <li>
            <strong>Flowcharts</strong>: describe a process and the AI draws it, or changes a chart you have. Undo the whole change with <code>⌘Z</code>.
          </li>
        </ul>
        <p>Answers and rewrites appear word by word, and you can press Stop at any time.</p>
        <h2 id="credits">AI credits</h2>
        <p>
          AI use is counted in credits. A credit is one cent of what the AI costs to run, and each request is charged for what it actually uses: a short rewrite is usually 1 credit, and a question to Foli AI or a new flowchart usually 3 to 5. Before a request starts, Folevi sets a few credits aside so it can finish, and gives back what it didn’t use.
        </p>
        <ul>
          <li>
            {TIER_NAMES.free}: AI during the {TRIAL_DAYS}-day trial ({TRIAL_CREDITS} credits), then none.
          </li>
          <li>{TIER_NAMES.core}: no AI.</li>
          <li>
            {TIER_NAMES.pro}: {MONTHLY_CREDITS.pro} credits a month.
          </li>
          <li>
            {TIER_NAMES.pro_ai}: unlimited AI with fair use, which is {MONTHLY_CREDITS.pro_ai.toLocaleString("en-US")} credits a month.
          </li>
          <li>
            The {TRIAL_DAYS}-day trial for new accounts: {TRIAL_CREDITS} credits.
          </li>
        </ul>
        <p>
          On {TIER_NAMES.pro} and {TIER_NAMES.pro_ai} you can buy a credit pack ({CREDIT_PACKS.credits_500.credits} credits for {formatPrice(CREDIT_PACKS.credits_500.priceCents)} or {CREDIT_PACKS.credits_1000.credits.toLocaleString("en-US")} for {formatPrice(CREDIT_PACKS.credits_1000.priceCents)}). Packs last {PACK_VALID_MONTHS} months and are used after your monthly credits. In a paid workspace, each member has the plan’s credits there; in a free workspace, and as a guest, you use your own personal credits. See <Link href="/pricing">Pricing</Link>.
        </p>
        <h2 id="off">Turning it off</h2>
        <p>
          Turn Foli AI off in Settings at any time. While it’s off, none of your notes are sent to it. On Core, the server refuses every AI request and the app hides AI. See <Link href="/features/ai-notes">AI notes</Link> and the <Link href="/privacy#ai">Privacy</Link> page.
        </p>
      </>
    ),
  },
  {
    slug: "connected-apps",
    title: "Connect Folevi to Claude, ChatGPT and other AI apps",
    nav: "Connected apps (MCP)",
    description: "Let Claude, ChatGPT, Cursor or any app that speaks MCP search and read your Folevi notes, add to them and manage your tasks, with your permission and revocable at any time.",
    published: "2026-10-14",
    updated: "2026-10-14",
    body: () => (
      <>
        <p>
          Folevi has an MCP server, so AI apps you already use can work with your notes. Ask Claude to find what you wrote about a project, have ChatGPT turn a meeting into tasks, or let Cursor read your spec while it codes. Every plan can connect apps.
        </p>
        <h2 id="connect">Connect an app</h2>
        <p>
          Add Folevi as a custom connector (some apps call it a remote MCP server) with this address:
        </p>
        <pre>
          <code>https://app.folevi.com/mcp</code>
        </pre>
        <ul>
          <li>
            <strong>Claude:</strong> Settings → Connectors → Add custom connector. In Claude Code, run <code>claude mcp add --transport http folevi https://app.folevi.com/mcp</code>.
          </li>
          <li>
            <strong>ChatGPT:</strong> add a connector with the address above (custom connectors may need developer mode turned on).
          </li>
          <li>
            <strong>Cursor, VS Code and others:</strong> add a server with <code>&quot;url&quot;: &quot;https://app.folevi.com/mcp&quot;</code> to the app’s MCP settings.
          </li>
        </ul>
        <p>
          The app opens a Folevi page in your browser. Sign in if you need to, then choose what it may do and which places it may use (your Personal, and any workspaces you pick). Nothing is shared until you press Allow.
        </p>
        <h2 id="what-apps-can-do">What a connected app can do</h2>
        <Table
          label="What connected apps can do"
          head={["Permission", "What it allows"]}
          rows={[
            ["Read notes", "Search notes, read a note as Markdown, list recent notes, folders and tags."],
            ["Write notes", "Create a note and add text to the end of one. It can’t delete or rewrite what you wrote."],
            ["Read tasks", "List your tasks, by date or by note."],
            ["Write tasks", "Add a task (with a date, time, priority or repeat), complete one, or change one."],
          ]}
        />
        <p>
          A connected app only reaches the places you allowed, and only what you can open yourself. Changes it makes show in the page’s history like anyone else’s, so you can see them and undo them. There’s also a Weekly review prompt: the app looks back at the week’s notes and open tasks and helps you plan the next one.
        </p>
        <h2 id="manage">See and remove connected apps</h2>
        <p>
          Settings → Connected apps lists every app you’ve allowed, what it may do, which places it uses and when it was last used. Remove one and it loses access at once.
        </p>
        <h2 id="limits">Limits</h2>
        <ul>
          <li>Reads: up to 300 a minute. Searches: up to 120 a minute.</li>
          <li>Writes: up to 30 a minute and 500 a day.</li>
          <li>A note is read up to 40,000 characters at a time.</li>
        </ul>
        <p>
          Using Folevi through another app doesn’t spend your Folevi AI credits: the other app does the AI work. Anything Folevi sends it is your note’s content, so the other app’s own privacy terms apply to what it does with it.
        </p>
      </>
    ),
  },
  {
    slug: "account-security",
    title: "Account security",
    nav: "Account security",
    description: "Email verification, two-step verification with an authenticator app, recovery codes and deleting your Folevi account.",
    legacyAnchor: "account-security",
    published: "2026-09-25",
    updated: "2026-09-30",
    body: () => (
      <>
        <ul>
          <li>Email verification is required before you can open Folevi.</li>
          <li>Two-step verification with an authenticator app (TOTP) is optional; turn it on in Settings → Security.</li>
          <li>When you set up two-step verification you receive one-time recovery codes. Each works once. Store them somewhere safe, away from your password.</li>
          <li>
            You can delete your account at any time. If you own a workspace other people use, transfer it or delete it first. After a 7-day grace period, your account, your Personal and any workspace only you use are deleted permanently.
          </li>
        </ul>
        <p>
          The full picture (encryption, what staff can and can’t see, and our subprocessors) is on the <Link href="/security">Security</Link> page. To report a vulnerability, email <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>. For anything else, write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </>
    ),
  },
];

export const docPath = (slug: string) => `/docs/${slug}`;

export function docBySlug(slug: string): DocArticle | undefined {
  return DOC_ARTICLES.find((a) => a.slug === slug);
}

/** Old /docs#anchor → the article that now holds that section. */
export const LEGACY_DOC_ANCHORS: Record<string, string> = Object.fromEntries(DOC_ARTICLES.filter((a) => a.legacyAnchor).map((a) => [a.legacyAnchor!, docPath(a.slug)]));
