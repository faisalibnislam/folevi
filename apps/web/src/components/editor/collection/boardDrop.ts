// Where a card dropped on a board lands (CollectionEmbed.tsx, BoardCollection). A collection keeps one order
// for its rows (each row's rank, set by collections.moveRow: "put this row right after that one"); a board
// column shows the rows of one group in that order. So a card dropped between two cards of a column is moved,
// in the collection's order, to just after the card above it, or just before the column's first card.

interface Card {
  id: string;
}

/**
 * The row a dropped card should follow in the collection's own order (`afterRowId` for collections.moveRow;
 * null: before every row), or null when the drop leaves the card where it already is.
 *
 * `all` is every row of the collection in its order, `column` the cards of the column dropped on in the order
 * shown, `rowId` the dragged card and `before` the card it was dropped above (null: under the column's last).
 */
export function boardDropAfter(all: readonly Card[], column: readonly Card[], rowId: string, before: string | null): { afterRowId: string | null } | null {
  const others = column.filter((r) => r.id !== rowId);
  const at = before === null ? others.length : others.findIndex((r) => r.id === before);
  if (at < 0) return null;
  // Already at that place in this column.
  if (column.findIndex((r) => r.id === rowId) === at) return null;
  const above = others[at - 1];
  if (above) return { afterRowId: above.id };
  const first = others[0];
  // An empty column: there's no place among its cards to keep, and the card goes first, as "Move to" puts it.
  if (!first) return { afterRowId: null };
  // Above the column's first card: right before it in the collection's order, which is after whichever row
  // comes before that card there (a card of another column, or a row this view filters out).
  const rest = all.filter((r) => r.id !== rowId);
  const k = rest.findIndex((r) => r.id === first.id);
  return { afterRowId: k > 0 ? rest[k - 1]!.id : null };
}

/**
 * The card a dragged one would land above in a column, from where the pointer is: the first card whose middle
 * is below it (null: under the last). The dragged card itself doesn't count.
 */
export function cardBelowPointer(column: Element, y: number, dragged: string): string | null {
  for (const card of column.querySelectorAll<HTMLElement>("li[data-row-id]")) {
    if (card.dataset.rowId === dragged) continue;
    const box = card.getBoundingClientRect();
    if (y < box.top + box.height / 2) return card.dataset.rowId ?? null;
  }
  return null;
}
