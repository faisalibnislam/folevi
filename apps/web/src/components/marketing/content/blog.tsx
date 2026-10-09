import Link from "next/link";
import type { ReactNode } from "react";
import { CREDIT_PACKS, GB, MONTHLY_CREDITS, PACK_VALID_MONTHS, PLAN_CATALOG, PRICES, STORAGE_BYTES, TRIAL_CREDITS, TRIAL_DAYS, formatPrice } from "@/lib/plans";
import { Kbd } from "../ui";

/*
 * The blog (/blog/<slug>), one typed module per post. Every claim describes what Folevi does today; the
 * code or doc it comes from is named in a comment where it isn't obvious. Prices and limits come from the
 * plan catalog. `published` and `updated` are YYYY-MM-DD: the sitemap, the RSS feed and the post's
 * structured data use them, so change `updated` with the text. Bodies use the same prose styles as the docs.
 */

export type BlogPost = {
  slug: string;
  /** The post's H1 and <title>. */
  title: string;
  description: string;
  published: string;
  updated: string;
  author: string;
  tags: string[];
  /** Slugs of posts to suggest after this one. */
  related: string[];
  body: () => ReactNode;
};

export const BLOG_AUTHOR = "The Folevi team";

const p = (cents: number) => formatPrice(cents);
const gb = (bytes: number) => `${bytes / GB} GB`;
const n = (value: number) => value.toLocaleString("en-US");
const VERSION_DAYS = PLAN_CATALOG.personal_free.entitlements.versionHistoryDays;

