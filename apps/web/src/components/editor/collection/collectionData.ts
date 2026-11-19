// Small pure pieces of the collection embed (CollectionEmbed.tsx), kept apart so they can be tested: which
// waiting changes belong to a collection, keeping unchanged rows the same objects from one answer to the
// next, the board column a row belongs in, and what leaving a number field saves.

/** A waiting change, as far as this file needs to know it (lib/sync/outbox.ts's OutboxEntry). */
interface Entry {
  args: unknown;
}

/**
 * The waiting changes that are this collection's, in order. A collection used to be worked out again (its
 * waiting changes applied, every formula of every row worked out, every row drawn) each time anything at all
 * was queued, sent or removed: a comment, a folder, a value in some other collection.
 */
export function entriesOfCollection<E extends Entry>(entries: readonly E[], collectionId: string | null): readonly E[] {
  if (!collectionId) return NONE as readonly E[];
  const mine = entries.filter((e) => (e.args as { collectionId?: string } | null)?.collectionId === collectionId);
  return mine.length ? mine : (NONE as readonly E[]);
}
const NONE: readonly Entry[] = [];

/** Whether two lists hold the very same entries in the same order. */
export function sameEntries<E>(a: readonly E[], b: readonly E[]): boolean {
  return a === b || (a.length === b.length && a.every((e, i) => e === b[i]));
}

/**
 * `next`, with every part of it that equals the same part of `prev` replaced by `prev`'s own object. The
 * server answers with a whole new collection whenever one value in it changes: every row and property a new
 * object, though all but one say what they said before. Keeping the old objects for those lets the view tell
 * the rows that changed from the ones that didn't, and draw only the first.
 */
export function shareStructure<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (typeof prev !== "object" || typeof next !== "object" || prev === null || next === null) return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const before = prev as unknown[];
    let same = before.length === next.length;
    const out = next.map((item, i) => {
      const kept = shareStructure(before[i], item);
      if (kept !== before[i]) same = false;
      return kept;
    });
    return (same ? prev : out) as T;
  }
  const proto = Object.getPrototypeOf(next);
  if (proto !== Object.prototype && proto !== null) return next;
  const before = prev as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let same = Object.keys(before).length === keys.length;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = shareStructure(before[key], after[key]);
    if (out[key] !== before[key] || !(key in before)) same = false;
  }
  return (same ? prev : out) as T;
}

/**
 * The board column a row goes in, by its value for the property the board is grouped by: that option's
 * column, or the column for rows without one (null). A value that is no longer one of the options (the option
 * was deleted) is "without one" too: such a row used to be in no column at all, gone from the board.
 */
export function boardColumnOf(value: unknown, options: readonly { id: string }[]): string | null {
  return typeof value === "string" && options.some((o) => o.id === value) ? value : null;
}

/**
 * What leaving a number field saves: `{ value }` (null clears the number), "unread" when what was typed isn't
 * a number (nothing is saved, and the field says so), or null when there is nothing to save.
 *
 * `typed` is the field's text as the browser reports it, which is empty both when the field was cleared and
 * when it holds something that isn't a number ("1 500", "12-", letters where the browser lets them be typed).
 * `badInput` tells the two apart: text the browser can't read as a number is not a request to clear the
 * number (it used to erase the stored number, with no undo). `current` is the stored value: typing the same
 * number again saves nothing either.
 */
export function numberFieldChange(typed: string, current: unknown, badInput: boolean): { value: number | null } | "unread" | null {
  if (badInput) return "unread";
  const text = typed.trim();
  const next = text === "" ? null : Number(text);
  if (next !== null && !Number.isFinite(next)) return "unread";
  return next === (typeof current === "number" ? current : null) ? null : { value: next };
}
