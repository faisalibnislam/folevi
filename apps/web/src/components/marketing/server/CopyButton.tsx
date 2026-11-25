"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "../ui";

/** A small button that copies `text` and says so for a moment. `label` names what it copies, for screen readers. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      className={cx("mk-btn mk-btn-ghost h-8 flex-none gap-1.5 px-2.5 text-[13px]", className)}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      <span className="sr-only"> {label}</span>
    </button>
  );
}