function Table({ label, head, rows }: { label: string; head: [string, string]; rows: Array<[ReactNode, ReactNode]> }) {
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
          {rows.map(([name, body], i) => (
            <tr key={i}>
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

const POSTS: BlogPost[] = [
  {
    slug: "how-offline-first-notes-work",
    title: "How offline-first notes work in Folevi",
    description: "Folevi saves every edit on your device before it syncs. Where edits wait, what each sync status means, and what happens when two devices edit one block.",
    published: "2026-09-30",
    updated: "2026-09-30",
    author: BLOG_AUTHOR,
    tags: ["Sync", "Offline"],
    related: ["moving-your-notes-into-folevi", "meeting-notes-that-turn-into-tasks"],
    // docs/SYNC_PROTOCOL.md, apps/web/src/components/app/SyncStatus.tsx, components/doc/DocumentView.tsx (conflicts).
    body: () => (
      <>
        <p>
          Many note apps save to a server and keep a copy on your device. Folevi works the other way round. Every change is written to your device first, and the server hears about it afterwards. This post explains what that means day to day: where your edits wait, what the status on each page tells you, and what happens when two devices change the same thing.
        </p>

        <h2 id="device-first">Where an edit goes first</h2>
        <p>
          When you type in a Folevi page, the change goes into a queue on your device before anything is sent. On the web the queue lives in your browser’s storage, and Folevi for Mac, which is coming soon, keeps it the same way. The editor never waits for the network, so typing on a slow train connection feels the same as typing at your desk.
        </p>
        <p>
          The queue is durable. If you reload the tab, close the browser or restart the computer, the waiting edits are still there, and Folevi sends them the next time it can.
        </p>
        <p>
          Each queued change has its own ID. If a change is sent twice, say because the connection dropped just as the server replied, the server recognises the ID and doesn’t apply it again. That is why Folevi can retry as often as it needs to without duplicating a paragraph.
        </p>

        <h2 id="statuses">What the sync status means</h2>
        <p>Every page shows a small status. There are six, and each one means one thing.</p>
        <Table
          label="Sync statuses"
          head={["Status", "What it means"]}
          rows={[
            ["Saved", "The server has confirmed every change on this page."],
            ["Saving", "You’re online and recent edits are on their way."],
            ["Offline", "There’s no connection. Edits are stored on this device, with a count of how many are waiting."],
            ["Syncing", "You’ve reconnected. Folevi is fetching changes from your other devices and sending yours."],
            ["Conflict", "The same block was changed in two places. Both versions are kept until you choose."],
            ["Not saved", "The server turned a change down, or you need to sign in again. Open the status for the details and a retry button."],
          ]}
        />
        <p>
          The rule we care most about is the first one. Folevi shows Saved only after the server has confirmed every change on the page, including the sentence you are still typing. If the status says Saved, the server has it. If it says anything else, some of your work is only on this device for now, and the status tells you why. Open it to see which pages still have changes waiting.
        </p>

        <h2 id="offline">Writing with no connection</h2>
        <p>
          Offline, the status says Offline and counts the edits waiting on this device. You can keep writing, create pages, tick off to-dos and move blocks around. All of it goes into the queue.
        </p>
        <p>
          You can also open Folevi in the browser with no connection at all. After one visit online, Folevi opens offline and shows your notes as this device last saw them. If you’d like Folevi in its own window, install it as a web app from your browser.
        </p>
        <p>Files have their own queue. If an upload is interrupted, it waits and retries on its own, and a stuck upload never holds up your text.</p>

        <h2 id="reconnect">Coming back online</h2>
        <p>When the connection returns, the status changes to Syncing and Folevi works through these steps:</p>
        <ol>
          <li>It refreshes your sign-in.</li>
          <li>It fetches the changes made on your other devices since this one last synced.</li>
          <li>It sends your waiting edits in the order you made them, up to 100 at a time.</li>
          <li>It shows Saved once the server has confirmed all of them.</li>
        </ol>
        <p>If your sign-in has expired, Folevi asks you to sign in again. Your waiting edits stay on the device while you do.</p>

        <h2 id="conflicts">When two devices change the same block</h2>
        <p>
          Folevi syncs block by block. A block is one item on the page: a paragraph, a heading, a to-do, a table. Edits to different blocks merge on their own. Change the first paragraph on your laptop and the last one on your desktop, and both changes land.
        </p>
        <p>
          A conflict happens when the same block changed in two places before either device synced. Folevi keeps both versions and shows them side by side, the version from elsewhere next to yours, with three choices: <strong>Keep mine</strong>, <strong>Keep theirs</strong> and <strong>Keep both</strong>. Keep both adds your version as a new block right after the other one, so you can merge them by hand. Until you choose, nothing is thrown away.
        </p>
        <p>If the other device deleted the block while you were editing it, the conflict says so, and you choose between your version and the deletion.</p>
        <p>
          The same applies to two people in a workspace. If you both type in the same paragraph at the same moment, you’ll see a conflict instead of merged text, because Folevi doesn’t merge edits character by character yet. We chose a conflict you can see over text that interleaves or disappears without telling you.
        </p>

        <h2 id="versions">Version history as a second net</h2>
        <p>
          Separately from sync, Folevi takes snapshots of each page: about two minutes after you stop editing, when you close the tab, and just before you restore an older version. Snapshots are kept for {VERSION_DAYS} days on every plan, and you can restore any of them.
        </p>

        <h2 id="more">Read more</h2>
        <p>
          The <Link href="/docs/sync-and-offline">Sync and offline</Link> article in the docs has the short version, and <Link href="/features/offline-notes">offline notes</Link> covers the feature. If you’re moving from another app, <Link href="/blog/moving-your-notes-into-folevi">moving your notes into Folevi</Link> explains the import.
        </p>
      </>
    ),
  },
  {
    slug: "why-folevi-has-a-plan-with-no-ai",
    title: "Why Folevi has a plan with no AI",
    description: `Core costs ${p(PRICES.core.month)} a month and never sends your notes to an AI model. The server refuses AI in a Core space for everyone in it.`,
    published: "2026-09-30",
    updated: "2026-09-30",
    author: BLOG_AUTHOR,
    tags: ["Plans", "AI", "Privacy"],
    related: ["what-an-ai-credit-is", "how-offline-first-notes-work"],
    // docs/BILLING.md (Core), convex/lib/plans.ts (tierHasAi), content/features.tsx (ai-notes privacy).
    body: () => (
      <>
        <p>
          Folevi has four plans. Three of them include Foli. The fourth, Core, doesn’t, on purpose. Core costs {p(PRICES.core.month)} a month or {p(PRICES.core.year)} a year, has {gb(STORAGE_BYTES.core)} of storage and no device limit, and never sends anything to an AI model.
        </p>

        <h2 id="includes">What Core includes</h2>
        <p>
          Core has everything in Folevi except Foli: the block editor, nested and linked pages, tasks with Today and the calendar, offline editing and sync, flowcharts and whiteboards, note styles, templates, sharing with guests and public links, {VERSION_DAYS} days of version history, and export. Compared with Free, it adds room ({gb(STORAGE_BYTES.core)} instead of {gb(STORAGE_BYTES.free)}) and removes the two-device limit.
        </p>

        <h2 id="enforced">What “no AI” means in practice</h2>
        <p>
          On Core, the AI isn’t only hidden. The server refuses every AI request from a Core Personal or a Core workspace, whoever sends it: the owner, a member or a guest. The app also hides every AI entry point there, so you won’t see Ask Foli, the <Kbd>⌘J</Kbd> writing menu or Catch me up. The server check is the one that counts. It holds even if an older copy of the app, or a script, tried to call the AI.
        </p>
        <p>Core also covers the edges:</p>
        <ul>
          <li>Pages in a Core space are never sent to AI from anywhere else, so someone on another plan who can open them still can’t have the AI read them.</li>
          <li>A person on Core has no personal AI credits, so they have no AI in free workspaces or on pages shared with them as a guest either.</li>
        </ul>

        <h2 id="who">Who Core is for</h2>
        <ul>
          <li>People who want a notes app, don’t use AI, and would rather not pay for it. Core is less than half the price of Pro ({p(PRICES.pro.month)} a month).</li>
          <li>Teams with a rule that client or company notes may not go to an AI provider. On a Core workspace, the plan enforces that rule for every member and guest.</li>
          <li>People who write things they’d prefer no model reads: a journal, health notes, early drafts.</li>
        </ul>
        <p>
          A Core workspace costs {p(PRICES.core.month)} per member a month. Guests are free, and they can’t use AI in it either.
        </p>

        <h2 id="sometimes">If you want AI some of the time</h2>
        <p>
          Free includes {MONTHLY_CREDITS.free} AI credits a month, Pro {MONTHLY_CREDITS.pro} and Pro AI {MONTHLY_CREDITS.pro_ai}. On any of them you can turn Foli off in Settings, and while it’s off none of your notes are sent. The difference with Core is who decides. In Settings, each person decides for themselves. On Core, the plan decides, for everyone in that space.
        </p>

        <h2 id="moving">Moving to Core</h2>
        <p>
          Moving from Pro to Core keeps your storage the same, {gb(STORAGE_BYTES.core)}, and turns AI off in that space straight away. Moving down from Pro AI takes you from {gb(STORAGE_BYTES.pro_ai)} to {gb(STORAGE_BYTES.core)}. If you’re using more than that, nothing is deleted: everything stays readable, and new uploads wait until there’s room. In a workspace, the owner, and admins the owner allows, change the plan for everyone in it.
        </p>
        <p>
          The jobs the AI does on other plans can be done by hand on Core. Draw a flowchart with shapes and connectors and press Tidy up to lay it out, or paste a Mermaid diagram. Write your own summary at the top of a long page. Pick out the action items from a meeting and turn them into to-dos, which are tasks with dates like any other.
        </p>

        <h2 id="where">Where your notes go when AI is on</h2>
        <p>
          On the plans with AI, your request and the notes it needs go to Google Gemini. Google doesn’t use requests to its paid Gemini API to train its models, and Folevi doesn’t train models on your notes. Folevi records how many requests and credits you used each day. It doesn’t keep your prompts, your notes or the answers in those records. More on the <Link href="/privacy#ai">Privacy</Link> page.
        </p>

        <h2 id="why">Why we built it</h2>
        <p>
          AI costs us money every time it runs, so plans with AI cost more. Some people don’t want it, and a plan without it lets them pay {p(PRICES.core.month)} instead of {p(PRICES.pro.month)}. It also gives teams a short answer to a question their security review will ask: does this tool send our notes to an AI model? On Core, no.
        </p>
        <p>
          You can change plans in Settings → Plan & billing. If you do want AI, <Link href="/blog/what-an-ai-credit-is">what an AI credit is</Link> explains how Folevi counts it, and <Link href="/pricing">Pricing</Link> has every plan side by side.
        </p>
      </>
    ),
  },
  {
    slug: "what-an-ai-credit-is",
    title: "What an AI credit is, and why we count them",
    description: "One Folevi AI credit is one cent of what the AI costs to run. How a request becomes credits, what common actions cost, and how packs and fair use work.",
    published: "2026-09-30",
    updated: "2026-09-30",
    author: BLOG_AUTHOR,
    tags: ["AI", "Plans"],
    related: ["why-folevi-has-a-plan-with-no-ai", "meeting-notes-that-turn-into-tasks"],
    // docs/BILLING.md (AI credits), convex/lib/credits.ts, convex/lib/plans.ts.
    body: () => (
      <>
        <p>
          Folevi measures AI use in credits. One credit is one cent ($0.01) of what the AI model costs Folevi to run. That is the whole definition. This post explains how it works out in practice.
        </p>

        <h2 id="how">How a request becomes credits</h2>
        <p>
          Folevi’s AI runs on Google Gemini, which charges by the token. A token is a short piece of a word, and Google charges for the tokens sent to the model and the tokens it writes back. After each request, Folevi reads the token counts Google reports, prices them at Google’s rates and rounds up to whole cents. A request that costs a third of a cent uses 1 credit. One that costs 2.1 cents uses 3.
        </p>
        <p>
          Every request uses at least 1 credit. Short jobs, such as suggesting a title, fixing spelling or rewriting up to about 1,500 characters, go to a smaller, cheaper Gemini model, so they usually cost 1.
        </p>

        <h2 id="costs">What things cost</h2>
        <Table
          label="Typical AI costs in credits"
          head={["Action", "Credits, roughly"]}
          rows={[
            ["Rewrite or shorten a paragraph", "1"],
            ["Fix spelling and grammar", "1"],
            ["A question to Foli", "2 to 4"],
            ["Catch me up (a brief of your week)", "2"],
            ["Draw or update a flowchart", "3 to 5"],
          ]}
        />
        <p>Longer inputs cost more, because the model reads more. A question that draws on several long notes costs more than a question about one short note.</p>

        <h2 id="plans">How many credits each plan has</h2>
        <ul>
          <li>
            Free: {MONTHLY_CREDITS.free} credits a month, reset on the first of each month (UTC).
          </li>
          <li>Core: none. Core has no AI.</li>
          <li>
            Pro: {MONTHLY_CREDITS.pro} credits a month, for {p(PRICES.pro.month)} a month.
          </li>
          <li>
            Pro AI: {MONTHLY_CREDITS.pro_ai} credits a month, sold as unlimited AI with fair use, for {p(PRICES.pro_ai.month)} a month.
          </li>
          <li>
            The {TRIAL_DAYS}-day trial for new accounts: {TRIAL_CREDITS} credits for the whole trial.
          </li>
        </ul>
        <p>
          Paid plans reset each month of the billing period, including yearly plans, and monthly credits don’t carry over. In terms of work, {MONTHLY_CREDITS.pro} credits is about {MONTHLY_CREDITS.pro} paragraph rewrites, or about {Math.round(MONTHLY_CREDITS.pro / 3)} questions to Foli at 3 credits each. Settings → Plan & billing shows how many credits you have left and the day they reset.
        </p>
        <p>
          In a paid workspace, each member has the plan’s credits there. In a free workspace, and on pages shared with you as a guest, you use your own personal credits.
        </p>

        <h2 id="packs">Credit packs</h2>
        <p>
          On Pro and Pro AI you can buy a pack: {n(CREDIT_PACKS.credits_500.credits)} credits for {p(CREDIT_PACKS.credits_500.priceCents)} or {n(CREDIT_PACKS.credits_1000.credits)} for {p(CREDIT_PACKS.credits_1000.priceCents)}. Packs last {PACK_VALID_MONTHS} months from the day you buy them and are used after your monthly credits, the pack that expires soonest first. A pack belongs to the person who bought it, in the place they bought it for: their Personal, or their seat in one workspace. Packs aren’t shared across a team.
        </p>

        <h2 id="fair-use">What fair use means on Pro AI</h2>
        <p>
          The fair-use line on Pro AI is {MONTHLY_CREDITS.pro_ai} credits a month, about {Math.round(MONTHLY_CREDITS.pro_ai / 30)} a day. Every plan with AI also has an hourly cap on the number of requests, which is there to stop scripts and abuse. For a person writing, the monthly credits are the limit you would meet first, and a pack tops them up.
        </p>

        <h2 id="run-out">What happens when you run out</h2>
        <p>
          Before each request, Folevi sets aside a cautious estimate of what it could cost. If you don’t have enough credits left, the request is turned down before anything is sent, and a refused request costs nothing. The message tells you when your credits reset. On Pro and Pro AI it offers a pack, and on Free it offers an upgrade.
        </p>
        <p>
          When a request finishes, Folevi charges what it really cost and releases the rest of the estimate. If the real cost turns out to be more than you had left, your balance goes to zero and the difference is never charged later. If a reply fails after Gemini has already answered, it is still charged, because Google charged us for it.
        </p>

        <h2 id="why">Why we count at all</h2>
        <p>
          Counting in real cost means no plan can cost more in AI than it earns, so the prices on the <Link href="/pricing">pricing page</Link> can stay where they are. It also means you can see what you use, in a unit that means something.
        </p>
        <p>
          It is also what makes Core possible: a plan with no credits is a plan with no AI. <Link href="/blog/why-folevi-has-a-plan-with-no-ai">Why Folevi has a plan with no AI</Link> explains that one. For what the AI can do, see <Link href="/features/ai-notes">AI notes</Link> and the <Link href="/docs/ai-assistant">Foli docs</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "meeting-notes-that-turn-into-tasks",
    title: "Meeting notes that turn into tasks",
    description: "Use Folevi’s Meeting Notes template so the follow-ups you write become tasks with dates, owners and reminders, and show up in Today when they’re due.",
    published: "2026-09-30",
    updated: "2026-09-30",
    author: BLOG_AUTHOR,
    tags: ["Tasks", "Templates"],
    related: ["what-an-ai-credit-is", "how-offline-first-notes-work"],
    // convex/lib/templates.ts (meeting-notes), components/editor/EditorMenus.tsx (TaskDetails, ⌘⇧D),
    // components/views/HelpView.tsx (shortcuts), content/docs.tsx (task views).
    body: () => (
      <>
        <p>
          The useful part of a meeting is what happens after it. In Folevi, the follow-ups you write in your meeting notes are tasks. Give them a date and they appear in Today when they’re due. Here is how to set that up with the Meeting Notes template.
        </p>

        <h2 id="template">Start from the template</h2>
        <p>Open Templates in the sidebar and choose Meeting Notes under Built-in templates. Folevi creates a new page with four parts:</p>
        <ul>
          <li>A note at the top with When and Who.</li>
          <li>Agenda, a numbered list.</li>
          <li>Decisions, a bulleted list.</li>
          <li>Follow-ups, a to-do list.</li>
        </ul>
        <p>
          You can see the page before you sign up in the <Link href="/template-gallery/meeting-notes">Meeting Notes template</Link> in the gallery. Its Use this template button takes you to sign-up, and the template opens once your account is ready.
        </p>

        <h2 id="before">Before the meeting</h2>
        <p>
          Fill in When and Who, and write the agenda as a numbered list. If there’s a document people should read first, link it with <Kbd>[[</Kbd> so it’s one click away. The linked page lists this meeting under Linked from, so a project page ends up showing every meeting that linked to it.
        </p>

        <h2 id="during">During the meeting</h2>
        <p>
          Write each decision as a short bullet under Decisions. Write anything someone has to do as a to-do under Follow-ups, starting with a verb: “Send the revised quote to Dana”. To start a new to-do anywhere, type <Kbd>[]</Kbd> or press <Kbd>⌘⇧9</Kbd>. Keep each to-do to one action. A single action is easier to date, assign and tick off.
        </p>

        <h2 id="dates">Give each follow-up a date</h2>
        <p>
          Put the cursor on a to-do and press <Kbd>⌘⇧D</Kbd> (<Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>D</Kbd> on Windows and Linux) to open its task details. There you can set:
        </p>
        <ul>
          <li>a due date, and a time if it has one,</li>
          <li>a priority: low, medium or high,</li>
          <li>an assignee, if the page is in a workspace,</li>
          <li>a reminder, which adds a notification at that time.</li>
        </ul>
        <p>
          Once a to-do has a date, a small chip at the end of the line shows it. Click the chip to change the details. A follow-up without a date still counts: it waits in the Inbox view of Tasks until you give it one.
        </p>

        <h2 id="today">Where the tasks show up</h2>
        <p>Every to-do in every page is a task, so the follow-ups appear in Tasks without being copied anywhere:</p>
        <ul>
          <li>
            <strong>Today</strong> lists what’s due today and anything overdue. Open it with <Kbd>⌘⌥T</Kbd>.
          </li>
          <li>
            <strong>Upcoming</strong> lists tasks with a later date.
          </li>
          <li>
            <strong>Inbox</strong> holds tasks with no date yet.
          </li>
          <li>
            <strong>My Tasks</strong>, in a workspace, lists what’s assigned to you.
          </li>
          <li>The calendar shows dated tasks by day.</li>
        </ul>
        <p>
          A task in Today and the to-do in the meeting notes are the same thing, so ticking it off in one place ticks it off in the other. When you open last week’s notes, you can see which follow-ups got done.
        </p>

        <h2 id="offline">If the Wi-Fi drops</h2>
        <p>
          Keep typing. Folevi saves the notes on your device first and syncs them when you reconnect. The status on the page says Offline in the meantime and counts the edits waiting. <Link href="/blog/how-offline-first-notes-work">How offline-first notes work</Link> explains what happens underneath.
        </p>

        <h2 id="share">Share the notes afterwards</h2>
        <p>
          In a workspace, members can already open the page unless it’s restricted. For people outside it, open the page’s Share menu and invite them by email to view, comment or edit. They join that one page as guests, and guests are free on every plan. A comment that @mentions someone notifies them, so a question about a follow-up can sit right next to it.
        </p>

        <h2 id="ai">Let the AI find the action items</h2>
        <p>
          If you took notes as paragraphs, Foli can pull out the follow-ups. Open the AI on the note and choose <strong>Find action items</strong>. It lists the follow-ups and decisions it finds as to-dos, which you can date like any other. This uses AI credits and isn’t available on Core. <Link href="/blog/what-an-ai-credit-is">What an AI credit is</Link> explains the cost.
        </p>

        <h2 id="own">Make it your own</h2>
        <p>
          If your team always adds the same sections, say a Risks heading or a line for the next meeting date, add them to one meeting page and choose Save as template from its ••• menu. It appears under Your templates, and new meetings start from it.
        </p>
        <p>
          Two other built-in templates follow the same pattern. The <Link href="/template-gallery/one-on-one">1:1 template</Link> has a check-in, both people’s topics, feedback and action items. The <Link href="/template-gallery/standup">Daily Standup template</Link> has yesterday, today as to-dos, and blockers. More on tasks in <Link href="/features/tasks">tasks</Link> and <Link href="/docs/tasks-and-calendar">Tasks and calendar</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "moving-your-notes-into-folevi",
    title: "Moving your notes into Folevi",
    description: "Folevi imports Markdown and text files, folders and ZIPs, and exports pages as Markdown, HTML or PDF, or everything as a ZIP. Here is what comes across and how.",
    published: "2026-09-30",
    updated: "2026-09-30",
    author: BLOG_AUTHOR,
    tags: ["Import", "Export"],
    related: ["how-offline-first-notes-work", "meeting-notes-that-turn-into-tasks"],
    // packages/editor-schema/src/markdown.ts (markdownToBlocks), components/doc/importBundle.ts,
    // components/views/settings/DataSection.tsx (50 per batch, image types), convex/imports.ts.
    body: () => (
      <>
        <p>
          Folevi imports Markdown and plain text. Most note apps can export Markdown, so the usual way across is to export from your old app as Markdown, then import the files into Folevi. This post covers what comes across, what doesn’t, and how to take everything out again.
        </p>

        <h2 id="import">What Folevi imports</h2>
        <p>In Settings → Import & export, choose any of these:</p>
        <ul>
          <li>Markdown files (.md or .markdown)</li>
          <li>plain text files (.txt)</li>
          <li>a ZIP of them</li>
          <li>a whole folder</li>
        </ul>
        <p>
          Each file becomes a page in the space you’re in: your Personal or a workspace. If a Markdown file starts with front matter that has a title, Folevi uses it; otherwise the page takes the file name. Folevi imports up to 50 documents at a time, so a large export goes in in parts. The new pages land in Drafts, where you can file them into folders.
        </p>

        <h2 id="blocks">How Markdown turns into blocks</h2>
        <Table
          label="Markdown to Folevi blocks"
          head={["Markdown", "Becomes"]}
          rows={[
            [<code key="h"># Heading</code>, "Heading 1, 2 or 3 (deeper headings become Heading 3)"],
            [<code key="l">- item</code>, "A bulleted or numbered list, with its nesting"],
            [<code key="t">- [ ] task</code>, "A to-do, ticked or not. It’s a task like any other."],
            [<code key="q">&gt; quote</code>, "A quote"],
            [<code key="c">&gt; [!NOTE]</code>, "A callout (note, tip, info, warning and the rest)"],
            [<code key="k">```js</code>, "A code block with its language"],
            [<code key="tb">| table |</code>, "A table with a header row"],
            [<code key="d">---</code>, "A divider"],
            [<code key="m">$$ … $$</code>, "A TeX formula"],
            [<code key="i">![](photo.png)</code>, "An image block, uploaded with the page"],
          ]}
        />
        <p>
          A to-do written as <code>- [ ] Call the printer (due 2026-10-02)</code> comes in with its due date, which is the same way Folevi writes due dates when it exports. Images the Markdown points to by a relative path are uploaded if they’re in the folder or ZIP and are PNG, JPEG, GIF or WebP. Images on the web are shown from their web address.
        </p>

        <h2 id="report">What doesn’t come across</h2>
        <p>Folevi keeps anything it can’t turn into a block as plain text and tells you. After the import, it lists each file with what happened, for example:</p>
        <ul>
          <li>raw HTML, which is imported as text,</li>
          <li>footnotes, which become ordinary paragraphs,</li>
          <li>nested quotes, which are flattened into one,</li>
          <li>an image it couldn’t find, which is kept as a link.</li>
        </ul>
        <p>
          Wiki links written as <code>[[Page name]]</code> also come in as plain text. Once your pages are in, type <Kbd>[[</Kbd> to link them again.
        </p>

        <h2 id="check">Check the result</h2>
        <p>
          When the import finishes, Settings lists every file with a link to its new page, how many images were uploaded, and any warnings with the line they came from. A file that came in cleanly says “Imported without changes”. Open a few pages next to the originals and look at tables, nested lists and images first, since those are where formats differ most.
        </p>
        <p>
          Imported pages start in Drafts. Select several at once and choose Move to folder to file them, then tag or star the ones you use most. If your export has more than 50 documents, import it one folder at a time.
        </p>

        <h2 id="from">Exporting from the app you use now</h2>
        <p>
          Our comparison pages have the steps for each app, with links to its own help pages: <Link href="/compare/notion">Notion</Link>, <Link href="/compare/craft">Craft</Link>, <Link href="/compare/apple-notes">Apple Notes</Link>, <Link href="/compare/obsidian">Obsidian</Link>, <Link href="/compare/bear">Bear</Link> and <Link href="/compare/evernote">Evernote</Link>. Obsidian notes are already Markdown files. Evernote exports ENEX, which Folevi can’t read, so those notes need converting to Markdown first.
        </p>

        <h2 id="export">Taking everything out again</h2>
        <p>Export works on every plan, including Free:</p>
        <ul>
          <li>Any page, from its ••• menu, as Markdown, HTML or PDF. PDF goes through your browser’s print dialog (Save as PDF).</li>
          <li>Everything in your Personal, from Settings → Import & export, as one ZIP. Owners and admins can export a whole workspace the same way.</li>
        </ul>
        <p>
          The ZIP holds every page as a Markdown file, in folders that match your sidebar. Attachments are in an <code>assets</code> folder, and a <code>manifest.json</code> file describes the folders, pages and files. Flowcharts are written as Mermaid diagrams, so they stay readable in other tools.
        </p>
        <p>
          The export uses the same Markdown the import reads. To-dos keep their due dates, and callouts are written in the <code>&gt; [!NOTE]</code> form, so a page you export from Folevi and import again comes back with its tasks and callouts in place.
        </p>
        <p>
          If you move to a smaller plan, your notes stay, and you can still export all of them. <Link href="/docs/import-and-export">Import and export</Link> in the docs has the reference, and <Link href="/features/import-and-export">import and export</Link> the overview.
        </p>
      </>
    ),
  },
];

/** Newest first; posts from the same day keep the order above. */
export const BLOG_POSTS: BlogPost[] = [...POSTS].sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));

export const blogPath = (slug: string) => `/blog/${slug}`;

export function postBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

/** The newest `updated` date across posts, for the sitemap's /blog entry. */
export const BLOG_UPDATED = BLOG_POSTS.reduce((latest, post) => (post.updated > latest ? post.updated : latest), "0000-00-00");
