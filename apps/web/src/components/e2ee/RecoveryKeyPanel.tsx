"use client";

import { useId, useState } from "react";
import { Copy, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { copy } from "@/lib/e2ee/copy";
import { formatDate } from "@/i18n";
import { groupsMatch } from "@/lib/e2ee/keys/recoveryKey";
import { printRecoveryKey } from "./PrintRecoveryKey";

const CHECKED = [3, 7] as const;

/**
 * The recovery key, shown once (§10.4 step 3), in two steps: first the nine numbered groups with Copy, Download and
 * Print; then, with the key hidden, groups 3 and 7 typed back from the saved copy before it counts.
 */
export function RecoveryKeyPanel({
  text,
  email,
  onConfirm,
  onDone,
  vault = false,
}: {
  text: string;
  email: string;
  /** Checks the two groups (WP6's addRecoveryKey); without it they're compared with `text` here (a key from rotateAccount). */ onConfirm?: (groups: [string, string]) => Promise<boolean>;
  onDone: () => void;
  /** A Vault's recovery key (docs/VAULT_PLAN.md §2): the saved file and the intro say what it opens. */
  vault?: boolean;
}) {
  const c = copy.wizard.recovery;
  const toast = useToast();
  const uid = useId();
  const [checking, setChecking] = useState(false);
  const [g3, setG3] = useState("");
  const [g7, setG7] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = text.split("-");
  const date = formatDate(Date.now(), { dateStyle: "long" });
  const file = `Folevi ${vault ? "Vault " : ""}recovery key\n\n${text}\n\nKeep this somewhere safe, away from your devices. Anyone with it ${vault ? "and your Folevi sign-in can open your Vault" : "can unlock your encrypted notes"}.\nAccount: ${email}\nMade on ${date}\n`;
  const missing = CHECKED.filter((i) => (i === 3 ? g3 : g7).length < 4);

  if (!checking)
    return (
      <div className="space-y-5">
        {vault ? null : <p className="text-subheadline text-muted">{c.body}</p>}
        <div>
          <p className="text-footnote font-medium text-muted">{c.step(1)}</p>
          <p className="text-subheadline font-medium text-heading">{c.saveTitle}</p>
          <p className="text-subheadline text-muted">{c.saveBody}</p>
        </div>
        <ol aria-label={c.heading} className="grid grid-cols-3 gap-2 rounded-control bg-sunken p-3 font-mono text-body tracking-[0.06em] text-ink sm:p-4">
          {groups.map((g, i) => (
            // The number is drawn with CSS so copying or reading the text gives the group alone.
            <li key={i} data-n={i + 1} className="relative rounded-chip bg-surface px-2 py-1.5 text-center shadow-[var(--shadow-hairline)] before:absolute before:left-1.5 before:top-0.5 before:font-sans before:text-caption-2 before:tracking-normal before:text-faint before:content-[attr(data-n)]">
              <span className="sr-only">{c.group(i + 1)}: </span>
              {g}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.show(c.copied))}>
            <Copy size={14} aria-hidden /> {c.copy}
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([file], { type: "text/plain" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = vault ? "Folevi Vault recovery key.txt" : c.fileName;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} aria-hidden /> {c.download}
          </Button>
          <Button className="flex-1" onClick={() => printRecoveryKey({ text, email, date })}>
            <Printer size={14} aria-hidden /> {c.print}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setChecking(true)}>
            {c.saved}
          </Button>
        </div>
      </div>
    );

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || missing.length) return;
        setBusy(true);
        setError(null);
        const ok = onConfirm ? await onConfirm([g3, g7]).catch(() => false) : groupsMatch(text, [g3, g7]);
        setBusy(false);
        if (ok) onDone();
        else setError(c.wrong);
      }}
    >
      <div>
        <p className="text-footnote font-medium text-muted">{c.step(2)}</p>
        <p className="text-subheadline font-medium text-heading">{c.checkTitle}</p>
        <p id={`${uid}-check`} className="text-subheadline text-muted">
          {c.check}
        </p>
      </div>
      {/* Where groups 3 and 7 sit in the key, without showing it. */}
      <ol aria-hidden className="grid grid-cols-3 gap-2 rounded-control bg-sunken p-3 font-mono text-body text-faint sm:p-4">
        {groups.map((_, i) => {
          const asked = (CHECKED as readonly number[]).includes(i + 1);
          return (
            <li key={i} className={`rounded-chip px-2 py-1.5 text-center ${asked ? "bg-accent-soft font-sans text-footnote font-semibold text-accent-soft-ink" : "bg-surface tracking-[0.2em]"}`}>
              {asked ? c.group(i + 1) : "····"}
            </li>
          );
        })}
      </ol>
      <div className="grid grid-cols-2 gap-3">
        {CHECKED.map((i) => (
          <label key={i} className="block text-subheadline text-muted">
            {c.group(i)}
            <input
              value={i === 3 ? g3 : g7}
              onChange={(e) => {
                (i === 3 ? setG3 : setG7)(e.target.value.toUpperCase());
                setError(null);
              }}
              autoFocus={i === 3}
              maxLength={4}
              placeholder={c.placeholder}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby={`${uid}-check${error ? ` ${uid}-error` : ""}`}
              aria-invalid={error ? true : undefined}
              className="ui-input mt-1 block h-10 w-full rounded-control px-3 font-mono text-body uppercase tracking-[0.08em] text-ink placeholder:normal-case placeholder:tracking-normal placeholder:font-sans pointer-coarse:h-11"
            />
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${uid}-error`} role="alert" className="text-subheadline text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="quiet"
          onClick={() => {
            setChecking(false);
            setError(null);
          }}
        >
          {c.showAgain}
        </Button>
        <Button type="submit" variant="primary" disabled={missing.length > 0 || busy} aria-busy={busy || undefined}>
          {c.confirm}
        </Button>
      </div>
      {missing.length ? <p className="-mt-2 text-right text-footnote text-faint">{c.need([...missing])}</p> : null}
    </form>
  );
}
