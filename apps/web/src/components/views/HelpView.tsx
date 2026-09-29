"use client";

import { ViewChrome } from "@/components/app/Shell";
import { Kbd } from "@/components/ui/Button";
import { isMac } from "@/lib/hooks/useEngine";

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

export function HelpView() {
  const mac = isMac();
  const fmt = (s: string) => (mac ? s : s.replace(/⌘/g, "Ctrl").replace(/⌥/g, "Alt").replace(/⇧/g, "Shift"));
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Help</h1>} tabTitle="Help">
      <div className="mx-auto max-w-3xl space-y-10 px-4 pb-24 pt-6 sm:px-8">
        <header>
          <h2 className="ui-display text-[34px] leading-tight">Help</h2>
          <p className="text-muted">
            The full guide lives at{" "}
            <a className="text-accent underline underline-offset-2" href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com"}/docs`}>
              folevi.com/docs
            </a>
            . Questions or problems? Write to support@folevi.com. Security reports: security@folevi.com.
          </p>
        </header>
        <section aria-labelledby="h-shortcuts">
          <h3 id="h-shortcuts" className="ui-display mb-3 text-[20px]">
            Keyboard shortcuts
          </h3>
          <table className="w-full overflow-hidden ui-card rounded-[8px] text-sm">
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
            {STATUSES.map(([k, v]) => (
              <div key={k} className="ui-card rounded-[8px] p-3">
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
