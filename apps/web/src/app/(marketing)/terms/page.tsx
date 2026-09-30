import Link from "next/link";
import { DocShell } from "@/components/marketing/DocShell";
import { pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL } from "@/components/marketing/site";
import { DraftNotice, PageHeader } from "@/components/marketing/ui";
import { PageFrame } from "@/components/marketing/cards";

export const metadata = pageMetadata({
  title: "Terms",
  description: "The terms for using Folevi, in plain language. They cover Personal and workspaces, plans and billing, device limits, the AI Assistant and your content.",
  path: "/terms",
});

const toc = [
  { id: "agreement", label: "The agreement" },
  { id: "service", label: "The service" },
  { id: "account", label: "Your account" },
  { id: "content", label: "Your content" },
  { id: "workspaces", label: "Workspaces" },
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
    <PageFrame>
      <PageHeader eyebrow="Legal" title="Terms of use" lede="The ground rules for using Folevi, in plain language.">
        <DraftNotice updated="30 September 2026" />
      </PageHeader>
      <DocShell toc={toc}>
        <h2 id="agreement">The agreement</h2>
        <p>
          By creating an account or using Folevi (the website, the web app and, once it’s released, the Mac app), you agree to these terms and
          to our <Link href="/privacy">privacy policy</Link>. If you’re using Folevi for an organisation, you confirm you’re
          allowed to accept these terms on its behalf.
        </p>

        <h2 id="service">The service</h2>
        <p>
          Folevi is actively developed: features will change, some will be added and a few may be removed. We work hard to
          keep your content safe, and you can export it at any time. Keep your own copy of anything you can’t afford to
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
          to store, process, sync, back up and display your content, only as needed to provide the service to you and to
          the people you share with. This permission ends when your content is deleted.
        </p>
        <p>
          Your account has a <strong>Personal</strong> space that only you can browse; nobody else sees anything in it unless
          you share a page with them. You can export everything in your Personal at any time.
        </p>

        <h2 id="workspaces">Workspaces</h2>
        <ul>
          <li>
            A workspace is a shared space for a team. Content created in a workspace belongs to that workspace: its owner and
            admins control it, and it stays with the workspace when someone leaves or is removed. If you add something to a
            workspace, you give the workspace permission to keep and use it. Your Personal is never part of a workspace.
          </li>
          <li>
            Every workspace has one owner, who can transfer ownership to another member. Owners and admins manage members and
            guests; the owner, and admins the owner allows, manage the workspace’s plan and billing. Owners and admins can
            export the workspace.
          </li>
          <li>
            A guest is someone a page was shared with who isn’t a member. Guests see only the pages shared with them (and
            the pages inside those), never the rest of the workspace.
          </li>
          <li>
            If you leave or are removed from a workspace, you lose access to it; your Personal, your personal plan and your
            other workspaces aren’t affected. The only owner can’t leave until they transfer ownership or delete the
            workspace.
          </li>
          <li>
            The owner can delete a workspace. It’s removed after 7 days, during which the owner can cancel; members lose
            access straight away. After that, its content is permanently deleted.
          </li>
        </ul>

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
            <strong>Personal plans</strong> are per person: Free, and the paid Core, Pro and Pro AI plans, billed monthly or
            yearly in advance. A personal plan covers your own account and your Personal only.
          </li>
          <li>
            <strong>Workspace plans</strong> belong to the workspace, not to any one person: Free, and the paid Core, Pro and
            Pro AI plans, billed monthly or yearly in advance, per member seat. The owner, admins and members each take a
            seat; guests and pending invitations are free. When members join or leave, the number of seats billed changes to
            match, and the difference is prorated. A workspace’s plan stays with it if ownership is
            transferred.
          </li>
          <li>
            Personal and workspace plans never affect each other: a personal plan doesn’t change what a workspace includes, and
            a workspace plan doesn’t change your personal plan. Prices and what each plan includes (storage, devices and AI
            credits) are on the <Link href="/pricing">pricing page</Link>.
          </li>
          <li>
            Payments for plans and AI credit packs are processed by Polar, which sells them to you as merchant of record and
            handles sales tax or VAT at checkout.
          </li>
          <li>
            AI credit packs are one-time purchases for Pro and Pro AI. Their credits last 12 months from purchase and are used
            after the monthly credits.
          </li>
          <li>New accounts get a free 7-day Pro AI trial with 100 AI credits. It ends without charge; you choose whether to pay.</li>
          <li>
            Paid plans renew automatically until canceled. You can cancel a personal plan in Settings → Plan & billing; a
            workspace plan is canceled by its owner or an admin they allow. A canceled plan keeps working until the end of the
            period paid for, then moves to Free. Payments already made aren’t refunded except where the law requires it.
          </li>
          <li>
            Plan limits apply while you’re on a plan: storage (on Free, your Personal and the free workspaces you own share
            one allowance; on paid plans, each person has their own), AI credits, and, on the Free personal plan, the number of devices
            signed in at once, which being in a workspace doesn’t change. Going over a limit, for example after moving to a
            smaller plan, pauses new uploads or holds a new device until you make room or upgrade. Nothing already stored is
            deleted, and you can still open, edit, organise, export and delete it.
          </li>
          <li>
            If we change prices, we’ll tell you by email at least 30 days before the change applies to your plan.
          </li>
          <li>Nothing you’ve created is ever held back behind a payment. You can always export it.</li>
        </ul>

        <h2 id="ai">The AI Assistant</h2>
        <p>
          On plans that include it, the AI Assistant can answer questions about your notes and help you write. Every plan
          except Core includes it, with a number of AI credits each month; in a free workspace, members use their own
          personal credits, and in a paid workspace, each member gets the workspace plan’s credits. Core has no AI. A
          personal plan never adds AI to a workspace. It’s subject to fair-use limits that keep it available to everyone. It uses Google’s Gemini API, as described in our{" "}
          <Link href="/privacy#ai">privacy policy</Link>, and you can turn it off in settings. AI can be wrong: check what it
          produces before relying on it. You’re responsible for how you use its output, and you keep the same rights to it as
          to the rest of your content.
        </p>

        <h2 id="ending">Ending</h2>
        <p>
          You can stop using Folevi and delete your account at any time, with one condition: while you own a workspace other
          people use, transfer its ownership or delete it first, so their work isn’t lost. Deletion has a 7-day grace period,
          then your account, your Personal and any workspace only you use are permanently deleted. We may end the service or an
          account under these terms; if we end the service, we’ll give reasonable notice so you can export your content.
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
    </PageFrame>
  );
}
