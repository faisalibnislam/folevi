import { MONTHLY_CREDITS, PRICES, formatPrice } from "@/lib/plans";
import { FaqSection } from "../parts";
import type { FaqItem } from "../seo";

/** The home page's questions: short answers, the same text as the FAQPage data. */
export const HOME_FAQS: FaqItem[] = [
  {
    q: "What can I do in Folevi?",
    a: "Write notes and docs, build a team wiki, plan tasks on a calendar, keep collections as a table, gallery or kanban board, draw flowcharts and whiteboards, see your notes as a map in Foli DNA, and keep passwords in the Vault.",
  },
  {
    q: "Is Folevi really free?",
    a: `Yes. Every Folevi app is free forever, with every feature: Mac, Windows, Linux (Beta), iPhone, iPad and Android, and the web. Keep notes on your devices with no account, no trial, no card and no limit on notes, or run your own Folevi Server for free. You pay only for Folevi Cloud, from ${formatPrice(PRICES.core.month)} a month, and it has a free plan too.`,
  },
  {
    q: "Do I need an account?",
    a: "No. When the app opens, choose Keep notes on my devices. You only need a Folevi account for the web app, sharing and editing with others, workspaces and Foli AI credits.",
  },
  {
    q: "Where are my notes stored?",
    a: "In a folder you pick: iCloud Drive, Dropbox, Google Drive, any other folder, or just your device. Dropbox and Google Drive are in the Mac, iPhone and iPad apps for now. Each note is its own file, and Folevi’s servers never see them. You can also sync through your own Folevi Server (Beta).",
  },
  {
    q: "How do my notes sync between my devices?",
    a: "Through the folder’s own service. With iCloud Drive, your notes appear on every iPhone, iPad and Mac signed in to your iCloud account. If the same note changes on two devices, Folevi merges the changes.",
  },
  {
    q: "Can I use Foli AI without an account?",
    a: `Yes. In a library on your devices, Foli AI works with your own OpenAI, Anthropic or Google key, called straight from your device, or with Apple Intelligence on your Mac. On Folevi Cloud, the Free plan has ${MONTHLY_CREDITS.free} AI credits a month.`,
  },
  {
    q: "What does a Folevi account add?",
    a: `It adds Folevi Cloud: the web app, editing together in real time, public pages, workspaces for teams, email-in and the web clipper. The Free plan costs nothing. Paid plans from ${formatPrice(PRICES.core.month)} a month add more storage and Foli AI credits.`,
  },
  {
    q: "Does Folevi check my spelling?",
    a: "Yes, in every app and offline, in nine languages, and it predicts the next word: press Tab to take it. It underlines and suggests, and never changes a word on its own.",
  },
  {
    q: "Can I host Folevi myself?",
    a: "Yes, for free. Folevi Server, in beta, runs Folevi on your own NAS or Linux server, and every Folevi app can sign in to it.",
  },
  {
    q: "Is there an app for Windows, Linux or Android?",
    a: "Yes, all three, free and with every feature: get them from folevi.com/downloads. Linux is in beta.",
  },
];

export function HomeFaq() {
  return <FaqSection id="home-faq" title="Questions" faqs={HOME_FAQS} path="/" collapsed />;
}
