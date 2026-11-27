// The sidebar's layout (the owner, 2026-11-27): which of the app's own sidebar items sit on the sidebar and which
// under its "More" section, and in what order. Saved with the person's account (convex/sidebarLayout.ts), so the
// web, Windows and Linux apps show the same layout. Home and Drafts are always on the sidebar. Search and the
// Folders and Tags sections are not items: they stay where they are.
//
// A saved layout names the items the person had when they arranged it. An item it doesn't name (one added to the
// apps later) goes to its default place: right before the item it comes before by default, on the sidebar or under More
// as its default says.

/** The app's own sidebar items, in their default order. */
export const SIDEBAR_ITEM_IDS = ["home", "ai", "dna", "bookmarks", "drafts", "notes", "tasks", "calendar", "reviews", "shared", "vault", "changes", "templates"] as const;
export type SidebarItemId = (typeof SIDEBAR_ITEM_IDS)[number];

/** Always on the sidebar: they can't go under More. */
export const LOCKED_SIDEBAR_ITEMS: ReadonlySet<string> = new Set<SidebarItemId>(["home", "drafts"]);
/** Under More until the person moves them. */
export const DEFAULT_MORE_ITEMS: ReadonlySet<string> = new Set<SidebarItemId>(["shared", "changes", "templates"]);

/** One item's place: its id and whether it sits under More. */
export interface SidebarSlot {
  id: SidebarItemId;
  more: boolean;
}
/** As saved (convex/sidebarLayout.ts): the order of the items, and the ones under More. */
export interface SavedSidebarLayout {
  order: readonly string[];
  more: readonly string[];
}

const KNOWN: ReadonlySet<string> = new Set(SIDEBAR_ITEM_IDS);

export function isSidebarItemId(id: string): id is SidebarItemId {
  return KNOWN.has(id);
}

/** The default layout. */
export function defaultSidebarLayout(): SidebarSlot[] {
  return SIDEBAR_ITEM_IDS.map((id) => ({ id, more: DEFAULT_MORE_ITEMS.has(id) }));
}

/** Every item in the person's order (null or undefined: the default), with new items in their default place. */
export function resolveSidebarLayout(saved: SavedSidebarLayout | null | undefined): SidebarSlot[] {
  if (!saved) return defaultSidebarLayout();
  const named = new Set([...saved.order, ...saved.more]);
  const inMore = new Set(saved.more);
  const order: SidebarItemId[] = [];
  for (const id of saved.order) if (isSidebarItemId(id) && !order.includes(id)) order.push(id);
  // Items the saved order doesn't list, each right before the item after it in the default order (or, with none
  // after it listed, right after the item before it).
  SIDEBAR_ITEM_IDS.forEach((id, i) => {
    if (order.includes(id)) return;
    const next = SIDEBAR_ITEM_IDS.slice(i + 1).find((x) => order.includes(x));
    const prev = SIDEBAR_ITEM_IDS.slice(0, i).reverse().find((x) => order.includes(x));
    const at = next ? order.indexOf(next) : prev ? order.indexOf(prev) + 1 : order.length;
    order.splice(at, 0, id);
  });
  return order.map((id) => ({
    id,
    more: LOCKED_SIDEBAR_ITEMS.has(id) ? false : named.has(id) ? inMore.has(id) : DEFAULT_MORE_ITEMS.has(id),
  }));
}

/** What to save for a layout. */
export function saveSidebarLayout(slots: readonly SidebarSlot[]): SavedSidebarLayout {
  return { order: slots.map((s) => s.id), more: slots.filter((s) => s.more).map((s) => s.id) };
}

/** True when two layouts put every item in the same place. */
export function sameSidebarLayout(a: readonly SidebarSlot[], b: readonly SidebarSlot[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i]!.id && s.more === b[i]!.more);
}

/** `id` moved onto the sidebar (false) or under More (true). Home and Drafts stay where they are. */
export function moveSidebarItem(slots: readonly SidebarSlot[], id: SidebarItemId, more: boolean): SidebarSlot[] {
  if (more && LOCKED_SIDEBAR_ITEMS.has(id)) return [...slots];
  return slots.map((s) => (s.id === id ? { ...s, more } : s));
}

/** `id` placed right before (or after) `target` in the order, keeping whether it sits under More. */
export function placeSidebarItem(slots: readonly SidebarSlot[], id: SidebarItemId, target: SidebarItemId, after: boolean): SidebarSlot[] {
  if (id === target) return [...slots];
  const moving = slots.find((s) => s.id === id);
  if (!moving) return [...slots];
  const rest = slots.filter((s) => s.id !== id);
  const at = rest.findIndex((s) => s.id === target);
  if (at < 0) return [...slots];
  rest.splice(after ? at + 1 : at, 0, moving);
  return rest;
}

/**
 * `id` one place up (-1) or down (+1) among `shown` (the items this person can see here: an item that isn't shown,
 * such as Foli AI with Foli AI off, keeps its place in the order and is stepped over).
 */
export function stepSidebarItem(slots: readonly SidebarSlot[], id: SidebarItemId, step: -1 | 1, shown: readonly SidebarItemId[]): SidebarSlot[] {
  const visible = slots.filter((s) => shown.includes(s.id));
  const i = visible.findIndex((s) => s.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= visible.length) return [...slots];
  return placeSidebarItem(slots, id, visible[j]!.id, step > 0);
}
