"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

/** A small accessible text-input dialog (replaces window.prompt). */
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
        <label className="block text-sm font-medium" htmlFor="prompt-input">
          {label}
        </label>
        <input
          id="prompt-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          className="ui-input mt-2 h-10 w-full rounded-[6px] px-4"
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
