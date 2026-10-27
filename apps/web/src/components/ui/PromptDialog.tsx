"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { askText, hasNative } from "@/lib/native/ui";

/**
 * A small accessible text-input dialog (replaces window.prompt). Inside the iOS and Android apps it's the
 * system's alert with a text field (a rename, a new name: docs/IOS_POLISH_PLAN.md §4.2).
 */
export function PromptDialog({
  open,
  title,
  label,
  initial = "",
  confirmLabel = "Save",
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onClose: () => void;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const [native] = useState(() => hasNative("alert"));
  const asking = useRef(false);
  const latest = useRef({ title, label, initial, confirmLabel, onClose, onSubmit });
  latest.current = { title, label, initial, confirmLabel, onClose, onSubmit };
  useEffect(() => {
    if (!native || !open || asking.current) return;
    asking.current = true;
    const o = latest.current;
    void askText({ title: o.title, value: o.initial, placeholder: o.label, label: o.label, confirm: o.confirmLabel, maxLength: 80 }).then(async (text) => {
      try {
        if (text) await latest.current.onSubmit(text);
      } finally {
        asking.current = false;
        latest.current.onClose();
      }
    });
  }, [native, open]);
  if (native) return null;
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) return;
          await onSubmit(value.trim());
          onClose();
        }}
      >
        <label className="block text-subheadline font-medium" htmlFor="prompt-input">
          {label}
        </label>
        <input
          id="prompt-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          className="ui-input mt-2 h-10 w-full rounded-chip px-3 text-callout"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
