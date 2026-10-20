"use client";

import { useState } from "react";
import { ViewChrome } from "@/components/app/Shell";
import { Button, Kbd } from "@/components/ui/Button";
import { SupportDialog, SupportRequests } from "@/components/support/SupportDialog";
import { isMac } from "@/lib/hooks/useEngine";
import { useCapabilities } from "@/lib/mode";

const SHORTCUTS: [string, string][] = [
  ["Search or jump anywhere", "⌘ K"],
  ["New document", "⌘ ⌥ N"],
  ["Quick add task", "⌘ ⇧ A"],
  ["Toggle sidebar", "⌘ \\"],
  ["Toggle inspector", "⌘ ⌥ I"],
  ["Tasks · Today", "⌘ ⌥ T"],
  ["Bold / italic / underline", "⌘ B / ⌘ I / ⌘ U"],
  ["Strikethrough / inline code", "⌘ ⇧ X / ⌘ E"],
  ["Highlight", "⌘ ⇧ H"],
  ["Text / Heading 1–3", "⌘ ⌥ 0 / ⌘ ⌥ 1–3"],
  ["Numbered / bulleted / to-do", "⌘ ⇧ 7 / 8 / 9"],
  ["Nest / un-nest block", "Tab / ⇧ Tab"],
  ["Move block up / down", "⌥ ⇧ ↑ / ↓"],
  ["Duplicate block", "⌘ D"],
  ["Block options", "⌘ ."],
  ["Toggle to-do or toggle block", "⌘ Enter"],
  ["Task details (due date, reminder…)", "⌘ ⇧ D"],
  ["Soft line break", "⇧ Enter"],
  ["Undo / redo", "⌘ Z / ⌘ ⇧ Z"],
];

const STATUSES: [string, string][] = [
  ["Saved", "Every change has been confirmed by the server."],
  ["Saving…", "Your latest changes are on their way."],
  ["Syncing…", "Waiting for the server to confirm."],
  ["Offline", "Keep writing. Changes are stored on this device and sync when you reconnect."],
  ["Conflict", "The same block changed in two places. Both versions are kept until you choose."],
  ["Not saved", "The server rejected a change, or you need to sign in again. Open the status for details."],
];

/** The same words for a library on this person's devices (local mode): there's no server to confirm anything. */
const LOCAL_STATUSES: [string, string][] = [
  ["Saved", "Every change is saved on this device. Your library's folder gets it a few seconds later."],
  ["Saving…", "Your latest changes are being saved on this device."],
  ["Syncing…", "Folevi is reading your library's folder and writing what it lacks."],
  ["Changed on another device", "The same block changed on two devices at once. The newer change shows, and the other is kept in version history, with a note on the block."],
  ["Not saved", "This device couldn't save a change. Open the status for details."],
];

export function HelpView() {
  const mac = isMac();
  const fmt = (s: string) => (mac ? s : s.replace(/⌘/g, "Ctrl").replace(/⌥/g, "Alt").replace(/⇧/g, "Shift"));
  const [contacting, setContacting] = useState(false);
  // Local mode: support requests belong to an account, so support is an email (docs/LOCAL_MODE_PLAN.md §2.4).
  const account = useCapabilities().account;
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Help</h1>} tabTitle="Help">
      <div className="mx-auto max-w-3xl space-y-10 px-4 pb-[max(6rem,var(--fab-clearance))] pt-6 sm:px-8">
        <header>
          <h2 className="ui-display text-[34px] leading-tight">Help</h2>
          <p className="text-muted">
            The full guide lives at{" "}
            <a className="text-accent underline underline-offset-2" href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com"}/docs`}>
              folevi.com/docs
            </a>
            . Questions or problems? Contact support below, or write to support@folevi.com. Security reports: security@folevi.com.
          </p>
        </header>
        {account ? (
        <section id="support" aria-labelledby="h-support" className="scroll-mt-20">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="h-support" className="ui-display text-[20px]">
                Your support requests
              </h3>
              <p className="text-sm text-muted">A person on the Folevi team reads every request and replies by email. Replies show here too.</p>
            </div>
            <Button variant="primary" onClick={() => setContacting(true)}>
              Contact support
            </Button>
          </div>
          <SupportRequests onContact={() => setContacting(true)} />
          <SupportDialog open={contacting} onClose={() => setContacting(false)} />
        </section>
        ) : (
          <section id="support" aria-labelledby="h-support" className="scroll-mt-20">
            <h3 id="h-support" className="ui-display text-[20px]">
              Support
            </h3>
            <p className="mt-1 text-sm text-muted">A person on the Folevi team reads every email and replies.</p>
            <a href="mailto:support@folevi.com" className="ui-btn ui-btn-primary mt-3 inline-flex h-9 items-center px-4 text-sm">
              Email support
            </a>
          </section>
        )}
        <section aria-labelledby="h-shortcuts">
          <h3 id="h-shortcuts" className="ui-display mb-3 text-[20px]">
            Keyboard shortcuts
          </h3>
          <table className="w-full overflow-hidden ui-card rounded-control text-sm">
            <tbody>
              {SHORTCUTS.map(([label, keys]) => (
                <tr key={label} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    {label}
                  </th>
                  <td className="px-4 py-2 text-right">
                    <Kbd>{fmt(keys)}</Kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Type / on an empty line for every block type, [[ to link a page, and @ to mention someone or a date. Markdown shortcuts like “# ”, “- ”, “[] ” and “```” work at the start of a line.</p>
        </section>
        <section aria-labelledby="h-sync">
          <h3 id="h-sync" className="ui-display mb-3 text-[20px]">
            What the save status means
          </h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            {(account ? STATUSES : LOCAL_STATUSES).map(([k, v]) => (
              <div key={k} className="ui-card rounded-control p-3">
                <dt className="font-medium">{k}</dt>
                <dd className="text-sm text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </ViewChrome>
  );
}
