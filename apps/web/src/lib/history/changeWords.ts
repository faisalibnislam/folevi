// How changes are described in words (Changes, and "Since you were away" on a note).

/** "Sam Rivera", "Sam Rivera and 1 other", "Sam Rivera and 2 others". */
export function whoChanged(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "Someone";
  const others = names.length - 1;
  return `${names[0]} and ${others} ${others === 1 ? "other" : "others"}`;
}

/** "2 lines added, 1 edited, 1 removed" (and "and more" when there were too many to count). */
export function changeCounts(n: { added: number; edited: number; removed: number; more?: boolean }): string {
  const parts = (
    [
      [n.added, "added"],
      [n.edited, "edited"],
      [n.removed, "removed"],
    ] as const
  ).filter(([count]) => count > 0);
  const text = parts.map(([count, verb], i) => (i === 0 ? `${count} ${count === 1 ? "line" : "lines"} ${verb}` : `${count} ${verb}`)).join(", ");
  return n.more ? `${text}, and more` : text;
}
