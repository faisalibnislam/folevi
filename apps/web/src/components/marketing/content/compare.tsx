import Link from "next/link";
import type { ReactNode } from "react";
import { COVER_ART } from "@/lib/cover";
import { CREDIT_PACKS, MONTHLY_CREDITS, PLAN_CATALOG, PRICES, STORAGE_BYTES, TRIAL_DAYS, formatPrice, sizeLabel } from "@/lib/plans";
import { BUILT_IN_TEMPLATES } from "@/lib/templates";
import { IOS_REQUIREMENT, MAC_REQUIREMENT } from "@/components/marketing/site";

/*
 * Comparison pages (/compare/<slug>). Two kinds of fact live here:
 *
 * - Folevi's side comes only from this repository: prices and limits from the plan catalog
 *   (convex/lib/plans.ts), features from the feature pages and docs (content/features.tsx, content/docs.tsx)
 *   and docs/PRODUCT.md. Platforms are stated plainly: the Mac, iPhone and iPad apps (free with no account,
 *   in "Keep notes on my devices") and the web app (with a Folevi account). No Android or Windows app.
 * - The other product's side comes only from that company's own public pages. Every competitor fact names
 *   its sources (`sources` on the row, listed on the page with links) and the day it was checked
 *   (`checked`, YYYY-MM-DD). Anything that couldn't be confirmed on an official page is left out. No
 *   third-party reviews, ratings, rankings or user counts.
 *
 * Re-check every competitor fact when you change `checked`, and change `updated` with any edit to a page.
 * A source checked again on a later day says so (`src2`, RECHECKED), and the pages show the range of days.
 */

/** The day the competitor facts below were first checked against the company's own pages. */
export const COMPARE_CHECKED = "2026-09-30";
/** The day sources on the four focus pages (Obsidian and Notion) were checked again. */
const RECHECKED = "2026-11-06";

export type CompareSource = { id: string; title: string; url: string; checked: string };

type FoleviRowKey =
  | "price"
  | "account"
  | "files"
  | "monthly"
  | "yearly"
  | "teams"
  | "ai"
  | "offline"
  | "platforms"
  | "collaboration"
  | "publish"
  | "export"
  | "import"
  | "storage"
  | "encryption"
  | "templates"
  | "history";

export type CompareRow = {
  key: FoleviRowKey;
  /** The other product's value, as a plain sentence or phrase. */
  them: string;
  /** Ids of the sources (in `sources`) that support `them`. */
  sources: string[];
};

export type Section = { title: string; body: ReactNode };

export type Competitor = {
  slug: string;
  /** The product's name as its maker writes it. */
  name: string;
  /** Names for the trademark line ("Notion is a trademark of its owner."). */
  trademarks: string[];
  /** <title>, used as-is (it already names Folevi). */
  title: string;
  description: string;
  h1: string;
  /** Opening paragraph: fair to the other product, and who it's good for. */
  intro: string;
  /** One line for the /compare cards. */
  summary: string;
  updated: string;
  rows: CompareRow[];
  different: Section[];
  suitsBetter: Section[];
  switching: ReactNode;
  faq: Array<{ q: string; a: string }>;
  sources: CompareSource[];
};

const c = COMPARE_CHECKED;
const src = (id: string, title: string, url: string, checked: string = c): CompareSource => ({ id, title, url, checked });
/** A source checked again on RECHECKED. */
const src2 = (id: string, title: string, url: string): CompareSource => src(id, title, url, RECHECKED);
const gb = sizeLabel;
const credits = (n: number) => n.toLocaleString("en-US");
const STYLE_COUNT = COVER_ART.length;
const TEMPLATE_COUNT = BUILT_IN_TEMPLATES.length;
const VERSION_DAYS = PLAN_CATALOG.personal_free.entitlements.versionHistoryDays;
const FREE_DEVICES = PLAN_CATALOG.personal_free.entitlements.devices;
const p = (cents: number) => formatPrice(cents);

