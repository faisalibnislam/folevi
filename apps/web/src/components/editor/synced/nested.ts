// A synced block shows its content in an editor of its own, inside the note's editor (SyncedView.tsx). Its
// events also reach the note's editor (they bubble up through it): the note's own shortcuts, menus and block
// handle leave them alone.

/** The element holding a synced block's own editor. */
export const SYNCED_BODY_ATTR = "data-synced-body";

/**
 * Whether `target` is inside a synced block's editor nested in `dom` (the note's editor), not in `dom`'s own
 * content. For `dom` being that nested editor itself, it's false: its events are its own.
 */
export function inNestedNote(target: EventTarget | null, dom: Element | null | undefined): boolean {
  if (!dom || !(target instanceof Element)) return false;
  const body = target.closest(`[${SYNCED_BODY_ATTR}]`);
  return Boolean(body && body !== dom && dom.contains(body));
}
