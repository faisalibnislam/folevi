// Fractional ranks: base-62 strings ordered by plain byte comparison. Never end with "0".
// Mirrored exactly by apps/macos/Folevi/Domain/Rank.swift (see fixtures/ranks.json).
export const RANK_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = RANK_DIGITS.length;

export class RankError extends Error {}

export function isValidRank(rank: string): boolean {
  if (rank.length === 0 || rank.endsWith("0")) return false;
  for (const ch of rank) if (!RANK_DIGITS.includes(ch)) return false;
  return true;
}

/** Byte-wise comparison (not locale-aware), identical to Swift's `String` UTF-8 ordering for this alphabet. */
export function compareRank(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function digit(ch: string | undefined): number {
  return ch === undefined ? 0 : RANK_DIGITS.indexOf(ch);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null && compareRank(a, b) >= 0) throw new RankError(`${a} >= ${b}`);
  if (b !== null) {
    // Shared prefix (treating a as padded with zeros).
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a.length ? digit(a[0]) : 0;
  const db = b !== null ? digit(b[0]) : BASE;
  if (db - da > 1) {
    return RANK_DIGITS[Math.round((da + db) / 2)] as string;
  }
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (RANK_DIGITS[da] as string) + midpoint(a.slice(1), null);
}

/** A rank strictly between `before` and `after`. `null` means open-ended. */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && !isValidRank(before)) throw new RankError(`invalid rank ${before}`);
  if (after !== null && !isValidRank(after)) throw new RankError(`invalid rank ${after}`);
  return midpoint(before ?? "", after);
}

/** `count` evenly spread ranks between two bounds, used for imports and rebalancing. */
export function rankSequence(count: number, before: string | null = null, after: string | null = null): string[] {
  if (count <= 0) return [];
  if (count === 1) return [rankBetween(before, after)];
  const mid = rankBetween(before, after);
  const left = Math.floor((count - 1) / 2);
  return [...rankSequence(left, before, mid), mid, ...rankSequence(count - 1 - left, mid, after)];
}

export function needsRebalance(rank: string, maxLength: number): boolean {
  return rank.length > maxLength;
}