/** Folevi's column. Every value comes from the plan catalog or from what the app does today. */
export const FOLEVI_ROWS: Record<FoleviRowKey, { label: string; value: string }> = {
  price: {
    label: "Free plan",
    value: `The Mac, iPhone and iPad apps are free forever, with no account and no limit on notes. Folevi Cloud Free is $0, with ${gb(STORAGE_BYTES.free)} of storage, ${FREE_DEVICES} devices and AI during the ${TRIAL_DAYS}-day trial.`,
  },
  account: {
    label: "Use it without an account",
    value: "Yes, in the Mac, iPhone and iPad apps: choose Keep notes on my devices. The web app, sharing, workspaces and AI credits need a Folevi account.",
  },
  files: {
    label: "Where notes are stored",
    value: "Without an account: a folder of files (one per note, plus a small index) in a place you pick: iCloud Drive, Dropbox, Google Drive, any folder or only this device. Folevi’s servers never see them. With a Folevi account: on your devices and Folevi’s servers.",
  },
  monthly: { label: "Paid plans, monthly", value: `Core ${p(PRICES.core.month)}, Pro ${p(PRICES.pro.month)} and Pro AI ${p(PRICES.pro_ai.month)} a month` },
  yearly: { label: "Paid plans, yearly", value: `Core ${p(PRICES.core.year)}, Pro ${p(PRICES.pro.year)} and Pro AI ${p(PRICES.pro_ai.year)} a year` },
  teams: { label: "Teams", value: "Workspaces on the same four plans, priced per member. Guests are free." },
  ai: {
    label: "AI",
    value: `Without an account, Foli AI runs on Apple Intelligence on the Mac, or on your own OpenAI, Anthropic or Google key, sent straight from your device. With Folevi Cloud, it’s metered in credits: Pro ${MONTHLY_CREDITS.pro}, Pro AI ${MONTHLY_CREDITS.pro_ai} (fair use), Free only during the trial, Core none. Packs of ${credits(CREDIT_PACKS.credits_500.credits)} for ${p(CREDIT_PACKS.credits_500.priceCents)} or ${credits(CREDIT_PACKS.credits_1000.credits)} for ${p(CREDIT_PACKS.credits_1000.priceCents)}.`,
  },
  offline: { label: "Offline", value: "Yes. The Mac, iPhone and iPad apps work fully offline. In the browser, every edit is saved on the device first and syncs when you reconnect." },
  platforms: { label: "Apps", value: `Mac (${MAC_REQUIREMENT}), iPhone and iPad (${IOS_REQUIREMENT}), and the web app in any modern browser, with a Folevi account. No Android or Windows app.` },
  collaboration: { label: "Working together", value: "Workspaces with roles, guests, comments and mentions. If two people change the same block at once, Folevi shows a conflict to resolve." },
  publish: { label: "Public sharing", value: "Public links with an optional password and expiry date, revocable at any time" },
  export: { label: "Export", value: "A page as Markdown, HTML or PDF (through print). Everything as a ZIP of Markdown files." },
  import: { label: "Import", value: "Markdown and text files, folders and ZIPs, with their images" },
  storage: { label: "Storage", value: `${gb(STORAGE_BYTES.free)} on Free, ${gb(STORAGE_BYTES.core)} on Core and Pro, ${gb(STORAGE_BYTES.pro_ai)} on Pro AI. Files up to 50 MB.` },
  encryption: {
    label: "Encryption",
    value: "Encrypted in transit and at rest, and end-to-end encrypted when you turn it on in Settings → Privacy, on every plan. Without an account, you can encrypt the synced copy of your notes with a passphrase only you know.",
  },
  templates: { label: "Templates", value: `${TEMPLATE_COUNT} built-in templates, plus your own` },
  history: { label: "Version history", value: `${VERSION_DAYS} days on every plan` },
};

