"use client";
// Foli AI consent in encrypted spaces (docs/E2EE_DESIGN.md §10.9): the request waiting for an answer and what was
// allowed today. Its own module (ai.ts re-exports it) so the dialog that draws it doesn't load the rest of
// encrypted Foli AI, or the feature workers, with the app.
import { useSyncExternalStore } from "react";

/** §12 WP8 (WP9's ConsentPopover draws it). */
export interface ConsentRequest {
  notes: { id: string; title: string; chars: number }[];
}

interface Asked {
  request: ConsentRequest;
  resolve(ok: boolean): void;
}

const queue: Asked[] = [];
const consentListeners = new Set<() => void>();
/** "Don't ask again for this note today": note id → the day it was said (memory only, this tab). */
const remembered = new Map<string, string>();
const today = () => new Date().toISOString().slice(0, 10);

function emitConsent() {
  for (const l of [...consentListeners]) l();
}

/** Asks the person before notes are sent (resolves false on "Don't send"). Notes allowed today aren't asked again. */
export function askConsent(request: ConsentRequest): Promise<boolean> {
  if (request.notes.length && request.notes.every((n) => remembered.get(n.id) === today())) return Promise.resolve(true);
  return new Promise((resolve) => {
    queue.push({ request, resolve });
    emitConsent();
  });
}

/** The request waiting for an answer now (outside React). */
export function pendingConsent(): ConsentRequest | null {
  return queue[0]?.request ?? null;
}

/** Answers the request waiting now: "Send" (true) or "Don't send"; `rememberForNote` skips asking again today. */
export function answerConsent(ok: boolean, rememberForNote?: boolean): void {
  const head = queue.shift();
  if (!head) return;
  if (ok && rememberForNote) for (const n of head.request.notes) remembered.set(n.id, today());
  head.resolve(ok);
  emitConsent();
}

/** §12 WP8: the request waiting for an answer, and the answer. */
export function useAiConsent(): { pending: ConsentRequest | null; answer(ok: boolean, rememberForNote?: boolean): void } {
  const pending = useSyncExternalStore(
    (cb) => {
      consentListeners.add(cb);
      return () => {
        consentListeners.delete(cb);
      };
    },
    pendingConsent,
    () => null,
  );
  return { pending, answer: answerConsent };
}

/** Whether every note of a request was allowed earlier today ("Don't ask again for these notes today"). */
export function consentRemembered(request: ConsentRequest): boolean {
  return request.notes.length > 0 && request.notes.every((n) => remembered.get(n.id) === today());
}

/** Remembers a request's notes as allowed for today (memory only). */
export function rememberConsent(request: ConsentRequest): void {
  for (const n of request.notes) remembered.set(n.id, today());
}

/** Sign-out: nothing remembered, nothing waiting. */
export function resetConsent(): void {
  remembered.clear();
  for (const q of queue.splice(0)) q.resolve(false);
  emitConsent();
}
