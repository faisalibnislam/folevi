// Merging two versions of a canvas block's data (a flowchart, mind map or wireframe) that both started from
// the same one: this device's unsaved work and a change that arrived from elsewhere. Every canvas keeps its
// things in lists of items with an `id`, so the merge is item by item: what this device changed, added or
// removed stays so; everything else follows the other side. Nothing anyone did to a different item is lost.

type Item = { id: string };

const isItemList = (v: unknown): v is Item[] => Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string");

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function mergeList(base: Item[], theirs: Item[], mine: Item[]): Item[] {
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
  }
  return out;
}

/**
 * `mine` with the changes `theirs` made since `base`. Lists of items merge item by item; any other field is
 * this device's when it changed it, else theirs. The result still needs the block's own reader run over it
 * (parse after serialize), which drops whatever no longer fits (a connector whose shape the other side removed).
 */
export function mergeCanvasData<T extends object>(base: T, theirs: T, mine: T): T {
  const out: Record<string, unknown> = {};
  const b = base as Record<string, unknown>;
  const t = theirs as Record<string, unknown>;
  const m = mine as Record<string, unknown>;
  for (const key of new Set([...Object.keys(t), ...Object.keys(m)])) {
    if (isItemList(m[key] ?? []) && isItemList(t[key] ?? []) && (Array.isArray(m[key]) || Array.isArray(t[key]))) {
      out[key] = mergeList(isItemList(b[key]) ? b[key] : [], (t[key] as Item[] | undefined) ?? [], (m[key] as Item[] | undefined) ?? []);
      continue;
    }
    const value = same(m[key], b[key]) ? t[key] : m[key];
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}