/** Differences that hold against every product on these pages. Each page picks the ones that apply. */
const diff = {
  offline: (them: string): Section => ({
    title: "Offline first, in the browser too",
    body: (
      <p>
        Folevi writes every edit to your device before it sends it anywhere, and that includes the web app. The page says <strong>Saved</strong> only once the server has confirmed every change. With no connection you keep writing, and the status counts the edits waiting on this device. {them} See{" "}
        <Link href="/features/offline-notes">offline notes</Link>.
      </p>
    ),
  }),
  styles: {
    title: "Note themes with artwork",
    body: (
      <p>
        Each page can take one of {STYLE_COUNT} artwork themes, or your own image, and the theme colours the cover, the paper and the text. The app around it stays plain white, or near-black in dark mode. See <Link href="/features/note-themes">note themes</Link>.
      </p>
    ),
  } satisfies Section,
  core: {
    title: "A plan with no AI",
    body: (
      <p>
        Core costs {p(PRICES.core.month)} a month or {p(PRICES.core.year)} a year and has no AI at all. The server refuses every AI request in a Core space, so nothing there is sent to an AI model. It’s for people and teams who want notes without AI and don’t want to pay for it. More in{" "}
        <Link href="/blog/why-folevi-has-a-plan-with-no-ai">why Folevi has a plan with no AI</Link>.
      </p>
    ),
  } satisfies Section,
  credits: {
    title: "AI counted in credits",
    body: (
      <p>
        One AI credit is one cent of what the AI costs Folevi to run. Rewriting a paragraph uses about 1 credit, a question to Foli AI about 2 and a flowchart 3 to 5. Settings shows what’s left this month and when it resets. See{" "}
        <Link href="/blog/what-an-ai-credit-is">what an AI credit is</Link>.
      </p>
    ),
  } satisfies Section,
  tasks: {
    title: "Tasks inside your notes",
    body: (
      <p>
        Every to-do in a page is a task. Give it a date and it shows up in Today and on the calendar, and ticking it off there ticks it off in the note. See <Link href="/features/tasks">tasks</Link>.
      </p>
    ),
  } satisfies Section,
};

/** The free apps, in the sections where they make the difference. */
const apps = {
  noAccount: {
    title: "Free forever, with no account",
    body: (
      <p>
        Open the Mac, iPhone or iPad app and choose <strong>Keep notes on my devices</strong>. There is no sign-up and no limit on notes, and it works fully offline. Sharing, public pages, comments with others, workspaces, the web app and AI credits need a Folevi account, and you can add one later. See the{" "}
        <Link href="/pricing">pricing</Link>.
      </p>
    ),
  } satisfies Section,
  files: {
    title: "Your notes stay your files",
    body: (
      <p>
        Without an account, your library is a folder of files, one per note plus a small index, in a place you pick: iCloud Drive (so it syncs across your iPhone, iPad and Mac), Dropbox, Google Drive, any folder or only this device. Folevi’s servers never see it. You can lock the app with Face ID or Touch ID, and encrypt the synced copy with a passphrase only you know.
      </p>
    ),
  } satisfies Section,
  privateAi: {
    title: "Foli AI that stays between you and the model",
    body: (
      <p>
        Without an account, Foli AI on the Mac can run on Apple Intelligence, and on any of the apps it can use your own OpenAI, Anthropic or Google key. Your notes go straight from your device to the model, never through Folevi. See <Link href="/foli-ai">Foli AI</Link>.
      </p>
    ),
  } satisfies Section,
};

/** Said plainly wherever apps are compared. */
const PLATFORMS_HONEST = `Folevi has apps for Mac (${MAC_REQUIREMENT}) and for iPhone and iPad (${IOS_REQUIREMENT}), and a web app for any modern browser. There is no Android or Windows app.`;

const importSteps = (exportStep: ReactNode) => (
  <>
    <p>Folevi imports Markdown and plain text. The way across is to export your notes as Markdown, then import the files.</p>
    <ol>
      <li>{exportStep}</li>
      <li>
        In Folevi, open Settings → Import & export and choose the files, the folder or a ZIP of them. Images the Markdown points to by a relative path (PNG, JPEG, GIF or WebP) are uploaded and become image blocks.
      </li>
      <li>Folevi imports up to 50 documents at a time and lists anything it couldn’t bring across. The new pages land in Drafts, where you can file them.</li>
    </ol>
  </>
);

