"use client";

// One choice out of a few, as cards (Folevi's own control, never the system's radio buttons): a title, a line
// that says what it means, and an optional tag such as "Recommended". Arrow keys move between cards.
import { useRef, type ComponentType, type ReactNode } from "react";
import { Check } from "lucide-react";

export interface Choice<T extends string> {
  value: T;
  title: string;
  body: ReactNode;
  tag?: string;
  icon?: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  disabled?: boolean;
}

export function ChoiceCards<T extends string>({ label, value, onChange, choices }: { label: string; value: T; onChange: (v: T) => void; choices: Choice<T>[] }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, dir: 1 | -1) => {
    const n = choices.length;
    for (let i = 1; i <= n; i++) {
      const at = (from + dir * i + n) % n;
      if (!choices[at]!.disabled) {
        refs.current[at]?.focus();
        onChange(choices[at]!.value);
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={label} className="space-y-2">
      {choices.map((c, i) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={c.disabled}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(c.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") (e.preventDefault(), move(i, 1));
              if (e.key === "ArrowUp" || e.key === "ArrowLeft") (e.preventDefault(), move(i, -1));
            }}
            className={`flex w-full items-start gap-3 rounded-control p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 ${
              on ? "bg-[var(--glass-hover)] shadow-[0_0_0_1.5px_var(--color-heading)]" : "shadow-[0_0_0_1px_var(--color-line)] hover:bg-[var(--glass-hover)]"
            }`}
          >
            {c.icon ? (
              <span className="grid size-9 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
                <c.icon size={17} aria-hidden />
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-body font-semibold text-heading">{c.title}</span>
                {c.tag ? <span className="rounded-chip bg-[var(--glass-hover)] px-2 py-0.5 text-caption-1 font-medium text-muted">{c.tag}</span> : null}
              </span>
              <span className="mt-0.5 block text-subheadline text-muted">{c.body}</span>
            </span>
            <span aria-hidden className={`mt-1 grid size-5 flex-none place-items-center rounded-full ${on ? "bg-heading text-canvas" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]"}`}>
              {on ? <Check size={12} strokeWidth={3} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
