import Link from "next/link";
import { DocShell } from "@/components/marketing/DocShell";
import { pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL } from "@/components/marketing/site";
import { DraftNotice, PageHeader } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Terms",
  description: "The terms for using Folevi — plans and billing, device limits, the AI Assistant and your content — in plain language.",
  path: "/terms",
});

const toc = [
  { id: "agreement", label: "The agreement" },
  { id: "service", label: "The service" },
  { id: "account", label: "Your account" },
  { id: "content", label: "Your content" },
  { id: "use", label: "Acceptable use" },
  { id: "sharing", label: "Sharing" },
  { id: "price", label: "Plans and billing" },
  { id: "ai", label: "The AI Assistant" },
  { id: "ending", label: "Ending" },
  { id: "liability", label: "Warranties and liability" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export default function TermsPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Terms of use" lede="The ground rules for using Folevi, in plain language.">
        <DraftNotice updated="29 September 2026" />
      </PageHeader>
      <DocShell toc={toc}>
        <h2 id="agreement">The agreement</h2>
        <p>
          By creating an account or using Folevi — the website, the web app and our native apps — you agree to these terms and
          to our <Link href="/privacy">privacy policy</Link>. If you’re using Folevi for an organisation, you confirm you’re
          allowed to accept these terms on its behalf.
        </p>

        <h2 id="service">The service</h2>
        <p>
          Folevi is actively developed: features will change, some will be added and a few may be removed. We work hard to
          keep your content safe, and you can export it at any time — keep your own copy of anything you can’t afford to
          lose.
        </p>

        <h2 id="account">Your account</h2>
        <ul>
          <li>Give us an email address you control, and keep your sign-in details and recovery codes safe.</li>
          <li>We strongly recommend turning on two-step verification in Settings → Security.</li>
          <li>You’re responsible for what happens under your account. Tell us promptly if you think it has been compromised.</li>
        </ul>

        <h2 id="content">Your content</h2>
        <p>
          <strong>What you write is yours.</strong> You keep all rights to your content. To run Folevi, you give us permission
          to store, process, sync, back up and display your content — only as needed to provide the service to you and to
          the people you share with. This permission ends when your content is deleted.
        </p>
        <p>You can export your content at any time.</p>

        <h2 id="use">Acceptable use</h2>
        <p>Please don’t use Folevi to:</p>
        <ul>
          <li>break the law or infringe other people’s rights;</li>
          <li>share malware, or content that exploits or harms children;</li>
          <li>harass, threaten or spam people, including through public links or share invitations;</li>
          <li>probe, overload or interfere with the service, except for good-faith security research as described on our{" "}
            <Link href="/security#disclosure">Security</Link> page;</li>
          <li>access other people’s accounts or data without permission.</li>
        </ul>
        <p>If an account is used in these ways, we may restrict or suspend it. Where it’s safe and lawful, we’ll tell you why.</p>

        <h2 id="sharing">Sharing</h2>
        <p>
          When you invite someone to a page or create a public link, you decide who can see it. You’re responsible for what
          you choose to share and with whom. You can revoke access or a link at any time.
        </p>

        <h2 id="price">Plans and billing</h2>
        <ul>
          <li>
            Folevi has a Free plan and paid plans (Basic and Pro), billed monthly or yearly in advance through Stripe. Prices
            and what each plan includes — storage, devices and the AI Assistant — are on the{" "}
            <Link href="/pricing">pricing page</Link>.
          </li>
          <li>New accounts get a free Pro trial. It ends without charge; you choose whether to pay.</li>
          <li>
            Paid plans renew automatically until you cancel. You can cancel at any time in Settings → Plan & billing; your plan
            keeps working until the end of the period you paid for, then moves to Free. Payments already made aren’t refunded
            except where the law requires it.
          </li>
          <li>
            Plan limits apply while you’re on a plan: storage (counted across the workspaces you own) and, on Free, the number
            of devices signed in at once. Going over a limit pauses new uploads or holds a new device until you make room or
            upgrade — nothing you’ve created is deleted.
          </li>
          <li>
            If we change prices, we’ll tell you by email at least 30 days before the change applies to your plan.
          </li>
          <li>Nothing you’ve created is ever held back behind a payment — you can always export it.</li>
        </ul>

        <h2 id="ai">The AI Assistant</h2>
        <p>
          On plans that include it, the AI Assistant can answer questions about your notes and help you write. It uses
          Google’s Gemini API, as described in our <Link href="/privacy#ai">privacy policy</Link>, and you can turn it off
          in settings. AI can be wrong: check what it produces before relying on it. You’re responsible for how you use its
          output, and you keep the same rights to it as to the rest of your content.
        </p>

        <h2 id="ending">Ending</h2>
        <p>
          You can stop using Folevi and delete your account whenever you like. Deletion has a 7-day grace period, then it’s
          permanent. We may end the service or an account under these terms; if we end the service, we’ll give reasonable
          notice so you can export your content.
        </p>

        <h2 id="liability">Warranties and liability</h2>
        <p>
          Folevi is provided “as is”, without promises that it will be uninterrupted or error-free. To the
          extent the law allows, we aren’t liable for indirect or consequential losses, or for loss of data you could have
          protected with an export. Nothing in these terms limits rights you have that can’t be limited by law.
        </p>

        <h2 id="changes">Changes to these terms</h2>
        <p>
          When we make meaningful changes, we’ll update the date at the top and tell you by email before significant changes
          take effect.
        </p>

        <h2 id="contact">Contact</h2>
        <p>
          Questions about these terms can be sent to <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>.
        </p>
      </DocShell>
    </>
  );
}
