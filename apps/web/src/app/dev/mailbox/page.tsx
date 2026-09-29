import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devMailboxAvailable, readDevMailbox } from "@/lib/devMailbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Development mailbox", robots: { index: false, follow: false } };

const LABELS: Record<string, string> = { auth_verify_email: "Confirm your email", auth_password_reset: "Reset your password" };

/** Development only: follow verification and reset links without an email provider. */
export default async function DevMailboxPage() {
  if (!devMailboxAvailable()) notFound();
  const messages = (await readDevMailbox()) ?? [];
  return (
    <main className="ui-canvas min-h-dvh px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="ui-display text-3xl">Development mailbox</h1>
        <p className="mt-2 text-sm text-muted">
          Identity emails captured on this non-production deployment (they are also handed to the email provider when one is configured; outside production that is the Mailtrap sandbox or test addresses only). Newest first.
        </p>
        <ul className="mt-6 space-y-3">
          {messages.length === 0 ? <li className="ui-card p-4 text-sm text-muted">No messages yet.</li> : null}
          {messages.map((m) => (
            <li key={`${m.to}-${m.createdAt}`} className="ui-card p-4">
              <p className="text-sm font-semibold text-heading">{LABELS[m.key] ?? m.key}</p>
              <p className="text-xs text-muted">
                To {m.to} · {new Date(m.createdAt).toLocaleString()}
              </p>
              <a href={m.actionUrl} className="mt-2 inline-block break-all text-sm text-accent underline underline-offset-2">
                {m.actionUrl}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
