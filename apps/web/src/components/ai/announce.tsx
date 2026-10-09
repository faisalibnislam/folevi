"use client";

import { useEffect, useRef, useState } from "react";

// Screen readers and streaming answers: the text that streams in isn't a live region (it would be read out
// word by word). Instead each AI surface says once, politely, when an answer is ready.

/**
 * What to announce when work finishes: empty while `busy`, then `done` once it goes from busy to not busy
 * (never on the first render, so opening a panel with an answer in it says nothing).
 */
export function useDoneAnnouncement(busy: boolean, done: string): string {
  const [text, setText] = useState("");
  const was = useRef(busy);
  useEffect(() => {
    if (busy) setText("");
    else if (was.current) setText(done);
    was.current = busy;
  }, [busy, done]);
  return text;
}

/** A polite status line only screen readers hear (pair it with useDoneAnnouncement). */
export function AiAnnouncer({ text }: { text: string }) {
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </p>
  );
}
