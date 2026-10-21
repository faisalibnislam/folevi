"use client";

import { useId, useState } from "react";
import { Copy, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { copy } from "@/lib/e2ee/copy";
import { formatDate } from "@/i18n";
import { printRecoveryKey } from "./PrintRecoveryKey";

/**
 * The recovery key, shown once (§10.4 step 3): nine groups of four in a mono block, Copy, Download and
 * Print, then groups 3 and 7 typed back before it counts.
 */
export function RecoveryKeyPanel({ text, email, onConfirm, onDone }: { text: string; email: string; onConfirm: (groups: [string, string]) => Promise<boolean>; onDone: () => void }) {
  const c = copy.wizard.recovery;
  const toast = useToast();
  const uid = useId();
  const [g3, setG3] = useState("");
  const [g7, setG7] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = text.split("-");
  const date = formatDate(Date.now(), { dateStyle: "long" });
  const file = `Folevi recovery key\n\n${text}\n\nKeep this somewhere safe, away from your devices. Anyone with it can unlock your encrypted notes.\nAccount: ${email}\nMade on ${date}\n`;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{c.body}</p>
      <ol aria-label={copy.wizard.recovery.heading} className="grid grid-cols-3 gap-2 rounded-control bg-sunken p-3 font-mono text-[15px] tracking-[0.06em] text-ink sm:p-4">
        {groups.map((g, i) => (
          <li key={i} className="rounded-chip bg-surface px-2 py-1.5 text-center shadow-[var(--shadow-hairline)]">
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
            a.download = c.fileName;
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
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          const ok = await onConfirm([g3, g7]).catch(() => false);
          setBusy(false);
          if (ok) onDone();
          else setError(c.wrong);
        }}
      >
        <p id={`${uid}-check`} className="text-sm font-medium text-heading">
          {c.check}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {([3, 7] as const).map((i) => (
            <label key={i} className="block text-[13px] text-muted">
              {c.group(i)}
              <input
                value={i === 3 ? g3 : g7}
                onChange={(e) => {
                  (i === 3 ? setG3 : setG7)(e.target.value.toUpperCase());
                  setError(null);
                }}
                maxLength={4}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby={`${uid}-check${error ? ` ${uid}-error` : ""}`}
                aria-invalid={error ? true : undefined}
                className="ui-input mt-1 block h-10 w-full rounded-control px-3 font-mono text-[15px] uppercase tracking-[0.08em] text-ink pointer-coarse:h-11"
              />
            </label>
          ))}
        </div>
        {error ? (
          <p id={`${uid}-error`} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={g3.length < 4 || g7.length < 4 || busy} aria-busy={busy || undefined}>
            {c.confirm}
          </Button>
        </div>
      </form>
    </div>
  );
}