export const COMPETITORS: Competitor[] = [
  {
    slug: "notion",
    name: "Notion",
    trademarks: ["Notion"],
    title: "Folevi vs Notion: a workspace with free Mac and iPhone apps",
    description: "A Notion alternative workspace: docs, tasks and databases, plus free native Mac, iPhone and iPad apps that work offline with no account. Every fact sourced.",
    h1: "Folevi vs Notion",
    intro:
      "Notion is a workspace for documents, wikis, databases and projects, with apps on every major platform and a large set of integrations. It suits teams that run their work from linked databases. Folevi is a workspace too: block documents and pages inside pages, tasks with a calendar, and databases you can see as a table, a gallery or a kanban board, with formulas. Its native Mac, iPhone and iPad apps are free forever with no account and work fully offline. Folevi Cloud adds the web app, team workspaces, comments and guests when you want them.",
    summary: "Deep team databases, or a workspace with free native apps.",
    updated: "2026-11-06",
    rows: [
      { key: "price", them: "$0. File uploads up to 5 MB each. Up to 10 guests.", sources: ["pricing"] },
      { key: "account", them: "No. You sign in with a Notion account, in the mobile apps too.", sources: ["login", "mobilehelp"] },
      { key: "monthly", them: "Plus $12 and Business $24 per member a month. Enterprise: contact sales.", sources: ["pricing"] },
      { key: "yearly", them: "Plus $10 and Business $20 per member a month, billed yearly", sources: ["pricing"] },
      { key: "ai", them: "A trial of Notion AI on Free and Plus. Notion AI included on Business and Enterprise. Extra usage and Custom Agents use Notion credits, $10 per 1,000 a month.", sources: ["pricing", "credits"] },
      { key: "offline", them: "In the desktop and mobile apps. On Free you pick pages to download; paid plans also download recent and favourite pages.", sources: ["offline", "pricing"] },
      { key: "platforms", them: "Web, Mac, Windows, iOS and Android", sources: ["desktop", "mobile", "web"] },
      { key: "collaboration", them: "Shared pages with presence, comments, guests and permission levels from Full access to Can view", sources: ["sharing"] },
      { key: "publish", them: "Publish pages to the web. Custom domains cost $8 a month per domain, billed yearly.", sources: ["pricing", "sharing"] },
      { key: "export", them: "A page as PDF, HTML or Markdown (CSV for databases). A whole workspace as HTML, Markdown or CSV.", sources: ["export"] },
      { key: "import", them: "Text, Markdown, Word, CSV, HTML, PDF and ZIP files, and apps including Evernote, Trello and Google Docs", sources: ["import"] },
      { key: "storage", them: "Free: files up to 5 MB each. Paid plans: unlimited uploads, up to about 5 GB per file.", sources: ["pricing"] },
      { key: "encryption", them: "Encrypted at rest (AES-256) and in transit (TLS 1.2 or later)", sources: ["security"] },
      { key: "templates", them: "A gallery of free and paid templates", sources: ["templates"] },
      { key: "history", them: "7 days on Free, 30 on Plus, 90 on Business, unlimited on Enterprise", sources: ["pricing"] },
    ],
    different: [
      {
        title: "A workspace with nothing to set up first",
        body: (
          <p>
            Folevi has docs, wikis, tasks and databases in one place: block documents, pages inside pages, tasks on a calendar, and collections you can see as a table, a gallery or a kanban board, with formulas. It starts with a blank page, not a setup, and the Mac, iPhone and iPad apps are native, so they start quickly and feel at home on each device. See <Link href="/features/blocks">blocks</Link>.
          </p>
        ),
      },
      apps.noAccount,
      {
        title: "Fully offline, on every device",
        body: (
          <p>
            Without an account, every note lives on your device, so the apps work the same with or without a connection. With Folevi Cloud, every edit is saved on the device first, in the web app too. Notion’s offline mode is in its desktop and mobile apps, for pages you download. See <Link href="/features/offline-notes">offline notes</Link>.
          </p>
        ),
      },
      apps.files,
      diff.core,
      {
        title: "Lower prices",
        body: (
          <p>
            The apps are free with no account. Folevi Cloud’s paid plans are {p(PRICES.core.month)}, {p(PRICES.pro.month)} and {p(PRICES.pro_ai.month)} a month, and a workspace pays the same per member. Guests are free on every plan. On 30 September 2026, Notion’s Plus plan was $12 per member a month, or $10 billed yearly.
          </p>
        ),
      },
      diff.styles,
    ],
    suitsBetter: [
      { title: "You need Windows or Android apps", body: <p>Notion has apps for Mac, Windows, iOS and Android. {PLATFORMS_HONEST}</p> },
      {
        title: "Your work runs on databases",
        body: <p>Notion’s databases have custom properties, dependencies, charts, forms and automations, and it connects to other tools through an API, webhooks and syncs. Folevi has collections (a table, a gallery, a kanban board or a calendar of pages, with formulas), which are much simpler.</p>,
      },
      { title: "You type in the same paragraph as your colleagues", body: <p>Folevi syncs block by block. If two people change the same paragraph at once, Folevi shows a conflict and keeps both versions until someone chooses. It doesn’t merge edits character by character yet.</p> },
      { title: "You need enterprise controls", body: <p>Notion lists SAML single sign-on on Business, and SCIM and an audit log on Enterprise. Folevi has none of these today.</p> },
    ],
    switching: importSteps(
      <>
        In Notion, export a page, or your whole workspace, as Markdown. Notion gives you a ZIP. Databases come out as CSV files, which Folevi doesn’t import.
      </>,
    ),
    faq: [
      { q: "Can Folevi replace Notion?", a: "For docs, team wikis, tasks, simple databases and shared workspaces, yes. If you rely on Notion’s databases, automations, integrations or Windows and Android apps, Folevi doesn’t have those." },
      { q: "Can I use Folevi without an account?", a: "Yes. In the Mac, iPhone and iPad apps, choose Keep notes on my devices. It’s free forever, and your notes are files in a place you pick, such as iCloud Drive. Notion needs an account." },
      { q: "Does Folevi work offline?", a: "Yes. The Mac, iPhone and iPad apps work fully offline. In the browser, every edit is saved on the device first and syncs when you reconnect." },
      { q: "Can I import my Notion pages?", a: "Yes, as Markdown. Export from Notion as Markdown, then import the ZIP in Settings → Import & export. Databases export as CSV, which Folevi doesn’t import." },
      { q: "Does Folevi have mobile apps?", a: `Yes, for iPhone and iPad (${IOS_REQUIREMENT}), on the App Store. There is no Android app.` },
      { q: "How much does Folevi cost compared with Notion?", a: `The apps are free with no account. Folevi Cloud’s paid plans are ${p(PRICES.core.month)}, ${p(PRICES.pro.month)} and ${p(PRICES.pro_ai.month)} a month, per member in a workspace. On 30 September 2026, Notion’s website listed Plus at $12 and Business at $24 per member a month, or $10 and $20 billed yearly.` },
    ],
    sources: [
      src2("login", "Notion Help: Log in and out of Notion", "https://www.notion.com/help/log-in-and-out"),
      src2("mobilehelp", "Notion Help: Notion for mobile", "https://www.notion.com/help/notion-for-mobile"),
      src("pricing", "Notion: Pricing", "https://www.notion.com/pricing"),
      src("credits", "Notion Help: What are Notion credits?", "https://www.notion.com/help/what-are-notion-credits"),
      src("offline", "Notion Help: Working offline in Notion", "https://www.notion.com/help/guides/working-offline-in-notion-everything-you-need-to-know"),
      src("desktop", "Notion: Desktop app", "https://www.notion.com/desktop"),
      src("mobile", "Notion: Mobile app", "https://www.notion.com/mobile"),
      src("web", "Notion Help: Notion for web", "https://www.notion.com/help/notion-for-web"),
      src("sharing", "Notion Help: Sharing and permissions", "https://www.notion.com/help/sharing-and-permissions"),
      src("export", "Notion Help: Export your content", "https://www.notion.com/help/export-your-content"),
      src("import", "Notion Help: Import data into Notion", "https://www.notion.com/help/import-data-into-notion"),
      src("security", "Notion Help: Security and privacy", "https://www.notion.com/help/security-and-privacy"),
      src("templates", "Notion: Templates", "https://www.notion.com/templates"),
    ],
  },
  {
    slug: "obsidian",
    name: "Obsidian",
    trademarks: ["Obsidian"],
    title: "Folevi vs Obsidian: a linked workspace that stays your files",
    description: "An Obsidian alternative: linked notes, tasks and databases as files you own, in native Mac, iPhone and iPad apps. Free, no account, no plugins. Sourced.",
    h1: "Folevi vs Obsidian",
    intro:
      "Obsidian keeps your notes as Markdown files in a folder on your own device, and it’s free to use. It has apps for desktop and mobile, a large library of community plugins and themes, and paid add-ons for sync and publishing. It suits people who want to shape the app themselves. Folevi is a workspace that also keeps your pages as files you own, in a folder you pick: linked notes, tasks and databases, in a native app for Mac, iPhone and iPad that is ready the moment you open it. It’s free with no account, and syncs through iCloud Drive, Dropbox or Google Drive.",
    summary: "A linked workspace as your own files, ready when you open it.",
    updated: "2026-11-06",
    rows: [
      { key: "price", them: "The app is free, including for work. A commercial licence is optional, at $50 per user a year.", sources: ["license", "pricing"] },
      { key: "account", them: "Yes. Obsidian’s pricing page says no sign-up is required.", sources: ["pricing"] },
      { key: "files", them: "Markdown files in a folder (a vault) on your device, wherever you create it", sources: ["storage"] },
      { key: "monthly", them: "Sync: Standard $5 or Plus $10 per user a month. Publish: $10 per site a month.", sources: ["sync", "publish"] },
      { key: "yearly", them: "Sync: Standard $4 or Plus $8 per user a month, billed yearly. Publish: $8 per site a month, billed yearly.", sources: ["pricing", "sync", "publish"] },
      { key: "ai", them: "No AI assistant among the app’s core plugins. The Web Clipper’s Interpreter can use a language model with your own API key.", sources: ["plugins", "interpreter"] },
      { key: "offline", them: "Yes. Notes are Markdown files in a folder on your device.", sources: ["storage"] },
      { key: "platforms", them: "Mac, Windows, Linux, iOS and Android", sources: ["download"] },
      { key: "collaboration", them: "Shared vaults through Sync, up to 20 collaborators, each with a Sync subscription", sources: ["collaborate"] },
      { key: "publish", them: "Obsidian Publish turns notes into a website, with a custom domain", sources: ["publish"] },
      { key: "export", them: "Notes are already Markdown files. Canvas files use the open JSON Canvas format.", sources: ["storage", "canvas"] },
      { key: "import", them: "The Importer plugin: Notion, Evernote, Apple Notes, Bear, Craft, OneNote, Google Keep and more", sources: ["import"] },
      { key: "storage", them: "Sync Standard: 1 GB, 5 MB per file. Sync Plus: 10 GB to 100 GB, 200 MB per file.", sources: ["syncplans"] },
      { key: "encryption", them: "Sync is end-to-end encrypted (AES-256) by default", sources: ["syncsecurity"] },
      { key: "templates", them: "A Templates core plugin that inserts saved snippets into a note", sources: ["templates"] },
      { key: "history", them: "With Sync: 1 month on Standard, 12 months on Plus", sources: ["syncplans"] },
    ],
    different: [
      {
        title: "Files you own, in a native app",
        body: (
          <p>
            Without an account, your Folevi library is a folder of files, one per note plus a small index, in iCloud Drive, Dropbox, Google Drive or any folder you pick. The Mac, iPhone and iPad apps are native, ready the moment you open them, with linked notes, tasks, databases and themes built in. There is nothing to install or configure first.
          </p>
        ),
      },
      {
        title: "Sync through the cloud you already have",
        body: (
          <p>
            Put the library in iCloud Drive and it syncs across your iPhone, iPad and Mac at no cost, or use Dropbox or Google Drive. Folevi’s servers never see it. With Obsidian, its own Sync is a paid add-on. If you want sharing and team workspaces, Folevi Cloud has them on every plan, including Free.
          </p>
        ),
      },
      apps.privateAi,
      diff.tasks,
      diff.styles,
    ],
    suitsBetter: [
      { title: "You want plain Markdown files", body: <p>Obsidian’s vault is a folder of Markdown files that any text editor can open. Folevi’s library is a folder of files too, in Folevi’s own format, and it exports pages as Markdown, HTML or PDF.</p> },
      { title: "You want to shape the app", body: <p>Obsidian has thousands of community plugins and themes, and Canvas. Folevi has no plugins.</p> },
      { title: "You need Windows, Linux or Android apps", body: <p>Obsidian has apps for Mac, Windows, Linux, iOS and Android. {PLATFORMS_HONEST}</p> },
      { title: "You want end-to-end encrypted sync as a service", body: <p>Obsidian Sync is end-to-end encrypted by default. In Folevi Cloud, end-to-end encryption is a choice you turn on in Settings → Privacy. Without an account, you can encrypt Folevi’s synced copy with your own passphrase.</p> },
    ],
    switching: (
      <>
        {importSteps(<>Your Obsidian vault is already a folder of Markdown files. Choose the folder, or a ZIP of it.</>)}
        <p>
          Two things don’t carry over. Wiki links written as [[Page]] come in as plain text, so relink them with [[ in Folevi. Images embedded with Obsidian’s ![[image.png]] syntax also stay as text; standard Markdown image links come in as images.
        </p>
      </>
    ),
    faq: [
      { q: "Is Folevi an Obsidian alternative?", a: "It is if you want linked notes, tasks and databases that are files you own, in a native app for Mac, iPhone and iPad that is ready when you open it, with no plugins to set up. If you want plain Markdown files and community plugins, Obsidian does that and Folevi doesn’t." },
      { q: "Do I need an account to use Folevi?", a: "No. In the Mac, iPhone and iPad apps, choose Keep notes on my devices. It’s free forever, like Obsidian, and your notes stay in a folder you pick." },
      { q: "Can I import my Obsidian vault?", a: "Yes. Choose the vault folder, or a ZIP of it, in Settings → Import & export. Wiki links come in as plain text." },
      { q: "Does Folevi have backlinks?", a: "Yes. Type [[ to link a page. The linked page lists every page that links to it, with a line of text around each link." },
      { q: "Does Folevi have mobile apps?", a: `Yes, for iPhone and iPad (${IOS_REQUIREMENT}), on the App Store. There is no Android app.` },
      { q: "Is Folevi end-to-end encrypted?", a: "Yes, when you turn it on. Folevi Cloud is end-to-end encrypted when you turn it on in Settings → Privacy, on every plan, and you choose which features may still read your notes. Without an account, Folevi’s servers never see your notes, and you can encrypt the synced copy with a passphrase." },
    ],
    sources: [
      src("license", "Obsidian: License", "https://obsidian.md/license"),
      src2("pricing", "Obsidian: Pricing", "https://obsidian.md/pricing"),
      src("sync", "Obsidian: Sync", "https://obsidian.md/sync"),
      src("publish", "Obsidian: Publish", "https://obsidian.md/publish"),
      src("plugins", "Obsidian Help: Core plugins", "https://obsidian.md/help/plugins"),
      src("interpreter", "Obsidian Help: Web Clipper Interpreter", "https://obsidian.md/help/web-clipper/interpreter"),
      src2("storage", "Obsidian Help: How Obsidian stores data", "https://obsidian.md/help/data-storage"),
      src("download", "Obsidian: Download", "https://obsidian.md/download"),
      src("collaborate", "Obsidian Help: Collaborate on a shared vault", "https://obsidian.md/help/sync/collaborate"),
      src("canvas", "Obsidian Help: Canvas", "https://obsidian.md/help/plugins/canvas"),
      src("import", "Obsidian Help: Import notes", "https://obsidian.md/help/import"),
      src("syncplans", "Obsidian Help: Sync plans and storage", "https://obsidian.md/help/sync/plans"),
      src("syncsecurity", "Obsidian Help: Sync security and privacy", "https://obsidian.md/help/sync/security"),
      src("templates", "Obsidian Help: Templates", "https://obsidian.md/help/plugins/templates"),
    ],
  },
];

export const comparePath = (slug: string) => `/compare/${slug}`;

export function competitorBySlug(slug: string): Competitor | undefined {
  return COMPETITORS.find((x) => x.slug === slug);
}

/** The first and last day a set of sources was checked (the same day when they were all checked at once). */
export function checkedRange(sources: CompareSource[]): { first: string; last: string } {
  const days = sources.map((s) => s.checked).sort();
  return { first: days[0] ?? COMPARE_CHECKED, last: days[days.length - 1] ?? COMPARE_CHECKED };
}

/** The most recent day any competitor fact was checked. */
export const COMPARE_LAST_CHECKED = checkedRange(COMPETITORS.flatMap((x) => x.sources)).last;

/** "Notion is a trademark of its owner." / "Apple, Apple Notes and iCloud are trademarks of their owners." */
export function trademarkLine(names: string[]): string {
  if (names.length === 1) return `${names[0]} is a trademark of its owner.`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are trademarks of their owners.`;
}

/** The trial, for the closing panel. */
export const TRIAL_LINE = `The Free plan has no time limit. New accounts get Pro AI free for ${TRIAL_DAYS} days, with no card.`;
