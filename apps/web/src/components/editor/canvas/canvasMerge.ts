// Merging two versions of a canvas block's data (a flowchart, mind map or wireframe) that both started from
// the same one: this device's unsaved work and a change that arrived from elsewhere. Every canvas keeps its
// things in lists of items with an `id`, so the merge is item by item: what this device changed, added or
// removed stays so; everything else follows the other side. Nothing anyone did to a different item is lost.

type Item = { id: string };

const isItemList = (v: unknown): v is Item[] => Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string");

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Whether this device put the items it already had in a different order (front to back, or among siblings). */
function reordered(base: Item[], mine: Item[]): boolean {
  const mineIds = new Set(mine.map((x) => x.id));
  const baseIds = new Set(base.map((x) => x.id));
  const was = base.filter((x) => mineIds.has(x.id));
  const now = mine.filter((x) => baseIds.has(x.id));
  return was.some((x, i) => x.id !== now[i]!.id);
}

/** `revived` collects the items this device changed and so keeps, though the other side removed them. */
function mergeList(base: Item[], theirs: Item[], mine: Item[], revived: Set<string>): Item[] {
  const baseById = new Map(base.map((x) => [x.id, x]));
  const mineById = new Map(mine.map((x) => [x.id, x]));
  const theirIds = new Set(theirs.map((x) => x.id));
  const out: Item[] = [];
  // Their order, with this device's version of whatever it changed.
  for (const their of theirs) {
    const was = baseById.get(their.id);
    const my = mineById.get(their.id);
    if (!my) {
      // Removed here (it was in the base): stays removed. Never seen here: theirs, new.
      if (!was) out.push(their);
      continue;
    }
    out.push(was && same(my, was) ? their : my);
  }
  // What only this device has: its own additions, and items it changed that the other side removed.
  for (const my of mine) {
    if (theirIds.has(my.id)) continue;
    const was = baseById.get(my.id);
    if (!was || !same(my, was)) out.push(my);
    if (was && !same(my, was)) revived.add(my.id);
  }
  if (!reordered(base, mine)) return out;
  // This device changed the order: the items it holds keep its order, in the places those items have in the
  // list (what the other side added stays where the other side put it).
  const rank = new Map(mine.map((x, i) => [x.id, i]));
  const held = out.filter((x) => rank.has(x.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let next = 0;
  return out.map((x) => (rank.has(x.id) ? held[next++]! : x));
}

/** The item at an end of a connector (a flowchart's, a wireframe's link). */
const ends = (x: Item): unknown[] => [(x as { from?: unknown }).from, (x as { to?: unknown }).to];

/**
 * `mine` with the changes `theirs` made since `base`. Lists of items merge item by item; any other field is
 * this device's when it changed it, else theirs. An item this device changed stays even when the other side
 * removed it, and so do the connectors it had that went with it. The result still needs the block's own
 * reader run over it (parse after serialize), which drops whatever no longer fits (a connector whose shape
 * the other side removed).
 */
export function mergeCanvasData<T extends object>(base: T, theirs: T, mine: T): T {
  const out: Record<string, unknown> = {};
  const b = base as Record<string, unknown>;
  const t = theirs as Record<string, unknown>;
  const m = mine as Record<string, unknown>;
  const revived = new Set<string>();
  const lists: string[] = [];
  for (const key of new Set([...Object.keys(t), ...Object.keys(m)])) {
    if (isItemList(m[key] ?? []) && isItemList(t[key] ?? []) && (Array.isArray(m[key]) || Array.isArray(t[key]))) {
      out[key] = mergeList(isItemList(b[key]) ? b[key] : [], (t[key] as Item[] | undefined) ?? [], (m[key] as Item[] | undefined) ?? [], revived);
      lists.push(key);
      continue;
    }
    const value = same(m[key], b[key]) ? t[key] : m[key];
    if (value !== undefined) out[key] = value;
  }
  // The other side removed a shape, and its connectors went with it; this device changed that shape, so it
  // is still here: the connectors it had here, untouched, come back with it.
  if (revived.size) {
    for (const key of lists) {
      const list = out[key] as Item[];
      const have = new Set(list.map((x) => x.id));
      const was = new Map((isItemList(b[key]) ? b[key] : []).map((x) => [x.id, x]));
      for (const my of (m[key] as Item[] | undefined) ?? []) {
        if (have.has(my.id) || !same(my, was.get(my.id))) continue;
        if (ends(my).some((id) => typeof id === "string" && revived.has(id))) list.push(my);
      }
    }
  }
  return out as T;
}
