import { PRICES, formatPrice } from "@/lib/plans";
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
    a: "Yes. The Mac, iPhone and iPad apps are free forever when you keep notes on your devices: no account, no trial, no card and no limit on notes. Folevi Cloud plans are optional.",
  },
  {
    q: "Do I need an account?",
    a: "No. When the app opens, choose Keep notes on my devices. You only need a Folevi account for the web app, sharing and editing with others, workspaces and Foli AI credits.",
  },
  {
    q: "Where are my notes stored?",
    a: "In a folder you pick: iCloud Drive, Dropbox, Google Drive, any other folder, or just your device. Each note is its own file, and Folevi’s servers never see them.",
  },
  {
    q: "How do my notes sync between my Mac, iPhone and iPad?",
    a: "Through the folder’s own service. With iCloud Drive, your notes appear on every iPhone, iPad and Mac signed in to your iCloud account. If the same note changes on two devices, Folevi merges the changes.",
  },
  {
    q: "Can I use Foli AI without an account?",
    a: "On the Mac, yes: Foli AI runs on Apple Intelligence, or on your own OpenAI, Anthropic or Google key, sent straight from your Mac. Folevi Cloud plans include Foli AI credits on every device.",
  },
  {
    q: "What does a Folevi account add?",
    a: `Folevi Cloud: the web app, editing together in real time, public pages, workspaces for teams, email-in and the web clipper. The Free plan costs nothing. Paid plans from ${formatPrice(PRICES.core.month)} a month add more storage and Foli AI credits.`,
  },
  {
    q: "Is there an app for Windows or Android?",
    a: "Not yet. On Windows, Linux or Android, use the web app in your browser with a free Folevi account.",
  },
];

export function HomeFaq() {
  return <FaqSection id="home-faq" title="Questions" faqs={HOME_FAQS} path="/" collapsed />;
}
