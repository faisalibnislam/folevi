import { DocShell } from "@/components/marketing/DocShell";
import { pageMetadata } from "@/components/marketing/seo";
import { SECURITY_EMAIL } from "@/components/marketing/site";
import { PageHeader } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Security",
  description:
    "How Folevi protects your account and notes: verified email, required two-step verification, encryption in transit and at rest, private-by-default sharing, full export and account deletion. Plus our subprocessors and how to report a vulnerability.",
  path: "/security",
});

const toc = [
  { id: "summary", label: "In short" },
  { id: "account", label: "Your account" },
  { id: "encryption", label: "Encryption" },
  { id: "e2ee", label: "Not end-to-end encrypted" },
  { id: "sharing", label: "Sharing" },
  { id: "access", label: "Who can see your notes" },
  { id: "export", label: "Export and deletion" },
  { id: "web", label: "This website" },
  { id: "subprocessors", label: "Subprocessors" },
  { id: "disclosure", label: "Reporting a vulnerability" },
];

const subprocessors = [
  {
    name: "Convex",
    role: "Database and backend",
    data: "Your account record, workspaces, pages, blocks, tasks, uploaded files and the sync operations that keep your devices up to date.",
  },
  {
    name: "Vercel",
    role: "Web hosting",
    data: "Serves folevi.com and the web app. Processes requests to our servers, including IP addresses and standard request logs.",
  },
  {
    name: "Auth0 (Okta)",
    role: "Sign-in and two-step verification",
    data: "Your email address, sign-in credentials, authenticator (TOTP) enrollment and sign-in events.",
  },
  {
    name: "Loops",
    role: "Transactional email",
    data: "Your email address and the content of the emails we send you, such as verification, security notices and share invitations.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Private by default. Plain about the rest."
        lede="What protects your account and your notes today — described precisely, without overstating it."
      />
      <DocShell toc={toc}>
        <h2 id="summary">In short</h2>
        <ul>
          <li>You verify your email before you can open a workspace.</li>
          <li>Two-step verification with an authenticator app is required for every account, with one-time recovery codes.</li>
          <li>Data is encrypted in transit (TLS, with HSTS) and at rest by our hosting providers.</li>
          <li>Nothing is public unless you create a link. Links can expire, require a password, and be revoked instantly.</li>
          <li>You can export everything, and you can delete your account.</li>
          <li>
            Folevi is <strong>not</strong> end-to-end encrypted — and our admin tools cannot display your notes.
          </li>
        </ul>

        <h2 id="account">Your account</h2>
        <h3>Email verification</h3>
        <p>
          Before you can open or create a workspace, you confirm that you own your email address. That address is where we
          send security notices, so it has to be real and yours.
        </p>
        <h3>Two-step verification is required</h3>
        <p>
          Every Folevi account signs in with a second step from an authenticator app, using time-based one-time codes
          (TOTP). This isn’t optional, and it isn’t something you have to remember to turn on.
        </p>
        <p>
          When you set it up, you receive a set of one-time recovery codes. Each code works once, for the moment you lose
          your phone. Keep them somewhere safe and separate from your password.
        </p>

        <h2 id="encryption">Encryption</h2>
        <p>
          <strong>In transit.</strong> Every connection to Folevi — from your browser or the Mac app — uses TLS. Our sites
          send HTTP Strict Transport Security (HSTS) so browsers refuse to connect without encryption.
        </p>
        <p>
          <strong>At rest.</strong> Your data is encrypted at rest by our hosting and infrastructure providers (see
          subprocessors below). On the Mac, your workspace is stored locally so you can work offline; it’s protected by your
          Mac’s own security, such as FileVault if you use it.
        </p>

        <h2 id="e2ee">Folevi is not end-to-end encrypted</h2>
        <p>
          We think you should know this clearly and early. In an end-to-end encrypted app, the service can’t read your data
          at all. Folevi is not built that way, on purpose: our servers need to process your content so that search works
          across devices, so shared links can show a page to someone you invited, so real-time sync can merge edits, and so
          we can help if something goes wrong.
        </p>
        <p>
          If you need notes that no service provider could ever read, a tool with end-to-end encryption is the better
          choice for that material. We would rather tell you than let you assume.
        </p>

        <h2 id="sharing">Sharing</h2>
        <ul>
          <li>Everything is private by default. Public links are off until you create one for a specific page.</li>
          <li>A link can have an expiry date, after which it stops working.</li>
          <li>A link can require a password.</li>
          <li>You can revoke a link at any time. It stops working immediately.</li>
        </ul>

        <h2 id="access">Who can see your notes</h2>
        <p>
          You, and the people you deliberately share with. Folevi’s internal admin tools are for managing accounts — for
          example, account status — and they have <strong>no content viewer</strong>: there is no screen that displays your
          pages or blocks.
        </p>
        <p>
          Our sync logs record technical identifiers, revision numbers and status codes only. They never contain block text,
          titles, attachment names or contents, sign-in tokens or email addresses.
        </p>

        <h2 id="export">Export and deletion</h2>
        <p>
          You can export any page as Markdown, HTML or PDF, or download your whole workspace as a ZIP archive. Your writing
          is never locked in.
        </p>
        <p>
          You can delete your account at any time. Deletion starts a 7-day grace period in case it was a mistake; after
          that, your account and its content are deleted permanently.
        </p>

        <h2 id="web">This website</h2>
        <p>
          folevi.com loads no third-party scripts, trackers, advertising pixels or remote fonts. A strict Content Security
          Policy only allows code from Folevi itself, and pages can’t be embedded in other sites.
        </p>

        <h2 id="subprocessors">Subprocessors</h2>
        <p>These companies process data on our behalf to run Folevi.</p>
        <div className="mk-table-card overflow-x-auto" role="region" aria-label="Subprocessors table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Purpose</th>
                <th scope="col">What it processes</th>
              </tr>
            </thead>
            <tbody>
              {subprocessors.map((s) => (
                <tr key={s.name}>
                  <th scope="row" className="whitespace-nowrap font-semibold text-ink">
                    {s.name}
                  </th>
                  <td className="whitespace-nowrap">{s.role}</td>
                  <td>{s.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 id="disclosure">Reporting a vulnerability</h2>
        <p>
          If you believe you’ve found a security problem in Folevi, please email{" "}
          <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>. Include what you found, the steps to reproduce it, and
          what an attacker could do with it. We read every report and will reply to confirm we’ve received yours.
        </p>
        <p>While you investigate, please:</p>
        <ul>
          <li>Only use accounts and workspaces you own or have permission to test.</li>
          <li>Don’t access, change or delete other people’s data. If you reach any by accident, stop and tell us.</li>
          <li>Avoid anything that degrades the service for others, such as load testing or spam.</li>
          <li>Give us a reasonable chance to fix the issue before you share details publicly.</li>
        </ul>
      </DocShell>
    </>
  );
}
