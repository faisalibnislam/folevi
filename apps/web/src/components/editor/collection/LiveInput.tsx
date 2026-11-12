"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";
import { imeKey } from "../canvas/wheel";

/**
 * A text field over a value of the collection. The collection is live: the value can change (someone else's
 * edit, or this device's own change coming back from the server) while the field has the keyboard. Text typed
 * and not saved yet is never replaced by it: the field keeps the typing until it's left, and the typing is then
 * what's saved (the later of the two wins). A field nobody has typed in simply follows the value, and leaving
 * it saves nothing. Enter leaves the field; Escape leaves it and gives the typing up.
 */
export function LiveInput({ value, onCommit, ...rest }: { value: string; /** What was typed, as the field is left. */ onCommit: (typed: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown">) {
  // What has been typed here and not saved yet (null: nothing, the field shows the value as it is now).
  const [typed, setTyped] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      {...rest}
      value={typed ?? value}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={() => {
        const text = typed;
        const keep = !cancelled.current;
        cancelled.current = false;
        setTyped(null);
        if (text !== null && keep) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (imeKey(e)) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
