import Link from "next/link";
import { DocShell } from "@/components/marketing/DocShell";
import { pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL } from "@/components/marketing/site";
import { DraftNotice, PageHeader } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Privacy",
  description: "A plain-language draft of how Folevi collects, uses and protects your information. Pending legal review.",
  path: "/privacy",
});

const toc = [
  { id: "short", label: "The short version" },
  { id: "collect", label: "What we collect" },
  { id: "use", label: "How we use it" },
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
        <DraftNotice updated="25 September 2026" />
      </PageHeader>
      <DocShell toc={toc}>
        <h2 id="short">The short version</h2>
        <ul>
          <li>We collect what we need to run Folevi for you: your account details and the content you put in it.</li>
          <li>Your content is private by default. We don’t sell it, rent it, or use it for advertising.</li>
          <li>This website has no third-party trackers or advertising scripts.</li>
          <li>You can export everything and delete your account whenever you like.</li>
        </ul>

        <h2 id="collect">What we collect</h2>
        <h3>Account information</h3>
        <p>
          Your email address, a display name if you choose one, and what’s needed to sign you in securely — including your
          two-step verification setup. Passwords and authenticator secrets are handled by our sign-in provider; we don’t
          store your password.
        </p>
        <h3>Your content</h3>
        <p>
          The pages, blocks, tasks, comments, files and settings you create in Folevi, plus the version history and sync
          records needed to keep your devices in step.
        </p>
        <h3>Technical information</h3>
        <p>
          When you use Folevi, our servers and hosting providers process technical data such as IP addresses, browser or app
          version, and request logs. We use it to keep the service running, secure and fast.
        </p>
        <h3>Messages you send us</h3>
        <p>If you email us, we keep the conversation so we can help you and follow up.</p>

        <h2 id="use">How we use it</h2>
        <ul>
          <li>To provide Folevi: store, sync, search, share and export your content as you ask.</li>
          <li>To keep your account secure: verify your email, require two-step verification, detect abuse.</li>
          <li>To send you service emails, such as verification, security notices and share invitations.</li>
          <li>To fix problems and improve Folevi, using technical data rather than the content of your notes.</li>
          <li>To meet legal obligations.</li>
        </ul>

        <h2 id="never">What we don’t do</h2>
        <ul>
          <li>We don’t sell or rent your personal information or your content.</li>
          <li>We don’t show ads, and we don’t use your content to target advertising.</li>
          <li>We don’t make your pages public. Only you can create a public link.</li>
          <li>Our internal admin tools have no content viewer: they manage accounts, not notes.</li>
        </ul>

        <h2 id="share">Who we share it with</h2>
        <p>
          We use a small number of service providers to run Folevi — for our database and backend, web hosting, sign-in, and
          email. Each processes data only to provide its service to us. They are listed, with what each handles, on the{" "}
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
          7-day grace period in case it was a mistake; after that, your account and content are permanently deleted. Some
          limited records, such as security logs, may be kept longer where needed to protect the service or meet legal
          obligations.
        </p>

        <h2 id="rights">Your choices and rights</h2>
        <ul>
          <li>
            <strong>Access and portability.</strong> Export any page as Markdown, HTML or PDF, or your whole workspace as a ZIP.
          </li>
          <li>
            <strong>Correction.</strong> Update your account details in settings.
          </li>
          <li>
            <strong>Deletion.</strong> Delete your account from settings, or ask us to.
          </li>
          <li>
            <strong>Questions or objections.</strong> Contact us and we’ll respond. Depending on where you live, you may also
            have the right to complain to a data protection authority.
          </li>
        </ul>

        <h2 id="security">Security</h2>
        <p>
          Data is encrypted in transit and at rest by our hosting providers, and every account uses two-step verification.
          Folevi is not end-to-end encrypted. The details are on the <Link href="/security">Security</Link> page.
        </p>

        <h2 id="changes">Changes to this policy</h2>
        <p>
          This is a draft and will change after legal review. When we make meaningful changes, we’ll update the date at the
          top and, for significant ones, tell you by email before they take effect.
        </p>

        <h2 id="contact">Contact</h2>
        <p>
          Questions about privacy can be sent to <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a> during the
          preview.
        </p>
      </DocShell>
    </>
  );
}
