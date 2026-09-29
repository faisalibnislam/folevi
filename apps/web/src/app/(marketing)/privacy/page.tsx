import Link from "next/link";
import { DocShell } from "@/components/marketing/DocShell";
import { pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL } from "@/components/marketing/site";
import { DraftNotice, PageHeader } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Privacy",
  description: "How Folevi collects, uses and protects your information, including for the AI Assistant, payments and email. Written in plain language.",
  path: "/privacy",
});

const toc = [
  { id: "short", label: "The short version" },
  { id: "collect", label: "What we collect" },
  { id: "use", label: "How we use it" },
  { id: "ai", label: "The AI Assistant" },
  { id: "payments", label: "Payments" },
  { id: "never", label: "What we don’t do" },
  { id: "share", label: "Who we share it with" },
  { id: "keep", label: "How long we keep it" },
  { id: "rights", label: "Your choices and rights" },
  { id: "security", label: "Security" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Privacy policy" lede="How Folevi handles your information, written to be read.">
        <DraftNotice updated="29 September 2026" />
      </PageHeader>
      <DocShell toc={toc}>
        <h2 id="short">The short version</h2>
        <ul>
          <li>We collect what we need to run Folevi for you: your account details and the content you put in it.</li>
          <li>Your content is private by default. We don’t sell it, rent it, or use it for advertising.</li>
          <li>This website has no third-party trackers or advertising scripts.</li>
          <li>The AI Assistant is optional. When you use it, your request and the notes it needs are sent to Google’s Gemini API to answer. Nothing is sent while it’s off.</li>
          <li>You can export everything and delete your account at any time (if you own a workspace other people use, you transfer or delete it first).</li>
        </ul>

        <h2 id="collect">What we collect</h2>
        <h3>Account information</h3>
        <p>
          Your email address, a display name and profile picture if you choose them, and what’s needed to sign you in
          securely: a one-way hash of your password (never the password itself), your two-step verification setup and
          recovery codes if you turn it on (stored protected), and the devices you’re signed in on.
        </p>
        <h3>Your content</h3>
        <p>
          The pages, blocks, tasks, comments, files and settings you create in Folevi, plus the version history and sync
          records needed to keep your devices in step. Content in your Personal is yours alone. Content you add to a
          workspace belongs to that workspace: its owner and admins can see, export and delete
          it, and it stays with the workspace if you leave.
        </p>
        <h3>Technical information</h3>
        <p>
          When you use Folevi, our servers and hosting providers process technical data such as IP addresses, browser or app
          version, and request logs. We use it to keep the service running, secure and fast.
        </p>
        <h3>Plan and billing</h3>
        <p>
          Which plan you’re on, trial and renewal dates, storage and AI usage counts, and a record of payments (amount, date,
          plan). For a workspace on a paid plan, the same for the workspace, plus how many member seats it’s billed for; the
          workspace’s owner and the admins they allow can see its billing. Card details are handled by Stripe and never
          reach Folevi.
        </p>
        <h3>Messages you send us</h3>
        <p>If you email us, we keep the conversation so we can help you and follow up.</p>

        <h2 id="use">How we use it</h2>
        <ul>
          <li>To provide Folevi: store, sync, search, share and export your content as you ask.</li>
          <li>To keep your account secure: verify your email, offer two-step verification, detect abuse.</li>
          <li>To send you service emails, such as verification, security notices and share invitations. They carry no tracking pixels, and their links aren’t rewritten to track clicks.</li>
          <li>To run plans: apply your personal plan’s storage, device and AI limits and each workspace plan’s own limits, and bill paid plans (workspace plans per member seat).</li>
          <li>When you ask it to, to answer with the AI Assistant (below).</li>
          <li>To fix problems and improve Folevi, using technical data rather than the content of your notes.</li>
          <li>To meet legal obligations.</li>
        </ul>

        <h2 id="ai">The AI Assistant</h2>
        <p>
          The AI Assistant (asking questions of your notes, writing and summarizing) is powered by Google’s Gemini API. It is
          on by default for plans that include it, and you can turn it off in Settings → Account; while it’s off, nothing is
          sent to Google.
        </p>
        <ul>
          <li>
            <strong>What is sent:</strong> only what a request needs: your question or instruction, and the text of the
            note you’re in or of notes found by search that you can already read. Never notes you can’t open.
          </li>
          <li>
            <strong>What isn’t:</strong> your password, two-step secrets, payment details, or anything while the AI Assistant
            is off.
          </li>
          <li>
            <strong>What we keep:</strong> the answer is shown to you and not stored beyond a few minutes; we keep only a count
            of requests per day, recorded against your Personal or the workspace you asked in, and short-lived counters for
            fair-use limits. Your prompts and notes are not logged.
          </li>
          <li>
            We use Google’s paid Gemini API service, under which Google does not use your requests or notes to train or
            improve its models. AI can make mistakes, so check answers before relying on them.
          </li>
        </ul>

        <h2 id="payments">Payments</h2>
        <p>
          Paid plans are billed by Stripe. Stripe receives the billing email address and handles the card; Folevi receives only
          what it needs to run the plan (plan, status, dates, amounts and, for a workspace, the number of seats). Personal
          and workspace plans are billed separately. You can manage or cancel your personal plan in Settings → Plan &
          billing; a workspace’s owner (or an admin they allow) manages the workspace’s plan.
        </p>

        <h2 id="never">What we don’t do</h2>
        <ul>
          <li>We don’t sell or rent your personal information or your content.</li>
          <li>We don’t show ads, and we don’t use your content to target advertising.</li>
          <li>We don’t use your notes to train AI models, and neither does our AI provider.</li>
          <li>We don’t make your pages public. Only people who manage a page can create a public link to it.</li>
          <li>Our internal admin tools have no content viewer: they manage accounts, not notes.</li>
        </ul>

        <h2 id="share">Who we share it with</h2>
        <p>
          We use a small number of service providers to run Folevi. They cover our database and backend, web hosting, email, the AI
          Assistant (Google’s Gemini API) and payments (Stripe). Each processes data only to provide its service to us. They are listed, with what each handles, on the{" "}
          <Link href="/security#subprocessors">Security</Link> page.
        </p>
        <p>
          We also share information when you ask us to (for example, when you share a page), or when the law requires it.
          If Folevi is ever involved in a merger or acquisition, we’ll tell you before your information becomes subject to a
          different privacy policy.
        </p>

        <h2 id="keep">How long we keep it</h2>
        <p>
          We keep your account and content for as long as your account exists. When you delete your account, there is a
          7-day grace period in case it was a mistake; after that, your account, your Personal and any workspace only you use
          are permanently deleted. What you added to a workspace other people use stays with that workspace (you can’t
          delete your account while you own one, so transfer it or delete it first). A deleted workspace is removed 7 days
          after its owner deletes it. Some limited records, such as security logs, may be kept longer where needed to
          protect the service or meet legal obligations.
        </p>

        <h2 id="rights">Your choices and rights</h2>
        <ul>
          <li>
            <strong>Access and portability.</strong> Export any page as Markdown, HTML or PDF, or everything in your Personal
            as a ZIP. Owners and admins can export a whole workspace.
          </li>
          <li>
            <strong>Correction.</strong> Update your account details in settings.
          </li>
          <li>
            <strong>Deletion.</strong> Delete your account from settings, or ask us to. For content in a workspace, ask its
            owner or an admin.
          </li>
          <li>
            <strong>Questions or objections.</strong> Contact us and we’ll respond. Depending on where you live, you may also
            have the right to complain to a data protection authority.
          </li>
        </ul>

        <h2 id="security">Security</h2>
        <p>
          Data is encrypted in transit and at rest by our hosting providers, and you can add two-step verification to your account.
          Folevi is not end-to-end encrypted. The details are on the <Link href="/security">Security</Link> page.
        </p>

        <h2 id="changes">Changes to this policy</h2>
        <p>
          When we make meaningful changes, we’ll update the date at the top and, for significant ones, tell you by email
          before they take effect.
        </p>

        <h2 id="contact">Contact</h2>
        <p>
          Questions about privacy can be sent to <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>.
        </p>
      </DocShell>
    </>
  );
}
