"use client";
// The Vault passcode fields (docs/VAULT_PLAN.md §11.2): a PIN of 6, 8 or 12 digits, the person's choice, typed twice.
import { useEffect, useId, useState } from "react";
import { VAULT_PASSCODE_LENGTHS } from "@folevi/local-store/e2ee";

/**
 * Tells password managers to leave a field alone: 1Password, LastPass, Bitwarden, Dashlane (which reads
 * data-form-type) and the like. The browsers' own saving is avoided by not being a password field at all.
 */
export const NOT_A_LOGIN = { "data-1p-ignore": "", "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" } as const;

/** Whether this browser draws a text field as dots (-webkit-text-security: every current engine but old Firefox). */
function useDots(): boolean {
  const [dots, setDots] = useState(true);
  useEffect(() => setDots(CSS.supports("-webkit-text-security", "disc")), []);
  return dots;
}

export function PasscodeField({ label, value, onChange, autoFocus, digits }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; digits?: number }) {
  const id = useId();
  // A text field drawn as dots, not a password field: browsers offer to save, and fill in, only password fields.
  const dots = useDots();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 flex items-baseline justify-between gap-3 text-footnote font-medium text-ink">
        {label}
        {digits ? (
          <span className="font-normal text-faint" aria-live="polite">
            {value.length} of {digits}
          </span>
        ) : null}
      </span>
      <input
        id={id}
        type={dots ? "text" : "password"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        {...NOT_A_LOGIN}
        autoFocus={autoFocus}
        value={value}
        inputMode={digits ? "numeric" : undefined}
        pattern={digits ? "[0-9]*" : undefined}
        maxLength={digits}
        onChange={(e) => onChange(digits ? e.target.value.replace(/\D/g, "") : e.target.value)}
        style={dots ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined}
        className={`h-10 w-full ui-input rounded-chip px-3 text-body text-ink ${digits ? "font-mono tracking-[0.3em]" : ""}`}
      />
    </label>
  );
}

/**
 * Choosing a new passcode: the length (6 by default), the PIN, and the PIN again. Calls `onChange` with the PIN once
 * both match at the chosen length, otherwise with null.
 */
export function NewPasscode({ onChange, autoFocus, label = "Choose a passcode" }: { onChange: (pin: string | null) => void; autoFocus?: boolean; label?: string }) {
  const id = useId();
  const [digits, setDigits] = useState<number>(VAULT_PASSCODE_LENGTHS[0]);
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const report = (d: number, p: string, a: string) => onChange(p.length === d && p === a ? p : null);
  // Starts empty, so a PIN chosen on another screen doesn't carry over.
  useEffect(() => onChange(null), [onChange]);
  return (
    <div className="space-y-3">
      <div>
        <p id={`${id}-length`} className="mb-1 text-footnote font-medium text-ink">
          Passcode length
        </p>
        <div role="radiogroup" aria-labelledby={`${id}-length`} className="grid grid-cols-3 gap-1 rounded-control bg-sunken p-1">
          {VAULT_PASSCODE_LENGTHS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={digits === d}
              onClick={() => {
                setDigits(d);
                const p = pin.slice(0, d);
                const a = again.slice(0, d);
                setPin(p);
                setAgain(a);
                report(d, p, a);
              }}
              className={`h-8 rounded-chip text-footnote font-medium ${digits === d ? "bg-surface text-ink shadow-[var(--shadow-hairline)]" : "text-muted hover:text-ink"}`}
            >
              {d} digits
            </button>
          ))}
        </div>
      </div>
      <PasscodeField
        label={label}
        value={pin}
        digits={digits}
        autoFocus={autoFocus}
        onChange={(p) => {
          setPin(p);
          report(digits, p, again);
        }}
      />
      <PasscodeField
        label="Type it again"
        value={again}
        digits={digits}
        onChange={(a) => {
          setAgain(a);
          report(digits, pin, a);
        }}
      />
      {again.length === digits && again !== pin ? <p className="text-footnote text-warning">The two don&apos;t match.</p> : null}
    </div>
  );
}
