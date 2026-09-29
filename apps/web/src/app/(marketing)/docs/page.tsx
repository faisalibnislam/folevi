import Link from "next/link";
import { DocShell } from "@/components/marketing/DocShell";
import { ShortcutTable } from "@/components/marketing/mac/ShortcutTable";
import { pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL, SIGN_UP_URL } from "@/components/marketing/site";
import { PageHeader } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Documentation",
  description:
    "Getting started with Folevi: keyboard shortcuts, blocks and slash commands, tasks and calendar, sync and offline status, sharing and permissions, import and export, and account security.",
  path: "/docs",
});

const toc = [
  { id: "getting-started", label: "Getting started" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
  { id: "blocks", label: "Blocks & slash commands" },
  { id: "tasks", label: "Tasks & calendar" },
  { id: "sync", label: "Sync & offline" },
  { id: "sharing", label: "Sharing & permissions" },
  { id: "import-export", label: "Import & export" },
  { id: "account-security", label: "Account security" },
];

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
  ["Bookmark", "A link preview card for a web page."],
  ["Page", "A sub-page, shown as a link or as a card."],
];

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Documentation"
        title="How Folevi works."
        lede="The essentials in one place. If something here doesn’t match what you see in the app, tell us — the docs should never be wrong."
      />
      <DocShell toc={toc}>
        <h2 id="getting-started">Getting started</h2>
        <ol>
          <li>
            <a href={SIGN_UP_URL}>Create an account</a> and confirm your email address.
          </li>
          <li>Your Personal space opens — it’s just yours. Create a page with the New page button (or ⌘N in the Mac app) and start typing. To work with a team, create a workspace from the menu at the bottom of the sidebar and switch between Personal and your workspaces there.</li>
          <li>
            Type <code>/</code> on any line to turn it into a heading, checklist, quote or any other block.
          </li>
          <li>
            Link pages together with <code>[[</code>, and find anything later with <code>⌘K</code>.
          </li>
        </ol>
        <p>
          Loose notes can live in <strong>Drafts</strong> until you decide where they belong. Pages can be nested inside
          other pages, filed in folders, tagged and starred.
        </p>

        <h2 id="shortcuts">Keyboard shortcuts</h2>
        <p>
          These shortcuts work in the Mac app. On the web, most work the same way; shortcuts your browser reserves for itself
          — such as <code>⌘N</code> for a new browser window — are left to the browser.
        </p>
        <div className="mk-card rounded-[22px] p-5 sm:p-6">
          <ShortcutTable caption="Folevi keyboard shortcuts" />
        </div>

        <h2 id="blocks">Blocks & slash commands</h2>
        <p>
          Every paragraph in Folevi is a block. Type <code>/</code> at the start of a line to open the block menu, keep typing
          to filter it (for example <code>/check</code>), then press Return. Use the handle beside a block to drag it, or{" "}
          <code>⌥⇧↑</code> and <code>⌥⇧↓</code> to move it. Nested blocks move with their parent.
        </p>
        <div className="mk-table-card overflow-x-auto" role="region" aria-label="Block types table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col">What it’s for</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map(([name, body]) => (
                <tr key={name}>
                  <th scope="row" className="whitespace-nowrap font-medium text-ink">
                    {name}
                  </th>
                  <td>{body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Inside a block you can use bold, italic, underline, strikethrough, inline code, links, text colours and highlights,
          and insert dates, mentions and links to other pages.
        </p>
        <h3>Page style</h3>
        <p>
          Each page can have its own type (sans, serif or mono), width (narrow, default or wide), background (paper, plain,
          tinted or grid) and accent colour, plus a cover and an icon. Find them in the inspector.
        </p>

        <h2 id="tasks">Tasks & calendar</h2>
        <p>
          Any checklist item is a task. Give it a due date — and optionally a time and a priority — and it appears in
          <strong> Today</strong> on that day, and in <strong>Tasks</strong> alongside every other open task in your
          Personal (or the workspace you’re in). Overdue tasks show up there too, so nothing slips quietly past.
        </p>
        <p>
          The <strong>Calendar</strong> shows dated tasks by day. <strong>Quick Add</strong> (⇧⌘A) saves a task straight into
          your <strong>Inbox</strong> page, so it always lives somewhere you can find it.
        </p>

        <h2 id="sync">Sync & offline</h2>
        <p>
          Folevi saves every change on your device first, then syncs it. On the web, your notes are kept in the browser’s
          storage; on the Mac, in a local database. You can keep writing with no connection at all.
        </p>
        <p>Each page shows one of these statuses:</p>
        <div className="mk-table-card overflow-x-auto" role="region" aria-label="Sync statuses table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Saved</th>
                <td>Everything has reached our servers and been confirmed. Folevi never shows Saved before that.</td>
              </tr>
              <tr>
                <th scope="row">Saving</th>
                <td>You’re online and recent edits are on their way.</td>
              </tr>
              <tr>
                <th scope="row">Offline</th>
                <td>No connection. Edits are stored on this device, with a count of how many are waiting.</td>
              </tr>
              <tr>
                <th scope="row">Syncing</th>
                <td>You’ve reconnected; Folevi is fetching changes from other devices and sending yours.</td>
              </tr>
              <tr>
                <th scope="row">Conflict</th>
                <td>
                  The same block was changed in two places. Folevi keeps both versions — nothing is thrown away — and shows you
                  the conflict so you can decide.
                </td>
              </tr>
              <tr>
                <th scope="row">Error</th>
                <td>A change couldn’t be applied, or syncing failed repeatedly. Open the status for details and a retry button.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Version snapshots are taken automatically as you work, so you can go back to an earlier state of a page.
        </p>

        <h2 id="sharing">Sharing & permissions</h2>
        <p>Pages in your Personal are private to you, and pages in a workspace are open to its members, by default. From a page’s Share menu you can:</p>
        <ul>
          <li>
            <strong>Restrict a page</strong> so only the people you add can open it.
          </li>
          <li>
            <strong>Share with people by email</strong>: they can view, comment or edit. People without a Folevi account get an invitation to accept first; people outside a workspace join that page as guests, who aren’t billed. They get an
            email and find the page under Shared.
          </li>
          <li>
            <strong>Create a public link</strong> for anyone with the URL. You can set an expiry date, require a password of
            at least 8 characters, and revoke the link at any time — it stops working immediately.
          </li>
        </ul>

        <h2 id="import-export">Import & export</h2>
        <h3>Import</h3>
        <p>Bring in Markdown or plain text, and Folevi turns it into blocks — headings, lists, checklists and all.</p>
        <h3>Export</h3>
        <ul>
          <li>Any page as Markdown, HTML or PDF.</li>
          <li>Everything in your Personal, or in a workspace, as a ZIP archive.</li>
        </ul>
        <p>Exports are yours to keep. Nothing in Folevi is locked to Folevi.</p>

        <h2 id="account-security">Account security</h2>
        <ul>
          <li>Email verification is required before you can open Folevi.</li>
          <li>Two-step verification with an authenticator app (TOTP) is optional; turn it on in Settings → Security.</li>
          <li>
            When you set up two-step verification you receive one-time recovery codes. Each works once. Store them somewhere
            safe, away from your password.
          </li>
          <li>You can delete your account at any time. After a 7-day grace period, it is deleted permanently.</li>
        </ul>
        <p>
          The full picture — encryption, what staff can and can’t see, and our subprocessors — is on the{" "}
          <Link href="/security">Security</Link> page. To report a vulnerability, email{" "}
          <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>.
        </p>
      </DocShell>
    </>
  );
}
