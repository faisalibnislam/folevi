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
/** The day sources on the four focus pages (Craft, Obsidian, Notion, Evernote) were checked again. */
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
    value: "Folevi Cloud: encrypted in transit and at rest, not end-to-end encrypted. Without an account, you can encrypt the synced copy of your notes with a passphrase only you know.",
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
    title: "Folevi vs Notion: a calm notes app for Mac, iPhone and iPad",
    description: "A Notion alternative for one person: native on Mac, iPhone and iPad, fully offline, free with no account. Compared on price, AI, apps and export, with sources.",
    h1: "Folevi vs Notion",
    intro:
      "Notion is a workspace for documents, wikis, databases and projects, with apps on every major platform and a large set of integrations. It suits teams that run their work from linked databases. Folevi is a calm notes app for one person: native on Mac, iPhone and iPad, fully offline, and free forever with no account. Folevi Cloud adds the web app, sharing and workspaces when you want them.",
    summary: "Team databases, or calm notes on your Apple devices.",
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
        title: "A calm notes app for one person",
        body: (
          <p>
            Folevi is pages, tasks and linked notes, with nothing to set up first. It opens to your notes, not to a workspace, and the Mac, iPhone and iPad apps are native, so they start quickly and feel at home on each device.
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
        body: <p>Notion’s databases have custom properties, dependencies, charts, forms and automations, and it connects to other tools through an API, webhooks and syncs. Folevi has collections (a table, a gallery or a board of pages), which are much simpler.</p>,
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
      { q: "Can Folevi replace Notion?", a: "For your own notes, documents, tasks and linked pages, yes. If you rely on Notion’s databases, automations, integrations or Windows and Android apps, Folevi doesn’t have those." },
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
    slug: "craft",
    name: "Craft",
    trademarks: ["Craft"],
    title: "Folevi vs Craft: beautiful notes with no block limit",
    description: "A Craft alternative with the same care for design: no block limit, free with no account on Mac, iPhone and iPad, and your notes stay your files. Sourced.",
    h1: "Folevi vs Craft",
    intro:
      "Craft is a documents and notes app with native apps for Apple devices, Windows and Android, plus a web app. It includes tasks, a calendar, whiteboards and publishing, and suits people who want designed documents on many devices. Folevi takes the same care with design, in native apps for Mac, iPhone and iPad that are free with no account and no block limit, and your notes stay files in a folder you pick.",
    summary: "The same care for design, no block limit, your own files.",
    updated: "2026-11-06",
    rows: [
      { key: "price", them: "$0, with 1,500 blocks, 1 GB of storage, 25 MB per upload and about 20 AI sessions in all", sources: ["pricing"] },
      { key: "account", them: "Craft’s help says to get started by creating an account, with email, Apple ID or Google", sources: ["account"] },
      { key: "monthly", them: "Plus $10 a month. Family (up to 6 accounts) $18 a month. Team $6 per member a month.", sources: ["plans"] },
      { key: "yearly", them: "Plus $96, Family $180 and Team $60 per member a year. On 6 November 2026 the pricing page showed yearly Plus and Family with 20% off.", sources: ["plans", "pricing"] },
      { key: "teams", them: "Family is a fixed price for up to 6 accounts. Team is priced per member, with at least 3.", sources: ["pricing", "plans"] },
      { key: "ai", them: "About 20 AI sessions in all on Free, about 250 to 500 a year on Plus, top-ups from $10. On-device models on Mac, iPad and iPhone are free, and you can use your own OpenAI or Anthropic key.", sources: ["pricing", "ai"] },
      { key: "offline", them: "On every platform. On the web, Windows and Android you turn it on in Settings, and only documents you’ve opened are stored.", sources: ["offline"] },
      { key: "platforms", them: "Mac, iPhone, iPad, Apple Vision Pro, Windows, Android and web", sources: ["platforms"] },
      { key: "collaboration", them: "Real-time editing with viewers and editors, and comments. Shared spaces need a Family or Team plan.", sources: ["share", "pricing"] },
      { key: "publish", them: "Link sharing and published pages on every plan. Password, expiry and search indexing from Plus.", sources: ["pricing", "share"] },
      { key: "export", them: "PDF, Word, image, Markdown and TextBundle. Bulk export on Mac and iPad.", sources: ["export"] },
      { key: "import", them: "Markdown and TextBundle files, with guides for Notion, Evernote, Apple Notes and others", sources: ["import"] },
      { key: "storage", them: "Free: 1 GB, and 25 MB per upload", sources: ["pricing"] },
      { key: "encryption", them: "Encrypted in transit and at rest. Craft says it doesn’t use end-to-end encryption.", sources: ["e2ee"] },
      { key: "templates", them: "A built-in template gallery, plus your own", sources: ["templates"] },
      { key: "history", them: "7 days on Free, 30 days on Plus", sources: ["pricing"] },
    ],
    different: [
      {
        title: "The same care for design, with no block limit",
        body: (
          <p>
            Each page can take one of {STYLE_COUNT} artwork themes, or your own image, and the theme colours the cover, the paper and the text. The free apps have no limit on notes or blocks. Craft’s free plan stops at 1,500 blocks across all your documents. See <Link href="/features/note-themes">note themes</Link>.
          </p>
        ),
      },
      apps.files,
      apps.noAccount,
      apps.privateAi,
      diff.core,
    ],
    suitsBetter: [
      { title: "You want apps beyond Apple devices", body: <p>Craft has apps for Mac, iPhone, iPad, Vision Pro, Windows and Android. {PLATFORMS_HONEST}</p> },
      { title: "You publish documents as websites", body: <p>Craft publishes documents to the web on every plan, and Plus adds passwords, expiry dates and search indexing. Folevi Cloud has public links to single pages, with a password and expiry if you want them.</p> },
      { title: "You edit the same paragraph as someone else", body: <p>Craft shows changes to collaborators as they happen. Folevi merges edits to different blocks, and shows a conflict when two people change the same block at once.</p> },    ],
    switching: importSteps(<>In Craft, export your documents as Markdown. Craft does bulk export on Mac and iPad.</>),
    faq: [
      { q: "Is Folevi an alternative to Craft?", a: "Yes, if you want a beautiful notes app on your Mac, iPhone and iPad with no block limit and no account, where your notes stay your files. Craft has more platforms, website publishing and real-time editing together." },
      { q: "Can I use Folevi without an account?", a: "Yes. In the Mac, iPhone and iPad apps, choose Keep notes on my devices. It’s free forever, and your notes are a folder of files in iCloud Drive, Dropbox, Google Drive or any folder you pick." },
      { q: "Can I move my Craft documents to Folevi?", a: "Yes. Export them from Craft as Markdown, then import the files, a folder or a ZIP in Folevi under Settings → Import & export." },
      { q: "Does Folevi have an iPhone or Android app?", a: `Folevi has an iPhone and iPad app (${IOS_REQUIREMENT}) and a Mac app (${MAC_REQUIREMENT}). There is no Android app.` },
      { q: "Can I use Folevi without AI?", a: `Yes. Without an account, Foli AI stays off until you set it up. On Folevi Cloud, Core costs ${p(PRICES.core.month)} a month and has no AI at all, and on the other plans you can turn Foli AI off in Settings.` },
    ],
    sources: [
      src2("pricing", "Craft: Pricing", "https://www.craft.do/pricing"),
      src2("plans", "Craft Help: Plans and pricing", "https://support.craft.do/en/account-and-subscription/subscription-plans/plans-and-pricing"),
      src2("account", "Craft Help: Create an account", "https://support.craft.do/en/introduction/account-setup/create-account"),
      src2("ai", "Craft Help: AI Assistant usage", "https://support.craft.do/en/ai-assistant/usage"),
      src("offline", "Craft Help: Offline", "https://support.craft.do/en/introduction/offline"),
      src("platforms", "Craft Help: Platforms", "https://support.craft.do/en/introduction/platforms"),
      src2("share", "Craft Help: Share", "https://support.craft.do/en/share-and-publish/share"),
      src("teams", "Craft Help: Teams", "https://support.craft.do/en/share-and-publish/share/teams"),
      src("export", "Craft Help: Export a document", "https://support.craft.do/en/import-and-export/export/document"),
      src("import", "Craft Help: Import options", "https://support.craft.do/hc/en-us/sections/15274971430684-Import-Options"),
      src("e2ee", "Craft Help: Does Craft support end-to-end encryption?", "https://support.craft.do/hc/en-us/articles/19135342358812-Does-Craft-Support-End-to-End-Encryption"),
      src("templates", "Craft Help: Templates", "https://support.craft.do/en/write-and-edit/templates"),
    ],
  },
  {
    slug: "apple-notes",
    name: "Apple Notes",
    trademarks: ["Apple", "Apple Notes", "iPhone", "iPad", "Mac", "iCloud"],
    title: "Folevi vs Apple Notes: tasks, linked pages, workspaces",
    description: "An Apple Notes alternative: compare Folevi and Apple Notes on price, apps, offline notes, AI, sharing, export and encryption, with every fact sourced.",
    h1: "Folevi vs Apple Notes",
    intro:
      "Apple Notes comes with every iPhone, iPad and Mac and syncs through iCloud. It’s good for quick notes, scanned documents, handwriting with Apple Pencil and checklists, especially if everyone you share with uses Apple devices. Folevi is a notes app for Mac, iPhone, iPad and the web, with tasks that have dates, linked pages and export to Markdown, HTML and PDF. Its Apple apps are free with no account.",
    summary: "Built into Apple devices, or notes with tasks.",
    updated: "2026-11-06",
    rows: [
      { key: "price", them: "Built into iPhone, iPad and Mac. iCloud includes 5 GB free (1 GB for accounts used only on the web).", sources: ["platforms", "icloud", "webonly"] },
      { key: "monthly", them: "More iCloud storage with iCloud+: from $0.99 a month for 50 GB to $59.99 a month for 12 TB", sources: ["icloud"] },
      { key: "ai", them: "Apple Intelligence Writing Tools and audio summaries on supported devices, such as iPhone 15 Pro and later. Apple notes that usage limits may apply.", sources: ["writing", "intelligence"] },
      { key: "offline", them: "Notes in the On My iPhone account stay on the device. iCloud notes are stored in iCloud and sync to your devices.", sources: ["accounts"] },
      { key: "platforms", them: "iPhone, iPad, Mac and Apple Vision Pro. iCloud notes on iCloud.com in a browser, including on Windows.", sources: ["platforms", "visionpro", "icloudcom"] },
      { key: "collaboration", them: "Share a note or folder to edit or view, with changes in real time. Everyone signs in with an Apple Account.", sources: ["share"] },
      { key: "publish", them: "Share with anyone who has the link; they open it with an Apple Account", sources: ["share"] },
      { key: "export", them: "PDF and Markdown, on Mac and iPhone", sources: ["export-iphone", "mac"] },
      { key: "import", them: "On Mac: Markdown, TXT, RTF, RTFD, HTML and Evernote ENEX", sources: ["mac"] },
      { key: "encryption", them: "Encrypted in transit and on the server. End-to-end encrypted with Advanced Data Protection turned on. Notes can be locked with a password.", sources: ["security", "lock"] },
    ],
    different: [
      diff.tasks,
      {
        title: "Linked pages and pages inside pages",
        body: (
          <p>
            Type [[ to link one page to another. The linked page lists where it’s linked from, and a page can hold its own sub-pages. See <Link href="/features/linked-notes">linked notes</Link>.
          </p>
        ),
      },
      apps.files,
      {
        title: "Works in any browser too",
        body: <p>With a Folevi account, the web app runs in the browser on any computer, whatever its operating system, and it doesn’t need an Apple Account. People you share with need a Folevi account, or just the URL for a public link.</p>,
      },
      diff.styles,
    ],
    suitsBetter: [
      { title: "You want nothing to install", body: <p>Apple Notes is on your iPhone, iPad and Mac already, at no extra price. Folevi is a download from the App Store or folevi.com. {PLATFORMS_HONEST}</p> },
      { title: "You scan, sketch or write by hand", body: <p>Apple Notes scans documents, recognises handwriting from Apple Pencil, solves maths as you write and records audio with a transcript. Folevi has a whiteboard block for sketches and none of the rest.</p> },
      { title: "You want end-to-end encryption", body: <p>With Advanced Data Protection turned on, Apple Notes in iCloud are end-to-end encrypted. Folevi Cloud encrypts data in transit and at rest, and isn’t end-to-end encrypted. Without an account, Folevi’s servers never see your notes, and you can encrypt the synced copy with a passphrase.</p> },
    ],
    switching: importSteps(<>In Apple Notes on a Mac, select the notes and choose File → Export To → Markdown. On iPhone, a note’s Export as Markdown does the same.</>),
    faq: [
      { q: "Is Folevi a good Apple Notes alternative?", a: "It is if you want tasks with dates, linked pages, note themes, or notes as files you can also open in any browser. Folevi has apps for Mac, iPhone and iPad that are free with no account." },
      { q: "Can I move my Apple Notes to Folevi?", a: "Yes. Export your notes as Markdown from Apple Notes on a Mac or iPhone, then import the files in Folevi under Settings → Import & export." },
      { q: "Does Folevi have an iPhone app?", a: `Yes, for iPhone and iPad (${IOS_REQUIREMENT}), on the App Store. Without an account, your notes can sync through iCloud Drive across your iPhone, iPad and Mac.` },
      { q: "Is Folevi end-to-end encrypted like Apple Notes?", a: "Folevi Cloud isn’t: it encrypts data in transit and at rest, and its servers can process your content so search, sharing and sync work. Without an account, Folevi’s servers never see your notes, and you can encrypt the synced copy with a passphrase. Apple Notes is end-to-end encrypted when you turn on Advanced Data Protection." },
    ],
    sources: [
      src("platforms", "Apple Support: Use Notes on iCloud.com and your devices", "https://support.apple.com/en-us/118308"),
      src("icloud", "Apple Support: iCloud+ plans and pricing", "https://support.apple.com/en-us/108047"),
      src("webonly", "iCloud User Guide: Web-only accounts", "https://support.apple.com/guide/icloud/overview-of-icloudcom-for-web-only-accounts-mm1d24b1063e/icloud"),
      src("writing", "iPhone User Guide: Writing Tools", "https://support.apple.com/guide/iphone/writing-tools-write-improve-summarize-iph6f08da1d2/ios"),
      src("intelligence", "iPhone User Guide: Get started with Apple Intelligence", "https://support.apple.com/guide/iphone/get-started-with-apple-intelligence-iphc28624b81/ios"),
      src("accounts", "iPhone User Guide: Add or remove accounts in Notes", "https://support.apple.com/guide/iphone/add-or-remove-accounts-iph7262fd4fe/ios"),
      src("visionpro", "Apple Vision Pro User Guide: Create and format notes", "https://support.apple.com/guide/apple-vision-pro/create-and-format-notes-tan55c811e92/visionos"),
      src("icloudcom", "iCloud User Guide: Notes on iCloud.com", "https://support.apple.com/guide/icloud/notes-on-icloudcom-overview-mm6704cac5/icloud"),
      src("share", "iPhone User Guide: Share and collaborate in Notes", "https://support.apple.com/guide/iphone/share-and-collaborate-iphe4d04f674/ios"),
      src("export-iphone", "iPhone User Guide: Export or print notes", "https://support.apple.com/guide/iphone/export-or-print-notes-iphdf551cfa2/ios"),
      src("mac", "Notes User Guide for Mac: Import, export and print notes", "https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/mac"),
      src("security", "Apple Support: iCloud data security overview", "https://support.apple.com/en-us/102651"),
      src("lock", "iPhone User Guide: Lock notes", "https://support.apple.com/guide/iphone/lock-notes-iphf177bb154/ios"),
    ],
  },
  {
    slug: "obsidian",
    name: "Obsidian",
    trademarks: ["Obsidian"],
    title: "Folevi vs Obsidian: linked notes as files, in a native app",
    description: "An Obsidian alternative: linked notes that are files you own, in a native Mac, iPhone and iPad app that is ready when you open it. Free, no account, sourced.",
    h1: "Folevi vs Obsidian",
    intro:
      "Obsidian keeps your notes as Markdown files in a folder on your own device, and it’s free to use. It has apps for desktop and mobile, a large library of community plugins and themes, and paid add-ons for sync and publishing. It suits people who want to shape the app themselves. Folevi also keeps linked notes as files you own, in a folder you pick, in a native app for Mac, iPhone and iPad that is ready the moment you open it. It’s free with no account, and syncs through iCloud Drive, Dropbox or Google Drive.",
    summary: "Linked notes as your own files, ready when you open the app.",
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
            Without an account, your Folevi library is a folder of files, one per note plus a small index, in iCloud Drive, Dropbox, Google Drive or any folder you pick. The Mac, iPhone and iPad apps are native, ready the moment you open them, with linked notes, tasks and themes built in. There is nothing to install or configure first.
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
      { title: "You want end-to-end encrypted sync as a service", body: <p>Obsidian Sync is end-to-end encrypted by default. Folevi Cloud encrypts data in transit and at rest, and isn’t end-to-end encrypted. Without an account, you can encrypt Folevi’s synced copy with your own passphrase.</p> },
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
      { q: "Is Folevi an Obsidian alternative?", a: "It is if you want linked notes that are files you own, in a native app for Mac, iPhone and iPad that is ready when you open it, with no plugins to set up. If you want plain Markdown files and community plugins, Obsidian does that and Folevi doesn’t." },
      { q: "Do I need an account to use Folevi?", a: "No. In the Mac, iPhone and iPad apps, choose Keep notes on my devices. It’s free forever, like Obsidian, and your notes stay in a folder you pick." },
      { q: "Can I import my Obsidian vault?", a: "Yes. Choose the vault folder, or a ZIP of it, in Settings → Import & export. Wiki links come in as plain text." },
      { q: "Does Folevi have backlinks?", a: "Yes. Type [[ to link a page. The linked page lists every page that links to it, with a line of text around each link." },
      { q: "Does Folevi have mobile apps?", a: `Yes, for iPhone and iPad (${IOS_REQUIREMENT}), on the App Store. There is no Android app.` },
      { q: "Is Folevi end-to-end encrypted?", a: "Folevi Cloud isn’t: data is encrypted in transit and at rest, and its servers can process your content so search, sharing and sync work. Without an account, Folevi’s servers never see your notes, and you can encrypt the synced copy with a passphrase." },
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
  {
    slug: "bear",
    name: "Bear",
    trademarks: ["Bear"],
    title: "Folevi vs Bear: notes with tasks and team workspaces",
    description: "A Bear alternative for notes: compare Folevi and Bear on price, apps, offline notes, sync, export and encryption, with every fact sourced.",
    h1: "Folevi vs Bear",
    intro:
      "Bear is a Markdown notes app for Mac, iPhone and iPad, with tags, a clean editor and iCloud sync on its Pro plan. It suits people who write on Apple devices and want a quiet place for text. Folevi is a notes app for Mac, iPhone, iPad and the web, with tasks that have dates and linked pages. Its Apple apps are free with no account, and Folevi Cloud adds sharing and team workspaces.",
    summary: "Markdown on Apple devices, or notes with tasks and sharing.",
    updated: "2026-11-06",
    rows: [
      { key: "price", them: "$0. Notes stay on the device (iCloud sync is on Pro). Export to TXT, Markdown, TextBundle and RTF.", sources: ["home"] },
      { key: "monthly", them: "Bear Pro: $2.99 a month. Prices vary by country.", sources: ["home", "pro"] },
      { key: "yearly", them: "Bear Pro: $29.99 a year", sources: ["home", "pro"] },
      { key: "ai", them: "Bear 2.8 added an MCP server and a Claude connector, so AI tools you choose can read and edit your notes", sources: ["mcp"] },
      { key: "offline", them: "Yes. Notes are stored in a local database on Mac, iPhone and iPad.", sources: ["home", "location"] },
      { key: "platforms", them: "Mac, iPhone and iPad. Bear Web is in public beta. Bear says it has no plans for Android or Windows apps.", sources: ["home", "otherplatforms"] },
      { key: "export", them: "Free: TXT, Markdown, TextBundle and RTF. Pro adds HTML, DOCX, PDF, JPG and ePub.", sources: ["export"] },
      { key: "import", them: "TXT, Markdown, RTF, TextBundle, HTML and Evernote ENEX", sources: ["import"] },
      { key: "storage", them: "Syncs through your own iCloud storage. Attachments up to 250 MB each.", sources: ["synctrouble"] },
      { key: "encryption", them: "Pro can encrypt single notes with a password. With Apple’s Advanced Data Protection on, only you can decrypt synced notes; titles and tag names stay unencrypted.", sources: ["encrypt", "privacy"] },
      { key: "templates", them: "Bear’s blog describes keeping template notes and duplicating them", sources: ["templatesblog"] },
    ],
    different: [
      {
        title: "Sharing and team workspaces",
        body: (
          <p>
            Share a Folevi page with people by email to view, comment or edit, or make a public link with a password and expiry date. Teams get workspaces with roles, and guests are free. See <Link href="/features/sharing">sharing</Link>.
          </p>
        ),
      },
      diff.tasks,
      {
        title: "Any computer, any browser",
        body: <p>With a Folevi account, the web app runs in the browser on Windows, Linux, ChromeOS or a Mac, and syncs on every plan, including Free. It doesn’t need an Apple Account or iCloud storage.</p>,
      },
      {
        title: "Sync without paying for it",
        body: <p>Without an account, the Folevi apps keep your notes as files in a folder you pick. Put it in iCloud Drive and it syncs across your iPhone, iPad and Mac at no cost, or use Dropbox or Google Drive. Bear’s iCloud sync is part of Bear Pro.</p>,
      },
      diff.styles,
    ],
    suitsBetter: [
      { title: "You work in Markdown", body: <p>Bear’s editor is built around Markdown, with tags you can nest. Folevi accepts Markdown shortcuts as you type and stores pages as blocks.</p> },
      { title: "You want to encrypt single notes", body: <p>Bear Pro can lock a note with its own password. Folevi has no per-note encryption. It can lock the whole app with Face ID or Touch ID, and encrypt the synced copy of a library with a passphrase.</p> },
    ],
    switching: importSteps(<>In Bear, select your notes and export them as Markdown. Markdown export is on the free plan.</>),
    faq: [
      { q: "Is Folevi a Bear alternative?", a: "It is if you want tasks with dates, linked pages and free sync on your Mac, iPhone and iPad, or to share notes and work in a team. If you want a Markdown editor with nested tags, Bear does that well." },
      { q: "Can I move my Bear notes to Folevi?", a: "Yes. Export them from Bear as Markdown, then import the files, a folder or a ZIP in Folevi under Settings → Import & export." },
      { q: "Does Folevi have an iPhone app?", a: `Yes, for iPhone and iPad (${IOS_REQUIREMENT}), on the App Store, free with no account.` },
      { q: "Does Folevi sync for free?", a: `Yes. Without an account, the apps sync through iCloud Drive, Dropbox or Google Drive. With a Folevi account, Free syncs across ${FREE_DEVICES} devices, with ${gb(STORAGE_BYTES.free)} of storage.` },
    ],
    sources: [
      src("home", "Bear: Home and pricing", "https://bear.app/"),
      src("pro", "Bear FAQ: Features and price of Bear Pro", "https://bear.app/faq/features-and-price-of-bear-pro/"),
      src("mcp", "Bear blog: Bear 2.8, BearCLI, Claude connector and MCP server", "https://blog.bear.app/2026/04/bear-2-8-bearcli-claude-connector-and-mcp-server/"),
      src("location", "Bear FAQ: Where are Bear’s notes located?", "https://bear.app/faq/where-are-bears-notes-located/"),
      src("otherplatforms", "Bear FAQ: What about Bear for web, Android and Windows?", "https://bear.app/faq/what-about-bear-for-web-android-windows/"),
      src("export", "Bear FAQ: Export your notes", "https://bear.app/faq/export-your-notes/"),
      src("import", "Bear FAQ: Import your notes", "https://bear.app/faq/import-your-notes/"),
      src("synctrouble", "Bear FAQ: Sync troubleshooting", "https://bear.app/faq/sync-troubleshooting/"),
      src("encrypt", "Bear FAQ: How to encrypt and lock notes", "https://bear.app/faq/how-to-encrypt-lock-notes-with-bear/"),
      src("privacy", "Bear FAQ: Syncing and privacy", "https://bear.app/faq/syncing-privacy/"),
      src("templatesblog", "Bear blog: Creating and using templates in Bear", "https://blog.bear.app/2024/02/effortless-productivity-creating-and-using-templates-in-bear/"),
    ],
  },
  {
    slug: "evernote",
    name: "Evernote",
    trademarks: ["Evernote"],
    title: "Folevi vs Evernote: free notes with no 50-note limit",
    description: "An Evernote alternative with no 50-note limit and no one-device rule: free Mac, iPhone and iPad apps with no account. Bring your notes. Every fact sourced.",
    h1: "Folevi vs Evernote",
    intro:
      "Evernote is a notes app with a web clipper, document scanning, tasks and a calendar, and apps for the web, Mac, Windows, iOS and Android. It suits people who collect a lot of material from the web and from paper. Folevi is a notes app for Mac, iPhone and iPad that is free forever with no account: no 50-note limit, no one-device rule. Bring your notes across and keep them free, as files in a folder you pick.",
    summary: "No 50-note limit, no one-device rule, free.",
    updated: "2026-11-06",
    rows: [
      { key: "price", them: "$0, with 50 notes, 1 notebook, 1 device and 1 GB of storage", sources: ["compare", "devices"] },
      { key: "account", them: "No. You use Evernote with an Evernote account, and on Free it connects one device at a time, Evernote Web included.", sources: ["devices", "signin"] },
      { key: "monthly", them: "Starter $14.99 and Advanced $24.99 a month", sources: ["starter"] },
      { key: "yearly", them: "Starter $99 and Advanced $249.99 a year", sources: ["starter"] },
      { key: "teams", them: "Enterprise plans: Flexible is priced per seat (listed in euros); Unlimited has custom pricing", sources: ["enterprise"] },
      { key: "ai", them: "AI Assistant, AI Edit, AI Transcribe and semantic search on every plan, with monthly limits that depend on the plan", sources: ["compare", "ai"] },
      { key: "offline", them: "On every plan. The desktop apps keep every synced note; on mobile you choose notes or notebooks.", sources: ["compare", "offline-desktop", "offline-mobile"] },
      { key: "platforms", them: "Web, Mac, Windows, iOS and Android", sources: ["compare", "download"] },
      { key: "collaboration", them: "Share notes and notebooks with permission levels, and Spaces", sources: ["share", "compare"] },
      { key: "publish", them: "Published notes that update as you edit", sources: ["publish"] },
      { key: "export", them: "ENEX and HTML from the desktop apps. PDF.", sources: ["export", "pdf"] },
      { key: "import", them: "ENEX, PDF, TXT, HTML, Markdown and Word files", sources: ["import"] },
      { key: "storage", them: "1 GB on Free, 5 GB on Starter, unlimited on Advanced (with safeguard limits)", sources: ["compare"] },
      { key: "encryption", them: "Selected text in a note can be encrypted with a passphrase (not on Free)", sources: ["encrypt", "compare"] },
      { key: "templates", them: "A gallery of free templates", sources: ["templates"] },
    ],
    different: [
      {
        title: "No 50-note limit, no one-device rule",
        body: (
          <p>
            The Mac, iPhone and iPad apps are free forever with no account, and they have no limit on notes or folders. Use them on every device you own: put your library in iCloud Drive, Dropbox or Google Drive and it syncs between them. Evernote Free stops at 50 notes and 1 notebook, and connects one device at a time, Evernote Web included.
          </p>
        ),
      },
      apps.files,
      {
        title: "Lower prices when you want the cloud",
        body: (
          <p>
            Folevi Cloud adds the web app, sharing and workspaces. Its paid plans are {p(PRICES.core.month)}, {p(PRICES.pro.month)} and {p(PRICES.pro_ai.month)} a month, or {p(PRICES.core.year)}, {p(PRICES.pro.year)} and {p(PRICES.pro_ai.year)} a year. Its Free plan has no note limit either, with {gb(STORAGE_BYTES.free)} of storage on {FREE_DEVICES} devices.
          </p>
        ),
      },
      diff.credits,
      {
        title: "Block documents and linked pages",
        body: (
          <p>
            A Folevi page is made of blocks: headings, to-dos, tables, callouts, flowcharts, whiteboards and more, which you add with the slash menu. Link pages with [[ and nest pages inside pages. See <Link href="/docs/blocks-and-slash-commands">blocks and slash commands</Link>.
          </p>
        ),
      },
      diff.styles,
    ],
    suitsBetter: [
      { title: "You clip the web and scan paper", body: <p>Evernote has a web clipper for pages, articles and PDFs, and scans documents and business cards. Folevi doesn’t scan, and its web clipper for Chrome and Edge isn’t in the browser stores yet.</p> },
      { title: "You need Windows or Android apps", body: <p>Evernote has apps for Android and Windows as well as the web, Mac and iOS. {PLATFORMS_HONEST}</p> },
      { title: "You connect notes to other tools", body: <p>Evernote lists integrations with Google (Gmail, Drive and Calendar) and Outlook on every plan, and Slack on Advanced and Enterprise. Folevi Cloud has an API for connected apps, and no integrations with those tools.</p> },
      { title: "You transcribe recordings", body: <p>Evernote lists AI Transcribe, for audio and video, on every plan. Folevi has no transcription.</p> },
    ],
    switching: (
      <>
        <p>
          Evernote exports ENEX, HTML and PDF from its desktop apps. Folevi imports Markdown and plain text only, so Evernote notes need converting to Markdown first. Two tools from other companies do that: Obsidian’s free Importer plugin reads ENEX files and writes Markdown, and Apple Notes on a Mac imports ENEX and exports Markdown. Then:
        </p>
        <ol>
          <li>In Folevi, open Settings → Import & export and choose the Markdown files, the folder or a ZIP of them.</li>
          <li>Folevi imports up to 50 documents at a time and lists anything it couldn’t bring across. The new pages land in Drafts, where you can file them.</li>
        </ol>
      </>
    ),
    faq: [
      { q: "Is Folevi an Evernote alternative?", a: "For notes, tasks and documents on your Mac, iPhone and iPad, yes, free with no account and no note limit. Folevi doesn’t have Evernote’s document scanning, Android and Windows apps or integrations." },
      { q: "Can I use Folevi on more than one device for free?", a: "Yes. Without an account, keep your library in iCloud Drive, Dropbox or Google Drive and open it on your Mac, iPhone and iPad. Evernote Free connects one device at a time." },
      { q: "Can I import my Evernote notes?", a: "Not directly. Folevi imports Markdown and text, and Evernote exports ENEX, HTML and PDF. Convert the ENEX file to Markdown first, for example with Obsidian’s Importer plugin or Apple Notes on a Mac, then import the Markdown." },
      { q: "Does Folevi limit notes for free?", a: `No. The apps have no limit on notes or folders. Folevi Cloud Free has none either, with ${gb(STORAGE_BYTES.free)} of storage, ${FREE_DEVICES} devices and AI during the ${TRIAL_DAYS}-day trial.` },
      { q: "Does Folevi have mobile apps?", a: `Yes, for iPhone and iPad (${IOS_REQUIREMENT}), on the App Store. There is no Android app.` },
      { q: "Does Folevi work offline?", a: "Yes. The Mac, iPhone and iPad apps work fully offline. In the browser, every edit is saved on your device first and syncs when you reconnect." },
    ],
    sources: [
      src2("compare", "Evernote: Compare plans", "https://evernote.com/compare-plans"),
      src("starter", "Evernote Help: Starter and Advanced plans", "https://help.evernote.com/hc/en-us/articles/46317642175763"),
      src2("devices", "Evernote Help: Device limits", "https://help.evernote.com/hc/en-us/articles/32039082181139"),
      src2("signin", "Evernote Help: Sign in to Evernote with Apple", "https://help.evernote.com/hc/en-us/articles/360053487874"),
      src("enterprise", "Evernote: Enterprise plans", "https://evernote.com/enterprise-plans"),
      src("ai", "Evernote Help: AI Assistant", "https://help.evernote.com/hc/en-us/articles/46319409880211"),
      src("offline-desktop", "Evernote Help: Offline notes on desktop", "https://help.evernote.com/hc/en-us/articles/209005917"),
      src("offline-mobile", "Evernote Help: Offline notebooks on mobile", "https://help.evernote.com/hc/en-us/articles/209005177"),
      src("download", "Evernote: Download", "https://evernote.com/download"),
      src("share", "Evernote Help: Share notebooks", "https://help.evernote.com/hc/en-us/articles/360052801613"),
      src("publish", "Evernote Help: Publish notes", "https://help.evernote.com/hc/en-us/articles/208313328"),
      src("export", "Evernote Help: Export notes and notebooks", "https://help.evernote.com/hc/en-us/articles/209005557"),
      src("pdf", "Evernote Help: Save notes as PDF", "https://help.evernote.com/hc/en-us/articles/4403616330387"),
      src("import", "Evernote Help: Import files and notes", "https://help.evernote.com/hc/en-us/articles/208314308"),
      src("encrypt", "Evernote Help: Encrypt text in notes", "https://help.evernote.com/hc/en-us/articles/209005547"),
      src("templates", "Evernote: Templates", "https://evernote.com/templates"),
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
