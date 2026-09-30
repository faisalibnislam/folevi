import Link from "next/link";
import type { ReactNode } from "react";
import { COVER_ART } from "@/lib/cover";
import { CREDIT_PACKS, GB, MONTHLY_CREDITS, PACK_VALID_MONTHS, PLAN_CATALOG, PRICES, STORAGE_BYTES, TIER_NAMES, TRIAL_CREDITS, TRIAL_DAYS, formatPrice } from "@/lib/plans";
import { BUILT_IN_TEMPLATES } from "@/lib/templates";
import { FOLDER_COLORS } from "@/lib/folderColors";
import { Kbd } from "../ui";

/*
 * Feature pages (/features/<slug>). Every statement here describes what the app does today; the code it
 * comes from is named in the comments where it isn't obvious. Prices and limits come from the plan catalog.
 * `updated` is the day the page's content last changed (YYYY-MM-DD), used by the sitemap: change it with the
 * text. FAQ answers are plain sentences because they also feed the FAQPage structured data.
 */

export type FeatureVisual = "ai" | "offline" | "tasks" | "linked" | "folders" | "flowchart" | "whiteboard" | "styles" | "sharing" | "workspaces" | "templates" | "export" | "security";

export type Feature = {
  slug: string;
  /** Short name for menus, cards and breadcrumbs. */
  name: string;
  /** One line for cards and the features index. */
  summary: string;
  /** <title> (the site adds "· Folevi"). */
  title: string;
  description: string;
  h1: string;
  intro: string;
  /** Which plans include it, in one line. */
  plans: string;
  updated: string;
  /** The note style that lights the visual's stage. */
  art: string;
  visual: FeatureVisual;
  sections: Array<{ id: string; title: string; body: ReactNode }>;
  faq: Array<{ q: string; a: string }>;
  related: string[];
  /** The docs article that goes deeper. */
  docs?: { label: string; href: string };
};

const credits = (n: number) => n.toLocaleString("en-US");
const gb = (bytes: number) => `${bytes / GB} GB`;
const TEMPLATE_COUNT = BUILT_IN_TEMPLATES.length;
const STYLE_COUNT = COVER_ART.length;
const FOLDER_COLOR_COUNT = FOLDER_COLORS.length;
/** How long page versions are kept (the same on every plan today). */
const VERSION_DAYS = PLAN_CATALOG.personal_free.entitlements.versionHistoryDays;

