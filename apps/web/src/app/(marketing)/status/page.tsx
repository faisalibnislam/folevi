import Link from "next/link";
import { DocShell } from "@/components/marketing/DocShell";
import { pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL } from "@/components/marketing/site";
import { PageHeader } from "@/components/marketing/ui";
import { PageFrame } from "@/components/marketing/cards";

export const metadata = pageMetadata({
  title: "Status",
  description: "How to check whether Folevi is working for you, what the sync status in the app means, and how to report a problem.",
  path: "/status",
});

const toc = [
  { id: "dashboard", label: "Public status" },
  { id: "in-app", label: "Status in the app" },
  { id: "report", label: "Reporting a problem" },
];

export default function StatusPage() {
  return (
    <PageFrame>
      <PageHeader
        eyebrow="Status"
        title="Is Folevi working?"
        lede="Folevi doesn’t have a public status dashboard yet. Here’s how to tell what’s happening, and how to reach us."
      />
      <DocShell toc={toc}>
        <h2 id="dashboard">Public status</h2>
        <p>
          We don’t publish a live status page yet. Rather than show a dashboard that isn’t connected to
          anything, we’d rather say so plainly. During planned maintenance the app tells you it can’t sync right now, and your
          edits wait safely on your device until it’s over.
        </p>

        <h2 id="in-app">Status in the app</h2>
        <p>
          Every page shows its own sync status, which is the most accurate signal for your workspace. Your writing is saved
          on your device first, so an outage doesn’t mean lost work.
        </p>
        <ul>
          <li>
            <strong>Saved:</strong> everything is on our servers.
          </li>
          <li>
            <strong>Saving:</strong> recent edits are on their way.
          </li>
          <li>
            <strong>Offline:</strong> you’re not connected; edits are stored on this device and will sync later.
          </li>
          <li>
            <strong>Syncing:</strong> reconnecting and catching up.
          </li>
          <li>
            <strong>Conflict:</strong> the same block changed in two places; the app shows both versions.
          </li>
          <li>
            <strong>Error:</strong> something needs attention; open the status to see details and retry.
          </li>
        </ul>
        <p>
          More detail is in <Link href="/docs/sync-and-offline">Sync &amp; offline</Link>.
        </p>

        <h2 id="report">Reporting a problem</h2>
        <p>
          Problem reports go to <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>, which is
          monitored. It helps to include:
        </p>
        <ul>
          <li>what you were doing and what happened,</li>
          <li>whether you were on the web (which browser) or the Mac app (which macOS version),</li>
          <li>the sync status shown on the page, and roughly when it happened.</li>
        </ul>
        <p>
          Please don’t include the content of your notes. If the problem might affect the security of your account or data,
          say so in the subject line.
        </p>
      </DocShell>
    </PageFrame>
  );
}
