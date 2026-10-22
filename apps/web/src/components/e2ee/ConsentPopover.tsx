"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { FileText } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { AppLink } from "@/lib/app/router";
import { copy } from "@/lib/e2ee/copy";
import { useAiConsent, type ConsentRequest } from "./hooks";

function ConsentBody({ request, onAnswer }: { request: ConsentRequest; onAnswer: (ok: boolean, remember: boolean) => void }) {
  const c = copy.consent;
  const [remember, setRemember] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{c.body}</p>
      <ul aria-label="Notes to send" className="max-h-52 divide-y divide-line overflow-y-auto rounded-control border border-line">
        {request.notes.map((note) => (
          <li key={note.id} className="flex items-center gap-2.5 px-3 py-2">
            <FileText size={14} aria-hidden className="flex-none text-muted" />
            <span className="min-w-0 flex-1 truncate text-ink">{note.title || c.untitled}</span>
            <span className="flex-none text-[12px] tabular-nums text-muted">{c.chars(note.chars)}</span>
          </li>
        ))}
      </ul>
      <Checkbox checked={remember} onChange={setRemember} className="text-[13px] text-ink">
        {c.remember}
      </Checkbox>
      <div className="flex justify-end gap-2">
        <Button onClick={() => onAnswer(false, false)}>{c.dontSend}</Button>
        <Button variant="primary" data-autofocus onClick={() => onAnswer(true, remember)}>
          {c.send}
        </Button>
      </div>
      <p className="text-[12px] text-muted">
        <AppLink href="/settings/privacy" className="underline decoration-line-strong underline-offset-2 hover:text-heading">
          {c.settingsHint}
        </AppLink>
      </p>
    </div>
  );
}

/**
 * "Send to Foli AI?" (§10.9) for "Ask me each time": anchored to the Foli AI control that asked (the element
 * that had focus when the request came), or centred when there is none. Mounted once, near the app's root.
 */
export function ConsentHost() {
  const { pending, answer } = useAiConsent();
  const anchor = useRef<HTMLElement | null>(null);
  // Where the request was asked from, worked out once per request before anything shows.
  const [placed, setPlaced] = useState<{ for: ConsentRequest; anchored: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!pending) return;
    const el = document.activeElement;
    anchor.current = el instanceof HTMLElement && el !== document.body ? el : null;
    setPlaced({ for: pending, anchored: anchor.current !== null && !anchor.current.closest("dialog") });
  }, [pending]);
  if (!pending || placed?.for !== pending) return null;
  const anchored = placed.anchored;
  const onAnswer = (ok: boolean, remember: boolean) => answer(ok, remember);
  if (anchored)
    return (
      <Popover open onClose={() => answer(false)} anchor={anchor as RefObject<HTMLElement | null>} label={copy.consent.title} className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="p-4">
          <h2 className="ui-display mb-2 text-[17px]">{copy.consent.title}</h2>
          <ConsentBody request={pending} onAnswer={onAnswer} />
        </div>
      </Popover>
    );
  return (
    <Dialog open onClose={() => answer(false)} title={copy.consent.title} size="sm">
      <ConsentBody request={pending} onAnswer={onAnswer} />
    </Dialog>
  );
}