export const FEATURES: Feature[] = [
  {
    slug: "ai-notes",
    name: "AI Assistant",
    summary: "Ask your notes a question, rewrite and translate text, and get a brief of your week.",
    title: "AI notes app: ask your notes, summarize and rewrite",
    description: `Folevi’s AI Assistant answers questions from your notes with links to its sources, rewrites, translates and summarizes text, and writes a brief of your week. Free includes ${MONTHLY_CREDITS.free} AI credits a month. Core has no AI.`,
    h1: "An AI notes app that answers from your own notes",
    intro:
      "The AI Assistant works with the notes you can already open. Ask it a question and it answers with links to the notes it used. Select a paragraph to rewrite, shorten or translate it, or ask it to summarize the whole note.",
    plans: `Free, Pro and Pro AI, and the ${TRIAL_DAYS}-day trial. Core has no AI.`,
    updated: "2026-09-30",
    art: "art-49",
    visual: "ai",
    docs: { label: "AI Assistant and credits", href: "/docs/ai-assistant" },
    sections: [
      {
        id: "ask",
        title: "Ask your notes a question",
        body: (
          <>
            <p>
              Ask AI answers from the open note, or from notes it finds by searching the ones you can read. Each answer lists its sources, so you can open the note and check. Answers appear word by word, and you can ask a follow-up in the same chat.
            </p>
            <p>It only reads notes you already have access to. In a workspace, pages that are restricted from you stay out of its answers.</p>
          </>
        ),
      },
      {
        id: "write",
        title: "Rewrite, translate and summarize",
        body: (
          <>
            <p>
              Select text and open the AI from the selection toolbar, the slash menu or <Kbd>⌘J</Kbd>. The menu has these actions:
            </p>
            <ul>
              <li>Improve writing, or fix spelling and grammar only.</li>
              <li>Make it shorter or longer, simplify the language, or make it sound professional or casual.</li>
              <li>Translate into one of 15 languages, from English and Spanish to Bengali, Japanese and Arabic.</li>
              <li>Explain the text, or summarize it in a few bullet points.</li>
            </ul>
            <p>For the whole note, it can continue writing, write a summary, make an outline, brainstorm ideas or find the action items and list them as to-dos. It can also suggest a title.</p>
          </>
        ),
      },
      {
        id: "catch-up",
        title: "Catch me up",
        body: (
          <p>
            On Home, <strong>Catch me up</strong> writes a short brief of your week: the notes you worked on and what’s due, with links to the notes it mentions. For diagrams, the flowchart block can draw a chart from a sentence. See <Link href="/features/flowcharts">flowcharts</Link>.
          </p>
        ),
      },
      {
        id: "credits",
        title: "AI credits",
        body: (
          <>
            <p>
              AI use is counted in credits, and a credit is one cent of what the AI costs to run. Rewriting a paragraph uses about 1 credit, a question to Ask AI about 2, and a flowchart 3 to 5.
            </p>
            <ul>
              <li>
                {TIER_NAMES.free}: {MONTHLY_CREDITS.free} credits a month.
              </li>
              <li>
                {TIER_NAMES.pro}: {MONTHLY_CREDITS.pro} credits a month, for {formatPrice(PRICES.pro.month)} a month.
              </li>
              <li>
                {TIER_NAMES.pro_ai}: unlimited AI with fair use ({credits(MONTHLY_CREDITS.pro_ai)} credits a month), for {formatPrice(PRICES.pro_ai.month)} a month.
              </li>
              <li>
                {TIER_NAMES.core}: no AI at all, for {formatPrice(PRICES.core.month)} a month.
              </li>
            </ul>
            <p>
              New accounts get {TIER_NAMES.pro_ai} free for {TRIAL_DAYS} days with {TRIAL_CREDITS} credits. On {TIER_NAMES.pro} and {TIER_NAMES.pro_ai} you can buy a pack of {credits(CREDIT_PACKS.credits_500.credits)} or {credits(CREDIT_PACKS.credits_1000.credits)} credits that lasts {PACK_VALID_MONTHS} months. See <Link href="/pricing">pricing</Link>.
            </p>
          </>
        ),
      },
      {
        id: "privacy",
        title: "What happens to your notes",
        body: (
          <p>
            When you use the AI, your request and the notes it needs go to Google Gemini. Google doesn’t use them to train its models, and neither does Folevi. You can turn the AI Assistant off in Settings; while it’s off, none of your notes are sent. On Core, the server refuses every AI request. More on the <Link href="/privacy#ai">Privacy</Link> page.
          </p>
        ),
      },
    ],
    faq: [
      { q: "Which Folevi plans include AI?", a: `Free (${MONTHLY_CREDITS.free} AI credits a month), Pro (${MONTHLY_CREDITS.pro} a month) and Pro AI (unlimited with fair use, ${credits(MONTHLY_CREDITS.pro_ai)} a month). The ${TRIAL_DAYS}-day trial includes ${TRIAL_CREDITS} credits. Core has no AI.` },
      { q: "What is an AI credit?", a: "One cent of what the AI costs to run. Rewriting a paragraph uses about 1 credit, a question to Ask AI about 2, and a flowchart 3 to 5." },
      { q: "Can the AI see notes I don’t have access to?", a: "No. Ask AI answers from the open note or from notes it finds by searching the ones you can already read." },
      { q: "Can I turn the AI off?", a: "Yes. Turn the AI Assistant off in Settings at any time. While it’s off, none of your notes are sent to it." },
      { q: "Does Folevi use my notes to train AI?", a: "No. Folevi doesn’t use your notes to train AI models, and Google doesn’t use requests to its paid Gemini API for training either." },
      { q: "How does AI work in a team workspace?", a: "In a paid workspace, each member has the plan’s AI credits there. In a free workspace, and as a guest, you use your own personal credits. In a Core workspace nobody can use AI." },
    ],
    related: ["flowcharts", "tasks", "security-and-privacy"],
  },
  {
    slug: "offline-notes",
    name: "Offline and sync",
    summary: "Every edit is saved on your device first, and syncs when you reconnect.",
    title: "Offline notes app that syncs",
    description: "Folevi saves every edit on your device first, keeps working with no connection, and syncs when you reconnect. Each page says Saved only when the server has every change.",
    h1: "Offline notes that sync when you’re back online",
    intro:
      "Folevi writes every change to your device before it sends it anywhere. With no connection you keep writing, and your edits wait on the device until you’re back online. The status on each page tells you which of those is happening.",
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-13",
    visual: "offline",
    docs: { label: "Sync and offline", href: "/docs/sync-and-offline" },
    sections: [
      {
        id: "device-first",
        title: "Saved on your device first",
        body: (
          <p>
            Every edit goes into a queue on your device first: in the browser’s storage on the web, and in a local database in the Mac app (coming soon). Then it’s sent to the server. Queued edits survive a reload, a closed tab or a restart.
          </p>
        ),
      },
      {
        id: "no-connection",
        title: "Keep writing with no connection",
        body: (
          <p>
            Offline, the page says <strong>Offline</strong> and counts the edits waiting on this device. You can also open Folevi in the browser with no connection: after one visit online, it shows your notes as this device last saw them. Folevi can be installed as a web app, too.
          </p>
        ),
      },
      {
        id: "status",
        title: "A status that means what it says",
        body: (
          <>
            <p>
              <strong>Saved</strong> appears only after the server has confirmed every change, including the words you’re still typing. In between you’ll see Saving, Offline or Syncing. If something goes wrong, it says Conflict or Error, and opening the status shows the details and a retry button.
            </p>
            <p>
              The six statuses are listed in <Link href="/docs/sync-and-offline">Sync and offline</Link>.
            </p>
          </>
        ),
      },
      {
        id: "conflicts",
        title: "When two devices change the same block",
        body: (
          <p>
            Folevi syncs block by block. If the same block was changed on two devices before they could sync, the page shows a conflict with <strong>Keep mine</strong>, <strong>Keep theirs</strong> and <strong>Keep both</strong>. Nothing is thrown away without you choosing.
          </p>
        ),
      },
      {
        id: "versions",
        title: "Version history",
        body: <p>Folevi takes snapshots of a page as you work, and you can restore an earlier version. Versions are kept for {VERSION_DAYS} days on every plan.</p>,
      },
    ],
    faq: [
      { q: "Does Folevi work offline in the browser?", a: "Yes. Every edit is saved in the browser’s storage first and synced when you reconnect. After one visit online, Folevi also opens with no connection and shows your notes as this device last saw them." },
      { q: "When does a page say Saved?", a: "Only after the server has confirmed every change on that page, including edits you’re still typing." },
      { q: "What happens if I edit the same note on two devices?", a: "Edits to different blocks sync on their own. If the same block changed in both places, Folevi shows a conflict and you choose Keep mine, Keep theirs or Keep both." },
      { q: "Are offline edits lost if I close the tab?", a: "No. Waiting edits are stored on the device and survive a reload, a closed tab or a restart. They sync the next time you’re online." },
      { q: "How long are old versions kept?", a: `Version snapshots are kept for ${VERSION_DAYS} days on every plan, and you can restore any of them.` },
    ],
    related: ["tasks", "sharing", "import-and-export"],
  },
  {
    slug: "tasks",
    name: "Tasks",
    summary: "Every to-do in a note is a task, with dates, priorities and a calendar.",
    title: "To-do lists and tasks inside your notes",
    description: "Every to-do in a Folevi note is a task. Give it a due date, time, priority, assignee or reminder, and find it again in Today, Upcoming and the calendar.",
    h1: "Tasks and to-do lists that live inside your notes",
    intro:
      "In Folevi, a to-do in any note is a task. It stays in the note where you wrote it, next to the context, and it also shows up in Today, in Tasks and on the calendar once it has a date.",
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-41",
    visual: "tasks",
    docs: { label: "Tasks and calendar", href: "/docs/tasks-and-calendar" },
    sections: [
      {
        id: "to-dos",
        title: "Every to-do is a task",
        body: (
          <p>
            Type <Kbd>[]</Kbd> or choose To-do from the slash menu to add a checkbox. Meeting follow-ups, a packing list, the next steps in a project brief: they all become tasks, and ticking one off in Tasks ticks it off in the note.
          </p>
        ),
      },
      {
        id: "details",
        title: "Dates, priority and reminders",
        body: (
          <ul>
            <li>A due date, and a time if you want one.</li>
            <li>A priority: low, medium or high.</li>
            <li>An assignee, in a workspace.</li>
            <li>A reminder. At that time Folevi adds a notification.</li>
            <li>A status: open, done or canceled.</li>
          </ul>
        ),
      },
      {
        id: "views",
        title: "Today, Upcoming and the other views",
        body: (
          <p>
            Tasks has six views. <strong>Inbox</strong> collects tasks without a date, <strong>Today</strong> shows what’s due today and what’s overdue, and <strong>Upcoming</strong> shows what’s next. <strong>All</strong> lists every open task, <strong>Completed</strong> keeps the done and canceled ones, and <strong>My Tasks</strong> shows what’s assigned to you in a workspace.
          </p>
        ),
      },
      {
        id: "calendar",
        title: "Calendar and Quick Add",
        body: (
          <p>
            The calendar shows dated tasks by day. <strong>Quick Add</strong> (<Kbd>⇧⌘A</Kbd>) saves a task into your Inbox page, so a thought you catch on the way out lands in a page you can find later.
          </p>
        ),
      },
      {
        id: "ai",
        title: "Find action items with AI",
        body: (
          <p>
            After a meeting, ask the AI Assistant to <strong>find action items</strong>. It lists the follow-ups and decisions in the note as to-dos, which are tasks like any other. This uses AI credits and isn’t available on Core. See <Link href="/features/ai-notes">AI notes</Link>.
          </p>
        ),
      },
    ],
    faq: [
      { q: "Where do tasks without a date go?", a: "To the Inbox view in Tasks. Give a task a due date and it moves to Today or Upcoming." },
      { q: "Can I assign tasks to other people?", a: "Yes, in a workspace. Each person sees the tasks assigned to them in My Tasks." },
      { q: "How do reminders work?", a: "Set a reminder time on a task and Folevi adds a notification at that time." },
      { q: "Can I see my tasks on a calendar?", a: "Yes. The calendar shows every task with a due date, by day." },
      { q: "Are tasks included on the Free plan?", a: "Yes. Tasks, Today, the calendar and Quick Add are part of every plan." },
    ],
    related: ["templates", "linked-notes", "ai-notes"],
  },
  {
    slug: "linked-notes",
    name: "Linked pages",
    summary: "Link pages with [[, see backlinks, and nest pages inside pages.",
    title: "Linked notes with backlinks",
    description: "Link any Folevi page by typing [[. The page you link to lists a backlink with a short excerpt, and pages can sit inside other pages as a link or a card.",
    h1: "Linked notes with backlinks and pages inside pages",
    intro:
      "Type two brackets to link one page to another. The page you link to shows where it’s linked from, so you can follow a thought from either end, and a page can hold its own sub-pages.",
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-42",
    visual: "linked",
    docs: { label: "Blocks and slash commands", href: "/docs/blocks-and-slash-commands" },
    sections: [
      {
        id: "link",
        title: "Link a page with two brackets",
        body: (
          <p>
            Type <Kbd>[[</Kbd> anywhere in a note and pick a page from the list, or keep typing to create a new page with that name. Link to page in the slash menu does the same.
          </p>
        ),
      },
      {
        id: "backlinks",
        title: "Backlinks",
        body: (
          <p>
            At the bottom of a page, <strong>Linked from</strong> lists every page that links to it, with a line of text around each link. Under <strong>Unlinked mentions</strong> it also lists pages that mention its title without linking it.
          </p>
        ),
      },
      {
        id: "nesting",
        title: "Pages inside pages",
        body: <p>A page can hold sub-pages, shown in the parent as a link or as a card. The Up arrow in the tab strip takes you back to the parent.</p>,
      },
      {
        id: "search",
        title: "Search with ⌘K",
        body: (
          <p>
            <Kbd>⌘K</Kbd> searches titles, text, code, captions, table cells, attachment names and tags in the space you’re in, and highlights the matches. It only returns pages you can open.
          </p>
        ),
      },
      {
        id: "organize",
        title: "Drafts, folders and tags",
        body: <p>New notes wait in Drafts until you file them. <Link href="/features/folders">Folders</Link> show the notes inside them, and pages can also be tagged and starred. Archive keeps finished pages out of the way, and Trash keeps deleted pages for 30 days.</p>,
      },
    ],
    faq: [
      { q: "How do I link to another note?", a: "Type [[ and pick the page, or keep typing to create a new page with that name." },
      { q: "What are backlinks?", a: "The Linked from list at the bottom of a page. It shows every page that links to this one, with the text around the link." },
      { q: "Can a page have sub-pages?", a: "Yes. A sub-page sits inside its parent page and shows there as a link or as a card." },
      { q: "What does search look through?", a: "Titles, text, code, captions, table cells, attachment names and tags, in the space you’re in. It only returns pages you can open." },
    ],
    related: ["templates", "tasks", "flowcharts"],
  },
  {
    // components/app/Sidebar.tsx, FolderMenu.tsx, views/OrganizeIndex.tsx, DocumentBrowser.tsx,
    // MoveToFolderDialog.tsx, HomeDashboard.tsx and convex/organization.ts.
    slug: "folders",
    name: "Folders",
    summary: "Coloured folders for your notes, and Drafts for the ones you haven’t filed.",
    title: "Note folders: organize notes in coloured folders",
    description: "Organize Folevi notes in coloured folders. New notes wait in Drafts until you file them. Move a note from its menu or drag it onto a folder, and find recent folders on Home.",
    h1: "Organize your notes in coloured folders",
    intro:
      "Make a folder for each project, client or trip and file your notes in it. Every folder has a colour and a page that shows the notes inside. Notes you haven’t filed yet wait in Drafts.",
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-30",
    visual: "folders",
    docs: { label: "Getting started", href: "/docs/getting-started" },
    sections: [
      {
        id: "make",
        title: "Make a folder",
        body: (
          <p>
            Press the new folder button next to Folders in the sidebar, or <strong>New folder</strong> on the Folders page, and give it a name. The sidebar lists your first five folders. The Folders page has all of them, with search, sorting and a grid or list view.
          </p>
        ),
      },
      {
        id: "colours",
        title: "A colour for each folder",
        body: (
          <p>
            Every new folder gets a colour. To pick another, open the folder’s menu and choose <strong>Change color</strong>. The {FOLDER_COLOR_COUNT} colours are the page colours of the note styles, and the folder shows its colour in the sidebar, on note cards and on Home.
          </p>
        ),
      },
      {
        id: "drafts",
        title: "Drafts",
        body: (
          <p>
            A new note starts in <strong>Drafts</strong>, unless you create it on a folder’s page, where it starts in that folder. Each note card shows its folder, or Draft if it isn’t filed yet, and the sidebar shows how many notes are in Drafts.
          </p>
        ),
      },
      {
        id: "move",
        title: "Move notes into a folder",
        body: (
          <>
            <ul>
              <li>
                Choose <strong>Move to folder</strong> from a note’s menu, then pick a folder or type to find one.
              </li>
              <li>Drag a note from Home or a list onto a folder in the sidebar. Drop it on Drafts to take it out of its folder.</li>
              <li>Select several notes and move them together.</li>
              <li>
                In a note, the <strong>Location</strong> menu in the Info panel sets its folder.
              </li>
            </ul>
            <p>After a move from a menu or by dragging, the message at the bottom of the screen has Undo.</p>
          </>
        ),
      },
      {
        id: "folder-page",
        title: "A folder’s page",
        body: (
          <p>
            Open a folder to see its notes as cards, compact cards or a list. Sort them by last edit, creation date or title, or choose Manual order and drag them into your own order. <strong>New note</strong> on a folder’s page starts the note in that folder.
          </p>
        ),
      },
      {
        id: "home",
        title: "Recent folders on Home",
        body: <p>Home lists your folders by their latest edit. Each one is drawn as a folder with its newest notes showing through the cover, the number of notes inside and when it last changed.</p>,
      },
      {
        id: "ask",
        title: "Ask AI about a folder",
        body: (
          <p>
            Choose <strong>Ask AI about this folder</strong> from the folder’s menu and the answer comes from that folder’s notes only. It’s there on plans with AI while the AI Assistant is on. See the <Link href="/features/ai-notes">AI Assistant</Link>.
          </p>
        ),
      },
      {
        id: "menu",
        title: "Rename, link and delete",
        body: <p>The folder’s menu also renames it, copies a link to it and deletes it. Deleting a folder keeps its notes: they move to Drafts. In a team workspace, owners and admins can invite people from the same menu.</p>,
      },
    ],
    faq: [
      { q: "Can a note be in more than one folder?", a: "No. A note is in one folder or in Drafts. Tags group notes across folders." },
      { q: "What happens to the notes when I delete a folder?", a: "They stay. The folder is removed and its notes move to Drafts." },
      { q: "Can I change a folder’s colour?", a: `Yes. Open the folder’s menu and choose Change color. There are ${FOLDER_COLOR_COUNT} colours to pick from.` },
      { q: "Are folders on the Free plan?", a: "Yes. Folders work the same way on every plan." },
    ],
    related: ["linked-notes", "note-styles", "ai-notes"],
  },
  {
    slug: "flowcharts",
    name: "Flowcharts and diagrams",
    summary: "Draw flowcharts in a note, lay them out in one click, or let AI draw them.",
    title: "Flowchart maker in your notes, with AI and Mermaid",
    description: "Draw flowcharts in any Folevi note with shapes and connectors, tidy the layout in one click, describe a process for AI to draw, or write Mermaid diagrams.",
    h1: "Flowcharts and diagrams inside your notes",
    intro:
      "A flowchart in Folevi is a block in your note, next to the text that explains it. Add shapes and connectors by hand, describe the process and let the AI draw it, or write a Mermaid diagram.",
    plans: "Flowcharts and Mermaid on every plan. Drawing with AI needs Free, Pro or Pro AI.",
    updated: "2026-09-30",
    art: "art-50",
    visual: "flowchart",
    docs: { label: "Blocks and slash commands", href: "/docs/blocks-and-slash-commands" },
    sections: [
      {
        id: "block",
        title: "A flowchart block in any note",
        body: (
          <>
            <p>
              Type <Kbd>/flowchart</Kbd> to add one. There are seven shapes: process, decision, start or end, input or output, circle, sticky note and text. Shapes can be coloured, duplicated and changed from one kind to another.
            </p>
            <p>Connectors can be solid or dashed, with an arrow at the end, at both ends or none, and each can have a label. You can zoom, fit the chart to the view, undo and redo, and drag the block taller.</p>
          </>
        ),
      },
      {
        id: "tidy",
        title: "Tidy up",
        body: <p>Add shapes wherever they land, then press Tidy up. It lays the whole chart out again in one step.</p>,
      },
      {
        id: "ai",
        title: "Draw it with AI",
        body: (
          <p>
            Open AI in the flowchart and describe the process, step by step or in a sentence. For a chart you already have, choose <strong>Update this chart</strong> (for example, “add an approval step after review”) or <strong>Start over</strong>. A flowchart uses 3 to 5 AI credits, and <Kbd>⌘Z</Kbd> undoes the change.
          </p>
        ),
      },
      {
        id: "mermaid",
        title: "Mermaid diagrams",
        body: (
          <p>
            The Mermaid diagram block is a code block that Folevi draws as a diagram. A Mermaid flowchart can be turned into a flowchart block with <strong>Convert to flowchart</strong>, and a flowchart exported to Markdown is written as Mermaid, so it stays readable in other tools.
          </p>
        ),
      },
      {
        id: "where",
        title: "Where flowcharts work",
        body: <p>Flowcharts are drawn and edited on the web for now. The Mac app keeps them intact, and shared pages show them read-only.</p>,
      },
    ],
    faq: [
      { q: "Can AI make a flowchart for me?", a: "Yes. Describe the process in a sentence or step by step, and the AI draws the chart. It can also update a chart you already have. It uses 3 to 5 AI credits and isn’t available on Core." },
      { q: "Can I paste a Mermaid diagram?", a: "Yes. Add a Mermaid diagram block and paste the code. Mermaid flowcharts can be converted to a flowchart block you can edit by hand." },
      { q: "What happens to a flowchart when I export to Markdown?", a: "It’s written as a Mermaid flowchart in a code block." },
      { q: "Which shapes can I use?", a: "Process, decision, start or end, input or output, circle, sticky note and text." },
    ],
    related: ["whiteboard", "ai-notes", "import-and-export"],
  },
  {
    slug: "whiteboard",
    name: "Whiteboard",
    summary: "Sketch with a pen and a highlighter on a canvas inside the note.",
    title: "Whiteboard inside your notes",
    description: "Add a whiteboard to any Folevi note and sketch with a pen in six colours and three sizes, a highlighter and an eraser. The drawing is part of the note and syncs with it.",
    h1: "A whiteboard inside your notes for quick sketches",
    intro:
      "Some ideas are easier to draw. A whiteboard block gives you a canvas in the middle of a note, so the sketch sits with the text it belongs to.",
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-30",
    visual: "whiteboard",
    docs: { label: "Blocks and slash commands", href: "/docs/blocks-and-slash-commands" },
    sections: [
      {
        id: "draw",
        title: "Draw in the page",
        body: (
          <p>
            Type <Kbd>/whiteboard</Kbd> to add a canvas to the note. Drag its resize handle, or use the arrow keys on it, to make the canvas taller or shorter.
          </p>
        ),
      },
      {
        id: "tools",
        title: "Pen, highlighter and eraser",
        body: (
          <ul>
            <li>The pen draws in black, blue, red, green, orange or purple, in three sizes: fine, medium and thick.</li>
            <li>The highlighter marks in yellow, green, blue or red.</li>
            <li>The eraser removes whole strokes. Undo takes back the last change, and Clear empties the board.</li>
          </ul>
        ),
      },
      {
        id: "scale",
        title: "The same drawing on every screen",
        body: <p>The canvas scales with the page, so a sketch looks the same on a phone as on a wide monitor.</p>,
      },
      {
        id: "sync",
        title: "Part of the note",
        body: (
          <p>
            A whiteboard is a block like any other: it’s saved on your device first, syncs with the rest of the note, and is kept in version history. For boxes and arrows you want to rearrange, use a <Link href="/features/flowcharts">flowchart</Link>.
          </p>
        ),
      },
    ],
    faq: [
      { q: "How do I add a whiteboard to a note?", a: "Type /whiteboard on an empty line, or pick Whiteboard in the slash menu." },
      { q: "Can I erase part of a drawing?", a: "The eraser removes whole strokes. Undo takes back the last change." },
      { q: "Does a whiteboard work offline?", a: "Yes. It’s part of the note, so it’s saved on your device first and syncs when you reconnect." },
      { q: "Should I use a whiteboard or a flowchart?", a: "Use a whiteboard for freehand sketches. Use a flowchart for shapes and connectors you want to move, label and lay out." },
    ],
    related: ["flowcharts", "note-styles", "linked-notes"],
  },
  {
    slug: "note-styles",
    name: "Note styles",
    summary: `${STYLE_COUNT} artwork styles, or your own image, colour each page.`,
    title: "Note styles: themes and colours for your notes",
    description: `Pick one of ${STYLE_COUNT} artwork styles for a Folevi note, or your own image. The style colours the cover, the paper, the text, highlights and checkboxes, in light and dark mode.`,
    h1: "Note styles that give each page its own colours",
    intro: `Folevi’s app stays white, or near-black in dark mode. The colour comes from your notes: pick one of ${STYLE_COUNT} note styles, or your own picture, and the page takes its colours from it.`,
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-03",
    visual: "styles",
    docs: { label: "Blocks and slash commands", href: "/docs/blocks-and-slash-commands" },
    sections: [
      {
        id: "styles",
        title: `${STYLE_COUNT} styles, or Plain`,
        body: (
          <p>
            Each style is an artwork that sets the cover, the paper colour and the text colour. On Auto, highlights, callouts and checkboxes take their colours from it too. Plain has no artwork, and new notes start Plain.
          </p>
        ),
      },
      {
        id: "own-image",
        title: "Your own image",
        body: <p>Upload a picture as a note’s style and Folevi picks the page and text colours from it. PNG, JPEG, WebP and GIF work, up to 20 MB; 2400 × 1500 pixels fits best.</p>,
      },
      {
        id: "blur",
        title: "Blur background",
        body: <p>Turn on Blur background and the style image sits blurred behind the page, which becomes see-through.</p>,
      },
      {
        id: "fine-tune",
        title: "Colours, font and width",
        body: (
          <ul>
            <li>Document colour: Auto, or white, paper, ivory, mist, sage, blush or night.</li>
            <li>Text colour: Auto, or ink, slate, navy, forest, plum, brown or white.</li>
            <li>Font: System, Serif, Mono or Rounded.</li>
            <li>Page width: Narrow or Wide. Separators: line, dots or doodle.</li>
          </ul>
        ),
      },
      {
        id: "dark",
        title: "Light and dark",
        body: <p>Every style has a set of dark colours, so a note keeps its look at night.</p>,
      },
    ],
    faq: [
      { q: "How many note styles are there?", a: `${STYLE_COUNT}, plus Plain and your own image.` },
      { q: "Can I use my own picture?", a: "Yes. Upload a PNG, JPEG, WebP or GIF up to 20 MB and Folevi picks the page and text colours from it." },
      { q: "Do note styles work in dark mode?", a: "Yes. Every style has dark colours as well as light ones." },
      { q: "Does a note style change the whole app?", a: "No. The app stays white, or near-black in dark mode. Only the note takes the style’s colours." },
    ],
    related: ["whiteboard", "templates", "sharing"],
  },
  {
    slug: "sharing",
    name: "Sharing",
    summary: "Share a page with people to view, comment or edit, or with a public link.",
    title: "Share notes with guests and public links",
    description: "Share a Folevi page with people by email to view, comment or edit, or create a public link with an optional password and expiry date that you can revoke at any time.",
    h1: "Share notes with people, guests and public links",
    intro:
      "Pages are private until you share them. Invite people to a single page, give them view, comment or edit access, or make a public link for anyone with the URL.",
    plans: "Every plan, including Free. Guests are free.",
    updated: "2026-09-30",
    art: "art-09",
    visual: "sharing",
    docs: { label: "Sharing and permissions", href: "/docs/sharing-and-permissions" },
    sections: [
      {
        id: "private",
        title: "Private until you share",
        body: <p>Pages in your Personal are private to you. Pages in a workspace are open to its members, and you can restrict one so only the people you add can open it (the workspace’s owner and admins still can).</p>,
      },
      {
        id: "invite",
        title: "Invite people by email",
        body: (
          <p>
            From a page’s Share menu, add people by email and choose <strong>Can view</strong>, <strong>Can comment</strong> or <strong>Can edit</strong>. People without a Folevi account get an invitation first. Someone outside the workspace joins that page as a guest, and it appears in their Shared with Me.
          </p>
        ),
      },
      {
        id: "public-links",
        title: "Public links",
        body: (
          <>
            <p>Public links are off by default. A link lets anyone with the URL read the page, without its comments or nested pages. When you create one you can:</p>
            <ul>
              <li>set an expiry date,</li>
              <li>require a password of at least 8 characters,</li>
              <li>and revoke it later. It stops working immediately.</li>
            </ul>
            <p>Search engines don’t index public links, and the Share menu shows how many times each one was opened.</p>
          </>
        ),
      },
      {
        id: "comments",
        title: "Comments and mentions",
        body: <p>People with comment access can leave comments on a page, reply in threads and resolve them. Mention someone with @ to notify them.</p>,
      },
      {
        id: "guests",
        title: "Guests are free",
        body: (
          <p>
            Guests only see the pages shared with them, and they’re never billed, on any plan. When a guest uses AI, it comes from their own personal plan. See <Link href="/features/team-workspaces">team workspaces</Link>.
          </p>
        ),
      },
    ],
    faq: [
      { q: "Can I share a note with someone who doesn’t use Folevi?", a: "Yes. Invite them by email; they get an invitation to accept first. Or create a public link that anyone with the URL can read." },
      { q: "Can I password-protect a shared link?", a: "Yes. A public link can require a password of at least 8 characters, and it can have an expiry date." },
      { q: "Can I stop sharing a public link?", a: "Yes. Revoke it from the Share menu and it stops working immediately." },
      { q: "Do guests cost anything?", a: "No. Guests are free on every plan." },
      { q: "Can search engines find my shared pages?", a: "No. Public links aren’t indexed by search engines." },
    ],
    related: ["team-workspaces", "security-and-privacy", "offline-notes"],
  },
  {
    slug: "team-workspaces",
    name: "Team workspaces",
    summary: "A shared space for a team, with roles, free guests and per-member plans.",
    title: "Team workspaces for shared notes",
    description: `Create a Folevi workspace for your team, with an owner, admins, members and free guests. Paid workspace plans are billed per member from ${formatPrice(PRICES.core.month)} a month, and stay separate from everyone’s Personal.`,
    h1: "Team workspaces with roles and per-member plans",
    intro:
      "A workspace is a shared space for a team. It has its own pages, plan, storage and billing, and it never mixes with anyone’s Personal, which stays theirs alone.",
    plans: "Free, Core, Pro and Pro AI, billed per member.",
    updated: "2026-09-30",
    art: "art-39",
    visual: "workspaces",
    docs: { label: "Workspaces and plans", href: "/docs/workspaces-and-plans" },
    sections: [
      {
        id: "personal",
        title: "Personal and workspaces",
        body: <p>Everyone has a Personal: it isn’t a workspace, and nobody can join it. Create a workspace from the menu at the bottom of the sidebar. The switcher lists your Personal first, then each workspace with your role in it.</p>,
      },
      {
        id: "roles",
        title: "Roles",
        body: (
          <ul>
            <li>
              <strong>Owner</strong>: one per workspace. Can transfer ownership or delete the workspace.
            </li>
            <li>
              <strong>Admins</strong> manage members, guests and settings.
            </li>
            <li>
              <strong>Members</strong> work on the workspace’s pages. A member can also be limited to comment or view only.
            </li>
            <li>
              <strong>Guests</strong> aren’t members. They see only the pages shared with them, and an admin can turn a guest into a member or the other way round.
            </li>
          </ul>
        ),
      },
      {
        id: "plans",
        title: "Plans per member",
        body: (
          <>
            <p>
              Workspaces have the same four plans as people. Paid plans are billed per member seat: {TIER_NAMES.core} is {formatPrice(PRICES.core.month)}, {TIER_NAMES.pro} {formatPrice(PRICES.pro.month)} and {TIER_NAMES.pro_ai} {formatPrice(PRICES.pro_ai.month)} per member a month. The owner, admins and members each take a seat and get the plan’s storage and AI credits in the workspace. Guests and pending invitations are free.
            </p>
            <p>
              A new workspace starts on Free. On {TIER_NAMES.core}, nobody in the workspace can use AI. See <Link href="/pricing">pricing</Link>.
            </p>
          </>
        ),
      },
      {
        id: "separate",
        title: "Separate from your Personal",
        body: <p>A personal plan never upgrades a workspace, and a workspace plan never changes your Personal. Removing someone from a workspace doesn’t touch their Personal or their plan.</p>,
      },
      {
        id: "leaving",
        title: "When someone leaves",
        body: <p>Pages in a workspace belong to the workspace and stay when someone leaves. The owner can’t leave until they transfer ownership or delete the workspace. A deleted workspace is removed after 7 days, and the owner can cancel until then.</p>,
      },
    ],
    faq: [
      { q: "How much does a team workspace cost?", a: `A workspace can stay on Free. Paid plans are per member a month: Core ${formatPrice(PRICES.core.month)}, Pro ${formatPrice(PRICES.pro.month)} and Pro AI ${formatPrice(PRICES.pro_ai.month)}, or less when paid yearly.` },
      { q: "Do guests take a seat?", a: "No. Guests and pending invitations are free on every plan." },
      { q: "Does my personal plan upgrade the workspace?", a: "No. A workspace has its own plan, separate from anyone’s personal plan." },
      { q: "What happens to pages when someone leaves?", a: "They stay. Content in a workspace belongs to the workspace." },
      { q: "How much storage does a workspace get?", a: `On Free, a workspace shares its owner’s ${gb(STORAGE_BYTES.free)}. On paid plans each member gets their own: ${gb(STORAGE_BYTES.core)} on Core and Pro, ${gb(STORAGE_BYTES.pro_ai)} on Pro AI.` },
    ],
    related: ["sharing", "tasks", "ai-notes"],
  },
  {
    slug: "templates",
    name: "Templates",
    summary: `${TEMPLATE_COUNT} free templates, and any page can become your own.`,
    title: "Note templates: start from one or save your own",
    description: `Folevi has ${TEMPLATE_COUNT} free note templates, from meeting notes and 1:1s to travel plans and budgets. Start a page from one, or save any page as your own template.`,
    h1: "Note templates for meetings, plans and journals",
    intro: `Start a page from one of ${TEMPLATE_COUNT} built-in templates, or save a page you’ve made as your own. A template is a page like any other, with real headings, to-dos and tables to fill in.`,
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-01",
    visual: "templates",
    sections: [
      {
        id: "built-in",
        title: `${TEMPLATE_COUNT} built-in templates`,
        body: (
          <p>
            They cover everyday pages (a daily page, a weekly reset, a journal), work (meeting notes, 1:1s, a project brief, a decision record, a bug report), thinking and learning (reading, class and research notes), and life (a travel plan, a recipe, a budget). Browse them all in the <Link href="/template-gallery">template gallery</Link>.
          </p>
        ),
      },
      {
        id: "use",
        title: "Start a page from a template",
        body: <p>Open Templates in the sidebar and pick one under Built-in templates. Folevi creates a new page with the template’s name and blocks, ready to fill in.</p>,
      },
      {
        id: "own",
        title: "Save your own",
        body: <p>Choose Save as template from any page’s ••• menu, or create a new template from scratch. Your templates are listed under Your templates.</p>,
      },
      {
        id: "blocks",
        title: "Real blocks, ready to use",
        body: (
          <p>
            To-dos in a template are tasks, so they show up in Tasks, and in Today once they have a date. Tables, callouts and toggles work as they do anywhere else, and you can give the page a <Link href="/features/note-styles">note style</Link>.
          </p>
        ),
      },
    ],
    faq: [
      { q: "Are the templates free?", a: `Yes. All ${TEMPLATE_COUNT} built-in templates are included on every plan, including Free.` },
      { q: "Can I make my own template?", a: "Yes. Choose Save as template from a page’s ••• menu, or create a new template in Templates." },
      { q: "Where are templates in the app?", a: "Open Templates in the sidebar. Built-in templates are listed first, then your own." },
      { q: "Does changing a page change the template?", a: "No. A page made from a template is an ordinary page, so edits to it stay on that page." },
    ],
    related: ["tasks", "linked-notes", "note-styles"],
  },
  {
    slug: "import-and-export",
    name: "Import and export",
    summary: "Markdown, HTML and PDF export, a full ZIP, and Markdown import.",
    title: "Export notes to Markdown, HTML and PDF",
    description: "Export any Folevi page as Markdown, HTML or PDF, or everything in your Personal or a workspace as a ZIP. Import Markdown or text files, folders and ZIPs, with their images.",
    h1: "Export notes to Markdown, HTML and PDF, and import Markdown",
    intro: "Your notes should be easy to take anywhere. Folevi exports a single page or everything you have, and imports Markdown and plain text, on every plan.",
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-09",
    visual: "export",
    docs: { label: "Import and export", href: "/docs/import-and-export" },
    sections: [
      {
        id: "page",
        title: "Export a page",
        body: (
          <p>
            From a page’s ••• menu, export it as Markdown, HTML or PDF. PDF goes through your browser’s print dialog (Save as PDF), using the same clean HTML. Formulas become MathML in HTML and PDF, and flowcharts are written as Mermaid in Markdown.
          </p>
        ),
      },
      {
        id: "zip",
        title: "Export everything as a ZIP",
        body: (
          <p>
            In Settings → Import & export, download everything in your Personal as one ZIP. It holds every document as Markdown in folders that match your sidebar, the attachments in an assets folder, and a manifest.json that describes the folders, documents and files. Owners and admins can export a whole workspace the same way.
          </p>
        ),
      },
      {
        id: "import",
        title: "Import Markdown and text",
        body: (
          <p>
            Choose Markdown or text files (.md, .markdown or .txt), a ZIP, or a whole folder. Folevi turns them into blocks: headings, lists, checklists and the rest. Images the Markdown points to by a relative path are uploaded and become image blocks. Up to 50 documents go in one batch, and Folevi reports anything it couldn’t bring across.
          </p>
        ),
      },
      {
        id: "yours",
        title: "Nothing is locked in",
        body: <p>Export works on every plan, including Free. If you move to a smaller plan, your notes stay yours and you can still export all of them.</p>,
      },
    ],
    faq: [
      { q: "Can I export all my notes at once?", a: "Yes. Settings → Import & export downloads everything in your Personal as a ZIP of Markdown files with their attachments. Owners and admins can export a whole workspace." },
      { q: "Which formats can I export a page to?", a: "Markdown, HTML and PDF." },
      { q: "Which files can I import?", a: "Markdown and text files (.md, .markdown, .txt), a ZIP of them, or a folder. Images they point to by a relative path come along." },
      { q: "Is export available on the Free plan?", a: "Yes. Export is included on every plan." },
    ],
    related: ["security-and-privacy", "offline-notes", "linked-notes"],
  },
  {
    slug: "security-and-privacy",
    name: "Security and privacy",
    summary: "Verified email, two-step verification, private pages and no trackers.",
    title: "Private and secure notes app",
    description: "Folevi requires a verified email, offers two-step verification, encrypts data in transit and at rest, keeps pages private by default and loads no third-party trackers. It isn’t end-to-end encrypted.",
    h1: "Private notes, with plain answers about security",
    intro: "Here is what protects your account and your notes in Folevi today, and one thing it doesn’t do. The full details, with every subprocessor, are on the Security page.",
    plans: "Every plan, including Free.",
    updated: "2026-09-30",
    art: "art-01",
    visual: "security",
    docs: { label: "Account security", href: "/docs/account-security" },
    sections: [
      {
        id: "account",
        title: "Your account",
        body: (
          <ul>
            <li>You confirm your email address before you can open Folevi.</li>
            <li>Two-step verification with an authenticator app is optional, with 10 single-use backup codes and an option to trust a device for 30 days.</li>
            <li>Settings → Devices lists every browser and app signed in to your account, and signs any of them out at once.</li>
          </ul>
        ),
      },
      {
        id: "encryption",
        title: "Encryption, and what it doesn’t cover",
        body: (
          <p>
            Connections use TLS with HSTS, and stored data is encrypted at rest by our hosting providers. Folevi is <strong>not</strong> end-to-end encrypted: our servers can process your content so that search, sharing and sync work. See <Link href="/security#e2ee">why</Link>.
          </p>
        ),
      },
      {
        id: "staff",
        title: "Staff can’t browse your notes",
        body: <p>The admin tools have no content viewer, so Folevi staff can’t open your pages, blocks, comments or files from there.</p>,
      },
      {
        id: "trackers",
        title: "No trackers",
        body: <p>Folevi has no third-party analytics or trackers, and folevi.com loads no third-party scripts, advertising pixels or remote fonts.</p>,
      },
      {
        id: "leave",
        title: "Take everything, or leave",
        body: (
          <p>
            Export any page, or everything, whenever you like. Delete your account from Settings → Security; after a 7-day grace period it’s deleted for good. See <Link href="/features/import-and-export">import and export</Link>.
          </p>
        ),
      },
    ],
    faq: [
      { q: "Is Folevi end-to-end encrypted?", a: "No. Data is encrypted in transit and at rest, but our servers can process your content so that search, sharing and sync work." },
      { q: "Can Folevi staff read my notes?", a: "The admin tools have no way to open your pages, blocks, comments or files." },
      { q: "Does Folevi use trackers?", a: "No. Folevi has no third-party analytics or trackers, and folevi.com loads no third-party scripts, advertising pixels or remote fonts." },
      { q: "Does Folevi use my notes to train AI?", a: "No. Folevi doesn’t use your notes to train AI models, and neither does its AI provider." },
      { q: "How do I report a vulnerability?", a: "Email security@folevi.com. The Security page explains what to include." },
    ],
    related: ["sharing", "import-and-export", "ai-notes"],
  },
];

export const featurePath = (slug: string) => `/features/${slug}`;

export function featureBySlug(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug);
}
